/**
 * The welcome: who a recognised fan is, by their Eloqua visitor GUID, through the Worker's seam.
 * Supabase is a mock: identity events tie GUIDs to earlier sessions, those sessions may hold
 * picks or a watch profile, and the copy onto the current session is asserted on the write.
 */
import { createApp } from '../workers/feed/src/app.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const VIDEOS = [{ id: 'Tq3sz_Yf-Nk', title: 'Tank is BACK', description: '', published_at: '2026-10-20T18:00:00Z', duration_seconds: 18, thumbnail_url: null, lifetime_views: 1 }];
const ALIASES = [{ entity_slug: 'tank-dell', alias: 'tank dell' }, { entity_slug: 'c-j-stroud', alias: 'c.j. stroud' }];
const IDENTITY = {
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': ['sess_1792089626000_phone00', 'sess_1792089626000_laptop0'],   // saved picks on the phone
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': ['sess_1792089626000_watcher'],                                // only watched
  'cccccccccccccccccccccccccccccccc': ['sess_1792089626000_current'],                                // only this very session
};
const PREFS = { 'sess_1792089626000_phone00': { session_id: 'sess_1792089626000_phone00', players: ['tank-dell', 'nobody-known'], wants: ['fun'], format: 'video', follow: null, boosts: [], going: 'yes', watch: 'home' },
  'sess_1792089626000_hasown': { session_id: 'sess_1792089626000_hasown', players: ['c-j-stroud'], wants: [], format: null, follow: null, boosts: [], going: null, watch: null } };
const PROFILES = { 'sess_1792089626000_watcher': { entity_weights: { 'player:tank-dell': 3, 'player:c-j-stroud': 1, 'player:nobody-known': 9 } } };
const writes = [];
const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const mock = async (url, opts = {}) => {
  const path = url.split('/rest/v1/')[1] || '';
  const table = path.split('?')[0];
  const q = new URLSearchParams(path.split('?')[1] || '');
  if (table === 'feed_preferences' && opts.method === 'POST') { writes.push(JSON.parse(opts.body)); return res(201, {}); }
  if (table === 'feed_events' && q.get('event') === 'eq.identity') {
    const g = (q.get('params->>eloqua_guid') || '').replace('eq.', '');
    return res(200, (IDENTITY[g] || []).map((session_id) => ({ session_id })));
  }
  if (table === 'feed_preferences') {
    const sel = q.get('session_id') || '';
    if (sel.startsWith('eq.')) { const one = sel.slice(3); return res(200, PREFS[one] ? [PREFS[one]] : []); }
    if (!sel.startsWith('in.(')) return res(200, []);
    const list = (q.get('session_id') || '').replace(/^in\.\(|\)$/g, '').split(',').map(decodeURIComponent);
    return res(200, list.map((s) => PREFS[s]).filter(Boolean));
  }
  if (table === 'feed_profiles') {
    const list = (q.get('session_id') || '').replace(/^in\.\(|\)$/g, '').split(',').map(decodeURIComponent);
    return res(200, list.map((s) => PROFILES[s]).filter(Boolean));
  }
  const body = { videos: VIDEOS, excluded_players: [], feed_items: [], feed_entity_aliases: ALIASES, feed_presets: [], feed_boost_offers: [], feed_experiments: [], short_labels: [], feed_video_entities: [], short_content_types: [], texans_games: [] }[table];
  return res(body !== undefined ? 200 : 404, body || []);
};
const app = createApp({ feedHtml: 'x', deps: { fetch: mock, cache: null, now: () => new Date('2026-11-03T20:00:00Z') } });
const ENV = { SUPABASE_SERVICE_KEY: 'service-secret', POCKET_FEEDS: '' };
const ctx = { waitUntil: () => {} };
const who = (body, env = ENV) => app.fetch(new Request('https://feed.htow.nz/api/who', { method: 'POST', body: JSON.stringify(body) }), env, ctx);

