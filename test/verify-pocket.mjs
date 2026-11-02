/**
 * The site's own stories, galleries, video pages and podcast as cards. Fixtures are four real
 * items from each feed, fetched 1 Nov 2026. Checks the parser against the quirks the RSS
 * reference documents (CDATA across lines, repeated and mis-cased tags, trailing spaces),
 * the card shape, players and opponents from tags, excluded names, and the mixing rule.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pocket, { parsePocket, pocketItems, opponentOf, classify, slugify, cardImage, fetchPocket, POCKET_FEEDS } from '../src/adapters/pocket.js';
import { excludedMatchers } from '../src/adapters/catalogue.js';
import { mixFormats, mixEvery, rankFeed, makePrefs, RANKABLE_FROM } from '../src/rank.js';
import { makeItem } from '../src/content.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (k) => readFileSync(join(here, 'fixtures', `pocket-${k}.xml`), 'utf8');
const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

/* ---------- parsing ---------- */
const news = parsePocket(fx('news'), 'news');
t('four news items parse with guid, title, link, image and tags', news.length === 4 && news.every((e) => e.guid && e.title && /^https:\/\/www\.houstontexans\.com\/news\//.test(e.url) && e.image && e.tags.length));
t('tags are slugs, deduplicated, trimmed', news.every((e) => e.tags.every((s) => /^[a-z0-9-]+$/.test(s))) && news.some((e) => e.tags.includes('homepage-cp')));
const vanderblog = news.find((e) => e.tags.includes('vanderblog'));
t('the VanderBlog item carries both game tag forms and the series tag', vanderblog && vanderblog.tags.includes('2026-reg7-giants') && vanderblog.tags.some((s) => /new-york-giants-at-houston-texans-2026-reg-7/.test(s)));
t('titles are decoded: no entities, no CDATA wrapper', news.every((e) => !/&amp;|CDATA/.test(e.title)));
let threw = false; try { parsePocket('   ', 'videos'); } catch { threw = true; }
t('an empty body is a failure, never "no news"', threw);
t('slugify follows the reference', slugify("Ka'imi Fairbairn") === 'kaimi-fairbairn' && slugify('2026 REG4 - Cowboys ') === '2026-reg4-cowboys' && slugify('DeMeco Ryans') === 'demeco-ryans');

/* ---------- opponent and classification ---------- */
t('the opponent comes from the long game tag', opponentOf(['Homepage CP', 'New York Giants at Houston Texans (2026-REG-7)', '2026 REG7 - Giants']) === 'giants');
t('an away game reads the other side', opponentOf(['Houston Texans at Los Angeles Chargers (2026-REG-9)']) === 'chargers');
t('the short form is the fallback, with the Video/Photo suffix stripped', opponentOf(['2026 REG4 - Cowboys ', 'x']) === 'cowboys' && opponentOf(['2026 REG7 - Giants - Video']) === 'giants');
t('no game tag, no opponent', opponentOf(['Transaction', 'Homepage CP']) === null);
const cls = (feed, labels) => classify({ feed, labels, tags: labels.map(slugify) });
t('press conferences are pressers about coaches', cls('videos', ['Nick Caserio', 'All Videos', 'press conference']).collection === 'presser' && cls('videos', ['press conference']).contentType === 'coaches');
t('transactions are front office', cls('news', ['Transaction', 'Homepage CP']).contentType === 'front_office');
t('a game-tagged story is gameday', cls('news', ['Homepage CP', 'vanderblog', 'New York Giants at Houston Texans (2026-REG-7)']).collection === 'gameday');
t('community and youth football land in their shelves', cls('news', ['Community']).collection === 'community' && cls('news', ['Girls Flag']).collection === 'flag');
t('the podcast is Texans Radio', cls('audio', ['Texans All-Access']).collection === 'radio');

/* ---------- cards ---------- */
const names = { 'c-j-stroud': 'c.j. stroud', 'nick-caserio-not-a-player': 'nobody' };
const all = ['news', 'galleries', 'videos', 'audio'].flatMap((k) => parsePocket(fx(k), k));
const banned = excludedMatchers(['DeMeco Ryans']);
const cards = pocketItems(all, { names, banned });
const kept = all.filter((e) => !banned.some((rx) => rx.test(`${e.title}\n${e.summary}\n${e.labels.join(', ')}`)));
t('every item becomes a card except those naming an excluded person', cards.length === kept.length && cards.length < all.length && !cards.some((c) => /ryans/i.test(c.headline)));
const vid = cards.find((c) => c.id.startsWith('pk-') && c.links.page.includes('/video/'));
t('a video page card: image, Watch action to the page, format video', vid && vid.media.kind === 'image' && vid.action.label === 'Watch' && vid.action.url === vid.links.page && vid.format === 'video');
const story = cards.find((c) => c.links.page.includes('/news/'));
t('a story card: Read action, format read, letterboxed image, chrome on, timely', story && story.action.label === 'Read' && story.format === 'read' && story.fit === 'contain' && story.chrome === 'on' && story.shelfLife === 'timely');
t('the image is resized through the same Cloudinary id', cards.every((c) => !c.media.url || /\/w_1080,c_limit,q_auto,f_auto\/texans\//.test(c.media.url)) && cardImage('https://static.clubs.nfl.com/image/upload/t_editorial_landscape_12_desktop/texans/abc.jpg') === 'https://static.clubs.nfl.com/image/upload/w_1080,c_limit,q_auto,f_auto/texans/abc.jpg');
t('a tag that names a dictionary player becomes that player', cards.some((c) => c.entities.players.includes('c-j-stroud')));
t('a tag that is not a player is not a player', !cards.some((c) => c.entities.players.includes('nick-caserio-not-a-player')));
t('the opponent rides on the game-tagged cards', cards.some((c) => c.entities.opponent === 'giants'));
t('the podcast card says Listen and is a listen', cards.filter((c) => c.format === 'listen').every((c) => c.action.label === 'Listen' && c.collection === 'radio') && cards.some((c) => c.format === 'listen'));
t('published dates are ISO', cards.every((c) => /^\d{4}-\d{2}-\d{2}T/.test(c.publishedAt || '')));
t('ids are stable on the guid', cards.every((c) => /^pk-[0-9a-f-]{36}$/.test(c.id)));
t('a card never points off the club site', cards.every((c) => /^https:\/\/www\.houstontexans\.com\//.test(c.action.url)));
t('max per feed is honoured', pocketItems(all, { max: 2 }).length === 8);

/* ---------- the adapter end to end, with a mocked fetch ---------- */
const mock = async (url) => {
  const k = Object.keys(POCKET_FEEDS).find((key) => POCKET_FEEDS[key].url === url);
  if (k === 'audio') return { ok: false, status: 500, text: async () => '' };
  if (k === 'galleries') return { ok: true, status: 200, text: async () => '' };
  return { ok: true, status: 200, text: async () => fx(k) };
};
const fetched = await fetchPocket({}, { fetch: mock });
t('a failing feed and an empty feed are warnings; the others still parse', fetched.entries.length === 8 && fetched.warnings.length === 2 && fetched.warnings.some((w) => /audio 500/.test(w)) && fetched.warnings.some((w) => /galleries returned an empty body/.test(w)));
const viaAdapter = await pocket.fetch({ names }, { fetch: mock });
t('the studio adapter returns cards', viaAdapter.length === 8 && viaAdapter.every((c) => c.source === 'pocket'));

/* ---------- mixing ---------- */
const V = (id) => makeItem({ id, sortIndex: RANKABLE_FROM, media: { kind: 'youtube', videoId: 'abcdefghijk' }, format: 'video', publishedAt: '2026-10-30T00:00:00Z' });
const R = (id) => makeItem({ id, sortIndex: RANKABLE_FROM, media: { kind: 'image', url: 'https://x/y.jpg' }, format: 'read', publishedAt: '2026-10-30T00:00:00Z' });
const E = makeItem({ id: 'promo', sortIndex: 0, format: 'read' });
const mixed = mixFormats([E, R('r1'), R('r2'), V('v1'), R('r3'), V('v2'), V('v3'), V('v4'), V('v5')], { every: 4 }).map((i) => i.id);
t('the opener is a clip, at most one read in every four, the rest wait their turn, the editorial card never moves', mixed[0] === 'promo' && mixed.slice(1).join() === 'v1,v2,v3,r1,v4,v5,r2,r3');
t('reads with nothing to wait for go at the end', mixFormats([R('a'), R('b'), R('c')], { every: 4 }).map((i) => i.id).join() === 'a,b,c');
t('the answer sets the spacing', mixEvery('both') === 3 && mixEvery('video') === 6 && mixEvery(null) === 4 && mixEvery('read') === 2);
t('every = 1 leaves the list alone', mixFormats([R('a'), V('b')], { every: 1 }).length === 2);

/* ---------- "Watch or read?" ranks ---------- */
const pool = [V('v1'), V('v2'), R('story'), V('v3')];
const both = rankFeed(pool, null, { prefs: makePrefs({ format: 'both' }) });
t('"mix in articles" is explicit on its own and lifts the story with a reason', both.ranked === true && both.items[0].id === 'story' && both.items[0].why?.label === 'A read, as you asked');
const video = rankFeed(pool, null, { prefs: makePrefs({ format: 'video', players: ['x'] }) });
t('"mostly video" drops the story, quietly', video.items[video.items.length - 1].id === 'story' && !video.items.find((i) => i.id === 'story').why);

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
