/**
 * The live first tile. Against a studio started with FEED_KNOBS='{"rail_preview":1}' (PREVIEW
 * below, default 4401) and, for the control, the studio on 4400 started with FEED_KNOBS='{"rail_preview":0}' (the preview shipped as the default on 8 Nov). Seeds two playable cards:
 * a file-kind clip first, a YouTube Short second, then stills.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const PREVIEW = process.env.PREVIEW_BASE || 'http://localhost:4401';
const CONTROL = process.env.CONTROL_BASE || 'http://localhost:4400';
const b = await chromium.launch({ executablePath: headlessShell() });
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function seed(B) {
  const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
  await j('/api/items', { method: 'DELETE', body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });
  await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
    urls: ['https://a.example/1.jpg', 'https://a.example/2.jpg', 'https://a.example/3.jpg', 'https://a.example/4.jpg'].join('\n'), collection: 'players' } }) });
  const items = (await j('/api/items')).items;
  const tail = [
    { headline: 'Our own master', media: { kind: 'file', url: 'https://a.example/master.mp4' }, poster: ['https://a.example/1.jpg'], publishedAt: '2026-10-30T00:00:00Z' },
    { headline: 'A Short', media: { kind: 'youtube', videoId: 'Tq3sz_Yf-Nk', url: 'https://www.youtube.com/shorts/Tq3sz_Yf-Nk' }, poster: ['https://a.example/2.jpg'], publishedAt: '2026-10-29T00:00:00Z' },
    { headline: 'Still three', publishedAt: '2026-10-28T00:00:00Z' },
    { headline: 'Still four', publishedAt: '2026-10-27T00:00:00Z' },
  ];
  for (let i = 0; i < items.length; i++) await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[i].id, changes: { ...tail[i], status: 'published', sortIndex: i } }) });
  return items.map((i) => i.id);
}

async function open(B, query, init = null) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 420 } });
  const pg = await ctx.newPage();
  const errs = [], ev = [], reqs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { reqs.push(r.url()); if (r.method() === 'POST' && r.url().endsWith('/api/events')) { try { ev.push(...(JSON.parse(r.postData() || '{}').events || [])); } catch {} } });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  if (init) await pg.addInitScript(init);
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.route(/youtube-nocookie\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>yt</title>' }));
  await pg.goto(`${B}/feed?${query}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(2600);
  return { pg, ctx, errs, ev, reqs };
}
const previews = (pg) => pg.evaluate(() => [...document.querySelectorAll('#tiles .tile')].map((s) => {
  const p = s.querySelector('.tprev'); return p ? p.tagName.toLowerCase() : null; }));

const ids = await seed(PREVIEW);
await seed(CONTROL);
const RUN = Date.now();

/* ---------- knob on: the first tile moves ---------- */
{
  const r = await open(PREVIEW, `layout=rail&placement=news&pid=sess_${RUN}_prev1`);
  const p = await previews(r.pg);
  t(`with rail_preview 1 the first tile carries a muted video preview and no other tile does (${JSON.stringify(p)})`, p[0] === 'video' && p.slice(1).every((x) => x === null));
  const v = await r.pg.evaluate(() => { const el = document.querySelector('#tiles .tprev'); return el && { muted: el.muted, loop: el.loop, inline: el.hasAttribute('playsinline'), hidden: el.getAttribute('aria-hidden'), pe: getComputedStyle(el).pointerEvents, src: el.getAttribute('src') }; });
  t('the preview is muted, looping, inline, hidden from readers and takes no taps', v && v.muted && v.loop && v.inline && v.hidden === 'true' && v.pe === 'none' && v.src === 'https://a.example/master.mp4');
  const pv = r.ev.filter((e) => e.event === 'tile_preview');
  t('one tile_preview event names the card, its position and the preview kind', pv.length === 1 && pv[0].params.card_id === ids[0] && pv[0].params.card_position === 1 && pv[0].params.preview_kind === 'file');
  t('the still poster is still there behind the preview', await r.pg.evaluate(() => Boolean(document.querySelector('#tiles .tile[data-index="0"] .art img'))));
  t('a preview that has not started playing stays invisible, so a failed source is just the poster', await r.pg.evaluate(() => { const el = document.querySelector('#tiles .tprev'); return !el.classList.contains('on') && getComputedStyle(el).opacity === '0'; }));
  t('the collection chip and the duration chip sit above the preview', await r.pg.evaluate(() => { const a = document.querySelector('#tiles .tile[data-index="0"] .art'); const z = (sel) => Number(getComputedStyle(a.querySelector(sel)).zIndex); return z('.tcoll') > 2 && z('.tdur') > 2; }));
  // The tile still opens the rail: the tap lands on the button, not the preview.
  await r.pg.click('#tiles .tile[data-index="0"]');
  await r.pg.waitForTimeout(3200);   // a second of dwell for the view, then the two-second outbox
  t('tapping the previewing tile opens the rail and views that card', r.ev.some((e) => e.event === 'rail_open' && e.params.card_position === 1) && r.ev.some((e) => e.event === 'card_view' && e.params.card_id === ids[0]));
  t('the preview pauses while the stage is open', await r.pg.evaluate(() => document.querySelector('#tiles video.tprev').paused));
  await r.pg.click('#rclose');
  await r.pg.waitForTimeout(300);
  t('no page errors', r.errs.length === 0);
  await r.ctx.close();
}

