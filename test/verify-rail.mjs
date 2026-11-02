/**
 * The rail: the feed as a row of tiles the width of the slot, for the roster and the player
 * pages. A tile opens the feed at that card and the same observer records the view there; a
 * player page lifts that player's cards and says so on the tile; every load says which
 * placement it was and whether the fan has been here before.
 *
 * Runs against the local server on 4400.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const B = 'http://localhost:4400';
const b = await chromium.launch({ executablePath: headlessShell() });
const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

await j('/api/items', { method: 'DELETE', body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });
await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
  urls: ['https://a.example/1.jpg', 'https://a.example/2.jpg', 'https://a.example/3.jpg', 'https://a.example/4.jpg', 'https://a.example/5.jpg'].join('\n'), collection: 'players' } }) });
const items = (await j('/api/items')).items;
const tail = [
  { headline: 'Stroud dime', entities: { players: ['c-j-stroud'] }, contentType: 'game_action', publishedAt: '2026-10-30T00:00:00Z' },
  { headline: 'TORO prank', entities: { players: [] }, contentType: 'mascot_skits', publishedAt: '2026-10-29T00:00:00Z' },
  { headline: 'Anderson sack', entities: { players: ['will-anderson-jr'] }, contentType: 'game_action', publishedAt: '2026-10-28T00:00:00Z' },
  { headline: 'Camp day', entities: { players: [] }, contentType: 'offseason_camp', publishedAt: '2026-10-27T00:00:00Z' },
  { headline: 'Anderson mic\'d up', entities: { players: ['will-anderson-jr'] }, contentType: 'player_stories', publishedAt: '2026-10-26T00:00:00Z' },
];
for (let i = 0; i < items.length; i++) {
  await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[i].id, changes: { ...tail[i], status: 'published', sortIndex: 1_000_000 } }) });
}
const RUN = Date.now();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function open(query, { viewport = { width: 1200, height: 560 }, init = null } = {}) {
  const ctx = await b.newContext({ viewport });
  const pg = await ctx.newPage();
  const errs = [], ev = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/events')) { try { ev.push(...(JSON.parse(r.postData() || '{}').events || [])); } catch {} } });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  if (init) await pg.addInitScript(init);
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.goto(`${B}/feed?${query}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  return { pg, ctx, errs, ev };
}
const tiles = (pg) => pg.evaluate(() => [...document.querySelectorAll('#tiles .tile')].map((s) => s.dataset.id));
const settle = (pg) => pg.waitForTimeout(2300);
const load = (ev) => ev.find((e) => e.event === 'feed_load');

/* ---------- the roster slot ---------- */
const r = await open(`layout=rail&placement=roster&pid=sess_${RUN}_railroster`);
t('the page takes the rail layout', await r.pg.evaluate(() => document.body.classList.contains('rail-mode')));
let ts = await tiles(r.pg);
t('one tile per card, the picker among them, in a row the width of the slot', ts.length === 6 && ts[2] === 'sys-picker' && await r.pg.evaluate(() => {
  const box = document.querySelector('#tiles').getBoundingClientRect(); const first = document.querySelector('#tiles .tile').getBoundingClientRect();
  return box.width > 1000 && first.height > 300 && Math.abs(first.width / first.height - 9 / 16) < 0.02;
}));
t('the tiles sit side by side, not stacked', await r.pg.evaluate(() => { const [a, c] = document.querySelectorAll('#tiles .tile'); return c.getBoundingClientRect().left > a.getBoundingClientRect().right && Math.abs(a.getBoundingClientRect().top - c.getBoundingClientRect().top) < 1; }));
t('the feed itself is closed until a tile is tapped', !(await r.pg.evaluate(() => document.querySelector('#stage').classList.contains('open'))) && await r.pg.locator('#stage').isHidden());
await settle(r.pg);
t('no card is viewed while the feed is closed', !r.ev.some((e) => e.event === 'card_view'));
const fl = load(r.ev);
t('the load says where it is and that this is a first visit', fl && fl.params.feed_layout === 'rail' && fl.params.feed_placement === 'roster' && fl.params.visit_n === 1 && fl.params.returning === false && fl.params.days_since === undefined);

// Tap the fourth tile: the feed opens on that card and the view is recorded there.
await r.pg.locator('#tiles .tile').nth(3).click(); await r.pg.waitForTimeout(400);
t('a tile opens the feed full-frame', await r.pg.evaluate(() => document.querySelector('#stage').classList.contains('open')) && await r.pg.locator('#stage').isVisible());
t('at the card that was tapped', await r.pg.evaluate(() => { const f = document.querySelector('#feed'); return Math.round(f.scrollTop / f.clientHeight) === 3; }));
await settle(r.pg);
t('rail_open and the first card_view both name position 4; card one was never viewed', r.ev.some((e) => e.event === 'rail_open' && e.params.card_position === 4 && e.params.card_id === ts[3])
  && r.ev.filter((e) => e.event === 'card_view').every((e) => e.params.card_position === 4) && r.ev.some((e) => e.event === 'card_view'));
