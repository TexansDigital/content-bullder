import { chromium } from 'playwright';
const B = 'http://localhost:4400';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'cloudinary', config: {
  assets: 'https://static.clubs.nfl.com/video/upload/texans/pressers/w03-coordinators.mp4',
  baseUrl: 'https://static.clubs.nfl.com' } }) });
await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
  urls: 'https://www.youtube.com/watch?v=abc123', collection: 'presser' } }) });

const items = (await j('/api/items')).items;
const src = items.find(i => i.media.kind === 'cloudinary');
t('cloudinary pull is named, not Untitled', src.headline !== 'Untitled');
await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: src.id, changes: { durationSeconds: 2400 } }) });

const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
await p.goto(B + '/', { waitUntil: 'networkidle' });

await p.click(`.card[data-id="${src.id}"]`); await p.waitForTimeout(500);
t('clip panel shows for a Cloudinary asset', await p.evaluate(() => !!document.querySelector('#scrub')));
t('frame preview requests a real timestamp', await p.evaluate(() =>
  /so_\d+/.test(document.querySelector('#c-frame')?.src || '')));

await p.fill('#c-s', '124'); await p.waitForTimeout(150);
await p.fill('#c-e', '146'); await p.waitForTimeout(250);
t('length follows the in/out fields', (await p.inputValue('#c-len')) === '0:22');

const inBefore = await p.inputValue('#c-s');
await p.focus('#c-in'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
await p.waitForTimeout(200);
t(`in handle moves by keyboard (${inBefore} -> ${await p.inputValue('#c-s')})`,
  (await p.inputValue('#c-s')) !== inBefore);

await p.fill('#c-s', '124'); await p.fill('#c-e', '146');
await p.fill('#c-h', 'We have to finish drives'); await p.waitForTimeout(200);
await p.click('#c-make'); await p.waitForTimeout(900);

const after = (await j('/api/items')).items;
const clip = after.find(i => i.clip);
t('clip created as a new card', !!clip && after.length === items.length + 1);
t('source still whole', !!after.find(i => i.id === src.id && !i.clip));
t(`clip duration is the range (${clip?.duration})`, clip?.duration === '0:22');
t('clip headline kept', clip?.headline === 'We have to finish drives');
t('clip URL carries so_/eo_', /so_124,eo_146/.test(clip?.media?.hls || ''));
t('clip URL keeps g_auto reframe', /g_auto,ar_9:16/.test(clip?.media?.hls || ''));
t('selection moved to the new clip', await p.evaluate(() =>
  document.querySelector('.card[aria-selected="true"]')?.dataset.id?.includes('-124-146')));

await p.screenshot({ path: '/tmp/clip.png' });

// a YouTube item explains why it cannot be clipped rather than offering nothing
const yt = after.find(i => i.media.kind === 'link' || i.source === 'manual');
await p.click(`.card[data-id="${yt.id}"]`); await p.waitForTimeout(400);
t('non-Cloudinary shows no scrubber', await p.evaluate(() => !document.querySelector('#scrub')));

console.log('PASS ' + ok.length); ok.forEach(x => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach(x => console.log('  - ' + x)); }
if (errs.length) console.log('page errors:\n' + errs.join('\n'));
await b.close();
