# Masters: our own copies of the clips

Built 2 Nov 2026. Adam and Juan upload; the feed does the rest.

## Why

The feed plays Shorts through YouTube's embed, which means YouTube's posters, YouTube's
player, and no watch-time events we control. A master is the same vertical export the club
already makes for the Short, stored in our own bucket and played by our own player. Masters
also carry anything that was never on a platform: a community story, a graphic, a promo.

## How to upload

Open `https://feed.htow.nz/studio/upload`. Enter the upload key once; the browser keeps it.

**Master for a card.** Drop the export, pick the Short it belongs to (the search covers every
live card; a file named after the Short is matched for you), press Upload. The page takes a
poster frame from the clip at one second and sends it too. Within a minute the card plays from
our file, keeps its headline, tags and reasons, and falls back to its YouTube poster if ours
is missing.

**New card.** Drop a video or a graphic, give it a headline and a collection, optionally
players, a caption, a houstontexans.com link and tags. It joins the feed in that collection.
Tags are how a page can be filtered to one kind of story later (the community keeper).

**Remove** on the right puts a card back on its embed, or drops a new card.

Limits: MP4, WebM or MOV up to 100 MB; JPG, PNG or WebP for graphics. Anything naming an
excluded player never reaches the feed, same as every other source.

## Daily effort

About eight Shorts a day at the current cadence. Each is one drop and one click, 20 to 40
seconds. Five minutes a day for one person, batched whenever suits.

## Setup, once

The Worker holds the bucket as the `MEDIA` binding (wrangler.toml). Writes need one secret:

```bash
cd workers/feed
npx wrangler secret put MEDIA_UPLOAD_KEY
```

Pick a long random string and share it with Juan. Until it is set, `/health` reports
`uploads: false` and the page says uploads are not enabled.

## How it works

- `POST /api/media?for=<cardId>` stores `masters/<cardId>/<stamp>.mp4`; `?new=1&headline=&collection=`
  stores `cards/<id>/<stamp>.<ext>`; `?poster=<id>` attaches `posters/<id>/<stamp>.jpg`.
  Header `x-media-key` carries the secret, `x-media-by` the uploader's name.
- `index.json` in the bucket lists every upload. Writes are conditional on the index's etag, so
  two people uploading at once cannot lose each other's entry.
- `GET /media/<key>` serves the bytes with byte ranges, a year of cache and open CORS. Keys are
  unique per upload, so a replacement is a new key, never a stale cache.
- The feed reads the index when it builds (once a minute). A master replaces its card's media
  with `{ kind: 'file' }`; a new card is made through the same `makeItem` as every other source.
- `/health` reports `media`, `uploads`, `counts.masters` and `counts.studio`.

Tests: `node test/verify-media.mjs` (an in-memory bucket, 42 checks).
