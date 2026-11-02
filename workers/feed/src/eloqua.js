/**
 * Eloqua, read only. The handshake brings the visitor GUID from the ELOQUA cookie; this is
 * how it becomes a contact the club already knows.
 *
 *   login(env)         Basic auth against login.eloqua.com/id: confirms the credentials and
 *                      learns which pod (base URL) the site lives on. Cached per isolate.
 *   visitor(env, guid) The visitor record for a GUID (externalId), with its contactId.
 *   contact(env, id)   The contact's non-sensitive fields: id, first name, and a few named
 *                      custom fields when they exist. Never the email, never the address.
 *
 * Secrets: ELOQUA_SITE (the company name on the login screen), ELOQUA_USER, ELOQUA_PASSWORD.
 * Without all three, everything here answers "not configured" and the feed is unchanged.
 */
const LOGIN_URL = 'https://login.eloqua.com/id';
const GUID = /^[0-9a-f]{32}$/i;
const TTL_MS = 10 * 60 * 1000;

export function createEloqua({ fetch: get = (...a) => globalThis.fetch(...a), now = () => Date.now() } = {}) {
  let cached = null; // { base, at }

  const configured = (env) => Boolean(env.ELOQUA_SITE && env.ELOQUA_USER && env.ELOQUA_PASSWORD);
  const auth = (env) => 'Basic ' + btoa(`${env.ELOQUA_SITE}\\${env.ELOQUA_USER}:${env.ELOQUA_PASSWORD}`);
  const headers = (env) => ({ authorization: auth(env), accept: 'application/json', 'user-agent': 'txfeed/1' });

  /** { configured, ok, base?, status?, error? }. The base is cached for ten minutes once a login works. */
  async function login(env, { force = false } = {}) {
    if (!configured(env)) return { configured: false, ok: false };
    if (!force && cached && now() - cached.at < TTL_MS) return { configured: true, ok: true, base: cached.base, cached: true };
    try {
      const r = await get(LOGIN_URL, { headers: headers(env), signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
      if (!r.ok) return { configured: true, ok: false, status: r.status, error: r.status === 401 ? 'login refused: check site, user and password' : `login answered ${r.status}` };
      const d = await r.json();
      const base = String(d?.urls?.base || '').replace(/\/$/, '');
      if (!/^https:\/\/[a-z0-9.-]+\.eloqua\.com$/i.test(base)) return { configured: true, ok: false, error: 'login answered without a pod base URL' };
      cached = { base, at: now() };
      return { configured: true, ok: true, base, site: d?.site?.name || null, user: d?.user?.displayName || null };
    } catch (e) {
      return { configured: true, ok: false, error: e?.name === 'TimeoutError' ? 'login timed out' : (e?.message || 'login failed') };
    }
  }

  /** The visitor for a GUID: { found, visitorId, contactId, visitedAt } or { found: false }. */
  async function visitor(env, guid) {
    if (!GUID.test(guid || '')) return { found: false, error: 'not a GUID' };
    const l = await login(env);
    if (!l.ok) return { found: false, error: l.error || 'not configured' };
    const q = encodeURIComponent(`externalId='${guid.toUpperCase()}'`);
    const r = await get(`${l.base}/api/REST/1.0/data/visitors?search=${q}&depth=complete&count=1`, { headers: headers(env) });
    if (!r.ok) return { found: false, error: `visitors answered ${r.status}` };
    const d = await r.json();
    const v = (d?.elements || [])[0];
    if (!v) return { found: false };
    return { found: true, visitorId: String(v.visitorId || v.id || ''), contactId: v.contactId ? String(v.contactId) : null, visitedAt: v.V_LastVisitDateAndTime || null };
  }

  /** The contact's id, first name and any named custom fields; nothing that identifies them outside the club. */
  async function contact(env, id, { fields = [] } = {}) {
    if (!/^\d{1,12}$/.test(String(id || ''))) return { found: false, error: 'not a contact id' };
    const l = await login(env);
    if (!l.ok) return { found: false, error: l.error || 'not configured' };
    const r = await get(`${l.base}/api/REST/1.0/data/contact/${id}?depth=complete`, { headers: headers(env) });
    if (r.status === 404) return { found: false };
    if (!r.ok) return { found: false, error: `contact answered ${r.status}` };
    const d = await r.json();
    const custom = {};
    for (const f of d?.fieldValues || []) {
      const name = f?.name || f?.id;
      if (fields.includes(String(name)) && f?.value != null && f.value !== '') custom[String(name)] = String(f.value).slice(0, 80);
    }
    return { found: true, contactId: String(d.id), firstName: d.firstName ? String(d.firstName).slice(0, 40) : null, fieldCount: (d?.fieldValues || []).length, custom };
  }

  /**
   * Which visitor-search form does this pod accept? Tries the documented variants and reports a
   * status and an element count for each, never a record. Used once from the diagnostic route.
   */
  async function probe(env, guid) {
    const l = await login(env, { force: true });
    if (!l.ok) return { ok: false, error: l.error };
    const raw = await get(LOGIN_URL, { headers: headers(env) }).then((r) => r.json()).catch(() => ({}));
    const restBase = String(raw?.urls?.apis?.rest?.standard || '').replace('{version}', '1.0').replace(/\/$/, '');
    const g = String(guid || '').toUpperCase();
    const tries = [
      ['base /api/REST/1.0 search=externalId=\'G\'', `${l.base}/api/REST/1.0/data/visitors?search=${encodeURIComponent(`externalId='${g}'`)}`],
      ['base /api/REST/1.0 search=externalId=G', `${l.base}/api/REST/1.0/data/visitors?search=${encodeURIComponent(`externalId=${g}`)}`],
      ['base /api/REST/1.0 search=G', `${l.base}/api/REST/1.0/data/visitors?search=${encodeURIComponent(g)}`],
      ['base /api/REST/1.0 no search, count=1', `${l.base}/api/REST/1.0/data/visitors?count=1`],
      ['base /API/REST/1.0 search=externalId=\'G\'', `${l.base}/API/REST/1.0/data/visitors?search=${encodeURIComponent(`externalId='${g}'`)}`],
      ['base /api/REST/2.0 search=externalId=\'G\'', `${l.base}/api/REST/2.0/data/visitors?search=${encodeURIComponent(`externalId='${g}'`)}`],
      ...(restBase ? [['apis.rest.standard search=externalId=\'G\'', `${restBase}/data/visitors?search=${encodeURIComponent(`externalId='${g}'`)}`]] : []),
      ['contacts endpoint sanity, count=1', `${l.base}/api/REST/1.0/data/contacts?count=1`],
    ];
    const out = [];
    for (const [label, url] of tries) {
      try {
        const r = await get(url, { headers: headers(env) });
        let elements = null, keys = null, total = null;
        try { const d = await r.json(); elements = Array.isArray(d?.elements) ? d.elements.length : null; total = d?.total ?? null; keys = d?.elements?.[0] ? Object.keys(d.elements[0]).slice(0, 12) : null; } catch { /* not json */ }
        out.push({ label, status: r.status, elements, total, keys });
      } catch (e) { out.push({ label, error: e?.message || 'failed' }); }
    }
    return { ok: true, base: l.base, restBase: restBase || null, tries: out };
  }

  return { configured, login, visitor, contact, probe };
}
