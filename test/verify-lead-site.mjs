/**
 * The lead_site knob in the browser: with it on (PREVIEW_BASE, FEED_KNOBS lead_site 1) the first
 * site video (source pocket, format video) among the opening cards leads; off (CONTROL_BASE) the
 * order stands. A site story (format read) never leads: the knob is about the club's own video.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const ON = process.env.PREVIEW_BASE || 'http://localhost:4401';
const OFF = process.env.CONTROL_BASE || 'http://localhost:4400';
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
    { headline: 'Dre put the league on notice', source: 'catalogue', entities: { players: [] }, contentType: 'game_action', publishedAt: '2026-10-30T00:00:00Z' },
    { headline: 'How to watch the Ravens', source: 'pocket', format: 'read', entities: { players: [] }, contentType: 'opponent_week', publishedAt: '2026-10-29T00:00:00Z' },
    { headline: 'Montgomery best plays', source: 'pocket', format: 'video', entities: { players: [] }, contentType: 'game_action', publishedAt: '2026-10-28T00:00:00Z' },
    { headline: 'Stroud dime', source: 'catalogue', entities: { players: ['c-j-stroud'] }, contentType: 'game_action', publishedAt: '2026-10-27T00:00:00Z' },
  ];
  for (let i = 0; i < items.length; i++) await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[i].id, changes: { ...tail[i], status: 'published', sortIndex: 1_000_000 } }) });
  const after = (await j('/api/items')).items;
  return after.map((i) => `${i.source}/${i.format || 'video'}`);
}
const seededOn = await seed(ON); await seed(OFF);
t(`the studio keeps the source and format on a patch (${seededOn.join(' ')})`, seededOn.includes('pocket/video') && seededOn.includes('pocket/read'));

async function firstThree(B) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 880 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.goto(`${B}/feed?pid=sess_${Date.now()}_leadsite&qa=1`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  const heads = await pg.evaluate(() => [...document.querySelectorAll('#feed .slide')].slice(0, 4).map((s) => (s.querySelector('h2, .headline, .h') || s).textContent.trim().slice(0, 24)));
  await ctx.close();
  return { heads, errs };
}
const on = await firstThree(ON);
t(`with the knob on the first site video leads (${on.heads.join(' | ')})`, /Montgomery best plays/.test(on.heads[0]));
t('the Short that opened the shared order follows at card 2', /Dre put the league/.test(on.heads[1]));
t('the site story stays where it was, after the Short', on.heads.findIndex((h) => /How to watch/.test(h)) > on.heads.findIndex((h) => /Dre put the league/.test(h)));
t('no page errors', on.errs.length === 0);
const off = await firstThree(OFF);
t(`with the knob off the shared order stands (${off.heads.join(' | ')})`, /Dre put the league/.test(off.heads[0]));
await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
