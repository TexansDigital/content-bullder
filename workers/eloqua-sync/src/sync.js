/**
 * The feed's picks onto the Eloqua contact. Workstream 2 (docs/workstreams.md).
 *
 * Read only until Adam names the fields and says go. One pass:
 *   1. feed_eloqua_candidates() in Supabase: one row per recognised GUID (clean sessions only)
 *      with the newest preference row across that fan's sessions.
 *   2. The GUID resolves to a visitor, the visitor to a contact (workers/feed/src/eloqua.js,
 *      the feed's own client, imported read only).
 *   3. Each signal becomes one planned write: a field, a value, the contact's current value.
 *   4. The plan is logged to feed_eloqua_writes. With WRITE_ENABLED=1 and a field in the map,
 *      the contact is updated (REST 1.0 PUT, only the mapped fields) and the row says 'written';
 *      otherwise 'dry'. A field whose value already matches is 'unchanged' and never sent.
 *
 * Never a name, never an email: the contact read returns the id and the mapped fields' current
 * values, and the log holds the GUID, the contact id, the field and the two values.
 */
import { createEloqua } from '../../feed/src/eloqua.js';
import { displayName } from '../../../src/rank.js';

export const SIGNALS = ['favorite_player', 'players', 'lanes', 'format', 'going', 'watch', 'last_feed_visit'];
const LANE_NAMES = { game: 'Game action', hype: 'Gameday hype', inside: "Mic'd up & inside", coaches: 'DeMeco & the coaches', music: 'Music & 713', fun: 'Fun & TORO', community: 'Community', tickets: 'Gameday & tickets' };
const GUID = /^[0-9A-F]{32}$/;

/** What each candidate would write, by signal. Values are short, plain, and the fan's own words where there are any. */
export function planFor(c) {
  const out = {};
  const named = Array.isArray(c.players_named) && c.players_named.length ? c.players_named : (c.players || []).map((s) => displayName(s));
  const players = named.map((n) => displayName(String(n).toLowerCase())).filter(Boolean);
  if (players[0]) out.favorite_player = players[0];
  if (players.length) out.players = players.join(' | ');
  const lanes = (c.wants || []).map((w) => LANE_NAMES[w] || w).filter(Boolean);
  if (lanes.length) out.lanes = lanes.join(' | ');
  if (c.format) out.format = c.format;
  if (c.going) out.going = c.going;
  if (c.watch) out.watch = c.watch;
  if (c.last_visit) { const d = new Date(c.last_visit); if (Number.isFinite(d.getTime())) out.last_feed_visit = d.toISOString().slice(0, 10); }
  return out;
}

