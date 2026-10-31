/**
 * The public feed Worker, through its fetch seam. Pure Node, no network: Supabase is a mock
 * that returns the PostgREST shapes the real tables return, and what is asserted is the
 * merge, the ordering, the exclusion, the event write and the headers.
 */
import { createApp } from '../workers/feed/src/app.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

const VIDEOS = [
  { id: 'Tq3sz_Yf-Nk', title: 'Tank is BACK', description: 'Week 7', published_at: '2026-10-20T18:00:00Z', duration_seconds: 18, thumbnail_url: null, lifetime_views: 1 },
  { id: 'dwNx1tv_k24', title: 'TORO at the parade', description: '', published_at: '2026-10-18T18:00:00Z', duration_seconds: 20, thumbnail_url: null, lifetime_views: 1 },
  { id: 'ban000mixon', title: 'Mixon finds the end zone', description: '', published_at: '2026-10-19T18:00:00Z', duration_seconds: 20, thumbnail_url: null, lifetime_views: 1 },
];
const ITEMS = [
  // An editor took over the TORO Short: same id as the catalogue card, their copy wins.
  { item: { id: 'yt-dwNx1tv_k24', source: 'catalogue', collection: 'community', headline: 'TORO leads the parade', media: { kind: 'youtube', videoId: 'dwNx1tv_k24', url: 'https://www.youtube.com/shorts/dwNx1tv_k24' }, sortIndex: 1, publishedAt: '2026-10-18T18:00:00Z', shelfLife: 'evergreen' } },
  { item: { id: 'promo-1', source: 'cloudinary', collection: 'community', headline: 'Toyota Toy Drive', media: { kind: 'video', url: 'https://res.cloudinary.com/x/video/upload/toy.mp4' }, poster: ['https://res.cloudinary.com/x/image/upload/toy.jpg'], sortIndex: 0, publishedAt: '2026-10-01T00:00:00Z' } },
  { item: { id: 'upload-9', source: 'upload', collection: 'gameday', headline: 'Local only', media: { kind: 'video', url: '/content/uploads/abc.mp4' }, poster: ['/content/uploads/abc.jpg'], sortIndex: 2 } },
  { item: { id: 'promo-ban', source: 'manual', collection: 'players', headline: 'Deshaun Watson night', media: { kind: 'image', url: 'https://img.example/x.jpg' }, poster: ['https://img.example/x.jpg'], sortIndex: 3 } },
];
const EXCLUDED = [{ name: 'Deshaun Watson' }, { name: 'Joe Mixon' }];

const calls = [];
const mock = (over = {}) => async (url, opts = {}) => {
  calls.push({ url, opts });
  const path = url.split('/rest/v1/')[1] || '';
  const table = path.split('?')[0];
  if (over[table]) return over[table](url, opts);
  if (opts.method === 'POST' && table === 'feed_events') return { ok: true, status: 201, json: async () => [] };
  const body = table === 'videos' ? VIDEOS
    : table === 'feed_items' ? ITEMS
    : table === 'excluded_players' ? EXCLUDED
    : (table === 'short_content_types' || table === 'short_labels' || table === 'feed_video_entities') ? []
    : null;
  if (body === null) return { ok: false, status: 404, json: async () => [] };
  return { ok: true, status: 200, json: async () => body };
};
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const ENV = { SUPABASE_SERVICE_KEY: 'service-secret' };
const app = (deps = {}) => createApp({ feedHtml: '<!doctype html><title>feed</title>', deps: { fetch: mock(), cache: null, ...deps } });
const req = (path, init) => new Request(`https://feed.htow.nz${path}`, init);

// ---- the page ----
let r = await app().fetch(req('/feed'), ENV, ctx);
t('the feed page is served', r.status === 200 && (await r.text()).includes('<title>feed</title>'));
t('the page may only be framed by the club site',
  /frame-ancestors 'self' https:\/\/www\.houstontexans\.com/.test(r.headers.get('content-security-policy')));
t('/ serves the same page', (await app().fetch(req('/'), ENV, ctx)).status === 200);
const head = await app().fetch(req('/feed', { method: 'HEAD' }), ENV, ctx);
t('HEAD on the page answers with the same headers', head.status === 200 && /text\/html/.test(head.headers.get('content-type')));
t('a custom frame-ancestors binding is honoured',
  (await app().fetch(req('/feed'), { FRAME_ANCESTORS: "'self' https://x.test" }, ctx)).headers.get('content-security-policy') === "frame-ancestors 'self' https://x.test");

