/**
 * The Eloqua writeback sync through mocks: candidates from Supabase, GUID to contact, the CDO
 * found by name with its fields by name, one record per contact (created once, then updated),
 * the write switch, merged GUIDs, the log rows, and the key-protected routes.
 * Nothing here reaches the network.
 */
import { createSync, planFor, SIGNALS } from '../workers/eloqua-sync/src/sync.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

const G1 = 'ABCDEF0123456789ABCDEF0123456789'; // contact 4242
const G2 = '11111111111111111111111111111111'; // visitor without a contact
const G3 = '22222222222222222222222222222222'; // unknown to Eloqua
const G4 = '33333333333333333333333333333333'; // a second device of contact 4242, older picks
const cand = (guid, over = {}) => ({ guid, session_id: 's', pref_updated_at: '2026-11-03T20:00:00Z', pref_source: 'picker', players: ['c-j-stroud', 'tank-dell'], players_named: ['c.j. stroud', 'tank dell'], wants: ['fun', 'tickets'], format: 'video', going: 'yes', watch: 'stadium', follow: null, boosts: [], sessions: 2, first_visit: null, last_visit: '2026-11-03T20:00:00Z', ...over });
const CANDIDATES = {
  recognised_guids: 188, recognised_sessions: 186, excluded_sessions: 28, candidates_total: 4,
  candidates: [
    cand(G1),
    cand(G2, { players: ['will-anderson-jr'], players_named: ['will anderson jr'], wants: [], format: null, going: null, watch: null }),
    cand(G3, { players: ['tank-dell'], players_named: ['tank dell'], wants: [] }),
    cand(G4, { pref_updated_at: '2026-11-01T20:00:00Z', players: ['tank-dell'], players_named: ['tank dell'] }),
  ],
};
const CDO = { id: 55, name: 'Feed Preferences', fields: [
  { id: 901, name: 'Contact ID', internalName: 'Contact_ID1', dataType: 'text' },
  { id: 902, name: 'Favorite Player', internalName: 'Favorite_Player1', dataType: 'text' },
  { id: 903, name: 'Updated At', internalName: 'Updated_At1', dataType: 'date' },
] };

function world({ cdo = CDO, records = [], instance = null, saveStatus = 201 } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body });
    if (url === 'https://login.eloqua.com/id') return res(200, { site: { name: 'HoustonTexans' }, urls: { base: 'https://secure.p03.eloqua.com' } });
    if (/\/data\/visitors\?/.test(url)) {
      if (url.includes(G1) || url.includes(G4)) return res(200, { elements: [{ visitorId: 77, contactId: 4242 }] });
      if (url.includes(G2)) return res(200, { elements: [{ visitorId: 78 }] });
      return res(200, { elements: [] });
    }
    if (/\/assets\/customObjects\?/.test(url)) return res(200, { elements: cdo ? [cdo] : [] });
    if (/\/data\/customObject\/55\/instance\/\d+$/.test(url) && method === 'GET') return instance ? res(200, instance) : res(404, {});
    if (/\/data\/customObject\/55\/instance\/\d+$/.test(url) && method === 'PUT') return res(saveStatus === 201 ? 200 : saveStatus, { id: url.split('/').pop() });
    if (/\/data\/customObject\/55\/instance$/.test(url) && method === 'POST') return res(saveStatus, { id: '7001' });
    if (/\/rest\/v1\/rpc\/feed_eloqua_candidates$/.test(url)) return res(200, CANDIDATES);
    if (/\/rest\/v1\/feed_eloqua_cdo_records\?select/.test(url)) return res(200, records);
    if (/\/rest\/v1\/feed_eloqua_cdo_records\?on_conflict/.test(url)) return res(201, null);
    if (/\/rest\/v1\/feed_eloqua_writes$/.test(url)) return res(201, null);
    return res(404, {});
  };
  return { fetch, calls };
}
const BASE = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'svc', ELOQUA_SITE: 'HoustonTexans', ELOQUA_USER: 'u', ELOQUA_PASSWORD: 'p', SYNC_KEY: 'k'.repeat(24), ELOQUA_CDO_NAME: 'Feed Preferences', ELOQUA_CDO_SIGNALS: 'favorite_player', WRITE_ENABLED: '1' };
const clock = () => new Date('2026-11-04T09:05:00Z');
const logged = (w) => JSON.parse(w.calls.find((c) => /feed_eloqua_writes$/.test(c.url)).body);
const saves = (w) => w.calls.filter((c) => /\/data\/customObject\/55\/instance/.test(c.url) && c.method !== 'GET');

