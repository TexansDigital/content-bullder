# 03 — Where this can actually be embedded

The brief says "embedded as an app widget or on web." Both of those are constrained by
platforms we do not control. Worth settling before any code gets written.

## 1. The Texans mobile app — we don't own the binary

The app is `com.yinzcam.nfl.texans`, built and maintained by **YinzCam**, who build for
~200 sports properties including most NFL clubs. Anything that ships inside the app ships
through YinzCam's release process, on YinzCam's timeline.

Three ways in, roughly in order of effort:

| Path | What it is | Effort |
| --- | --- | --- |
| **A. Native SDK module** | YinzCam drops a Storyteller (or our) native view into a screen / rail | Lowest — **YinzCam already maintains the official Storyteller Android sample integration under their own GitHub org** |
| **B. Webview module** | Our web feed rendered in an in-app webview, with a JS bridge for deep links and auth | Medium. Works, but autoplay/gesture handling in a webview is noticeably worse than native |
| **C. Data feed only** | We publish a JSON feed; YinzCam renders it with their own native components | Lowest for us, least control over the experience |

**Path A is the strong default**, precisely because the Storyteller/YinzCam integration
already exists. It also means a "build our own" decision costs us that head start —
factor that into doc 04.

Also worth knowing: the NFL has been moving toward a **single league-operated app platform
for all 32 clubs** [reported]. If that lands during this project's life, it resets the
integration path. Ask about timing before committing to a deep native integration.

## 2. houstontexans.com — Deltatre FORGE

Club sites and NFL.com run on **Deltatre's FORGE** platform, multi-tenant across all 32
clubs [reported — confirm with our web team]. That means:

- We probably **cannot** just paste a `<script>` tag into a page.
- We need either a FORGE-supported embed/widget module, an iframe, or a league-approved
  custom component.
- There may be a league review gate for new third-party JS on a club site.

**Action: confirm with whoever owns houstontexans.com what our actual embed options are.**
This single answer determines whether the web build is "ship a web component" (easy) or
"negotiate a platform module" (slow).

The good news: an **iframe-embeddable, self-contained feed** is the lowest-common-denominator
build that works on FORGE, in a YinzCam webview, on a microsite, and in an email-linked
landing page. If the answer is ambiguous, build the iframe-able version first.

## 3. "App widget" — what do we mean?

Two very different things, and one of them is a dead end:

### If it means "a module/rail inside the Texans app" → fine
That's section 1 above. This is what I'm assuming.

### If it means "an iOS/Android home-screen widget" → **video is not possible**
iOS **WidgetKit cannot play video.** Widgets render a static SwiftUI timeline under strict
refresh budgets and memory limits; video and real animation are explicitly out. Android App
Widgets are similarly constrained (RemoteViews — no video surface).

The most we could do on a home screen is: a poster frame of the latest clip + title, with a
deep link that opens the full feed in the app (`openClipByExternalId` style). That's a
genuinely nice retention feature, it's just **not** "stories on your home screen." Android
also allows a short looping GIF-ish treatment; iOS effectively doesn't.

If home-screen widgets are actually wanted, scope them as a *phase 2 deep-link surface*, not
as the player.

## 4. Recommended surface plan

1. **Core deliverable:** a self-contained, iframe-embeddable, themeable 9:16 feed + 4:5 tile
   rail. One codebase, works everywhere.
2. **Web:** embed via whatever FORGE allows; iframe if nothing better.
3. **App:** native module via YinzCam (Path A) if we go the Storyteller route; webview of
   #1 (Path B) if we build our own and need to move before YinzCam's next release train.
4. **Home screen:** poster + deep link only, phase 2.
5. **Bonus surface:** the same feed as a standalone shareable URL per clip — gives us
   SEO-indexable pages and something to put in a push notification or an email.