// ---- the feed ----
calls.length = 0;
r = await app().fetch(req('/api/feed'), ENV, ctx);
const feed = await r.json();
t('api/feed answers 200 with cards', r.status === 200 && Array.isArray(feed.clips) && feed.clips.length > 0);
t('the feed JSON is public and cacheable', r.headers.get('access-control-allow-origin') === '*' && /max-age=60/.test(r.headers.get('cache-control')));
t('events endpoint is advertised when the service key is set', feed.analytics.events === '/api/events');
t('ga4 is null when unset', feed.analytics.ga4 === null);
const ids = feed.clips.map((c) => c.id);
t(`curated cards come first in editorial order (${ids.slice(0, 2).join(', ')})`, ids[0] === 'promo-1' && ids[1] === 'yt-dwNx1tv_k24');
t('a curated card replaces the catalogue card with the same id', feed.clips.find((c) => c.id === 'yt-dwNx1tv_k24').headline === 'TORO leads the parade' && ids.filter((i) => i === 'yt-dwNx1tv_k24').length === 1);
t('catalogue cards follow the curated ones', ids.indexOf('yt-Tq3sz_Yf-Nk') > ids.indexOf('yt-dwNx1tv_k24'));
t('a curated card naming an excluded player is dropped', !ids.includes('promo-ban'));
t('a catalogue Short naming an excluded player is dropped', !ids.includes('yt-ban000mixon'));
t('a card whose media is a local upload is not served from this origin', !ids.includes('upload-9'));
t('and the skip is reported as a warning', (feed.warnings || []).some((w) => /1 card\(s\) skipped/.test(w)));
t('counts name each source', feed.counts.curated === 3 && feed.counts.catalogue === 1 && feed.counts.served === 3);
t('every card is marked published for the renderer', feed.clips.every((c) => c.status === 'published'));
t('collections list only what is live', feed.collections.every((c) => c.count > 0) && feed.collections.some((c) => c.key === 'community'));
t('a curated card keeps its shelf life', feed.clips.find((c) => c.id === 'yt-dwNx1tv_k24').shelfLife === 'evergreen');
t('the denylist is read with the publishable key, never the service key',
  calls.filter((c) => /excluded_players/.test(c.url)).every((c) => c.opts.headers.apikey !== 'service-secret'));

const one = await (await app().fetch(req('/api/feed?collection=gameday'), ENV, ctx)).json();
t('?collection filters cards but not the collections list', one.clips.every((c) => c.collection === 'gameday') && one.collections.length >= 1);

const noItems = await app({ fetch: mock({ feed_items: async () => ({ ok: false, status: 404, json: async () => [] }) }) }).fetch(req('/api/feed'), ENV, ctx);
const ni = await noItems.json();
t('no feed_items table yet: the catalogue alone is served, without a warning', noItems.status === 200 && ni.counts.curated === 0 && ni.counts.catalogue === 2 && !ni.warnings);

const catDown = await app({ fetch: mock({ videos: async () => ({ ok: false, status: 500, json: async () => [] }) }) }).fetch(req('/api/feed'), ENV, ctx);
const cd = await catDown.json();
t('catalogue down: curated cards still serve and the failure is a warning', catDown.status === 200 && cd.counts.curated > 0 && cd.warnings.some((w) => /catalogue: .*500/.test(w)));

const listDown = await app({ fetch: mock({ excluded_players: async () => ({ ok: false, status: 500, json: async () => [] }) }) }).fetch(req('/api/feed'), ENV, ctx);
t('denylist unreadable: nothing is served rather than risk an excluded player', listDown.status === 503 && /no-store/.test(listDown.headers.get('cache-control')));

const noKey = await (await app().fetch(req('/api/feed'), {}, ctx)).json();
t('without the service key no events endpoint is advertised', noKey.analytics.events === null);

const ga = await (await app().fetch(req('/api/feed'), { GA_MEASUREMENT_ID: 'G-ABC123XYZ' }, ctx)).json();
t('a valid GA id is passed through', ga.analytics.ga4 === 'G-ABC123XYZ');
const badGa = await (await app().fetch(req('/api/feed'), { GA_MEASUREMENT_ID: 'G-<script>' }, ctx)).json();
t('a malformed GA id is dropped', badGa.analytics.ga4 === null);

// ---- cache ----
const store = new Map();
const cache = { match: async (k) => store.get(k.url) || null, put: async (k, v) => { store.set(k.url, v); } };
calls.length = 0;
const a1 = app({ cache });
await a1.fetch(req('/api/feed'), ENV, ctx); await Promise.all(waits.splice(0));
const n1 = calls.length;
await a1.fetch(req('/api/feed'), ENV, ctx);
t('a second /api/feed within the window is served from cache with no Supabase calls', calls.length === n1 && store.size === 1);

