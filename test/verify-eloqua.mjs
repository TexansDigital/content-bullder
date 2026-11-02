/**
 * Eloqua, read only, through mocks: the login handshake, the visitor lookup by GUID, the contact
 * read, what /health says in each state, and the key-protected lookup route.
 */
import { createEloqua } from '../workers/feed/src/eloqua.js';
import { createApp } from '../workers/feed/src/app.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const calls = [];
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const mockEloqua = (over = {}) => async (url, opts = {}) => {
  calls.push({ url, auth: opts.headers?.authorization || '' });
  if (url === 'https://login.eloqua.com/id') return over.login ? over.login(opts) : res(200, { site: { name: 'HoustonTexans' }, user: { displayName: 'Feed API' }, urls: { base: 'https://secure.p03.eloqua.com' } });
  if (/\/data\/visitors\?/.test(url)) return over.visitors ? over.visitors(url) : res(200, { elements: /ABCDEF0123456789ABCDEF0123456789/.test(url) ? [{ visitorId: 77, contactId: 4242, V_LastVisitDateAndTime: 1793590000 }] : [] });
  if (/\/data\/contact\/4242/.test(url)) return res(200, { id: 4242, firstName: 'Adam', emailAddress: 'secret@example.com', fieldValues: [{ id: 100001, name: 'FavoritePlayer', value: 'C.J. Stroud' }, { id: 100002, value: 'x' }] });
  if (/\/data\/contact\//.test(url)) return res(404, {});
  // Everything else is the feed's Supabase mock: empty tables.
  const table = (url.split('/rest/v1/')[1] || '').split('?')[0];
  return res(table ? 200 : 404, []);
};

const ENV = { ELOQUA_SITE: 'HoustonTexans', ELOQUA_USER: 'feed.api', ELOQUA_PASSWORD: 'pw' };
let clock = 1000;
const e = createEloqua({ fetch: mockEloqua(), now: () => clock });

let l = await e.login({});
t('without the three secrets, not configured and not ok', l.configured === false && l.ok === false);
l = await e.login(ENV);
t('a login learns the pod base and names the site', l.ok && l.base === 'https://secure.p03.eloqua.com' && l.site === 'HoustonTexans');
t('the credentials travel as Basic site\\\\user:password', calls[0].auth === 'Basic ' + Buffer.from('HoustonTexans\\feed.api:pw').toString('base64'));
const n = calls.length; await e.login(ENV);
t('a second login inside ten minutes is answered from cache', calls.length === n && (await e.login(ENV)).cached === true);
clock += 11 * 60 * 1000; await e.login(ENV);
t('after ten minutes it logs in again', calls.length === n + 1);

let v = await e.visitor(ENV, 'abcdef0123456789abcdef0123456789');
t('a visitor is found by GUID on REST 2.0, searched upper-case, and carries its contact id', v.found && v.contactId === '4242' && /\/api\/REST\/2\.0\/data\/visitors\?/.test(calls.at(-1).url) && /externalId%3D'ABCDEF0123456789ABCDEF0123456789'/.test(calls.at(-1).url));
v = await e.visitor(ENV, '00000000000000000000000000000000');
t('an unknown GUID is simply not found', v.found === false && !v.error);
v = await e.visitor(ENV, 'nope');
t('a malformed GUID never reaches Eloqua', v.error === 'not a GUID');

let c = await e.contact(ENV, '4242', { fields: ['FavoritePlayer'] });
t('a contact read gives id, first name and the named custom field, never the email', c.found && c.firstName === 'Adam' && c.custom.FavoritePlayer === 'C.J. Stroud' && !JSON.stringify(c).includes('secret@example.com') && c.fieldCount === 2);
c = await e.contact(ENV, '1');
t('a missing contact is not found', c.found === false);

{
  const e2 = createEloqua({ fetch: mockEloqua({ login: () => res(401, {}) }), now: () => clock });
  const r = await e2.login(ENV);
  t('a refused login says to check the three secrets', r.ok === false && /check site, user and password/.test(r.error));
  const e3 = createEloqua({ fetch: mockEloqua({ login: () => res(200, { urls: {} }) }), now: () => clock });
  t('a login without a pod base is not ok', (await e3.login(ENV)).ok === false);
}

// ---- through the Worker ----
const req = (path, init) => new Request(`https://feed.htow.nz${path}`, init);
const ctx = { waitUntil: () => {} };
const app = createApp({ feedHtml: 'x', deps: { fetch: mockEloqua(), cache: null } });
let r = await app.fetch(req('/health'), {}, ctx);
t('health says eloqua is not configured without the secrets', (await r.json()).eloqua === 'not configured');
r = await app.fetch(req('/health'), ENV, ctx);
t('health says eloqua ok once a login works, and names neither site nor user', (() => { const s = JSON.stringify; return true; })() && (await (async () => { const d = await r.json(); return d.eloqua === 'ok' && !JSON.stringify(d).includes('feed.api') && !JSON.stringify(d).includes('HoustonTexans'); })()));
const app401 = createApp({ feedHtml: 'x', deps: { fetch: mockEloqua({ login: () => res(401, {}) }), cache: null } });
r = await app401.fetch(req('/health'), ENV, ctx);
t('health carries the login error when the secrets are wrong', /check site, user and password/.test((await r.json()).eloqua));

const KEYED = { ...ENV, MEDIA: {}, MEDIA_UPLOAD_KEY: 'open-sesame' };
r = await app.fetch(req('/api/eloqua/lookup?guid=abcdef0123456789abcdef0123456789'), KEYED, ctx);
t('the lookup needs the upload key', r.status === 401);
r = await app.fetch(req('/api/eloqua/lookup?guid=abcdef0123456789abcdef0123456789', { headers: { 'x-media-key': 'open-sesame' } }), KEYED, ctx);
let d = await r.json();
t('with the key, a GUID resolves to a visitor and a contact with a first name, no email', r.status === 200 && d.ok && d.visitor.contactId === '4242' && d.contact.firstName === 'Adam' && !JSON.stringify(d).includes('@'));
r = await app.fetch(req('/api/eloqua/lookup?guid=abcdef0123456789abcdef0123456789', { headers: { 'x-media-key': 'open-sesame' } }), { MEDIA: {}, MEDIA_UPLOAD_KEY: 'open-sesame' }, ctx);
t('without the secrets the lookup says what is missing', r.status === 503 && /ELOQUA_SITE/.test(await r.text()));

r = await app.fetch(req('/api/eloqua/probe?guid=abcdef0123456789abcdef0123456789', { headers: { 'x-media-key': 'open-sesame' } }), KEYED, ctx);
d = await r.json();
t('the probe tries each search form and reports status and counts, never a record', r.status === 200 && d.tries.length >= 7 && d.tries.every((x) => 'status' in x || 'error' in x) && !JSON.stringify(d).includes('4242') && d.tries[0].elements === 1);
r = await app.fetch(req('/api/eloqua/probe?guid=x'), KEYED, ctx);
t('the probe needs the key', r.status === 401);

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
