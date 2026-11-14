/**
 * Pick'em: with pickem_position 2 (PICK_BASE, FEED_KNOBS pickem_position 2) the third card asks
 * "Who wins Sunday?" with Texans and Browns; a tap posts the pick, shows the split, says the
 * pick is saved, and the card does not come back on the next load. With the default (-1) the
 * card never appears.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const PICK = process.env.PICK_BASE || 'http://localhost:4404';
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
  for (let i = 0; i < items.length; i++) await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[i].id, changes: { headline: `Card ${i + 1}`, entities: { players: i % 2 ? ['c-j-stroud'] : [] }, contentType: 'game_action', publishedAt: `2026-10-${30 - i}T00:00:00Z`, advance: { mode: 'manual', seconds: 6 }, status: 'published', sortIndex: i } }) });
}
await seed(PICK); await seed(CTRL);
const RUN = Date.now();

const state = (pg) => pg.evaluate(() => {
  const arts = Array.from(document.querySelectorAll('#feed article'));
  const i = arts.findIndex((a) => a.querySelector('.pk.pickem'));
  const card = i >= 0 ? arts[i] : null;
  return { index: i, headline: card?.querySelector('h2')?.textContent || '', opts: card ? Array.from(card.querySelectorAll('.answers .opt')).map((o) => o.textContent.trim()) : [],
    result: card?.querySelector('.lead.result')?.textContent || '', notNow: card ? getComputedStyle(card.querySelector('.acts')).display !== 'none' : false };
});

async function open(B, pid, qa) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const pg = await ctx.newPage();
  const errs = [], posts = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (r.method() === 'POST' && /\/api\/(pick|events)/.test(r.url())) posts.push({ url: r.url(), body: r.postData() || '' }); });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.goto(`${B}/feed?pid=${pid}${qa ? '&qa=1' : ''}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1200);
  return { ctx, pg, errs, posts };
}

// The pick arm: the card sits third, offers both sides, and a tap pays off on the spot.
{
  const pid = `sess_${RUN}_pickfan01`;
  const { ctx, pg, errs, posts } = await open(PICK, pid, false);
  const s0 = await state(pg);
  t(`the pick card is the third card and asks who wins (${s0.index}, "${s0.headline}")`, s0.index === 2 && /^Who wins \w+\?$/.test(s0.headline));
  t('it offers Texans and the opponent by name', s0.opts.join('|') === 'Texans|Browns');
  await pg.evaluate(() => { const a = Array.from(document.querySelectorAll('#feed article')).find((x) => x.querySelector('.pk.pickem')); a.scrollIntoView(); });
  await pg.waitForTimeout(400);
  await pg.click('.pk.pickem .answers .opt[data-k="texans"]');
  await pg.waitForFunction(() => Boolean(document.querySelector('.pk.pickem .lead.result')), null, { timeout: 5000 }).catch(() => {});
  const s1 = await state(pg);
  t(`a tap shows the split in place of the ask and says the pick is saved ("${s1.result}")`, /You and 100% of fans say Texans\. Your pick is saved\./.test(s1.result));
  t('Not now goes once the game is called', s0.notNow === true && s1.notNow === false);
  const pickPost = posts.find((p) => /\/api\/pick$/.test(p.url));
  t('the pick is posted with the game, the side and the pocket id', pickPost && /"game_id":57/.test(pickPost.body) && /"pick":"texans"/.test(pickPost.body) && pickPost.body.includes(pid));
  await pg.waitForTimeout(2500);
  const ev = posts.filter((p) => /\/api\/events/.test(p.url)).map((p) => p.body).join('\n');
  t('pick_made is reported with the share and the count', /pick_made/.test(ev) && /"pick":"texans"/.test(ev) && /"pick_share":100/.test(ev) && /"picks_n":1/.test(ev));
  t('no page errors', errs.length === 0);
  await ctx.close();
  // The same fan again: the card is gone, their call is remembered server-side.
  const again = await open(PICK, pid, false);
  const s2 = await state(again.pg);
  t('the card does not come back once the fan has called the game', s2.index === -1);
  await again.ctx.close();
}
// Not now: the card leaves for this game and pick_skip is reported.
{
  const { ctx, pg, posts } = await open(PICK, `sess_${RUN}_pickfan02`, false);
  await pg.click('.pk.pickem .skip');
  await pg.waitForTimeout(2200);
  const s = await state(pg);
  const ev = posts.filter((p) => /\/api\/events/.test(p.url)).map((p) => p.body).join('\n');
  t('Not now removes the card and reports pick_skip', s.index === -1 && /pick_skip/.test(ev));
  await ctx.close();
}
// A qa load is answered but says so, so the split never counts it.
{
  const { ctx, pg, posts } = await open(PICK, `sess_${RUN}_pickqa01`, true);
  await pg.click('.pk.pickem .answers .opt[data-k="opponent"]');
  await pg.waitForTimeout(800);
  const pickPost = posts.find((p) => /\/api\/pick$/.test(p.url));
  t('a qa pick carries qa: true', pickPost && /"qa":true/.test(pickPost.body));
  await ctx.close();
}
// Control: no card.
{
  const { ctx, pg } = await open(CTRL, `sess_${RUN}_ctrlfan01`, false);
  const s = await state(pg);
  t('with the default knob there is no pick card', s.index === -1);
  await ctx.close();
}
await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
