# Content Builder — Vertical Video / Stories Widget

Working repo for a Texans-owned vertical video + Stories experience that can be
embedded in the mobile app and on web, fed by our own social output
(Instagram / TikTok / YouTube Shorts) and our own master video files.

**Status: research complete, awaiting Phase 0 inputs. No implementation yet.**

Spine of the design: **Cloudinary** as master store + transcode + AI 9:16/4:5 reframe +
captions + CDN; **Asana** for editorial; a small service we build for ingestion, ranking and
the feed API; the app rendering layer rented from Storyteller via **FanReach**.

Start here: [`docs/research/00-executive-summary.md`](docs/research/00-executive-summary.md)

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

## Research method / confidence

Findings marked **[verified]** come from primary sources inspected directly —
Storyteller's published npm SDK (`@getstoryteller/storyteller-sdk-javascript@10.13.16`)
and their public GitHub org. Findings marked **[reported]** come from vendor
marketing, platform docs and press coverage read via search, and should be
confirmed with the vendor or platform before we commit to them.
