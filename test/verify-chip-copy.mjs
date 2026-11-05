/**
 * The chip_copy knob: with 'next' (NEXT_BASE, FEED_KNOBS pick_prompt chip and chip_copy next) the
 * chip reads "Next up: C.J. Stroud"; with the default (CHIP_BASE) it reads "More C.J. Stroud".
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const NEXT = process.env.NEXT_BASE || 'http://localhost:4403';
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
await seed(NEXT); await seed(CHIP);
const RUN = Date.now();
const chip = (pg) => pg.evaluate(() => { const c = document.querySelector('.pickchip'); return c ? { text: c.textContent.replace(/\s+/g, ' ').trim(), on: c.classList.contains('in'), label: c.getAttribute('aria-label') } : null; });

async function run(B, tag) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.goto(`${B}/feed?pid=sess_${RUN}_${tag}&qa=1`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(3400);
  const first = await chip(pg);
  await ctx.close();
  return { first, errs };
}
const n = await run(NEXT, 'next');
t(`with chip_copy next the chip reads Next up (${n.first && n.first.text})`, n.first && n.first.on && /^Next up: C/.test(n.first.text) && /^Next up /.test(n.first.label));
t('no page errors', n.errs.length === 0);
const m = await run(CHIP, 'more');
t(`with the default the chip reads More (${m.first && m.first.text})`, m.first && m.first.on && /^More C/.test(m.first.text));
await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
