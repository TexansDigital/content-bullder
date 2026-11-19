/**
 * The pick'em chip: with pick_chip_game 1 (PICKCHIP_BASE 4406, FEED_KNOBS pick_chip_game 1 and
 * pick_prompt card) the first completed clip earns one line on the next card, "Who wins Sunday?"
 * with Texans and the opponent as buttons, no card of its own; a tap posts the pick, the chip says
 * the split and that the pick is saved, pick_made carries pick_from chip, and the chip never comes
 * back in that visit or once the game is called. With the default (0) there is no game chip.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const CHIP = process.env.PICKCHIP_BASE || 'http://localhost:4406';
const CTRL = process.env.CONTROL_BASE || 'http://localhost:4400';
const b = await chromium.launch({ executablePath: headlessShell() });
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function seed(B) {
  const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
  await j('/api/items', { method: 'DELETE', body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });
  await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: { urls: [1, 2, 3, 4].map((n) => `https://a.example/${n}.jpg`).join('\n'), collection: 'players' } }) });
  const items = (await j('/api/items')).items;
  const tail = [
    { headline: 'Stroud dime', entities: { players: ['c-j-stroud'] }, contentType: 'game_action', publishedAt: '2026-10-30T00:00:00Z', advance: { mode: 'auto', seconds: 2 } },
    { headline: 'Camp day', entities: { players: [] }, contentType: 'offseason_camp', publishedAt: '2026-10-29T00:00:00Z', advance: { mode: 'manual', seconds: 6 } },
    { headline: 'Anderson sack', entities: { players: ['will-anderson-jr'] }, contentType: 'game_action', publishedAt: '2026-10-28T00:00:00Z', advance: { mode: 'manual', seconds: 6 } },
    { headline: 'TORO prank', entities: { players: [] }, contentType: 'mascot_skits', publishedAt: '2026-10-27T00:00:00Z', advance: { mode: 'manual', seconds: 6 } },
  ];
  for (let i = 0; i < items.length; i++) await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[i].id, changes: { ...tail[i], status: 'published', sortIndex: i } }) });
  return items.map((i) => i.id);
}
const ids = await seed(CHIP); await seed(CTRL);
const RUN = Date.now();

async function open(B, pid) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const pg = await ctx.newPage();
  const errs = [], ev = [], picks = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => {
    if (r.method() !== 'POST') return;
    if (r.url().endsWith('/api/events')) { try { ev.push(...(JSON.parse(r.postData() || '{}').events || [])); } catch {} }
    if (r.url().endsWith('/api/pick')) picks.push(r.postData() || '');
  });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.goto(`${B}/feed?pid=${pid}&placement=roster`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  return { pg, ctx, errs, ev, picks };
}
const chip = (pg) => pg.evaluate(() => { const c = document.querySelector('.pickchip.game'); return c ? { text: c.textContent.trim(), on: c.classList.contains('in'), done: c.classList.contains('done'), slide: c.closest('.slide').dataset.id, buttons: Array.from(c.querySelectorAll('button')).map((x) => x.textContent.trim()) } : null; });
const hasCard = (pg) => pg.evaluate(() => Boolean(document.querySelector('.pk.pickem')));

{
  const pid = `sess_${RUN}_pickchip1`;
  const r = await open(CHIP, pid);
  t('no pick card in the feed and no chip before a clip completes', !(await hasCard(r.pg)) && (await chip(r.pg)) === null);
  await r.pg.waitForTimeout(3400);
  const c = await chip(r.pg);
  t(`after the first clip completes the next card carries the ask as one line (${c && c.text})`, c && /^Who wins \w+\?/.test(c.text) && c.buttons.join('|') === 'Texans|Browns' && c.on && c.slide === ids[1]);
  await r.pg.waitForTimeout(800);
  t('pick_chip_shown says it was the game', r.ev.some((e) => e.event === 'pick_chip_shown' && e.params.chip_kind === 'game' && e.params.game_id === 57));
  await r.pg.click('.pickchip.game button[data-k="texans"]');
  await r.pg.waitForFunction(() => document.querySelector('.pickchip.game.done'), null, { timeout: 4000 }).catch(() => {});
  const d = await chip(r.pg);
  t(`a tap answers on the chip with the split and says the pick is saved (${d && d.text})`, d && d.done && /You and 100% say Texans\. Your pick is saved\./.test(d.text));
  t('the pick is posted with the game, the side and the pocket id', r.picks.length === 1 && /"game_id":57/.test(r.picks[0]) && /"pick":"texans"/.test(r.picks[0]) && r.picks[0].includes(pid));
  await r.pg.waitForTimeout(2600);
  t('pick_made says it came from the chip', r.ev.some((e) => e.event === 'pick_made' && e.params.pick === 'texans' && e.params.pick_from === 'chip' && e.params.pick_share === 100));
  t('no page errors', r.errs.length === 0);
  await r.ctx.close();
  // The same fan again: the game is called, no chip.
  const again = await open(CHIP, pid);
  await again.pg.waitForTimeout(3400);
  t('once the game is called the chip does not come back', (await chip(again.pg)) === null);
  await again.ctx.close();
}
{
  // A fan who ignores it: the chip fades and is not asked again this visit.
  const r = await open(CHIP, `sess_${RUN}_pickchip2`);
  await r.pg.waitForTimeout(3400);
  const c0 = await chip(r.pg);
  await r.pg.waitForTimeout(11000);
  const c1 = await chip(r.pg);
  t('an ignored chip fades on its own', c0 && c0.on && c1 === null);
  t('and leaves no pick and no skip behind', r.picks.length === 0 && !r.ev.some((e) => e.event === 'pick_skip'));
  await r.ctx.close();
}
{
  const r = await open(CTRL, `sess_${RUN}_pickchip3`);
  await r.pg.waitForTimeout(3400);
  t('with the knob off there is no game chip', (await chip(r.pg)) === null);
  await r.ctx.close();
}

await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
