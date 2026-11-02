# Pocket RSS Feeds - Working Reference

houstontexans.com (Pocket CMS) publishes four RSS feeds. This is everything we have
learned about them across the read-next, rss-filter, and homepage-optimization work,
plus a live check run 1 Nov 2026. The Worker section (5) was checked against the
Cloudflare account and the `TexansDigital/forms-on-pocket` repo, not just past chats.

**Worker status at a glance (from the Cloudflare account, 1 Nov 2026)**

| Worker | Reads | Live? | Source of truth |
|---|---|---|---|
| `read-next` | `/rss/news`, `/rss/galleries` (+ YouTube API) | Yes, deployed Oct 31 | Repo: `workers/read-next/` |
| `content-feed` | `/rss/news`, `/rss/galleries`, `/rss/videos` | Yes, but the **v1** build (no audio) | Not in repo; full source in Appendix B |
| `rss-filter` | `/rss/news` | **No, never deployed** | Not in repo; full source in Appendix A |
| `texans-article` | Article pages (not RSS) | Yes | Repo: `workers/article/` |

---

## 1. The feeds

| Feed | URL | Status (1 Nov 2026) | Items | Window |
|---|---|---|---|---|
| News | `https://www.houstontexans.com/rss/news` | Working | ~50 | ~3 weeks (Oct 8 - Oct 28 on last check) |
| Galleries | `https://www.houstontexans.com/rss/galleries` | Working | ~20 | Several weeks |
| Videos | `https://www.houstontexans.com/rss/videos` | **Working now** (was broken Sept - mid Oct) | 80 | ~3 weeks |
| Audio | `https://www.houstontexans.com/rss/audio` | Working (was Unpublished until late Oct) | 32 | Texans All-Access episodes |

### Exact URL rules
- **No trailing slash.** `/rss/news/` returns a **301**.
- **No extension.** `/rss/news.xml` returns a **404**. `/rss/` alone is a 404.
- **No tag or section feeds exist.** `/rss/news/vanderblog`, `/rss/vanderblog` and
  trailing-slash variants all 404. Feed nodes are created by hand in Pocket, so if a
  filtered feed is ever wanted natively, someone (Juan) has to create the node. Until
  then, filter with a Worker (section 5).
- **Not advertised.** Article pages carry no `<link rel="alternate">`, so you cannot
  discover the feeds from page source.

### Feed history (so nobody re-diagnoses old states)
- `/rss/videos` returned **200 with zero bytes and no content-type** on checks in
  Sept and again Oct 12, despite being Published in Pocket. By late Oct it served 80
  items. Read-next was built while it was dead, so read-next gets video from the
  YouTube Data API instead (section 5).
- `/rss/audio` was Unpublished through mid-Oct; live by Oct 28 with 32 episodes linking
  to `/podcasts/...` pages on houstontexans.com.

---

## 2. Response headers and delivery

From a Sept 2026 `curl -I`:

- Served through Varnish (Fastly) with `cache-control: public, max-age=5` - the feed
  is effectively live; a new article appears within seconds of publish.
- `access-control-allow-origin: *` - a browser on any origin can read it. On
  houstontexans.com itself it is same-origin anyway, so **Pocket blocks can fetch the
  feeds directly with no Worker.**
- `content-type: application/rss+xml` on working feeds. A 200 with no content-type and
  an empty body is the "published but broken" signature - check body length, not just
  status.

Quick health check from the Mac terminal:

```bash
for p in news galleries videos audio; do
  printf '%-10s ' "$p"
  curl -s -o /tmp/f.xml -w "%{http_code} %{content_type} " "https://www.houstontexans.com/rss/$p"
  grep -o '<item>' /tmp/f.xml | wc -l
done
```

---

## 3. Feed shape

RSS 2.0 with three namespaces: `atom`, `dc`, and `media` (Media RSS,
`http://search.yahoo.com/mrss/`).

