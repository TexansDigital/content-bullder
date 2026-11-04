/**
 * Email entry in the feed page: the arrival the host hands over lands on the identity event, and
 * every session with a GUID asks /api/who and records who_result, with the welcome card off.
 * Needs proposals/email-entry/feed.diff applied and the local server on 4400 (knobs default, so
 * welcome_card is 0: recognition must be measured in the control arm too).
 *
 *   node server.mjs
 *
 *   node test/verify-email-entry-page.mjs
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const B = process.env.CONTROL_BASE || 'http://localhost:4400';
const b = await chromium.launch({ executablePath: headlessShell() });
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const RUN = Date.now();
const whoBodies = [];
const EMAIL = { id: 'em0000e7', name: 'howtowatchchargers', campaign: '10377', asset: '4521', elq: true };

const host = (pid, guid, email) => `<script>window.__ev = []; addEventListener('message', function (e) {
    if (!e.data || e.data.source !== 'txfeed') return;
    window.__ev.push(e.data);
    if (e.data.event === 'hello') e.source.postMessage({ source: 'txfeed-host', pocketId: '${pid}', consent: true, eloquaGuid: ${JSON.stringify(guid)}, email: ${JSON.stringify(email)} }, '*');
  });<\/script><iframe src="${B}/feed?qa=1" style="width:430px;height:820px;border:0"></iframe>`;

async function open(html, url) {
  const pg = await b.newPage({ viewport: { width: 430, height: 880 } });
  const errs = [];
  pg.on('request', (r) => { if (r.url().endsWith('/api/who')) { try { whoBodies.push(JSON.parse(r.postData() || '{}')); } catch {} } });
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(() => { window.__ev = window.__ev || []; addEventListener('message', (e) => { if (e.data?.source === 'txfeed' && window.parent === window) window.__ev.push(e.data); }); });
  if (html) await pg.setContent(html, { waitUntil: 'networkidle' }); else await pg.goto(url, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(3000);
  return { ev: await pg.evaluate(() => window.__ev), errs, pg };
}
const one = (ev, name) => ev.find((e) => e.event === name)?.params;

{
  const { ev, errs } = await open(host(`sess_${RUN}_email1`, 'FEEDFACEFEEDFACEFEEDFACEFEEDFACE', EMAIL));
  const id = one(ev, 'identity');
  t('the identity event names the email the fan came from', id?.email_id === 'em0000e7' && id?.email_name === 'howtowatchchargers' && id?.email_campaign === '10377' && id?.email_asset === '4521' && id?.email_elq === true);
  t('beside the GUID, as before', id?.eloqua_guid === 'feedfacefeedfacefeedfacefeedface');
  const w = one(ev, 'who_result');
  t('with the welcome card off, the session is still asked about and the answer recorded', w?.who_known === true && w?.who_via === 'eloqua' && w?.who_contact === true);
  t('who_result carries the email too, so one row answers "recognised from which email"', w?.email_id === 'em0000e7');
  t('and it is marked as our own traffic', w?.qa === true);
  t('no welcome card in the control arm', !ev.some((e) => e.event === 'welcome_shown'));
  t('and the control arm asks the Worker not to copy picks onto the session', whoBodies.at(-1)?.copy === false);
  t('no page errors', errs.length === 0);
}
{
  const { ev } = await open(host(`sess_${RUN}_email2`, null, { id: 'em0000e7', name: '<b>x</b>', campaign: 'drop table', asset: '1' }));
  const id = one(ev, 'identity');
  t('a malformed name or campaign from the host is dropped, the rest kept', id?.email_id === 'em0000e7' && !('email_name' in id) && !('email_campaign' in id) && id?.email_asset === '1');
  t('no GUID, no lookup: who_result is not sent', !ev.some((e) => e.event === 'who_result'));
}
{
  const { ev } = await open(host(`sess_${RUN}_plain`, 'FEEDFACEFEEDFACEFEEDFACEFEEDFACE', null));
  t('a session not from email carries no email fields', !Object.keys(one(ev, 'identity') || {}).some((k) => k.startsWith('email_')));
  t('and is still asked about, which gives the baseline', one(ev, 'who_result')?.who_known === true);
}
{
  const { ev } = await open(null, `${B}/feed?qa=1&utm_source=01&utm_medium=em&utm_content=em0000e7_261102_-2026-8_14_03_14___em-01_howtowatchchargers&elqTrackId=abc&elqCampaignId=10377`);
  const id = one(ev, 'identity');
  t('an email linking straight to /feed is read from the feed URL', id?.email_id === 'em0000e7' && id?.email_campaign === '10377');
  t('but with no host to vouch for Targeting, the elq flag is never set', id && !('email_elq' in id));
}

await b.close();
console.log(`${ok.length} passed, ${bad.length} failed`);
for (const n of bad) console.log('  FAIL', n);
process.exit(bad.length ? 1 : 0);
