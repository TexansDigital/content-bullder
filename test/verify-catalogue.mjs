/**
 * The catalogue adapter, through its fetch seam.
 *
 * The real tables are read with the publishable key under RLS, but this container cannot
 * reach supabase.co, so the adapter is exercised against the exact PostgREST shapes those
 * tables return. What is asserted is the mapping — the part that is ours to get wrong.
 */
import catalogue from '../src/adapters/catalogue.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

const VIDEOS = [
  { id: 'Tq3sz_Yf-Nk', title: 'Tank is BACK 🔥', description: 'Week 7 vs the Giants\nmore', published_at: '2026-10-20T18:00:00Z', duration_seconds: 18, thumbnail_url: 'https://i.ytimg.com/vi/Tq3sz_Yf-Nk/maxresdefault.jpg', lifetime_views: 48000 },
  { id: 'dwNx1tv_k24', title: 'before TORO was a HOFer', description: null, published_at: '2026-10-18T18:00:00Z', duration_seconds: 70, thumbnail_url: null, lifetime_views: 9000 },
  { id: 'zzz000untyp', title: 'Untyped one', description: '', published_at: '2026-10-17T18:00:00Z', duration_seconds: 20, thumbnail_url: null, lifetime_views: 100 },
];
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
    : path.startsWith('feed_video_entities') ? entities : null;
  if (body === null) return { ok: false, status: 404, json: async () => [] };
  return { ok: true, status: 200, json: async () => body };
};

const items = await catalogue.fetch({}, { fetch: mock() });
t(`every video becomes a card (${items.length})`, items.length === 3);
t('every request carries the publishable key as both apikey and bearer',
  calls.every((c) => c.opts.headers.apikey && c.opts.headers.authorization?.startsWith('Bearer ')));
t('videos are asked for as active Shorts, newest first',
  /creator_content_type=eq\.SHORTS/.test(calls[0].url) && /is_active=not\.is\.false/.test(calls[0].url)
  && /order=published_at\.desc/.test(calls[0].url));
t('the three label tables are batched over the same ids', calls.slice(1).every((c) => /video_id=in\.\(/.test(c.url)));

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
t('a missing entities table reads as untagged, not as a failure', before.length === 3 && before.every((i) => i.entities.players.length === 0));

const onlyGame = await catalogue.fetch({ contentType: 'game_action' }, { fetch: mock() });
t('contentType filter keeps only that type', onlyGame.length === 1 && onlyGame[0].id === 'yt-Tq3sz_Yf-Nk');
const tagged = await catalogue.fetch({ onlyTagged: true }, { fetch: mock() });
t('onlyTagged drops cards with no entities', tagged.length === 1);

let threw = null;
try { await catalogue.fetch({}, { fetch: async () => ({ ok: false, status: 500, json: async () => [] }) }); }
catch (e) { threw = e.message; }
t(`a 5xx is surfaced with the table name, not swallowed (${threw})`, /catalogue: videos 500/.test(threw || ''));

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
