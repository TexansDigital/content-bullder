/**
 * The Eloqua writeback sync through mocks: the candidates RPC, the GUID to contact resolution, the
 * plan per field, the log rows, the write switch, the field lookup, and the key-protected routes.
 * Nothing here reaches the network, and nothing is written unless the test turns writes on.
 */
import { createSync, planFor, SIGNALS } from '../workers/eloqua-sync/src/sync.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

const G1 = 'ABCDEF0123456789ABCDEF0123456789'; // resolves to contact 4242
const G2 = '11111111111111111111111111111111'; // a visitor with no contact
const G3 = '22222222222222222222222222222222'; // unknown to Eloqua
const CANDIDATES = {
  generated_at: '2026-11-04T09:05:00Z', recognised_guids: 188, recognised_sessions: 186, excluded_sessions: 30, candidates_total: 3,
  candidates: [
    { guid: G1, session_id: 'sess_1', pref_updated_at: '2026-11-03T20:00:00Z', pref_source: 'picker', players: ['c-j-stroud', 'tank-dell'], players_named: ['c.j. stroud', 'tank dell'], wants: ['fun', 'tickets'], format: 'video', going: 'yes', watch: 'stadium', follow: null, boosts: [], sessions: 2, first_visit: '2026-11-01T01:00:00Z', last_visit: '2026-11-03T20:00:00Z' },
    { guid: G2, session_id: 'sess_2', pref_updated_at: '2026-11-02T20:00:00Z', pref_source: 'chip', players: ['will-anderson-jr'], players_named: ['will anderson jr'], wants: [], format: null, going: null, watch: null, follow: null, boosts: [], sessions: 1, first_visit: null, last_visit: '2026-11-02T20:00:00Z' },
    { guid: G3, session_id: 'sess_3', pref_updated_at: '2026-11-01T20:00:00Z', pref_source: 'welcome', players: ['tank-dell'], players_named: ['tank dell'], wants: [], format: null, going: 'maybe', watch: null, follow: null, boosts: [], sessions: 1, first_visit: null, last_visit: null },
  ],
};

function world({ contactField = 'C.J. Stroud', putStatus = 200 } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url === 'https://login.eloqua.com/id') return res(200, { site: { name: 'HoustonTexans' }, urls: { base: 'https://secure.p03.eloqua.com' } });
    if (/\/data\/visitors\?/.test(url)) {
      if (url.includes(G1)) return res(200, { elements: [{ visitorId: 77, contactId: 4242 }] });
      if (url.includes(G2)) return res(200, { elements: [{ visitorId: 78 }] });
      return res(200, { elements: [] });
    }
    if (/\/data\/contact\/4242(\?|$)/.test(url) && (opts.method || 'GET') === 'GET') return res(200, { id: 4242, firstName: 'Adam', emailAddress: 'secret@example.com', fieldValues: [{ id: 100001, name: 'C_Feed_Favorite_Player1', value: contactField }, { id: 100002, value: 'x' }] });
    if (/\/data\/contact\/4242(\?|$)/.test(url) && opts.method === 'PUT') return res(putStatus, {});
    if (/\/assets\/contact\/fields\?/.test(url)) return res(200, { total: 2, elements: [{ id: 100001, name: 'Feed Favorite Player', internalName: 'C_Feed_Favorite_Player1', dataType: 'text' }, { id: 100003, name: 'Favorite Player (survey)', internalName: 'C_Favorite_Player', dataType: 'text' }] });
    if (/\/rest\/v1\/rpc\/feed_eloqua_candidates$/.test(url)) return res(200, CANDIDATES);
    if (/\/rest\/v1\/feed_eloqua_writes$/.test(url)) return res(201, null);
    return res(404, {});
  };
  return { fetch, calls };
}

const BASE = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'svc', ELOQUA_SITE: 'HoustonTexans', ELOQUA_USER: 'u', ELOQUA_PASSWORD: 'p', SYNC_KEY: 'k'.repeat(24) };
const clock = () => new Date('2026-11-04T09:05:00Z');

