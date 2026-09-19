# Content Builder — Vertical Video / Stories Widget

Working repo for a Texans-owned vertical video + Stories experience that can be
embedded in the mobile app and on web, fed by our own social output
(Instagram / TikTok / YouTube Shorts) and our own master video files.

**Status: research phase. No implementation yet.**

Start here: [`docs/research/00-executive-summary.md`](docs/research/00-executive-summary.md)

| Doc | What's in it |
| --- | --- |
| [00 — Executive summary](docs/research/00-executive-summary.md) | Findings, recommendation, decisions needed |
| [01 — Storyteller teardown](docs/research/01-storyteller-teardown.md) | What Storyteller actually is, verified from their shipped SDK |
| [02 — Social ingestion constraints](docs/research/02-social-ingestion-constraints.md) | What IG / TikTok / YouTube will and won't let us do |
| [03 — Distribution surfaces](docs/research/03-distribution-surfaces.md) | App (YinzCam), web (Deltatre FORGE), home-screen widgets |
| [04 — Build vs buy + architecture](docs/research/04-build-vs-buy-and-architecture.md) | Options, costs, proposed system design |
| [05 — Open questions](docs/research/05-open-questions.md) | What we need from stakeholders before building |

## Research method / confidence

Findings marked **[verified]** come from primary sources inspected directly —
Storyteller's published npm SDK (`@getstoryteller/storyteller-sdk-javascript@10.13.16`)
and their public GitHub org. Findings marked **[reported]** come from vendor
marketing, platform docs and press coverage read via search, and should be
confirmed with the vendor or platform before we commit to them.
