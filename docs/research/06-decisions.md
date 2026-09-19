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