### Channel
`title` (News / Galleries / Videos), `description` ("Latest News"), `atom:link` self,
`link` = `https://www.houstontexans.com`, `language` en-US, and an `image` block with the
NFL team logo SVG.

### Item (news, galleries, videos)

```xml
<item>
  <title><![CDATA[Bye Week Bounceback Needed | VanderBlog]]></title>
  <description><![CDATA[One-line dek...]]></description>
  <link>https://www.houstontexans.com/news/bye-week-bounceback-needed-vanderblog</link>
  <pubDate>Mon, 26 Oct 2026 19:06:55 GMT</pubDate>
  <guid isPermaLink="false">6cbba672-8496-4ec7-8e33-a0357a3d8986</guid>
  <source url="https://www.houstontexans.com/rss/news">News</source>
  <media:content url="https://static.clubs.nfl.com/image/upload/t_editorial_landscape_12_desktop/texans/<id>.jpg" />
  <enclosure url="https://static.clubs.nfl.com/image/upload/t_editorial_landscape_12_desktop/texans/<id>.jpg" length="0" type="image/jpeg"></enclosure>
  <media:keywords>
    <![CDATA[Homepage CP, vanderblog, New York Giants at Houston Texans (2026-REG-7), 2026 REG7 - Giants]]>
  </media:keywords>
</item>
```

| Field | Notes |
|---|---|
| `title` | CDATA. May contain `&`, quotes and curly apostrophes - decode before display |
| `description` | CDATA dek, one or two sentences. **Can be missing** (seen on a community story) - always fall back |
| `link` | Canonical houstontexans.com URL. News is `/news/<slug>`, videos `/video/<slug>`, galleries `/photos/<slug>`, audio `/podcasts/...` |
| `pubDate` | RFC 822 in **GMT**. Parse with `Date.parse`; format in `America/Chicago` for fans |
| `guid` | Stable UUID, `isPermaLink="false"`. Use this as the primary key, not the link (slugs can change, e.g. `-x5673` suffixes) |
| `media:content url` | Image. Sometimes `.png` |
| `enclosure url` | Same image, **always `.jpg`**, `type="image/jpeg"`, `length="0"`. Most RSS-to-email tools read only this one |
| `media:keywords` | The only taxonomy. See section 4 |

**Images** use the named transform `t_editorial_landscape_12_desktop`. To resize, swap it
for our usual transform: replace `t_editorial_landscape_12_desktop` with
`w_900,h_506,c_fill,g_center,q_auto,f_auto`. The public_id after `texans/` is the same
Cloudinary ID used everywhere else.

### Audio item differences
`/rss/audio` items link to `/podcasts/...` pages, carry an audio `enclosure`, and their
`media:keywords` lead with the show name. There is **no player embed URL** in the club
feed, so podcast cards click through to the episode page rather than playing in place.
(The Omny playlist RSS has embeds but is cross-origin, so it needs a Worker. Kept as a
fallback only for a show that exists solely on Omny.)

### Parsing gotchas
- `media:keywords` spans **multiple lines** with whitespace around the CDATA - strip
  CDATA and trim before splitting.
- Regex `<item>[\s\S]*?</item>` works; use `<item\b` if attributes ever appear.
- Treat empty body as a distinct failure state, never as "no content" (DST four-state
  rule: not configured / empty / failed / loaded).
- Guessing the feed shape instead of inspecting the real XML caused bugs repeatedly in
  the homepage build. **Fetch and read a real item before writing a parser.**

---

## 4. Tags (`media:keywords`) - the only metadata

There are **no categories**. Everything category-like arrives as one flat,
comma-separated string. One field mixes:

| Kind | Examples |
|---|---|
| Placement | `Homepage CP` (on nearly everything) |
| Topic / section | `Gameday`, `How to Watch`, `Inactives`, `Transaction`, `Press Releases`, `Community`, `Youth Football`, `Girls Flag` |
| Series | `vanderblog` |
| Game, two formats | `New York Giants at Houston Texans (2026-REG-7)` and `2026 REG7 - Giants` |
| Game, video only | `2026 REG7 - Giants - Video` |
| Video type | `All Videos`, `Highlights`, `press conference`, `Press Conferences` |
| People | `C.J. Stroud`, `DeMeco Ryans`, `John Harris`, `Marc Vandermeer` |
| Season | `2026 Season` |

