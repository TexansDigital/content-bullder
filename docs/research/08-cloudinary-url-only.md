# 08 — Cloudinary with URLs only

> **This supersedes most of [doc 07](07-no-credentials-path.md).** Delivery URLs are not a
> consolation prize — they are close to the whole design. Cloudinary's transformation API is
> *URL-based*, so deriving variants needs no key, no secret and no SDK.

## 1. What a bare delivery URL already gives us

Given only a **cloud name** and a **public ID**, we construct every output the feed needs:

| Output | URL |
| --- | --- |
| 9:16 ABR HLS | `…/video/upload/f_auto,q_auto,c_fill,g_auto,ar_9:16/sp_auto/<id>.m3u8` |
| 9:16 poster | `…/video/upload/so_1.5,f_auto,q_auto,c_fill,g_auto,ar_9:16,w_720/<id>.jpg` |
| 4:5 tile | `…/video/upload/so_1.5,f_auto,q_auto,c_fill,g_auto,ar_4:5,w_400/<id>.jpg` |
| Caption track | `…/raw/upload/<id>.transcript.vtt` *(if transcription ran at upload)* |

**The AI content-aware reframe (`g_auto`) is in there.** So is adaptive-bitrate streaming. Both
of the things doc 07 wrote off as lost to a no-credentials build are back — the focal-point
fallback and the Whisper worker are no longer needed.

Implementation is already in the repo: [`src/cloudinary.js`](../../src/cloudinary.js). Pure
functions, zero dependencies, no network calls at build time.

## 2. Three things to check, and they're all small

### a. Is Strict Transformations on?

Enterprise accounts usually have it. When on, arbitrary transformation URLs return **404** —
only signed, eagerly-generated, or explicitly *allowed* transformations deliver.

**The fix is a one-time console action by whoever administers the account, and shares nothing.**
Ask them to register these four as allowed named transformations:

| Name | Transformation |
| --- | --- |
| `tx_feed_player` | `f_auto,q_auto,c_fill,g_auto,ar_9:16/sp_auto` |
| `tx_feed_poster` | `so_1.5,f_auto,q_auto,c_fill,g_auto,ar_9:16,w_720` |
| `tx_feed_tile` | `so_1.5,f_auto,q_auto,c_fill,g_auto,ar_4:5,w_400` |
| `tx_feed_tile_2x` | `so_1.5,f_auto,q_auto,c_fill,g_auto,ar_4:5,w_800` |

Then we set `namedTransformations: true` in the manifest and the builder emits `t_tx_feed_player`
instead of the raw string. Nothing else changes.

> Cloudinary treats parameter *order* as significant — `w_300,c_scale` is a different
> transformation from `c_scale,w_300`. Register these exactly as written; `src/cloudinary.js`
> emits them in this order.

### b. `sp_auto` is lazy

The first request for an HLS manifest triggers transcoding; segments can buffer for 10–30
seconds while it completes. Two fixes, either is fine:

- **Prewarm** — our publish step issues one plain `GET` against the `.m3u8`. No credentials.
  Already implemented as `builder().prewarm(id)`.
- **Eager** — the upload preset generates the HLS ladder at upload time. Better, and free if
  we're setting up a preset anyway (see below).

### c. Are the assets public?

The URL approach works for `upload` delivery type. Assets stored as `authenticated` or `private`
need signed URLs, which *does* require the API secret. Worth confirming which type the feed
folder uses before building on it.

## 3. The upload side — still solvable without secrets

Getting masters *in* is the remaining gap, and Cloudinary has a designed answer:
**unsigned upload presets.** A preset is a named bundle of upload settings stored on Cloudinary's
side; uploading against it needs only the **cloud name and preset name** — the API secret never
leaves their account.

Ask their admin to create one preset, restricted:

- `folder` → `texans/feed` (writes can't escape it)
- `allowed_formats` → `mp4,mov`
- `max_file_size` → whatever suits masters
- `disallow_public_id` → true
- `eager` → the four transformations above, so nothing is lazy
- *worth asking:* whether the preset can also trigger the transcription add-on, which would give
  us caption tracks with no API access at all. **Unverified — treat as a question for them, not
  an assumption.**

With that, we can put a real uploader in the editorial tool and the master-first workflow change
becomes a drag-and-drop instead of a trip to the Media Library. If they'd rather not create a
preset, the fallback is unchanged and fine: editorial uploads through Cloudinary's own Media
Library UI and pastes the URL into the manifest.

## 4. The manifest is the integration point

[`content/manifest.sample.json`](../../content/manifest.sample.json) is the contract. Editorial
pastes **either a full delivery URL or a bare public ID** into `media` — `publicId()` normalizes
both, plus URLs that already carry transformation segments. Everything except `media` and
`collection` is optional; the feed degrades rather than breaks.

This is deliberately the lowest-friction integration that exists. It works as a hand-edited JSON
file at pilot scale, and the exact same schema is what the YouTube and RSS harvesters will write
into once they're running. No rewrite between the two.

## 5. So what's the actual ask now?

Down from "credentials" to **three facts and, optionally, two console actions**:

1. The **cloud name**. *(a fact, not a secret)*
2. Whether **Strict Transformations** is on. If yes → register the four named transformations.
3. Whether feed assets are **public** (`upload`) delivery type.
4. *Optional but worth it:* one **unsigned upload preset** scoped to `texans/feed`.

No API key. No secret. Nothing revocable that breaks the site. Nothing that grants us write
access beyond one folder.

## 6. One practical note on the prototype

The published artifact runs in a sandbox whose CSP blocks media from `res.cloudinary.com`, so
**that version keeps the generated placeholder frames** no matter what we put in the manifest.
The copy in [`prototype/`](../../prototype/) has no such restriction — point it at a real
manifest and it plays real video. Treat the artifact as the design reference and the repo copy
as the functional one.
