/**
 * Email entry, the host half: handshake v5 (proposals/email-entry/txfeed-handshake-v5.html).
 *
 * A fan clicks a club email and lands on an article. The block reads the arrival from the URL,
 * keeps it for the tab's visit under Performance consent, and hands it to the feed when the feed
 * says hello, on that page or a later one. The elq flag rides only under Targeting consent, and
 * no raw Eloqua link value ever leaves the page.
 *
 * Self-contained: the site and the feed are both routed in the browser, no server needed.
 *
 *   node test/verify-email-entry.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { headlessShell } from './browser.mjs';

const BLOCK = readFileSync(new URL('../proposals/email-entry/txfeed-handshake-v5.html', import.meta.url), 'utf8');
const SITE = 'https://www.houstontexans.com';
const FEED = 'https://feed.htow.nz';
const GUID = '0123456789ABCDEF0123456789ABCDEF';
const EMAIL_QS = '?utm_source=01&utm_medium=em&utm_campaign=--&utm_content=em0000e7_261102_-2026-8_14_03_14___em-01_howtowatchchargers'
  + '&elqTrackId=3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c&elq=aabbccddeeff00112233445566778899&elqaid=4521&elqat=1&elqCampaignId=10377';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const b = await chromium.launch({ executablePath: headlessShell() });

/** A site page: OneTrust groups (or none yet), the ELOQUA cookie, the block, and the feed iframe. */
const sitePage = (groups, { feed = true } = {}) => `<!doctype html><html><head>
  <script>${groups == null ? '' : `window.OnetrustActiveGroups = ${JSON.stringify(groups)};`}
    document.cookie = 'ELOQUA=GUID=${GUID}&FPCVISITED=1; path=/';
    localStorage.setItem('pocket_session_id', 'sess_1792089626000_k3j9xq2ab');<\/script>
  ${BLOCK}</head><body>${feed ? `<iframe id="f" src="${FEED}/stub"></iframe>` : 'article'}</body></html>`;

/** The feed, reduced to its half of the protocol: say hello, keep what comes back. */
const FEED_STUB = `<!doctype html><script>
  window.__replies = [];
  addEventListener('message', function (e) { if (e.data && e.data.source === 'txfeed-host') window.__replies.push(e.data); });
  parent.postMessage({ source: 'txfeed', event: 'hello' }, '*');
<\/script>`;

