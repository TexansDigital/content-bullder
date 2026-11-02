/**
 * Pseudonymous identity on the feed.
 *
 * The host site's pocketId lives in localStorage on its own origin, which this feed —
 * served from a different origin — cannot read. So the whole mechanism is a handshake, and
 * the thing worth testing is what happens when the host is slow, absent, or hostile.
 *
 * Nothing here is personal data. These are pseudonyms; resolving one to a person is a
 * separate, later, deliberate step.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const B = 'http://localhost:4400';
const b = await chromium.launch({ executablePath: headlessShell() });
const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

await j('/api/items', { method: 'DELETE',
  body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });
await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
  urls: ['https://a.example/a.jpg', 'https://a.example/b.jpg'].join('\n'),
  collection: 'series' } }) });
for (const it of (await j('/api/items')).items)
  await j('/api/items', { method: 'PATCH',
    body: JSON.stringify({ id: it.id, changes: { status: 'published' } }) });

const errs = [];
const listener = () => {
  window.__ev = [];
  addEventListener('message', (e) => { if (e.data?.source === 'txfeed') window.__ev.push(e.data); });
};

/** A host page that answers the handshake, optionally after a delay or with junk. */
const host = (reply, delay = 0) => `
  <script>
    window.__ev = [];
    addEventListener('message', function (e) {
      if (!e.data || e.data.source !== 'txfeed') return;
      window.__ev.push(e.data);
      if (e.data.event !== 'hello') return;
      setTimeout(function () {
        e.source.postMessage({ source: 'txfeed-host', pocketId: ${JSON.stringify(reply)} }, '*');
      }, ${delay});
    });
  <\/script>
  <iframe id="x" src="${B}/feed" style="width:430px;height:820px;border:0"></iframe>`;

