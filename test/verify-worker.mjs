/**
 * The public feed Worker, through its fetch seam. Pure Node, no network: Supabase is a mock
 * that returns the PostgREST shapes the real tables return, and what is asserted is the
 * merge, the ordering, the exclusion, the event write and the headers.
 */
import { createApp } from '../workers/feed/src/app.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const RSS = Object.fromEntries(['news', 'galleries', 'videos', 'audio'].map((k) => [`https://www.houstontexans.com/rss/${k}`, readFileSync(join(here, 'fixtures', `pocket-${k}.xml`), 'utf8')]));

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
const ENTS = [
  { video_id: 'Tq3sz_Yf-Nk', entity_type: 'player', entity_slug: 'tank-dell', confidence: 1 },
  { video_id: 'dwNx1tv_k24', entity_type: 'player', entity_slug: 'c-j-stroud', confidence: 1 },
];
const PROFILES = {
  'sess_1792089626000_k3j9xq2ab': { events: 9, entity_weights: { 'player:tank-dell': 1 }, content_type_weights: {} },
  'dev_thin00001': { events: 1, entity_weights: { 'player:tank-dell': 1 }, content_type_weights: {} },
  // A fan the feed barely saw (one event) who read about Tank Dell on the site (handshake v5 page views).
  'sess_1793900000000_reader01': { events: 1, entity_weights: {}, content_type_weights: {}, site_weights: { 'player:tank-dell': 1 } },
};

const ALIASES = [
  { entity_slug: 'tank-dell', alias: 'tank dell' }, { entity_slug: 'c-j-stroud', alias: 'c j stroud' }, { entity_slug: 'c-j-stroud', alias: 'c.j. stroud' },
];
const PRESETS = [{ slug: 'toro', name: "TORO's picks", blurb: 'The fun side.', entity_weights: {}, content_type_weights: { mascot_skits: 1 } }];
const OFFERS = [{ key: 'draft-week', label: 'Draft news', blurb: '', content_types: ['draft_roster'], keywords: ['draft', 'parade'], ends_at: '2099-04-24T00:00:00Z' },
  { key: 'stale', label: 'Over', blurb: '', content_types: [], keywords: [], ends_at: '2020-01-01T00:00:00Z' },
  // Live, but nothing in the catalogue is about it yet: a promise the feed could not keep.
  { key: 'chargers-week', label: 'Chargers week', blurb: '', content_types: ['opponent_week'], keywords: ['chargers'], ends_at: '2099-11-09T00:00:00Z' }];
