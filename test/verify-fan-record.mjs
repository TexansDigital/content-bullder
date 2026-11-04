/**
 * The fan-record loader through mocks: D1 click rows fold into one signal per key, firm and weak
 * purchases stay apart, a GUID seen with our own session is dropped whole, nothing personal
 * crosses, a dry run writes nothing, and Eloqua answers become a contact id and nothing else.
 */
import { createFanRecord, excludedSession } from '../workers/fan-record/src/index.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const G1 = '242c094a665f40ea99bf430702706ca0';
const G2 = '8e83a0acc74e44dc8c6045ba6de55066';
const ADAMS = 'b443c4963f5f4843be7957cc12307b56';
const P1 = 'sess_1793000000000_abcdefghi';

const d1Rows = {
  guid: [
    { k: G1, sid: null, page: '/news/how-to-watch', event_id: 'E1', opponent: 'Giants', at: '2026-10-18 16:17:02', pid: null, conf: null, total: null, pat: null },
    { k: G1, sid: null, page: '/', event_id: 'E1', opponent: 'Giants', at: '2026-10-19 18:34:03', pid: 7, conf: 0.5, total: 560, pat: '2026-10-19 19:00:00' },
    { k: G1, sid: null, page: '/', event_id: 'E1', opponent: 'Giants', at: '2026-10-19 22:52:42', pid: null, conf: null, total: null, pat: null },
    { k: G2, sid: null, page: '/', event_id: 'E1', opponent: 'Giants', at: '2026-10-18 16:15:34', pid: 9, conf: 0.95, total: 350, pat: '2026-10-18 17:00:00' },
    { k: ADAMS, sid: null, page: '/schedule/', event_id: 'E2', opponent: 'Colts', at: '2026-10-25 20:53:04', pid: null },
    { k: ADAMS, sid: 'sess_1786805317298_00hak59zn', page: '/schedule/', event_id: 'E2', opponent: 'Colts', at: '2026-10-31 20:30:00', pid: null },
  ],
  pocket: [],
};
const db = { prepare: (sql) => ({ bind: () => ({ all: async () => ({ results: /lower\(c\.eloqua_guid\)/.test(sql) ? d1Rows.guid : d1Rows.pocket }) }) }) };

const writes = [];
const supa = async (url, init = {}) => {
  const path = url.split('/rest/v1/')[1];
  if (init.method === 'POST' || init.method === 'DELETE') { writes.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null }); return res(201, null); }
  if (path.startsWith('fan_records')) return res(200, [
    { eloqua_guid: G1, pocket_ids: [P1] }, { eloqua_guid: G2, pocket_ids: [] }, { eloqua_guid: ADAMS, pocket_ids: ['sess_1786805317298_00hak59zn'] },
  ]);
  if (path.startsWith('fan_eloqua_contacts')) return res(200, [{ eloqua_guid: G2 }]);
  return res(404, null);
};
const eloqua = {
  configured: (env) => Boolean(env.ELOQUA_SITE),
  visitor: async (env, g) => (g === G1 ? { found: true, contactId: '4242', visitedAt: 1, email: 'never@example.com' } : { found: false }),
};
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k', ATTRIBUTION: db, ELOQUA_SITE: 's', ELOQUA_USER: 'u', ELOQUA_PASSWORD: 'p' };
const app = createFanRecord({ fetch: supa, eloqua, now: () => new Date('2026-11-04T08:45:00Z') });

t('Adam, smoketest, armcheck and test sessions are ours', excludedSession('sess_1786805317298_00hak59zn') && excludedSession('sess_1_smoketest') && excludedSession('sess_1_armcheck') && excludedSession('sess_1_test9') && !excludedSession(P1));

let out = await app.run(ENV, { dry: true });
t('a dry run reads keys and D1 but writes nothing', out.ok && out.dry && writes.length === 0 && out.signals === 2);
t('a GUID seen with our own session is dropped whole', out.ours_dropped === 1);

out = await app.run(ENV);
const sig = writes.find((w) => w.path.startsWith('fan_ticket_signals?on_conflict'))?.body || [];
const g1 = sig.find((s) => s.key === G1), g2 = sig.find((s) => s.key === G2);
t('the staging table is cleared before it is refilled', writes[0].method === 'DELETE' && writes[0].path.startsWith('fan_ticket_signals'));
t('three clicks fold into one row with the game named', g1 && g1.clicks === 3 && g1.games[0].opponent === 'Giants' && g1.games[0].n === 3);
t('an aggregate match is a weak purchase, not a firm one', g1.purchases === 0 && g1.purchases_weak === 1 && g1.purchase_total_weak === 560 && g1.purchase_total === 0);
t('a strong match is a firm purchase', g2.purchases === 1 && g2.purchase_total === 350);
t('times arrive as ISO in UTC', g1.click_first_at === '2026-10-18T16:17:02.000Z');
t('Adam\'s GUID never reaches Supabase', !JSON.stringify(writes).includes(ADAMS));
t('no ip or user-agent hash crosses', !/ip_hash|ua_hash/.test(JSON.stringify(writes)));

const contacts = writes.find((w) => w.path.startsWith('fan_eloqua_contacts'))?.body || [];
t('Eloqua is asked only about GUIDs it has not answered before', contacts.length === 1 && contacts[0].eloqua_guid === G1);
t('a contact is kept as its id and nothing else', contacts[0].contact_id === '4242' && contacts[0].known === true && !JSON.stringify(contacts).includes('example.com'));

const health = await (await app.fetch(new Request('https://x/health'), ENV)).json();
t('/health says what is configured', health.supabase && health.d1 && health.eloqua);
const denied = await app.fetch(new Request('https://x/run?dry=1'), { ...ENV, RUN_KEY: 'r' });
t('/run needs the run key', denied.status === 401);

console.log(ok.map((n) => `ok   ${n}`).join('\n'));
if (bad.length) { console.log(bad.map((n) => `FAIL ${n}`).join('\n')); process.exit(1); }
console.log(`\n${ok.length} passed`);
