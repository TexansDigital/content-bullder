# 07 — What we build if the credentials never land

The governing fact: **every credential on the list buys automation, not capability.** Each one
replaces a human action. None of them is load-bearing for the fan experience. A feed built with
zero new credentials looks identical to a fan — it just has a person in the pipeline.

Plan for that from the start rather than treating it as a degraded mode, because the manual path
is also the fastest path to something real, and procurement is slower than engineering.

## 1. Credential-by-credential

| Credential | What it automates | Substitute if denied | Real cost of the substitute |
| --- | --- | --- | --- |
| **NFL Cloudinary** | Storage, ABR, AI reframe, captions, CDN | Self-serve **Bunny Stream** (~$1/mo minimum, pay-as-you-go, HLS + API included) or Cloudflare Stream | Loses AI reframe and auto-captions — see §3. Everything else is equivalent |
| **Meta `instagram_basic`** | IG caption, permalink, metrics | Operator pastes the permalink; caption is retyped or lifted from RSS | Minutes per week |
| **TikTok dev app** | TikTok metadata | **Drop TikTok from v1** | ≈ Zero — see §2 |
| **YouTube Data API** | Clip discovery, titles, view counts | — | ✅ Already have it |
| **FORGE RSS** | Article join, publish schedule | — | ✅ Already have it |

## 2. TikTok was never worth much here

Worth saying plainly because it removes a whole procurement thread: the TikTok Display API
**never returns the video file**, and its metadata is thin — id, title, description, duration, an
expiring cover image, and an embed link. The one genuinely useful thing it offers is a
performance signal for ranking.

So "no TikTok API" costs us a ranking input and an outbound link we can hand-enter. It does not
cost us a single frame of video, because it was never going to give us one. **Cut it from v1
without hesitation** and revisit only if cross-platform ranking proves it earns the integration.

## 3. What we actually lose without Cloudinary

Be honest about this — it's the only credential whose absence changes the build.

**Lost: AI content-aware reframe (9:16 → 4:5).**
Substitute: a **focal-point field** on each clip. The operator clicks the subject once in the
editorial view; we store normalized x/y and render the tile with `object-fit: cover` +
`object-position`. Roughly five seconds per clip, and for the 4:5 *tile* — a small, cropped
thumbnail — it lands close to as good as the AI crop. The AI version matters far more for
reframing 16:9 masters to full-screen 9:16, which is a different and rarer job.

**Lost: auto-transcription / captions.**
Three substitutes, in order of preference:
1. Most social edits already carry **burned-in captions** — check the real content before
   assuming a caption track is even needed for v1.
2. Open-source Whisper-class transcription on a cheap worker, producing the same `.vtt`.
3. Manual VTT for hero clips only.
   Flag as an accessibility item either way: shipping with no caption path at all is a
   regression we should take deliberately, not by accident.

**Not lost: adaptive-bitrate HLS.** Bunny Stream and Cloudflare Stream both do it. No change.

**Note:** a self-serve *free* Cloudinary account is not a workaround — the free tier excludes
video transformations, which is the entire reason we wanted Cloudinary. It's the NFL enterprise
account or a different vendor; there's no cheap middle.

## 4. The architectural response: credentials are config

Build both sides as adapters behind one interface, with the manual implementation as the default
rather than the fallback. Then a credential arriving is a config change, and a credential never
arriving is a shrug.

```
SourceAdapter    → youtube | rss | instagram | tiktok | manual-csv
MediaStore       → cloudinary | bunny | r2 | local-folder
Deriver          → cloudinary-transform | focal-point-css
Transcriber      → cloudinary | whisper | none
```

The feed API, the player and the editorial view never learn which one is active. This is cheap to
do up front and expensive to retrofit, so do it in Phase 1 regardless of how the credential
conversations go.

## 5. The Tier 0 pilot — zero new credentials

Everything here uses access we already have, plus at most a ~$1–20/month self-serve video account.

1. **A shared folder** (Box / Drive / SharePoint — whatever exists) where editorial drops the 9:16
   master. This *is* the "master first" workflow change; the destination is a detail.
2. **A manifest** — a CSV or JSON in this repo listing clip, collection, headline, action button,
   focal point, source permalink. Hand-maintained at pilot scale, later generated.
3. **Bunny Stream** (or Cloudflare Stream) for HLS + poster. Self-serve, pay-as-you-go.
4. **The feed we already built**, reading the manifest instead of placeholder data.
5. **Embed** on one houstontexans.com page and in the FanReach webview.

That is a real, shippable, fan-facing product. The YouTube API and RSS then layer on top to
self-populate the worklist and the action buttons — both already available.

> **Check first:** whether a self-serve vendor account on a corporate card is acceptable under our
> procurement and security policy. It's usually faster than a formal vendor onboarding, but that's
> a call for whoever owns vendor governance, not an assumption to make quietly.

## 6. The one thing with no workaround

**Somebody has to save the master file before it goes to the platforms.**

Every technical fallback above exists. This one doesn't. If no master is retained anywhere, there
is no persistent feed — TikTok and YouTube will not give the file back, and Instagram's copy is a
re-encode behind an expiring URL. It costs one person one extra save per clip.

That's not a credentials problem and no vendor solves it. It's the single dependency worth
spending political capital on.

Also still open, and also not solvable technically: **NFL game-footage rights** in a persistent,
monetizable club feed. If that answer is no, the content mix changes and gameday becomes the
thinnest collection rather than the biggest.
