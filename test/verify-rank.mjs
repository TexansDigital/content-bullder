/**
 * Affinity ranking, pure. What a Stroud fan sees first, what an editor's order survives,
 * and when a thin profile is rightly ignored.
 */
import { rankFeed, affinity, freshness, RANKABLE_FROM, makePrefs, explain, displayName, assignArm, resolveExperiments, KNOB_DEFAULTS, LANES, offerHit } from '../src/rank.js';

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


/* ---------- explicit preferences: the picker's half ---------- */
const names = { 'c-j-stroud': 'c.j. stroud', 'will-anderson-jr': 'will anderson jr', 'tank-dell': 'tank dell' };
t('display names: initials and capitals come out right', displayName('c-j-stroud', names) === 'C.J. Stroud' && displayName('will-anderson-jr', names) === 'Will Anderson Jr' && displayName('ka-imi-fairbairn', {}) === 'Ka Imi Fairbairn');

const pr = makePrefs({ players: ['Will-Anderson-Jr', 'bogus slug!', 'c-j-stroud', 'tank-dell', 'nico-collins'], wants: ['fun', 'nope', 'fun'], format: 'read', follow: 'toro', boosts: ['draft-week', { key: 'bad key' }] });
t('prefs are coerced: three players at most, known lanes only, duplicates dropped', pr.players.join(',') === 'will-anderson-jr,c-j-stroud,tank-dell' && pr.wants.join(',') === 'fun' && pr.format === 'read' && pr.follow === 'toro' && pr.boosts.length === 1 && pr.explicit === true);
t('empty prefs are not explicit', makePrefs({}).explicit === false && makePrefs(null) === null && makePrefs('x') === null);

const picked = rankFeed(items, null, { now: NOW, prefs: makePrefs({ players: ['will-anderson-jr'] }), names });
t('a pick ranks with no profile at all', picked.ranked === true && picked.items[2].id === 'yt-anderson');
t('and the moved card says why, in the fan\'s words', picked.items[2].why?.kind === 'pick' && picked.items[2].why.label === 'Because you picked Will Anderson Jr');
t('cards the pick did not touch carry no reason', !picked.items.find((i) => i.id === 'yt-old-timely').why);

const both = rankFeed(items, stroudFan, { now: NOW, prefs: makePrefs({ players: ['will-anderson-jr'] }), names });
t('explicit beats implicit: the Anderson pick outranks the Stroud history', both.items[2].id === 'yt-anderson');
t('implicit history still labels its own cards', both.items.find((i) => i.id === 'yt-stroud-1').why?.kind === 'watch' && /Because you watch C\.J\. Stroud/.test(both.items.find((i) => i.id === 'yt-stroud-1').why.label));

const lane = rankFeed(items, null, { now: NOW, prefs: makePrefs({ wants: ['fun'] }), names });
t('a lane lifts its content types and explains itself', lane.items[2].id === 'yt-new-toro' && lane.items[2].why?.kind === 'lane' && lane.items[2].why.label === 'More fun & toro, as you asked');

const presets = { toro: { name: "TORO's picks", entity_weights: {}, content_type_weights: { mascot_skits: 1 } } };
const follow = rankFeed(items, null, { now: NOW, prefs: makePrefs({ follow: 'toro' }), presets, names });
t('following a preset ranks by its weights and names it', follow.items[2].id === 'yt-new-toro' && follow.items[2].why?.label === "TORO's picks");

const offers = { 'draft-week': { label: 'Draft news', content_types: ['calendar'], keywords: ['draft'], ends_at: new Date(NOW + 3 * 86400e3).toISOString() } };
const boosted = rankFeed(items, null, { now: NOW, prefs: makePrefs({ boosts: [{ key: 'draft-week', until: offers['draft-week'].ends_at }] }), offers, names });
t('a live boost lifts an old card to the front and shows its end date', boosted.items[2].id === 'yt-old-timely' && /^Draft news · until/.test(boosted.items[2].why?.label || ''));
const lapsed = rankFeed(items, null, { now: NOW + 10 * 86400e3, prefs: makePrefs({ boosts: [{ key: 'draft-week', until: offers['draft-week'].ends_at }] }), offers, names });
t('a lapsed boost does nothing', lapsed.ranked === true ? lapsed.items[2].id !== 'yt-old-timely' : true);
t('an unknown boost key is ignored', explain(items[8], { prefs: makePrefs({ boosts: ['nothing'] }), offers, now: NOW }).why === null);

/* ---------- what an offer lifts ---------- */
const colts = { key: 'colts-week', content_types: ['opponent_week'], keywords: ['colts', 'indianapolis', 'indy'] };
t('an offer matches the opponent a card is tagged with, whatever the headline says', offerHit({ headline: 'All Angles', entities: { opponent: 'colts' } }, colts));
t('and a whole word in the headline or caption', offerHit({ headline: 'Beat the Colts!', entities: {} }, colts) && offerHit({ headline: 'x', caption: 'Indy bound', entities: {} }, colts));
t('but not a fragment: "indy" is not "lindy"', !offerHit({ headline: 'prank war: lindy and jlo', entities: { opponent: 'giants' } }, colts));
t('and the content type', offerHit({ contentType: 'opponent_week', entities: {} }, colts) && !offerHit({ contentType: 'pranks', entities: {} }, colts));
t('a keyword with spaces matches a slugged opponent', offerHit({ entities: { opponent: 'los-angeles-chargers' } }, { keywords: ['Los Angeles Chargers'] }));

