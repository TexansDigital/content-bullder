# txfeed: the public feed Worker

The same `app/feed.html` the studio serves, bundled into a Cloudflare Worker at
**feed.htow.nz**, reading cards from Supabase instead of a file. The local `server.mjs` stays
the editorial studio; this is what houstontexans.com frames.

| Route | What |
|---|---|
| `/` or `/feed` | The embeddable feed page |
| `/api/feed` | Published cards as JSON. Studio-curated cards first in editorial order, then catalogue Shorts newest first. Cached 60s |
| `/api/events` | What fans do in the feed, written to `feed_events`. Needs the service key; without it events are accepted and dropped |
| `/health` | Liveness plus how many cards each source is serving and any warnings |

Anything naming a player on `excluded_players` is dropped from both sources before it is served.

## First deploy (Adam, once)

From a terminal on the Mac. The clone lands in `~/Downloads/texans-feed` because a different
folder already uses the repo's own name there:

```bash
cd ~/Downloads
git clone -b claude/storyteller-social-widget-research-t8b3zp https://github.com/TexansDigital/content-bullder.git texans-feed
cd texans-feed/workers/feed
npx wrangler login
npx wrangler deploy
npx wrangler secret put SUPABASE_SERVICE_KEY
```

The secret prompt wants the **service_role** key from Supabase > Project Settings > API. It is
the only credential this Worker holds and the only one that can write `feed_events`.

Then in the Cloudflare dashboard: Workers & Pages > txfeed > Settings > Domains & Routes >
Add > Custom domain > `feed.htow.nz`. Wrangler leaves the domain alone on every later deploy.

Check it:

```bash
curl -s https://feed.htow.nz/health
```

## Every deploy after that

Merge to the default branch. `.github/workflows/deploy-feed.yml` runs the tests, bundles, and
deploys when `workers/feed/**`, `app/feed.html` or `src/**` changed. It needs
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets, same as
forms-on-pocket.

## Wiring the studio to production

Publish in the studio reaches feed.htow.nz when the studio is started with the service key:

```bash
cd ~/Downloads/texans-feed
SUPABASE_SERVICE_KEY=eyJ... node server.mjs
```

Every save then upserts the whole store into `feed_items` and archives rows for cards deleted
locally. Table SQL is `sql/040-feed-items.sql`.

## What does not work yet

- **Studio uploads.** A card whose media is a file under `content/uploads/` has no public URL,
  so the Worker skips it and counts it under `warnings` on `/health`. Uploaded media needs a
  home (R2 behind this Worker is the natural one) before composed cards with local video go
  live. Cards built on YouTube or Cloudinary media serve fine.
- **GA4.** Blank by default. Set `GA_MEASUREMENT_ID` in `wrangler.toml` or pass `?ga=` on the
  iframe src.

## Local check without deploying

```bash
cd ~/Downloads/texans-feed/workers/feed
npx wrangler dev
```
