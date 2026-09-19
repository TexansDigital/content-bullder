import { chromium } from 'playwright';
const B = 'http://localhost:4400';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
  urls: ['https://a.example/one.jpg', 'https://a.example/two.mp4', 'https://a.example/three.jpg'].join('\n'),
  collection: 'series' } }) });
for (const it of (await j('/api/items')).items)
  await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: it.id, changes: {
    status: 'published', action: { label: 'Watch', url: 'https://www.houstontexans.com' } } }) });

const p = await b.newPage({ viewport: { width: 430, height: 880 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(B + '/feed', { waitUntil: 'networkidle' }); await p.waitForTimeout(700);
t('one segment strip', (await p.evaluate(() => document.querySelectorAll('.segs').length)) === 1);
t('feed has role=feed', await p.evaluate(() => document.querySelector('#feed').getAttribute('role') === 'feed'));
t('slides carry posinset', await p.evaluate(() => !!document.querySelector('.slide[aria-posinset]')));
t('off-screen slides are inert', await p.evaluate(() => document.querySelectorAll('.slide[inert]').length > 0));
t('sound toggle present', await p.evaluate(() => !!document.querySelector('.rb.sound')));
t('starts muted', await p.evaluate(() => document.querySelector('.rb.sound').getAttribute('aria-pressed') === 'false'));
await p.click('.rb.sound'); await p.waitForTimeout(250);
t('sound toggles on', await p.evaluate(() => document.querySelector('.rb.sound').getAttribute('aria-pressed') === 'true'));
await p.click('.slide .share'); await p.waitForTimeout(400);
t('share gives visible feedback', await p.evaluate(() => { const f = document.querySelector('.flash'); return f && !f.hidden && f.textContent.length > 0; }));
t('nav buttons exist', await p.evaluate(() => !!document.querySelector('#next')));
const before = await p.evaluate(() => document.querySelector('#feed').scrollTop);
await p.evaluate(() => document.querySelector('#next').click()); await p.waitForTimeout(800);
t('next advances', (await p.evaluate(() => document.querySelector('#feed').scrollTop)) > before);

await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
const box = await p.evaluate(() => { const r = document.querySelector('.phone').getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), iw: innerWidth, ih: innerHeight }; });
t(`phone fills the screen (${box.w}x${box.h} of ${box.iw}x${box.ih})`, box.w === box.iw && box.h >= box.ih - 2);
await p.screenshot({ path: '/tmp/f-phone.png' });

const rm = await b.newPage({ viewport: { width: 430, height: 880 }, reducedMotion: 'reduce' });
await rm.goto(B + '/feed', { waitUntil: 'networkidle' }); await rm.waitForTimeout(700);
t('reduced motion: bar not pre-filled', (await rm.evaluate(() => document.querySelector('.fill')?.style.width)) !== '100%');

console.log('PASS ' + ok.length); ok.forEach(x => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach(x => console.log('  - ' + x)); }
if (errs.length) console.log('page errors:\n' + errs.join('\n'));
await b.close();
