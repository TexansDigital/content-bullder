# txfeed-eloqua-sync: the feed's picks into an Eloqua CDO

Workstream 2 in [docs/workstreams.md](../../docs/workstreams.md). The record, the dry-run numbers
and the open questions are in [docs/eloqua-writeback.md](../../docs/eloqua-writeback.md).

Its own Worker, on purpose: the feed Worker (`workers/feed`) stays the feed session's, and a
change here can never change what a fan sees. The Eloqua client is the feed's own
`workers/feed/src/eloqua.js`, imported read only, so a GUID resolves here exactly as it does in
`/api/who` and `/api/eloqua/lookup`.

| Route | What |
|---|---|
| `GET /health` | Whether the secrets are set, whether Eloqua answers a login, the CDO name, the live signals and the write switch |
| `GET /cdo` | The CDO as the Worker sees it: id, fields, and which signals land. Before it exists, the fields to create |
| `GET /dry-run` | The whole plan, nothing written to Eloqua; logged to `feed_eloqua_writes` |
| `POST /run` | The daily pass by hand |

The three key routes want the `x-sync-key` header. The cron runs the same pass as `POST /run`
daily at 09:05 UTC.

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

Once the Feed Preferences CDO exists in Eloqua, check what the Worker sees, with the key in
place of the placeholder:

```bash
curl -s -H "x-sync-key: THE_KEY" https://txfeed-eloqua-sync.texansdigital.workers.dev/cdo
```

Then the plan, without writing:

```bash
curl -s -H "x-sync-key: THE_KEY" https://txfeed-eloqua-sync.texansdigital.workers.dev/dry-run
```

## Widening

Add a signal to `ELOQUA_CDO_SIGNALS` in `wrangler.toml` (for example
`favorite_player,going`), create its field on the CDO, and push. Every write lands in
`feed_eloqua_writes` with the previous value, so it can be undone.

## Tests

```bash
node test/verify-eloqua-sync.mjs
```