await r.pg.locator('#rclose').click(); await r.pg.waitForTimeout(300);
t('the close button returns to the tiles', !(await r.pg.evaluate(() => document.querySelector('#stage').classList.contains('open'))));
await settle(r.pg);
t('closing is reported against the card that was open', r.ev.some((e) => e.event === 'rail_close' && e.params.card_position === 4));
await r.pg.locator('#tiles .tile').nth(0).click(); await r.pg.waitForTimeout(300);
await r.pg.keyboard.press('Escape'); await r.pg.waitForTimeout(200);
t('Escape closes it too', !(await r.pg.evaluate(() => document.querySelector('#stage').classList.contains('open'))));
t('no page errors', r.errs.length === 0);
await r.ctx.close();

/* ---------- a long feed, a short strip ---------- */
const many = await b.newContext({ viewport: { width: 1200, height: 560 } });
const mp = await many.newPage();
await mp.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
await mp.route(/\/api\/feed/, async (r) => {
  const res = await r.fetch(); const body = await res.json();
  const clips = Array.from({ length: 120 }, (_, i) => ({ ...body.clips[i % body.clips.length], id: `many-${i}` }));
  await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, clips }) });
});
await mp.goto(`${B}/feed?layout=rail&pid=sess_${RUN}_many`, { waitUntil: 'networkidle' }); await mp.waitForTimeout(600);
t('a long feed shows forty tiles at most while the feed behind it keeps every card', (await mp.evaluate(() => document.querySelectorAll('#tiles .tile').length)) === 40 && (await mp.evaluate(() => document.querySelectorAll('#feed .slide').length)) > 100);
await many.close();

/* ---------- a player's page ---------- */
const p = await open(`layout=rail&placement=player&focus=will-anderson-jr&pid=sess_${RUN}_railplayer`);
ts = await tiles(p.pg);
t('on a player\'s page their cards lead the rail', ts[0] === items[2].id && ts[1] === items[4].id);
t('and the tile says whose page this is', (await p.pg.locator('#tiles .tile').first().locator('.why').textContent()) === 'Will Anderson Jr');
t('a card about someone else carries no reason', (await p.pg.locator(`#tiles .tile[data-id="${items[0].id}"] .why`).count()) === 0);
await p.pg.locator('#tiles .tile[data-id="sys-picker"]').click(); await p.pg.waitForTimeout(300);
t('the picker opens with that player already pressed: the page is the first pick', (await p.pg.locator('.pk .players .opt[aria-pressed="true"]').textContent()) === 'Will Anderson Jr');
await settle(p.pg);
const pl = load(p.ev);
t('the load names the player and the rank is honest about why', pl && pl.params.feed_focus === 'will-anderson-jr' && pl.params.feed_rank === 'focused' && pl.params.feed_placement === 'player');
t('no page errors on the player page', p.errs.length === 0);
await p.ctx.close();

const unknown = await open(`layout=rail&focus=nobody-here&pid=sess_${RUN}_railnobody`);
t('a player nobody tagged leaves the shared order and claims no focus', (await tiles(unknown.pg))[0] === items[0].id && !(await unknown.pg.evaluate(() => document.querySelector('#tiles .why'))));
await settle(unknown.pg);
t('and the load carries no focus', load(unknown.ev) && load(unknown.ev).params.feed_focus === undefined && load(unknown.ev).params.feed_rank === 'shared');
await unknown.ctx.close();

/* ---------- a returning fan ---------- */
const back = await open(`layout=rail&placement=roster&pid=sess_${RUN}_railback`, { init: () => {
  localStorage.setItem('txfeed.visits', JSON.stringify({ n: 3, last: Date.now() - 2 * 86400e3, first: Date.now() - 20 * 86400e3 }));
} });
await settle(back.pg);
const bl = load(back.ev);
t('a fan seen before is a returning fan: visit four, two days since the last', bl && bl.params.returning === true && bl.params.visit_n === 4 && bl.params.days_since === 2);
await back.pg.reload({ waitUntil: 'networkidle' }); await settle(back.pg);
const again = back.ev.filter((e) => e.event === 'feed_load').pop();
t('a reload minutes later is the same visit, not a fifth', again.params.visit_n === 4);
await back.ctx.close();

