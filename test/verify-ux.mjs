/**
 * The September 2026 UX audit, one assertion per finding.
 *
 * Weighted towards the failures that lie: a Publish that reports success and changes
 * nothing, a Save that fails in total silence, a button that looks live and is dead. Those
 * cost an editor more than anything cosmetic, and none of them show up in a screenshot.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';
import { readFile } from 'node:fs/promises';

const B = 'http://localhost:4400';
const b = await chromium.launch({ executablePath: headlessShell() });
const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

await j('/api/items', { method: 'DELETE',
  body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });

const up = await j('/api/upload', { method: 'POST', body: JSON.stringify({
  filename: 'stroud-td.webm',
  dataUrl: `data:video/webm;base64,${(await readFile(
    new URL('./fixtures/bars-30s.webm', import.meta.url))).toString('base64')}` }) });
await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'upload', config: {
  files: [{ url: up.url, contentType: 'video/webm',
    headline: 'Stroud finds Dell for the go-ahead score', collection: 'gameday' }] } }) });
await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
  urls: ['https://a.example/tix.jpg', 'https://a.example/flag.jpg'].join('\n'),
  collection: 'series' } }) });

const items = (await j('/api/items')).items;
const vid = items.find((i) => i.media.kind === 'file');
await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: vid.id, changes: {
  overlays: [
    { type: 'text', text: 'SINGLE-GAME TICKETS', style: 'band', color: 'red', size: 'lg', y: 22 },
    { type: 'link', text: 'Get tickets', url: 'https://www.houstontexans.com', style: 'box', y: 74 }],
  action: { label: 'Watch', url: 'https://www.houstontexans.com' } } }) });

const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
let confirms = 0;
p.on('dialog', (d) => { confirms++; d.accept(); });
await p.goto(`${B}/`, { waitUntil: 'networkidle' });
await p.waitForTimeout(500);

/* ---------- the terminal action must not lie ---------- */

await p.click(`.card[data-id="${vid.id}"]`);
await p.waitForTimeout(900);
t('Publish is reachable without scrolling the pane', await p.evaluate(() => {
  const pane = document.querySelector('#editor').parentElement;
  const r = document.querySelector('#e-pub').getBoundingClientRect();
  return r.bottom <= pane.getBoundingClientRect().bottom + 1 && r.top > 0;
}));

// Take the card down to blocking errors, the way a half-filled card arrives.
await j('/api/items', { method: 'PATCH',
  body: JSON.stringify({ id: vid.id, changes: { headline: 'Untitled' } }) });
await p.reload({ waitUntil: 'networkidle' });
await p.click(`.card[data-id="${vid.id}"]`);
await p.waitForTimeout(700);
t('a card with blocking errors says so', await p.evaluate(() => !!document.querySelector('.blocking')));
t('and Publish is really disabled, not just aria-disabled', await p.evaluate(() => {
  const btn = document.querySelector('#e-pub');
  return btn.disabled === true && btn.getAttribute('aria-disabled') === 'true';
}));
await p.evaluate(() => document.querySelector('#e-pub').click());
await p.waitForTimeout(600);
t('clicking it neither publishes nor claims to', await p.evaluate(() =>
  document.querySelector('#toast').hidden));
t('the card really did not publish',
  (await j('/api/items')).items.find((i) => i.id === vid.id).status === 'inbox');

// Force the API to reject while the client still thinks it can publish.
await p.evaluate(() => {
  const real = window.fetch;
  window.fetch = async (u, o) => (String(u).includes('/api/items') && o?.method === 'PATCH'
    ? new Response(JSON.stringify({ updated: 0, rejected: [{ id: 'x', errors: ['needs a headline'] }] }),
      { status: 200, headers: { 'content-type': 'application/json' } })
    : real(u, o));
});
await p.evaluate(() => document.querySelector('#e-save').click());
await p.waitForTimeout(500);
t('a server rejection is shown, in the editor, not swallowed', await p.evaluate(() => {
  const box = document.querySelector('#e-err');
  return box && !box.hidden && /needs a headline/.test(box.textContent);
}));

// And a save that cannot reach the server at all.
await p.evaluate(() => { window.fetch = () => Promise.reject(new Error('Failed to fetch')); });
await p.evaluate(() => document.querySelector('#e-save').click());
await p.waitForTimeout(400);
t('a failed save is not silent', await p.evaluate(() => {
  const box = document.querySelector('#e-err');
  return box && !box.hidden && /still here/.test(box.textContent);
}));

