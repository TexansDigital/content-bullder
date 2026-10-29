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

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
if (errs.length) console.log('page errors:\n' + errs.join('\n'));
await b.close();
process.exit(bad.length ? 1 : 0);