// ---- the plan for one fan ----
{
  const p = planFor(CANDIDATES.candidates[0]);
  t('favourite player is the first pick, display-cased', p.favorite_player === 'C.J. Stroud');
  t('all picks join with a bar', p.players === 'C.J. Stroud | Tank Dell');
  t('lanes are named as the fan saw them', p.lanes === 'Fun & TORO | Gameday & tickets');
  t('going, watch and format pass through as the fan answered', p.going === 'yes' && p.watch === 'stadium' && p.format === 'video');
  t('last feed visit is a date', p.last_feed_visit === '2026-11-03');
  t('every planned key is a known signal', Object.keys(p).every((k) => SIGNALS.includes(k)));
  const q = planFor(CANDIDATES.candidates[1]);
  t('a fan with one chip pick plans only the player fields and the visit', Object.keys(q).sort().join(',') === 'favorite_player,last_feed_visit,players' && q.favorite_player === 'Will Anderson Jr');
}

// ---- dry run, no fields named ----
{
  const w = world();
  const sync = createSync({ fetch: w.fetch, now: clock });
  const out = await sync.run({ ...BASE, WRITE_ENABLED: '0', ELOQUA_FIELD_MAP: '{}' }, { write: true });
  t('a run with writes off never writes', out.writing === false && out.written === 0 && !w.calls.some((c) => c.opts.method === 'PUT'));
  t('the run carries the recognised counts from Supabase', out.recognised_guids === 188 && out.candidates === 3);
  t('one GUID resolves to a contact, one is a visitor without a contact, one is unknown', out.resolved === 1 && out.no_contact === 1 && out.unresolved === 1);
  t('every planned field with no name is dry with the reason', out.plan[0].fields.every((f) => f.status === 'dry' && f.field === null && f.reason === 'field not named'));
  t('GUIDs are masked in the answer and no name or email travels', out.plan.every((e) => /^[0-9A-F]{6}…$/.test(e.guid)) && !JSON.stringify(out).includes('Adam') && !JSON.stringify(out).includes('secret@'));
  const logged = w.calls.find((c) => /feed_eloqua_writes$/.test(c.url));
  const rows = JSON.parse(logged.opts.body);
  t('the plan is logged, one row per field, with the full GUID and the contact id', rows.length === out.planned && rows.every((r) => r.run_id === out.run_id) && rows[0].guid === G1 && rows[0].contact_id === '4242' && rows[0].status === 'dry');
  t('an unnamed field is logged under its signal in brackets', rows.every((r) => /^\(\w+\)$/.test(r.field)));
}

// ---- dry run with the favourite player field named ----
{
  const w = world({ contactField: 'Tank Dell' });
  const sync = createSync({ fetch: w.fetch, now: clock });
  const out = await sync.run({ ...BASE, WRITE_ENABLED: '0', ELOQUA_FIELD_MAP: '{"favorite_player":"C_Feed_Favorite_Player1","bogus":"x"}' }, { write: false });
  t('only known signals enter the field map', Object.keys(out.field_map).join() === 'favorite_player');
  const fav = out.plan[0].fields.find((f) => f.signal === 'favorite_player');
  t('a named field shows the contact\'s current value beside the planned one', fav.field === 'C_Feed_Favorite_Player1' && fav.value === 'C.J. Stroud' && fav.previous === 'Tank Dell' && fav.status === 'dry' && fav.reason === 'dry run');
  const fav2 = out.plan[1].fields.find((f) => f.signal === 'favorite_player');
  t('a GUID without a contact is skipped with the reason', fav2.status === 'skipped' && /no contact/.test(fav2.reason));
  t('the contact read asked only for the mapped field', w.calls.some((c) => /\/data\/contact\/4242/.test(c.url)) && !w.calls.some((c) => c.opts.method === 'PUT'));
}

// ---- the same value already on the contact ----
{
  const w = world({ contactField: 'C.J. Stroud' });
  const sync = createSync({ fetch: w.fetch, now: clock });
  const out = await sync.run({ ...BASE, WRITE_ENABLED: '1', ELOQUA_FIELD_MAP: '{"favorite_player":"C_Feed_Favorite_Player1"}' }, { write: true });
  const fav = out.plan[0].fields.find((f) => f.signal === 'favorite_player');
  t('a matching value is unchanged and never sent', fav.status === 'unchanged' && out.unchanged === 1 && !w.calls.some((c) => c.opts.method === 'PUT'));
}