const EXPERIMENTS = [{ key: 'picker_pos', arms: { control: 1, early: 1 }, knobs: { early: { picker_position: 0, bogus: 1 } }, traffic: 1 }];
const WEEKS = {
  'sess_1792089626000_k3j9xq2ab': { views: 14, players: [{ slug: 'tank-dell', n: 9 }, { slug: 'nobody-known', n: 2 }], types: [{ type: 'mascot_skits', n: 5 }, { type: 'not_a_type', n: 1 }] },
};
const PREFS = {
  'sess_1792089626000_prefsfan1': { players: ['c-j-stroud'], wants: ['fun'], format: 'video', follow: null, boosts: [], updated_at: '2026-11-01T00:00:00Z' },
  'sess_1792089626000_prefsfan2': { players: ['tank-dell'], wants: [], format: null, follow: null, boosts: [], updated_at: '2026-11-01T00:00:00Z' },
};
const calls = [];
const mock = (over = {}) => async (url, opts = {}) => {
  calls.push({ url, opts });
  if (RSS[url]) return over.rss ? over.rss(url) : { ok: true, status: 200, text: async () => RSS[url] };
  const path = url.split('/rest/v1/')[1] || '';
  const table = path.split('?')[0];
  if (over[table]) return over[table](url, opts);
  if (table === 'rpc/feed_week') {
    const sid = JSON.parse(opts.body || '{}').sid;
    return { ok: true, status: 200, json: async () => (WEEKS[sid] || { views: 0, players: [], types: [] }) };
  }
  if (opts.method === 'POST' && table === 'feed_events') return { ok: true, status: 201, json: async () => [] };
  const body = table === 'videos' ? VIDEOS
    : table === 'feed_items' ? ITEMS
    : table === 'excluded_players' ? EXCLUDED
    : table === 'feed_video_entities' ? ENTS
    : table === 'feed_profiles' ? (() => { const m = /session_id=eq\.([^&]+)/.exec(url); const w = m ? decodeURIComponent(m[1]) : ''; return PROFILES[w] ? [PROFILES[w]] : []; })()
    : (table === 'short_content_types' || table === 'short_labels') ? []
    : table === 'feed_entity_aliases' ? ALIASES
    : table === 'feed_presets' ? PRESETS
    : table === 'feed_boost_offers' ? OFFERS
    : table === 'feed_experiments' ? EXPERIMENTS
    : table === 'feed_preferences' ? (opts.method === 'POST' ? [] : (() => { const m = /session_id=eq\.([^&]+)/.exec(url); const w = m ? decodeURIComponent(m[1]) : ''; return PREFS[w] ? [PREFS[w]] : []; })())
    : null;
  if (opts.method === 'POST' && table === 'feed_preferences') return { ok: true, status: 201, json: async () => [] };
  if (body === null) return { ok: false, status: 404, json: async () => [] };
  return { ok: true, status: 200, json: async () => body };
};
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
// The site feeds are off for the catalogue tests so their counts and order stay about the
// catalogue; the site-card tests turn them on.
const ENV = { SUPABASE_SERVICE_KEY: 'service-secret', POCKET_FEEDS: '' };
const SITE = { SUPABASE_SERVICE_KEY: 'service-secret', POCKET_FEEDS: 'news,galleries,videos,audio' };
const ENTER = '<!doctype html><title>{{TITLE}}</title><form name="{{FORM_NAME}}"><input name="elqCampaignId" value="{{CAMPAIGN_ID}}"><input name="pocket_id" value="{{POCKET_ID}}"><input name="utm_content" value="{{UTM_CONTENT}}"><input name="utm_term" value="{{UTM_TERM}}"></form>';
const ASSETS = { 'steel-916.jpg': { body: new Uint8Array([0xff, 0xd8, 0xff]), type: 'image/jpeg' }, 'fonts/HelveticaNeueLTStd-BlkEx.otf': { body: new Uint8Array([0x4f, 0x54, 0x54, 0x4f]), type: 'font/otf' } };
const app = (deps = {}) => createApp({ feedHtml: '<!doctype html><title>feed</title>', enterHtml: ENTER, assets: ASSETS, deps: { fetch: mock(), cache: null, ...deps } });
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