### Data-quality problems seen in the live feed (1 Nov 2026)
Any filter has to survive these:
- **Casing and duplicates:** `DeMeco Ryans, Demeco Ryans`; `Calen Bullock, calen bullock`;
  `Press Conferences` repeated three times on one item; `Gameday` twice.
- **Trailing spaces inside a tag:** `2026 REG4 - Cowboys ` (note the space).
- **Typos:** `homepge cp`, `homeaage`.
- **Wrong game codes:** London (Week 6) stories tagged `2026 REG15 - Jaguars` alongside
  `(2026-REG-6)`; a Week 9 Chargers How to Watch tagged `(2026-PRE-1)`; a Cowboys clip
  tagged `2025 REG4 - Albums - Texans vs Titans`.
- **Substring traps:** a "contains Bills" rule also matches
  `Buffalo Bills at Houston Texans`.

So: **normalize every tag to a slug** (lowercase, strip apostrophes, non-alphanumerics to
`-`, trim dashes) and match whole slugs, never substrings. `2026 REG4 - Cowboys ` becomes
`2026-reg4-cowboys`; `Ka'imi Fairbairn` becomes `kaimi-fairbairn`.

### Prefer the `(YYYY-REG-N)` game tag
The long form `... at Houston Texans (2026-REG-6)` is the more reliable game key; the
short `2026 REGn - Team` form is where the mislabels show up.

### Richer data lives on the article page, not in the feed
`utag_data` on each article carries `articleFreeForm1/2/3` (campaign, game, series) and
`articleGames`, mirrored in the NewsArticle JSON-LD `keywords`. Nothing that reads RSS
sees these. If feed filtering ever proves too noisy, a metadata crawl of article URLs is
the upgrade path.

The tagging convention drafted for Juan and Lauren (Sept 2026) is the real fix: a
controlled vocabulary for series / game / topic, since the CMS has no fields for them.

---

## 5. Workers built on the feeds

All four run on the `texansdigital.workers.dev` account. Shared rules from the project
notes apply: handler signature `fetch(request, env, ctx)` (two args causes 502s); a
first deploy returns `error code: 1042` for up to a minute; `wrangler` is a
devDependency, so commands are `npx wrangler ...`.

### 5a. read-next (LIVE) - article recommender

| | |
|---|---|
| URL | `https://read-next.texansdigital.workers.dev` |
| Source | `TexansDigital/forms-on-pocket`, `workers/read-next/src/index.js` (890 lines). Old versions in `archive/workers/read-next/src/` |
| Deploy | GitHub Action `.github/workflows/deploy.yml` on push to `main` touching `workers/**`. Merging is the deploy. Last deployed Oct 31 2026 |
| Cron | `15 * * * *` (hourly at :15) runs `ingest()` |
| Bindings | D1 `DB` = `pocket-registry` (`5ece8636-c2d1-41e0-b72f-5b71ec0042dd`) |
| Secrets | `YOUTUBE_API_KEY` (YouTube Data API v3). Set from the Mac: `npx wrangler secret put YOUTUBE_API_KEY --config workers/read-next/wrangler.toml` |
| CORS | `https://www.houstontexans.com` only, with credentials (needed for `sendBeacon`) |
| Front end | Pocket block in `~/_libraries/footer/_footer`, bottom drop zone outside the Footer container. Renders on article pages, positions itself next to the Related Content tray |

`wrangler.toml`:

```toml
name = "read-next"
main = "src/index.js"
compatibility_date = "2026-01-01"

[[d1_databases]]
binding = "DB"
database_name = "pocket-registry"
database_id = "5ece8636-c2d1-41e0-b72f-5b71ec0042dd"

[triggers]
crons = ["15 * * * *"]
```

