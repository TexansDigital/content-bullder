# 05 — What I need from you

Grouped by whether it blocks me. I can start on the ingestion layer without any of the
"blocking" answers *except* #3 — but I'd be guessing at the shape of the output.

## Blocking — I can't finalize the architecture without these

**1. Where does this live, concretely?**
Pick all that apply: (a) a rail/section inside the YinzCam Texans app, (b) houstontexans.com,
(c) a standalone microsite, (d) an actual iOS/Android home-screen widget.
→ If (d): home-screen widgets **cannot play video** on iOS. Is a poster-frame + deep-link
treatment acceptable, or was the expectation live video there? (doc 03 §3)

**2. Buy Storyteller, build ours, or the hybrid?**
My recommendation is the hybrid in doc 04 §1C. Has anyone talked to Storyteller already —
is there a quote, a trial, or an existing relationship via YinzCam or another club?

**3. Rights sign-off — who, and what's the answer?**
Two specific questions I need answered by whoever owns this (NFL Digital? club legal?):
- **Music:** can we republish social clips that use TikTok CML / Instagram licensed audio
  onto our own app and site? (Default answer is no — the license is platform-scoped.) If no,
  we need a rule for which content is eligible, and it probably means "originals with owned
  or production-library audio only."
- **NFL footage:** can game highlights live in a *persistent, monetizable* club-owned
  vertical feed, or is that still league-reserved?

These two answers determine what percentage of our social output is even ingestible. If it's
15%, this is a different product than if it's 80%.

## Needed before I can build the ingestion layer

**4. Social account access.** For each platform, who can grant it:
- **Instagram:** the IG **Business/Creator** account ID, the linked Facebook Page, and which
  Business Manager / Meta app we should use. Who can approve permissions + App Review?
- **TikTok:** do we have a TikTok for Developers app? If not, who registers it, and who can
  authorize the @HoustonTexans account for `video.list`?
- **YouTube:** channel ID + a Google Cloud project with YouTube Data API v3 enabled.

**5. Where do the master 9:16 files live?**
This is the single most important technical question, because the masters — not the social
APIs — are the media source (doc 02 §3). Brightcove? Greenfly? Frame.io? Box? Adobe? A NAS?
→ **If we're on Brightcove, Storyteller already ships a Brightcove collector** and the
hybrid path gets dramatically shorter.
Also: is there a naming convention or metadata that lets me match "this TikTok post" back to
"this master file" automatically, or does that need an operator?

**6. Existing video infrastructure.** Do we already pay for Brightcove / JW Player / Mux /
Cloudflare Stream? I don't want to stand up a second video pipeline next to one we're
already buying.

**7. Website platform reality check.** Is houstontexans.com on Deltatre FORGE, and what can
we actually embed — arbitrary JS, a supported widget module, or iframe only? Who owns that
relationship? (doc 03 §2)

**8. YinzCam relationship.** Who's our contact, what's their release cadence, and is the NFL's
rumored single-app-platform consolidation going to land inside this project's window?

## Shapes the product

**9. Stories, Clips, or both?** Tap-through Stories with polls and quizzes is a different
build from a TikTok-style swipe feed. The brief reads as Clips-first ("like Instagram stories
but more permanent"), with Stories features as the "other features." Confirm?

**10. Scale.** App MAU, site monthly pageviews, and how many clips/week we'd publish. Drives
both the Storyteller tier and the CDN bill.

**11. Analytics destination.** I see Parse.ly connected here. Should engagement events land
in Parse.ly, GA4, Adobe, a warehouse, or the CDP? Is there a fan SSO we can key to, so likes
/ follows / watch history persist per fan?

**12. Monetization.** Do we want sponsored clips and VAST pre/mid-rolls in the feed? If yes,
which GAM account?

**13. Brand palette.** Your stated defaults are `#021018`, `#ED0028`, `#0080C6`, `#FFFFFF` —
I'll theme to those. Flagging only because those aren't the club's Deep Steel Blue / Battle
Red, so tell me if this feed should use standard Texans colors instead.

**14. Timeline.** Is there a season milestone this needs to hit?

## What I'd do while waiting

If you give me nothing but #3 and #5, I'll start on **Phase 0**: the ingestion workers,
normalized content model, rights gate and editorial worklist. That's useful on its own and
it's the part that survives any buy/build decision.