// ---- ranking ----
// The shared feed here has three cards: promo-1 and the taken-over TORO card are editorial,
// Tank is the only catalogue card. Add a second catalogue card so there is something to rank.
const VIDEOS2 = [...VIDEOS, { id: 'zz2ndcatalog', title: 'Second catalogue card', description: '', published_at: '2026-10-21T18:00:00Z', duration_seconds: 20, thumbnail_url: null, lifetime_views: 1 }];
const rankMock = (over = {}) => mock({ videos: async () => ({ ok: true, status: 200, json: async () => VIDEOS2 }), ...over });
calls.length = 0;
const plain = await (await app({ fetch: rankMock() }).fetch(req('/api/feed'), ENV, ctx)).json();
t('with no id the shared order is served, newest catalogue card first', plain.analytics.rank === 'shared' && plain.clips.map((c) => c.id).slice(2).join(',') === 'yt-zz2ndcatalog,yt-Tq3sz_Yf-Nk');
t('no id means feed_profiles is never asked', !calls.some((c) => /feed_profiles/.test(c.url)));
calls.length = 0;
const fanRes = await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_1792089626000_k3j9xq2ab'), ENV, ctx);
const fan = await fanRes.json();
t('a known pocket id with history gets an order of its own, labelled implicit', fan.analytics.rank === 'implicit');
t('the Tank fan sees the Tank card first in the catalogue tail', fan.clips.map((c) => c.id).slice(2).join(',') === 'yt-Tq3sz_Yf-Nk,yt-zz2ndcatalog');
t('editorial cards stay on top regardless', fan.clips[0].id === 'promo-1' && fan.clips[1].id === 'yt-dwNx1tv_k24');
t('a personal answer is never cacheable', /private, no-store/.test(fanRes.headers.get('cache-control')));
const pr = calls.find((c) => /feed_profiles/.test(c.url));
// ---- site_rank: what a fan read on the site ranks them when the feed has not watched them enough ----
{
  const SITE_EXP = [{ key: 'site_rank', arms: { site: 1 }, knobs: { site: { site_rank: 1 } }, traffic: 1 }];
  const siteMock = () => rankMock({ feed_experiments: async () => ({ ok: true, status: 200, json: async () => SITE_EXP }) });
  const reader = await (await app({ fetch: siteMock() }).fetch(req('/api/feed?sid=sess_1793900000000_reader01'), ENV, ctx)).json();
  t('with site_rank on, a one-event fan with site weights is ranked on them and labelled site', reader.analytics.rank === 'site' && reader.clips.map((c) => c.id).slice(2).join(',') === 'yt-Tq3sz_Yf-Nk,yt-zz2ndcatalog');
  const plainReader = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_1793900000000_reader01'), ENV, ctx)).json();
  t('with the knob off the same fan gets the shared order', plainReader.analytics.rank === 'shared');
  const thin = await (await app({ fetch: siteMock() }).fetch(req('/api/feed?sid=dev_thin00001'), ENV, ctx)).json();
  t('a thin fan with no site weights stays shared even with the knob on', thin.analytics.rank === 'shared');
  const watched = await (await app({ fetch: siteMock() }).fetch(req('/api/feed?sid=sess_1792089626000_k3j9xq2ab'), ENV, ctx)).json();
  t('a fan the feed has watched enough keeps the implicit rank over the site', watched.analytics.rank === 'implicit');
}
t('the profile is read with the service key, never the publishable one', pr && pr.opts.headers.apikey === 'service-secret');
const thin = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?did=dev_thin00001'), ENV, ctx)).json();
t('a one-event profile is too thin: shared order, honestly labelled', thin.analytics.rank === 'shared');
const unknown = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_0000000000000_nobodyyet'), ENV, ctx)).json();
t('an unknown id is simply shared', unknown.analytics.rank === 'shared' && unknown.clips.length === plain.clips.length);
const junk = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=' + encodeURIComponent('x\' or 1=1')), ENV, ctx)).json();
t('a malformed id never reaches Supabase', junk.analytics.rank === 'shared' && !calls.some((c) => /feed_profiles.*or%201/.test(c.url)));
calls.length = 0;
const noKeyFan = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_1792089626000_k3j9xq2ab'), {}, ctx)).json();
t('without the service key no profile is read and the order is shared', noKeyFan.analytics.rank === 'shared' && !calls.some((c) => /feed_profiles/.test(c.url)));
const pdown = await (await app({ fetch: rankMock({ feed_profiles: async () => ({ ok: false, status: 500, json: async () => [] }) }) }).fetch(req('/api/feed?sid=sess_1792089626000_k3j9xq2ab'), ENV, ctx)).json();
t('a failing profile read still serves the feed, shared', pdown.analytics.rank === 'shared' && pdown.clips.length === plain.clips.length);

// ---- cache ----
const store = new Map();
// Like the real Cache API, match() hands back a fresh copy each time, never the stored body.
const cache = { match: async (k) => { const v = store.get(k.url); return v ? v.clone() : null; }, put: async (k, v) => { store.set(k.url, v); } };
calls.length = 0;
const a1 = app({ cache });
await a1.fetch(req('/api/feed'), ENV, ctx); await Promise.all(waits.splice(0));
const n1 = calls.length;
await a1.fetch(req('/api/feed'), ENV, ctx);
t('a second /api/feed within the window is served from cache with no Supabase calls', calls.length === n1 && store.size === 1);
calls.length = 0;
await a1.fetch(req('/api/feed?sid=sess_1792089626000_k3j9xq2ab'), ENV, ctx);
t('a personal request reuses the shared cache and only adds the profile, preference and week reads', calls.length === 3 && calls.every((c) => /feed_profiles|feed_preferences|rpc\/feed_week/.test(c.url)) && store.size === 1);

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

