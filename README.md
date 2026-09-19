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
| `upload` | **A graphic or video we upload.** Promo cards, sponsor slates, event art | Clippable |
| `youtube` | Metadata for a whole channel, via the uploads playlist | Never the file; plays in YouTube's iframe |
| `cloudinary` | Our own assets, at any aspect ratio | Clippable, and reframed to 9:16 |
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

## Clipping

A 40-minute presser is not a card — it is the thing cards get cut out of. Select it and use
**Cut a clip**: drag the in/out handles (or type the seconds, or use the arrow keys), watch the
frame preview, name the moment, and **Create clip**.

That makes a **new card**. The source stays whole, so the next clip comes out of the same asset.
Three clips from one presser is three passes over the same scrubber.

How the cut is made depends on what the source is. Either way the card that comes out is the
same shape, and the studio looks the same.

**Cloudinary — trimmed in delivery.** The whole operation is one URL: `so_`/`eo_` trim it,
`g_auto` reframes 16:9 to 9:16 tracking the speaker, `sp_auto` builds the streaming ladder.

```
so_124,eo_146,f_auto,q_auto,c_fill,g_auto,ar_9:16/sp_auto/texans/pressers/w03.m3u8
```

No render queue, no job to poll, one transformation per clip.

**An uploaded file — trimmed at playback.** The clip card carries the source plus an in and an
out, and the player seeks in and stops at the out. Nothing is re-encoded and no transformation
service is involved, which is the point: **a video file is clippable the moment it is uploaded**,
with no Cloudinary account, no NFL media platform, and nothing to provision. The trade is that
the frame is not reframed to 9:16, so an upload wants to be vertical already.

This needs byte ranges — a browser marks media non-seekable without them and silently ignores
every seek — so `/content/**` serves `206 Partial Content`. Any CDN in front of it has to as well.

**Everything else says so.** YouTube never returns the file, so a YouTube item explains that
rather than offering a scrubber that cannot work.

## Composing a card

A card is a canvas, the way a story is. Beyond the media itself:

**Text and link blocks.** Add as many as you want and drag them anywhere on the card. Each has a
size, an alignment, a colour, and a treatment — `plain` (type over the art), `band` (a full-width
strip, the brand's ticker motif) or `box`. Link blocks are tappable.

**Fill or letterbox.** `Fill` crops the graphic to 9:16. `Letterbox` sits it in the middle and
leaves deliberate empty space top and bottom — which is how you get a text block genuinely
*above* or *below* the graphic rather than on top of it.

**Per-card pacing.** `Auto` holds for a set number of seconds, fills the progress segment and
moves on; a video on auto plays once then advances. `Swipe` stays until the viewer moves. Set per
card, because a promo and a clip want different pacing.

**The default headline block** gets out of the way once a card carries its own blocks — otherwise
it competes with what you composed. Override with Show or Hide.

## Verification

Four browser-driven suites under [`test/`](test/), 71 assertions, each reproducing a specific
reported failure so a regression names the thing that broke.

```sh
npm --prefix /tmp i playwright@1.48.0
```

```sh
cd /tmp && node <repo>/test/verify-fixes.mjs
```

Run against an empty store — delete `content/store.json` between suites.

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
