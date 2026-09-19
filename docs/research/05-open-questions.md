# 05 — What's still needed

> Revised 2026-09-19. Questions 1, 2, 3 (music), 5, 13 are answered — see
> [doc 06](06-decisions.md). What remains is below.

## A. Blocks Phase 0 (the master store)

**A1 — Cloudinary access.** Cloud name, an API key/secret pair (or a scoped sub-account), and
the answer to: is this NFL-shared and multi-tenant across clubs, or ours? That decides folder
namespacing and whether we can turn on the add-ons we need.
→ Specifically confirm these are enabled on the plan: **AI content-aware video crop**
(`g_auto` on video), **`sp_auto` adaptive bitrate streaming**, and **auto-transcription /
captions**. Two of the three are add-ons on some tiers.

**A2 — Social API access.**
- Instagram: the **Business/Creator** account ID, its linked Facebook Page, which Business
  Manager / Meta app to use, and who can approve permissions.
- TikTok: do we have a TikTok for Developers app? If not, who registers it and who authorizes
  @HoustonTexans for `video.list`?
- YouTube: channel ID plus a Google Cloud project with YouTube Data API v3 enabled.

**A3 — Who owns the "master to Cloudinary first" workflow change?** This is a people question,
not a technical one, and it's the single highest-leverage item in the project (doc 04 §4).
Whose process changes, and who tells them?

## B. Blocks a genuinely good UX

**B1 — Real content. This is the most valuable thing you can give me.**
15–25 actual clips, or just their Instagram/TikTok URLs, spanning the real range: hype edit,
gameday, presser, locker room, Toro, community, player feature, sponsored. I want to design
against what we actually publish — clip lengths, how much burned-in text there is, whether
audio carries the piece, how often it's 16:9 source needing a reframe. Designing a vertical
feed against placeholder content produces a demo, not a product.

**B2 — The taxonomy.** How should a fan slice this? Players, gameday, behind-the-scenes,
community, specific recurring series by name. These become the collections and the followable
categories, and getting them right is most of the difference between a feed people return to
and a dumping ground.

**B3 — Fan identity.** Is there an account/SSO in the FanReach app we can key to? Without it,
likes, follows and watch history don't persist across sessions or devices — which caps how
good this can get. If SSO exists, what's the token shape we'd get over the webview bridge?

**B4 — FanReach contact, and four specific asks.** Who's our contact, and can they confirm
the webview bridge exposes: (1) deep links into other app screens, (2) the fan identity
token, (3) the native share sheet, (4) safe-area insets for true full-bleed? Also: what
exactly does their Storyteller SDK integration expose — the full Storyteller SDK, or their
own wrapper? And their release cadence.

**B5 — Storyteller account status.** Do we already have one (via FanReach, or the NFL)? Or is
this a new purchase? Changes phase 3 from "configure" to "procure."

**B6 — houstontexans.com embed reality.** Is it Deltatre FORGE, and what can we embed —
arbitrary JS, a supported widget module, or iframe only? Who owns that relationship?

**B7 — App UI reference.** Screenshots or a build of the current Texans app, so the feed reads
as a native part of it rather than a bolted-on web page. Same for the relevant
houstontexans.com page templates.

## C. Shapes scope, not blocking

**C1 — Editorial reality.** Who publishes, how many clips/week, and what's the expected
turnaround on gameday? A 3-click tool and a 10-click tool are different builds.

**C2 — Sponsorship.** Are any of these clips sponsor-attached, and is anyone owed impressions
or reporting? If yes, sponsor attribution goes in the data model in Phase 1 — retrofitting it
later is painful.

**C3 — Analytics destination.** Parse.ly is connected to this project. Confirm that's where
engagement events should land, or name the alternative (GA4, Adobe, warehouse, CDP).

**C4 — Scale.** App MAU and site monthly pageviews. Drives Cloudinary delivery budget and any
Storyteller tier.

**C5 — NFL game-footage rights.** Not covered by the music clearance. Can league game footage
live in a persistent, monetizable club-owned feed? Needs a read from NFL Digital / legal.

**C6 — Timeline.** Any season or campaign milestone this needs to hit?

## Already covered — no need to send

The **Houston Texans design system** is available to this project: Deep Steel / Battle Red /
H-Town Blue tokens, licensed Helvetica Neue LT Extended weights, bullhead and wordmark logos,
background plates, motion tokens and UI component source. No brand assets needed.