// ---- the preference layer ----
calls.length = 0;
const anon = await (await app({ fetch: rankMock() }).fetch(req('/api/feed'), ENV, ctx)).json();
t('anonymous: no picker (nothing to save against), default knobs, no prefs', anon.picker === null && anon.prefs === null && anon.knobs.picker_position === 2 && JSON.stringify(anon.experiments) === '{}');
const withId = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_0000000000000_nobodyyet'), ENV, ctx)).json();
t('an identified visitor gets the picker: the catalogue\'s players, named', withId.picker && withId.picker.players.some((p) => p.slug === 'tank-dell' && p.name === 'Tank Dell') && withId.picker.max_players === 3);
t('initials are preferred for names', withId.picker.players.find((p) => p.slug === 'c-j-stroud')?.name === 'C.J. Stroud');
t(`only lanes with cards behind them are offered: community here, never an empty one (got ${withId.picker.lanes.map((l) => l.key).join()})`, withId.picker.lanes.map((l) => l.key).join() === 'community');
t('lanes, presets and only live offers ride along', withId.picker.lanes.length === 1 && withId.picker.presets[0].slug === 'toro' && withId.picker.offers.map((o) => o.key).join() === 'draft-week');
t('an offer says how many cards it would move, and carries the posters it has', withId.picker.offers[0].cards === 1 && Array.isArray(withId.picker.offers[0].preview) && withId.picker.offers[0].preview.every((u) => /^https?:/.test(u)));
t('an offer with no card to lift yet is withheld, not promised', !withId.picker.offers.some((o) => o.key === 'chargers-week'));
t('a running experiment assigns an arm and its knobs', ['control', 'early'].includes(withId.experiments.picker_pos) && (withId.experiments.picker_pos === 'early' ? withId.knobs.picker_position === 0 : withId.knobs.picker_position === 2) && !('bogus' in withId.knobs));
const same = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_0000000000000_nobodyyet'), ENV, ctx)).json();
t('the arm is stable across requests', same.experiments.picker_pos === withId.experiments.picker_pos);
t('without the service key the picker is withheld (nowhere to save)', (await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_0000000000000_nobodyyet'), {}, ctx)).json()).picker === null);

calls.length = 0;
const pf = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_1792089626000_prefsfan1'), ENV, ctx)).json();
t('saved preferences come back with the feed and rank it as personal', pf.prefs?.players?.[0] === 'c-j-stroud' && pf.analytics.rank === 'personal');
t('editorial cards are untouched by a pick (the Stroud card an editor placed stays second)', pf.clips.slice(0, 2).map((c) => c.id).join() === 'promo-1,yt-dwNx1tv_k24' && !pf.clips[1].why);
const pf2 = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_1792089626000_prefsfan2'), ENV, ctx)).json();
t('the picked player\'s catalogue card leads the tail and says why', pf2.clips[2].id === 'yt-Tq3sz_Yf-Nk' && pf2.clips[2].why?.kind === 'pick' && pf2.clips[2].why.label === 'Because you picked Tank Dell');
t('a taken-over Short keeps its tags, so it is in the picker', withId.picker.players.some((p) => p.slug === 'c-j-stroud'));
t('preferences are read with the service key', calls.some((c) => /feed_preferences/.test(c.url) && c.opts.headers.apikey === 'service-secret'));
const implicitOnly = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_1792089626000_k3j9xq2ab'), ENV, ctx)).json();
t('history alone is labelled implicit, not personal', implicitOnly.analytics.rank === 'implicit');

calls.length = 0;
const save = await app({ fetch: rankMock() }).fetch(req('/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: 'sess_1792089626000_k3j9xq2ab', players: ['tank-dell', 'c-j-stroud', 'x', 'y', 'z'], wants: ['fun', 'nope'], format: 'both', follow: 'toro', boosts: ['draft-week', 'stale', 'unknown'], source: 'edit' }) }), ENV, ctx);
const saved = await save.json();
const wr = calls.find((c) => /feed_preferences/.test(c.url) && c.opts.method === 'POST');
const row = wr ? JSON.parse(wr.opts.body) : {};
t('a save is accepted and echoed back', save.status === 200 && saved.ok === true && saved.prefs.players.join() === 'tank-dell,c-j-stroud,x');
t('the row is an upsert on session_id with the service key', wr && /on_conflict=session_id/.test(wr.url) && /merge-duplicates/.test(wr.opts.headers.prefer) && wr.opts.headers.apikey === 'service-secret');
t('unknown lanes, presets and offers never reach the table', row.wants.join() === 'fun' && row.follow === 'toro' && row.boosts.length === 1 && row.boosts[0].key === 'draft-week' && row.boosts[0].until === '2099-04-24T00:00:00Z');
t('a boost keeps the offer\'s label, so the feed can say when it is over', row.boosts[0].label === 'Draft news');

/* ---------- the two questions and the week ---------- */
const qs = await app({ fetch: rankMock() }).fetch(req('/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: 'sess_1792089626000_k3j9xq2ab', players: [], going: 'yes', watch: 'bogus', source: 'week' }) }), ENV, ctx);
const qrow = JSON.parse(calls.filter((c) => /feed_preferences/.test(c.url) && c.opts.method === 'POST').pop().opts.body);
t('"going" and "watch" are saved as answered, an unknown answer as nothing, and the source is kept', qs.status === 200 && qrow.going === 'yes' && qrow.watch === null && qrow.source === 'week');
const wk = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_1792089626000_k3j9xq2ab'), ENV, ctx)).json();
t('a known fan gets their week back, named, with only players and types we can name', wk.week && wk.week.views === 14 && wk.week.players.length === 1 && wk.week.players[0].name === 'Tank Dell' && wk.week.players[0].n === 9
  && wk.week.types.length === 1 && wk.week.types[0].name === 'TORO skits' && wk.week.types[0].lane === 'fun');
t('the week read goes out with the service key, never the publishable one', calls.filter((c) => /rpc\/feed_week/.test(c.url)).every((c) => c.opts.headers.apikey === 'service-secret'));
const noWeek = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_1792089626000_prefsfan1'), ENV, ctx)).json();
t('a fan with no views this week has no week card', noWeek.week === null);
const wkDown = await (await app({ fetch: rankMock({ 'rpc/feed_week': async () => ({ ok: false, status: 500, json: async () => ({}) }) }) }).fetch(req('/api/feed?sid=sess_1792089626000_k3j9xq2ab'), ENV, ctx)).json();
t('a failing week read still serves the feed, ranked, without a week', wkDown.analytics.rank === 'implicit' && wkDown.week === null);
t('an anonymous request never asks for a week', (calls.length = 0, await app({ fetch: rankMock() }).fetch(req('/api/feed'), ENV, ctx), !calls.some((c) => /rpc\/feed_week/.test(c.url))));
const termEnter = await (await app().fetch(req('/enter?pid=sess_1792089626000_k3j9xq2ab&term=tank-dell'), ENV, ctx)).text();
t('/enter carries the picked player into utm_term', /name="utm_term" value="tank-dell"/.test(termEnter));
const badTerm = await (await app().fetch(req('/enter?term=' + encodeURIComponent('<b>x')), ENV, ctx)).text();
t('and a malformed term is dropped', /name="utm_term" value=""/.test(badTerm));
t('the write is stamped with the source and a time', row.source === 'edit' && row.session_id === 'sess_1792089626000_k3j9xq2ab' && typeof row.updated_at === 'string');
t('a save with no usable id is a 400', (await app({ fetch: rankMock() }).fetch(req('/api/prefs', { method: 'POST', body: JSON.stringify({ players: ['tank-dell'] }) }), ENV, ctx)).status === 400);
t('a save with bad JSON is a 400', (await app().fetch(req('/api/prefs', { method: 'POST', body: '{nope' }), ENV, ctx)).status === 400);
t('an oversized save is a 413', (await app().fetch(req('/api/prefs', { method: 'POST', body: 'x'.repeat(9000) }), ENV, ctx)).status === 413);
t('without the service key saving is refused, not silently dropped', (await app().fetch(req('/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: 'sess_1792089626000_k3j9xq2ab' }) }), {}, ctx)).status === 503);
const downSave = await app({ fetch: rankMock({ feed_preferences: async (u, o) => (o.method === 'POST' ? { ok: false, status: 500, json: async () => [] } : { ok: true, status: 200, json: async () => [] }) }) }).fetch(req('/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: 'sess_1792089626000_k3j9xq2ab', players: ['tank-dell'] }) }), ENV, ctx);
t('a failed write is a 503 the page can show', downSave.status === 503);

const noTable = await (await app({ fetch: rankMock({ feed_preferences: async (u, o) => (o.method === 'POST' ? { ok: false, status: 404, json: async () => [] } : { ok: false, status: 404, json: async () => [] }) }) }).fetch(req('/api/feed?sid=sess_0000000000000_nobodyyet'), ENV, ctx)).json();
t('before the preferences table exists the picker is withheld and the feed says why', noTable.picker === null && (noTable.warnings || []).some((w) => /feed_preferences/.test(w)));

// ---- the entry form ----
const en = await app().fetch(req('/enter?pid=sess_1792089626000_k3j9xq2ab&form=HTX_Sweeps_2026&cid=abc-123&card=sys-enter&title=Win+tickets'), ENV, ctx);
const enHtml = await en.text();
t('the entry form is served with the id, form, campaign and card filled in', en.status === 200 && /name="HTX_Sweeps_2026"/.test(enHtml) && /value="abc-123"/.test(enHtml) && /value="sess_1792089626000_k3j9xq2ab"/.test(enHtml) && /value="sys-enter"/.test(enHtml) && /<title>Win tickets<\/title>/.test(enHtml));
t('the form is private and may only be framed by the club', /no-store/.test(en.headers.get('cache-control')) && /frame-ancestors 'self' 'self' https:\/\/www\.houstontexans\.com|frame-ancestors 'self' https:\/\/www\.houstontexans\.com/.test(en.headers.get('content-security-policy')));
const badEnter = await (await app().fetch(req('/enter?pid=' + encodeURIComponent('"><script>x</script>') + '&form=' + encodeURIComponent('<b>') + '&title=' + encodeURIComponent('<img onerror=1>')), ENV, ctx)).text();
t('a malformed id, form name or title never reaches the markup', !/<script>x/.test(badEnter) && !/<b>/.test(badEnter) && !/<img/.test(badEnter) && /<title>Enter<\/title>/.test(badEnter));
t('an env default supplies the form name when the query has none', /name="ENV_FORM"/.test(await (await app().fetch(req('/enter'), { ...ENV, ELOQUA_FORM_NAME: 'ENV_FORM' }, ctx)).text()));
t('without the template the route is a 404', (await createApp({ feedHtml: 'x', deps: { fetch: mock(), cache: null } }).fetch(req('/enter'), ENV, ctx)).status === 404);

// ---- health and misc ----
const h = await app().fetch(req('/health'), ENV, ctx);
const hb = await h.json();
t('health reports ok with per-source counts', h.status === 200 && hb.ok === true && hb.counts.served === 3 && hb.events === true && hb.prefs === true && hb.experiments.join() === 'picker_pos' && hb.offers.join() === 'draft-week' && hb.offers_withheld.join() === 'chargers-week');
t('unknown paths are 404', (await app().fetch(req('/nope'), ENV, ctx)).status === 404);
t('GET on the events route is 404, not a write', (await app().fetch(req('/api/events'), ENV, ctx)).status === 404);
const boom = await app({ fetch: async () => { throw new Error('network'); } }).fetch(req('/api/feed'), ENV, ctx);
t('a total network failure is a 503 JSON, never a stack trace', boom.status === 503 && (await boom.json()).counts.served === 0);

/* ---------- the page's player ---------- */
const onPage = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?focus=tank-dell'), ENV, ctx)).json();
t('a roster page names its player and that player leads the catalogue, labelled focused', onPage.analytics.rank === 'focused' && onPage.clips[2]?.id === 'yt-Tq3sz_Yf-Nk' && onPage.clips[2].why?.kind === 'focus' && onPage.clips[2].why.label === 'Tank Dell' && onPage.focus?.slug === 'tank-dell' && onPage.focus.name === 'Tank Dell');
const noSuch = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?focus=nobody-here'), ENV, ctx)).json();
t('a slug the dictionary does not know is dropped: shared order, no focus field', noSuch.analytics.rank === 'shared' && noSuch.focus === undefined);
const banned = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?focus=joe-mixon'), ENV, ctx)).json();
t('an excluded player can never be a focus', banned.analytics.rank === 'shared' && banned.focus === undefined);
const badSlug = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?focus=' + encodeURIComponent('<img src=x>')), ENV, ctx)).json();
t('a malformed focus is ignored', badSlug.analytics.rank === 'shared' && badSlug.focus === undefined);
const pageFan = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_1792089626000_prefsfan1&focus=tank-dell'), ENV, ctx)).json();
t('a fan with picks on another player\'s page: the page wins the order, the label stays personal', pageFan.analytics.rank === 'personal' && pageFan.clips[2]?.id === 'yt-Tq3sz_Yf-Nk' && pageFan.clips[2].why?.kind === 'focus' && pageFan.prefs?.players.join() === 'c-j-stroud');

/* ---------- the site's own stories ---------- */
const withSite = await (await app({ fetch: rankMock() }).fetch(req('/api/feed'), SITE, ctx)).json();
const site = withSite.clips.filter((c) => c.source === 'pocket');
t('stories, galleries, video pages and the podcast ride along as cards', site.length === 16 && withSite.counts.pocket === 16 && site.some((c) => c.format === 'read') && site.some((c) => c.format === 'listen'));
t('a story card opens its page and keeps its dek', site.every((c) => /^https:\/\/www\.houstontexans\.com\//.test(c.action.url)) && site.some((c) => c.caption));
t('players on site cards come from the same dictionary', site.some((c) => c.entities.players.includes('c-j-stroud')));
const order = withSite.clips.filter((c) => (c.sortIndex ?? 0) >= 1_000_000).map((c) => c.format === 'read' || c.format === 'listen' ? 'R' : 'V').join('');
// Reads outnumber clips in this fixture (12 to 6), so the leftovers queue at the end; up to
// there, never two in a row.
t('the opener is a clip and reads are spaced: never two in a row until the clips run out', !/RR/.test(order.replace(/R+$/, '')) && /^VVVR/.test(order));
const both = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?sid=sess_1792089626000_prefsfan2'), SITE, ctx)).json();
t('a fan who asked for a mix still never gets two reads in a row until the clips run out', !/RR/.test(both.clips.filter((c) => (c.sortIndex ?? 0) >= 1_000_000).map((c) => c.format === 'video' ? 'V' : 'R').join('').replace(/R+$/, '')));
const siteDown = await (await app({ fetch: rankMock({ rss: async () => ({ ok: false, status: 503, text: async () => '' }) }) }).fetch(req('/api/feed'), SITE, ctx)).json();
t('the site feeds failing is a warning, and the clips still serve', siteDown.counts.pocket === 0 && siteDown.counts.served > 0 && (siteDown.warnings || []).some((w) => /pocket: news 503/.test(w)));
const siteOff = await (await app({ fetch: rankMock() }).fetch(req('/api/feed'), ENV, ctx)).json();
t('POCKET_FEEDS blank turns the source off', siteOff.counts.pocket === 0 && !siteOff.clips.some((c) => c.source === 'pocket'));
const banSite = await (await app({ fetch: rankMock({ excluded_players: async () => ({ ok: true, status: 200, json: async () => [{ name: 'Nick Caserio' }] }) }) }).fetch(req('/api/feed'), SITE, ctx)).json();
t('an excluded name on a site card drops the card', !banSite.clips.some((c) => /Caserio/.test(c.headline)) && banSite.counts.pocket < 16);

/* ---------- brand assets and formats ---------- */
const plateRes = await app().fetch(req('/app/assets/steel-916.jpg'), ENV, ctx);
t('the steel plate is served from the bundle with a year of cache', plateRes.status === 200 && plateRes.headers.get('content-type') === 'image/jpeg' && /immutable/.test(plateRes.headers.get('cache-control')));
const fontRes = await app().fetch(req('/app/assets/fonts/HelveticaNeueLTStd-BlkEx.otf'), ENV, ctx);
t('and so is the display font', fontRes.status === 200 && fontRes.headers.get('content-type') === 'font/otf');
t('an asset that was not bundled is a 404, not the page', (await app().fetch(req('/app/assets/nope.jpg'), ENV, ctx)).status === 404);
const onlyVideo = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?formats=video,listen'), SITE, ctx)).json();
t('?formats= keeps only those card formats: no stories for the news page', onlyVideo.clips.length > 0 && onlyVideo.clips.every((c) => c.format !== 'read') && onlyVideo.clips.some((c) => c.format === 'listen'));
const badFormats = await (await app({ fetch: rankMock() }).fetch(req('/api/feed?formats=bogus'), SITE, ctx)).json();
t('an unknown format filter is ignored', badFormats.clips.length === withSite.clips.length);

// ---- automated bursts are marked, like qa traffic ----
{
  const posted = [];
  const a = createApp({ feedHtml: 'x', deps: { fetch: async (url, opts = {}) => { if (/feed_events/.test(url) && opts.method === 'POST') { posted.push(...JSON.parse(opts.body)); return { ok: true, status: 201 }; } return mock()(url, opts); }, cache: null } });
  const t0 = Date.now() - 120000; // within the day the route trusts a client clock
  const burst = Array.from({ length: 12 }, (_, i) => ({ event: 'rail_open', params: { card_id: `yt-card${i}`, card_position: i + 1, pocket_id: 'sess_1792089626000_bursty' }, at: new Date(t0 + i * 20).toISOString() }));
  await a.fetch(req('/api/events', { method: 'POST', body: JSON.stringify({ events: [{ event: 'feed_load', params: { pocket_id: 'sess_1792089626000_bursty' }, at: new Date(t0).toISOString() }, ...burst] }) }), ENV, ctx);
  await Promise.all(waits.splice(0));
  t('twelve rail tiles opened inside a second mark the whole batch automated', posted.length === 13 && posted.every((r) => r.params.automated === true));
  posted.length = 0;
  const slow = Array.from({ length: 12 }, (_, i) => ({ event: 'rail_open', params: { card_id: `yt-card${i}`, card_position: i + 1, pocket_id: 'sess_1792089626000_human' }, at: new Date(t0 + i * 4000).toISOString() }));
  await a.fetch(req('/api/events', { method: 'POST', body: JSON.stringify({ events: slow }) }), ENV, ctx);
  await Promise.all(waits.splice(0));
  t('twelve tiles opened over a minute are a person and are not marked', posted.length === 12 && posted.every((r) => !('automated' in r.params)));
  posted.length = 0;
  const shares = Array.from({ length: 12 }, (_, i) => ({ event: 'card_share', params: { card_id: `yt-card${i}`, pocket_id: 'sess_1792089626000_sharer' }, at: new Date(t0 + i * 200).toISOString() }));
  await a.fetch(req('/api/events', { method: 'POST', body: JSON.stringify({ events: shares }) }), ENV, ctx);
  await Promise.all(waits.splice(0));
  t('twelve shares inside three seconds are a script and are marked', posted.length === 12 && posted.every((r) => r.params.automated === true));
  posted.length = 0;
  const likes = Array.from({ length: 12 }, (_, i) => ({ event: 'card_like', params: { card_id: `yt-card${i}`, pocket_id: 'sess_1792089626000_liker' }, at: new Date(t0 + i * 2500).toISOString() }));
  await a.fetch(req('/api/events', { method: 'POST', body: JSON.stringify({ events: likes }) }), ENV, ctx);
  await Promise.all(waits.splice(0));
  t('twelve likes over half a minute are a person', posted.length === 12 && posted.every((r) => !('automated' in r.params)));
}

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