**Endpoints**

| Route | Does |
|---|---|
| `GET /related?path=/news/<slug>` (or `?id=<guid>`, `&n=1-8`) | Ranked related items plus `config` and `upcoming` (next home games). Cached 600s. On error returns `{items:[], error:'unavailable'}` with a 200, so the page never breaks |
| `GET /ingest` | Runs the ingest now and returns the report, e.g. `{"feeds":[{"type":"news","parsed":50},{"type":"gallery","parsed":20},...],"stored":..,"total":..}` |
| `GET /stats` | Counts by type, date range, untagged rows, players, clicks by unit |
| `GET /config` | The `CONFIG` object |
| `GET /roster` | Player alias map built from the live roster page |
| `POST /click` | Logs a click to `recommend_clicks`. Never errors to the page |

**What ingest does, in order**
1. Fetches each entry in `FEEDS` (`/rss/news` as type `news`, `/rss/galleries` as
   `gallery`) with a 300s edge cache. A published-but-empty feed is reported as
   `empty response`, not an outage.
2. Parses items (`parseItems` splits on the literal `<item>`), normalizes tags to slugs
   (`tags`, comma-joined) and keeps the original strings (`tag_labels`, pipe-joined).
   Upserts into `articles` on `guid`.
3. Scrapes `https://www.houstontexans.com/team/players-roster/` into `players`, plus the
   hand-kept `NICKNAMES` map.
4. Pulls the latest 50 uploads from the Texans YouTube channel (`UCa_FcpOBe8G6VAR18RYS-aA`,
   uploads playlist `UU...`), classifies Shorts (180s or less, plus a throttled
   `youtube.com/shorts/<id>` redirect check), tags each video by matching its title
   against article tag labels and player aliases, and stores them as type `video` or
   `short`.

**Live state (`/stats`, 1 Nov 2026):** 708 rows - 163 news, 63 gallery, 234 video,
248 short - from Aug 16 to Nov 1. 95 players. Clicks logged: continuation 124,615, page
9,935, tray 5,256, widget 3,436, bubble 382, video 523, tickets 109, cta 76, youtube 6.

**Scoring:** IDF over tag slugs (`Homepage CP` on everything scores 0), plus a small
recency nudge. Items tagged `transaction` / `roster-move` are scaled by 0.35. Pre-game
items (`how-to-watch`, `injury-report`, `inactives`, `game-preview`, `gameday`,
`five-things-to-watch`, `know-your-foe`) older than the article being read are scaled by
0.08. At most 1 gallery and 1 video per set; 5 videos are held back for the end-of-run
reel.

**CONFIG (change = Worker deploy, no Pocket edit):** `enabled`, `placement`
(`below`), `anchor` (`before-related`), `count` 4, `heading` "More from the Texans",
`showWhy`, `maxGalleries` 1, `video {enabled, maxPerSet 1, reelSize 5}`,
`tickets {enabled, count 3}`, `destinations` (YouTube, /tickets/, Stampede newsletter),
`continuation {enabled, maxStories 3, api: texans-article, track}`. Kill switch:
`enabled: false`.

**Hardcoded, needs a yearly edit:** `HOME_GAMES` (opponent, kickoff with CT offset,
Ticketmaster event ID). Remaining after today: Colts Nov 19, Ravens Nov 29, Jaguars
Dec 20, Titans Jan 10 (flagged `tbd`).

**D1 tables it owns:** `articles` (migrations 003, 004 adds `type`, 005 adds
`tag_labels`), `recommend_clicks` (003), `players` (006). D1 migrations are run from the
Mac with inline `--command` statements, because `--file` fails silently on this account.

**Adding `/rss/videos`:** possible now, but read-next already has video from YouTube. Adding
the club feed would index the club-hosted `/video/` pages as a second video type. Not
needed unless club-hosted video should be recommended.

### 5b. content-feed (LIVE, v1) - homepage merge

