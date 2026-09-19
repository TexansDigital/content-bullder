#!/usr/bin/env node
/**
 * Houston Texans — YouTube channel harvest. Self-contained: no npm install, no repo.
 * Needs Node 18+ (for built-in fetch). Read-only — it only issues GETs to the YouTube API.
 *
 * Writes texans-manifest.json next to itself and prints a content-mix report.
 *
 * Why the uploads playlist and not search.list: a date-ordered search of this channel
 * returned 21 long-form videos and zero of the ten known Shorts published in the same
 * window. search.list does not surface Shorts, truncates descriptions, and omits duration
 * and status. The uploads playlist returns everything.
 *
 * Quota: ~1 unit for the channel, 1 per 50 playlist items, 1 per 50 videos. 300 videos
 * costs about 13 units against a 10,000/day default.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * YouTube Data API v3 → ContentItem.
 *
 * The API is the only source we have working access to today, and it is metadata-only:
 * it never returns the video file and its terms require playback in YouTube's own
 * embedded player. See docs/research/02-social-ingestion-constraints.md.
 */

/**
 * Both `videos.list` and `search.list` return HTML-escaped titles and descriptions
 * (`Q&amp;A`, `Montgomery&#39;s`). Decode before anything is rendered or matched against.
 */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(text) {
  return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** ISO-8601 duration → seconds. Handles the PT#H#M#S shapes YouTube emits. */
function durationSeconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d, h, mi, s] = m;
  return (+d || 0) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + Math.round(+s || 0);
}

const mmss = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

/**
 * YouTube has no "is this a Short" flag. Vertical uploads under ~3 minutes are Shorts in
 * practice, and the API won't tell us the aspect ratio either — so duration is the only
 * signal available. Deliberately conservative.
 */
const looksLikeShort = (secs) => secs > 0 && secs <= 180;

/** Poster candidates, best first. `oar` is the Shorts-native vertical frame and is not
 *  returned by the API — it exists for Shorts and 404s otherwise, so try it first and
 *  let the client fall back. */
function posterCandidates(id) {
  return [
    `https://i.ytimg.com/vi/${id}/oardefault.jpg`,
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ];
}

/** YouTube boilerplate that carries no editorial meaning. */
const BOILERPLATE = [
  /^subscribe:\s*\S+$/i,
  /^tickets:\s*\S+$/i,
  /^https?:\/\/\S+$/i,
];

function cleanDescription(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !BOILERPLATE.some((re) => re.test(l)))
    .join(' ')
    .trim();
}

/**
 * Best-effort collection guess. Titles are the only usable signal — descriptions are
 * boilerplate — so this is a starting point for an editor, not a verdict. Everything it
 * can't place lands in `gameday`, which is also the honest default for this channel.
 */
