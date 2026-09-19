#!/usr/bin/env node
/**
 * Distils a full channel harvest into something the prototype can render.
 *
 * The harvest is ~1,000 clips; the prototype renders every slide in the filtered set, so it
 * gets the vertical-native, non-duplicate subset, capped per collection and newest first.
 *
 *   node tools/build-prototype-data.mjs content/samples/channel-1000.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2] || 'content/samples/channel-1000.json';
const out = process.argv[3] || 'content/manifest.json';
const PER_COLLECTION = 24;

const m = JSON.parse(readFileSync(src, 'utf8'));

const eligible = m.clips.filter((c) => c.flags?.isShort && !c.liveDupe && c.flags?.embeddable);

const seen = {};
const clips = eligible.filter((c) => {
  seen[c.collection] = (seen[c.collection] || 0) + 1;
  return seen[c.collection] <= PER_COLLECTION;
});

// Collections that actually have content, biggest first — no empty shelves.
const NAMES = {
  gameday: 'Gameday', series: 'Series', presser: 'Pressers', players: 'Players',
  radio: 'Texans Radio', community: 'Community & Foundation',
  flag: 'Girls Flag & Youth Football',
};
const counts = clips.reduce((a, c) => ((a[c.collection] = (a[c.collection] || 0) + 1), a), {});
const collections = Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .map(([key]) => ({ key, name: NAMES[key] || key }));

// Long-form inventory, for the clipping view.
const longForm = m.clips
  .filter((c) => !c.flags?.isShort && !c.liveDupe && c.durationSeconds > 180)
  .sort((a, b) => b.durationSeconds - a.durationSeconds);

const byColl = (rows) =>
  Object.entries(rows.reduce((a, c) => ((a[c.collection] = (a[c.collection] || 0) + 1), a), {}))
    .sort((a, b) => b[1] - a[1]);

writeFileSync(out, JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseUrl: m.baseUrl || 'https://static.clubs.nfl.com',
  namedTransformations: false,
  sourceStats: {
    harvested: m.clips.length,
    range: [m.clips.at(-1)?.publishedAt?.slice(0, 10), m.clips[0]?.publishedAt?.slice(0, 10)],
    verticalNative: eligible.length,
    nonGamedayVertical: eligible.filter((c) => c.collection !== 'gameday').length,
    longFormOver3min: longForm.length,
    longFormByCollection: Object.fromEntries(byColl(longForm)),
    withCaptions: m.clips.filter((c) => c.flags?.hasCaptions).length,
  },
  collections,
  clips,
  longForm: longForm.slice(0, 40).map((c) => ({
    youtubeId: c.youtubeId, headline: c.headline, collection: c.collection,
    duration: c.duration, durationSeconds: c.durationSeconds, poster: c.poster,
  })),
}, null, 2) + '\n');

console.error(`\nwrote ${out}`);
console.error(`  eligible verticals ${eligible.length} → capped to ${clips.length}`);
console.error(`  collections        ${collections.map((c) => `${c.key}:${counts[c.key]}`).join('  ')}`);
console.error(`  long-form >3min    ${longForm.length}  ${JSON.stringify(Object.fromEntries(byColl(longForm)))}\n`);