// ---- the plan for one fan ----
{
  const p = planFor(CANDIDATES.candidates[0]);
  t('favourite player is the first pick, display-cased', p.favorite_player === 'C.J. Stroud');
  t('lanes are named as the fan saw them', p.lanes === 'Fun & TORO | Gameday & tickets');
  t('every planned key is a known signal', Object.keys(p).every((k) => SIGNALS.includes(k)));
}

// ---- first run: the record is created, linked to the contact, keyed and stamped ----
{
  const w = world();
  const out = await createSync({ fetch: w.fetch, now: clock }).run(BASE, { write: true });
  const s = saves(w);
  t('one CDO record is created for the one resolved contact', s.length === 1 && s[0].method === 'POST' && out.created === 1 && out.written === 1);
  const body = JSON.parse(s[0].body);
  t('the record is linked to the contact and carries the key, the pick and the stamp', body.contactId === '4242' && body.fieldValues.some((f) => f.id === '901' && f.value === '4242') && body.fieldValues.some((f) => f.id === '902' && f.value === 'C.J. Stroud') && body.fieldValues.some((f) => f.id === '903' && f.value === String(Math.floor(clock().getTime() / 1000))));
  t('only the live signal is sent', body.fieldValues.length === 3);
  t('the record id is remembered for the next run', w.calls.some((c) => /feed_eloqua_cdo_records\?on_conflict/.test(c.url) && JSON.parse(c.body).instance_id === '7001'));
  t('the CDO was found by name and reports its fields', out.cdo.id === '55' && out.cdo.key_field && out.cdo.fields[0].found);
  t('the second device of the same contact is merged, not written twice', out.merged === 1 && out.plan[3].fields.every((f) => f.status === 'skipped' && /merged/.test(f.reason)));
  t('one resolved, one visitor without a contact, one unknown', out.resolved === 2 && out.no_contact === 1 && out.unresolved === 1);
  const rows = logged(w);
  t('signals not yet live are logged as dry with the reason', rows.filter((r) => r.field === 'Lanes' && r.guid === G1).every((r) => r.status === 'dry' && /not live/.test(r.reason)));
  t('the written row carries the CDO and record ids', rows.some((r) => r.status === 'written' && r.cdo_id === '55' && r.instance_id === '7001' && r.guid === G1));
  t('GUIDs are masked in the answer and no name or email travels', out.plan.every((e) => /^[0-9A-F]{6}…$/.test(e.guid)) && !/secret@|firstName/.test(JSON.stringify(out)));
}

// ---- later run: the known record is updated, or left alone when unchanged ----
{
  const rec = [{ contact_id: '4242', cdo_id: '55', instance_id: '7001' }];
  let w = world({ records: rec, instance: { id: '7001', fieldValues: [{ id: '902', value: 'Tank Dell' }] } });
  let out = await createSync({ fetch: w.fetch, now: clock }).run(BASE, { write: true });
  let s = saves(w);
  t('a known record is updated in place with PUT', s.length === 1 && s[0].method === 'PUT' && /instance\/7001$/.test(s[0].url) && out.created === 0 && out.written === 1);
  t('the previous value is logged beside the new one', logged(w).some((r) => r.status === 'written' && r.previous === 'Tank Dell' && r.value === 'C.J. Stroud'));
  w = world({ records: rec, instance: { id: '7001', fieldValues: [{ id: '902', value: 'C.J. Stroud' }] } });
  out = await createSync({ fetch: w.fetch, now: clock }).run(BASE, { write: true });
  t('a value the record already holds is unchanged and nothing is sent', saves(w).length === 0 && out.unchanged === 1);
  w = world({ records: rec, instance: null });
  out = await createSync({ fetch: w.fetch, now: clock }).run(BASE, { write: true });
  t('a remembered record deleted in Eloqua is created again', saves(w)[0]?.method === 'POST' && out.created === 1);
}

