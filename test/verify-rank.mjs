/**
 * Affinity ranking, pure. What a Stroud fan sees first, what an editor's order survives,
 * and when a thin profile is rightly ignored.
 */
import { rankFeed, affinity, freshness, RANKABLE_FROM } from '../src/rank.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const NOW = Date.parse('2026-10-31T12:00:00Z');
const day = (d) => new Date(NOW - d * 86400e3).toISOString();
const cat = (id, players, opp, ct, daysOld, extra = {}) => ({ id, sortIndex: RANKABLE_FROM, publishedAt: day(daysOld),
  entities: { players, opponent: opp, themes: [] }, contentType: ct, shelfLife: null, ...extra });

const items = [
  { id: 'promo-1', sortIndex: 0, publishedAt: day(30), entities: { players: [], opponent: null, themes: [] }, contentType: null },
  { id: 'promo-2', sortIndex: 1, publishedAt: day(1), entities: { players: ['c-j-stroud'], opponent: null, themes: [] }, contentType: null },
  cat('yt-new-toro', [], null, 'mascot_skits', 0),
  cat('yt-stroud-1', ['c-j-stroud'], 'colts', 'game_action', 2),
  cat('yt-stroud-2', ['c-j-stroud', 'nico-collins'], null, 'game_action', 5),
  cat('yt-stroud-3', ['c-j-stroud'], null, 'player_stories', 9),
  cat('yt-anderson', ['will-anderson-jr'], null, 'game_action', 3),
  cat('yt-old-evergreen', [], null, 'community', 200, { shelfLife: 'evergreen' }),
  cat('yt-old-timely', [], null, 'calendar', 200),
];
const stroudFan = { events: 12, entity_weights: { 'player:c-j-stroud': 1, 'opponent:colts': 0.5 }, content_type_weights: { game_action: 1 } };

const r = rankFeed(items, stroudFan, { now: NOW });
const ids = r.items.map((i) => i.id);
t('a real profile ranks', r.ranked === true);
t('editorial cards keep their place at the top, in order', ids[0] === 'promo-1' && ids[1] === 'promo-2');
t(`the Stroud fan sees a Stroud card first in the tail (${ids[2]})`, ids[2] === 'yt-stroud-1');
t('three Stroud cards are not served back to back', !ids.slice(2).some((_, n, a) => n >= 2 && [a[n], a[n - 1], a[n - 2]].every((x) => x.startsWith('yt-stroud'))));
t('every card is still present exactly once', ids.length === items.length && new Set(ids).size === ids.length);
t('an old evergreen card outranks an old timely one', ids.indexOf('yt-old-evergreen') < ids.indexOf('yt-old-timely'));
t('a brand-new card the fan has no affinity for still beats a stale one', ids.indexOf('yt-new-toro') < ids.indexOf('yt-old-timely'));

const thin = rankFeed(items, { events: 5, entity_weights: { 'player:will-anderson-jr': 1 } }, { now: NOW });
t('five card events is too thin: the shared order is returned untouched', thin.ranked === false && thin.items === items);
t('no profile: untouched', rankFeed(items, null).ranked === false && rankFeed(items, undefined).items === items);
t('garbage profile: untouched', rankFeed(items, 'x').ranked === false && rankFeed(items, { events: 'lots' }).ranked === false);
t('empty feed: empty, not a throw', rankFeed([], stroudFan).items.length === 0 && rankFeed(null, stroudFan).items.length === 0);
t('one catalogue card: nothing to rank', rankFeed([items[0], items[2]], stroudFan).ranked === false);

const andersonFan = { events: 6, entity_weights: { 'player:will-anderson-jr': 1 }, content_type_weights: {} };
t('a different fan gets a different first card', rankFeed(items, andersonFan, { now: NOW }).items[2].id === 'yt-anderson');

t('affinity sums player, opponent and type with their weights',
  Math.abs(affinity(items[3], stroudFan) - (1 + 0.6 * 0.5 + 0.5 * 1)) < 1e-9);
t('affinity of a card with no entities is zero', affinity(items[2], stroudFan) === 0.5 * 0 && affinity({ entities: {} }, stroudFan) === 0);
t('freshness halves every 14 days', Math.abs(freshness({ publishedAt: day(14) }, NOW) - 0.5) < 1e-9 && freshness({ publishedAt: day(0) }, NOW) === 1);
t('evergreen freshness is steady and unknown dates are low', freshness({ shelfLife: 'evergreen', publishedAt: day(900) }) === 0.6 && freshness({}) === 0.1);
t('ties keep newest-first order', (() => { const z = rankFeed([cat('a', [], null, null, 3), cat('b', [], null, null, 1), cat('c', [], null, null, 2)], { events: 9 }, { now: NOW }); return z.items.map((i) => i.id).join('') === 'bca'; })());

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
