# 00 — Executive summary

## The headline

**The brief as written — "pull in our Instagram / TikTok / YouTube Shorts and show them in
our own 9:16 feed" — cannot be built.** TikTok and YouTube never hand over the video file
and contractually require their own embed players. Instagram hands over an expiring signed
URL under caching restrictions. And even where we can get the pixels, **the audio licensing
usually doesn't travel** — a TikTok trending sound is licensed for TikTok, not for
houstontexans.com.

**But the product we want is absolutely buildable — by inverting the pipeline.** We own this
content. Use the social APIs for *discovery, metadata and performance signal*; use our own
**master 9:16 files** from the DAM as the media. Same end result for the fan, on solid legal
and technical ground, and better — because we can rank the in-app feed by what actually
performed on social.

## What Storyteller is, and whether to buy it

Verified by tearing down their shipped npm SDK rather than reading their marketing:

Six drop-in components (Stories row/grid, Clips row/grid, full-screen Clips player, embedded
Clips player), a content model with polls and trivia-quiz page types, followable categories
and collections, scheduling, deep links, captions, a deep light/dark theming token tree,
Google IMA / VAST ad insertion, ~45 tracked analytics events, and auto-generated Google Web
Stories for SEO. Web Stories are rendered on Google's `amp-story-player`; Clips play over
HLS. Backend is `api.usestoryteller.com`, keyed by `x-storyteller-api-key`.

**Two findings that matter most:**

1. **YinzCam — who builds our app — already maintains the official Storyteller Android
   sample integration.** The app-side risk is largely gone.
2. **There's an Integrations API for pushing media *into* Storyteller.** That's the seam:
   we can own ingestion and let them own the experience, without lock-in.

**And one caution:** their "import from your socials" marketing claim is the least verifiable
part of the pitch and is exactly the thing we're asking for. Make them demo it live against a
TikTok account before believing it.

## Recommendation

**Build the ingestion layer. Rent the experience. Keep the seam swappable.**

We build social discovery, master-file matching, the rights gate, the editorial worklist and
performance-informed ordering — the parts specific to us that nobody sells well. We push the
cleared result into Storyteller via their Integrations API (or, later, our own player). Every
item carries *our* `externalId`, so the rendering layer stays replaceable.

Start on **Phase 0** — ingestion, normalization, rights gate, editorial worklist — which
delivers value immediately and survives whatever we decide on buy-vs-build.

## The three things I most need from you

1. **Rights answers** (music licensing + NFL game footage in a persistent club-owned feed).
   These decide what fraction of our social output is even eligible. Everything else is
   detail by comparison.
2. **Where the master 9:16 files live** (DAM/MAM). If it's Brightcove, there's an
   off-the-shelf Storyteller collector and the path gets much shorter.
3. **Which surfaces we're actually shipping to** — and specifically, whether "app widget"
   means a module inside the Texans app or a home-screen widget. (Home-screen widgets
   cannot play video on iOS. Poster frame + deep link is the ceiling there.)

Full list in [doc 05](05-open-questions.md).

## Reading order

1. [01 — Storyteller teardown](01-storyteller-teardown.md) — what we'd be buying
2. [02 — Social ingestion constraints](02-social-ingestion-constraints.md) — **the doc that changes the project**
3. [03 — Distribution surfaces](03-distribution-surfaces.md) — app, web, widgets
4. [04 — Build vs buy + architecture](04-build-vs-buy-and-architecture.md) — the plan
5. [05 — Open questions](05-open-questions.md) — what I need
