/**
 * The preference layer, on the page. A fan is offered the picker after a couple of cards,
 * picks a player and a lane, and sees the feed reorder on the spot with a reason on the card
 * that moved. "Not now" is remembered. A saved fan gets a "Your feed" chip back to the picker.
 * A capture card opens the entry form in the modal with this session's id. Knobs from the
 * server move the picker and switch the reasons.
 *
 * Runs against the local server, which keeps preferences in prefs.json beside the store and
 * serves the same picker shape the Worker does.
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
// Five catalogue-like cards: all in the rankable tail, two about Anderson, one about Stroud.
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
// Fresh ids per run: the local server keeps preferences in prefs.json between runs.
const RUN = Date.now();
const PID = `sess_${RUN}_prefstest`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function open({ pid = PID, knobs = null } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 } });
  const pg = await ctx.newPage();
  const errs = [], ev = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/events')) { try { ev.push(...(JSON.parse(r.postData() || '{}').events || [])); } catch {} } });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  if (knobs) {
    // Knobs come from the server; here the server's answer is rewritten on the way in.
    await pg.route(/\/api\/feed/, async (r) => {
      const res = await r.fetch(); const body = await res.json();
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, knobs: { ...body.knobs, ...knobs } }) });
    });
  }
  await pg.goto(`${B}/feed?pid=${pid}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  return { pg, ctx, errs, ev };
}
const ids = (pg) => pg.evaluate(() => [...document.querySelectorAll('.slide')].map((s) => s.dataset.id));
const settle = (pg) => pg.waitForTimeout(2300);

/* ---------- the offer ---------- */
const a = await open();
let order = await ids(a.pg);
t('the picker is offered as the third card, after two cards have had their say', order[2] === 'sys-picker' && order.length === 6);
t('it shows the catalogue\'s players, the lanes, watch-or-read', await a.pg.evaluate(() =>
  document.querySelectorAll('.pk .players .opt').length === 2 && document.querySelectorAll('.pk .lanes .opt').length === 5 && document.querySelectorAll('.pk .format .opt').length === 2));
t('the two players are named, not slugged', (await a.pg.locator('.pk .players .opt').allTextContents()).sort().join() === 'C J Stroud,Will Anderson Jr');
t('no "Your feed" chip before anything is saved', (await a.pg.locator('.chip.mine').count()) === 0);

// Pick Anderson and the inside lane, save.
await a.pg.locator('.pk .players .opt', { hasText: 'Will Anderson Jr' }).click();
await a.pg.locator('.pk .lanes .opt', { hasText: "Mic'd up" }).click();
await a.pg.locator('.pk .save').click();
await a.pg.waitForTimeout(900);
order = await ids(a.pg);
t('saving reorders the feed on the spot: an Anderson card leads', order[0] === items[2].id || order[0] === items[4].id);
t('the mic\'d up Anderson card wins the tie because the lane says so', order[0] === items[4].id);
t('the picker card is gone from the feed', !order.includes('sys-picker'));
t('the moved card says why, in the fan\'s words', (await a.pg.locator('.slide[data-index="0"] .why').textContent()) === 'Because you picked Will Anderson Jr');
t('a card the pick did not touch carries no reason', (await a.pg.locator(`.slide[data-id="${items[1].id}"] .why`).count()) === 0);
t('a toast confirms it with the first reason', /Your feed is set\. First up: because you picked will anderson jr\./.test(await a.pg.locator('#toast').textContent()));
t('a "Your feed" chip appears first in the bar', (await a.pg.locator('#bar .chip').first().textContent()).startsWith('Your feed'));
await settle(a.pg);
t('prefs_save is reported with what was picked, then the feed reloads as personal', (() => {
  const s = a.ev.find((e) => e.event === 'prefs_save'); const l = a.ev.filter((e) => e.event === 'feed_load');
  return s && s.params.players_n === 1 && s.params.wants_n === 1 && s.params.card_id === 'sys-picker' && l.length === 2 && l[1].params.feed_rank === 'personal' && l[1].params.has_prefs === true && l[1].params.feed_reload === 'prefs';
})());
t('the save landed on the server', (await j(`/api/feed?sid=${PID}`)).prefs.players.join() === 'will-anderson-jr');

