# Site signals: every page a fan reads

Workstream 3, branch `claude/site-signals`, migrations `sql/400-499`. Written 4 Nov 2026.

## Against the objective

- **Know the fan better:** a fan who reads three Stroud articles has told us their player without
  opening the feed. Today the club learns that from 0 site pages; v5 makes every article,
  gallery, video and podcast page a listening surface.
- **One view:** the event is keyed by the same pocket id as the feed, the picks and the identity
  event, so what a fan reads joins what they watch and, through the identity event, their Eloqua
  GUID. No new id.
- **Toward identity and a ticket:** not yet. This smallest version only listens. The step that
  does move a fan is in "Next" below: the feed opening on the player they read about, and the
  site-only reader recognised by GUID.

## What ships

| Piece | Where | State |
|---|---|---|
| Handshake v5: v4 unchanged, plus one `page_view` per content page | `docs/txfeed-handshake.html` | ready for Adam to paste into `tx-feed-handshake-block` |
| Browser test, 23 checks | `test/verify-site-signals.mjs` | 23 pass |
| Rollup into `feed_profiles.site_*`, fan-only view, report, 08:20 UTC job | `sql/400-site-signals.sql` | written, **not applied**: needs Adam or the SQL editor |

### The event

`POST https://feed.htow.nz/api/events`, body `text/plain` (a simple request, no preflight; the
route reads the body whatever its type). Accepted by the route as it is today; checked against
`createApp` with the real payload: one row, `session_id` = pocket id.

```json
{ "event": "page_view", "at": "...", "params": {
  "pocket_id": "sess_...", "page_type": "news", "page_path": "/news/a-true-weapon-...",
  "page_section": "News", "page_tags": ["Homepage CP", "Jadeveon Clowney", "Ka'imi Fairbairn"],
  "page_title": "A true weapon, a homecoming sack and a crowd that showed up", "hv": 5 } }
```

Sent only when OneTrust group C0002 is positively on (unknown is not consent) and a pocket id
exists, the same rule as the pocket id. Waits up to ten seconds for OneTrust and the pocket id,
and counts a fan who accepts in the banner after landing. Never the GUID, never a cookie, never
the query string. `?qa=1` on the page sets `params.qa: true`.

Pages: `/news/<slug>`, `/photos/<slug>`, `/video/<slug>`, `/podcasts/<slug>`. Not the home page
or section indexes.

### Where the tags come from (checked with data, 4 Nov)

The site's first JSON-LD block: `keywords` (players by full name, mixed with editorial tags such
as "Homepage CP", "vanderblog", game ids) and `articleSection`. Video pages carry a section and
no keywords, so the title rides along. On four real pages: 6 player tags, all 6 resolve to
dictionary slugs, 0 editorial tags match by mistake, the video page's title finds its player
(Brevin Jordan, 0.8). Opponents are left out on purpose: a recap tags the opponent, which is not
the fan's taste.

### The rollup

`feed_rollup_site()` rebuilds `site_weights` (entity -> 0..1, 30-day half-life, top = 1),
`site_sections`, `site_views`, `site_last_seen` for every pocket id with a fan page view in two
days. Separate columns so `feed_rollup_profiles` never overwrites them and the review can tell
the site's signal from the feed's. Exclusions, all in `feed_site_views`: `params.qa`,
`params.automated`, Adam's session, ids containing smoketest, armcheck or test.

`select * from feed_site_report(1);` gives page views, fans, views naming a player, fans with a
site player, site fans who also opened the feed, site fans recognised by GUID, by page type, top
players, top sections.

## Asks for the feed session (no change made to the Worker or the feed)

1. **Rank on it.** `profileFor` selects `site_weights` too; `rank.js` adds it to the history score
   at a lower weight than feed watching (suggest 0.5 x), and lets it rank a session with fewer than
   `MIN_EVENTS` feed events. Optional pill: "Because you read about Tank Dell". Without this the
   signal is stored but the fan feels nothing.
2. **Count feed sessions on feed events.** Any review that counts sessions from all `feed_events`
   rows should add `event <> 'page_view'`; the four functions that read the table today already
   filter by event name.

## Next, once one day is measured

- **Recognise the site-only reader.** Add `eloqua_guid` (C0004 only, once per browser session) to
  the first page_view, so a fan who reads but never opens the feed joins their Eloqua contact.
  Same rule as v4; needs a line in the privacy read because the GUID would travel from every
  content page, not only feed pages.
- **The measure in workstreams.md:** share of first-visit feed sessions that open on a player the
  fan already read about. Needs ask 1 live.
- **Toward a ticket:** a fan with three or more reads about one player in a week meets the
  `{{player}}` contest or the going-to-a-game question on the site, not only in the feed.
