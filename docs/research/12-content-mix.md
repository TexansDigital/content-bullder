# 12 — What the channel actually publishes

Measured over 11 days (7–18 Sept 2026) on `UCa_FcpOBe8G6VAR18RYS-aA`. Run it yourself with
`node tools/channel-audit.mjs`.

```
LONG-FORM (21)                      SHORTS (10)
  presser   12  ██████████████████    gameday  10  ████████████████████
  radio      6  █████████
  gameday    3  ████
  live dupes 4  (LIVE: … re-cut as | Full Q&A)

OVERLAP BETWEEN THE TWO SETS: 0
```

## 1. The finding that matters

**The vertical content and the usable content are disjoint sets.**

- Everything vertical-native (10/10 Shorts) is **game highlights** — the category blocked on
  the unanswered NFL rights question, and all ten carry `licensedContent: true`.
- Everything not blocked (12 pressers, 6 radio) is **long-form 16:9 talking heads** — the
  opposite of feed content in every dimension: aspect, duration, pace.

So the feed cannot be assembled by filtering what already exists. Either the rights answer
unlocks the Shorts, or **the long-form has to be cut down into vertical moments.** There is no
third pile of ready-made, rights-clean vertical content sitting there.

## 2. That second path is a real product, not a consolation

A 20-minute Stroud presser contains four or five genuinely good 20-second answers. Turning those
into vertical clips is exactly what `g_auto` reframing exists for — a centre-crop would slice
the speaker in half, and the AI crop tracks them. We confirmed `g_auto` works on this account.

This is also precisely the product Storyteller sells separately as **ClipCrop** ("turn long
videos into shorter clips and convert between aspect ratios," used by sports clients). If we're
building it, we should know we're rebuilding something that exists — and that it's the part of
Storyteller most worth buying.

It changes the shape of the editorial tool: less "approve what we already posted," more
"pick moments out of the presser." That's a bigger build and a bigger behaviour change, and it's
worth knowing now rather than after the ingestion pipeline is finished.

## 3. The five collections are aspirational

Across 31 videos in 11 days:

| Collection | Count |
| --- | --- |
| gameday | 13 |
| presser | 12 |
| radio | 6 |
| **players** | **0** |
| **community** | **0** |
| **flag** | **0** |

Three of the five named collections produced nothing in nearly two weeks — and two categories
that *do* carry real volume (pressers, Texans Radio) weren't in the taxonomy at all.

In-season this is probably the honest steady state. Community and girls flag likely cluster
around events and the off-season rather than appearing weekly.

**Recommendation:** launch with the collections that have supply — Gameday, Pressers, Texans
Radio — and let Community, Players and Girls Flag appear seasonally rather than shipping five
shelves where three are empty. An empty collection reads as a broken product; a collection that
appears when there's something in it reads as editorial judgement. The taxonomy is already
updated in `tools/harvest-channel.mjs`.

Worth checking against a full year before committing — 11 days in September is a thin base for
a claim about community and youth football.

## 4. Two API findings, both now handled in code

### `search.list` does not return Shorts

A date-ordered `search.list` over this channel returned 21 videos and **zero** of the ten known
Shorts published inside the same window. It also truncates descriptions and omits duration and
status entirely.

**Harvest the uploads playlist instead:** `channels.list(part=contentDetails)` →
`relatedPlaylists.uploads` → `playlistItems.list` → `videos.list`. Implemented in
`tools/harvest-channel.mjs`. Quota is about 9 units for 200 videos against a 10,000/day default,
so a daily full harvest is essentially free.

### Titles come back HTML-escaped

`Q&amp;A`, `Montgomery&#39;s`, `Ja’Marr`. Both endpoints do it. Rendering these raw would put
`&amp;` on screen, and matching against them silently breaks classification rules. `decodeEntities()`
now runs before anything is rendered or matched.

## 5. Smaller things worth carrying

- **Live streams duplicate the edited cuts.** Every presser appears twice: `LIVE: … address the
  media` (raw stream) and `… | Full Q&A` (the cut). 4 of 21 were dupes. `isLiveStreamDupe()`
  flags the `LIVE:` prefix; only the cut should reach the feed.
- **Titles are well-written and feed-ready.** `"Woody flips for the first down 🚀"`,
  `"Clowney gets the sack 😤"` — no rewriting needed, which removes an editorial step.
- **`image/fetch` returns 401.** Remote-fetch reframing of YouTube thumbnails is not enabled on
  this account, so tiles can't be derived from YouTube posters. Assets have to be uploaded to
  Cloudinary to be transformed. Not a blocker; it just removes a shortcut.

## 6. What this changes about the plan

| Was | Now |
| --- | --- |
| Harvest via `search.list` | Uploads playlist — `search.list` misses Shorts entirely |
| Five collections | Three with real supply, four more seasonal |
| Ingest = approve existing verticals | Ingest = approve verticals **plus clip long-form** |
| NFL rights: worth checking | **Blocking.** It gates the only vertical content that exists |
