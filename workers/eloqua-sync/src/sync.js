/**
 * The feed's picks into an Eloqua custom data object (CDO). Workstream 2 (docs/workstreams.md).
 * Adam, 4 Nov 2026: a CDO, not contact fields; daily; go.
 *
 * One pass:
 *   1. feed_eloqua_candidates() in Supabase: one row per recognised GUID (clean sessions only)
 *      with the newest preference row across that fan's sessions.
 *   2. The GUID resolves to a visitor, the visitor to a contact (workers/feed/src/eloqua.js,
 *      the feed's own client, imported read only). Two GUIDs on one contact are one fan: the
 *      newest picks win and the older GUID is logged as merged.
 *   3. The CDO is found by name (ELOQUA_CDO_NAME) and its fields by name, so no id is typed
 *      by hand. Each signal in ELOQUA_CDO_SIGNALS whose field exists becomes one write.
 *   4. One CDO record per contact, linked to the contact, keyed by Contact ID. The record id is
 *      kept in feed_eloqua_cdo_records, so the next run updates it rather than adding another.
 *      Writes need WRITE_ENABLED=1; a value the record already holds is 'unchanged', not sent.
 *      Every planned and actual write is logged to feed_eloqua_writes with the previous value.
 *
 * Never a name, never an email: the only contact data read is the contact id behind the GUID.
 */
import { createEloqua } from '../../feed/src/eloqua.js';
import { displayName } from '../../../src/rank.js';

