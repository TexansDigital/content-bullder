#!/usr/bin/env node
/**
 * What does this channel actually publish? Runs over a saved search.list response and a
 * saved videos.list response and prints the content mix.
 *
 *   node tools/channel-audit.mjs
 */
import { readFileSync } from 'node:fs';
import { normalizeSearch, normalize, audit } from '../src/youtube.js';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const long = normalizeSearch(read('content/samples/youtube-search.json'));
const shorts = normalize(read('content/samples/youtube-videos.json'));

const tally = (rows, key) =>
  Object.entries(rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] || 0) + 1), a), {}))
    .sort((a, b) => b[1] - a[1]);

const bar = (n, max, w = 22) => '█'.repeat(Math.max(1, Math.round((n / max) * w)));

const shortIds = new Set(shorts.map((s) => s.youtubeId));
const overlap = long.filter((l) => shortIds.has(l.youtubeId));

console.log(`\nLONG-FORM (search.list)   ${long.length} videos`);
const lm = Math.max(...tally(long, 'collection').map((r) => r[1]));
for (const [k, n] of tally(long, 'collection'))
  console.log(`  ${k.padEnd(10)} ${String(n).padStart(3)}  ${bar(n, lm)}`);
console.log(`  live-stream duplicates: ${long.filter((l) => l.liveDupe).length}`);
console.log(`  unique after dedupe:    ${long.filter((l) => !l.liveDupe).length}`);

console.log(`\nSHORTS (videos.list)      ${shorts.length} videos`);
const sm = Math.max(...tally(shorts, 'collection').map((r) => r[1]));
for (const [k, n] of tally(shorts, 'collection'))
  console.log(`  ${k.padEnd(10)} ${String(n).padStart(3)}  ${bar(n, sm)}`);

const a = audit(shorts);
console.log(`\n  duration (s)     ${JSON.stringify(a.durationSeconds)}`);
console.log(`  no captions      ${a.withoutCaptions}/${a.total}`);
console.log(`  licensedContent  ${a.licensedContent}/${a.total}`);

console.log(`\nOVERLAP between the two sets: ${overlap.length}`);
console.log(overlap.length === 0
  ? '  → search.list returns NO Shorts. Harvest the uploads playlist instead.\n'
  : `  → ${overlap.map((o) => o.youtubeId).join(', ')}\n`);
