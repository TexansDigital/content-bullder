# 03 — Where this can actually be embedded

> Revised 2026-09-19 per [doc 06, D1 & D4](06-decisions.md).

## 1. The Texans mobile app — FanReach

The app runs on **[FanReach](https://www.fanreach.io/)**, a sports app platform serving NFL,
NHL, NBA, CHL and venue clients. **FanReach already has a Storyteller SDK**, which removes
the largest integration unknown.

Three ways in:

| Path | What it is | Effort | Experience |
| --- | --- | --- | --- |
| **A. Native Storyteller module** | FanReach drops their existing Storyteller integration into a screen/rail; we feed it content | Low — the integration exists | Best. Native gestures, native video, no webview tax |
| **B. Webview module** | Our web feed in an in-app webview with a JS bridge for deep links + fan identity | Low-medium, and **we control the release cadence** | Good, not native. Autoplay and swipe-gesture handling in a webview are the weak points |
| **C. Data feed only** | We publish JSON; FanReach renders it natively themselves | Lowest for us | Least control |

**Recommendation: build B, keep A as the upgrade.** Reason: path B is one codebase that also
serves the website, and it ships on *our* schedule rather than FanReach's release train. If
the webview feel isn't good enough on real devices, we swap to A — and because we'd already
be publishing into Storyteller (doc 04), path A becomes a configuration change on FanReach's
side, not a rebuild.

The one thing that makes B genuinely good rather than merely acceptable is the **JS bridge**:
we need FanReach to expose (a) deep links out of the feed into other app screens, (b) the fan
identity token so likes/follows persist, (c) the native share sheet, and (d) safe-area insets
so the 9:16 player goes truly full-bleed. Ask FanReach for these four things up front — a
webview without them feels like a bolted-on browser tab, which is exactly the failure mode.

## 2. houstontexans.com

Club sites and NFL.com run on Deltatre's FORGE multi-tenant platform [reported — **confirm
with our web team**]. That likely means no arbitrary `<script>` tags; we'd need a supported
embed module, an iframe, or league approval for a custom component.

This is why the core deliverable should be a **self-contained, iframe-embeddable feed**. That
one artifact works on FORGE, inside a FanReach webview, on a standalone microsite, and behind
a push notification or email link. If the FORGE answer turns out to be permissive, great —
we upgrade to a proper web component later.

## 3. "App widget" — clarifying

If this meant *a module inside the Texans app*, that's §1 and it's straightforward.

If it meant *an iOS/Android home-screen widget*: **video is not possible.** iOS WidgetKit
renders a static SwiftUI timeline under strict refresh and memory budgets — no video surface.
Android App Widgets (RemoteViews) are similarly limited. The ceiling is a poster frame of the
latest clip plus a deep link that opens the full feed in the app. That's a genuinely good
retention surface, just not "stories on your home screen." Scope it as phase 3.

## 4. Surface plan

1. **Core:** one self-contained, themeable, iframe-embeddable feed — 9:16 full-screen player
   + 4:5 tile rail. Built on the Houston Texans design system.
2. **Web:** embed on houstontexans.com via whatever FORGE allows; iframe as the floor.
3. **App:** FanReach webview of #1, with the four bridge capabilities above. Upgrade to the
   native Storyteller module if/when the experience demands it.
4. **Share:** a standalone public URL per clip — gives us SEO-indexable pages, something to
   put in a push, and a real share target.
5. **Home screen:** poster + deep link, phase 3.
