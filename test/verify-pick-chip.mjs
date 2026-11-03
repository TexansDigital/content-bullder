/**
 * The pick chip: one tap on the card after a completed clip, instead of the picker card. The
 * studio on CHIP_BASE (4401) runs with FEED_KNOBS='{"pick_prompt":"chip",...}'; the one on
 * CONTROL_BASE (4400) runs the picker card. Cards are stills that hold two seconds, so a
 * completion is two seconds of waiting.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const CHIP = process.env.PREVIEW_BASE || 'http://localhost:4401';
const CONTROL = process.env.CONTROL_BASE || 'http://localhost:4400';
const b = await chromium.launch({ executablePath: headlessShell() });
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function seed(B) {
  const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
  await j('/api/items', { method: 'DELETE', body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });
  await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: { urls: [1, 2, 3, 4, 5].map((n) => `https://a.example/${n}.jpg`).join('\n'), collection: 'players' } }) });
  const items = (await j('/api/items')).items;
  const tail = [
    { headline: 'Stroud dime', entities: { players: ['c-j-stroud'] }, contentType: 'game_action', publishedAt: '2026-10-30T00:00:00Z', advance: { mode: 'auto', seconds: 2 } },
    { headline: 'Camp day', entities: { players: [] }, contentType: 'offseason_camp', publishedAt: '2026-10-29T00:00:00Z', advance: { mode: 'manual', seconds: 6 } },
    { headline: 'Anderson sack', entities: { players: ['will-anderson-jr'] }, contentType: 'game_action', publishedAt: '2026-10-28T00:00:00Z', advance: { mode: 'manual', seconds: 6 } },
    { headline: 'Stroud to Dell', entities: { players: ['c-j-stroud', 'tank-dell'] }, contentType: 'game_action', publishedAt: '2026-10-27T00:00:00Z', advance: { mode: 'manual', seconds: 6 } },
    { headline: 'TORO prank', entities: { players: [] }, contentType: 'mascot_skits', publishedAt: '2026-10-26T00:00:00Z', advance: { mode: 'manual', seconds: 6 } },
  ];
  for (let i = 0; i < items.length; i++) await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[i].id, changes: { ...tail[i], status: 'published', sortIndex: i } }) });
  return items.map((i) => i.id);
}
const ids = await seed(CHIP); const cids = await seed(CONTROL);
const RUN = Date.now();

async function open(B, query) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const pg = await ctx.newPage();
  const errs = [], ev = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/events')) { try { ev.push(...(JSON.parse(r.postData() || '{}').events || [])); } catch {} } });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.goto(`${B}/feed?${query}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  return { pg, ctx, errs, ev };
}
const order = (pg) => pg.evaluate(() => [...document.querySelectorAll('#feed .slide')].map((s) => s.dataset.id));
const chip = (pg) => pg.evaluate(() => { const c = document.querySelector('.pickchip'); return c ? { text: c.textContent.trim(), on: c.classList.contains('in'), done: c.classList.contains('done'), slide: c.closest('.slide').dataset.id } : null; });
const flush = (pg) => pg.waitForTimeout(2600);

/* ---------- chip arm: the first clip completes, the chip appears on the next card ---------- */
{
  const r = await open(CHIP, `pid=sess_${RUN}_chip1`);
  const o = await order(r.pg);
  t(`in the chip arm no picker card is in the feed (${o.slice(0, 4).join(' ')})`, !o.includes('sys-picker'));
  t('no chip before anything has been completed', (await chip(r.pg)) === null);
  await r.pg.waitForTimeout(3400);   // the two-second hold completes card 1 and the feed advances on its own
  const c = await chip(r.pg);
  t(`after the Stroud clip completes, the next card carries one chip: More C.J. Stroud (${c && c.text})`, c && /^More/.test(c.text) && /Stroud/.test(c.text) && c.on && c.slide === ids[1]);
  await flush(r.pg);
  t('pick_chip_shown fired with the player and the clip that earned it', r.ev.some((e) => e.event === 'pick_chip_shown' && e.params.pref_player === 'c-j-stroud' && e.params.chip_from === ids[0] && e.params.card_id === ids[1]));
  await r.pg.tap('.pickchip');
  await flush(r.pg);
  const after = await order(r.pg);
  const c2 = await chip(r.pg);
  t('a tap saves the pick from the chip, without leaving the card', r.ev.some((e) => e.event === 'prefs_save' && e.params.save_source === 'chip' && e.params.pref_player === 'c-j-stroud' && e.params.players_n === 1));
  t(`the other Stroud clip comes next, with a reason on it (${after.slice(0, 4).join(' ')})`, after[2] === ids[3] && await r.pg.evaluate((id) => /Because you picked/.test(document.querySelector(`.slide[data-id="${id}"] .why`)?.textContent || ''), ids[3]));
  t('the chip says the pick took and then goes', (c2 === null) || (c2.done && /first/.test(c2.text)));
  await r.pg.waitForTimeout(2600);
  t('the chip is gone a moment later', (await chip(r.pg)) === null);
  t('the Your feed chip now shows the feed is set', await r.pg.evaluate(() => Boolean(document.querySelector('#bar .chip.mine'))));
  t('no page errors', r.errs.length === 0);
  await r.ctx.close();
}