// ---- writes on, field named, value differs ----
{
  const w = world({ contactField: '' });
  const sync = createSync({ fetch: w.fetch, now: clock });
  const out = await sync.run({ ...BASE, WRITE_ENABLED: '1', ELOQUA_FIELD_MAP: '{"favorite_player":"C_Feed_Favorite_Player1"}' }, { write: true });
  const put = w.calls.find((c) => c.opts.method === 'PUT');
  t('with writes on, the one mapped field is PUT on the one resolved contact', out.writing === true && out.written === 1 && put && /\/data\/contact\/4242$/.test(put.url));
  const body = JSON.parse(put.opts.body);
  t('the PUT carries only the contact id and the mapped field value', body.id === 4242 && body.fieldValues.length === 1 && body.fieldValues[0].id === 'C_Feed_Favorite_Player1' && body.fieldValues[0].value === 'C.J. Stroud' && !('emailAddress' in body));
  const rows = JSON.parse(w.calls.find((c) => /feed_eloqua_writes$/.test(c.url)).opts.body);
  t('the write is logged with the previous value', rows.find((r) => r.status === 'written' && r.field === 'C_Feed_Favorite_Player1' && r.previous === null && r.value === 'C.J. Stroud'));
  t('unnamed signals stay dry even with writes on, and the named one is skipped where no contact resolves', rows.filter((r) => r.field.startsWith('(')).every((r) => r.status === 'dry') && rows.filter((r) => r.status === 'skipped').length === 2 && out.written === 1);
  t('the cron runs the same pass', typeof sync.scheduled === 'function');
}

// ---- a refused PUT ----
{
  const w = world({ contactField: '', putStatus: 400 });
  const sync = createSync({ fetch: w.fetch, now: clock });
  const out = await sync.run({ ...BASE, WRITE_ENABLED: '1', ELOQUA_FIELD_MAP: '{"favorite_player":"C_Feed_Favorite_Player1"}' }, { write: true });
  t('a refused PUT is logged as failed with the status, not as written', out.failed === 1 && out.written === 0 && out.plan[0].fields[0].status === 'failed' && /400/.test(out.plan[0].fields[0].reason));
}

// ---- Eloqua not configured ----
{
  const w = world();
  const sync = createSync({ fetch: w.fetch, now: clock });
  const out = await sync.run({ ...BASE, ELOQUA_PASSWORD: '', ELOQUA_FIELD_MAP: '{"favorite_player":"C_Feed_Favorite_Player1"}' }, { write: false });
  const fav = out.plan[0].fields.find((f) => f.signal === 'favorite_player');
  t('without Eloqua the plan still lists the fans and the named field is skipped with the reason', out.errors.length === 1 && out.plan.length === 3 && fav.status === 'skipped' && /not reachable/.test(fav.reason) && out.resolved === 0);
}

// ---- the routes ----
{
  const w = world();
  const sync = createSync({ fetch: w.fetch, now: clock });
  const env = { ...BASE, WRITE_ENABLED: '0', ELOQUA_FIELD_MAP: '{}' };
  const req = (path, init) => new Request(`https://txfeed-eloqua-sync.texansdigital.workers.dev${path}`, init);
  let r = await sync.fetch(req('/health'), env);
  let b = await r.json();
  t('/health says the secrets are set, Eloqua answers, and writes are off', r.status === 200 && b.supabase && b.sync_key && b.eloqua === 'ok' && b.write_enabled === false);
  r = await sync.fetch(req('/dry-run'), env);
  t('/dry-run without the key is refused', r.status === 401);
  r = await sync.fetch(req('/dry-run', { headers: { 'x-sync-key': BASE.SYNC_KEY } }), env);
  b = await r.json();
  t('/dry-run with the key answers the plan and writes nothing', r.status === 200 && b.plan.length === 3 && b.written === 0);
  r = await sync.fetch(req('/run', { method: 'POST', headers: { 'x-sync-key': BASE.SYNC_KEY } }), env);
  b = await r.json();
  t('POST /run with writes off is still a dry run', b.writing === false && b.written === 0);
  r = await sync.fetch(req('/fields?q=player', { headers: { 'x-sync-key': BASE.SYNC_KEY } }), env);
  b = await r.json();
  t('/fields lists matching contact fields with id, internal name and type', b.ok && b.fields.length === 2 && b.fields[0].internalName === 'C_Feed_Favorite_Player1' && /name%3D'\*player\*'/.test(w.calls.at(-1).url));
  r = await sync.fetch(req('/dry-run'), { ...env, SYNC_KEY: '' });
  t('without a SYNC_KEY secret the key routes are not enabled', r.status === 503);
  r = await sync.fetch(req('/nope'), env);
  t('anything else is not found', r.status === 404);
}

console.log(`verify-eloqua-sync: ${ok.length} passed, ${bad.length} failed`);
for (const n of bad) console.log('  FAIL', n);
if (bad.length) process.exit(1);
