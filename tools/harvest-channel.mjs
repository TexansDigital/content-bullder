#!/usr/bin/env node
/**
 * Harvests a whole channel the way that actually works.
 *
 * `search.list` does not return Shorts — verified against this channel, see
 * docs/research/12-content-mix.md. The uploads playlist does.
 *
 *   node tools/harvest-channel.mjs --key=$YT_API_KEY --channel=UCa_FcpOBe8G6VAR18RYS-aA
 *   node tools/harvest-channel.mjs --key=$YT_API_KEY --channel=... --max=200 --out=content/manifest.json
 *
 * Quota: 1 unit for the channel, 1 per 50 playlist items, 1 per 50 videos. A 200-video
 * harvest costs about 9 units against a 10,000/day default.
 */
import { writeFileSync } from 'node:fs';
import { normalize, audit } from '../src/youtube.js';

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const KEY = flag('key');
const CHANNEL = flag('channel');
const MAX = Number(flag('max') || 100);
const OUT = flag('out') || 'content/manifest.json';

if (!KEY || !CHANNEL) {
  console.error('usage: harvest-channel.mjs --key=KEY --channel=UC... [--max=100] [--out=path]');
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

const ch = await api('channels', { part: 'contentDetails,snippet', id: CHANNEL });
if (!ch.items?.length) throw new Error(`no such channel: ${CHANNEL}`);
const uploads = ch.items[0].contentDetails.relatedPlaylists.uploads;
console.error(`channel: ${ch.items[0].snippet.title}   uploads playlist: ${uploads}`);

const ids = [];
let pageToken;
do {
  const page = await api('playlistItems', {
    part: 'contentDetails', playlistId: uploads, maxResults: 50, pageToken,
  });
  ids.push(...page.items.map((i) => i.contentDetails.videoId));
  pageToken = page.nextPageToken;
} while (pageToken && ids.length < MAX);
console.error(`collected ${ids.length} video ids`);

const items = [];
for (let i = 0; i < Math.min(ids.length, MAX); i += 50) {
  const page = await api('videos', {
    part: 'snippet,contentDetails,status,statistics',
    id: ids.slice(i, i + 50).join(','),
  });
  items.push(...page.items);
}

const clips = normalize({ items });
const report = audit(clips);

writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  channelId: CHANNEL,
  baseUrl: 'https://static.clubs.nfl.com',
  namedTransformations: false,
  collections: [
    { key: 'gameday', name: 'Gameday' },
    { key: 'presser', name: 'Pressers' },
    { key: 'radio', name: 'Texans Radio' },
    { key: 'series', name: 'Series' },
    { key: 'players', name: 'Players' },
    { key: 'community', name: 'Community & Foundation' },
    { key: 'flag', name: 'Girls Flag & Youth Football' },
  ],
  clips,
}, null, 2) + '\n');

const shorts = clips.filter((c) => c.flags.isShort);
console.error(`\nwrote ${OUT}\n`);
console.error(`  total            ${report.total}`);
console.error(`  Shorts (<=180s)  ${shorts.length}`);
console.error(`  live dupes       ${clips.filter((c) => c.liveDupe).length}`);
console.error('  by collection   ', JSON.stringify(report.byCollection));
console.error('  duration (s)    ', JSON.stringify(report.durationSeconds));
console.error(`  no captions      ${report.withoutCaptions}/${report.total}`);
console.error(`  licensedContent  ${report.licensedContent}/${report.total}`);
