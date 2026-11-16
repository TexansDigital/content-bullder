/**
 * My Texans: with mine_link 1 (MINE_BASE, FEED_KNOBS mine_link 1) the chip bar carries "My Texans"
 * for a fan the feed can name; it opens /mine with the pocket id, which lists what the feed
 * inferred (watched, read about, calls) with Keep / Not me on each; Keep saves the player as a
 * pick with source "mine"; the first Not me shows the account ask, which opens the Eloqua form at
 * /enter with the same id. With the default (0) there is no chip.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const MINE = process.env.MINE_BASE || 'http://localhost:4405';
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
await seed(MINE); await seed(CTRL);
const RUN = Date.now();

async function open(B, path) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const pg = await ctx.newPage();
  const errs = [], posts = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (r.method() === 'POST' && /\/api\/(prefs|events)/.test(r.url())) posts.push({ url: r.url(), body: r.postData() || '' }); });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);
  return { ctx, pg, errs, posts };
}
const chipText = (pg) => pg.evaluate(() => Array.from(document.querySelectorAll('#bar .chip')).map((c) => c.textContent.trim()));
const rows = (pg) => pg.evaluate(() => Array.from(document.querySelectorAll('#body .row')).map((r) => ({ name: r.querySelector('b')?.textContent || '', src: r.dataset.src || 'call', acts: Array.from(r.querySelectorAll('button')).map((x) => x.textContent.trim()), pill: r.querySelector('.pill')?.textContent || '' })));

// The chip, in the mine arm and not in control.
{
  const pid = `sess_${RUN}_minefan01`;
  const on = await open(MINE, `/feed?pid=${pid}&placement=roster`);
  const chips = await chipText(on.pg);
  t(`the chip bar carries My Texans for a named fan (${chips.join('|')})`, chips.includes('My Texans'));
  const [nav] = await Promise.all([on.pg.waitForNavigation({ waitUntil: 'networkidle' }), on.pg.click('#bar .chip[data-k="__mytexans"]')]);
  const url = new URL(nav.url());
  t('the chip opens /mine with the pocket id and the placement', url.pathname === '/mine' && url.searchParams.get('pid') === pid && url.searchParams.get('placement') === 'roster');
  await on.pg.waitForTimeout(900);
  const r0 = await rows(on.pg);
  t(`the page lists what the feed inferred, with Keep and Not me (${r0.map((r) => r.name).join(', ')})`, r0.length === 3 && r0.every((r) => r.src !== 'picks' && r.acts.join('|') === 'Keep|Not me'));
  t('no ask before a correction', await on.pg.evaluate(() => document.querySelector('#ask').hidden === true));
  // Keep: the player becomes a pick, saved with its own source.
  await on.pg.click('#body .row[data-slug="tank-dell"] .keep');
  await on.pg.waitForFunction(() => /Saved to your picks/.test(document.querySelector('#body .row[data-slug="tank-dell"]')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
  const r1 = await rows(on.pg);
  t('Keep saves the player to the picks on the spot', r1.find((r) => r.name === 'Tank Dell')?.pill === 'Saved to your picks');
  const prefPost = on.posts.find((p) => /\/api\/prefs$/.test(p.url));
  t('the save carries the pick, the id and the mine source', prefPost && /"players":\["tank-dell"\]/.test(prefPost.body) && /"source":"mine"/.test(prefPost.body) && prefPost.body.includes(pid));
  // Not me: noted, and the club asks who they are, once.
  await on.pg.click('#body .row[data-slug="c-j-stroud"] .no');
  await on.pg.waitForTimeout(600);
  const r2 = await rows(on.pg);
  t('Not me is noted in place', r2.find((r) => r.name === 'C.J. Stroud')?.pill === 'Noted');
  t('the first correction shows the account ask with the privacy note', await on.pg.evaluate(() => document.querySelector('#ask').hidden === false && /privacy policy/.test(document.querySelector('#ask').textContent)));
  await on.pg.waitForTimeout(1500);
  const ev = on.posts.filter((p) => /\/api\/events/.test(p.url)).map((p) => p.body).join('\n');
  t('mine_view, mine_keep and mine_correct are reported with the player and the source', /mine_view/.test(ev) && /"mine_watched":2/.test(ev) && /mine_keep/.test(ev) && /"pref_player":"tank-dell"/.test(ev) && /mine_correct/.test(ev) && /"mine_source":"read"/.test(ev));
  const [nav2] = await Promise.all([on.pg.waitForNavigation(), on.pg.click('#ask .go')]);
  const u2 = new URL(nav2.url());
  t('the ask opens the entry form with the same id and the page as the card', u2.pathname === '/enter' && u2.searchParams.get('pid') === pid && u2.searchParams.get('card') === 'sys-mine');
  t('no page errors', on.errs.length === 0);
  await on.ctx.close();
  // Back on the feed, the kept player is a pick and the page shows it as one.
  const again = await open(MINE, `/mine?pid=${pid}`);
  const r3 = await rows(again.pg);
  t('on the next visit the kept player is listed under Your picks with Remove', r3.find((r) => r.name === 'Tank Dell')?.src === 'picks' && r3.find((r) => r.name === 'Tank Dell')?.acts.join('|') === 'Remove');
  await again.ctx.close();
}
// Control: no chip.
{
  const off = await open(CTRL, `/feed?pid=sess_${RUN}_minefan02`);
  t('with the knob off there is no My Texans chip', !(await chipText(off.pg)).includes('My Texans'));
  await off.ctx.close();
}
// No id: the page explains instead of guessing.
{
  const anon = await open(MINE, '/mine');
  t('without an id the page says to open it from the feed', await anon.pg.evaluate(() => /Open My Texans from your feed/.test(document.querySelector('#body').textContent)));
  await anon.ctx.close();
}

await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
