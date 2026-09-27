/**
 * The September 2026 debug audit, one assertion per finding.
 *
 * Every case here failed before the fix, so a regression names the exact defect rather than
 * "something about clipping". The security cases assert on execution in a real browser, not
 * on the markup — an escaping change that looks right and isn't would still pass a string
 * comparison.
 */
import { chromium } from 'playwright';
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const B = 'http://localhost:4400';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
const code = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).status;
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

await j('/api/items', { method: 'DELETE',
  body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });

/* ---------- the store is not a public document ---------- */

t('the store is not served', await code('/content/store.json') === 404);
t('the manifest is not served', await code('/content/manifest.json') === 404);
const staticHeaders = (await fetch(`${B}/feed`)).headers;
t('static files carry no blanket CORS header',
  staticHeaders.get('access-control-allow-origin') === null);
t('the feed JSON still does, as its documented contract',
  (await fetch(`${B}/api/feed`)).headers.get('access-control-allow-origin') === '*');
t('HEAD is not CSRF-gated', (await fetch(`${B}/feed`,
  { method: 'HEAD', headers: { origin: 'https://evil.example' } })).status === 200);

/* ---------- a clip is two numbers, and they reach an HTML attribute ---------- */

await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
  urls: 'https://a.example/x.jpg', collection: 'series' } }) });
const victim = (await j('/api/items')).items[0].id;

const BREAKOUT = '0" onmouseover="window.__pwn=1" data-z="';
await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: victim, changes: {
  clip: { playback: true, of: victim, start: BREAKOUT, end: 5 },
  overlays: [{ id: 'ov1" onmouseover="window.__pwn3=1" data-z="', type: 'text', text: 'hi' }] } }) });

const stored = (await j('/api/items')).items.find((i) => i.id === victim);
t('a non-numeric clip bound is refused by the model, not stored', stored.clip === null);
t('a client-supplied overlay id is replaced with ours',
  /^ov-[a-z0-9]{1,8}$/.test(stored.overlays[0].id));

await j('/api/items', { method: 'PATCH',
  body: JSON.stringify({ id: victim, changes: { status: 'published' } }) });

const f = await b.newPage({ viewport: { width: 430, height: 880 } });
const errs = []; f.on('pageerror', (e) => errs.push(e.message));
await f.goto(`${B}/feed`, { waitUntil: 'networkidle' });
await f.waitForTimeout(400);
await f.hover('.slide').catch(() => {});
await f.waitForTimeout(250);
t('no script runs from a clip bound in the public feed', !(await f.evaluate(() => !!window.__pwn)));
t('the slide tag is intact', await f.evaluate(() =>
  !document.querySelector('.slide')?.hasAttribute('onmouseover')));

await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: victim, changes: {
  status: 'inbox',
  clip: { playback: true, of: victim, start: '<img src=q onerror="window.__pwn2=1">', end: 9 } } }) });
const st = await b.newPage({ viewport: { width: 1440, height: 1000 } });
st.on('pageerror', (e) => errs.push(e.message));
st.on('dialog', (d) => d.accept());
await st.goto(`${B}/`, { waitUntil: 'networkidle' });
await st.click(`.card[data-id="${victim}"]`);
await st.waitForTimeout(700);
await st.hover('.ov').catch(() => {});
await st.waitForTimeout(250);
t('no script runs from a clip bound in the studio', !(await st.evaluate(() => !!window.__pwn2)));
t('no script runs from an overlay id', !(await st.evaluate(() => !!window.__pwn3)));

/* ---------- a clip of a clip lands where the scrubber said ---------- */

const up = await j('/api/upload', { method: 'POST', body: JSON.stringify({
  filename: 'bars.webm',
  dataUrl: `data:video/webm;base64,${(await readFile(
    new URL('./fixtures/bars-30s.webm', import.meta.url))).toString('base64')}` }) });
await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'upload', config: {
  files: [{ url: up.url, contentType: 'video/webm', headline: 'Bars', collection: 'series',
    durationSeconds: 30 }] } }) });
const file = (await j('/api/items')).items.find((i) => i.media.kind === 'file' && !i.clip);

const a1 = await j('/api/clip', { method: 'POST',
  body: JSON.stringify({ id: file.id, start: 10, end: 20 }) });
const a2 = await j('/api/clip', { method: 'POST',
  body: JSON.stringify({ id: a1.created, start: 2, end: 6 }) });
const second = (await j('/api/items')).items.find((i) => i.id === a2.created);
t(`a clip of a clip is absolute in the asset (${second?.clip.start}–${second?.clip.end}, want 12–16)`,
  second?.clip.start === 12 && second?.clip.end === 16);
t('and points at the original file, not the parent clip', second?.clip.of === file.id);

t('a negative in-point is refused', await code('/api/clip', { method: 'POST',
  body: JSON.stringify({ id: file.id, start: -10, end: 5 }) }) === 400);
t('an out-point past the asset is refused', await code('/api/clip', { method: 'POST',
  body: JSON.stringify({ id: file.id, start: 25, end: 1000 }) }) === 400);
t('an absurd range is refused', await code('/api/clip', { method: 'POST',
  body: JSON.stringify({ id: file.id, start: 1e9, end: 1e9 + 5 }) }) === 400);
