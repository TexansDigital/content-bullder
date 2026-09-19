# Verification

Browser-driven checks for the defects found in the September 2026 audits, plus the
behaviours those audits would not have caught. Each assertion reproduces a specific
reported failure, so a regression here names the thing that broke.

Needs a running server and playwright:

```sh
node server.mjs
```

```sh
npm --prefix /tmp i playwright@1.48.0
```

```sh
cd /tmp && node /path/to/test/verify-fixes.mjs
```

```sh
cd /tmp && node /path/to/test/verify-feed.mjs
```

```sh
cd /tmp && node /path/to/test/verify-clip.mjs
```

```sh
cd /tmp && node /path/to/test/verify-playback-clip.mjs
```

| Suite | Covers | Assertions |
| --- | --- | --- |
| `verify-fixes.mjs` | the store, the API and the studio | 26 |
| `verify-feed.mjs` | the embedded feed | 12 |
| `verify-clip.mjs` | Cloudinary clipping, cut in the delivery URL | 13 |
| `verify-playback-clip.mjs` | clipping an uploaded file, enforced by the player | 20 |

The first three expect an empty store — delete `content/store.json` between runs.
`verify-playback-clip.mjs` clears the store itself, because it asserts on feed order
and on which slides carry a range, and a leftover card changes both answers.

It also checks a decoded frame rather than only `video.currentTime`: see
[`fixtures/README.md`](fixtures/README.md) for how the fixture encodes its own
timestamp as colour. That is not belt and braces: the first run of this suite failed
exactly there. The server was not serving byte ranges, so the browser had marked the
media non-seekable and was dropping every `currentTime` assignment.
