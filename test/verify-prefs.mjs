/**
 * The preference layer, on the page. A fan is offered the picker after a couple of cards,
 * picks a player and a lane, and sees the feed reorder on the spot with a reason on the card
 * that moved. "Not now" is remembered. A saved fan gets a "Your feed" chip back to the picker.
 * A capture card opens the entry form in the modal with this session's id. Knobs from the
 * server move the picker and switch the reasons.
 *
 * Runs against the local server, which keeps preferences in prefs.json beside the store and
 * serves the same picker shape the Worker does.
 */
import { chromium } from 'playwright';
import { headlessShell } from './browser.mjs';

const B = 'http://localhost:4400';
const b = await chromium.launch({ executablePath: headlessShell() });
const j = async (p, o) => (await fetch(B + p, { headers: { 'content-type': 'application/json' }, ...o })).json();
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

await j('/api/items', { method: 'DELETE', body: JSON.stringify({ ids: (await j('/api/items')).items.map((i) => i.id) }) });
await j('/api/pull', { method: 'POST', body: JSON.stringify({ adapter: 'manual', config: {
  urls: ['https://a.example/1.jpg', 'https://a.example/2.jpg', 'https://a.example/3.jpg', 'https://a.example/4.jpg', 'https://a.example/5.jpg'].join('\n'), collection: 'players' } }) });
