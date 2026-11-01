/**
 * YouTube cards play in the feed. YouTube's terms allow its video only in its own player,
 * unobscured, so the active card mounts that player above a slim band of ours, muted until
 * the fan asks for sound, and the poster stays until the player says it is playing. The IFrame
 * API is driven over postMessage and is simulated here, because nothing from YouTube can load
 * in this container. What is asserted is everything on our side of that boundary.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const B = 'http://localhost:4400';
const b = await chromium.launch({ executablePath: headlessShell() });
const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

await j('/api/items', { method: 'DELETE',
  body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });
await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
  urls: ['https://a.example/a.jpg', 'https://a.example/b.jpg', 'https://a.example/c.jpg'].join('\n'), collection: 'series' } }) });
const items = (await j('/api/items')).items;
const ytCard = (id, headline) => ({ status: 'published', headline, media: { kind: 'youtube', videoId: id, url: `https://www.youtube.com/shorts/${id}` },
  poster: ['https://a.example/a.jpg'], links: { youtube: `https://www.youtube.com/shorts/${id}` } });
await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[0].id, changes: { ...ytCard('Tq3sz_Yf-Nk', 'Tank is BACK'), sortIndex: 0 } }) });
await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[1].id, changes: { status: 'published', sortIndex: 1 } }) });
await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[2].id, changes: { ...ytCard('dwNx1tv_k24', 'TORO at the parade'), sortIndex: 2 } }) });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
async function open(opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 880 }, ...opts });
  const pg = await ctx.newPage();
  const errs = [], ev = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/events')) { try { ev.push(...(JSON.parse(r.postData() || '{}').events || [])); } catch {} } });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/youtube(-nocookie)?\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>yt</title>' }));
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.goto(`${B}/feed`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);
  return { pg, ctx, errs, ev };
}
/** What YouTube's player posts, from its own window, when its state changes. */
const ytSay = (pg, sel, msg) => pg.evaluate(([sel, msg]) => {
  const f = document.querySelector(sel);
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg), origin: 'https://www.youtube-nocookie.com', source: f.contentWindow }));
}, [sel, msg]);
const scrollTop = (pg) => pg.evaluate(() => document.querySelector('#feed').scrollTop);
/** Events leave in two-second batches; wait one out before reading them. */
const settle = (pg) => pg.waitForTimeout(2300);

/* ---------- in-feed ---------- */
const { pg, ctx, errs, ev } = await open();
const s0 = pg.locator('.slide[data-index="0"]');
const s1 = pg.locator('.slide[data-index="1"]');
t('a YouTube card is marked and carries our band, not the overlay chrome', await s0.evaluate((s) => s.classList.contains('yt') && !!s.querySelector('.band') && !s.querySelector('.rail')));
t('the band holds the headline and Like, Share, Sound, Expand, Source', await s0.evaluate((s) => s.querySelector('.band b').textContent === 'Tank is BACK'
  && ['.like', '.share', '.sound', '.expand', 'a[href*="youtube.com/shorts/Tq3sz_Yf-Nk"]'].every((q) => s.querySelector('.band ' + q))));
t('an image card keeps its rail and has no band or play button', await s1.evaluate((s) => !!s.querySelector('.rail .like') && !s.querySelector('.band') && !s.querySelector('.play')));
const inl = s0.locator('iframe.yt');
t('the active YouTube card mounts YouTube\'s player at once', await inl.count() === 1);
const src = await inl.getAttribute('src');
t('muted autoplay, inline, no controls, cookieless, IFrame API on', /youtube-nocookie\.com\/embed\/Tq3sz_Yf-Nk\?/.test(src) && /autoplay=1/.test(src) && /mute=1/.test(src) && /controls=0/.test(src) && /enablejsapi=1/.test(src) && /playsinline=1/.test(src));
t('the player fills the space between the strip and the band exactly', await inl.evaluate((f) => { const r = f.getBoundingClientRect(); const band = f.parentElement.querySelector('.band').getBoundingClientRect(); const slide = f.parentElement.getBoundingClientRect(); return Math.abs(r.bottom - band.top) < 1 && Math.abs(r.top - (slide.top + 26)) < 1 && r.height > 500; }));
t('the poster shows and the player is invisible until it plays', await s0.locator(':scope > img').isVisible() && (await inl.evaluate((f) => getComputedStyle(f).opacity)) === '0');
t('only the active card has a player', await pg.locator('iframe.yt').count() === 1);
t('no story clock is running under a video card', await s0.evaluate((s) => !s._t));

await ytSay(pg, '.slide[data-index="0"] iframe.yt', { event: 'onStateChange', info: 1 });
await pg.waitForTimeout(400);
t('PLAYING reveals the player and hides the play button', await s0.evaluate((s) => s.classList.contains('yt-playing')) && await s0.locator('.play').isHidden());
await settle(pg);
t('an inline start is recorded as card_autoplay, not as a tap', ev.some((e) => e.event === 'card_autoplay' && e.params.card_id === items[0].id) && !ev.some((e) => e.event === 'card_play'));

await s0.locator('.band .sound').click();
await settle(pg);
t('the band\'s sound button flips the global state', await s0.locator('.band .sound').getAttribute('aria-pressed') === 'true' && ev.some((e) => e.event === 'sound_toggle' && e.params.sound_on === true));

await ytSay(pg, '.slide[data-index="0"] iframe.yt', { event: 'onStateChange', info: 0 });
await pg.waitForTimeout(900);
t('ENDED advances to the next card', (await scrollTop(pg)) > 400);
await settle(pg);
t('the finish is recorded inline and the card counts as complete', ev.some((e) => e.event === 'card_play_complete' && e.params.play_mode === 'inline') && ev.some((e) => e.event === 'card_complete' && e.params.card_id === items[0].id) && !ev.some((e) => e.event === 'card_exit' && e.params.card_id === items[0].id));
t('leaving the card tore its player down', await s0.locator('iframe.yt').count() === 0);

