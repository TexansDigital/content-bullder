/**
 * fan-record: the nightly load behind fan_records. See wrangler.toml for the schedule and
 * docs/fan-record.md for the design. Only learned signals cross: counts, pages, games, order
 * totals, a contact id. Never a name, never an email, never an ip or user-agent hash.
 */
import { createEloqua } from '../../feed/src/eloqua.js';

const GUID = /^[0-9a-f]{32}$/;
const POCKET = /^sess_[A-Za-z0-9._:-]{6,120}$/;
// Our own traffic. Mirrors fan_excluded_session() in sql/200-fan-records.sql.
const ADAM = 'sess_1786805317298_00hak59zn';
export const excludedSession = (sid) => !sid || sid === ADAM || /(smoketest|armcheck|test)/i.test(sid);
const FIRM = 0.75; // strong (0.95) and medium (0.75) attributions; aggregate (0.5) is weak
const CHUNK = 80;

export function createFanRecord({ fetch: get = (...a) => globalThis.fetch(...a), eloqua = createEloqua(), now = () => new Date() } = {}) {
  const sb = (env, path, init = {}) => get(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });

  /** The keys the record already holds: lower-case GUIDs and pocket ids, our own removed. */
  async function keys(env) {
    const r = await sb(env, 'fan_records?select=eloqua_guid,pocket_ids&limit=50000');
    if (!r.ok) throw new Error(`fan_records answered ${r.status}`);
    const rows = await r.json();
    const guids = new Set(), pockets = new Set();
    for (const row of rows) {
      const g = String(row?.eloqua_guid || '').toLowerCase();
      if (GUID.test(g)) guids.add(g);
      for (const p of row?.pocket_ids || []) if (POCKET.test(p) && !excludedSession(p)) pockets.add(p);
    }
    return { guids: [...guids], pockets: [...pockets] };
  }

  /** D1 rows for one batch of keys, by GUID (stored upper-case in D1) or session id. */
  async function d1Batch(db, column, list) {
    const json = JSON.stringify(list);
    const match = column === 'guid' ? 'upper(c.eloqua_guid) IN (SELECT upper(value) FROM json_each(?1))' : 'c.session_id IN (SELECT value FROM json_each(?1))';
    const sql = `SELECT ${column === 'guid' ? 'lower(c.eloqua_guid)' : 'c.session_id'} AS k, c.session_id AS sid, c.source_page AS page,
        c.event_id AS event_id, g.opponent AS opponent, c.created_at AS at,
        a.purchase_id AS pid, a.confidence AS conf, a.order_total AS total, p.created_at AS pat
      FROM clicks c
      LEFT JOIN games g ON g.event_id = c.event_id
      LEFT JOIN attributions a ON a.click_id = c.click_id
      LEFT JOIN purchases p ON p.id = a.purchase_id
      WHERE ${match}`;
    const out = await db.prepare(sql).bind(json).all();
    return out?.results || [];
  }

  /** Fold click rows into one signal row per key. A GUID seen with our own session is dropped whole. */
  function fold(keyType, rows) {
    const by = new Map(), tainted = new Set();
    for (const r of rows) {
      if (r.sid && excludedSession(r.sid)) { tainted.add(r.k); continue; }
      let s = by.get(r.k);
      if (!s) by.set(r.k, s = { key_type: keyType, key: r.k, clicks: 0, first: null, last: null, pages: {}, games: {}, seenPurchase: new Set(),
        purchases: 0, purchases_weak: 0, purchase_total: 0, purchase_total_weak: 0, purchase_last_at: null, clickIds: new Set() });
      const ck = `${r.at}|${r.page}|${r.event_id}`;
      if (!s.clickIds.has(ck)) {
        s.clickIds.add(ck);
        s.clicks++;
        if (!s.first || r.at < s.first) s.first = r.at;
        if (!s.last || r.at > s.last) s.last = r.at;
        const page = String(r.page || '').slice(0, 120);
        if (page) s.pages[page] = (s.pages[page] || 0) + 1;
        if (r.event_id) { const g = s.games[r.event_id] ||= { event_id: r.event_id, opponent: r.opponent || null, n: 0 }; g.n++; }
      }
      if (r.pid != null && !s.seenPurchase.has(r.pid)) {
        s.seenPurchase.add(r.pid);
        const total = Number(r.total) || 0;
        if (Number(r.conf) >= FIRM) { s.purchases++; s.purchase_total += total; } else { s.purchases_weak++; s.purchase_total_weak += total; }
        if (r.pat && (!s.purchase_last_at || r.pat > s.purchase_last_at)) s.purchase_last_at = r.pat;
      }
    }
    const iso = (t) => (t ? new Date(String(t).replace(' ', 'T') + (String(t).endsWith('Z') ? '' : 'Z')).toISOString() : null);
    const top = (o, n, f) => Object.entries(o).sort((a, b) => (b[1].n ?? b[1]) - (a[1].n ?? a[1])).slice(0, n).map(f);
    const out = [];
    for (const [k, s] of by) {
      if (tainted.has(k)) continue;
      out.push({ key_type: s.key_type, key: s.key, clicks: s.clicks, click_first_at: iso(s.first), click_last_at: iso(s.last),
        pages: top(s.pages, 5, ([page, n]) => ({ page, n })), games: top(s.games, 5, ([, g]) => g),
        purchases: s.purchases, purchases_weak: s.purchases_weak,
        purchase_total: Math.round(s.purchase_total * 100) / 100, purchase_total_weak: Math.round(s.purchase_total_weak * 100) / 100,
        purchase_last_at: iso(s.purchase_last_at), loaded_at: now().toISOString() });
    }
    return { rows: out, tainted: [...tainted] };
  }

  async function run(env, { dry = false } = {}) {
    if (!env.SUPABASE_SERVICE_KEY || !env.ATTRIBUTION) return { ok: false, error: 'needs SUPABASE_SERVICE_KEY and the ATTRIBUTION binding' };
    const { guids, pockets } = await keys(env);
    const signals = [], tainted = [];
    for (const [type, list] of [['guid', guids], ['pocket', pockets]]) {
      for (let i = 0; i < list.length; i += CHUNK) {
        const f = fold(type, await d1Batch(env.ATTRIBUTION, type, list.slice(i, i + CHUNK)));
        signals.push(...f.rows); tainted.push(...f.tainted);
      }
    }
    let written = 0;
    if (!dry) {
      // Replace the whole staging table: a key that lost its clicks (pruned, or ours) must not linger.
      const del = await sb(env, 'fan_ticket_signals?key=neq.__none__', { method: 'DELETE', headers: { prefer: 'return=minimal' } });
      if (!del.ok) throw new Error(`clearing fan_ticket_signals answered ${del.status}`);
      if (signals.length) {
        const w = await sb(env, 'fan_ticket_signals?on_conflict=key_type,key', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(signals) });
        if (!w.ok) throw new Error(`writing fan_ticket_signals answered ${w.status}`);
        written = signals.length;
      }
    }

    // Eloqua: which GUIDs are contacts. Read only; the contact id is all that is kept.
    const asked = [];
    if (eloqua.configured(env) && guids.length) {
      const seenR = await sb(env, 'fan_eloqua_contacts?select=eloqua_guid&limit=50000');
      const seen = new Set(seenR.ok ? (await seenR.json()).map((r) => r.eloqua_guid) : []);
      const todo = guids.filter((g) => !seen.has(g) && !tainted.includes(g)).slice(0, Number(env.ELOQUA_PER_RUN) || 50);
      for (const g of todo) {
        const v = await eloqua.visitor(env, g).catch((e) => ({ found: false, error: e?.message }));
        if (v.error) continue; // not answered: ask again tomorrow rather than record "unknown"
        asked.push({ eloqua_guid: g, contact_id: v.contactId || null, known: Boolean(v.found && v.contactId), checked_at: now().toISOString() });
      }
      if (!dry && asked.length) {
        const w = await sb(env, 'fan_eloqua_contacts?on_conflict=eloqua_guid', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(asked) });
        if (!w.ok) throw new Error(`writing fan_eloqua_contacts answered ${w.status}`);
      }
    }
    return { ok: true, dry, keys: { guids: guids.length, pockets: pockets.length }, signals: signals.length, written,
      with_purchase: signals.filter((s) => s.purchases + s.purchases_weak > 0).length, ours_dropped: tainted.length,
      eloqua: { configured: eloqua.configured(env), asked: asked.length, contacts: asked.filter((a) => a.known).length } };
  }

  return {
    run, fold,
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      if (url.pathname === '/health') return json({ ok: true, supabase: Boolean(env.SUPABASE_SERVICE_KEY), d1: Boolean(env.ATTRIBUTION), eloqua: eloqua.configured(env) });
      if (url.pathname === '/run') {
        if (!env.RUN_KEY || request.headers.get('x-run-key') !== env.RUN_KEY) return json({ error: 'run key required' }, 401);
        try { return json(await run(env, { dry: url.searchParams.get('dry') === '1' })); } catch (e) { return json({ ok: false, error: e?.message }, 500); }
      }
      return json({ error: 'not found' }, 404);
    },
    async scheduled(event, env = {}, ctx) {
      const job = run(env).then((o) => console.log('fan-record', JSON.stringify(o))).catch((e) => console.error('fan-record', e?.message));
      if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
    },
  };
}

export default createFanRecord();