// ---- the gates ----
{
  let w = world();
  let out = await createSync({ fetch: w.fetch, now: clock }).run({ ...BASE, WRITE_ENABLED: '0' }, { write: true });
  t('with WRITE_ENABLED off nothing is written and the row says dry run', saves(w).length === 0 && out.plan[0].fields[0].status === 'dry' && out.plan[0].fields[0].reason === 'dry run');
  w = world();
  out = await createSync({ fetch: w.fetch, now: clock }).run(BASE, { write: false });
  t('a dry run never writes even with the switch on', saves(w).length === 0 && out.dry > 0);
  w = world({ cdo: null });
  out = await createSync({ fetch: w.fetch, now: clock }).run(BASE, { write: true });
  t('before the CDO exists, the live field is skipped with the reason and nothing is written', saves(w).length === 0 && out.plan[0].fields[0].status === 'skipped' && /no CDO named "Feed Preferences"/.test(out.plan[0].fields[0].reason));
  w = world({ cdo: { ...CDO, fields: CDO.fields.filter((f) => f.id !== 902) } });
  out = await createSync({ fetch: w.fetch, now: clock }).run(BASE, { write: true });
  t('a CDO without the signal\'s field writes nothing and says which field is missing', saves(w).length === 0 && /no "Favorite Player" field/.test(out.plan[0].fields[0].reason));
  w = world({ saveStatus: 400 });
  out = await createSync({ fetch: w.fetch, now: clock }).run(BASE, { write: true });
  t('a refused save is logged as failed, the record is not remembered', out.failed === 1 && out.written === 0 && !w.calls.some((c) => /on_conflict/.test(c.url)));
  w = world();
  out = await createSync({ fetch: w.fetch, now: clock }).run({ ...BASE, ELOQUA_PASSWORD: '' }, { write: true });
  t('without Eloqua the plan still lists the fans and nothing is written', out.plan.length === 4 && saves(w).length === 0 && out.errors.length >= 1);
}

// ---- the routes ----
{
  const w = world();
  const sync = createSync({ fetch: w.fetch, now: clock });
  const req = (path, init) => new Request(`https://txfeed-eloqua-sync.texansdigital.workers.dev${path}`, init);
  const key = { headers: { 'x-sync-key': BASE.SYNC_KEY } };
  let r = await sync.fetch(req('/health'), BASE);
  let b = await r.json();
  t('/health names the CDO, the live signals and the switch', b.eloqua === 'ok' && b.write_enabled === true && b.cdo_name === 'Feed Preferences' && b.live_signals.join() === 'favorite_player');
  t('/dry-run without the key is refused', (await sync.fetch(req('/dry-run'), BASE)).status === 401);
  b = await (await sync.fetch(req('/dry-run', key), BASE)).json();
  t('/dry-run with the key plans and never writes', b.plan.length === 4 && b.written === 0 && saves(w).length === 0);
  b = await (await sync.fetch(req('/cdo', key), BASE)).json();
  t('/cdo shows the CDO, its fields and which signals land', b.ok && b.id === '55' && b.key_field && b.signals.find((s) => s.signal === 'favorite_player').found);
  b = await (await sync.fetch(req('/cdo', key), { ...BASE, ELOQUA_CDO_NAME: 'Nope' })).json();
  t('/cdo before it exists says which fields to create', b.ok === false && b.needs.includes('Contact ID') && b.needs.includes('Favorite Player'));
  t('without a SYNC_KEY secret the key routes are not enabled', (await sync.fetch(req('/dry-run'), { ...BASE, SYNC_KEY: '' })).status === 503);
  t('the daily cron runs the same pass', typeof sync.scheduled === 'function');
}

console.log(`verify-eloqua-sync: ${ok.length} passed, ${bad.length} failed`);
for (const n of bad) console.log('  FAIL', n);
if (bad.length) process.exit(1);