/* ---------- dead controls ---------- */

await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: vid.id,
  changes: { headline: 'Stroud finds Dell for the go-ahead score', status: 'archived' } }) });
await p.reload({ waitUntil: 'networkidle' });
await p.click('[data-status="archived"]');
await p.waitForTimeout(400);
await p.click(`.card[data-id="${vid.id}"]`);
await p.waitForTimeout(700);
t('selecting an archived card does not throw', !errs.some((e) => /e-arch|onclick/.test(e)));
t('Move to inbox and Delete are both rendered', await p.evaluate(() =>
  !!document.querySelector('#e-inbox') && !!document.querySelector('#e-del')));

await p.click('#e-inbox');
await p.waitForTimeout(700);
t('Move to inbox actually moves it',
  (await j('/api/items')).items.find((i) => i.id === vid.id).status === 'inbox');

const spare = items.find((i) => i.media.kind !== 'file');
await j('/api/items', { method: 'PATCH',
  body: JSON.stringify({ id: spare.id, changes: { status: 'archived' } }) });
await p.reload({ waitUntil: 'networkidle' });
await p.click('[data-status="archived"]');
await p.waitForTimeout(400);
await p.click(`.card[data-id="${spare.id}"]`);
await p.waitForTimeout(600);
const beforeDel = confirms;
await p.click('#e-del');
await p.waitForTimeout(800);
t('Delete asks first', confirms > beforeDel);
t('and then actually deletes',
  !(await j('/api/items')).items.some((i) => i.id === spare.id));

/* ---------- destroying composed work ---------- */

await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(400);
await p.click(`.card[data-id="${vid.id}"]`);
await p.waitForTimeout(800);
const had = (await j('/api/items')).items.find((i) => i.id === vid.id).overlays.length;
t(`the card has composed blocks to lose (${had})`, had === 2);
await p.evaluate(() => [...document.querySelectorAll('.fold')]
  .forEach((d) => d.setAttribute('open', '')));
await p.waitForTimeout(300);
const beforeTpl = confirms;
await p.click('[data-tpl="quote"]');
await p.waitForTimeout(900);
t('applying a layout over composed blocks asks first', confirms > beforeTpl);
t('and offers an undo', await p.evaluate(() => !!document.querySelector('#toast .undo')));
await p.click('#toast .undo');
await p.waitForTimeout(900);
t(`undo restores the blocks (${(await j('/api/items')).items.find((i) => i.id === vid.id).overlays.length})`,
  (await j('/api/items')).items.find((i) => i.id === vid.id).overlays.length === had);

/* ---------- the block editor ---------- */

await p.reload({ waitUntil: 'networkidle' });
await p.click(`.card[data-id="${vid.id}"]`);
await p.waitForTimeout(900);
t('the block editor sits within a screen of the canvas', await p.evaluate(() => {
  const cv = document.querySelector('#cv').getBoundingClientRect();
  const panel = document.querySelector('#ov-panel').getBoundingClientRect();
  return panel.top - cv.bottom < 200;
}));
await p.click('.ov');
await p.waitForTimeout(400);
await p.keyboard.press('Delete');
await p.waitForTimeout(400);
t('Delete removes the focused block', await p.evaluate(() =>
  document.querySelectorAll('#cv .ov').length === 1));

/* ---------- the layout has to survive a small window ---------- */

for (const [w, h] of [[1280, 800], [1100, 800], [1024, 768], [900, 700]]) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(500);
  const overlap = await p.evaluate(() => {
    const r = [...document.querySelectorAll('.pane')].map((el) => el.getBoundingClientRect());
    for (let k = 1; k < r.length; k++) {
      const stacked = r[k].left < r[k - 1].right - 2 && r[k].right > r[k - 1].left + 2;
      if (stacked && r[k].top < r[k - 1].bottom - 2) return true;
    }
    return false;
  });
  t(`the panes do not overlap at ${w}x${h}`, !overlap);
}
await p.setViewportSize({ width: 1024, height: 768 });
await p.waitForTimeout(500);
t('Add to inbox is reachable when stacked', await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((x) => /add to inbox/i.test(x.textContent));
  const cols = document.querySelector('.cols');
  return !!btn && btn.getBoundingClientRect().height > 0
    && cols.scrollHeight > cols.clientHeight;
}));

