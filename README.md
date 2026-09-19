# Content Builder — vertical video feed

A source-agnostic vertical video feed for the Texans, embeddable on houstontexans.com and in
the app. Pull from any platform, curate, publish.

## Run it

```sh
node server.mjs
```

No install, no build step, Node 18+. Then:

| | |
| --- | --- |
| `http://localhost:4400/` | **Studio** — pull from sources, curate, publish |
| `http://localhost:4400/feed` | **The feed** — this is what goes in the iframe |
| `http://localhost:4400/api/feed` | Published items as JSON |

State lives in `content/store.json`. `STORE=/path/file.json node server.mjs` moves it;
swapping in Postgres means replacing `load()`/`save()` in `server.mjs`.

## How it's put together

```
src/content.js        the one item shape everything speaks
src/adapters/         youtube · cloudinary · rss · manual
src/cloudinary.js     delivery URLs, including so_/eo_ + g_auto clipping
server.mjs            static + feed API + store
app/studio.html       editorial UI
app/feed.html         the embeddable feed
```

**Adding a platform is a new file in `src/adapters/`.** Nothing else changes — the feed, the
studio and the embed only ever see a `ContentItem`, never the source that produced it.

| Adapter | Gives us | Limit |
| --- | --- | --- |
| `upload` | **A graphic or video we upload.** Promo cards, sponsor slates, event art | — |
| `youtube` | Metadata for a whole channel, via the uploads playlist | Never the file; plays in YouTube's iframe |
| `cloudinary` | Our own assets, at any aspect ratio | **The only clippable source** |
| `rss` | Article metadata, no credentials or quota | Metadata only |
| `manual` | Anything no API will hand over — TikTok, Reels, a pasted URL | Someone pastes it |

## Card types

A card is not always a clip. The feed renders four kinds, and the studio treats them alike:

| `media.kind` | What it is | Behaviour |
| --- | --- | --- |
| `image` | A graphic — promo, sponsor slate, announcement | Holds for `holdSeconds`, fills the progress segment, then advances like a story |
| `file` / `cloudinary` | Video we control | Plays and loops while on screen |
| `youtube` | A YouTube video | Poster in the feed; playback goes to YouTube's player, as its terms require |
| `link` | A page, no media | Poster plus an action button |

Every kind takes a headline, a caption, an action button and a sponsor. **A graphic with a link
is a first-class card**, not a video with something missing.

## Research

The tool came out of the research in [`docs/research/`](docs/research/). Findings marked
**[verified]** were measured; **[reported]** came from vendor or platform docs.

| Doc | What's in it |
| --- | --- |
| [00 — Executive summary](docs/research/00-executive-summary.md) | Findings, recommendation, decisions needed |
| [01 — Storyteller teardown](docs/research/01-storyteller-teardown.md) | What Storyteller actually is, verified from their shipped SDK |
| [02 — Social ingestion constraints](docs/research/02-social-ingestion-constraints.md) | What IG / TikTok / YouTube will and won't let us do |
| [03 — Distribution surfaces](docs/research/03-distribution-surfaces.md) | App (FanReach), web (Deltatre FORGE), home-screen widgets |
| [04 — Architecture](docs/research/04-build-vs-buy-and-architecture.md) | Cloudinary-centred system design and phasing |
| [05 — What's still needed](docs/research/05-open-questions.md) | Outstanding asks |
| [06 — Decisions](docs/research/06-decisions.md) | Stakeholder answers, dated — **overrides 01–05** |
| [07 — No-credentials path](docs/research/07-no-credentials-path.md) | What we ship if Cloudinary / Meta / TikTok access never lands |
| [08 — Cloudinary, URL only](docs/research/08-cloudinary-url-only.md) | Delivery URLs need no credentials and recover the full design |
| [09 — NFL Cloudinary findings](docs/research/09-nfl-cloudinary-findings.md) | It's a private CDN, and it may be images-only |
| [10 — Where the video comes from](docs/research/10-video-home.md) | YouTube playback vs. a feed-owned store |
| [11 — First real data](docs/research/11-first-real-data.md) | Measured results, and the rights issue that became blocking |
| [12 — What the channel publishes](docs/research/12-content-mix.md) | First look at the content mix (superseded in part by 13) |
| [13 — The supply picture](docs/research/13-the-supply-picture.md) | 1,000 uploads measured, and what the product actually is |
| [14 — Where presser video lives](docs/research/14-where-presser-video-lives.md) | NFL Media Content Platform, and what that changes |
| [15 — Transcript-first clipping](docs/research/15-transcript-first-clipping.md) | **Latest** — why the tool is a highlighter, not a scrubber |

Run [`tools/hunt.sh`](tools/hunt.sh) to settle the open questions in one pass
(or [`tools/cloudinary-probe.html`](tools/cloudinary-probe.html) for the browser version).

## Research method / confidence

Findings marked **[verified]** come from primary sources inspected directly —
Storyteller's published npm SDK (`@getstoryteller/storyteller-sdk-javascript@10.13.16`)
and their public GitHub org. Findings marked **[reported]** come from vendor
marketing, platform docs and press coverage read via search, and should be
confirmed with the vendor or platform before we commit to them.
