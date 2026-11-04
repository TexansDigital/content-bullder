/**
 * Email entry, the Worker half: POST /api/who says how a GUID is known and whether Eloqua has
 * tied it to a contact, as booleans and a word, never the contact id. Needs
 * proposals/email-entry/feed.diff applied (the feed session applies it).
 *
 *   node test/verify-email-entry-worker.mjs
 */
import { createApp } from '../workers/feed/src/app.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

// Supabase: one GUID was seen on an earlier feed session; the rest never were.
const HISTORY = { 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': ['sess_1792089626000_phone00'] };
const PICKS = { session_id: 'sess_1792089626000_phone00', players: ['tank-dell'], wants: [], format: null, follow: null, boosts: [], going: null, watch: null };
const writes = [];
// Eloqua: one visitor tied to a contact (an email click), one visitor not yet tied, the rest unknown.
const VISITORS = { 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB': { visitorId: '91', contactId: '5550001' }, 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC': { visitorId: '92', contactId: null } };
let eloquaCalls = 0;
const mock = async (url, opts = {}) => {
  if (url.startsWith('https://login.eloqua.com/id')) return res(200, { urls: { base: 'https://secure.p01.eloqua.com' }, site: { name: 'T' }, user: { displayName: 'api' } });
  if (url.includes('/api/REST/2.0/data/visitors')) {
    eloquaCalls++;
    const g = decodeURIComponent(new URL(url).searchParams.get('search') || '').match(/'([0-9A-F]{32})'/)?.[1];
    return res(200, { elements: VISITORS[g] ? [VISITORS[g]] : [] });
  }
  const path = url.split('/rest/v1/')[1] || '';
  const table = path.split('?')[0];
  const q = new URLSearchParams(path.split('?')[1] || '');
  if (table === 'feed_events') return res(200, (HISTORY[(q.get('params->>eloqua_guid') || '').replace('eq.', '')] || []).map((session_id) => ({ session_id })));
  if (table === 'feed_preferences' && opts.method === 'POST') { writes.push(JSON.parse(opts.body)); return res(201, {}); }
  if (table === 'feed_preferences') return res(200, (q.get('session_id') || '').startsWith('in.(') ? [PICKS] : []);
  if (table === 'feed_profiles') return res(200, []);
  const body = { videos: [], excluded_players: [], feed_items: [], feed_entity_aliases: [{ entity_slug: 'tank-dell', alias: 'tank dell' }], feed_presets: [], feed_boost_offers: [], feed_experiments: [], short_labels: [], feed_video_entities: [], short_content_types: [], texans_games: [] }[table];
  return res(body !== undefined ? 200 : 404, body || []);
};
const app = createApp({ feedHtml: 'x', deps: { fetch: mock, cache: null, now: () => new Date('2026-11-04T20:00:00Z') } });
const ENV = { SUPABASE_SERVICE_KEY: 'service-secret', POCKET_FEEDS: '', ELOQUA_SITE: 's', ELOQUA_USER: 'u', ELOQUA_PASSWORD: 'p' };
const who = async (guid, env = ENV, extra = {}) => (await app.fetch(new Request('https://feed.htow.nz/api/who', { method: 'POST', body: JSON.stringify({ guid, sid: 'sess_1792089626000_new0001', ...extra }) }), env, { waitUntil: () => {} })).json();

let d = await who('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
t('a GUID an earlier feed session carried is known via history, without asking Eloqua', d.known === true && d.known_via === 'history' && eloquaCalls === 0);

writes.length = 0;
d = await who('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ENV, { copy: false });
t('copy: false (no welcome card in this arm) reports the picks but writes nothing onto the session', d.known === true && d.source === 'picks' && d.copied === false && writes.length === 0);
d = await who('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
t('without copy: false the copy happens exactly as before', d.copied === true && writes.length === 1);

d = await who('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
t('a first visit from an email: Eloqua knows the visitor and has tied it to a contact', d.known === true && d.known_via === 'eloqua' && d.contact === true);
t('the contact id itself never leaves the Worker', !JSON.stringify(d).includes('5550001') && !('contactId' in d));

d = await who('cccccccccccccccccccccccccccccccc');
t('a visitor Eloqua holds but has not tied to a contact is known, contact false', d.known === true && d.known_via === 'eloqua' && d.contact === false);

d = await who('dddddddddddddddddddddddddddddddd');
t('a GUID nobody knows: not known, no via, no contact', d.known === false && d.known_via === null && d.contact === false);

d = await who('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', { SUPABASE_SERVICE_KEY: 'service-secret', POCKET_FEEDS: '' });
t('without the Eloqua secrets nothing changes from today: not known, no contact', d.known === false && d.contact === false);

console.log(`${ok.length} passed, ${bad.length} failed`);
for (const n of bad) console.log('  FAIL', n);
process.exit(bad.length ? 1 : 0);