/* ---------- knob on, two tiles: the Short gets an iframe preview ---------- */
{
  // The knob is served by the studio; two previews are asked for by overriding the served knobs before the page reads them.
  const r = await open(PREVIEW, `layout=rail&placement=news&pid=sess_${RUN}_prev2`, () => {
    const orig = window.fetch;
    window.fetch = async (u, o) => { const res = await orig(u, o); if (String(u).includes('/api/feed')) { const d = await res.json(); d.knobs = { ...(d.knobs || {}), rail_preview: 2 }; return new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } }); } return res; };
  });
  const p = await previews(r.pg);
  t(`with rail_preview 2 the master gets a video and the Short gets an iframe (${JSON.stringify(p)})`, p[0] === 'video' && p[1] === 'iframe' && p.slice(2).every((x) => x === null));
  const f = await r.pg.evaluate(() => { const el = document.querySelector('#tiles iframe.tprev'); return el && { src: el.src, allow: el.allow, tab: el.tabIndex, pe: getComputedStyle(el).pointerEvents }; });
  t('the Short preview is the muted, looping, control-free embed with no tab stop and no taps', f && /youtube-nocookie\.com\/embed\/Tq3sz_Yf-Nk\?/.test(f.src) && /autoplay=1/.test(f.src) && /mute=1/.test(f.src) && /controls=0/.test(f.src) && /loop=1/.test(f.src) && /playlist=Tq3sz_Yf-Nk/.test(f.src) && /autoplay/.test(f.allow) && f.tab === -1 && f.pe === 'none');
  t('two tile_preview events, one per tile', r.ev.filter((e) => e.event === 'tile_preview').length === 2);
  await r.ctx.close();
}

/* ---------- the knob caps at three ---------- */
{
  const r = await open(PREVIEW, `layout=rail&placement=news&pid=sess_${RUN}_prev9`, () => {
    const orig = window.fetch;
    window.fetch = async (u, o) => { const res = await orig(u, o); if (String(u).includes('/api/feed')) { const d = await res.json(); d.knobs = { ...(d.knobs || {}), rail_preview: 9, picker_position: 0 }; return new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } }); } return res; };
  });
  const p = await previews(r.pg);
  t(`asking for nine previews gives at most three, and only playable cards get one (${JSON.stringify(p)})`, p.filter(Boolean).length <= 3 && p[0] === 'video' && p[1] === 'iframe' && p[2] === null);
  await r.ctx.close();
}

/* ---------- a fan who asked for less motion or less data gets stills ---------- */
{
  const r = await open(PREVIEW, `layout=rail&placement=news&pid=sess_${RUN}_prevrm`, () => {
    const mm = window.matchMedia; window.matchMedia = (q) => (q.includes('reduced-motion') ? { matches: true } : mm.call(window, q));
  });
  t('prefers-reduced-motion means no preview and no event', (await previews(r.pg)).every((x) => x === null) && !r.ev.some((e) => e.event === 'tile_preview'));
  await r.ctx.close();
  const r2 = await open(PREVIEW, `layout=rail&placement=news&pid=sess_${RUN}_prevsd`, () => { Object.defineProperty(navigator, 'connection', { value: { saveData: true } }); });
  t('save-data means no preview', (await previews(r2.pg)).every((x) => x === null));
  await r2.ctx.close();
}

/* ---------- knob off: the rail is exactly what it was ---------- */
{
  const r = await open(CONTROL, `layout=rail&placement=news&pid=sess_${RUN}_ctl`);
  t('with the default knob no tile previews and no tile_preview event fires', (await previews(r.pg)).every((x) => x === null) && !r.ev.some((e) => e.event === 'tile_preview') && !r.reqs.some((u) => /youtube-nocookie/.test(u)));
  t('the feed page (not the rail) never previews', await (async () => { const f = await open(PREVIEW, `pid=sess_${RUN}_feedpage`); const none = await f.pg.evaluate(() => !document.querySelector('.tprev')); await f.ctx.close(); return none; })());
  await r.ctx.close();
}

await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