const evsOf = (page) => page.evaluate(() => window.__ev);
const openHost = async (html) => {
  const pg = await b.newPage({ viewport: { width: 430, height: 880 } });
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.setContent(html, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(2600);
  return pg;
};

/* ---------- the handshake ---------- */

const h1 = await openHost(host('pocket-abc123XYZ'));
const ev1 = await evsOf(h1);
t('the feed announces itself to its host', ev1.some((e) => e.event === 'hello'));
const load1 = ev1.find((e) => e.event === 'feed_load');
t('feed_load is held until identity resolves, not sent anonymous',
  load1?.params.pocket_id === 'pocket-abc123XYZ');
t('the first card view carries the host id',
  ev1.find((e) => e.event === 'card_view')?.params.pocket_id === 'pocket-abc123XYZ');
t('and how the identity arrived is recorded',
  ev1.find((e) => e.event === 'identity')?.params.identity_source === 'host-message');
t('a device id rides along as well',
  /^dv-/.test(load1?.params.device_id || ''));

/* ---------- a host that is slow, silent, or sending junk ---------- */

const h2 = await openHost(host('pocket-slowreply', 400));
t('a reply inside the handshake window still lands',
  (await evsOf(h2)).find((e) => e.event === 'feed_load')?.params.pocket_id === 'pocket-slowreply');

const h3 = await openHost(host('pocket-toolate', 4000));
const ev3 = await evsOf(h3);
t('a host that answers too late does not cost us the session',
  !!ev3.find((e) => e.event === 'feed_load')?.params.device_id);
t('and the session is attributed to the device, not to nothing',
  ev3.find((e) => e.event === 'identity')?.params.identity_source === 'device');

const h4 = await openHost(host('<img src=q onerror=alert(1)>'));
const ev4 = await evsOf(h4);
t('a malformed host id is refused', !ev4.find((e) => e.event === 'feed_load')?.params.pocket_id);
t('short junk is refused too', !ev4.some((e) => e.params?.pocket_id));

// A host that listens but never replies — the common case before anyone wires anything.
const h5 = await openHost(`
  <script>
    window.__ev = [];
    addEventListener('message', function (e) {
      if (e.data && e.data.source === 'txfeed') window.__ev.push(e.data);
    });
  <\/script>
  <iframe id="x" src="${B}/feed" style="width:430px;height:820px;border:0"></iframe>`);
const ev5 = await evsOf(h5);
t('a host that never wires the handshake still reports',
  !!ev5.find((e) => e.event === 'feed_load')?.params.device_id);

/* ---------- the URL form, for a CMS that can only interpolate ---------- */

const u = await b.newPage({ viewport: { width: 430, height: 880 } });
u.on('pageerror', (e) => errs.push(e.message));
await u.addInitScript(listener);
await u.goto(`${B}/feed?pid=pocket-from-url-99`, { waitUntil: 'networkidle' });
await u.waitForTimeout(1800);
const evU = await evsOf(u);
t('?pid= identifies the session with no handshake',
  evU.find((e) => e.event === 'feed_load')?.params.pocket_id === 'pocket-from-url-99');
t('and skips the wait entirely',
  evU.find((e) => e.event === 'identity')?.params.identity_source === 'url');
t('a malformed ?pid= falls back rather than propagating', await (async () => {
  const q = await b.newPage({ viewport: { width: 430, height: 880 } });
  await q.addInitScript(listener);
  await q.goto(`${B}/feed?pid=${encodeURIComponent('" onerror="x')}`, { waitUntil: 'networkidle' });
  await q.waitForTimeout(1500);
  const e = await evsOf(q);
  await q.close();
  return !e.find((x) => x.event === 'feed_load')?.pocket_id;
})());

/* ---------- consent, which the host is the only one who knows ---------- */

// Minting our own id is the same act the host gates behind OneTrust C0002. A host that
// says the visitor declined must leave us measuring nothing — a different origin does not
// make it a different act.
const consentHost = (consent, id) => `
  <script>
    window.__ev = [];
    addEventListener('message', function (e) {
      if (!e.data || e.data.source !== 'txfeed') return;
      window.__ev.push(e.data);
      if (e.data.event !== 'hello') return;
      e.source.postMessage({ source: 'txfeed-host',
        pocketId: ${JSON.stringify(id)}, consent: ${consent} }, '*');
    });
  <\/script>
  <iframe id="x" src="${B}/feed" style="width:430px;height:820px;border:0"></iframe>`;

const declined = await openHost(consentHost(false, 'sess_1792089626000_k3j9xq2ab'));
const declinedEv = await evsOf(declined);
t('a declining host stops measurement dead',
  declinedEv.filter((e) => e.event !== 'hello').length === 0);
t('and no pocket id leaves the page even though one exists',
  !declinedEv.some((e) => e.params?.pocket_id));
t('and the feed mints no identifier of its own', await (async () => {
  const fr = declined.frames().find((f) => f.url().includes('/feed'));
  return (await fr.evaluate(() => { try { return localStorage.getItem('txfeed.device'); }
    catch { return 'blocked'; } })) === null;
})());

const consented = await openHost(consentHost(true, null));
const consentedEv = await evsOf(consented);
t('a consenting host with no id yet still gets measured',
  !!consentedEv.find((e) => e.event === 'feed_load'));
t('on a device id, which consent permits',
  /^dv-/.test(consentedEv.find((e) => e.event === 'feed_load')?.params.device_id || ''));

/* ---------- unframed, and across a reload ---------- */

const d1 = await u.evaluate(() => localStorage.getItem('txfeed.device'));
await u.reload({ waitUntil: 'networkidle' });
await u.waitForTimeout(600);
t('the device id survives a reload', (await u.evaluate(() =>
  localStorage.getItem('txfeed.device'))) === d1);
t('every event carries an identity', evU.filter((e) => e.event !== 'hello')
  .every((e) => e.params?.pocket_id || e.params?.device_id));

/* ---------- blocked storage must not take the feed down ---------- */

const s2 = await b.newPage({ viewport: { width: 430, height: 880 } });
s2.on('pageerror', (e) => errs.push(e.message));
await s2.addInitScript(() => {
  Object.defineProperty(window, 'localStorage', {
    get() { throw new Error('storage blocked'); },
  });
  window.__ev = [];
  addEventListener('message', (e) => { if (e.data?.source === 'txfeed') window.__ev.push(e.data); });
});
await s2.goto(`${B}/feed`, { waitUntil: 'networkidle' });
await s2.waitForTimeout(1800);
t('a private window still renders the feed',
  (await s2.evaluate(() => document.querySelectorAll('.slide').length)) > 0);
t('and still reports, just without an id',
  (await evsOf(s2)).some((e) => e.event === 'feed_load'));

/* ---------- handshake v3: the Eloqua visitor GUID rides with the pocket id ---------- */
const guidHost = (guid) => `
  <script>
    window.__ev = [];
    addEventListener('message', function (e) {
      if (!e.data || e.data.source !== 'txfeed') return;
      window.__ev.push(e.data);
      if (e.data.event !== 'hello') return;
      e.source.postMessage({ source: 'txfeed-host', pocketId: 'sess_1792089626000_k3j9xq2ab', consent: true, eloquaGuid: ${JSON.stringify(guid)} }, '*');
    });
  <\/script>
  <iframe id="x" src="${B}/feed" style="width:430px;height:820px;border:0"></iframe>`;
{
  const pg = await openHost(guidHost('ABCDEF0123456789abcdef0123456789'));
  const evs = await evsOf(pg);
  const idEv = evs.find((e) => e.event === 'identity');
  t('a host that passes an Eloqua GUID has it recorded once, on the identity event, lower-cased', idEv && idEv.params.eloqua_guid === 'abcdef0123456789abcdef0123456789' && idEv.params.pocket_id === 'sess_1792089626000_k3j9xq2ab');
  t('and on nothing else', !evs.some((e) => e.event !== 'identity' && e.params?.eloqua_guid));
  await pg.close();
  const bad = await openHost(guidHost('GUID=not-hex-at-all-0123456789'));
  const badEvs = await evsOf(bad);
  t('a GUID that is not 32 hex characters is dropped, the pocket id still lands', !badEvs.some((e) => e.params?.eloqua_guid) && badEvs.some((e) => e.event === 'identity' && e.params.pocket_id === 'sess_1792089626000_k3j9xq2ab'));
  await bad.close();
}

// Two handshake copies on one page: the older answers first without the GUID, the newer brings it.
const twoHosts = `
  <script>
    window.__ev = [];
    addEventListener('message', function (e) {
      if (!e.data || e.data.source !== 'txfeed') return;
      window.__ev.push(e.data);
      if (e.data.event !== 'hello') return;
      e.source.postMessage({ source: 'txfeed-host', pocketId: 'sess_1792089626000_k3j9xq2ab', consent: true }, '*');
      setTimeout(function () { e.source.postMessage({ source: 'txfeed-host', pocketId: 'sess_1792089626000_k3j9xq2ab', consent: true, eloquaGuid: 'ABCDEF0123456789abcdef0123456789' }, '*'); }, 300);
    });
  <\/script>
  <iframe id="x" src="${B}/feed" style="width:430px;height:820px;border:0"></iframe>`;
{
  const pg = await openHost(twoHosts);
  const evs = await evsOf(pg);
  const ids = evs.filter((e) => e.event === 'identity');
  t('when an older handshake answers first and a newer one brings the GUID later, the GUID is still recorded, on a second identity event for the same session', ids.length === 2 && !ids[0].params.eloqua_guid && ids[1].params.eloqua_guid === 'abcdef0123456789abcdef0123456789' && ids.every((e) => e.params.pocket_id === 'sess_1792089626000_k3j9xq2ab'));
  await pg.close();
}

// The real scripts: the old v2 copy still in the site's shared modules and the new v3 paste, on
// one page, with an ELOQUA cookie. The v2 answers first; the v3 must still run and bring the GUID.
{
  const { readFileSync } = await import('node:fs');
  const strip = (html) => html.replace(/<\/?script[^>]*>/g, '').replaceAll('https://feed.htow.nz', B);
  const v2 = strip(readFileSync('/tmp/claude-0/-home-user-content-bullder/297a51d9-7410-52ce-b947-b0c4d4a39edc/scratchpad/handshake-v2.html', 'utf8'));
  const v3 = strip(readFileSync(new URL('../docs/txfeed-handshake.html', import.meta.url), 'utf8'));
  const page = `<script>window.__ev = []; addEventListener('message', function (e) { if (e.data && e.data.source === 'txfeed') window.__ev.push(e.data); });
      Object.defineProperty(document, 'cookie', { get: function () { return 'ELOQUA=GUID=0123456789ABCDEF0123456789ABCDEF&ELQ=x'; } }); try { localStorage.setItem('pocket_session_id', 'sess_1792089626000_k3j9xq2ab'); } catch (e) {}
      window.OnetrustActiveGroups = ',C0001,C0002,';<\/script>
    <script>${v2}<\/script><script>${v3}<\/script>
    <iframe id="x" src="${B}/feed" style="width:430px;height:820px;border:0"></iframe>`;
  const pg = await openHost(page);
  const evs = await evsOf(pg);
  const ids = evs.filter((e) => e.event === 'identity');
  const st = await pg.evaluate(() => window.houModules['txfeed-handshake']);
  t(`with the old v2 copy still on the page, the v3 paste still answers and the GUID lands (identity events ${ids.length}, guid ${ids.some((e) => e.params.eloqua_guid === '0123456789abcdef0123456789abcdef')}, state v${st && st.v})`,
    ids.some((e) => e.params.eloqua_guid === '0123456789abcdef0123456789abcdef' && e.params.pocket_id === 'sess_1792089626000_k3j9xq2ab') && st && st.v === 3);
  await pg.close();
}

/* ---------- verification traffic is marked ---------- */
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 } });
  const pg = await ctx.newPage(); const ev = [];
  pg.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/events')) { try { ev.push(...(JSON.parse(r.postData() || '{}').events || [])); } catch {} } });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.goto(`${B}/feed?qa=1&pid=sess_${Date.now()}_qamark`, { waitUntil: 'networkidle' }); await pg.waitForTimeout(2600);
  t('a load with ?qa=1 marks every event it sends, so reviews can leave it out', ev.length > 0 && ev.every((e) => e.params.qa === true));
  await ctx.close();
}

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
if (errs.length) console.log('page errors:\n' + errs.join('\n'));
await b.close();
process.exit(bad.length ? 1 : 0);