| | |
|---|---|
| URL | `https://content-feed.texansdigital.workers.dev/` |
| Source | **Not in the repo.** Deployed by hand from `content-feed-worker.zip` on Oct 28. Live source copied into Appendix B |
| Bindings / secrets | None |
| Cache | `caches.default`, 60s, `stale-while-revalidate=600` |
| CORS | `https://www.houstontexans.com` and `https://houstontexans.com` |
| Errors | 502 JSON `{error:'upstream'}` only if `/rss/news` fails; galleries and videos failing just drop out |

`GET /` returns `{ generated, count, items:[{kind, title, summary, url, img, published, keywords}] }`,
newest first. Kinds: `story`, `gallery`, `video`. Checked 1 Nov: `count` 150.

**Version gap.** The homepage chat (Oct 29) produced a v3 that adds `/rss/audio` as kind
`podcast` (plus an Omny parser kept as a fallback). **The live Worker is still v1 - no
podcasts.** The homepage blocks read `/rss/audio` directly when the Worker is not used.
But if `CONTENT_URL` is set in the blocks, podcasts will not appear until v3 is deployed.
Deploy: unzip v3, `cd content-feed`, `npx wrangler deploy`. Or paste `src/index.js` into
the dashboard editor (Workers & Pages > content-feed > Edit code). Then check that the
response contains `"kind":"podcast"`.

Consumers: homepage v2 blocks (`home-frontpage`, `home-today`, `home-week-lane`,
`home-stream`, `content-swipe`) via `var CONTENT_URL = '...'` at the top of each. Empty
string means the block reads the feeds directly.

Recommended: move it into `forms-on-pocket` as `workers/content-feed/` and add it to the
deploy matrix, so it stops being the only feed Worker that lives in a zip.

### 5c. rss-filter (NOT DEPLOYED) - tag-filtered RSS for Eloqua

Built and tested on Oct 12, but it is not in the Cloudflare account. So
`https://rss-filter.texansdigital.workers.dev/tag/vanderblog` **does not work today.** Full
source in Appendix A.

- `GET /tag/<slug>` returns standard RSS 2.0 containing only the `/rss/news` items whose
  normalized tags include `<slug>`. Items pass through byte for byte, so `<enclosure>`
  survives. The channel title comes from `TITLES` (`vanderblog` maps to "VanderBlog | Houston Texans").
- `GET /health` returns `ok`.
- 300s cache; upstream errors return 502 and are not cached.
- Slugs, as examples: `vanderblog`, `2026-reg9-chargers`, `c-j-stroud`, `john-harris`.

Deploy, either way:

```bash
# A) standalone, from the Mac
mkdir -p ~/Downloads/rss-filter/src && cd ~/Downloads/rss-filter
#   save Appendix A as src/index.js and the toml below as wrangler.toml
npx wrangler deploy
curl -s https://rss-filter.texansdigital.workers.dev/health            # ok (1042 for ~1 min first)
curl -s https://rss-filter.texansdigital.workers.dev/tag/vanderblog | grep -c "<item>"
```

```toml
name = "rss-filter"
main = "src/index.js"
compatibility_date = "2026-10-01"
workers_dev = true
```

```
# B) preferred: add to the repo so the Action deploys it
#   workers/rss-filter/src/index.js  + workers/rss-filter/wrangler.toml
#   add "rss-filter" to the matrix in .github/workflows/deploy.yml, merge to main
```

Limits: only covers the ~50 items in `/rss/news` (about 3 weeks). Today
`/tag/vanderblog` would return 4 items: Bye Week Bounceback Needed, Big Win at Wembley,
Keylan Rutledge (tagged vanderblog), That's More Like It. For a full VanderBlog archive,
add a route that reads read-next's `articles` table (`WHERE ',' || tags || ',' LIKE
'%,vanderblog,%'`), which needs the D1 binding.

### 5d. texans-article (LIVE) - not a feed reader, but paired with read-next

`https://texans-article.texansdigital.workers.dev/article?path=/news/<slug>` returns
clean article JSON (about 99% smaller than the page). Cached 900s, CORS
houstontexans.com. read-next's continuation mode calls it. Source:
`workers/article/` in the repo. It reads article pages, not RSS.

