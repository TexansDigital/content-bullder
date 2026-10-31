/**
 * The catalogue adapter, through its fetch seam.
 *
 * The real tables are read with the publishable key under RLS, but this container cannot
 * reach supabase.co, so the adapter is exercised against the exact PostgREST shapes those
 * tables return. What is asserted is the mapping — the part that is ours to get wrong.
 */
import catalogue, { excludedMatchers } from '../src/adapters/catalogue.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

const VIDEOS = [
  { id: 'Tq3sz_Yf-Nk', title: 'Tank is BACK 🔥', description: 'Week 7 vs the Giants\nmore', published_at: '2026-10-20T18:00:00Z', duration_seconds: 18, thumbnail_url: 'https://i.ytimg.com/vi/Tq3sz_Yf-Nk/maxresdefault.jpg', lifetime_views: 48000 },
  { id: 'dwNx1tv_k24', title: 'before TORO was a HOFer', description: null, published_at: '2026-10-18T18:00:00Z', duration_seconds: 70, thumbnail_url: null, lifetime_views: 9000 },
  { id: 'zzz000untyp', title: 'Untyped one', description: '', published_at: '2026-10-17T18:00:00Z', duration_seconds: 20, thumbnail_url: null, lifetime_views: 100 },
  { id: 'ban000full', title: 'Deshaun Watson to Hopkins', description: '', published_at: '2026-10-16T18:00:00Z', duration_seconds: 20, thumbnail_url: null, lifetime_views: 100 },
  { id: 'ban000last', title: 'Mixon finds the end zone', description: '', published_at: '2026-10-15T18:00:00Z', duration_seconds: 20, thumbnail_url: null, lifetime_views: 100 },
  { id: 'ban000desc', title: 'Throwback Thursday', description: 'Week 3, 2024. Christian Kirk with the grab.', published_at: '2026-10-14T18:00:00Z', duration_seconds: 20, thumbnail_url: null, lifetime_views: 100 },
  { id: 'ok0000kirk', title: 'Kirk Cousins picked off', description: '', published_at: '2026-10-13T18:00:00Z', duration_seconds: 20, thumbnail_url: null, lifetime_views: 100 },
];
const EXCLUDED = [{ name: 'Deshaun Watson' }, { name: 'Christian Kirk' }, { name: 'Joe Mixon' }];
const TYPES = [{ video_id: 'Tq3sz_Yf-Nk', content_type: 'game_action' }, { video_id: 'dwNx1tv_k24', content_type: 'mascot_skits' }];
const LABELS = [{ video_id: 'Tq3sz_Yf-Nk', label: 'timely' }, { video_id: 'dwNx1tv_k24', label: 'evergreen' }];
const ENTS = [
  { video_id: 'Tq3sz_Yf-Nk', entity_type: 'player', entity_slug: 'tank-dell', confidence: 0.6 },
  { video_id: 'Tq3sz_Yf-Nk', entity_type: 'player', entity_slug: 'c-j-stroud', confidence: 1.0 },
  { video_id: 'Tq3sz_Yf-Nk', entity_type: 'opponent', entity_slug: 'giants', confidence: 0.7 },
];

const calls = [];
const mock = (entities = ENTS) => async (url, opts) => {
  calls.push({ url, opts });
  const path = url.split('/rest/v1/')[1];
  const body = path.startsWith('videos') ? VIDEOS
    : path.startsWith('short_content_types') ? TYPES
    : path.startsWith('short_labels') ? LABELS
    : path.startsWith('feed_video_entities') ? entities
    : path.startsWith('excluded_players') ? EXCLUDED : null;
  if (body === null) return { ok: false, status: 404, json: async () => [] };
  return { ok: true, status: 200, json: async () => body };
};

const items = await catalogue.fetch({}, { fetch: mock() });
t(`every clean video becomes a card (${items.length})`, items.length === 4);
t('a Short naming an excluded player in its title is dropped', !items.some((i) => i.id === 'yt-ban000full'));
t('a distinctive excluded surname alone is enough to drop it', !items.some((i) => i.id === 'yt-ban000last'));
t('an excluded name in the description also drops it', !items.some((i) => i.id === 'yt-ban000desc'));
t('a four-letter surname does not take an opponent QB with it', items.some((i) => i.id === 'yt-ok0000kirk'));
t('the denylist is asked for from excluded_players', calls.some((c) => /excluded_players\?select=name/.test(c.url)));
const m = excludedMatchers(['J.J. Watt', '', null, 'Joe Mixon']);
t('matchers normalise punctuation, skip empty names, and add a surname only at five letters',
  m.length === 3 && m[0].test('J.J. Watt returns') && m[0].test('jj watt') && !m[0].test('watts') && m[2].test("Mixon's day"));