/* ---------- posters that are not there ---------- */
// A Short's largest YouTube poster is often missing; the tile walks the chain like the card does.
await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[1].id, changes: { media: { kind: 'youtube', videoId: 'abcdefghijk', url: 'https://www.youtube.com/shorts/abcdefghijk' }, poster: ['https://a.example/missing.jpg', 'https://a.example/also-missing.jpg', 'https://a.example/ok.jpg'] } }) });
const fb = await b.newContext({ viewport: { width: 1200, height: 560 } });
const fbp = await fb.newPage();
await fbp.route(/a\.example\//, (r) => (/missing/.test(r.request().url()) ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ status: 200, contentType: 'image/png', body: PNG })));
await fbp.goto(`${B}/feed?layout=rail&pid=sess_${RUN}_railposter`, { waitUntil: 'networkidle' }); await fbp.waitForTimeout(800);
t('a tile whose first posters 404 ends on the one that exists', await fbp.evaluate((id) => document.querySelector(`#tiles .tile[data-id="${id}"] img`)?.src.endsWith('/ok.jpg'), items[1].id));
t('a tile with no working poster keeps its ground, not a broken glyph', await fbp.evaluate(() => { const t = document.querySelector('#tiles .tile'); return t.querySelector('.gen') !== null; }));
await fb.close();
await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[1].id, changes: { media: { kind: 'image', url: 'https://a.example/2.jpg' }, poster: ['https://a.example/2.jpg'] } }) });

/* ---------- one collection only ---------- */
await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[3].id, changes: { collection: 'community' } }) });
const lk = await open(`collection=community&placement=community&pid=sess_${RUN}_locked`, { viewport: { width: 390, height: 780 } });
t('a page can lock the feed to one collection: only those cards, no chip bar', (await lk.pg.evaluate(() => [...document.querySelectorAll('.slide')].map((s) => s.dataset.id))).join() === items[3].id && await lk.pg.locator('#bar').isHidden() && await lk.pg.evaluate(() => document.body.classList.contains('locked')));
t('and the feed still has its full height with the bar gone', await lk.pg.evaluate(() => document.querySelector('#feed').getBoundingClientRect().height > 700));
const lkr = await open(`layout=rail&collection=community&pid=sess_${RUN}_lockedrail`);
t('the locked rail keeps its tile height too', await lkr.pg.evaluate(() => document.querySelector('#tiles .tile')?.getBoundingClientRect().height > 300));
await lkr.ctx.close();
await settle(lk.pg);
t('and every event says which collection it was', load(lk.ev)?.params.feed_collection === 'community' && load(lk.ev).params.feed_placement === 'community');
await lk.ctx.close();
const lu = await open(`collection=nothing-here&pid=sess_${RUN}_unlocked`, { viewport: { width: 390, height: 780 } });
t('an unknown collection key is ignored and the whole feed is served', (await lu.pg.evaluate(() => document.querySelectorAll('.slide').length)) >= 5 && await lu.pg.locator('#bar').isVisible());
await lu.ctx.close();
await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[3].id, changes: { collection: 'players' } }) });

/* ---------- the phone layout is untouched ---------- */
const f = await open(`pid=sess_${RUN}_plain`, { viewport: { width: 390, height: 780 } });
t('without the parameter the feed is the feed: phone layout, tiles hidden', !(await f.pg.evaluate(() => document.body.classList.contains('rail-mode'))) && await f.pg.locator('#tiles').isHidden() && await f.pg.locator('#feed').isVisible());
await settle(f.pg);
t('its load says so', load(f.ev)?.params.feed_layout === 'feed' && load(f.ev).params.feed_placement === undefined && load(f.ev).params.visit_n === 1);
t('no page errors', f.errs.length === 0);
await f.ctx.close();

/* ---------- a phone-sized rail ---------- */
const m = await open(`layout=rail&placement=roster&pid=sess_${RUN}_railphone`, { viewport: { width: 390, height: 420 } });
t('on a phone the tiles still run in a row under the bar', await m.pg.evaluate(() => { const [a, c] = document.querySelectorAll('#tiles .tile'); const bar = document.querySelector('#bar').getBoundingClientRect(); return c.getBoundingClientRect().left > a.getBoundingClientRect().right && a.getBoundingClientRect().top >= bar.bottom - 1; }));
await m.pg.locator('#tiles .tile').nth(1).click(); await m.pg.waitForTimeout(300);
t('and the open feed fills the frame', await m.pg.evaluate(() => { const ph = document.querySelector('.phone').getBoundingClientRect(); return Math.abs(ph.width - innerWidth) < 2 && Math.abs(ph.height - innerHeight) < 2; }));
t('no page errors on the phone', m.errs.length === 0);
await m.ctx.close();

await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