### Not feed Workers (checked so nobody goes looking)
`txfeed` (fan preference feed) reads Supabase and YouTube, not Pocket RSS.
`youtube-feed` (series hub) reads YouTube playlist RSS, not Pocket.

---

## 6. Pulling the feed into Eloqua

1. **Eloqua may ignore `media:*`.** Many RSS-to-email consumers read only core RSS:
   `title`, `description`, `link`, `pubDate`, `guid`, `enclosure`. So `media:keywords`
   and `media:content` may be invisible. The image survives because Pocket also writes
   `<enclosure>`. **Test one item in a test send before building on it.**
2. **Do not filter inside Eloqua.** The tag strings are too messy (section 4). Point
   Eloqua at an already-filtered feed: `rss-filter/tag/<slug>`, **once it is
   deployed** (5c).
3. **Expect gaps in descriptions** - give the email template a fallback when
   `description` is empty.
4. **Content lag**: new items reach the feed within seconds and the filter within 5
   minutes.

---

## 7. Using the feed from a Pocket block

- Same origin, so `fetch('/rss/news')` works directly from a block on houstontexans.com.
- Parse with `DOMParser(xml, 'application/xml')` or the regex helpers below; either way
  read `media:keywords` with its namespace or by tag name `media:keywords`.
- Wrap in `DOMContentLoaded`, render the four states, retry once after ~700ms before
  showing a failed state.
- One fetch per page: share it via a page-level promise (homepage uses
  `window.houContentPromise`) rather than letting each block fetch again.
- Dates: parse the GMT `pubDate`, display in CT with an explicit `timeZone`.

Minimal parser (the one the content-feed Worker uses):

```js
function cdata(s){var m=/<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s||'');return (m?m[1]:(s||'')).trim();}
function tag(it,n){var m=new RegExp('<'+n+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+n+'>','i').exec(it);return m?cdata(m[1]):'';}
function attr(it,t,a){var m=new RegExp('<'+t+'\\b[^>]*\\s'+a+'="([^"]*)"','i').exec(it);return m?m[1]:'';}
function parse(xml,kind){
  return (xml.match(/<item\b[\s\S]*?<\/item>/gi)||[]).map(function(it){
    var kw=tag(it,'media:keywords');
    return {kind:kind,title:tag(it,'title'),summary:tag(it,'description'),url:tag(it,'link'),
      guid:tag(it,'guid'),img:attr(it,'enclosure','url')||attr(it,'media:content','url'),
      published:tag(it,'pubDate'),
      keywords:kw?kw.split(',').map(function(k){return k.trim();}).filter(Boolean):[]};
  });
}
function slugify(s){return s.toLowerCase().replace(/['\u2018\u2019]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
```

(Decode `&amp;` etc. in titles before inserting as text; insert with `textContent`, not
`innerHTML`.)

---

## 8. Things the crawler does not do

The `pocket-crawler` Worker **excludes `/rss/`, `/news/`, `/video/` and `/sitemap`** by
design: those paths were 32,134 of 32,751 sitemap URLs and are template-generated, with no
hand-pasted modules to find. Article data comes from the feeds (read-next), not the
crawler. Blind spot: a one-off block pasted into a single article would not be detected.

---

## 9. Open items

- **rss-filter is not deployed.** Deploy it (5c) before giving Eloqua any
  `rss-filter` URL.
- **content-feed live is v1.** Deploy v3 for podcasts, and move the source into the
  repo.
- Ask Juan whether Pocket can create native filtered feed nodes (e.g. a VanderBlog feed),
  and flag the tag errors above (`REG15` on Week 6 stories, `PRE-1` on a Week 9 item,
  `homepge cp`, `homeaage`, the 2025 Titans tag on a Cowboys clip).
