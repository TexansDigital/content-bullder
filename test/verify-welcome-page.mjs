/**
 * The welcome card in the browser. The studio on PREVIEW_BASE (4401) runs with
 * FEED_KNOBS='{"welcome_card":1,...}' and answers /api/who from fixtures: one GUID is a fan who
 * saved picks elsewhere, one a fan we only watched, any other is unknown. The host page plays
 * the handshake and passes the GUID.
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
  await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: { urls: ['https://a.example/1.jpg', 'https://a.example/2.jpg', 'https://a.example/3.jpg', 'https://a.example/4.jpg'].join('\n'), collection: 'players' } }) });
  const items = (await j('/api/items')).items;
  const tail = [
    { headline: 'Stroud dime', entities: { players: ['c-j-stroud'] }, contentType: 'game_action', publishedAt: '2026-10-30T00:00:00Z' },
    { headline: 'Tank takes off', entities: { players: ['tank-dell'] }, contentType: 'game_action', publishedAt: '2026-10-29T00:00:00Z' },
    { headline: 'Camp day', entities: { players: [] }, contentType: 'offseason_camp', publishedAt: '2026-10-28T00:00:00Z' },
    { headline: 'Anderson sack', entities: { players: ['will-anderson-jr'] }, contentType: 'game_action', publishedAt: '2026-10-27T00:00:00Z' },
  ];
  for (let i = 0; i < items.length; i++) await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[i].id, changes: { ...tail[i], status: 'published', sortIndex: 1_000_000 } }) });
}
await seed(ON); await seed(OFF);
const RUN = Date.now();

const host = (B, pid, guid) => `<script>window.__ev = []; addEventListener('message', function (e) {
    if (!e.data) return;
    if (e.data.source === 'txfeed') { window.__ev.push(e.data); if (e.data.event === 'hello') e.source.postMessage({ source: 'txfeed-host', pocketId: '${pid}', consent: true, eloquaGuid: '${guid}' }, '*'); }
  });<\/script><iframe id="x" src="${B}/feed" style="width:430px;height:820px;border:0"></iframe>`;

async function open(B, pid, guid) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 880 } });
  const pg = await ctx.newPage();
  const errs = [], ev = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/events')) { try { ev.push(...(JSON.parse(r.postData() || '{}').events || [])); } catch {} } });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.setContent(host(B, pid, guid), { waitUntil: 'networkidle' });
  await pg.waitForTimeout(3200);
  const frame = pg.frames().find((f) => f.url().includes('/feed'));
  await frame.evaluate(() => { navigator.sendBeacon = () => false; });
  return { pg, ctx, errs, ev, frame };
}
const ids = (frame) => frame.evaluate(() => [...document.querySelectorAll('#feed .slide')].slice(0, 4).map((s) => s.dataset.id));
const flush = async (pg) => pg.waitForTimeout(2600);

/* ---------- a fan who saved picks on another device ---------- */
{
  const r = await open(ON, `sess_${RUN}_wpicks`, '0123456789ABCDEF0123456789ABCDEF');
  const order = await ids(r.frame);
  t(`with the knob on and picks known, Welcome! is card 2 (${order.join(' ')})`, order[1] === 'sys-welcome');
  const text = await r.frame.evaluate(() => document.querySelector('.slide[data-id="sys-welcome"]').textContent.replace(/\s+/g, ' '));
  t('the card says Welcome!, never welcome back, and names the saved picks', /Welcome!/.test(text) && !/back/i.test(text) && /Your picks are saved: C\.J\. Stroud, Tank Dell\./.test(text));
  t('the feed was re-asked as the fan and now opens on their pick', /Stroud dime/.test(await r.frame.evaluate(() => document.querySelector('#feed .slide').textContent)));
  await flush(r.pg);
  t('welcome_shown fired with its source and that picks were copied', r.ev.some((e) => e.event === 'welcome_shown' && e.params.welcome_source === 'picks' && e.params.welcome_copied === true));
  t('the feed_load after the copy says why', r.ev.filter((e) => e.event === 'feed_load').length >= 2);
  await r.frame.evaluate(() => { const f = document.querySelector('#feed'); f.scrollTop = f.clientHeight; });
  await r.pg.waitForTimeout(1300);
  await r.frame.click('.slide[data-id="sys-welcome"] .ok');
  await flush(r.pg);
  t('Keep going records the action and the card is gone', r.ev.some((e) => e.event === 'welcome_action' && e.params.welcome_action === 'keep') && !(await ids(r.frame)).includes('sys-welcome'));
  t('no page errors', r.errs.length === 0);
  await r.ctx.close();
}

/* ---------- a fan we only watched: one tap makes the pick ---------- */
{
  const r = await open(ON, `sess_${RUN}_wwatch`, 'ABCDEF0123456789ABCDEF0123456789');
  const order = await ids(r.frame);
  t(`a watched fan gets the welcome at card 2 too (${order.join(' ')})`, order[1] === 'sys-welcome');
  const text = await r.frame.evaluate(() => document.querySelector('.slide[data-id="sys-welcome"]').textContent.replace(/\s+/g, ' '));
  t('it names the player they watch and offers them first', /watching Tank Dell/.test(text) && /Yes, Dell first/.test(text));
  await r.frame.evaluate(() => { const f = document.querySelector('#feed'); f.scrollTop = f.clientHeight; });
  await r.pg.waitForTimeout(1300);
  await r.frame.click('.slide[data-id="sys-welcome"] .yes');
  await flush(r.pg); await flush(r.pg);
  t('Yes saves the pick from the welcome and the feed reorders on it', r.ev.some((e) => e.event === 'prefs_save' && e.params.save_source === 'welcome' && e.params.welcome_action === 'more') && /Tank takes off/.test(await r.frame.evaluate(() => document.querySelector('#feed .slide').textContent)));
  await r.ctx.close();
}

/* ---------- once a day, and nothing for the unknown ---------- */
{
  const r = await open(ON, `sess_${RUN}_wunknown`, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
  await flush(r.pg);
  t('an unknown GUID gets no card and a welcome_skipped event', !(await ids(r.frame)).includes('sys-welcome') && r.ev.some((e) => e.event === 'welcome_skipped'));
  await r.ctx.close();
  const r2 = await open(ON, `sess_${RUN}_wagain`, '0123456789ABCDEF0123456789ABCDEF');
  await r2.frame.evaluate(() => { try { const all = JSON.parse(localStorage.getItem('txfeed.seen') || '{}'); all['welcome:shown'] = Date.now() - 3600e3; localStorage.setItem('txfeed.seen', JSON.stringify(all)); } catch {} });
  await r2.frame.evaluate(() => location.reload());
  await r2.pg.waitForTimeout(3500);
  const f2 = r2.pg.frames().find((f) => f.url().includes('/feed'));
  t('a fan welcomed within the last day is not welcomed again', !(await ids(f2)).includes('sys-welcome'));
  await r2.ctx.close();
}

/* ---------- knob off: the control arm never sees it ---------- */
{
  const r = await open(OFF, `sess_${RUN}_wctl`, '0123456789ABCDEF0123456789ABCDEF');
  await flush(r.pg);
  t('with the default knob no welcome card appears and /api/who is never asked', !(await ids(r.frame)).includes('sys-welcome') && !r.ev.some((e) => /^welcome_/.test(e.event)));
  await r.ctx.close();
}

await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
