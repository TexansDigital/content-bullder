# 04 — Build vs buy, and the proposed architecture

## 1. The three options

### Option A — Buy Storyteller, use it end to end
Their CMS, their players, their ads, their analytics. We upload content into their CMS.

**For:** live in weeks not quarters. Proven at NFL clubs. YinzCam integration already
exists. Gets us Stories *and* Clips, polls, quizzes, captions, VAST ads, SEO web stories,
deep links, light/dark theming — all of "Storyteller's other features" — for free.

**Against:** recurring enterprise cost. Our content lives in their CMS. Their social importer
is the weakest, least verifiable part of the pitch (see doc 01 §6) and social ingestion is
the actual thing we asked for. Editorial ends up double-handling content.

### Option B — Build everything ourselves
Our ingestion, our CMS, our player, our analytics.

**For:** total control, no per-MAU cost, content stays in our stack, we can do exactly the
social-driven ordering and rights gating we want.

**Against:** the *player* is where the effort goes and it's the least differentiated part.
A good vertical feed is genuinely hard — directional preloading (5 ahead, 1 behind), HLS
ABR tuning, MP4 poster pre-warm so first-frame isn't a black box, IntersectionObserver
play/pause, scroll-snap, iOS autoplay/muting rules, captions, share sheets. Then polls,
quizzes, ads, analytics, and a CMS on top. That's a real product, not a sprint.

### Option C (recommended) — Build the ingestion layer, rent the experience
We build the part nobody sells well and that is specific to us:

- social discovery across IG / TikTok / YouTube
- matching a social post back to our own **master 9:16 file** in the DAM
- the **rights gate** (audio licensing + NFL footage classification)
- editorial worklist and publishing rules
- performance-informed ordering (rank the in-app feed by what actually performed on social)

...and push the cleared, transcoded result into a rendering layer via
**Storyteller's Integrations API** (documented purpose: send images/videos to Storyteller to
appear as Stories or Clips in our apps/sites).

**Why this is the right call:** the rendering layer becomes a swappable dependency. If
Storyteller's pricing, roadmap or the NFL's app consolidation changes, we swap the sink and
keep the pipeline — which is where all our actual institutional value lives. It also lets us
start delivering (an editorial worklist and a clean content feed) before the buy decision is
even made.

## 2. Proposed architecture

```
 ┌─────────────── SOURCES ────────────────┐
 │ Instagram Graph API   (metadata)       │
 │ TikTok Display API    (metadata)       │──┐
 │ YouTube Data API v3   (metadata)       │  │
 │ DAM / MAM             (MASTER VIDEO)   │──┼──> INGEST WORKERS
 └────────────────────────────────────────┘  │    - scheduled pollers per platform
                                             │    - normalize to one ContentItem shape
                                             │    - match social post <-> master asset
                                             ▼
                                    ┌──────────────────┐
                                    │   RIGHTS GATE    │  <- blocks by default
                                    │ audio license?   │
                                    │ NFL footage?     │
                                    │ talent/NIL?      │
                                    └────────┬─────────┘
                                             ▼
                                    ┌──────────────────┐
                                    │ EDITORIAL QUEUE  │  operator approves,
                                    │  (thin web UI)   │  sets collection + CTA
                                    └────────┬─────────┘
                                             ▼
                                    ┌──────────────────┐
                                    │    TRANSCODE     │  9:16 HLS ladder + 4:5 poster
                                    │  Mux / CF Stream │  + captions
                                    └────────┬─────────┘
                                             ▼
                        ┌────────────────────┴───────────────────┐
                        ▼                                        ▼
            Storyteller Integrations API              Our own feed API (JSON)
            (rented experience)                       (fallback / future)
                        │                                        │
        ┌───────────────┼──────────────┐          ┌──────────────┼─────────────┐
        ▼               ▼              ▼          ▼              ▼             ▼
   YinzCam app    houstontexans    web stories   iframe      home-screen   share URLs
   native module  (FORGE embed)    (SEO)         embed       deep link
```

**Key design rule:** keep our own `externalId` on every item. Storyteller's API supports
`openStoryByExternalId` / `openClipByExternalId` and `story/stories/externalId` lookups, so
we can key everything on *our* IDs and never get locked in.

## 3. Costs to model

**Video pipeline** (rough 2026 list prices [reported], confirm before budgeting):

| | Encode | Delivery | Storage |
| --- | --- | --- | --- |
| **Mux** | ~$0.07/min | ~$0.025/min delivered | — (10k min free tier) |
| **Cloudflare Stream** | included | ~$1 / 1,000 min delivered | ~$5 / 1,000 min stored |
| **Bunny Stream** | included | ~$0.01/GB (cheapest bandwidth) | low |

Short-form is delivery-heavy and storage-light, so **delivered minutes** is the number to
model. A clip is ~0.5 min; 1M clip-views/mo ≈ 500k delivered minutes ≈ $500/mo on Cloudflare
Stream, less on Bunny, more on Mux. Cheap relative to the SaaS line.

**Storyteller:** published tiers top out around $999/mo (~1M mobile MAU / 2M web pageviews);
NFL-club scale is a bespoke enterprise quote [reported].

**Build-your-own-player:** the real cost is engineering time, ongoing. Budget it as a
permanent partial headcount, not a project.

## 4. Suggested phasing

- **Phase 0 (now, no dependencies):** ingestion + normalization + rights gate + editorial
  worklist. Delivers value on day one ("here's everything we posted this week, cleared or
  flagged") regardless of the buy decision. This is what I'd start building.
- **Phase 1:** transcode pipeline + our own JSON feed API + an iframe-embeddable web feed
  (9:16 player, 4:5 tile rail, themed to our palette).
- **Phase 2:** app integration via YinzCam — Storyteller native module, or webview of Phase 1.
- **Phase 3:** the Storyteller-shaped extras — polls/quizzes, followable collections, VAST
  ads, SEO web story pages, home-screen deep-link widget.