/* ---------- announced, and visibly focusable ---------- */

t('the save-state pill is a live region', await p.evaluate(() =>
  document.querySelector('#store-state')?.getAttribute('aria-live') === 'polite'));
t('pull failures are announced', await p.evaluate(() =>
  document.querySelector('#pull-out')?.getAttribute('aria-live') === 'polite'));

await p.setViewportSize({ width: 1440, height: 900 });
await p.waitForTimeout(400);
// Measured on the element, not read out of the stylesheet: the browser default resolved to
// a 1px near-black ring on near-black, which a rule-text check would have called a pass.
await p.focus('.card');
await p.waitForTimeout(200);
const ring = await p.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('.card:focus'));
  return { w: cs.outlineWidth, c: cs.outlineColor };
});
t(`queue cards get a visible focus ring (${ring.w} ${ring.c})`,
  parseFloat(ring.w) >= 2 && /255,\s*255,\s*255/.test(ring.c));

t('the two "Auto" buttons are distinguishable', await p.evaluate(() => {
  const labels = [...document.querySelectorAll('[data-chrome="auto"],[data-adv="auto"]')]
    .map((x) => x.getAttribute('aria-label'));
  return labels.length === 2 && new Set(labels).size === 2 && labels.every(Boolean);
}));
t('the clip sliders carry a value', await p.evaluate(() =>
  document.querySelector('#c-in')?.hasAttribute('aria-valuenow')));

/* ---------- the feed, which is the public surface ---------- */

for (const it of (await j('/api/items')).items)
  await j('/api/items', { method: 'PATCH',
    body: JSON.stringify({ id: it.id, changes: { status: 'published' } }) });

const f = await b.newPage({ viewport: { width: 390, height: 844 } });
f.on('pageerror', (e) => errs.push(e.message));
await f.goto(`${B}/feed`, { waitUntil: 'networkidle' });
await f.waitForTimeout(900);
t('every card carries a scrim behind the rail, composed or not', await f.evaluate(() =>
  [...document.querySelectorAll('.slide')].every((s) => !!s.querySelector('.sb'))));
t('a composed card gets the shorter scrim, not the full one', await f.evaluate(() =>
  !!document.querySelector('.slide .sb.rail')));
const rail = await f.evaluate(() => {
  const r = document.querySelector('.rb').getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
t(`rail targets are at least 44px (${rail.w}x${rail.h})`, rail.w >= 44 && rail.h >= 44);
const chip = await f.evaluate(() =>
  Math.round(document.querySelector('.chip').getBoundingClientRect().height));
t(`collection chips are at least 40px tall (${chip})`, chip >= 40);

await f.click('.slide .sound');
await f.waitForTimeout(300);
t('the sound button relabels itself', await f.evaluate(() =>
  document.querySelector('.slide .sound').getAttribute('aria-label') === 'Mute'));

await f.goto(`${B}/feed?collection=gameday`, { waitUntil: 'networkidle' });
await f.waitForTimeout(700);
t('a one-card feed hides the meaningless progress strip', await f.evaluate(() =>
  document.querySelectorAll('.slide').length !== 1 || document.querySelector('#segs').hidden));

const g = await b.newPage({ viewport: { width: 390, height: 844 } });
await g.route('**/api/feed*', (r) => r.fulfill({ status: 500, body: 'upstream error' }));
await g.goto(`${B}/feed`, { waitUntil: 'networkidle' });
await g.waitForTimeout(600);
const msg = await g.evaluate(() => document.querySelector('.msg')?.textContent || '');
t('a broken feed shows fans a sentence, not an exception',
  !/is not|undefined|TypeError|JSON/.test(msg) && /available|back/i.test(msg));
t('and a way to retry', await g.evaluate(() => !!document.querySelector('.msg .retry')));

await g.setViewportSize({ width: 700, height: 380 });
await g.waitForTimeout(400);
t('a short, wide embed drops the arrows that would sit on the rail', await g.evaluate(() =>
  getComputedStyle(document.querySelector('.nav')).display === 'none'));

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
if (errs.length) console.log('page errors:\n' + errs.join('\n'));
await b.close();
process.exit(bad.length ? 1 : 0);
