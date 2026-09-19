# 02 — Social ingestion: what the platforms will actually let us do

This is the doc that changes the project. **The brief — "pull in our Instagram and/or TikTok
and/or YouTube Shorts" — is not buildable as literally stated.** Here is exactly why, and
what to build instead.

## 1. The matrix

| | Instagram (our Business acct) | TikTok | YouTube Shorts |
| --- | --- | --- | --- |
| API | Instagram Graph API (Basic Display is dead — ended Dec 2024) | Display API v2 | Data API v3 |
| Get list of our own posts | ✅ `GET /{ig-user-id}/media` | ✅ `/v2/video/list/` | ✅ uploads playlist |
| Metadata (caption, timestamp, permalink) | ✅ | ✅ `title`, `video_description`, `duration` | ✅ |
| Thumbnail / cover | ✅ `thumbnail_url` | ⚠️ `cover_image_url` **expires**, must be refreshed via `/v2/video/query/` | ✅ |
| **The actual video file** | ⚠️ `media_url` — signed CDN URL with an expiry baked into the querystring | ❌ **Never provided** | ❌ **Never provided** |
| Play it in *our* player | ⚠️ technically possible, contractually grey | ❌ **Prohibited** — must use TikTok's embed player | ❌ **Prohibited** — Required Minimum Functionality mandates the YouTube iframe player |
| Identify Shorts specifically | n/a | n/a | ❌ **No `isShort` flag exists.** Infer from duration + `videoDimension`, or an unofficial `HEAD /shorts/{id}` check |
| Stories / Highlights | ⚠️ `/{ig-user-id}/stories` needs `instagram_manage_insights`; 24h TTL. **Highlights are not exposed at all.** | n/a | n/a |

## 2. The three hard blockers

### Blocker 1 — TikTok and YouTube will not give us the video

Both return metadata plus an embed. TikTok's `embed_link` is explicitly the sanctioned
consumption path ("open a web view with the URL provided in `embed_link`"). YouTube's
Required Minimum Functionality rules require the embedded player, unmodified, with no
overlays.

**Consequence:** you cannot assemble a single uniform swipe-up-swipe-down 9:16 feed out of
TikTok + YouTube API content. Each item would be a third-party iframe with its own chrome,
its own branding, its own ads, its own autoplay rules, and no ability to preload the next
item. A mixed feed of "our player, our player, TikTok iframe, our player, YouTube iframe"
is a bad product and a compliance liability.

### Blocker 2 — Instagram media URLs expire, and caching is constrained

`media_url` is a privacy-aware signed CDN URL with an expiry encoded in it. Meta's Platform
Terms also require that you cache User Content only as long as necessary to provide your
service, keep it current, and **remove content within 24 hours of the owner requesting it**.

**Consequence:** building a permanent archive by scraping our own `media_url`s is fragile
(links rot) and puts us on the wrong side of a terms review. This is the most common way
these projects die quietly six months in.

### Blocker 3 — Music licensing. This is the real one.

TikTok's Commercial Music Library and Instagram's sound licenses are **platform-scoped**.
A commercial sound licensed for TikTok is licensed for *TikTok*, not for houstontexans.com
and not for the Texans app. Republishing a Reel or a TikTok that uses a trending or CML
sound onto our own owned-and-operated property is an unlicensed sync + master use.

**Consequence:** even for content we made and own the video of, the *audio* may make it
unshippable to our own platform. Any ingestion pipeline needs an audio-rights gate before
anything goes live. This is not a theoretical risk for an NFL club.

### Also: NFL rights

Club digital rights have loosened — team social accounts are now treated as an extension of
team owned-and-operated properties, and clubs can post game highlights to TikTok and
Threads. But **game highlights remain league-controlled**, and a persistent, permanent,
monetizable team-owned video feed is a materially different product from an ephemeral
social post. This needs an explicit read from NFL Digital / legal, not an assumption.

## 3. What to build instead — invert the pipeline

> **Use the social APIs for discovery and metadata. Use our own master files for media.**

We own this content. We shot it, we cut it, it exists as a 9:16 master somewhere in our
DAM/MAM before it ever gets uploaded to TikTok. The correct source of truth for the video
is *that file*, not a re-derived copy scraped back out of a platform CDN.

```
                 ┌─ Instagram Graph API ─┐
  discovery ─────┼─ TikTok Display API ──┼──> "here is what we published, when,
                 └─ YouTube Data API ────┘     the caption, the permalink, the metrics"
                                                          │
                                                          │ match on filename / slug /
                                                          │ posted-at / operator pick
                                                          ▼
   media ────────  DAM / MAM master 9:16 file  ──────────> rights gate ──> transcode ──> feed
                   (the file we already own)               (audio +
                                                            NFL footage)
```

What each social API is genuinely good for:

- **Backfilling metadata** — caption, hashtags, publish time, permalink.
- **Performance signal** — pull engagement so the in-app feed can order by what actually
  worked on social. This is a real, defensible differentiator.
- **A "watch on TikTok / Instagram" outbound link** on each card. Drives social follows,
  fully compliant, no embed needed.
- **An editorial worklist** — "these 14 things went out on social this week; which do you
  want in the app feed?" One click, operator picks, master file pulled from the DAM.

## 4. Compliant fallbacks if we *do* want literal social embeds somewhere

- **Instagram oEmbed** — as of June 2026 Meta reversed course and oEmbed for Instagram,
  Facebook and Threads can be called **without an access token and without App Review**
  (lower rate limits than the token path, public content only) [reported — confirm before
  relying on it]. Fine for a "latest from @HoustonTexans" card. Not fine as the guts of a
  swipe feed.
- **TikTok embed player** via `embed_link` — fine for a dedicated "our TikToks" page.
- **YouTube iframe** — fine for a Shorts shelf.

These are legitimate products, they're just a *different* product from the persistent
branded vertical feed. We may well want both surfaces.

## 5. Access we will need (see doc 05)

- Instagram **Business or Creator** account linked to a Facebook Page, inside a Business
  Manager we control, plus a Meta app with `instagram_basic` (and `instagram_manage_insights`
  if we want story-level data). Personal accounts get nothing.
- A **TikTok for Developers** app, approved for `user.info.basic` + `video.list`, with our
  account authorized.
- A **Google Cloud project** with YouTube Data API v3 enabled and our channel ID. Note the
  API quota is the usual constraint here, not permissions.
