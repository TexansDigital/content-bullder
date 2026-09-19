/**
 * Playback-time clipping, end to end.
 *
 * A clip cut from an uploaded file is not a new file — it is the source plus an in and an
 * out, and the player holds the range. That is the only clipping path that works without a
 * transformation service, so it is the one worth proving against a real decoded frame.
 *
 * The fixture encodes its own timestamp as colour (see fixtures/README.md), so sampling one
 * pixel off the <video> says which second is on screen. Asserting on `currentTime` alone
 * would pass even if the seek never reached the decoder.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const B = 'http://localhost:4400';
const IN = 12, OUT = 16;
const FIXTURE = fileURLToPath(new URL('./fixtures/bars-30s.webm', import.meta.url));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

// Self-cleaning, unlike the older checks: this one asserts on feed order and on which
// slides carry a range, so a leftover card from the last run changes the answer.
await j('/api/items', { method: 'DELETE',
  body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });

const up = await j('/api/upload', { method: 'POST', body: JSON.stringify({
  filename: 'bars-30s.webm',
  dataUrl: `data:video/webm;base64,${(await readFile(FIXTURE)).toString('base64')}` }) });
t(`upload stores the video (${up.url})`, /^\/content\/uploads\/.+\.webm$/.test(up.url || ''));

await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'upload', config: {
  files: [{ url: up.url, contentType: 'video/webm', headline: 'Colour bars', collection: 'series' }] } }) });
await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
  urls: 'https://a.example/tail.jpg', collection: 'series' } }) });

const src = (await j('/api/items')).items.find((i) => i.media.kind === 'file');
t('an uploaded video lands as a file item', !!src);

// The studio has to be able to cut this by eye, not just by API.
{
  const st = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  st.on('dialog', (d) => d.accept());
  await st.goto(`${B}/`, { waitUntil: 'networkidle' });
  await st.click(`.card[data-id="${src.id}"]`);
  await st.waitForTimeout(1500);
  t('an uploaded video gets a clip scrubber',
    await st.evaluate(() => !!document.querySelector('#scrub')));
  t('the scrubber previews the file itself, not a Cloudinary render',
    await st.evaluate(() => !!document.querySelector('#c-frame-v') && !document.querySelector('#c-frame')));
  const dur = (await j('/api/items')).items.find((i) => i.id === src.id)?.durationSeconds;
  t(`the real duration is read off the file, not guessed (${dur}s)`, dur === 30);
  await st.close();
}

const cut = await j('/api/clip', { method: 'POST',
  body: JSON.stringify({ id: src.id, start: IN, end: OUT, headline: 'Second twelve' }) });
t(`a file is clipped at playback, not transformed (${cut.mode})`, cut.mode === 'playback');

const items = (await j('/api/items')).items;
const clip = items.find((i) => i.id === cut.created);
t('the clip carries in and out', clip?.clip?.start === IN && clip?.clip?.end === OUT);
t('the clip is marked playback-time', clip?.clip?.playback === true);
t('the clip reuses the source file rather than a new one', clip?.media?.url === src.media.url);
t(`the clip's duration is the range (${clip?.duration})`, clip?.duration === '0:04');
t('the source survives whole', !!items.find((i) => i.id === src.id && !i.clip));

// Running order matters here: the clip has to have somewhere to advance *to*, or the
// out-point test would pass for the wrong reason.
const order = [clip.id, src.id, items.find((i) => i.source === 'manual').id];
for (const it of items)
  await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: it.id,
    changes: { status: 'published', sortIndex: order.indexOf(it.id) } }) });

const p = await b.newPage({ viewport: { width: 430, height: 880 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${B}/feed?collection=series`, { waitUntil: 'networkidle' });
await p.waitForTimeout(400);

t('the clip leads the feed, with cards after it', await p.evaluate(({ id }) => {
  const s = [...document.querySelectorAll('.slide')];
  return s[0]?.dataset.id === id && s.length === 3;
}, { id: clip.id }));

t('only the clip slide carries a range', await p.evaluate(({ id }) => {
  const ranged = [...document.querySelectorAll('.slide[data-in]')].map((s) => s.dataset.id);
  return ranged.length === 1 && ranged[0] === id;
}, { id: clip.id }));

// Scroll the clip into view and let the observer take it.
await p.evaluate(({ id }) => document.querySelector(`.slide[data-id="${CSS.escape(id)}"]`)
  .scrollIntoView(), { id: clip.id });
await p.waitForTimeout(1200);

/** What second is actually decoded on screen, read back out of the pixel. */
const readSecond = () => p.evaluate(({ id }) => {
  const v = document.querySelector(`.slide[data-id="${CSS.escape(id)}"] video`);
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  c.getContext('2d').drawImage(v, 0, 0, 8, 8);
  const [r] = c.getContext('2d').getImageData(4, 4, 1, 1).data;
  return { second: Math.round(r / 8), currentTime: v.currentTime, paused: v.paused };
}, { id: clip.id });

const at = await readSecond();
t(`the player opens on the in-point, not frame zero (t=${at.currentTime.toFixed(2)})`,
  at.currentTime >= IN && at.currentTime < OUT);
t(`the decoded frame is the in-point second (saw ${at.second}, want ${IN}–${OUT - 1})`,
  at.second >= IN && at.second < OUT);

const top = await p.evaluate(() => document.querySelector('#feed').scrollTop);
await p.waitForTimeout(4500);
const end = await readSecond();
t(`playback stops at the out-point (t=${end.currentTime.toFixed(2)}, want <= ${OUT + 0.6})`,
  end.currentTime <= OUT + 0.6);
t('the clip pauses at its out-point', end.paused);
t('the feed advances when the range ends',
  (await p.evaluate(() => document.querySelector('#feed').scrollTop)) > top);

// Back to the clip: a range left paused on its out-point has to restart, not sit there.
await p.evaluate(({ id }) => document.querySelector(`.slide[data-id="${CSS.escape(id)}"]`)
  .scrollIntoView(), { id: clip.id });
await p.waitForTimeout(1000);
const again = await readSecond();
t(`scrolling back restarts the range (t=${again.currentTime.toFixed(2)})`,
  again.currentTime >= IN && again.currentTime < OUT);

// The whole source plays as a whole source — the range belongs to the clip alone.
await p.evaluate(({ id }) => document.querySelector(`.slide[data-id="${CSS.escape(id)}"]`)
  .scrollIntoView(), { id: src.id });
await p.waitForTimeout(900);
t('the uncut source still starts at zero', await p.evaluate(({ id }) => {
  const v = document.querySelector(`.slide[data-id="${CSS.escape(id)}"] video`);
  return v.currentTime < 3 && !v.ontimeupdate;
}, { id: src.id }));

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
if (errs.length) console.log('page errors:\n' + errs.join('\n'));
await b.close();
process.exit(bad.length ? 1 : 0);