const RULES = [
  [/girls flag|youth football|flag football/i, 'flag'],
  [/foundation|community|charit|donat|volunteer|hospital|school visit/i, 'community'],
  [/texans radio/i, 'radio'],
  [/full q ?& ?a|address(es)? the media|press conference|presser|previews .* week/i, 'presser'],
  [/all angles|best plays|highlights|top plays/i, 'gameday'],
  [/mic'?d up|episode|ep\.? ?\d|behind the scenes|inside the/i, 'series'],
  [/signs|contract|draft|roster|welcome|introduc|training camp/i, 'players'],
];

function guessCollection(title = '', description = '') {
  const hay = decodeEntities(`${title} ${description}`);
  for (const [re, key] of RULES) if (re.test(hay)) return key;
  return 'gameday';
}

/**
 * A live stream and the edited cut of the same session both get published. The `LIVE:`
 * prefix marks the raw stream; the `| Full Q&A` cut is the one worth surfacing.
 */
const isLiveStreamDupe = (title) => /^\s*LIVE:/i.test(decodeEntities(title));

/**
 * `search.list` DOES NOT RETURN SHORTS. Verified 2026-09-19: a date-ordered search of the
 * Texans channel returned 21 long-form videos and zero of the ten known Shorts published in
 * the same window. It also truncates descriptions and omits duration and status entirely.
 *
 * Harvest the uploads playlist instead — `channels.list(part=contentDetails)` gives
 * `relatedPlaylists.uploads`, then `playlistItems.list` over it, then `videos.list` for the
 * full record. See tools/harvest-channel.mjs.
 */
function normalizeSearch(response) {
  return (response?.items || [])
    .filter((i) => i.id?.kind === 'youtube#video')
    .map((i) => ({
      youtubeId: i.id.videoId,
      title: decodeEntities(i.snippet?.title),
      publishedAt: i.snippet?.publishedAt || null,
      collection: guessCollection(i.snippet?.title),
      liveDupe: isLiveStreamDupe(i.snippet?.title),
    }))
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

/** Normalize one `youtube#video` resource into our ContentItem shape. */
function toContentItem(v) {
  const s = v.snippet || {};
  const c = v.contentDetails || {};
  const st = v.status || {};
  const secs = durationSeconds(c.duration);
  const desc = decodeEntities(cleanDescription(s.description));

  return {
    id: `yt-${v.id}`,
    media: null,
    mediaType: 'youtube',
    youtubeId: v.id,
    collection: guessCollection(s.title, desc),
    liveDupe: isLiveStreamDupe(s.title),
    headline: decodeEntities(s.title),
    caption: desc || null,
    durationSeconds: secs,
    duration: mmss(secs),
    publishedAt: s.publishedAt || null,
    poster: posterCandidates(v.id),
    action: null,
    sources: { youtube: v.id, instagram: null, tiktok: null },
    sponsor: null,
    audioSource: 'unknown',
    flags: {
      isShort: looksLikeShort(secs),
      embeddable: st.embeddable !== false,
      public: st.privacyStatus === 'public',
      hasCaptions: c.caption === 'true' || c.caption === true,
      licensedContent: c.licensedContent === true,
    },
  };
}

/** Normalize a full `videos.list` response, newest first. */
function normalize(response) {
  return (response?.items || [])
    .map(toContentItem)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

/** Counts worth surfacing to an editor before anything is published. */
function audit(items) {
  const by = (k) => items.reduce((a, i) => ((a[i[k]] = (a[i[k]] || 0) + 1), a), {});
  const d = items.map((i) => i.durationSeconds).sort((a, b) => a - b);
  return {
    total: items.length,
    byCollection: by('collection'),
    notEmbeddable: items.filter((i) => !i.flags.embeddable).map((i) => i.youtubeId),
    notPublic: items.filter((i) => !i.flags.public).map((i) => i.youtubeId),
    withoutCaptions: items.filter((i) => !i.flags.hasCaptions).length,
    licensedContent: items.filter((i) => i.flags.licensedContent).length,
    notShorts: items.filter((i) => !i.flags.isShort).map((i) => i.youtubeId),
    durationSeconds: d.length
      ? { min: d[0], median: d[d.length >> 1], max: d[d.length - 1] }
      : null,
  };
}


// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const KEY = flag('key');
const CHANNEL = flag('channel') || 'UCa_FcpOBe8G6VAR18RYS-aA';
const MAX = Number(flag('max') || 300);
const OUT = flag('out') || join(dirname(fileURLToPath(import.meta.url)), 'texans-manifest.json');

if (!KEY) {
  console.error('\nusage:  node harvest-standalone.mjs --key=YOUR_YOUTUBE_API_KEY');
  console.error('        node harvest-standalone.mjs --key=... --channel=UC... --max=500\n');
  process.exit(1);
}

const api = async (path, params) => {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries({ ...params, key: KEY }).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) throw new Error(`${path}: ${j.error.message}`);
  return j;
};

const pad = (s, n) => String(s).padEnd(n);
const bar = (n, max, w = 24) => '#'.repeat(Math.max(1, Math.round((n / max) * w)));

try {
  const ch = await api('channels', { part: 'contentDetails,snippet,statistics', id: CHANNEL });
  if (!ch.items?.length) throw new Error(`no such channel: ${CHANNEL}`);
  const c = ch.items[0];
  const uploads = c.contentDetails.relatedPlaylists.uploads;
  console.error(`\nchannel   ${c.snippet.title}`);
  console.error(`videos    ${c.statistics?.videoCount ?? '?'} total on channel`);
  console.error(`uploads   ${uploads}\n`);

  const ids = [];
  let pageToken;
  do {
    const page = await api('playlistItems', {
      part: 'contentDetails', playlistId: uploads, maxResults: 50, pageToken,
    });
    ids.push(...page.items.map((i) => i.contentDetails.videoId));
    pageToken = page.nextPageToken;
    process.stderr.write(`\rcollecting ids... ${ids.length}`);
  } while (pageToken && ids.length < MAX);
  process.stderr.write('\n');

  const items = [];
  for (let i = 0; i < Math.min(ids.length, MAX); i += 50) {
    const page = await api('videos', {
      part: 'snippet,contentDetails,status,statistics',
      id: ids.slice(i, i + 50).join(','),
    });
    items.push(...page.items);
    process.stderr.write(`\rfetching details... ${items.length}`);
  }
  process.stderr.write('\n');

  const clips = normalize({ items });
  const report = audit(clips);

  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    channelId: CHANNEL,
    baseUrl: 'https://static.clubs.nfl.com',
    namedTransformations: false,
    collections: [
      { key: 'gameday',   name: 'Gameday' },
      { key: 'presser',   name: 'Pressers' },
      { key: 'radio',     name: 'Texans Radio' },
      { key: 'series',    name: 'Series' },
      { key: 'players',   name: 'Players' },
      { key: 'community', name: 'Community & Foundation' },
      { key: 'flag',      name: 'Girls Flag & Youth Football' },
    ],
    clips,
  }, null, 2) + '\n');

  const shorts = clips.filter((x) => x.flags.isShort);
  const dupes = clips.filter((x) => x.liveDupe);
  const dates = clips.map((x) => x.publishedAt).filter(Boolean).sort();

  console.error(`\nwrote ${OUT}`);
  console.error(`\n${'='.repeat(52)}\nCONTENT MIX  (${report.total} videos)\n${'='.repeat(52)}`);
  if (dates.length) console.error(`range            ${dates[0]?.slice(0, 10)} to ${dates[dates.length - 1]?.slice(0, 10)}`);

  const byColl = Object.entries(report.byCollection).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...byColl.map((r) => r[1]), 1);
  console.error('');
  for (const [k, n] of byColl) console.error(`  ${pad(k, 11)} ${String(n).padStart(4)}  ${bar(n, max)}`);

  const shortsByColl = Object.entries(
    shorts.reduce((a, x) => ((a[x.collection] = (a[x.collection] || 0) + 1), a), {})
  ).sort((a, b) => b[1] - a[1]);
  console.error(`\n  VERTICAL-NATIVE (<=180s): ${shorts.length} of ${report.total}`);
  const smax = Math.max(...shortsByColl.map((r) => r[1]), 1);
  for (const [k, n] of shortsByColl) console.error(`  ${pad(k, 11)} ${String(n).padStart(4)}  ${bar(n, smax)}`);

  console.error(`\n  duration (s)     ${JSON.stringify(report.durationSeconds)}`);
  console.error(`  no captions      ${report.withoutCaptions}/${report.total}`);
  console.error(`  licensedContent  ${report.licensedContent}/${report.total}   <- rights-flagged`);
  console.error(`  live-stream dupes ${dupes.length}`);
  console.error(`  not embeddable   ${report.notEmbeddable.length || 'none'}`);
  console.error(`\nPaste this report back. Send texans-manifest.json too if it's not enormous.\n`);
} catch (e) {
  console.error(`\nfailed: ${e.message}\n`);
  process.exit(1);
}
