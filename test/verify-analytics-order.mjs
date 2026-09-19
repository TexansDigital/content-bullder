/**
 * Analytics and editorial order.
 *
 * Analytics is checked at the postMessage sink rather than at GA: the page posts every
 * event to its parent frame, so a harness can read exactly what a real embedder would,
 * without loading Google's script or depending on a network. GA itself is checked only
 * for the thing that could hurt — that an unvalidated id never reaches a script src.
 *
 * Reordering is checked all the way through: drag in the studio, then read the feed.
 */
import { chromium } from 'playwright';
const B = 'http://localhost:4400';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

await j('/api/items', { method: 'DELETE',
  body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });
await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
  urls: ['https://a.example/alpha.jpg', 'https://a.example/bravo.jpg', 'https://a.example/charlie.jpg']
    .join('\n'), collection: 'series' } }) });

const items = (await j('/api/items')).items;
for (const it of items)
  await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: it.id, changes: {
    status: 'published', action: { label: 'Watch', url: 'https://www.houstontexans.com' } } }) });

/* ---------- reordering ---------- */

const p = await b.newPage({ viewport: { width: 1500, height: 940 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${B}/`, { waitUntil: 'networkidle' });
await p.click('[data-status="published"]').catch(() => {});
await p.waitForTimeout(500);

const queue = () => p.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.dataset.id));
const before = await queue();
t(`the published queue lists every card (${before.length})`, before.length === 3);
t('every card has a drag grip', await p.evaluate(() =>
  document.querySelectorAll('.card .grip').length === 3));
t('cards are draggable', await p.evaluate(() =>
  [...document.querySelectorAll('.card')].every((c) => c.draggable)));

// Alt+ArrowDown carries the focused card past the next one — reorder without a mouse.
await p.focus(`.card[data-id="${before[0]}"]`);
await p.keyboard.press('Alt+ArrowDown');
await p.waitForTimeout(600);
const moved = await queue();
t(`alt+arrow moves a card (${before[0].slice(-6)}: 1 -> ${moved.indexOf(before[0]) + 1})`,
  moved[1] === before[0] && moved[0] === before[1]);
t('the moved card keeps focus', await p.evaluate(({ id }) =>
  document.activeElement?.dataset.id === id, { id: before[0] }));

// And with a mouse: drag the first card past the last one.
const pre = await queue();
await p.dragAndDrop(`.card[data-id="${pre[0]}"]`, `.card[data-id="${pre[2]}"]`);
await p.waitForTimeout(700);
const dragged = await queue();
t(`dragging moves a card (${pre[0].slice(-6)}: 1 -> ${dragged.indexOf(pre[0]) + 1})`,
  dragged.indexOf(pre[0]) > 0 && dragged.length === 3);
t('no card is lost or duplicated by a drag',
  new Set(dragged).size === 3 && pre.every((id) => dragged.includes(id)));

const ranks = (await j('/api/items')).items
  .reduce((a, i) => ((a[i.id] = i.sortIndex), a), {});
t('the new order is persisted as sortIndex',
  ranks[dragged[0]] === 0 && ranks[dragged[1]] === 1 && ranks[dragged[2]] === 2);

t('the feed agrees with the queue', await (async () => {
  const live = (await j('/api/feed')).clips.map((c) => c.id);
  return JSON.stringify(live) === JSON.stringify(dragged);
})());

await p.reload({ waitUntil: 'networkidle' });
await p.click('[data-status="published"]').catch(() => {});
await p.waitForTimeout(500);
t('the order survives a reload', JSON.stringify(await queue()) === JSON.stringify(dragged));

/* ---------- analytics ---------- */

const f = await b.newPage({ viewport: { width: 430, height: 880 } });
f.on('pageerror', (e) => errs.push(e.message));
// Unframed, the feed posts its events to itself, so the listener goes in before the
// document exists and nothing that fires on load is missed.
await f.addInitScript(() => {
  window.__ev = [];
  addEventListener('message', (e) => { if (e.data?.source === 'txfeed') window.__ev.push(e.data); });
});
await f.goto(`${B}/feed`, { waitUntil: 'networkidle' });
const evs = () => f.evaluate(() => window.__ev);

await f.waitForTimeout(1800);
t('the feed reports feed_load', (await evs()).some((e) => e.event === 'feed_load'));
t('feed_load carries the card count',
  (await evs()).find((e) => e.event === 'feed_load')?.params.feed_cards === 3);

const view = (await evs()).find((e) => e.event === 'card_view');
t('the first card reports a view', !!view);
t('a view carries the card dimensions', !!view
  && view.params.card_id && view.params.card_collection === 'series'
  && view.params.card_source === 'manual' && view.params.card_position === 1);

await f.click('.slide .like'); await f.waitForTimeout(250);
t('liking reports card_like', (await evs()).some((e) => e.event === 'card_like'));
await f.click('.slide .like'); await f.waitForTimeout(250);
t('unliking is its own event', (await evs()).some((e) => e.event === 'card_unlike'));

await f.click('.slide .sound'); await f.waitForTimeout(250);
t('the sound toggle reports its new state',
  (await evs()).find((e) => e.event === 'sound_toggle')?.params.sound_on === true);

await f.click('.slide .share'); await f.waitForTimeout(500);
t('sharing reports a method', ['native', 'clipboard', 'fallback']
  .includes((await evs()).find((e) => e.event === 'card_share')?.params.share_method));

await f.evaluate(() => document.querySelector('#next').click());
await f.waitForTimeout(1800);
const left = (await evs()).find((e) => e.event === 'card_exit' || e.event === 'card_complete');
t(`leaving a card reports dwell (${left?.event}, ${left?.params.card_dwell_ms}ms)`,
  typeof left?.params.card_dwell_ms === 'number' && left.params.card_dwell_ms > 0);
t('the outgoing card is the one reported, not the incoming one',
  left?.params.card_position === 1);
t('the second card reports its position',
  (await evs()).some((e) => e.event === 'card_view' && e.params.card_position === 2));

// Framed is the real deployment: the host page has to receive the same stream.
const host = await b.newPage({ viewport: { width: 430, height: 880 } });
host.on('pageerror', (e) => errs.push(e.message));
// The listener is inline and ahead of the iframe in document order, so it is live before
// the feed can load — setContent does not run page init scripts.
await host.setContent(
  `<script>window.__ev=[];addEventListener('message',function(e){
     if(e.data&&e.data.source==='txfeed'){window.__ev.push(e.data)}});<\/script>
   <iframe id="x" src="${B}/feed" style="width:430px;height:820px;border:0"></iframe>`,
  { waitUntil: 'networkidle' });
await host.waitForTimeout(2000);
const hostEv = await host.evaluate(() => window.__ev);
t(`an embedding page receives the stream (${hostEv.length} events)`,
  hostEv.some((e) => e.event === 'feed_load') && hostEv.some((e) => e.event === 'card_view'));

t('no GA script loads without a measurement id', await f.evaluate(() =>
  !document.querySelector('script[src*="googletagmanager"]')));

// The id reaches a script src, so a junk one must never be interpolated.
const g = await b.newPage({ viewport: { width: 430, height: 880 } });
await g.goto(`${B}/feed?ga=${encodeURIComponent('"></script><script>window.__x=1</script>')}`,
  { waitUntil: 'networkidle' });
await g.waitForTimeout(600);
t('a malformed ga id is refused, not injected', await g.evaluate(() =>
  !window.__x && !document.querySelector('script[src*="googletagmanager"]')));

await g.goto(`${B}/feed?ga=G-ABC1234567`, { waitUntil: 'networkidle' });
await g.waitForTimeout(800);
t('a well-formed ga id loads gtag', await g.evaluate(() =>
  !!document.querySelector('script[src*="googletagmanager.com/gtag/js?id=G-ABC1234567"]')));
t('the iframe sends no page_view of its own', await g.evaluate(() =>
  (window.dataLayer || []).some((a) => a[0] === 'config' && a[2]?.send_page_view === false)));

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
if (errs.length) console.log('page errors:\n' + errs.join('\n'));
await b.close();
process.exit(bad.length ? 1 : 0);