t('every request carries the publishable key as both apikey and bearer',
  calls.every((c) => c.opts.headers.apikey && c.opts.headers.authorization?.startsWith('Bearer ')));
const vcall = calls.find((c) => /\/videos\?/.test(c.url));
t('videos are asked for as active Shorts, newest first',
  /creator_content_type=eq\.SHORTS/.test(vcall.url) && /is_active=not\.is\.false/.test(vcall.url)
  && /order=published_at\.desc/.test(vcall.url));
t('the three label tables are batched over the same ids', calls.filter((c) => !/^.*\/(videos|excluded_players)\?/.test(c.url)).every((c) => /video_id=in\.\(/.test(c.url)));
t('dropped videos are not looked up in the label tables', !calls.some((c) => /video_id=in\.\(.*ban000/.test(c.url)));

const tank = items.find((i) => i.id === 'yt-Tq3sz_Yf-Nk');
t('id is prefixed and stable', !!tank);
t('game_action maps to gameday', tank.collection === 'gameday');
t(`content type survives with its underscore (${tank.contentType})`, tank.contentType === 'game_action');
t('shelf life carried from short_labels', tank.shelfLife === 'timely');
t('players ordered by confidence, Stroud before Dell',
  JSON.stringify(tank.entities.players) === JSON.stringify(['c-j-stroud', 'tank-dell']));
t('opponent carried', tank.entities.opponent === 'giants');
t('caption is the first description line, not the whole thing', tank.caption === 'Week 7 vs the Giants');
t('media is a YouTube kind pointing at the Short', tank.media.kind === 'youtube' && /shorts\/Tq3sz_Yf-Nk/.test(tank.media.url));
t('poster leads with the catalogue thumbnail then the ytimg fallbacks',
  tank.poster[0].includes('maxresdefault') && tank.poster.length > 1);
t('views ride along as a flag', tank.flags.views === 48000);

const toro = items.find((i) => i.id === 'yt-dwNx1tv_k24');
t('an unmapped content type lands in Series', toro.collection === 'series');
t('evergreen label carried', toro.shelfLife === 'evergreen');
t('no entities is an empty shape, not undefined',
  Array.isArray(toro.entities.players) && toro.entities.players.length === 0 && toro.entities.opponent === null);
t('a null thumbnail still yields posters', toro.poster.length > 0);

const untyped = items.find((i) => i.id === 'yt-zzz000untyp');
t('an untyped video still becomes a card, in Series, with null type',
  untyped && untyped.collection === 'series' && untyped.contentType === null && untyped.shelfLife === null);

calls.length = 0;
const before = await catalogue.fetch({}, { fetch: async (url, o) => {
  if (url.includes('feed_video_entities')) return { ok: false, status: 404, json: async () => [] };
  return mock()(url, o);
} });
t('a missing entities table reads as untagged, not as a failure', before.length === 4 && before.every((i) => i.entities.players.length === 0));
const noList = await catalogue.fetch({}, { fetch: async (url, o) => {
  if (url.includes('excluded_players')) return { ok: false, status: 404, json: async () => [] };
  return mock()(url, o);
} });
t('no denylist table at all means nothing is dropped', noList.length === 7);
let listErr = null;
try { await catalogue.fetch({}, { fetch: async (url, o) => url.includes('excluded_players') ? { ok: false, status: 500, json: async () => [] } : mock()(url, o) }); }
catch (e) { listErr = e.message; }
t('a failing denylist read refuses to serve rather than leaking excluded players', /excluded_players 500/.test(listErr || ''));

const onlyGame = await catalogue.fetch({ contentType: 'game_action' }, { fetch: mock() });
t('contentType filter keeps only that type', onlyGame.length === 1 && onlyGame[0].id === 'yt-Tq3sz_Yf-Nk');
const tagged = await catalogue.fetch({ onlyTagged: true }, { fetch: mock() });
t('onlyTagged drops cards with no entities', tagged.length === 1);

let threw = null;
try { await catalogue.fetch({}, { fetch: async (url, o) => url.includes('/videos?') ? { ok: false, status: 500, json: async () => [] } : mock()(url, o) }); }
catch (e) { threw = e.message; }
t(`a 5xx is surfaced with the table name, not swallowed (${threw})`, /catalogue: videos 500/.test(threw || ''));

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