- read-next's `HOME_GAMES` needs a 2027 update after the Titans game.
- Two article-page bugs found alongside the feed work (Sept 2026): NewsArticle JSON-LD
  `url` points at `texans-frontend.pocket.nfl.com`; the footer VanderBlog link is
  `houstontexans.comnews/vanderblog` (missing slash).

---

## Appendix A - rss-filter source (not deployed)

`src/index.js`. Tested against sample items from the live feed: multi-line CDATA,
trailing-space tags, no substring matches, `<enclosure>` kept. Compared with the Oct 12
build, this version adds `no-store` on errors and treats an empty upstream body as a 502.

```js
// rss-filter: serves a subset of the club news feed, filtered by tag.
//   /tag/vanderblog          -> items whose media:keywords include "vanderblog"
//   /tag/2026-reg5-titans    -> any tag, matched on its normalized slug
// Items are passed through untouched, so title, description, link,
// pubDate, guid and the <enclosure> image all arrive as Pocket wrote them.

const UPSTREAM = 'https://www.houstontexans.com/rss/news';
const CACHE_TTL = 300; // 5 minutes

// Friendly channel titles for known tags; anything else uses the raw slug.
const TITLES = {
  vanderblog: 'VanderBlog | Houston Texans',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }

    const m = url.pathname.match(/^\/tag\/([a-z0-9-]+)\/?$/);
    if (!m) {
      return new Response('Use /tag/<tag-slug>, e.g. /tag/vanderblog', {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      });
    }
    const slug = m[1];

    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, { cf: { cacheTtl: CACHE_TTL } });
    } catch (e) {
      return new Response('Upstream feed unreachable', { status: 502, headers: { 'cache-control': 'no-store' } });
    }
    if (!upstream.ok) {
      return new Response('Upstream feed returned ' + upstream.status, { status: 502, headers: { 'cache-control': 'no-store' } });
    }

    const xml = await upstream.text();
    if (!xml.trim()) {
      // Published-but-empty is a real Pocket failure mode; never cache it.
      return new Response('Upstream feed was empty', { status: 502, headers: { 'cache-control': 'no-store' } });
    }
    const body = filterFeed(xml, slug, url.origin + url.pathname);

    const res = new Response(body, {
      headers: {
        'content-type': 'application/rss+xml; charset=utf-8',
        'cache-control': 'public, max-age=' + CACHE_TTL,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  },
};

export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function itemTags(itemXml) {
  const k = itemXml.match(/<media:keywords>([\s\S]*?)<\/media:keywords>/);
  if (!k) return [];
  const raw = k[1].replace(/<!\[CDATA\[|\]\]>/g, '');
  return raw.split(',').map((t) => slugify(t)).filter(Boolean);
}

export function filterFeed(xml, slug, selfUrl) {
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/g) || [];
  const keep = items.filter((it) => itemTags(it).includes(slug));

  const title = TITLES[slug] || slug;
  return (
    '<?xml version="1.0" encoding="utf-8" ?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">\n' +
    '<channel>\n' +
    '<title>' + escapeXml(title) + '</title>\n' +
    '<description>' + escapeXml(title) + ' from houstontexans.com</description>\n' +
    '<link>https://www.houstontexans.com</link>\n' +
    '<atom:link href="' + escapeXml(selfUrl) + '" rel="self" type="application/rss+xml" />\n' +
    '<language>en-US</language>\n' +
    keep.join('\n') +
    '\n</channel>\n</rss>\n'
  );
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

## Appendix B - content-feed source (live v1, copied from Cloudflare 1 Nov 2026)

This is what is deployed. It is the only copy outside the Cloudflare account. The v3
with `/rss/audio` is in `content-feed-worker.zip` from the Oct 29 homepage chat.

```js
/* content-feed worker
   One request for the homepage's content: the club's news, galleries and
   videos feeds merged into one JSON list, cached at the edge for 60s.
   Deploy with wrangler; then set CONTENT_URL in the four v2 blocks to
   this worker's URL. The blocks fall back to the three direct feeds if
   this is unreachable, so deploying it is a speed win and never a risk.

   GET /            -> { generated, items:[{kind,title,summary,url,img,published,keywords}] }
   kinds: story (news), gallery (galleries), video (videos)
*/
const FEEDS = [
  { url: 'https://www.houstontexans.com/rss/news',      kind: 'story'   },
  { url: 'https://www.houstontexans.com/rss/galleries', kind: 'gallery' },
  { url: 'https://www.houstontexans.com/rss/videos',    kind: 'video'   },
];
const TTL = 60;                 // seconds at the edge
const STALE = 600;              // serve stale this long if the origin fails
const ORIGINS = ['https://www.houstontexans.com', 'https://houstontexans.com'];

