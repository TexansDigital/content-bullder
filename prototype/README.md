# Feed prototype

`feed-prototype.html` — single file, no build step. Open it in a browser.

Three views: the 9:16 in-app player, the 4:5 web rail as it would sit on houstontexans.com,
and the pipeline spec. Houston Texans design system (Deep Steel / Battle Red,
HelveticaNeueLT Extended, Azeret Mono), fonts and bullhead embedded as data URIs so it runs
offline.

## Pointing it at real content

Copy `../content/manifest.sample.json` to `../content/manifest.json`, set `cloud` to the real
cloud name, and paste a Cloudinary delivery URL or bare public ID into each clip's `media`.
The page picks it up automatically and plays real video — 9:16 in the player, 4:5 in the rail,
both derived from one master. No credentials involved; see
[`docs/research/08-cloudinary-url-only.md`](../docs/research/08-cloudinary-url-only.md).

If the account has Strict Transformations enabled, set `"namedTransformations": true` and have
the four named transformations registered in the console first.

Serve over http rather than `file://` so the manifest fetch isn't blocked:

```sh
python3 -m http.server -d . 8000   # then open http://localhost:8000/prototype/feed-prototype.html
```

With no manifest, it falls back to generated on-brand frames and placeholder copy.

## Real vs placeholder

**Real:** the five collections, the interaction model (scroll-snap, keyboard, like, captions,
action button, sponsor slot), both aspect ratios from one source, the Cloudinary URL grammar,
the manifest contract.

**Placeholder until a manifest lands:** frames and copy. This environment has no network route
to YouTube, so the supplied Shorts have not been seen.

## The published artifact

https://claude.ai/artifact/Bt5toC1ZavsUHrgcP3g9sU — design reference only. Its sandbox CSP
blocks `res.cloudinary.com`, so that copy always renders the placeholder frames. This file is
the functional one.