/* ---------- chip arm: a chip not tapped fades, is not re-offered for that player today, and a second player is still asked ---------- */
{
  const r = await open(CHIP, `pid=sess_${RUN}_chip2`);
  await r.pg.waitForTimeout(3400);
  t('the chip is up on card 2', (await chip(r.pg)) !== null);
  await r.pg.waitForTimeout(7600);
  t('left alone, the chip fades after seven seconds', (await chip(r.pg)) === null);
  // Reload: Stroud completes again, but he was offered today, so no chip for him.
  await r.pg.reload({ waitUntil: 'networkidle' }); await r.pg.waitForTimeout(4000);
  t('the same player is not offered again the same day', (await chip(r.pg)) === null);
  await flush(r.pg);
  t('a fan who ignored the chip never saw a picker card either', !r.ev.some((e) => e.event === 'card_view' && e.params.card_id === 'sys-picker'));
  await r.ctx.close();
}

/* ---------- chip arm: a clip without a player earns nothing; a system card never carries a chip ---------- */
{
  const r = await open(CHIP, `pid=sess_${RUN}_chip3`);
  await r.pg.waitForTimeout(3400);
  // Now on card 2 (Camp day, no player). Complete it by advancing past it after a dwell: no chip should be owed for it.
  await r.pg.evaluate(() => { document.querySelector('.pickchip')?.remove(); const f = document.querySelector('#feed'); f.scrollTop = 2 * f.clientHeight; });
  await r.pg.waitForTimeout(1500);
  t('a completed clip with no player tagged earns no chip', (await chip(r.pg)) === null);
  await r.ctx.close();
}

/* ---------- chip arm: a clip with no player offers its lane instead ---------- */
{
  // Re-seed with a camp clip first: no player, content type offseason_camp, which is the "Mic'd up & inside" lane.
  const j = async (p, o) => (await fetch(CHIP + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
  const items = (await j('/api/items')).items;
  const camp = items.find((i) => i.headline === 'Camp day'), dime = items.find((i) => i.headline === 'Stroud dime');
  await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: camp.id, changes: { sortIndex: -1, advance: { mode: 'auto', seconds: 2 } } }) });
  await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: dime.id, changes: { sortIndex: 1, advance: { mode: 'manual', seconds: 6 } } }) });
  const r = await open(CHIP, `pid=sess_${RUN}_lane1`);
  const o = await order(r.pg);
  t(`the camp clip leads (${o.slice(0, 3).join(' ')})`, o[0] === camp.id);
  await r.pg.waitForTimeout(3400);
  const c = await chip(r.pg);
  t(`after a clip with no player, the chip names the lane: More Mic'd up & inside (${c && c.text})`, c && /Mic.d up & inside/.test(c.text) && /^More/.test(c.text));
  await flush(r.pg);
  t('pick_chip_shown carries the lane, not a player', r.ev.some((e) => e.event === 'pick_chip_shown' && e.params.pref_lane === 'inside' && !e.params.pref_player));
  await r.pg.tap('.pickchip');
  await flush(r.pg);
  t('a tap saves the lane as a want from the chip', r.ev.some((e) => e.event === 'prefs_save' && e.params.save_source === 'chip' && e.params.pref_lane === 'inside' && e.params.wants_n === 1 && e.params.players_n === 0));
  const c2 = await chip(r.pg);
  t('the chip says the lane took', c2 === null || (c2.done && /Mic.d up & inside first/.test(c2.text)));
  await r.ctx.close();
  await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: camp.id, changes: { sortIndex: 1, advance: { mode: 'manual', seconds: 6 } } }) });
  await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: dime.id, changes: { sortIndex: 0, advance: { mode: 'auto', seconds: 2 } } }) });
}

/* ---------- control arm: the picker card, and a swipe past it counts as no for a day ---------- */
{
  const r = await open(CONTROL, `pid=sess_${RUN}_ctl1`);
  const o = await order(r.pg);
  t(`the control arm still has the picker card at card 3 (${o.slice(0, 4).join(' ')})`, o[2] === 'sys-picker');
  await r.pg.waitForTimeout(3400);
  t('the control arm never shows a chip', (await chip(r.pg)) === null);
  // Look at the picker for a second, then swipe past it.
  await r.pg.evaluate(() => { const f = document.querySelector('#feed'); f.scrollTop = 2 * f.clientHeight; });
  await r.pg.waitForTimeout(1400);
  await r.pg.evaluate(() => { const f = document.querySelector('#feed'); f.scrollTop = 3 * f.clientHeight; });
  await flush(r.pg);
  t('swiping past the picker records prefs_swipe with the dwell', r.ev.some((e) => e.event === 'prefs_swipe' && e.params.card_id === 'sys-picker' && e.params.card_dwell_ms >= 1000));
  await r.pg.reload({ waitUntil: 'networkidle' }); await r.pg.waitForTimeout(800);
  t('on the next load the picker is not offered again', !(await order(r.pg)).includes('sys-picker'));
  await r.pg.evaluate(() => { try { const all = JSON.parse(localStorage.getItem('txfeed.prefs.swiped') || '0'); localStorage.setItem('txfeed.prefs.swiped', String(Date.now() - 25 * 3600e3)); } catch {} });
  await r.pg.reload({ waitUntil: 'networkidle' }); await r.pg.waitForTimeout(800);
  t('a day later it is offered again', (await order(r.pg)).includes('sys-picker'));
  await r.ctx.close();
}

await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
