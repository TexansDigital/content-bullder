# 09 — What the real Cloudinary URL tells us

Working from the one real asset supplied:

```
https://static.clubs.nfl.com/image/upload/v1789685159/texans/bodufcw8x4wotk4q7ses.jpg
                                  ^^^^^                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                  image, not video     public ID
```

## 1. It's a Cloudinary private CDN, not the shared one

There is **no cloud name in the path**. `static.clubs.nfl.com` is a custom delivery domain
mapped to a Cloudinary account (URL grammar is unmistakably Cloudinary's, and other clubs use
the identical shape — `.../image/upload/buccaneers/…`, `.../image/upload/titans/…`). DNS points
at Fastly, which is the edge in front of it.

**Consequence:** URLs are `https://static.clubs.nfl.com/<type>/upload/…`, not
`https://res.cloudinary.com/<cloud>/<type>/upload/…`. `src/cloudinary.js` now takes a `baseUrl`
and supports both shapes, and `originOf()` infers it from any pasted URL so editorial never has
to state it. Verified against the real URL above.

## 2. The thing that actually matters: this is the *image* DAM

The asset is under `/image/upload/`, and the video that was sent alongside it isn't a Cloudinary
URL at all — it's a **houstontexans.com FORGE video page**.

That is a significant, plan-changing possibility: **the NFL Cloudinary may be the image CDN for
club sites, with club video living in the FORGE video platform instead.** Every version of the
architecture so far assumed Cloudinary was the video store.

If video isn't in Cloudinary, three options, in order of preference:

1. **Cloudinary video is enabled on the account and simply unused for club video.** Then nothing
   changes — we upload masters into `texans/feed/` and the design stands as written.
2. **Cloudinary is images-only.** Then we need a video home. Either the NFL's existing OVP
   (if it exposes retrievable renditions and an addressable API), or a separate self-serve
   store (doc 07) with Cloudinary still doing the 4:5 tile stills from extracted frames.
3. **FORGE video is retrievable.** Worth checking whether FORGE exposes an HLS manifest per
   video that we're permitted to play in our own player. That would make FORGE the master store
   and skip the upload problem entirely.

**This is now the highest-value unknown in the project.** It determines where masters go, which
is the one dependency with no workaround (doc 07 §6).

## 3. Strict Transformations: ambiguous, and it matters

The answer given — *"yes transformations are on"* — could mean either:

- **Strict Transformations is ON** → arbitrary transformation URLs return 404, and the four
  `tx_feed_*` named transformations must be registered in the console before anything works; or
- **transformations are available/enabled** → we can build URLs freely.

These are opposite instructions for the build, so it's worth resolving rather than guessing.
The manifest currently defaults to `namedTransformations: true`, which is the safe assumption:
if raw transforms turn out to work, flipping it to `false` costs nothing.

## 4. How to resolve all of it in about thirty seconds

I can't reach `static.clubs.nfl.com` from this environment — every request is blocked by the
egress proxy. **Your browser can.**

[`tools/cloudinary-probe.html`](../../tools/cloudinary-probe.html) — open it locally. It runs
eight plain GETs against public URLs (no uploads, no credentials, nothing written) and reports:

| It answers | By testing |
| --- | --- |
| Is Strict Transformations on? | raw `w_200` and the real 4:5 crop against the known image |
| Is `g_auto` (AI crop) available? | simple transform vs. `g_auto` transform |
| Are `tx_feed_*` registered yet? | the named transformation |
| **Does video exist on this host?** | `/video/upload/` in three forms |

It prints a verdict in plain language and a copy-paste report. Paste that back and I'll set the
manifest correctly and wire the prototype to real media in one pass.

## 5. What to send with it

- A **video** public ID from Cloudinary, if one exists. That single fact resolves §2.
- If there isn't one: how the video at
  `houstontexans.com/video/houston-texans-coordinators-address-the-media-full-q-a` is stored and
  served — platform name, whether an HLS manifest is addressable, whether we're allowed to play
  it outside FORGE's own player.

> Incidental but useful: that coordinators Q&A is a **16:9 press conference**. It's the exact
> case where `g_auto` reframing earns its keep — a centre-crop to 9:16 would cut the speaker in
> half. If the probe says `g_auto` is unavailable, this content type is the one that suffers,
> and per-clip focal points stop being a nicety.