async function context(groups) {
  const ctx = await b.newContext();
  await ctx.route(`${FEED}/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: FEED_STUB }));
  await ctx.route(`${SITE}/**`, (r) => {
    const u = new URL(r.request().url());
    const g = u.searchParams.get('_g');
    return r.fulfill({ status: 200, contentType: 'text/html', body: sitePage(g === 'late' ? null : (g ?? groups), { feed: !u.pathname.startsWith('/news') }) });
  });
  return ctx;
}
const reply = async (pg) => {
  const fr = pg.frames().find((f) => f.url().startsWith(FEED));
  for (let i = 0; i < 20; i++) {
    const r = await fr.evaluate(() => window.__replies);
    if (r.length) return r[r.length - 1];
    await pg.waitForTimeout(50);
  }
  return null;
};
const stored = (pg) => pg.evaluate(() => sessionStorage.getItem('txfeed.email'));

/* ---------- landing on the feed straight from an email, both groups on ---------- */
{
  const ctx = await context(',C0001,C0002,C0004,');
  const pg = await ctx.newPage();
  await pg.goto(`${SITE}/feed${EMAIL_QS}`);
  const r = await reply(pg);
  t('the reply still carries the pocket id and the GUID as in v4', r?.pocketId === 'sess_1792089626000_k3j9xq2ab' && r?.eloquaGuid === GUID && r?.consent === true);
  t('the email the fan came from is named: its id and its name from utm_content', r?.email?.id === 'em0000e7' && r?.email?.name === 'howtowatchchargers');
  t("Eloqua's campaign and asset ids ride along", r?.email?.campaign === '10377' && r?.email?.asset === '4521');
  t('with Targeting on, the elq flag says Eloqua link parameters were present', r?.email?.elq === true);
  const raw = JSON.stringify(r);
  t('no raw Eloqua link value leaves the page (elqTrackId, elq)', !raw.includes('3f2a1b0c9d8e7f6a') && !raw.includes('aabbccddeeff0011'));
  await ctx.close();
}

/* ---------- an article first, the feed later in the same tab ---------- */
{
  const ctx = await context(',C0001,C0002,C0004,');
  const pg = await ctx.newPage();
  await pg.goto(`${SITE}/news/houston-texans-at-los-angeles-chargers-how-to-watch${EMAIL_QS}`);
  t('landing on an article keeps the arrival for the visit', JSON.parse(await stored(pg) || '{}').id === 'em0000e7');
  await pg.goto(`${SITE}/feed`);
  const r = await reply(pg);
  t('the feed met two pages later still learns which email brought the fan', r?.email?.id === 'em0000e7' && r?.email?.elq === true);
  await pg.evaluate(() => { const e = JSON.parse(sessionStorage.getItem('txfeed.email')); e.at -= 31 * 60 * 1000; sessionStorage.setItem('txfeed.email', JSON.stringify(e)); });
  await pg.goto(`${SITE}/feed`);
  t('after thirty minutes the arrival has expired and is not claimed', (await reply(pg))?.email === null);
  await ctx.close();
}

/* ---------- Performance only: attribution yes, the Targeting flag no ---------- */
{
  const ctx = await context(',C0001,C0002,');
  const pg = await ctx.newPage();
  await pg.goto(`${SITE}/feed${EMAIL_QS}`);
  const r = await reply(pg);
  t('without Targeting the GUID stays home, as in v4', r?.eloquaGuid === null);
  t('the email id still rides, as the site already records utm under Performance', r?.email?.id === 'em0000e7');
  t('but the elq flag is absent, not false', r?.email && !('elq' in r.email));
  await ctx.close();
}

/* ---------- Performance declined ---------- */
{
  const ctx = await context(',C0001,');
  const pg = await ctx.newPage();
  await pg.goto(`${SITE}/feed${EMAIL_QS}`);
  const r = await reply(pg);
  t('a fan who declined Performance gets consent false and no email', r?.consent === false && !r?.email);
  t('and nothing is kept in the tab', (await stored(pg)) === null);
  await ctx.close();
}

/* ---------- OneTrust arrives after the block ---------- */
{
  const ctx = await context(',C0001,C0002,C0004,');
  const pg = await ctx.newPage();
  await pg.goto(`${SITE}/news/story${EMAIL_QS}&_g=late`);
  t('before OneTrust has spoken nothing is kept', (await stored(pg)) === null);
  await pg.evaluate(() => { window.OnetrustActiveGroups = ',C0001,C0002,'; dispatchEvent(new Event('OneTrustGroupsUpdated')); });
  t('once Performance is on the arrival is kept', JSON.parse(await stored(pg) || '{}').id === 'em0000e7');
  await ctx.close();
}

/* ---------- not from an email ---------- */
{
  const ctx = await context(',C0001,C0002,C0004,');
  const pg = await ctx.newPage();
  await pg.goto(`${SITE}/feed?utm_source=facebook&utm_medium=paid`);
  t('a paid social arrival is not an email arrival', (await reply(pg))?.email === null);
  await pg.goto(`${SITE}/feed?utm_medium=em&utm_content=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
  const r = await reply(pg);
  t('a malformed utm_content is dropped to nulls, never passed through', r?.email === null || (r.email.id === null && r.email.name === null));
  await ctx.close();
}

await b.close();
console.log(`${ok.length} passed, ${bad.length} failed`);
for (const n of bad) console.log('  FAIL', n);
process.exit(bad.length ? 1 : 0);
