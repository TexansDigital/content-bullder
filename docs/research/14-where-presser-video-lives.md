# 14 — Where presser video actually lives

Extracted from the `video-config` blob on the coordinators Q&A page.

## 1. Correction: it is not Mux

I flagged two `mux` hits as "a strong hint." **They were false positives** — both sit inside
base64 blobs on the page, where `mux` occurs by chance:

```
…h5yDSumMlBOlA5f8SqlQ20EeysRTRRD48PkCQ3Bp12yCKireIOUVv4YbQSnZLkuWi9fOcBiL39OsDBLXobcD2+jUS…
```

No `stream.mux.com`, no `image.mux.com`, no playback ID. Mux is not involved. A substring count
was the wrong instrument; the config blob was the right one.

## 2. It's the NFL's Media Content Platform

```json
{
  "id":        "c6440fcf-0928-40b5-8ee6-8ebea1242167",   // FORGE entity
  "entityId":  "c6440fcf-0928-40b5-8ee6-8ebea1242167",
  "slug":      "houston-texans-coordinators-address-the-media-full-q-a",
  "mcpID":     "2655937",                                 // <- the video
  "videoSource": "texans",
  "posterImage": "https://static.clubs.nfl.com/image/upload/t_editorial_landscape_12_desktop/texans/bodufcw8x4wotk4q7ses"
}
```

`mcpID` is the NFL's **Media Content Platform** identifier. `vid: "2655937"` in the ad config
matches. The poster comes from Cloudinary; the video does not.

**No playback URL appears anywhere in the HTML** — no `.m3u8`, no `.mp4`. The player resolves
`mcpID` → manifest at runtime against a league API.

## 3. What that means

Cloudinary is confirmed **images only** for club sites. Presser video is on a **league-operated
platform**, which makes programmatic access to renditions a league integration question rather
than a switch we can flip. Assume slow, and don't put the project's critical path through it.

So the master-first idea comes back — **but with a much better justification than before.**

Every presser is *already* being published to two places: FORGE/MCP (which produces the
houstontexans.com page) and YouTube (`I3bnUJtX_js` is this same Q&A). Whoever does that is
already exporting a file and uploading it twice.

**The ask is a third destination on an existing publish step, not a new habit for anyone.** That
is a materially easier thing to request than "start keeping masters," which is how this was
framed in every earlier doc.

## 4. Two useful things that fell out of the same blob

**Google Ad Manager is already wired up.**

```
"iu": "/4595/team.hou/video",  "ciuSzs": "970x90,728x90,320x50,1x1",  "frequency": 3
```

Network `4595`, ad unit `team.hou/video`, preroll every 3 videos. When the feed needs VAST for
sponsored slots ([doc 06 D13](06-decisions.md)) the account and unit structure already exist —
that's one fewer thing to stand up, and it tells us what an in-feed unit should look like to
match how video is already sold.

**Video analytics go to Adobe, not Parse.ly.**

```
"reportSuite": "nflclubstexans",  "siteName": "texans",  "siteSection": "video"
```

Parse.ly was named as the events destination ([D14](06-decisions.md)), but club video currently
reports to Adobe Analytics. Worth resolving deliberately — if video engagement is benchmarked in
Adobe today, feed events landing only in Parse.ly will not be comparable to anything.

## 5. The one step left

The playback manifest is fetched at runtime, so it isn't in the HTML. Chrome DevTools finds it
in about thirty seconds:

1. Open the presser page, **F12 → Network**, filter **Media** (or type `m3u8`)
2. Press play
3. The first `.m3u8` request is the manifest — right-click → Copy → Copy link address

What the URL's host tells us:

| Host pattern | Meaning |
| --- | --- |
| `*.akamaized.net` / `*.nfl.com` | League CDN. Access is an NFL integration conversation |
| A signed URL with an expiry token | Not linkable; needs the resolver API |
| Anything openly addressable | We can at least reference it while the upload path is arranged |

Either way this is now a known quantity rather than a blocker: **the fallback is the third
upload destination in §3, which needs nothing from the league.**