const items = (await j('/api/items')).items;
// Five catalogue-like cards: all in the rankable tail, two about Anderson, one about Stroud.
const tail = [
  { headline: 'Stroud dime', entities: { players: ['c-j-stroud'] }, contentType: 'game_action', publishedAt: '2026-10-30T00:00:00Z' },
  { headline: 'TORO prank', entities: { players: [] }, contentType: 'mascot_skits', publishedAt: '2026-10-29T00:00:00Z' },
  { headline: 'Anderson sack', entities: { players: ['will-anderson-jr'] }, contentType: 'game_action', publishedAt: '2026-10-28T00:00:00Z' },
  { headline: 'Camp day', entities: { players: [] }, contentType: 'offseason_camp', publishedAt: '2026-10-27T00:00:00Z' },
  { headline: 'Anderson mic\'d up', entities: { players: ['will-anderson-jr'] }, contentType: 'player_stories', publishedAt: '2026-10-26T00:00:00Z' },
];
for (let i = 0; i < items.length; i++) {
  await j('/api/items', { method: 'PATCH', body: JSON.stringify({ id: items[i].id, changes: { ...tail[i], status: 'published', sortIndex: 1_000_000 } }) });
}
// Fresh ids per run: the local server keeps preferences in prefs.json between runs.
const RUN = Date.now();
const PID = `sess_${RUN}_prefstest`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function open({ pid = PID, knobs = null } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 } });
  const pg = await ctx.newPage();
  const errs = [], ev = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/events')) { try { ev.push(...(JSON.parse(r.postData() || '{}').events || [])); } catch {} } });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  if (knobs) {
    // Knobs come from the server; here the server's answer is rewritten on the way in.
    await pg.route(/\/api\/feed/, async (r) => {
      const res = await r.fetch(); const body = await res.json();
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, knobs: { ...body.knobs, ...knobs } }) });
    });
  }
  await pg.goto(`${B}/feed?pid=${pid}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  return { pg, ctx, errs, ev };
}
const ids = (pg) => pg.evaluate(() => [...document.querySelectorAll('.slide')].map((s) => s.dataset.id));
const settle = (pg) => pg.waitForTimeout(2300);

/* ---------- the offer ---------- */
const a = await open();
let order = await ids(a.pg);
t('the picker is offered as the third card, after two cards have had their say', order[2] === 'sys-picker' && order.length === 6);
t('it shows the catalogue\'s players, the lanes, watch-or-read', await a.pg.evaluate(() =>
  document.querySelectorAll('.pk .players .opt').length === 2 && document.querySelectorAll('.pk .lanes .opt').length === 3 && document.querySelectorAll('.pk .format .opt').length === 2));
t('an empty lane is not offered: no community chip until a community card exists', !(await a.pg.locator('.pk .lanes .opt').allTextContents()).includes('Community'));
t('the two players are named, not slugged', (await a.pg.locator('.pk .players .opt').allTextContents()).sort().join() === 'C J Stroud,Will Anderson Jr');
t('no "Your feed" chip before anything is saved', (await a.pg.locator('.chip.mine').count()) === 0);
t('the picker card wears the brand: the flag plate and the stamp, square chrome', await a.pg.evaluate(() => {
  const s = document.querySelector('.slide[data-id="sys-picker"]'); return /steel-916\.jpg/.test(getComputedStyle(s).backgroundImage) && s.querySelector('.pk .stamp i') !== null
    && getComputedStyle(s.querySelector('.pk .save')).borderRadius === '0px' && getComputedStyle(s.querySelector('.pk .opt')).borderRadius === '4px';
}));

// Pick Anderson and the inside lane, save.
await a.pg.locator('.pk .players .opt', { hasText: 'Will Anderson Jr' }).click();
await a.pg.locator('.pk .lanes .opt', { hasText: "Mic'd up" }).click();
await a.pg.locator('.pk .save').click();
await a.pg.waitForTimeout(900);
order = await ids(a.pg);
t('saving reorders the feed on the spot: an Anderson card leads', order[0] === items[2].id || order[0] === items[4].id);
t('the mic\'d up Anderson card wins the tie because the lane says so', order[0] === items[4].id);
t('the picker card is gone from the feed', !order.includes('sys-picker'));
t('the moved card says why, in the fan\'s words', (await a.pg.locator('.slide[data-index="0"] .why').textContent()) === 'Because you picked Will Anderson Jr');
t('a card the pick did not touch carries no reason', (await a.pg.locator(`.slide[data-id="${items[1].id}"] .why`).count()) === 0);
t('a toast confirms it with the first reason', /Your feed is set\. First up: because you picked will anderson jr\./.test(await a.pg.locator('#toast').textContent()));
t('a "Your feed" chip appears first in the bar', (await a.pg.locator('#bar .chip').first().textContent()).startsWith('Your feed'));
await settle(a.pg);
t('prefs_save is reported with what was picked, then the feed reloads as personal', (() => {
  const s = a.ev.find((e) => e.event === 'prefs_save'); const l = a.ev.filter((e) => e.event === 'feed_load');
  return s && s.params.players_n === 1 && s.params.wants_n === 1 && s.params.card_id === 'sys-picker' && l.length === 2 && l[1].params.feed_rank === 'personal' && l[1].params.has_prefs === true && l[1].params.feed_reload === 'prefs';
})());
t('the save landed on the server', (await j(`/api/feed?sid=${PID}`)).prefs.players.join() === 'will-anderson-jr');

// Reload: the saved fan gets the personal order from the first paint and no picker.
await a.pg.reload({ waitUntil: 'networkidle' }); await a.pg.waitForTimeout(600);
order = await ids(a.pg);
t('on the next visit the order is personal from the first card and the picker is not re-offered', order[0] === items[4].id && !order.includes('sys-picker'));
// Edit via the chip: the picker returns at the top, prefilled.
await a.pg.locator('.chip.mine').click(); await a.pg.waitForTimeout(300);
t('"Your feed" brings the picker back at the top, prefilled', (await ids(a.pg))[0] === 'sys-picker' && (await a.pg.locator('.pk .players .opt[aria-pressed="true"]').textContent()) === 'Will Anderson Jr' && (await a.pg.locator('.pk .save').textContent()) === 'Update my feed');
await a.pg.locator('.pk .skip').click(); await a.pg.waitForTimeout(200);
t('Cancel puts the feed back without changing anything', !(await ids(a.pg)).includes('sys-picker') && (await ids(a.pg))[0] === items[4].id);
t('no page errors', a.errs.length === 0);
await a.ctx.close();

/* ---------- not now ---------- */
const n = await open({ pid: `sess_${RUN}_skipstest` });
await n.pg.locator('.pk .skip').click(); await n.pg.waitForTimeout(200);
t('"Not now" removes the picker', !(await ids(n.pg)).includes('sys-picker'));
await settle(n.pg);
t('the skip is reported', n.ev.some((e) => e.event === 'prefs_skip' && e.params.card_id === 'sys-picker'));
await n.pg.reload({ waitUntil: 'networkidle' }); await n.pg.waitForTimeout(600);
t('and it stays away on the next visit', !(await ids(n.pg)).includes('sys-picker'));
await n.ctx.close();

/* ---------- knobs ---------- */
const k = await open({ pid: `sess_${RUN}_knobstest1`, knobs: { picker_position: 0 } });
t('a knob moves the picker to the first card', (await ids(k.pg))[0] === 'sys-picker');
await k.ctx.close();
const k2 = await open({ pid: `sess_${RUN}_knobstest2`, knobs: { picker_position: -1 } });
t('a knob can hide the picker entirely', !(await ids(k2.pg)).includes('sys-picker'));
await k2.ctx.close();
const k3 = await open({ knobs: { reason_pills: 'off' } });
t('reasons can be switched off for an arm', (await k3.pg.locator('.why').count()) === 0 && (await ids(k3.pg))[0] === items[4].id);
await k3.ctx.close();

/* ---------- the capture card ---------- */
const c = await open({ pid: `sess_${RUN}_capturetest`, knobs: { picker_position: -1, capture_card: { position: 1, headline: 'Win two tickets', blurb: 'Enter by Friday.', cta: 'Enter now', form: 'HTX_Sweeps_Test', campaign: 'cmp-1' } } });
let ord = await ids(c.pg);
t('the capture card sits where the knob put it', ord[1] === 'sys-enter' && (await c.pg.locator('.slide[data-id="sys-enter"] h2').textContent()) === 'Win two tickets');
await c.pg.locator('.slide[data-id="sys-enter"] .go').click(); await c.pg.waitForTimeout(400);
const src = await c.pg.locator('#player iframe').getAttribute('src');
t('Enter opens the form in the modal with this session\'s id, the form name and the card', /^\/enter\?/.test(src) && new RegExp(`pid=sess_${RUN}_capturetest`).test(src) && /form=HTX_Sweeps_Test/.test(src) && /cid=cmp-1/.test(src) && /card=sys-enter/.test(src));
t('the feed behind it is inert', (await c.pg.locator('#feed').getAttribute('inert')) !== null);
await c.pg.keyboard.press('Escape'); await c.pg.waitForTimeout(200);
t('Escape closes it and the feed is live again', await c.pg.locator('#player').isHidden() && (await c.pg.locator('#feed').getAttribute('inert')) === null);
await settle(c.pg);
t('open and close are reported against the capture card', c.ev.some((e) => e.event === 'capture_open' && e.params.card_id === 'sys-enter') && c.ev.some((e) => e.event === 'capture_close'));
t('no page errors on the capture flow', c.errs.length === 0);
await c.ctx.close();

/* ---------- the two questions ---------- */
const q = await open({ pid: `sess_${RUN}_questions` });
t('the picker asks about going to a game and how the fan watches', await q.pg.evaluate(() => document.querySelectorAll('.pk .going .opt').length === 3 && document.querySelectorAll('.pk .watch .opt').length === 3)
  && (await q.pg.locator('.pk .going .opt').allTextContents()).join() === 'Yes,Maybe,Not this year' && (await q.pg.locator('.pk .watch .opt').allTextContents()).join() === 'At Reliant Stadium,At home,On the go');
await q.pg.locator('.pk .going .opt', { hasText: 'Yes' }).click();
await q.pg.locator('.pk .watch .opt', { hasText: 'On the go' }).click();
await q.pg.locator('.pk .save').click(); await q.pg.waitForTimeout(900);
const saved = (await j(`/api/feed?sid=sess_${RUN}_questions`)).prefs;
t('answers alone make a feed: saved, and the order is personal with no player picked', saved.going === 'yes' && saved.watch === 'go' && saved.players.length === 0);
await settle(q.pg);
t('the save reports both answers', q.ev.some((e) => e.event === 'prefs_save' && e.params.pref_going === 'yes' && e.params.pref_watch === 'go' && e.params.save_source === 'picker'));
await q.pg.locator('.chip.mine').click(); await q.pg.waitForTimeout(300);
t('they come back pressed in the picker', (await q.pg.locator('.pk .going .opt[aria-pressed="true"]').textContent()) === 'Yes' && (await q.pg.locator('.pk .watch .opt[aria-pressed="true"]').textContent()) === 'On the go');
t('no page errors', q.errs.length === 0);
await q.ctx.close();

/* ---------- a boost that has run out ---------- */
const XP = `sess_${RUN}_expiry`;
await j('/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: XP, players: ['will-anderson-jr'], boosts: [{ key: 'draft-week', until: '2026-10-01T00:00:00Z', label: 'Draft news' }] }) });
const x = await open({ pid: XP });
let xo = await ids(x.pg);
t('a lapsed boost gets a card that says so, right after the first card', xo[1] === 'sys-expiry' && (await x.pg.locator('.slide[data-id="sys-expiry"] h2').textContent()) === 'Draft news is over.' && /Back to your picks: Will Anderson Jr/.test(await x.pg.locator('.slide[data-id="sys-expiry"] p').first().textContent()));
await x.pg.locator('.slide[data-id="sys-expiry"] .ok').click(); await x.pg.waitForTimeout(300);
t('"Got it" closes the loop', !(await ids(x.pg)).includes('sys-expiry'));
await settle(x.pg);
t('seeing it is reported with the boost key', x.ev.some((e) => e.event === 'boost_expired_seen' && e.params.offer_key === 'draft-week'));
await x.pg.reload({ waitUntil: 'networkidle' }); await x.pg.waitForTimeout(600);
t('and it does not come back', !(await ids(x.pg)).includes('sys-expiry'));
await x.ctx.close();
const xh = await open({ pid: XP, knobs: { expiry_position: -1 } });
t('a knob can hide the expiry card', !(await ids(xh.pg)).includes('sys-expiry'));
await xh.ctx.close();

/* ---------- an offer, to a fan who already has a feed ---------- */
const OF = `sess_${RUN}_offer`;
await j('/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: OF, players: ['c-j-stroud'] }) });
const offer = { key: 'giants-week', label: 'Giants week', blurb: 'All things Giants before Sunday.', content_types: ['opponent_week'], keywords: ['giants'], ends_at: '2099-11-09T23:00:00Z' };
async function openWithOffer(pid, knobs = null) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 } });
  const pg = await ctx.newPage(); const errs = [], ev = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (r.method() === 'POST' && (r.url().endsWith('/api/events') || r.url().endsWith('/api/prefs'))) { try { const body = JSON.parse(r.postData() || '{}'); if (r.url().endsWith('/api/prefs')) ev.push({ event: '__prefs_post', params: body }); else ev.push(...(body.events || [])); } catch {} } });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.route(/\/api\/feed/, async (r) => {
    const res = await r.fetch(); const body = await res.json();
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, picker: { ...(body.picker || {}), offers: [offer] }, ...(knobs ? { knobs: { ...body.knobs, ...knobs } } : {}) }) });
  });
  await pg.goto(`${B}/feed?pid=${pid}`, { waitUntil: 'networkidle' }); await pg.waitForTimeout(600);
  return { pg, ctx, errs, ev };
}
const o = await openWithOffer(OF);
let oo = await ids(o.pg);
t('a fan with a feed meets the live offer as its own card, in the picker\'s slot', oo[2] === 'sys-offer' && !oo.includes('sys-picker') && (await o.pg.locator('.slide[data-id="sys-offer"] h2').textContent()) === 'Giants week?'
  && /until Nov 9, then your feed goes back to normal/.test(await o.pg.locator('.slide[data-id="sys-offer"] p').first().textContent()));
t('the yes button carries the date', /^Yes, until Nov 9/.test(await o.pg.locator('.slide[data-id="sys-offer"] .yes').textContent()));
await o.pg.locator('.slide[data-id="sys-offer"] .yes').click(); await o.pg.waitForTimeout(900);
const post = o.ev.find((e) => e.event === '__prefs_post');
t('one tap saves the boost with its end date and label, and keeps the pick', post && post.params.source === 'offer' && post.params.boosts.length === 1 && post.params.boosts[0].key === 'giants-week' && post.params.boosts[0].label === 'Giants week' && /2099-11-09/.test(post.params.boosts[0].until) && post.params.players.join() === 'c-j-stroud');
t('the offer card is gone and a toast says how long it runs', !(await ids(o.pg)).includes('sys-offer') && /Giants week is on until Nov 9\. Then back to your picks\./.test(await o.pg.locator('#toast').textContent()));
await settle(o.pg);
t('accepting is reported, then the save', o.ev.some((e) => e.event === 'offer_accept' && e.params.offer_key === 'giants-week') && o.ev.some((e) => e.event === 'prefs_save' && e.params.save_source === 'offer' && e.params.boosts_n === 1));
t('no page errors on the offer', o.errs.length === 0);
await o.ctx.close();
const OD = `sess_${RUN}_offerno`;
await j('/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: OD, players: ['c-j-stroud'] }) });
const od = await openWithOffer(OD);
await od.pg.locator('.slide[data-id="sys-offer"] .no').click(); await od.pg.waitForTimeout(300);
t('"No thanks" removes it', !(await ids(od.pg)).includes('sys-offer'));
await od.pg.reload({ waitUntil: 'networkidle' }); await od.pg.waitForTimeout(600);
t('and it stays away', !(await ids(od.pg)).includes('sys-offer'));
await od.ctx.close();
const on = await openWithOffer(`sess_${RUN}_offernew`);
t('a fan with no feed yet meets the offer inside the picker, not as a second card', (await ids(on.pg)).includes('sys-picker') && !(await ids(on.pg)).includes('sys-offer') && (await on.pg.locator('.pk .offer').count()) === 1);
await on.ctx.close();

/* ---------- the fan's week ---------- */
const WK = `sess_${RUN}_week`;
await j('/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: WK, players: ['c-j-stroud'] }) });
const week = { views: 14, players: [{ slug: 'c-j-stroud', name: 'C J Stroud', n: 9 }, { slug: 'will-anderson-jr', name: 'Will Anderson Jr', n: 3 }], types: [{ type: 'mascot_skits', name: 'TORO skits', lane: 'fun', n: 5 }] };
async function openWithWeek(pid, w = week) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 } });
  const pg = await ctx.newPage(); const errs = [], ev = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (r.method() === 'POST' && (r.url().endsWith('/api/events') || r.url().endsWith('/api/prefs'))) { try { const body = JSON.parse(r.postData() || '{}'); if (r.url().endsWith('/api/prefs')) ev.push({ event: '__prefs_post', params: body }); else ev.push(...(body.events || [])); } catch {} } });
  await pg.addInitScript(() => { navigator.sendBeacon = () => false; });
  await pg.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await pg.route(/\/api\/feed/, async (r) => { const res = await r.fetch(); const body = await res.json(); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...body, week: w }) }); });
  await pg.goto(`${B}/feed?pid=${pid}`, { waitUntil: 'networkidle' }); await pg.waitForTimeout(600);
  return { pg, ctx, errs, ev };
}
const wkp = await openWithWeek(WK);
t('a fan with a week gets it back as a card at the fifth slot, the total as a stat, the rest as a line', (await ids(wkp.pg))[4] === 'sys-week' && (await wkp.pg.locator('.slide[data-id="sys-week"] .stat').textContent()) === '14' && (await wkp.pg.locator('.slide[data-id="sys-week"] p').first().textContent()) === '9 C J Stroud, 3 Will Anderson Jr and 5 TORO skits.');
t('and is offered more of what they watched but have not asked for: the lane and the other player, not the one already picked', (await wkp.pg.locator('.slide[data-id="sys-week"] .more .opt').allTextContents()).join('|') === 'More fun & toro|More Will Anderson Jr');
await wkp.pg.locator('.slide[data-id="sys-week"] .more .opt', { hasText: 'Will Anderson' }).click(); await wkp.pg.waitForTimeout(900);
const wpost = wkp.ev.find((e) => e.event === '__prefs_post');
t('one tap adds the player to the picks and keeps the rest', wpost && wpost.params.source === 'week' && wpost.params.players.join() === 'c-j-stroud,will-anderson-jr');
t('the card is gone, the feed moved, the toast says what came first', !(await ids(wkp.pg)).includes('sys-week') && /^Done\. First up: because you picked/.test(await wkp.pg.locator('#toast').textContent()));
await settle(wkp.pg);
t('the save says it came from the week card', wkp.ev.some((e) => e.event === 'prefs_save' && e.params.save_source === 'week' && e.params.week_more === 'player:will-anderson-jr'));
await wkp.pg.reload({ waitUntil: 'networkidle' }); await wkp.pg.waitForTimeout(600);
t('once a week: it does not return this week', !(await ids(wkp.pg)).includes('sys-week'));
t('no page errors on the week', wkp.errs.length === 0);
await wkp.ctx.close();
const thin = await openWithWeek(`sess_${RUN}_thinweek`, { views: 3, players: [], types: [] });
t('three views is not a week worth showing', !(await ids(thin.pg)).includes('sys-week'));
await thin.ctx.close();

/* ---------- the capture card, personal ---------- */
const CP = `sess_${RUN}_capturemine`;
await j('/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: CP, players: ['will-anderson-jr'] }) });
const cp = await open({ pid: CP, knobs: { picker_position: -1, capture_card: { position: 1, headline: 'Win {{player}} gear', blurb: 'Signed by {{player}}.', cta: 'Enter for {{player}}', form: 'fan_preference_web' } } });
t('{{player}} becomes the fan\'s first pick on the headline, blurb and button', (await cp.pg.locator('.slide[data-id="sys-enter"] h2').textContent()) === 'Win Will Anderson Jr gear' && (await cp.pg.locator('.slide[data-id="sys-enter"] p').first().textContent()) === 'Signed by Will Anderson Jr.' && (await cp.pg.locator('.slide[data-id="sys-enter"] .go').textContent()) === 'Enter for Will Anderson Jr');
await cp.pg.locator('.slide[data-id="sys-enter"] .go').click(); await cp.pg.waitForTimeout(400);
t('the entry form is opened with the player as the term', /term=will-anderson-jr/.test(await cp.pg.locator('#player iframe').getAttribute('src')));
await cp.pg.keyboard.press('Escape'); await settle(cp.pg);
t('capture_open names the player', cp.ev.some((e) => e.event === 'capture_open' && e.params.pref_player === 'will-anderson-jr'));
await cp.ctx.close();
const cn = await open({ pid: `sess_${RUN}_capturenone`, knobs: { picker_position: -1, capture_card: { position: 1, headline: 'Win {{player}} gear', form: 'fan_preference_web' } } });
t('with no pick the placeholder reads Texans', (await cn.pg.locator('.slide[data-id="sys-enter"] h2').textContent()) === 'Win Texans gear');
await cn.ctx.close();

/* ---------- a like answers back ---------- */
const lk = await open({ pid: `sess_${RUN}_likelift` });
// Fresh fan: Stroud, TORO, picker, Anderson sack, Camp, Anderson mic'd. Scroll to the sack, like it.
await lk.pg.evaluate((id) => document.querySelector(`.slide[data-id="${id}"]`).scrollIntoView(), items[2].id); await lk.pg.waitForTimeout(700);
await lk.pg.locator(`.slide[data-id="${items[2].id}"] .like`).click(); await lk.pg.waitForTimeout(400);
let lo = await ids(lk.pg);
t('liking an Anderson card moves the other Anderson card up to next, ahead of Camp day', lo.indexOf(items[4].id) === lo.indexOf(items[2].id) + 1 && lo.indexOf(items[3].id) === lo.indexOf(items[4].id) + 1);
t('the cards already seen did not move', lo.slice(0, 4).join() === [items[0].id, items[1].id, 'sys-picker', items[2].id].join());
t('the lifted card says why', (await lk.pg.locator(`.slide[data-id="${items[4].id}"] .why`).textContent()) === 'Because you liked Will Anderson Jr');
t('a toast says so and offers to make it a pick', /Noted\. More Will Anderson Jr, coming up\./.test(await lk.pg.locator('#toast').textContent()) && (await lk.pg.locator('#toast .tact').textContent()) === 'Add to my picks');
t('the slides are re-indexed in the new order', await lk.pg.evaluate(() => [...document.querySelectorAll('.slide')].every((s, i) => Number(s.dataset.index) === i && s.getAttribute('aria-posinset') === String(i + 1))));
await lk.pg.locator('#toast .tact').click(); await lk.pg.waitForTimeout(900);
t('one tap makes the like a pick', (await j(`/api/feed?sid=sess_${RUN}_likelift`)).prefs.players.join() === 'will-anderson-jr');
await settle(lk.pg);
t('the lift and the save are reported', lk.ev.some((e) => e.event === 'like_lift' && e.params.pref_player === 'will-anderson-jr' && e.params.lifted_n === 1) && lk.ev.some((e) => e.event === 'prefs_save' && e.params.save_source === 'like'));
t('no page errors on the like', lk.errs.length === 0);
await lk.ctx.close();
const lk2 = await open({ pid: `sess_${RUN}_likenone` });
await lk2.pg.locator(`.slide[data-id="${items[0].id}"] .like`).click(); await lk2.pg.waitForTimeout(300);
t('liking a card with no other card about that player changes nothing and says nothing', (await ids(lk2.pg)).join() === [items[0].id, items[1].id, 'sys-picker', items[2].id, items[3].id, items[4].id].join() && await lk2.pg.locator('#toast').isHidden());
await lk2.ctx.close();

/* ---------- who the capture card is for ---------- */
const AUD = `sess_${RUN}_audience`;
await j('/api/prefs', { method: 'POST', body: JSON.stringify({ pocket_id: AUD, players: ['c-j-stroud'] }) });
const emailCard = { position: 1, headline: 'Your feed, in your inbox', blurb: '{{player}} clips before kickoff.', cta: 'Send me my feed', form: 'fan_preference_web', audience: 'prefs' };
const au = await open({ pid: AUD, knobs: { capture_card: emailCard } });
t('an audience of "prefs" shows the card to a fan who has set their feed, personalised', (await ids(au.pg))[1] === 'sys-enter' && (await au.pg.locator('.slide[data-id="sys-enter"] p').first().textContent()) === 'C J Stroud clips before kickoff.');
await au.ctx.close();
const an = await open({ pid: `sess_${RUN}_audiencenew`, knobs: { capture_card: emailCard } });
t('and not to a fan who has not: the ask comes after the payoff, never instead of it', !(await ids(an.pg)).includes('sys-enter') && (await ids(an.pg)).includes('sys-picker'));
await an.ctx.close();
const anew = await open({ pid: `sess_${RUN}_audiencenew2`, knobs: { picker_position: -1, capture_card: { ...emailCard, audience: 'new' } } });
t('an audience of "new" is the mirror image', (await ids(anew.pg))[1] === 'sys-enter');
await anew.ctx.close();

/* ---------- nobody to save for ---------- */
const anon = await b.newPage({ viewport: { width: 390, height: 780 } });
await anon.route(/a\.example\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
await anon.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
await anon.goto(`${B}/feed`, { waitUntil: 'networkidle' }); await anon.waitForTimeout(600);
t('with no id to save against (storage blocked, no host id) the picker is not offered', !(await ids(anon)).includes('sys-picker') && (await ids(anon)).length === 5);
await anon.close();

await b.close();
console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