// Reload: the saved fan gets the personal order from the first paint and no picker.
await a.pg.reload({ waitUntil: 'networkidle' }); await a.pg.waitForTimeout(600);
order = await ids(a.pg);
t('on the next visit the order is personal from the first card and the picker is not re-offered', order[0] === items[4].id && !order.includes('sys-picker'));
// Edit via the chip: the picker returns at the top, prefilled.
await a.pg.locator('.chip.mine').click(); await a.pg.waitForTimeout(300);
t('"Your feed" brings the picker back at the top, prefilled', (await ids(a.pg))[0] === 'sys-picker' && (await a.pg.locator('.pk .players .opt[aria-pressed="true"]').textContent()) === 'Will Anderson Jr' && (await a.pg.locator('.pk .save').textContent()) === 'Update my feed');
await a.pg.locator('.pk .skip').click(); await a.pg.waitForTimeout(200);
t('Cancel puts the feed back without changing anything', !(await ids(a.pg)).includes('sys-picker') && (await ids(a.pg))[0] === items[4].id);
t('no page errors', a.errs.length === 0);
await a.ctx.close();

/* ---------- not now ---------- */
const n = await open({ pid: `sess_${RUN}_skipstest` });
await n.pg.locator('.pk .skip').click(); await n.pg.waitForTimeout(200);
t('"Not now" removes the picker', !(await ids(n.pg)).includes('sys-picker'));
await settle(n.pg);
t('the skip is reported', n.ev.some((e) => e.event === 'prefs_skip' && e.params.card_id === 'sys-picker'));
await n.pg.reload({ waitUntil: 'networkidle' }); await n.pg.waitForTimeout(600);
t('and it stays away on the next visit', !(await ids(n.pg)).includes('sys-picker'));
await n.ctx.close();

/* ---------- knobs ---------- */
const k = await open({ pid: `sess_${RUN}_knobstest1`, knobs: { picker_position: 0 } });
t('a knob moves the picker to the first card', (await ids(k.pg))[0] === 'sys-picker');
await k.ctx.close();
const k2 = await open({ pid: `sess_${RUN}_knobstest2`, knobs: { picker_position: -1 } });
t('a knob can hide the picker entirely', !(await ids(k2.pg)).includes('sys-picker'));
await k2.ctx.close();
const k3 = await open({ knobs: { reason_pills: 'off' } });
t('reasons can be switched off for an arm', (await k3.pg.locator('.why').count()) === 0 && (await ids(k3.pg))[0] === items[4].id);
await k3.ctx.close();

/* ---------- the capture card ---------- */
const c = await open({ pid: `sess_${RUN}_capturetest`, knobs: { picker_position: -1, capture_card: { position: 1, headline: 'Win two tickets', blurb: 'Enter by Friday.', cta: 'Enter now', form: 'HTX_Sweeps_Test', campaign: 'cmp-1' } } });
let ord = await ids(c.pg);
t('the capture card sits where the knob put it', ord[1] === 'sys-enter' && (await c.pg.locator('.slide[data-id="sys-enter"] h2').textContent()) === 'Win two tickets');
await c.pg.locator('.slide[data-id="sys-enter"] .go').click(); await c.pg.waitForTimeout(400);
const src = await c.pg.locator('#player iframe').getAttribute('src');
t('Enter opens the form in the modal with this session\'s id, the form name and the card', /^\/enter\?/.test(src) && new RegExp(`pid=sess_${RUN}_capturetest`).test(src) && /form=HTX_Sweeps_Test/.test(src) && /cid=cmp-1/.test(src) && /card=sys-enter/.test(src));
t('the feed behind it is inert', (await c.pg.locator('#feed').getAttribute('inert')) !== null);
await c.pg.keyboard.press('Escape'); await c.pg.waitForTimeout(200);
t('Escape closes it and the feed is live again', await c.pg.locator('#player').isHidden() && (await c.pg.locator('#feed').getAttribute('inert')) === null);
await settle(c.pg);
t('open and close are reported against the capture card', c.ev.some((e) => e.event === 'capture_open' && e.params.card_id === 'sys-enter') && c.ev.some((e) => e.event === 'capture_close'));
t('no page errors on the capture flow', c.errs.length === 0);
await c.ctx.close();

/* ---------- nobody to save for ---------- */
const anon = await b.newPage({ viewport: { width: 390, height: 780 } });
await anon.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
await anon.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
await anon.goto(`${B}/feed`, { waitUntil: 'networkidle' }); await anon.waitForTimeout(600);
t('with no id to save against (storage blocked, no host id) the picker is not offered', !(await ids(anon)).includes('sys-picker') && (await ids(anon)).length === 5);
await anon.close();

await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