function cdata(s) {
  if (!s) return '';
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s);
  return (m ? m[1] : s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
function tag(item, name) {
  const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i').exec(item);
  return m ? cdata(m[1]) : '';
}
function attr(item, tagName, attrName) {
  const m = new RegExp('<' + tagName + '\\b[^>]*\\s' + attrName + '="([^"]*)"', 'i').exec(item);
  return m ? m[1] : '';
}
function parse(xml, kind) {
  const out = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const it of items) {
    const kw = tag(it, 'media:keywords');
    out.push({
      kind,
      title: tag(it, 'title'),
      summary: tag(it, 'description'),
      url: tag(it, 'link'),
      img: attr(it, 'media:content', 'url') || attr(it, 'enclosure', 'url'),
      published: tag(it, 'pubDate'),
      keywords: kw ? kw.split(',').map(k => k.trim()).filter(Boolean) : [],
    });
  }
  return out;
}

async function build() {
  const lists = await Promise.all(FEEDS.map(async (f, i) => {
    try {
      const r = await fetch(f.url, { headers: { 'user-agent': 'texans-content-feed/1' }, cf: { cacheTtl: TTL } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return parse(await r.text(), f.kind);
    } catch (e) {
      if (i === 0) throw e;      // news must load; the others may be missing
      return [];
    }
  }));
  const items = lists.flat().sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  return { generated: new Date().toISOString(), count: items.length, items };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('origin') || '';
    const cors = {
      'access-control-allow-origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'vary': 'origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: cors });

    const cache = caches.default;
    const key = new Request(new URL(request.url).origin + '/content', { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) {
      const res = new Response(hit.body, hit);
      for (const k in cors) res.headers.set(k, cors[k]);
      res.headers.set('x-cache', 'hit');
      return res;
    }
    try {
      const data = await build();
      const res = new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + TTL + ', stale-while-revalidate=' + STALE, ...cors, 'x-cache': 'miss' },
      });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'upstream', detail: String(e && e.message || e) }), { status: 502, headers: { 'content-type': 'application/json', ...cors } });
    }
  },
};
```

---

## Sources

- Chat: [Pocket RSS feed crawler](https://claude.ai/chat/447be057-dfd6-42dc-975c-6b2cb561fb7c) (Oct 12 2026) - rss-filter, Eloqua, tag structure
- Chat: [Infinite scroll](https://claude.ai/chat/4df21912-0717-4142-8816-ece8ebdc2b94) (Sept 2026) - feed discovery, read-next ingest
- Chat: [Texans website homepage optimization ideas](https://claude.ai/chat/2493dd4c-f41e-4d68-9997-5d2fa45b42d0) (Oct 29 2026) - content-feed Worker, videos and audio feeds
- Project notes: pocket-module-registry, platform-constraints
- Live fetch of `/rss/news`, `/rss/videos`, read-next `/stats` and content-feed, 1 Nov 2026
- Cloudflare account Worker list and deployed `content-feed` source, 1 Nov 2026
- Repo `TexansDigital/forms-on-pocket` at `1f5502a`: `workers/read-next/`, `workers/article/`, `migrations/003-005`, `.github/workflows/deploy.yml`
