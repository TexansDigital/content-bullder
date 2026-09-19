#!/usr/bin/env node
/**
 * Builds content/manifest.json from a YouTube videos.list response.
 *
 *   node tools/build-manifest.mjs content/samples/youtube-videos.json
 *   node tools/build-manifest.mjs --key=$YT_API_KEY --ids=abc,def
 *
 * Prints an audit to stderr so problems are visible before anything is published.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { normalize, audit } from '../src/youtube.js';

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const file = args.find((a) => !a.startsWith('--'));

const COLLECTIONS = [
  { key: 'gameday', name: 'Gameday' },
  { key: 'players', name: 'Players' },
  { key: 'series', name: 'Series' },
  { key: 'community', name: 'Community & Foundation' },
  { key: 'flag', name: 'Girls Flag & Youth Football' },
];

let payload;
if (file) {
  payload = JSON.parse(readFileSync(file, 'utf8'));
} else if (flag('key') && flag('ids')) {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status,statistics&id=${flag('ids')}&key=${flag('key')}`;
  payload = await (await fetch(url)).json();
  if (payload.error) { console.error(payload.error); process.exit(1); }
} else {
  console.error('usage: build-manifest.mjs <response.json> | --key=KEY --ids=id1,id2');
  process.exit(1);
}

const clips = normalize(payload);
const report = audit(clips);

const manifest = {
  generatedAt: new Date().toISOString(),
  baseUrl: 'https://static.clubs.nfl.com',
  namedTransformations: false,
  collections: COLLECTIONS,
  clips,
};

const out = flag('out') || 'content/manifest.json';
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');

console.error(`\nwrote ${out} — ${report.total} clips\n`);
console.error('  by collection   ', JSON.stringify(report.byCollection));
console.error('  duration (s)    ', JSON.stringify(report.durationSeconds));
console.error(`  without captions ${report.withoutCaptions}/${report.total}`);
console.error(`  licensedContent  ${report.licensedContent}/${report.total}`);
console.error(`  not embeddable   ${report.notEmbeddable.length ? report.notEmbeddable.join(',') : 'none'}`);
console.error(`  not public       ${report.notPublic.length ? report.notPublic.join(',') : 'none'}`);
console.error(`  not Shorts       ${report.notShorts.length ? report.notShorts.join(',') : 'none'}`);
