/**
 * The chip_hold knob: with it on (HOLD_BASE, FEED_KNOBS pick_prompt chip and chip_hold 1) the
 * chip stays on its card past the seven-second fade; with it off (CHIP_BASE, chip only) it fades.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const HOLD = process.env.HOLD_BASE || 'http://localhost:4402';
const CHIP = process.env.PREVIEW_BASE || 'http://localhost:4401';
const b = await chromium.launch({ executablePath: headlessShell() });
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function seed(B) {
  const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
  await j('/api/items', { method: 'DELETE', body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });
  await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: { urls: [1, 2, 3].map((n) => `https://a.example/${n}.jpg`).join('\n'), collection: 'players' } }) });
  const items = (await j('/api/items')).items;
  const tail = [
    { headline: 'Stroud dime', entities: { players: ['c-j-stroud'] }, contentType: 'game_action', publishedAt: '2026-10-30T00:00:00Z', advance: { mode: 'auto', seconds: 2 } },
    { headline: 'Camp day', entities: { players: [] }, contentType: 'offseason_camp', publishedAt: '2026-10-29T00:00:00Z', advance: { mode: 'manual', seconds: 6 } },
    { headline: 'Anderson sack', entities: { players: ['will-anderson-jr'] }, contentType: 'game_action', publishedAt: '2026-10-28T00:00:00Z', advance: { mode: 'manual', seconds: 6 } },
  ];
  for (let i = 0; i < items.length; i++) await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[i].id, changes: { ...tail[i], status: 'published', sortIndex: i } }) });
}
await seed(HOLD); await seed(CHIP);
const RUN = Date.now();
const chip = (pg) => pg.evaluate(() => { const c = document.querySelector('.pickchip'); return c ? { text: c.textContent.trim(), on: c.classList.contains('in') } : null; });

async function run(B, tag) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.goto(`${B}/feed?pid=sess_${RUN}_${tag}&qa=1`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(3400);   // the two-second hold completes card 1 and the feed advances
  const first = await chip(pg);
  await pg.waitForTimeout(8500);   // past CHIP_MS
  const later = await chip(pg);
  await ctx.close();
  return { first, later, errs };
}
const h = await run(HOLD, 'hold');
t(`with chip_hold on the chip appears after the first completion (${h.first && h.first.text})`, h.first && h.first.on && /Stroud/.test(h.first.text));
t('and it is still on the card nine seconds later', h.later && h.later.on);
t('no page errors', h.errs.length === 0);
const c = await run(CHIP, 'fade');
t('with chip_hold off the chip appears', c.first && c.first.on);
t('and has faded nine seconds later', c.later === null);
await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