// ---- events ----
calls.length = 0;
const evBody = JSON.stringify({ events: [
  { event: 'card_view', at: '2026-10-31T20:00:00Z', params: { pocket_id: 'sess_1792089626000_k3j9xq2ab', device_id: 'dev_abc123', card_id: 'yt-Tq3sz_Yf-Nk', feed_collection: 'all' } },
  { event: 'hello', params: {} },
  { event: 'DROP TABLE', params: {} },
  { event: 'like', at: '1999-01-01T00:00:00Z', params: { pocket_id: 'bad id!', card_id: 'promo-1' } },
  { event: 'identity', params: { identity_source: 'host', pocket_id: 'sess_1792089626000_k3j9xq2ab' } },
] });
const fixedNow = new Date('2026-10-31T20:00:05Z');
r = await app({ now: () => fixedNow }).fetch(req('/api/events', { method: 'POST', body: evBody, headers: { 'content-type': 'text/plain;charset=UTF-8' } }), ENV, ctx);
await Promise.all(waits.splice(0));
t('events are accepted with 204', r.status === 204);
const w = calls.find((c) => /feed_events/.test(c.url) && c.opts.method === 'POST');
t('the write uses the service key, minimal return', w && w.opts.headers.apikey === 'service-secret' && w.opts.headers.prefer === 'return=minimal');
const rows = w ? JSON.parse(w.opts.body) : [];
t(`hello and a malformed event name are dropped (${rows.length} rows)`, rows.length === 3 && !rows.some((x) => x.event === 'hello' || /DROP/.test(x.event)));
const cv = rows.find((x) => x.event === 'card_view');
t('pocket id becomes session_id and video_id is derived from the card id',
  cv.session_id === 'sess_1792089626000_k3j9xq2ab' && cv.device_id === 'dev_abc123' && cv.video_id === 'Tq3sz_Yf-Nk' && cv.card_id === 'yt-Tq3sz_Yf-Nk');
t('ids are lifted out of params, the rest stays', !('pocket_id' in cv.params) && !('device_id' in cv.params) && cv.params.feed_collection === 'all');
t('a client timestamp within a day is kept', cv.at === '2026-10-31T20:00:00.000Z');
const lk = rows.find((x) => x.event === 'like');
t('a malformed pocket id is nulled, not stored raw', lk.session_id === null);
t('a timestamp from 1999 is replaced by arrival time', lk.at === fixedNow.toISOString());
t('a non-yt card id yields no video_id', lk.video_id === null && lk.card_id === 'promo-1');

r = await app().fetch(req('/api/events', { method: 'POST', body: 'not json' }), ENV, ctx);
t('bad JSON is a 400', r.status === 400);
r = await app().fetch(req('/api/events', { method: 'POST', body: 'x'.repeat(70000) }), ENV, ctx);
t('an oversized body is a 413', r.status === 413);
calls.length = 0;
r = await app().fetch(req('/api/events', { method: 'POST', body: evBody }), {}, ctx);
t('without the service key events are accepted and nothing is written', r.status === 204 && !calls.some((c) => /feed_events/.test(c.url)));
r = await app().fetch(req('/api/events', { method: 'POST', body: JSON.stringify({ events: [{ event: 'x', params: { pocket_id: 'sess_1792089626000_k3j9xq2ab', blob: 'y'.repeat(5000) } }] }) }), ENV, ctx);
await Promise.all(waits.splice(0));
const big = JSON.parse(calls.find((c) => /feed_events/.test(c.url) && c.opts.method === 'POST').opts.body)[0];
t('oversized params are truncated to a marker, the ids survive', big.params.truncated === true && big.session_id === 'sess_1792089626000_k3j9xq2ab');

// ---- health and misc ----
const h = await app().fetch(req('/health'), ENV, ctx);
const hb = await h.json();
t('health reports ok with per-source counts', h.status === 200 && hb.ok === true && hb.counts.served === 3 && hb.events === true);
t('unknown paths are 404', (await app().fetch(req('/nope'), ENV, ctx)).status === 404);
t('GET on the events route is 404, not a write', (await app().fetch(req('/api/events'), ENV, ctx)).status === 404);
const boom = await app({ fetch: async () => { throw new Error('network'); } }).fetch(req('/api/feed'), ENV, ctx);
t('a total network failure is a 503 JSON, never a stack trace', boom.status === 503 && (await boom.json()).counts.served === 0);

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
