/**
 * Handshake v5: the page_view beacon (workstream 3, site signals).
 *
 * Loads docs/txfeed-handshake.html into pages served as www.houstontexans.com, with the
 * article markup copied from a real article's JSON-LD, and catches what it posts to the feed's
 * events route. No server needed: both origins are routed inside the browser.
 *
 *   cd /tmp && node /path/to/test/verify-site-signals.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { headlessShell } from './browser.mjs';

const block = readFileSync(fileURLToPath(new URL('../docs/txfeed-handshake.html', import.meta.url)), 'utf8');
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const ARTICLE = ld({ '@type': 'NewsArticle', keywords: ['Homepage CP', 'vanderblog', 'Jadeveon Clowney', "Ka'imi Fairbairn", 'Kai Kroeger'], articleSection: 'News' })
  + ld({ '@type': 'WebPage', keywords: ['Community'], articleSection: 'Community' });
const VIDEO = ld({ '@type': 'NewsArticle', articleSection: 'Player Reporter' });

/** ot: undefined = OneTrust never loads, a string = active groups at load, {late, groups} = arrives later. */
function page({ head = '', body = '', ot, pocket = 'sess_1792089626000_k3j9xq2ab' }) {
  const setOt = typeof ot === 'string' ? `window.OnetrustActiveGroups=${JSON.stringify(ot)};` : '';
  const late = ot && typeof ot === 'object'
    ? `setTimeout(function(){window.OnetrustActiveGroups=${JSON.stringify(ot.groups)};window.dispatchEvent(new Event('consent.onetrust'));}, ${ot.late});` : '';
  const setPocket = pocket ? `try{localStorage.setItem('pocket_session_id',${JSON.stringify(pocket)})}catch(e){}` : `try{localStorage.removeItem('pocket_session_id')}catch(e){}`;
  return `<!doctype html><html><head><script>${setOt}${setPocket}${late}</script>${block}${head}</head><body><h1>A true weapon, a homecoming sack</h1>${body}</body></html>`;
}

const b = await chromium.launch({ executablePath: headlessShell() });

async function visit(path, html, wait = 1200) {
  const ctx = await b.newContext();
  const posts = [];
  await ctx.route('https://feed.htow.nz/**', async (route) => {
    const r = route.request();
    if (r.method() === 'POST') posts.push({ url: r.url(), type: r.headers()['content-type'], body: r.postData() });
    await route.fulfill({ status: 204, body: '' });
  });
  await ctx.route('https://www.houstontexans.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('https://www.houstontexans.com' + path);
  await pg.waitForTimeout(wait);
  const state = await pg.evaluate(() => window.houModules && window.houModules['txfeed-handshake']);
  await ctx.close();
  const events = posts.map((p) => { try { return JSON.parse(p.body); } catch { return null; } }).filter(Boolean);
  return { posts, events, state, errs };
}

/* ---------- consent ---------- */

let r = await visit('/news/a-true-weapon', page({ head: ARTICLE, ot: ',C0001,C0002,' }));
t('Performance on, pocket id present: exactly one page_view', r.events.length === 1 && r.events[0].event === 'page_view');
const p = r.events[0]?.params || {};
t('it carries the pocket id', p.pocket_id === 'sess_1792089626000_k3j9xq2ab');
t('it carries the first JSON-LD block\'s keywords, in order', JSON.stringify(p.page_tags) === JSON.stringify(['Homepage CP', 'vanderblog', 'Jadeveon Clowney', "Ka'imi Fairbairn", 'Kai Kroeger']));
t('and its section', p.page_section === 'News');
t('and the page type and path', p.page_type === 'news' && p.page_path === '/news/a-true-weapon');
t('and the h1 as title', p.page_title === 'A true weapon, a homecoming sack');
t('never a GUID, even with Targeting on', !JSON.stringify(r.events).includes('GUID') && !('eloqua_guid' in p));
t('sent as text/plain so there is no CORS preflight', /^text\/plain/.test(r.posts[0]?.type || ''));
t('to the feed\'s existing events route', r.posts[0]?.url === 'https://feed.htow.nz/api/events');
t('not marked qa on a normal visit', !('qa' in p));
t('state says sent', r.state?.pageView === 'sent' && r.state?.v === 5);
t('no page errors', r.errs.length === 0);

r = await visit('/news/a-true-weapon', page({ head: ARTICLE, ot: ',C0001,C0004,' }));
t('Performance off: nothing sent, even with Targeting on', r.events.length === 0 && r.state?.pageView === 'no-consent');

r = await visit('/news/a-true-weapon', page({ head: ARTICLE, ot: undefined }), 1500);
t('OneTrust absent: nothing sent (consent unknown is not consent)', r.events.length === 0);

r = await visit('/news/a-true-weapon', page({ head: ARTICLE, ot: { late: 700, groups: ',C0001,C0002,' } }), 1500);
t('consent arriving after load still counts, once', r.events.length === 1);

r = await visit('/news/a-true-weapon', page({ head: ARTICLE, ot: ',C0002,', pocket: null }), 1500);
t('no pocket id: nothing sent', r.events.length === 0);

/* ---------- which pages ---------- */

r = await visit('/video/brevin-jordan-on-the-mic', page({ head: VIDEO, ot: ',C0002,' }));
t('a video page with only a section still sends, with the title for the rollup to read',
  r.events.length === 1 && r.events[0].params.page_type === 'video' && r.events[0].params.page_section === 'Player Reporter' && r.events[0].params.page_tags.length === 0);

r = await visit('/photos/bold-awards', page({ head: ARTICLE, ot: ',C0002,' }));
t('galleries count', r.events[0]?.params.page_type === 'photos');

r = await visit('/', page({ head: ARTICLE, ot: ',C0002,' }));
t('the home page does not', r.events.length === 0 && r.state?.pageView === 'not-content');

r = await visit('/news/', page({ head: ARTICLE, ot: ',C0002,' }));
t('a section index does not', r.events.length === 0);

r = await visit('/news/a-true-weapon?qa=1', page({ head: ARTICLE, ot: ',C0002,' }));
t('?qa=1 marks the event qa: true', r.events[0]?.params.qa === true);
t('and the query string never travels', !r.events[0]?.params.page_path.includes('?'));

/* ---------- the handshake itself is unchanged ---------- */

{
  const ctx = await b.newContext();
  await ctx.route('https://feed.htow.nz/**', (route) => route.fulfill({ status: 200, contentType: 'text/html',
    body: `<script>window.__r=[];addEventListener('message',e=>window.__r.push(e.data));parent.postMessage({source:'txfeed',event:'hello'},'*');</script>` }));
  const html = page({ ot: ',C0002,C0004,', body: '<iframe src="https://feed.htow.nz/feed"></iframe>' })
    .replace('<script>', `<script>document.cookie='ELOQUA=GUID=0123456789ABCDEF0123456789ABCDEF';`);
  await ctx.route('https://www.houstontexans.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  const pg = await ctx.newPage();
  await pg.goto('https://www.houstontexans.com/feed');
  await pg.waitForTimeout(800);
  const reply = await pg.frames()[1].evaluate(() => window.__r);
  t('hello is still answered with pocket id, consent and GUID (v4 behaviour)',
    reply.length === 1 && reply[0].pocketId === 'sess_1792089626000_k3j9xq2ab' && reply[0].consent === true && reply[0].eloquaGuid === '0123456789ABCDEF0123456789ABCDEF');
  await ctx.close();
}

await b.close();
for (const n of ok) console.log('  ok   ', n);
for (const n of bad) console.log('  FAIL ', n);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
