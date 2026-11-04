# txfeed-eloqua-sync: the feed's picks onto the Eloqua contact

Workstream 2 in [docs/workstreams.md](../../docs/workstreams.md). The record, the dry-run numbers
and the open questions are in [docs/eloqua-writeback.md](../../docs/eloqua-writeback.md).

Its own Worker, on purpose: the feed Worker (`workers/feed`) stays the feed session's, and a
change here can never change what a fan sees. The Eloqua client is the feed's own
`workers/feed/src/eloqua.js`, imported read only, so a GUID resolves here exactly as it does in
`/api/who` and `/api/eloqua/lookup`.

| Route | What |
|---|---|
| `GET /health` | Whether the secrets are set, whether Eloqua answers a login, the field map, and the write switch |
| `GET /dry-run` | The plan: every recognised fan with saved picks, the contact the GUID resolves to, and the value for each field. Nothing written to Eloqua; the plan is logged to `feed_eloqua_writes` as `dry` |
| `GET /fields?q=player` | Eloqua contact fields whose name matches, with id, internal name and type, so the map can be named |
| `POST /run` | The nightly pass by hand. Writes only when `WRITE_ENABLED` is `1` and the field map names the field |

The three key routes want the `x-sync-key` header. The cron runs the same pass as `POST /run`
nightly at 09:05 UTC.

## First deploy (Adam, once)

```bash
cd ~/Downloads/texans-feed
git fetch origin claude/eloqua-writeback
git checkout claude/eloqua-writeback
cd workers/eloqua-sync
npx wrangler deploy
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put ELOQUA_SITE
npx wrangler secret put ELOQUA_USER
npx wrangler secret put ELOQUA_PASSWORD
npx wrangler secret put SYNC_KEY
```

The three Eloqua values are the ones already on the txfeed Worker; a Worker cannot read another
Worker's secrets. `SYNC_KEY` is any long random string.

Then the dry run, with the key in place of the placeholder:

```bash
curl -s -H "x-sync-key: THE_KEY" https://txfeed-eloqua-sync.texansdigital.workers.dev/dry-run
```

And the fields Eloqua already has that mention a player:

```bash
curl -s -H "x-sync-key: THE_KEY" "https://txfeed-eloqua-sync.texansdigital.workers.dev/fields?q=player"
```

## Turning writes on

Only after the dry run has been read and the fields named. In `wrangler.toml`, set
`ELOQUA_FIELD_MAP` to the named fields and `WRITE_ENABLED` to `"1"`, deploy, and the next cron
writes. Every write lands in `feed_eloqua_writes` with the previous value, so it can be undone.

## Tests

```bash
node test/verify-eloqua-sync.mjs
```