/* ---------- the two questions ---------- */
const ticket = cat('yt-tickets', [], null, 'calendar', 6, { action: { url: 'https://www.houstontexans.com/tickets', label: 'Get tickets' }, collection: 'gameday' });
const withTicket = [...items, ticket];
const going = rankFeed(withTicket, null, { now: NOW, prefs: makePrefs({ going: 'yes' }), names });
t('"going: yes" is explicit on its own and lifts the ticket card, saying why', going.ranked === true && going.items[2].id === 'yt-tickets' && going.items[2].why?.label === "Gameday, since you're going");
const notGoing = rankFeed(withTicket, null, { now: NOW, prefs: makePrefs({ going: 'no', players: ['c-j-stroud'] }), names });
t('"going: no" quietly spares the fan the ticket push: last, no reason', notGoing.items[notGoing.items.length - 1].id === 'yt-tickets' && !notGoing.items.find((i) => i.id === 'yt-tickets').why);
const maybe = rankFeed(withTicket, null, { now: NOW, prefs: makePrefs({ going: 'maybe' }), names });
t('"maybe" nudges the schedule card up with a softer reason', maybe.items[2].id === 'yt-tickets' && maybe.items[2].why?.label === 'Gameday, if you go');
const shortClip = cat('yt-short', [], null, 'trends', 4, { durationSeconds: 20 });
const longClip = cat('yt-long', [], null, 'trends', 4, { durationSeconds: 60 });
const onTheGo = rankFeed([items[0], shortClip, longClip], null, { now: NOW, prefs: makePrefs({ watch: 'go' }), names }).items.map((i) => i.id);
const atHome = rankFeed([items[0], shortClip, longClip], null, { now: NOW, prefs: makePrefs({ watch: 'home' }), names }).items.map((i) => i.id);
t('"on the go" puts the short clip first and "at home" the long one, with no pill either way', onTheGo[1] === 'yt-short' && atHome[1] === 'yt-long' && !rankFeed([items[0], shortClip, longClip], null, { now: NOW, prefs: makePrefs({ watch: 'go' }) }).items[1].why);
t('answers are coerced like everything else', makePrefs({ going: 'Yes' }).going === null && makePrefs({ going: 'maybe', watch: 'go' }).watch === 'go' && makePrefs({ watch: 'nrg' }).explicit === true);
t('a boost may carry a label', makePrefs({ boosts: [{ key: 'draft-week', label: ' Draft news ' }] }).boosts[0].label === 'Draft news');

/* ---------- the page's player ---------- */
const onPage = rankFeed(items, null, { now: NOW, focus: 'will-anderson-jr', names });
t('a player page ranks with no profile and no prefs: that player leads', onPage.ranked === true && onPage.focus === 'will-anderson-jr' && onPage.items[2].id === 'yt-anderson');
t('the reason is the name, because the fan is on that page', onPage.items[2].why?.kind === 'focus' && onPage.items[2].why.label === 'Will Anderson Jr');
const overPick = rankFeed(items, stroudFan, { now: NOW, focus: 'will-anderson-jr', prefs: makePrefs({ players: ['c-j-stroud'] }), names });
t('the page outranks the fan\'s own pick and their history', overPick.items[2].id === 'yt-anderson' && overPick.items[2].why?.kind === 'focus');
const untagged = rankFeed(items, null, { now: NOW, focus: 'nobody-here', names });
t('a focus nobody tagged changes nothing', untagged.ranked === false && untagged.items === items && untagged.focus === undefined);
const stroudPage = rankFeed(items, null, { now: NOW, focus: 'c-j-stroud', names }).items.map((i) => i.id);
t('on a player\'s page their cards run back to back; the variety rule stands aside for them', stroudPage.slice(2, 5).every((id) => id.startsWith('yt-stroud')));

/* ---------- experiments: deterministic arms, bounded knobs ---------- */
const exp = { key: 'picker_pos', arms: { control: 1, early: 1 }, knobs: { early: { picker_position: 0, not_a_knob: 1 } }, traffic: 1 };
const a1 = assignArm(exp, 'sess_1'); const a2 = assignArm(exp, 'sess_1');
t('the same visitor always lands in the same arm', a1 === a2 && ['control', 'early'].includes(a1));
const spread = {}; for (let i = 0; i < 2000; i++) { const a = assignArm(exp, `dv-${i}`); spread[a] = (spread[a] || 0) + 1; }
t(`two equal arms split roughly evenly (${spread.control}/${spread.early})`, Math.abs(spread.control - spread.early) < 200);
const half = { ...exp, traffic: 0.5 }; let inExp = 0; for (let i = 0; i < 2000; i++) if (assignArm(half, `dv-${i}`)) inExp++;
t(`traffic caps exposure (${inExp}/2000 at 50%)`, inExp > 850 && inExp < 1150);
t('no visitor id means no arm', assignArm(exp, '') === null && assignArm(exp, null) === null);
const res = resolveExperiments([exp, { key: 'bad key!', arms: { a: 1 } }, null], 'sess_x');
const arm = res.experiments.picker_pos;
t('resolution reports the arm and applies only known knobs', arm && (arm === 'early' ? res.knobs.picker_position === 0 : res.knobs.picker_position === KNOB_DEFAULTS.picker_position) && !('not_a_knob' in res.knobs) && !('bad key!' in res.experiments));
t('with nothing running the knobs are the defaults', JSON.stringify(resolveExperiments([], 'sess_x').knobs) === JSON.stringify(KNOB_DEFAULTS));
t('every lane has a name and at least one matcher', Object.values(LANES).every((l) => l.name && ((l.types || []).length || (l.collections || []).length || l.action)));

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); }
process.exit(bad.length ? 1 : 0);
