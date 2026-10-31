/**
 * Events leave the feed. Until now what fans did was reported to GA and to the host page
 * only; this is the path that keeps it — batched to the origin that served the feed, which
 * in production writes feed_events in Supabase and locally appends to events.ndjson.
 *
 * What matters: the batch waits for /api/feed to say where to send, carries the resolved
 * ids, never includes `hello`, is flushed when the tab hides, and is never sent for a
 * visitor who declined measurement.
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

const feed = await j('/api/feed');
t('the local server advertises its events endpoint', feed.analytics.events === '/api/events');

/** Open the feed in a fresh context and collect every POST it makes to /api/events. */
async function visit(url, { beforeLoad, wait = 3500 } = {}) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 880 } });
  const pg = await ctx.newPage();
  const posts = [];
  const errs = [];
  const feedReqs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => {
    if (r.method() === 'GET' && r.url().includes('/api/feed')) feedReqs.push(r.url());
    if (r.method() === 'POST' && r.url().endsWith('/api/events')) {
      try { posts.push(JSON.parse(r.postData() || '{}')); } catch { posts.push({ raw: r.postData() }); }
    }
  });
  // Playwright cannot read a sendBeacon body, so the beacon is recorded in-page and refused,
  // which sends the feed down its fetch(keepalive) fallback where the body is visible.
  await pg.addInitScript(() => {
    window.__beacons = [];
    navigator.sendBeacon = (u, body) => { window.__beacons.push({ u, type: body?.type || null }); return false; };
  });
  if (beforeLoad) await pg.addInitScript(beforeLoad);
  await pg.goto(url, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(wait);
  return { pg, ctx, posts, errs, feedReqs, events: () => posts.flatMap((p) => p.events || []) };
}

/* ---------- a plain visit ---------- */
const v1 = await visit(`${B}/feed`);
const ev1 = v1.events();
t(`a batch is posted after load (${v1.posts.length} post(s), ${ev1.length} events)`, v1.posts.length >= 1 && ev1.length >= 2);
t('identity leads the batch', ev1[0]?.event === 'identity');
t('feed_load and the first card_view are in it', ev1.some((e) => e.event === 'feed_load') && ev1.some((e) => e.event === 'card_view'));
t('hello is never sent to the server', !ev1.some((e) => e.event === 'hello'));
t('every event carries the device id', ev1.every((e) => /^[A-Za-z0-9._:-]{6,128}$/.test(e.params?.device_id || '')));
t('every event is timestamped', ev1.every((e) => !Number.isNaN(Date.parse(e.at))));
t('no page errors', v1.errs.length === 0);
t('unframed, the feed is requested as the device so it can be ranked', v1.feedReqs.length === 1 && /\/api\/feed\?did=[A-Za-z0-9._:-]{6,}$/.test(v1.feedReqs[0]));
t('feed_load says which order was served', ev1.find((e) => e.event === 'feed_load')?.params.feed_rank === 'shared');
const beacons = await v1.pg.evaluate(() => window.__beacons);
t('sendBeacon is tried first, with a text/plain body so it needs no preflight',
  beacons.length >= 1 && beacons.every((x) => x.u === '/api/events' && /^text\/plain/.test(x.type || '')));
t('and when the beacon is refused the batch still goes by fetch', v1.posts.length >= 1);

/* ---------- the tab hides: what is pending goes now ---------- */
const before = v1.posts.length;
// A like is a real interaction the fan just made; it must not be lost to a 2s timer when
// the tab closes a moment later.
await v1.pg.locator('.slide[data-index="0"] .rb.like').first().click();
await v1.pg.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  // The real event bubbles from document to window; a non-bubbling one never reaches the feed.
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
});
await v1.pg.waitForTimeout(400);
t('hiding the tab flushes the pending batch immediately', v1.posts.length > before && v1.events().some((e) => /^(like|card_like|card_liked)$/.test(e.event)));
await v1.ctx.close();

/* ---------- ?pid= : the host id rides along ---------- */
const v2 = await visit(`${B}/feed?pid=sess_1792089626000_k3j9xq2ab`);
const ev2 = v2.events();
t('with ?pid= every event carries pocket_id', ev2.length > 0 && ev2.every((e) => e.params?.pocket_id === 'sess_1792089626000_k3j9xq2ab'));
t('and identity_source says url', ev2.find((e) => e.event === 'identity')?.params.identity_source === 'url');
t('with ?pid= the feed is requested as that pocket id', v2.feedReqs[0]?.endsWith('/api/feed?sid=sess_1792089626000_k3j9xq2ab'));
await v2.ctx.close();

/* ---------- a host that declines: nothing leaves ---------- */
const hostDeclines = `
  <script>
    addEventListener('message', function (e) {
      if (e.data && e.data.source === 'txfeed' && e.data.event === 'hello')
        e.source.postMessage({ source: 'txfeed-host', consent: false }, '*');
    });
  <\/script>
  <iframe src="${B}/feed" style="width:430px;height:820px;border:0"></iframe>`;
const ctx3 = await b.newContext({ viewport: { width: 430, height: 880 } });
const pg3 = await ctx3.newPage();
const posts3 = [];
const feed3 = [];
pg3.on('request', (r) => {
  if (r.method() === 'POST' && r.url().endsWith('/api/events')) posts3.push(r);
  if (r.method() === 'GET' && r.url().includes('/api/feed')) feed3.push(r.url());
});
await pg3.setContent(hostDeclines, { waitUntil: 'networkidle' });
await pg3.waitForTimeout(3500);
t('a declined-consent visitor produces no event post at all', posts3.length === 0);
t('and their feed is requested anonymously, no id of any kind', feed3.length === 1 && feed3[0].endsWith('/api/feed'));
await ctx3.close();

/* ---------- the server side of the sink ---------- */
const r = await fetch(`${B}/api/events`, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' },
  body: JSON.stringify({ events: [{ event: 'card_view', at: new Date().toISOString(), params: { card_id: 'x' } }] }) });
t('the server takes a text/plain beacon body and answers 204', r.status === 204);
const r2 = await fetch(`${B}/api/events`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
  body: JSON.stringify({ events: [{ event: 'card_view', params: {} }] }) });
t('a cross-origin beacon is still accepted (it never touches the store)', r2.status === 204);
const r3 = await fetch(`${B}/api/events`, { method: 'POST', body: 'not json' });
t('bad JSON is a 400', r3.status === 400);

await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
