# 04 — Architecture

> Rewritten 2026-09-19 per [doc 06, D2 / D3 / D4](06-decisions.md). Cloudinary replaces the
> Mux / Cloudflare Stream / Bunny comparison entirely.

## 1. The real problem to solve

The original blocker was rights. That's now cleared (D2). What's left is a **content supply
problem**, and it's the thing that will actually determine whether this product is good:

> **There is no master file store.** Video is cut and uploaded straight into each platform's
> native CMS. Once it's posted, the only copies live inside TikTok, Instagram and YouTube —
> and two of those three will never give the file back.

You cannot build a persistent, permanent, branded vertical feed on top of content you don't
retain. So the first thing this project ships isn't a player — it's **the master store that
should already exist.**

Good news: we already pay for the right tool.

## 2. Cloudinary is the spine

NFL Cloudinary gives us, in one system we already have:

| Need | Cloudinary capability |
| --- | --- |
| The missing master store | DAM with folders, tags, structured metadata, search |
| Large files | Chunked / resumable upload (`upload_large`); enterprise limits are negotiated, not fixed |
| Playback | Automatic **adaptive bitrate HLS** via `sp_auto` — builds the ladder, transcodes, segments, writes the `.m3u8` |
| **9:16 and 4:5 from one master** | AI content-aware crop: `c_fill,g_auto,ar_9:16` and `c_fill,g_auto,ar_4:5` — tracks the subject, so a 16:9 press-conference master reframes to vertical without decapitating anyone |
| Poster frames | Frame extraction at an arbitrary timestamp, same URL grammar |
| Captions | AI auto-transcription → subtitle/caption tracks |
| Delivery | Global CDN, already contracted |

**That AI reframe is the direct answer to "4x5 or 9x16."** We do not make editorial choose an
aspect ratio, and we do not ask them to export twice. One master goes in; the feed requests
`ar_9:16` for the player and `ar_4:5` for the tile, as URL parameters. Aspect ratio becomes a
rendering concern, not a production burden.

## 3. Architecture

```
  ┌──────────────────── SUPPLY ─────────────────────┐
  │                                                  │
  │  GOING FORWARD (the workflow fix):               │
  │    master 9:16 ──> CLOUDINARY ──> platforms      │   upload to Cloudinary FIRST,
  │                        │                         │   distribute outward second
  │                        ▼                         │
  │  BACKFILL (what already exists):                 │
  │    Instagram Graph API ──> media_url ──┐         │
  │    TikTok CMS  (owner download)  ──────┼──> CLOUDINARY
  │    YouTube Studio (owner download) ────┘         │
  │                                                  │
  └──────────────────────────────────────────────────┘
                              │
      ┌───────────────────────┴───────────────────────┐
      │                                                │
      ▼                                                ▼
 ┌─────────────────────┐                    ┌─────────────────────┐
 │  METADATA HARVEST   │                    │   CLOUDINARY        │
 │  IG / TikTok / YT   │                    │   master + HLS      │
 │  APIs               │                    │   + ar_9:16 / 4:5   │
 │  caption, permalink │                    │   + poster          │
 │  posted-at, METRICS │                    │   + captions        │
 └──────────┬──────────┘                    └──────────┬──────────┘
            │                                          │
            └───────────────┬──────────────────────────┘
                            ▼
                 ┌─────────────────────┐
                 │   CONTENT SERVICE   │   one ContentItem per clip:
                 │   normalize + join  │   our externalId, Cloudinary publicId,
                 │   rank by social    │   collection, CTA, social permalinks,
                 │   performance       │   audioSource, performance score
                 └──────────┬──────────┘
                            ▼
                 ┌─────────────────────┐
                 │  EDITORIAL (Asana)  │   card per item, approve / assign
                 │  approve + curate   │   collection, set CTA. Asana holds the
                 │                     │   CARD; Cloudinary holds the FILE.
                 └──────────┬──────────┘
                            ▼
        ┌───────────────────┴────────────────────┐
        ▼                                        ▼
  Storyteller Integrations API            Our own feed API (JSON)
  (rented experience)                     (drives our web player)
        │                                        │
   FanReach native                    iframe embed ──> houstontexans.com
   Storyteller module                              └─> FanReach webview
                                                   └─> share URLs / SEO pages
```

## 4. The two supply paths, concretely

**Going forward — fix it at the source.** The highest-leverage change in this whole project
is a workflow change, not code: **upload the master to Cloudinary before it goes to the
platforms.** One extra step for the person cutting the clip, and it permanently solves the
problem. Every downstream capability — the feed, the archive, reframing, captions, future
reuse — falls out of it for free. Everything else here is compensating for not having done
this.

**Backfill — what's already posted.**
- **Instagram:** Graph API gives us `media_url` for our own Business account. Fetch once,
  push straight into Cloudinary, never depend on the expiring URL again. Automatable.
- **TikTok:** the API will not return video. But **we own the account**, and TikTok lets the
  account owner download their own uploads. Semi-manual, or a one-time bulk export.
- **YouTube:** same — no API download, but YouTube Studio lets the channel owner download
  originals. One-time bulk export.

So: **metadata is automated across all three; media backfill is automated for Instagram and
a one-time human task for TikTok and YouTube.** After that, the workflow fix means it never
happens again.

## 5. Why Asana for editorial

It's already in the stack, the content team already lives there, and this session has Asana
access — so the editorial queue can be real Asana tasks rather than yet another tool nobody
logs into. Asana holds the **card** (approve, pick collection, write the CTA, flag a sponsor);
Cloudinary holds the **file**. That split sidesteps Asana's attachment size ceiling entirely,
which is the exact concern raised.

If Asana turns out to be too heavy for a 20-second decision, the fallback is a thin approval
view in our own web app. Start with Asana; it costs nothing to try.

## 6. What we still rent vs. build

| Layer | Decision |
| --- | --- |
| Master store, transcode, reframe, captions, CDN | **Cloudinary** (already paid for) |
| Editorial workflow | **Asana** (already paid for) |
| Ingestion, normalization, ranking, feed API | **Build.** This is ours; it's small and it's the differentiated part |
| Web player (9:16 + 4:5 rail) | **Build.** One codebase, Texans design system, iframe-embeddable |
| App rendering | **Rent** — FanReach's existing Storyteller module, fed via Storyteller's Integrations API. Or our webview. Both stay open |
| Polls, quizzes, VAST ads, SEO web stories | **Rent** — Storyteller, phase 3 |

Every item carries **our own `externalId`**. Storyteller's API supports
`openClipByExternalId` / `story/stories/externalId` lookups, so the rendering layer stays
swappable and we never lose the ability to walk away.

## 7. Phasing

- **Phase 0 — supply.** Cloudinary folder/tag/metadata schema, the "master first" workflow
  change, Instagram backfill worker, TikTok/YouTube one-time export. *Ships the thing that
  makes everything else possible.*
- **Phase 1 — harvest + feed.** Metadata workers for all three platforms, ContentItem model,
  performance-based ranking, JSON feed API, Asana editorial cards.
- **Phase 2 — experience.** The web feed: 9:16 player with directional preloading, 4:5 tile
  rail, captions, share, deep links. Texans design system. Iframe-embeddable → ships to
  houstontexans.com and the FanReach webview simultaneously.
- **Phase 3 — depth.** Storyteller Integrations push → FanReach native module; polls and
  quizzes; followable collections; sponsor attribution + VAST; SEO web-story pages;
  home-screen poster widget.
