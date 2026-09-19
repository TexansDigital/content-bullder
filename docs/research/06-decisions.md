# 06 — Decisions log

Answers from stakeholders, dated. These override anything in docs 01–05.

## 2026-09-19

**D1 — App platform is FanReach, not YinzCam.**
The Texans app runs on [FanReach](https://www.fanreach.io/), a sports app platform serving
NFL/NHL/NBA/CHL clients — not YinzCam as doc 03 originally assumed. **FanReach already has a
Storyteller SDK.** Doc 03 rewritten. The conclusion is unchanged and actually stronger: our
app vendor has a shipped Storyteller integration, so that path is short.

**D2 — Music/audio rights on owned platforms: cleared.**
Stakeholder decision: we can run TikTok / YouTube / other platform audio on our owned
platforms. Proceeding on that basis; the rights gate described in doc 02 §2 and doc 04 is
**descoped from blocking to advisory**.

Recorded so the assumption is visible later: platform commercial-music licenses (TikTok CML,
Instagram sounds) are written as platform-scoped, so this clearance presumably rests on
separate blanket licensing or on our only using owned/production-library audio. The pipeline
will still carry an `audioSource` field per item and surface it in the editorial view, so if
that ever needs revisiting it's a filter change, not a re-architecture. No approval gate.

> Still open and **not** covered by D2: NFL game-footage rights in a persistent,
> monetizable club-owned feed. That's a league question, not a music question.

**D3 — No master file store exists today.**
Content is uploaded directly into each platform's native CMS. No DAM, no MAM. Asana could
hold some assets but not the large ones. **We do have NFL Cloudinary.**
→ This is the biggest change to the plan. Cloudinary becomes the spine (see doc 04 rewrite):
it is simultaneously the missing master store, the transcoder, the captioner, the 9:16/4:5
reframer and the delivery CDN. It removes Mux / Cloudflare Stream / Bunny from the design
entirely.

**D4 — App integration approach is open.**
"We can embed a webpage on app or try to build an SDK." → Recommending **web-first**: one
codebase that renders in a FanReach webview *and* on houstontexans.com, with a native
Storyteller module as a later upgrade if the webview experience isn't good enough. Rationale
in doc 03 §4.

**D5 — Brand palette resolved, no longer an open question.**
The stated palette (`#021018` / `#ED0028` / `#0080C6` / `#FFFFFF`) is the current Texans
system to within a rounding error — Deep Steel `#021118`, Battle Red `#eb0028`, H-Town Blue
`#0080c6`, Liberty White `#ffffff`. We'll build against the Houston Texans design system
tokens (colors, Helvetica Neue LT Extended, logos, motion), which is already available to
this project. Dropping former question #13.

## 2026-09-19 (second round)

**D6 — Identifiers confirmed.**

| | Value | How |
| --- | --- | --- |
| Facebook Page ID | `51931216313` | Verified via Meta Ads API — the ID supplied was the **Page**, not Instagram |
| Instagram Business ID | `17841400218010511` | Supplied; 17-digit shape is correct for an IG Business account |
| Meta Business ID | `1138355532867254` | "Houston Texans" |
| Ad account (digital/social) | `943504639671091` | "HT Digital/Social" — the one to attribute feed media spend to |

> **Finding:** querying linked Instagram accounts through the Meta connection returned empty.
> Per Meta's own error semantics that means either no IG account is linked to that ad account
> for advertising, or **the app has not been granted `instagram_basic`** — which is the same
> permission our ingestion needs. Worth checking before we assume Graph API access works.

**D7 — Source access, actual state.**
- **YouTube: we have API access.** Data API v3 is the one platform where harvest is unblocked
  today. Still no file download — owner export from Studio (doc 02).
- **Instagram/TikTok: API access unconfirmed.** We own the accounts; the developer apps and
  grants are the open item.
- **RSS: confirmed available.** New input, and a useful one — see D8.

**D8 — RSS is a first-class source.**
FORGE exposes RSS. That gives us article and video metadata with no API negotiation, no App
Review and no quota. Use it for: the editorial join (which article does this clip belong to →
becomes the clip's action button), publish scheduling, and a same-day fallback when a platform
API is rate-limited or down. Added to the pipeline as source #3.

**D9 — Taxonomy is settled.** Five collections:
`gameday` · `players` · `series` · `community-and-foundation` · `girls-flag-and-youth-football`

**D10 — Fan identity is the Ticketmaster ID**, surfaced through FanReach. That's the key for
likes, follows and watch history. Web-only visitors get a device-scoped anonymous identity that
merges on sign-in.

**D11 — The FanReach webview bridge exposes deep links etc.** Webview-first build is viable
(doc 03 §1 path B).

**D12 — houstontexans.com is on Deltatre FORGE.** Confirmed. Iframe-embeddable build stands.

**D13 — No Storyteller account, and no current partner obligations — but we will sell.**
Two consequences:
1. Storyteller moves from "configure" to "procure." Since nothing is bought yet, the
   build-our-own-player option is genuinely open, and the hybrid (doc 04 §6) is now the
   cheapest path to something shippable.
2. **Sponsor attribution goes into the data model in Phase 1, not later.** No obligations today
   means no constraints today — which is exactly when it's free to build in. Per-sponsor
   impression and completion reporting is the expensive thing to retrofit.

**D14 — Analytics: Parse.ly.** Confirmed as the events destination.

## Open after this round

- Cloudinary credentials, and confirmation that AI video crop (`g_auto` on video), `sp_auto`
  ABR and auto-transcription are enabled on the plan.
- Whether the Meta app has `instagram_basic` (see D6 finding).
- A TikTok for Developers app, if TikTok is in scope for v1.
- **The actual video files.** Ten YouTube Shorts IDs were supplied, but this environment has no
  network route to YouTube — the footage has not been seen. Design work is proceeding on
  generated placeholder frames. Real posters need either Cloudinary access or the files.
- NFL game-footage rights in a persistent, monetizable club feed.

## 2026-09-19 (third round) — measured, not assumed

**D15 — Video home: YouTube for club video, Cloudinary for images.**
Raises a product question rather than a technical one, written up in
[doc 10](10-video-home.md): YouTube's terms mean its video plays only in YouTube's own iframe,
un-overlaid, so feed chrome can't sit on top of it. Three shapes follow; recommendation is a
feed-owned store with YouTube as distribution if Cloudinary video is available, otherwise
"browse ours, playback YouTube's" for v1.

**D16 — Strict Transformations is NOT blocking us. ✅ Measured.**

```
GET static.clubs.nfl.com/image/upload/w_200/texans/bodufcw8x4wotk4q7ses.jpg  →  HTTP/2 200
```

Raw transformation URLs deliver. No named-transformation registration needed, no console action,
no dependency on anyone else. `manifest.sample.json` now defaults to
`namedTransformations: false`. This resolves the ambiguity flagged in doc 09 §3 — "transformations
are on" meant available, not strict.

> Still unmeasured: whether **`g_auto`** specifically works. `w_200` is a plain resize; the AI
> content-aware crop is a separate capability and can be absent from a plan while simple
> transforms succeed. Test the real 4:5 crop before relying on it.

**D17 — The video 404 is INCONCLUSIVE, not a negative.**

```
GET static.clubs.nfl.com/video/upload/texans/bodufcw8x4wotk4q7ses.mp4  →  HTTP/2 404
```

That public ID is an **image**. A 404 for it under `/video/upload/` is the expected result
whether or not Cloudinary video is enabled — it tests nothing. Do not read this as "video is
unavailable."

Two ways to actually settle it:
1. **A real video public ID** from the Cloudinary Media Library. Definitive, takes a moment.
2. **The `X-Cld-Error` response header**, compared against a control request for a
   deliberately-missing image. Identical errors mean "asset not found"; a different error on the
   video path means the resource type itself is unavailable. Added to `tools/hunt.sh` as §2b.