export const SIGNALS = ['favorite_player', 'players', 'lanes', 'format', 'going', 'watch', 'last_feed_visit'];
/** The CDO field each signal lands in, by the name Adam gives it in Eloqua. */
export const FIELD_NAMES = {
  favorite_player: 'Favorite Player', players: 'Players', lanes: 'Lanes', format: 'Format',
  going: 'Going', watch: 'Watch', last_feed_visit: 'Last Feed Visit',
};
export const KEY_FIELD = 'Contact ID';
export const STAMP_FIELD = 'Updated At';
const LANE_NAMES = { game: 'Game action', hype: 'Gameday hype', inside: "Mic'd up & inside", coaches: 'DeMeco & the coaches', music: 'Music & 713', fun: 'Fun & TORO', community: 'Community', tickets: 'Gameday & tickets' };
const GUID = /^[0-9A-F]{32}$/;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
  const elqHeaders = (env, extra = {}) => ({ authorization: 'Basic ' + btoa(`${env.ELOQUA_SITE}\\${env.ELOQUA_USER}:${env.ELOQUA_PASSWORD}`), accept: 'application/json', 'user-agent': 'txfeed-eloqua-sync/1', ...extra });

  const writesOn = (env) => String(env.WRITE_ENABLED || '0') === '1';
  const liveSignals = (env) => String(env.ELOQUA_CDO_SIGNALS || 'favorite_player').split(',').map((s) => s.trim()).filter((s) => SIGNALS.includes(s));
  const cdoName = (env) => String(env.ELOQUA_CDO_NAME || '').trim();

  function authorized(request, env) {
    if (!env.SYNC_KEY) return json({ error: 'not enabled: set the SYNC_KEY secret' }, 503);
    const given = request.headers.get('x-sync-key') || '';
    if (given.length !== env.SYNC_KEY.length || given !== env.SYNC_KEY) return json({ error: 'wrong sync key' }, 401);
    return null;
  }

  // ---- Supabase ----
  const supa = (env) => ({ base: String(env.SUPABASE_URL || '').replace(/\/$/, ''), key: env.SUPABASE_SERVICE_KEY });
  const sbHeaders = (key, extra = {}) => ({ apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra });
  async function rpcCandidates(env) {
    const { base, key } = supa(env);
    if (!base || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are needed');
    const days = Math.max(1, Math.min(365, Number(env.LOOKBACK_DAYS) || 90));
    const lim = Math.max(1, Math.min(2000, Number(env.RUN_MAX) || 200));
    const r = await get(`${base}/rest/v1/rpc/feed_eloqua_candidates`, { method: 'POST', headers: sbHeaders(key), body: JSON.stringify({ lookback: `${days} days`, lim }) });
    if (!r.ok) throw new Error(`feed_eloqua_candidates answered ${r.status}`);
    const d = await r.json();
    return d && typeof d === 'object' ? d : { candidates: [] };
  }
  async function knownRecords(env, contactIds) {
    if (!contactIds.length) return {};
    const { base, key } = supa(env);
    const list = contactIds.map(encodeURIComponent).join(',');
    const r = await get(`${base}/rest/v1/feed_eloqua_cdo_records?select=contact_id,cdo_id,instance_id&contact_id=in.(${list})`, { headers: sbHeaders(key) }).catch(() => null);
    if (!r || !r.ok) return {};
    const rows = await r.json().catch(() => []);
    return Object.fromEntries((rows || []).map((x) => [String(x.contact_id), x]));
  }
  async function rememberRecord(env, contactId, cdoId, instanceId) {
    const { base, key } = supa(env);
    await get(`${base}/rest/v1/feed_eloqua_cdo_records?on_conflict=contact_id`, { method: 'POST', headers: sbHeaders(key, { prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ contact_id: contactId, cdo_id: cdoId, instance_id: instanceId, updated_at: now().toISOString() }) }).catch(() => null);
  }
  async function log(env, rows) {
    if (!rows.length) return false;
    const { base, key } = supa(env);
    const r = await get(`${base}/rest/v1/feed_eloqua_writes`, { method: 'POST', headers: sbHeaders(key, { prefer: 'return=minimal' }), body: JSON.stringify(rows) }).catch(() => null);
    return Boolean(r && r.ok);
  }

  // ---- Eloqua CDO ----
  /** The CDO by exact name, with its fields resolved by name: { ok, id, name, fields: {name: id}, list } */
  async function findCdo(env, l) {
    const name = cdoName(env);
    if (!name) return { ok: false, error: 'ELOQUA_CDO_NAME is not set' };
    const r = await get(`${l.base}/api/REST/2.0/assets/customObjects?search=${encodeURIComponent(`name='${name.replace(/'/g, '')}'`)}&depth=complete&count=10`, { headers: elqHeaders(env) });
    if (!r.ok) return { ok: false, error: `customObjects answered ${r.status}` };
    const d = await r.json();
    const cdo = (d?.elements || []).find((x) => norm(x?.name) === norm(name));
    if (!cdo) return { ok: false, error: `no CDO named "${name}" yet` };
    const list = (cdo.fields || []).map((f) => ({ id: String(f.id), name: f.name, internalName: f.internalName || null, dataType: f.dataType || null }));
    const fields = {};
    for (const f of list) { fields[norm(f.name)] = f.id; if (f.internalName) fields[norm(f.internalName)] = fields[norm(f.internalName)] || f.id; }
    return { ok: true, id: String(cdo.id), name: cdo.name, fields, list, uniqueCodeFieldId: cdo.uniqueCodeFieldId ? String(cdo.uniqueCodeFieldId) : null };
  }
  const fieldId = (cdo, label) => cdo.fields[norm(label)] || null;
  async function readInstance(env, l, cdoId, id) {
    const r = await get(`${l.base}/api/REST/2.0/data/customObject/${cdoId}/instance/${id}`, { headers: elqHeaders(env) });
    if (r.status === 404) return { found: false };
    if (!r.ok) return { found: false, error: `instance answered ${r.status}` };
    const d = await r.json();
    return { found: true, values: Object.fromEntries((d?.fieldValues || []).map((f) => [String(f.id), f.value == null ? null : String(f.value)])) };
  }
  async function saveInstance(env, l, cdoId, instanceId, contactId, fieldValues) {
    const body = JSON.stringify({ ...(instanceId ? { id: String(instanceId) } : {}), contactId: String(contactId), fieldValues });
    const url = instanceId ? `${l.base}/api/REST/2.0/data/customObject/${cdoId}/instance/${instanceId}` : `${l.base}/api/REST/2.0/data/customObject/${cdoId}/instance`;
    const r = await get(url, { method: instanceId ? 'PUT' : 'POST', headers: elqHeaders(env, { 'content-type': 'application/json' }), body });
    if (!r.ok) return { ok: false, status: r.status };
    const d = await r.json().catch(() => ({}));
    return { ok: true, id: String(d?.id || instanceId || '') };
  }

  /**
   * One pass. `write` is the caller's intent; the actual write also needs WRITE_ENABLED=1, a CDO
   * with that name, and the signal's field in it. Answers the summary and the plan, GUIDs masked.
   */
  async function run(env, { write = false } = {}) {
    const runId = `run_${now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    const live = liveSignals(env);
    const writing = write && writesOn(env);
    const out = { run_id: runId, writing, cdo: null, live_signals: live, recognised_guids: 0, candidates: 0, resolved: 0, unresolved: 0, no_contact: 0, merged: 0,
      planned: 0, written: 0, created: 0, unchanged: 0, skipped: 0, failed: 0, dry: 0, plan: [], errors: [] };
    let data;
    try { data = await rpcCandidates(env); } catch (e) { out.errors.push(e.message); return out; }
    out.recognised_guids = Number(data.recognised_guids || 0);
    out.recognised_sessions = Number(data.recognised_sessions || 0);
    out.excluded_sessions = Number(data.excluded_sessions || 0);
    const cands = Array.isArray(data.candidates) ? data.candidates : [];
    out.candidates = Number(data.candidates_total ?? cands.length);

    const l = await eloqua.login(env);
    if (!l.ok) out.errors.push(l.error || 'Eloqua is not configured');
    let cdo = { ok: false, error: 'Eloqua not reachable' };
    if (l.ok && cands.length) { cdo = await findCdo(env, l).catch((e) => ({ ok: false, error: e.message })); }
    out.cdo = cdo.ok ? { id: cdo.id, name: cdo.name, key_field: Boolean(fieldId(cdo, KEY_FIELD)), fields: live.map((s) => ({ signal: s, field: FIELD_NAMES[s], found: Boolean(fieldId(cdo, FIELD_NAMES[s])) })) } : { error: cdo.error };
    if (cands.length && !cdo.ok) out.errors.push(cdo.error);

    // Resolve every GUID first, so two GUIDs on one contact collapse to the newest picks.
    const resolved = [];
    for (const c of cands) {
      const guid = String(c.guid || '').toUpperCase();
      if (!GUID.test(guid)) continue;
      let contactId = null, state = 'unreachable';
      if (l.ok) {
        const v = await eloqua.visitor(env, guid.toLowerCase()).catch(() => ({ found: false }));
        if (v.found && v.contactId) { contactId = String(v.contactId); state = 'resolved'; }
        else state = v.found ? 'no_contact' : 'unresolved';
      }
      resolved.push({ c, guid, contactId, state });
    }
    const records = cdo.ok ? await knownRecords(env, [...new Set(resolved.map((x) => x.contactId).filter(Boolean))]) : {};
    const seen = new Set();
    const rows = [];
    for (const { c, guid, contactId, state } of resolved) {
      const plan = planFor(c);
      const entry = { guid: mask(guid), sessions: c.sessions || 0, pref_source: c.pref_source || null, pref_updated_at: c.pref_updated_at || null, contact_id: contactId, record: null, fields: [] };
      out.plan.push(entry);
      if (state === 'resolved') out.resolved += 1; else if (state === 'no_contact') out.no_contact += 1; else if (state === 'unresolved') out.unresolved += 1;
      const base = { run_id: runId, guid, contact_id: contactId, cdo_id: cdo.ok ? cdo.id : null };
      const push = (signal, field, value, previous, status, reason) => {
        entry.fields.push({ signal, field, value, previous, status, reason });
        rows.push({ ...base, field: field || `(${signal})`, value, previous, status, reason, instance_id: entry.record });
      };
      if (contactId && seen.has(contactId)) {
        out.merged += 1;
        for (const [s, v] of Object.entries(plan)) push(s, FIELD_NAMES[s], v, null, 'skipped', 'merged: newer picks for this contact came from another GUID');
        continue;
      }
      if (contactId) seen.add(contactId);
      const known = contactId ? records[contactId] : null;
      entry.record = known && cdo.ok && known.cdo_id === cdo.id ? known.instance_id : null;
      let current = {};
      if (entry.record) { const inst = await readInstance(env, l, cdo.id, entry.record).catch(() => ({ found: false })); if (inst.found) current = inst.values; else entry.record = null; }

      const send = [];
      for (const [signal, value] of Object.entries(plan)) {
        const label = FIELD_NAMES[signal];
        const id = cdo.ok ? fieldId(cdo, label) : null;
        const previous = id && current[id] != null ? current[id] : null;
        if (!live.includes(signal)) { push(signal, label, value, previous, 'dry', 'not live yet: widen ELOQUA_CDO_SIGNALS'); continue; }
        if (!cdo.ok) { push(signal, label, value, null, 'skipped', cdo.error); continue; }
        if (!id) { push(signal, label, value, null, 'skipped', `no "${label}" field on the CDO`); continue; }
        if (!contactId) { push(signal, label, value, null, 'skipped', state === 'unreachable' ? 'Eloqua not reachable' : 'no contact for this GUID'); continue; }
        if (previous === value) { push(signal, label, value, previous, 'unchanged', null); continue; }
        if (!writing) { push(signal, label, value, previous, 'dry', 'dry run'); continue; }
        push(signal, label, value, previous, 'written', null);
        send.push({ id, value });
      }
      if (!send.length) continue;
      const keyId = fieldId(cdo, KEY_FIELD), stampId = fieldId(cdo, STAMP_FIELD);
      const values = [...send];
      if (keyId) values.push({ id: keyId, value: contactId });
      if (stampId) values.push({ id: stampId, value: String(Math.floor(now().getTime() / 1000)) });
      const w = await saveInstance(env, l, cdo.id, entry.record, contactId, values).catch((e) => ({ ok: false, status: e.message }));
      const mine = rows.filter((r) => r.contact_id === contactId && r.status === 'written' && r.run_id === runId);
      if (!w.ok) {
        for (const r of mine) { r.status = 'failed'; r.reason = `CDO ${entry.record ? 'PUT' : 'POST'} answered ${w.status}`; }
      } else {
        if (!entry.record) { out.created += 1; entry.record = w.id; await rememberRecord(env, contactId, cdo.id, w.id); }
        for (const r of mine) r.instance_id = entry.record;
      }
      for (const f of entry.fields) { const r = mine.find((x) => x.field === f.field); if (r) { f.status = r.status; f.reason = r.reason; } }
    }
    for (const r of rows) { out.planned += 1; if (r.status in out) out[r.status] += 1; }
    out.logged = await log(env, rows);
    return out;
  }

  /** What the CDO looks like from here: its id, its fields, and which signals would land. */
  async function describe(env) {
    const l = await eloqua.login(env);
    if (!l.ok) return { ok: false, error: l.error || 'not configured' };
    const cdo = await findCdo(env, l);
    if (!cdo.ok) return { ok: false, name: cdoName(env), error: cdo.error, needs: [KEY_FIELD, ...liveSignals(env).map((s) => FIELD_NAMES[s]), `${STAMP_FIELD} (optional)`] };
    return { ok: true, id: cdo.id, name: cdo.name, fields: cdo.list, key_field: Boolean(fieldId(cdo, KEY_FIELD)), stamp_field: Boolean(fieldId(cdo, STAMP_FIELD)),
      signals: SIGNALS.map((s) => ({ signal: s, field: FIELD_NAMES[s], found: Boolean(fieldId(cdo, FIELD_NAMES[s])), live: liveSignals(env).includes(s) })) };
  }

  return {
    async fetch(request, env = {}, ctx) {
      const url = new URL(request.url);
      const p = url.pathname.replace(/\/+$/, '') || '/';
      try {
        if (request.method === 'GET' && (p === '/' || p === '/health')) {
          const elq = await eloqua.login(env);
          return json({ ok: true, worker: 'txfeed-eloqua-sync', supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY), sync_key: Boolean(env.SYNC_KEY),
            eloqua: !elq.configured ? 'not configured' : elq.ok ? 'ok' : (elq.error || 'login failed'), write_enabled: writesOn(env), cdo_name: cdoName(env) || null, live_signals: liveSignals(env) });
        }
        if (p === '/dry-run' && request.method === 'GET') { const d = authorized(request, env); if (d) return d; return json(await run(env, { write: false })); }
        if (p === '/run' && request.method === 'POST') { const d = authorized(request, env); if (d) return d; return json(await run(env, { write: true })); }
        if (p === '/cdo' && request.method === 'GET') { const d = authorized(request, env); if (d) return d; return json(await describe(env)); }
        return json({ error: 'not found' }, 404);
      } catch (e) {
        console.error('txfeed-eloqua-sync', e?.message);
        return json({ error: 'sync unavailable' }, 503);
      }
    },
    /** Daily: the same pass as POST /run. */
    async scheduled(event, env = {}, ctx) {
      const job = run(env, { write: true }).then((o) => console.log('txfeed-eloqua-sync', JSON.stringify({ run_id: o.run_id, writing: o.writing, candidates: o.candidates, resolved: o.resolved, merged: o.merged, written: o.written, created: o.created, unchanged: o.unchanged, skipped: o.skipped, failed: o.failed, errors: o.errors })))
        .catch((e) => console.error('txfeed-eloqua-sync', e?.message));
      if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
    },
    run, describe, planFor,
  };
}