export function createSync({ fetch: get = (...a) => globalThis.fetch(...a), now = () => new Date() } = {}) {
  const eloqua = createEloqua({ fetch: get, now: () => now().getTime() });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  const mask = (g) => (g ? `${String(g).slice(0, 6)}…` : null);

  const fieldMap = (env) => {
    try { const m = JSON.parse(env.ELOQUA_FIELD_MAP || '{}'); return m && typeof m === 'object' ? Object.fromEntries(Object.entries(m).filter(([k, v]) => SIGNALS.includes(k) && v)) : {}; } catch { return {}; }
  };
  const writesOn = (env) => String(env.WRITE_ENABLED || '0') === '1';

  function authorized(request, env) {
    if (!env.SYNC_KEY) return json({ error: 'not enabled: set the SYNC_KEY secret' }, 503);
    const given = request.headers.get('x-sync-key') || '';
    if (given.length !== env.SYNC_KEY.length || given !== env.SYNC_KEY) return json({ error: 'wrong sync key' }, 401);
    return null;
  }

  const supa = (env) => ({ base: String(env.SUPABASE_URL || '').replace(/\/$/, ''), key: env.SUPABASE_SERVICE_KEY });
  async function rpcCandidates(env) {
    const { base, key } = supa(env);
    if (!base || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are needed');
    const days = Math.max(1, Math.min(365, Number(env.LOOKBACK_DAYS) || 90));
    const lim = Math.max(1, Math.min(2000, Number(env.RUN_MAX) || 200));
    const r = await get(`${base}/rest/v1/rpc/feed_eloqua_candidates`, { method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ lookback: `${days} days`, lim }) });
    if (!r.ok) throw new Error(`feed_eloqua_candidates answered ${r.status}`);
    const d = await r.json();
    return d && typeof d === 'object' ? d : { candidates: [] };
  }
  async function log(env, rows) {
    if (!rows.length) return false;
    const { base, key } = supa(env);
    const r = await get(`${base}/rest/v1/feed_eloqua_writes`, { method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify(rows) }).catch(() => null);
    return Boolean(r && r.ok);
  }

  /** Eloqua contact fields whose name matches q: id, name, internalName, dataType. For naming the map. */
  async function fields(env, q) {
    const l = await eloqua.login(env);
    if (!l.ok) return { ok: false, error: l.error || 'not configured' };
    const term = String(q || '').replace(/[^A-Za-z0-9 _-]/g, '').trim();
    const search = term ? `&search=${encodeURIComponent(`name='*${term}*'`)}` : '';
    const r = await get(`${l.base}/api/REST/1.0/assets/contact/fields?depth=minimal&count=200${search}`, { headers: { authorization: 'Basic ' + btoa(`${env.ELOQUA_SITE}\\${env.ELOQUA_USER}:${env.ELOQUA_PASSWORD}`), accept: 'application/json', 'user-agent': 'txfeed-eloqua-sync/1' } });
    if (!r.ok) return { ok: false, error: `fields answered ${r.status}` };
    const d = await r.json();
    return { ok: true, total: d?.total ?? null, fields: (d?.elements || []).map((f) => ({ id: String(f.id), name: f.name, internalName: f.internalName, dataType: f.dataType, updateType: f.updateType || null })) };
  }

  /** PUT the mapped fields onto one contact. Only called with WRITE_ENABLED=1. */
  async function putContact(env, base, contactId, fieldValues) {
    const r = await get(`${base}/api/REST/1.0/data/contact/${contactId}`, { method: 'PUT',
      headers: { authorization: 'Basic ' + btoa(`${env.ELOQUA_SITE}\\${env.ELOQUA_USER}:${env.ELOQUA_PASSWORD}`), accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'txfeed-eloqua-sync/1' },
      body: JSON.stringify({ id: Number(contactId), fieldValues }) });
    return r.ok ? { ok: true } : { ok: false, status: r.status };
  }

  /**
   * One pass. `write` is the caller's intent; the actual write needs WRITE_ENABLED=1 as well.
   * Answers the summary plus the plan, GUIDs masked and never a name.
   */
  async function run(env, { write = false } = {}) {
    const runId = `run_${now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    const map = fieldMap(env);
    const writing = write && writesOn(env);
    const out = { run_id: runId, writing, field_map: map, recognised_guids: 0, candidates: 0, resolved: 0, unresolved: 0, no_contact: 0,
      planned: 0, written: 0, unchanged: 0, skipped: 0, failed: 0, plan: [], errors: [] };
    let data;
    try { data = await rpcCandidates(env); } catch (e) { out.errors.push(e.message); return out; }
    out.recognised_guids = Number(data.recognised_guids || 0);
    out.recognised_sessions = Number(data.recognised_sessions || 0);
    out.excluded_sessions = Number(data.excluded_sessions || 0);
    const cands = Array.isArray(data.candidates) ? data.candidates : [];
    out.candidates = Number(data.candidates_total ?? cands.length);
    const l = await eloqua.login(env);
    if (!l.ok) { out.errors.push(l.error || 'Eloqua is not configured'); }
    const rows = [];
    for (const c of cands) {
      const guid = String(c.guid || '').toUpperCase();
      if (!GUID.test(guid)) continue;
      const plan = planFor(c);
      const entry = { guid: mask(guid), sessions: c.sessions || 0, pref_source: c.pref_source || null, pref_updated_at: c.pref_updated_at || null, contact_id: null, fields: [] };
      let contactId = null, current = {};
      if (l.ok) {
        const v = await eloqua.visitor(env, guid.toLowerCase()).catch(() => ({ found: false }));
        if (v.found && v.contactId) {
          contactId = v.contactId; out.resolved += 1;
          const want = Object.values(map);
          const ct = await eloqua.contact(env, contactId, { fields: want }).catch(() => ({ found: false }));
          if (ct.found) current = ct.custom || {}; else { contactId = null; out.resolved -= 1; out.no_contact += 1; }
        } else if (v.found) { out.no_contact += 1; } else { out.unresolved += 1; }
      }
      entry.contact_id = contactId;
      const toSend = [];
      for (const [signal, value] of Object.entries(plan)) {
        const field = map[signal] || null;
        const previous = field && current[field] != null ? String(current[field]) : null;
        let status = 'dry', reason = null;
        if (!field) reason = 'field not named';
        else if (!contactId) { status = 'skipped'; reason = l.ok ? 'no contact for this GUID' : 'Eloqua not reachable'; }
        else if (previous === value) status = 'unchanged';
        else if (writing) { status = 'written'; toSend.push({ id: field, value }); }
        else reason = 'dry run';
        entry.fields.push({ signal, field, value, previous, status, reason });
        rows.push({ run_id: runId, guid, contact_id: contactId, field: field || `(${signal})`, value, previous, status, reason });
      }
      if (toSend.length) {
        const w = await putContact(env, l.base, contactId, toSend.map((f) => ({ id: f.id, value: f.value })));
        if (!w.ok) for (const r of rows) if (r.run_id === runId && r.contact_id === contactId && r.status === 'written') { r.status = 'failed'; r.reason = `contact PUT answered ${w.status}`; }
        for (const f of entry.fields) { const r = rows.find((x) => x.contact_id === contactId && x.field === f.field && x.value === f.value); if (r) { f.status = r.status; f.reason = r.reason; } }
      }
      out.plan.push(entry);
    }
    for (const r of rows) { out.planned += 1; if (r.status in out) out[r.status] += 1; }
    out.logged = await log(env, rows);
    return out;
  }

  return {
    async fetch(request, env = {}, ctx) {
      const url = new URL(request.url);
      const p = url.pathname.replace(/\/+$/, '') || '/';
      try {
        if (request.method === 'GET' && (p === '/' || p === '/health')) {
          const elq = await eloqua.login(env);
          return json({ ok: true, worker: 'txfeed-eloqua-sync', supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY), sync_key: Boolean(env.SYNC_KEY),
            eloqua: !elq.configured ? 'not configured' : elq.ok ? 'ok' : (elq.error || 'login failed'), write_enabled: writesOn(env), field_map: fieldMap(env), signals: SIGNALS });
        }
        if (p === '/dry-run' && request.method === 'GET') { const d = authorized(request, env); if (d) return d; return json(await run(env, { write: false })); }
        if (p === '/run' && request.method === 'POST') { const d = authorized(request, env); if (d) return d; return json(await run(env, { write: true })); }
        if (p === '/fields' && request.method === 'GET') { const d = authorized(request, env); if (d) return d; return json(await fields(env, url.searchParams.get('q') || '')); }
        return json({ error: 'not found' }, 404);
      } catch (e) {
        console.error('txfeed-eloqua-sync', e?.message);
        return json({ error: 'sync unavailable' }, 503);
      }
    },
    /** Nightly: the same pass as POST /run. Writes only once WRITE_ENABLED is 1 and the map names a field. */
    async scheduled(event, env = {}, ctx) {
      const job = run(env, { write: true }).then((o) => console.log('txfeed-eloqua-sync', JSON.stringify({ run_id: o.run_id, writing: o.writing, candidates: o.candidates, resolved: o.resolved, written: o.written, unchanged: o.unchanged, skipped: o.skipped, failed: o.failed, errors: o.errors })))
        .catch((e) => console.error('txfeed-eloqua-sync', e?.message));
      if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
    },
    run, fields, planFor,
  };
}