let r = await who({ guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sid: 'sess_1792089626000_laptop1' });
let d = await r.json();
t('a fan who saved picks on another device is known, gets those picks named, and they are copied onto this session', r.status === 200 && d.known && d.source === 'picks' && d.picks.join() === 'tank-dell' && d.picks_named.join() === 'Tank Dell' && d.copied === true);
t('the copy carries the whole saved row under this session, marked welcome', writes.length === 1 && writes[0].session_id === 'sess_1792089626000_laptop1' && writes[0].players.join() === 'tank-dell' && writes[0].going === 'yes' && writes[0].source === 'welcome');
t('a pick the dictionary does not know is dropped from the answer and the copy', !d.picks.includes('nobody-known') && !writes[0].players.includes('nobody-known'));
t('nothing personal is in the answer', !JSON.stringify(d).match(/email|name":"[A-Z]/));

writes.length = 0;
r = await who({ guid: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', sid: 'sess_1792089626000_hasown' });
d = await r.json();
t('a session that already has its own picks keeps them: picks reported, nothing copied', d.known && d.source === 'picks' && d.copied === false && writes.length === 0);

r = await who({ guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', sid: 'sess_1792089626000_new0001' });
d = await r.json();
t('a fan we only watched gets the player they watch most, named, with no copy', d.known && d.source === 'watch' && d.player === 'tank-dell' && d.player_name === 'Tank Dell' && d.picks === null && d.copied === false && writes.length === 0);

r = await who({ guid: 'cccccccccccccccccccccccccccccccc', sid: 'sess_1792089626000_current' });
d = await r.json();
t('a GUID seen only on the asking session is not known: nothing to say yet', d.known === false && d.picks === null && d.player === null);

r = await who({ guid: 'dddddddddddddddddddddddddddddddd', sid: 'sess_1792089626000_new0002' });
d = await r.json();
t('a GUID never seen, with Eloqua not configured, is not known', d.known === false);

r = await who({ guid: 'nope', sid: 'sess_1792089626000_new0002' });
t('a malformed GUID is a 400', r.status === 400);
r = await who({ guid: 'dddddddddddddddddddddddddddddddd', sid: 'x' });
t('a malformed session id is a 400', r.status === 400);
r = await who({ guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sid: 'sess_1792089626000_laptop2' }, { POCKET_FEEDS: '' });
t('without the service key the route says it is not enabled', r.status === 503);

// Known through Eloqua alone: a visitor the pod recognises, with no feed history yet.
{
  const mock2 = async (url, opts) => {
    if (url === 'https://login.eloqua.com/id') return res(200, { urls: { base: 'https://secure.p03.eloqua.com' } });
    if (/\/data\/visitors\?/.test(url)) return res(200, { elements: [{ visitorId: 1, contactId: 7 }] });
    return mock(url, opts);
  };
  const app2 = createApp({ feedHtml: 'x', deps: { fetch: mock2, cache: null } });
  const r2 = await app2.fetch(new Request('https://feed.htow.nz/api/who', { method: 'POST', body: JSON.stringify({ guid: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', sid: 'sess_1792089626000_new0003' }) }), { ...ENV, ELOQUA_SITE: 's', ELOQUA_USER: 'u', ELOQUA_PASSWORD: 'p' }, ctx);
  const d2 = await r2.json();
  t('a visitor Eloqua recognises is known even with no feed history, and has nothing to show yet', d2.known === true && d2.picks === null && d2.player === null);
}

// The save path accepts the welcome as a source.
{
  const w2 = [];
  const app3 = createApp({ feedHtml: 'x', deps: { fetch: async (url, opts = {}) => { if (/feed_preferences/.test(url) && opts.method === 'POST') { w2.push(JSON.parse(opts.body)); return res(201, {}); } return mock(url, opts); }, cache: null } });
  await app3.fetch(new Request('https://feed.htow.nz/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: 'sess_1792089626000_new0004', players: ['tank-dell'], source: 'welcome' }) }), ENV, ctx);
  t('a pick made from the welcome card is saved with source welcome', w2.length === 1 && w2[0].source === 'welcome' && w2[0].players.join() === 'tank-dell');
}

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