t('an out-point past the parent clip is refused', await code('/api/clip', { method: 'POST',
  body: JSON.stringify({ id: a1.created, start: 0, end: 40 }) }) === 400);

/* ---------- numbers people read off a card ---------- */

await j('/api/items', { method: 'PATCH',
  body: JSON.stringify({ id: file.id, changes: { durationSeconds: 1e400 } }) });
let n = (await j('/api/items')).items.find((i) => i.id === file.id);
t(`Infinity does not persist a badge the number disagrees with (${JSON.stringify(n.duration)})`,
  n.durationSeconds === 0 && n.duration === '');
await j('/api/items', { method: 'PATCH',
  body: JSON.stringify({ id: file.id, changes: { durationSeconds: -30 } }) });
n = (await j('/api/items')).items.find((i) => i.id === file.id);
t('a negative duration clamps to zero', n.durationSeconds === 0);
await j('/api/items', { method: 'PATCH',
  body: JSON.stringify({ id: file.id, changes: { durationSeconds: 3600 } }) });
n = (await j('/api/items')).items.find((i) => i.id === file.id);
t(`an hour reads as an hour, not 60:00 (${n.duration})`, n.duration === '1:00:00');

/* ---------- malformed input answers, rather than 500s ---------- */

t('a prototype key is not an adapter', await code('/api/pull', { method: 'POST',
  body: JSON.stringify({ adapter: 'toString' }) }) === 400);
t('undecodable base64 is refused, not stored as 0 bytes', await code('/api/upload',
  { method: 'POST', body: JSON.stringify({ filename: 'x.png', dataUrl: 'data:image/png;base64,!!!!' }) }) === 400);

/* ---------- running order is owned by dragging ---------- */

t('the editor has no sort-index field to go stale', await st.evaluate(() =>
  !document.querySelector('#e-si')));

await st.reload({ waitUntil: 'networkidle' });
await st.waitForTimeout(400);
const ids = await st.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.dataset.id));
await st.focus(`.card[data-id="${ids[0]}"]`);
await st.keyboard.press('Alt+ArrowDown');
await st.waitForTimeout(500);
const afterMove = await st.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.dataset.id));
// Save the card that moved. The old sort-index field would have written its stale position.
await st.click(`.card[data-id="${ids[0]}"]`);
await st.waitForTimeout(400);
await st.fill('#e-h', 'Edited after a reorder');
await st.click('#e-save');
await st.waitForTimeout(600);
const ranks = (await j('/api/items')).items.reduce((a, i) => ((a[i.id] = i.sortIndex), a), {});
t(`saving a card does not undo the reorder (${afterMove.map((x) => ranks[x]).join(',')})`,
  afterMove.every((id, k) => ranks[id] === k));
t('no two cards tie on sort index', new Set(afterMove.map((x) => ranks[x])).size === afterMove.length);

/* ---------- analytics does not over-report ---------- */

const pub = (await j('/api/items')).items;
for (const it of pub)
  await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: it.id, changes: {
    status: 'published', collection: it.media.kind === 'image' ? 'gameday' : 'series',
    advance: { mode: 'auto', seconds: 6 } } }) });

const an = await b.newPage({ viewport: { width: 430, height: 880 } });
an.on('pageerror', (e) => errs.push(e.message));
await an.addInitScript(() => {
  window.__ev = [];
  addEventListener('message', (e) => { if (e.data?.source === 'txfeed') window.__ev.push(e.data); });
});
await an.goto(`${B}/feed`, { waitUntil: 'networkidle' });
await an.waitForTimeout(1500);
// Switch collection mid-hold: the discarded slide's timer used to fire a completion and
// attribute it to whichever card had taken its index in the new render.
await an.evaluate(() => document.querySelector('#bar .chip:nth-child(2)')?.click());
await an.waitForTimeout(7000);
const ev = await an.evaluate(() => window.__ev);
const completes = ev.filter((e) => e.event === 'card_complete');
const views = ev.filter((e) => e.event === 'card_view');
t(`a collection switch mid-hold fires no ghost completion (${completes.length} complete, ${views.length} view)`,
  completes.length <= views.length);

/* ---------- a corrupt store is moved aside once ---------- */

const CORRUPT = '/tmp/verify-hardening/store.json';
await rm('/tmp/verify-hardening', { recursive: true, force: true });
await mkdir('/tmp/verify-hardening', { recursive: true });
await writeFile(CORRUPT, '{not json');
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, STORE: CORRUPT, PORT: '4599' }, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 1500));
for (const path of ['/api/items', '/api/feed', '/api/templates', '/api/items'])
  await fetch(`http://localhost:4599${path}`).catch(() => {});
await new Promise((r) => setTimeout(r, 300));
const sidecars = (await readdir('/tmp/verify-hardening')).filter((x) => x.includes('.corrupt'));
t(`four requests to a corrupt store leave one sidecar, not four (${sidecars.length})`,
  sidecars.length === 1);
try { process.kill(-child.pid); } catch { /* already gone */ }

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
if (errs.length) console.log('page errors:\n' + errs.join('\n'));
await b.close();
process.exit(bad.length ? 1 : 0);
