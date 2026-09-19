# 00 — Executive summary

> Updated 2026-09-19 with stakeholder answers. See [doc 06 — Decisions](06-decisions.md).

## Where this landed

Two of the three original blockers are gone, and the remaining one turned out to be the
interesting one.

**Rights: cleared.** We can run platform audio on our owned properties (D2). The audio-rights
gate is descoped. NFL *game-footage* rights remain a separate, still-open league question.

**App integration: short path.** The Texans app runs on **FanReach**, not YinzCam as first
assumed — and **FanReach already has a Storyteller SDK** (D1). We can also embed a webpage.
Both doors are open.

**The real problem is content supply.** There is no master file store (D3). Clips are cut and
uploaded straight into each platform's native CMS, and two of those three platforms — TikTok
and YouTube — will never return the video file through an API. You cannot build a permanent
branded feed on content you don't retain.

**So the first thing this ships isn't a player. It's the master store that should already
exist.** And we already pay for the right tool.

## Cloudinary is the unlock

NFL Cloudinary does, in one system we already have, everything this project needs below the
player:

- the **missing master store** (DAM, folders, tags, metadata, resumable large-file upload)
- **adaptive-bitrate HLS**, generated automatically (`sp_auto`)
- **AI content-aware reframing** — `c_fill,g_auto,ar_9:16` for the player and
  `c_fill,g_auto,ar_4:5` for the tile, from **one master**, subject-tracked
- **auto-captions** from AI transcription
- **poster frames** and global CDN delivery

That reframing capability is the direct answer to "4x5 or 9x16": editorial never chooses and
never exports twice. One master in; aspect ratio becomes a URL parameter at render time.

Cloudinary removes Mux / Cloudflare Stream / Bunny from the design entirely, and most of the
projected infrastructure cost with them.

## The highest-leverage change is a workflow change

**Upload the master to Cloudinary before it goes to the platforms.** One extra step for
whoever cuts the clip; it permanently solves the supply problem, and the feed, the archive,
reframing, captions and all future reuse fall out of it for free. Everything else in this
plan is compensating for not having done that.

For what's already posted: Instagram media can be pulled via Graph API and pushed into
Cloudinary automatically. TikTok and YouTube need a **one-time owner export** from their
native CMSes — the APIs won't do it, but we own the accounts, and it only has to happen once.

## The plan

| Phase | What ships |
| --- | --- |
| **0 — Supply** | Cloudinary schema, the master-first workflow change, Instagram backfill worker, TikTok/YouTube one-time export |
| **1 — Harvest + feed** | Metadata workers (IG/TikTok/YT), normalized content model, performance-based ranking, JSON feed API, Asana editorial cards |
| **2 — Experience** | The 9:16 player + 4:5 rail, iframe-embeddable, on the Texans design system → ships to houstontexans.com *and* the FanReach webview from one codebase |
| **3 — Depth** | Storyteller push → FanReach native module; polls, quizzes, followable collections; sponsor attribution + VAST; SEO web-story pages; home-screen poster widget |

Architecture detail in [doc 04](04-build-vs-buy-and-architecture.md).

## What's needed next

**To start Phase 0:** Cloudinary credentials (and confirmation that AI video crop, `sp_auto`
and auto-captions are enabled on the plan), social API access for the three platforms, and a
decision on who owns the master-first workflow change.

**To make the UX genuinely good:** 15–25 *real* clips to design against, the content taxonomy,
whether fan SSO exists, and a FanReach contact who can confirm four webview bridge
capabilities. Full list in [doc 05](05-open-questions.md).

Brand assets are already covered — the Houston Texans design system (tokens, licensed type,
logos, motion, components) is available to this project.

## Reading order

1. [06 — Decisions](06-decisions.md) — what's been settled
2. [04 — Architecture](04-build-vs-buy-and-architecture.md) — the plan
3. [02 — Social ingestion constraints](02-social-ingestion-constraints.md) — why the pipeline is inverted
4. [03 — Distribution surfaces](03-distribution-surfaces.md) — FanReach, web, widgets
5. [01 — Storyteller teardown](01-storyteller-teardown.md) — what we'd be renting
6. [05 — What's still needed](05-open-questions.md)