// Card 2 is the second YouTube card: scroll to it, then make YouTube fail.
await pg.evaluate(() => document.querySelector('#feed').scrollBy({ top: 2000 }));
await pg.waitForTimeout(700);
const s2 = pg.locator('.slide[data-index="2"]');
t('the next YouTube card mounts its own player on arrival', await s2.locator('iframe.yt').count() === 1);
await ytSay(pg, '.slide[data-index="2"] iframe.yt', { event: 'onError', info: 101 });
await pg.waitForTimeout(300);
t('a player error falls back to the poster with its play button', await s2.locator('iframe.yt').count() === 0 && await s2.locator('.play').isVisible());
t('and the story clock takes over so the feed never stalls', await s2.evaluate((s) => Boolean(s._t)));

/* ---------- expanded ---------- */
await pg.evaluate(() => document.querySelector('#feed').scrollTo({ top: 0 }));
await pg.waitForTimeout(700);
t('coming back to a card mounts a fresh player', await s0.locator('iframe.yt').count() === 1);
await s0.locator('.band .expand').click();
await pg.waitForTimeout(300);
t('Expand opens the full-frame player and removes the inline one', await pg.locator('#player').isVisible() && await s0.locator('iframe.yt').count() === 0);
const big = await pg.locator('#player iframe').getAttribute('src');
t('the expanded player is the same video, unmuted, with the API on', /embed\/Tq3sz_Yf-Nk\?/.test(big) && !/mute=1/.test(big) && /enablejsapi=1/.test(big));
t('our bar carries the headline above the player', (await pg.locator('#p-title').textContent()) === 'Tank is BACK');
t('the feed behind is inert and focus is on the close button', (await pg.locator('#feed').getAttribute('inert')) !== null && await pg.evaluate(() => document.activeElement?.classList.contains('pclose')));
await settle(pg);
t('expanding is the explicit tap: card_play', ev.some((e) => e.event === 'card_play' && e.params.card_id === items[0].id));
await pg.keyboard.press('Escape');
await settle(pg);
t('Escape closes it, the frame is torn down, the feed is live again', await pg.locator('#player').isHidden() && await pg.locator('#player iframe').count() === 0 && (await pg.locator('#feed').getAttribute('inert')) === null);
t('closing early is recorded with seconds watched', ev.some((e) => e.event === 'card_play_close' && e.params.play_seconds >= 1 && e.params.play_mode === 'expanded'));
t('and the inline player comes back on the same card', await s0.locator('iframe.yt').count() === 1 && (await scrollTop(pg)) === 0);

await s0.locator('.band .expand').click();
await pg.waitForTimeout(200);
await ytSay(pg, '#player iframe', { event: 'onStateChange', info: 0 });
await pg.waitForTimeout(900);
t('ENDED in the expanded player closes it and advances', await pg.locator('#player').isHidden() && (await scrollTop(pg)) > 400);

await pg.evaluate(() => document.querySelector('#feed').scrollTo({ top: 0 }));
await pg.waitForTimeout(700);
await pg.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'onStateChange', info: 0 }), origin: 'https://evil.example', source: window })));
await pg.waitForTimeout(300);
t('a message from another origin changes nothing', (await scrollTop(pg)) === 0 && await s0.locator('iframe.yt').count() === 1);
t('no page errors', errs.length === 0);
await ctx.close();

/* ---------- reduced motion: nothing moves on its own ---------- */
const rm = await open({ reducedMotion: 'reduce' });
const r0 = rm.pg.locator('.slide[data-index="0"]');
t('under reduced motion no player is mounted and the play button waits', await r0.locator('iframe.yt').count() === 0 && await r0.locator('.play').isVisible());
await r0.locator('.play').click();
await rm.pg.waitForTimeout(300);
t('tapping play opens the expanded player', await rm.pg.locator('#player').isVisible());
await rm.pg.locator('#player .pclose').click();
await rm.pg.waitForTimeout(300);
t('closing it under reduced motion does not start an inline player', await rm.pg.locator('#player').isHidden() && await r0.locator('iframe.yt').count() === 0);
t('no page errors under reduced motion', rm.errs.length === 0);
await rm.ctx.close();

/* ---------- framed on a phone, with only part of the iframe on screen ---------- */
// The production regression: on houstontexans.com the feed is an iframe below a header, and a
// phone showed less than 60% of it. Observed against the top-level viewport no card ever
// intersected, so a visitor got a dead poster and reloaded four times. The scroll container is
// the root now, so a snapped card is always fully "visible" whatever the host shows.
const hostCtx = await b.newContext({ viewport: { width: 430, height: 400 } });
const host = await hostCtx.newPage();
const hostEv = [];
host.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/events')) { try { hostEv.push(...(JSON.parse(r.postData() || '{}').events || [])); } catch {} } });
await host.route(/youtube(-nocookie)?\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>yt</title>' }));
await host.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
await host.setContent(`<div style="height:120px"></div><iframe src="${B}/feed" style="width:430px;height:820px;border:0"></iframe>`, { waitUntil: 'networkidle' });
await host.waitForTimeout(3500);
const framed = host.frames().find((f) => f.url().includes('/feed'));
t('a card framed mostly off the host screen still counts as viewed', hostEv.some((e) => e.event === 'card_view'));
t('and still mounts its player', (await framed.evaluate(() => document.querySelectorAll('iframe.yt').length)) === 1);
await hostCtx.close();

await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
