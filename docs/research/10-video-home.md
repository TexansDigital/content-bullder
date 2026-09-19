# 10 — Where the feed's video actually comes from

**Decision taken:** YouTube for club video, Cloudinary for images.

That settles hosting. It leaves one thing unresolved, and it's a product question rather than a
technical one, so it's yours to call — I just want the trade-off visible before more gets built.

## The tension, stated once

YouTube's Required Minimum Functionality terms mean video from YouTube can only be played **in
YouTube's embedded iframe player**, un-overlaid and un-obscured. There is no file to fetch and
no way to render those frames in a player of ours.

So if YouTube is the only home for club video, our chrome — the collection tag, the caption, the
like button, the action button — **cannot sit on top of the video.** It has to sit beside or
below it. That's most of what makes the prototype feel like the thing you asked for.

This isn't a reason not to use YouTube. It's a reason to be deliberate about which of three
shapes we're building.

## The three shapes

### A. Browse is ours, playback is YouTube's
Cloudinary 4:5 tiles, our rail, our collections, our ordering, our design — tap a tile and the
YouTube player takes over the frame.

- ✅ Fully compliant, zero new storage, works with what exists today
- ✅ The rail (the part people see most) is entirely ours and looks like the prototype
- ❌ No seamless swipe between clips; each play is a discrete YouTube session
- ❌ YouTube's chrome, and ads if the channel is monetised

### B. YouTube iframes inside a swipe feed
Technically buildable via the IFrame Player API.

- ✅ Keeps the vertical swipe gesture
- ❌ Autoplay must be muted — fatal for clips where audio carries the piece
- ❌ No overlay chrome, so no action button or like over the video
- ❌ YouTube branding on every slide; possible pre-roll between clips
- ❌ Many live iframes is heavy on mid-range phones
- ❌ Any video with `status.embeddable: false` simply won't play

**Worst of both.** Recommend against.

### C. A feed-owned video store, with YouTube as distribution
The masters go to **both** places: Cloudinary (or another store) for the feed, YouTube for the
public channel. Same file, two destinations — which is the master-first workflow we already
need for other reasons.

- ✅ The full design: seamless 9:16 swipe, our chrome, our captions, our ads, our analytics
- ✅ YouTube keeps doing what it's good at — reach, search, the public watch page
- ❌ Needs somewhere to put video, which is exactly what `tools/hunt.sh` §2 checks

## Recommendation

**C if Cloudinary video turns out to be enabled on the NFL account** — the hunt script answers
that in one run, and if it's a yes there's no new vendor, no procurement, and nothing to buy.

**A as v1 if it isn't**, with C as the upgrade path. A is genuinely good: the rail is where fans
browse, it's the part that carries the brand, and it's entirely ours. Handing playback to
YouTube is a real constraint but not a broken product.

**Not B.**

Worth saying plainly: "YouTube for club video" and option C aren't in conflict. YouTube stays
the public distribution channel either way. The only question is what backs the in-app feed —
and an extra upload destination for the same master file is a small cost for the difference
between shape A and shape C.

## What decides it

`tools/hunt.sh` §2 — four requests against `/video/upload/` on the NFL Cloudinary. If any
returns 200, video is enabled and shape C is free. If all 404, it's shape A for v1 and we
revisit with a self-serve store (doc 07) when the feed has proved itself.

§4 of the same script also returns real titles, durations, view counts and **`embeddable`**
status for the ten Shorts — which replaces the placeholder copy in the prototype with the real
thing, and confirms whether shape A or B would even work for that content.
