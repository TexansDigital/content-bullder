/**
 * Affinity ranking: the feed reorders itself for the person watching.
 *
 * Two kinds of signal, one order:
 *
 *   implicit   a profile feed_rollup_profiles produces nightly from feed_events: weights in
 *              0..1 keyed `player:c-j-stroud`, `opponent:colts`, `theme:touchdown`, plus
 *              content-type weights keyed `game_action`, and the number of card events
 *              behind them. Noise until MIN_EVENTS; then "because you watch".
 *
 *   explicit   what the fan told us in the picker: up to three players, the lanes they want
 *              more of, a preset they follow (TORO's picks), and time-boxed boosts ("draft
 *              news until 24 Apr"). Explicit beats implicit, applies from the first card, and
 *              every card it moves carries a reason the fan can read. That reason is the
 *              product: sharing a preference has to visibly change what comes next.
 *
 * Editorial order is never touched. Cards an editor published (sortIndex below RANKABLE_FROM)
 * keep their place at the top; only the catalogue tail behind them is reordered. This module
 * is pure so the Worker, the local server and the tests all rank the same way.
 */

/** Catalogue cards sit at this sortIndex; anything below it is an editorial decision. */
export const RANKABLE_FROM = 1_000_000;
/**
 * Fewer card events than this and the profile is noise; the shared order is better. Card
 * events are the ones that name a video (view, complete, play, like...), which is what
 * feed_rollup_profiles counts. Three was too few: a visitor who saw one card and left had a
 * profile of one player and a "personal" feed that was that player ten times over. Six is
 * roughly three cards watched through.
 */
export const MIN_EVENTS = 6;
/** How many players a fan may pick. Three is a favourite, not a roster. */
export const MAX_PICKS = 3;
export const FORMATS = ['video', 'read', 'both'];

/**
 * The lanes a fan can ask for more of, each a bundle of the catalogue's content types (and,
 * for the two the catalogue does not type, a collection or the presence of a ticket action).
 * Named in the fan's words, not the taxonomy's.
 */
export const LANES = {
  game_action: { name: 'Game action', types: ['game_action', 'opponent_week', 'hype_brand'] },
  inside: { name: "Mic'd up & inside", types: ['player_stories', 'coaches', 'front_office', 'workout_camp', 'offseason_camp', 'draft_roster'] },
  fun: { name: 'Fun & TORO', types: ['fun_trends', 'pranks', 'player_pranks', 'mascot_skits', 'mascot', 'trends', 'challenges'] },
  community: { name: 'Community', types: ['community', 'calendar'], collections: ['community', 'flag'] },
  gameday: { name: 'Gameday & tickets', collections: ['gameday'], action: true },
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Coerce whatever arrived as preferences into the one shape ranking understands. Anything
 * malformed is dropped, never thrown: a bad row in feed_preferences must not take the feed
 * down for its owner.
 */
export function makePrefs(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const list = (v, test, max) => (Array.isArray(v) ? v : []).map((x) => String(x ?? '').toLowerCase().trim())
    .filter((x, i, a) => test(x) && a.indexOf(x) === i).slice(0, max);
  const out = {
    players: list(p.players, (x) => SLUG.test(x), MAX_PICKS),
    wants: list(p.wants, (x) => Object.hasOwn(LANES, x), Object.keys(LANES).length),
    format: FORMATS.includes(p.format) ? p.format : null,
    follow: SLUG.test(String(p.follow ?? '')) ? String(p.follow) : null,
    boosts: (Array.isArray(p.boosts) ? p.boosts : []).map((b) => (typeof b === 'string' ? { key: b } : b))
      .filter((b) => b && typeof b === 'object' && KEY.test(String(b.key ?? '')))
      .map((b) => ({ key: String(b.key), until: Number.isFinite(Date.parse(b.until || '')) ? new Date(b.until).toISOString() : null,
        ...(typeof b.label === 'string' && b.label.trim() ? { label: b.label.trim().slice(0, 60) } : {}) }))
      .slice(0, 8),
    going: GOING.includes(p.going) ? p.going : null,
    watch: WATCH.includes(p.watch) ? p.watch : null,
  };
  // Any answer at all makes the feed explicit, the format answer included: "mostly video" is a
  // choice about stories, not a default.
  out.explicit = Boolean(out.players.length || out.wants.length || out.follow || out.boosts.length || out.going || out.watch || out.format);
  return out;
}

export function affinity(item, profile) {
  const ew = profile?.entity_weights || {};
  const cw = profile?.content_type_weights || {};
  const e = item.entities || {};
  let s = 0;
  for (const p of e.players || []) s += ew[`player:${p}`] || 0;
  if (e.opponent) s += 0.6 * (ew[`opponent:${e.opponent}`] || 0);
  for (const t of e.themes || []) s += 0.4 * (ew[`theme:${t}`] || 0);
  if (item.contentType) s += 0.5 * (cw[item.contentType] || 0);
  return s;
}

/** 1 for a card published now, halving every 14 days. Evergreen holds a steady 0.6. */
export function freshness(item, now = Date.now()) {
  if (item.shelfLife === 'evergreen') return 0.6;
  const t = Date.parse(item.publishedAt || '');
  if (!Number.isFinite(t)) return 0.1;
  const days = Math.max(0, (now - t) / 86400e3);
  return Math.pow(0.5, days / 14);
}

const lead = (item) => item.entities?.players?.[0] || null;

/**
 * What an explicit signal is worth. A pick beats the strongest history; a boost beats a pick
 * for as long as it runs, because "elevate draft news until the 24th" is a promise with a
 * date on it; a lane is a nudge, strong enough to reorder equals.
 */
export const PICK = 2.0;
export const BOOST = 2.5;
export const LANE = 0.8;
/** "Going to a game?" Yes lifts gameday and ticket cards and says so; No quietly spares the fan
 *  every ticket push; Maybe nudges the schedule and gameday cards. */
export const GOING = ['yes', 'maybe', 'no'];
export const GOING_LIFT = 0.8;
export const GOING_SPARE = -1.0;
/** "How do you watch?" At Reliant Stadium, at home, on the go. Shapes pacing, quietly: no reason pill,
 *  a small nudge on clip length. The stadium is Reliant Stadium. */
export const WATCH = ['stadium', 'home', 'go'];
export const WATCH_NUDGE = 0.3;
/** "Watch or read?" A fan who asked for a mix lifts stories and podcasts a little; one who said
 *  mostly video drops them a little. Unanswered, the mixing rule alone decides. */
export const FORMAT_NUDGE = 0.6;
/** Fewer views than this in a week and there is no "your week" to show. */
export const WEEK_MIN_VIEWS = 5;
/** Short, human names for the catalogue's content types, for the weekly card. */
export const TYPE_NAMES = {
  game_action: 'game action', fun_trends: 'fun', hype_brand: 'hype', player_stories: 'player stories', offseason_camp: 'camp',
  pranks: 'pranks', draft_roster: 'draft & roster', coaches: 'coaches', mascot_skits: 'TORO skits', trends: 'trends',
  opponent_week: 'opponent week', challenges: 'challenges', calendar: 'schedule', player_pranks: 'player pranks', mascot: 'TORO',
  workout_camp: 'workouts', front_office: 'front office', community: 'community',
};
/**
 * Does this card belong to an offer? By content type, by the opponent it is tagged with (an
 * offer keyword "Chargers" matches a card tagged opponent "chargers"), or by a whole word in
 * the headline or caption. Whole words, because "indy" must not match "lindy".
 */
export function offerHit(item, offer) {
  if (!item || !offer) return false;
  if ((offer.content_types || []).includes(item.contentType)) return true;
  const words = (offer.keywords || []).map((k) => String(k || '').toLowerCase().trim()).filter(Boolean);
  if (!words.length) return false;
  const opp = String(item.entities?.opponent || '').toLowerCase();
  if (opp && words.some((k) => k.replace(/[^a-z0-9]+/g, '-') === opp || k === opp)) return true;
  const text = `${item.headline || ''}\n${item.caption || ''}`.toLowerCase();
  return words.some((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text));
}

/** Does this card belong to a lane: by content type, by collection, or by carrying an action link. */
export const laneHit = (item, lane) => Boolean(lane && ((lane.types || []).includes(item.contentType)
  || (lane.collections || []).includes(item.collection) || (lane.action && item.action?.url)));
/** The lanes that have at least one card to move: an empty lane is never offered. */
export const lanesWithCards = (items) => Object.entries(LANES)
  .filter(([, l]) => (items || []).some((i) => laneHit(i, l)))
  .map(([key, l]) => ({ key, name: l.name }));

/** The lane a content type belongs to, for "want more of this?" */
export const laneOf = (type) => Object.entries(LANES).find(([, l]) => (l.types || []).includes(type))?.[0] || null;
/** The player whose page the feed is framed on. The page is the intent: it outranks a pick
 *  plus the strongest history (2.0 + 2.1 + 0.35), so their cards lead on their own page. */
export const FOCUS = 5.0;

/** "c.j. stroud" → "C.J. Stroud"; falls back to the slug spelled out. */
export function displayName(slug, names = {}) {
  const raw = names[slug] || String(slug || '').replace(/-/g, ' ');
  return raw.replace(/(^|[\s.'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

const short = (iso) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }) : '';
};

/**
 * Score one card against everything known about the fan, and say which signal mattered
 * most. Returns { score, why } where why is { kind, key, label } or null.
 */
export function explain(item, { profile, prefs, presets = {}, offers = {}, names = {}, focus = null, now = Date.now() }) {
  const reasons = [];
  const add = (score, kind, key, label) => { if (score > 0) reasons.push({ score, kind, key, label }); };
  const e = item.entities || {};
  const players = e.players || [];

  // The page the feed sits on: a roster page for one player lifts that player's cards above
  // everything, including the fan's own picks. The label is the name, because the fan is
  // already on that page and knows why.
  if (focus && players.includes(focus)) add(FOCUS, 'focus', focus, displayName(focus, names));

  // Implicit: the strongest single entity the fan has watched, plus the rest as a tail.
  if (profile) {
    const ew = profile.entity_weights || {};
    let top = null;
    for (const p of players) {
      const w = ew[`player:${p}`] || 0;
      if (w > (top?.w || 0)) top = { p, w };
    }
    const total = affinity(item, profile);
    if (top && top.w >= 0.25) add(total, 'watch', top.p, `Because you watch ${displayName(top.p, names)}`);
    else if (total > 0) add(total, 'affinity', null, null);
  }

  if (prefs?.explicit) {
    // A pick outweighs any history: 2.0 is more than the strongest implicit match can reach
    // for a card the fan did not ask for (player 1 + opponent 0.6 + type 0.5 - freshness).
    const picked = players.find((p) => prefs.players.includes(p));
    if (picked) add(PICK, 'pick', picked, `Because you picked ${displayName(picked, names)}`);

    for (const lane of prefs.wants) {
      const L = LANES[lane];
      if (L && laneHit(item, L)) add(LANE, 'lane', lane, `More ${L.name.toLowerCase()}, as you asked`);
    }

    const preset = prefs.follow ? presets[prefs.follow] : null;
    if (preset) {
      const s = 0.8 * affinity(item, preset);
      if (s > 0) add(s, 'follow', prefs.follow, preset.name || displayName(prefs.follow, names));
    }

    for (const b of prefs.boosts) {
      const offer = offers[b.key];
      if (!offer) continue;
      const until = Date.parse(b.until || offer.ends_at || '');
      if (Number.isFinite(until) && until <= now) continue;
      if (offerHit(item, offer)) add(BOOST, 'boost', b.key, Number.isFinite(until) ? `${offer.label} · until ${short(until)}` : offer.label);
    }
  }

  // The two quiet questions. "Going" has a voice (it reorders visibly and says why, or spares
  // the fan ticket pushes without a word); "watch" only tilts ties by clip length.
  let quiet = 0;
  if (prefs?.explicit) {
    const G = LANES.gameday || {};
    const gameday = (G.types || []).includes(item.contentType) || (G.collections || []).includes(item.collection);
    const ticket = Boolean(item.action?.url);
    if (prefs.going === 'yes' && (gameday || ticket)) add(GOING_LIFT, 'going', 'yes', "Gameday, since you're going");
    else if (prefs.going === 'maybe' && (gameday || item.contentType === 'calendar')) add(GOING_LIFT * 0.6, 'going', 'maybe', 'Gameday, if you go');
    else if (prefs.going === 'no' && ticket) quiet += GOING_SPARE;
    const secs = Number(item.durationSeconds) || 0;
    const reads = item.format === 'read' || item.format === 'listen';
    if (prefs.format === 'both' && reads) add(FORMAT_NUDGE, 'format', 'both', 'A read, as you asked');
    if (prefs.format === 'read' && reads) add(FORMAT_NUDGE * 1.5, 'format', 'read', 'A read, as you asked');
    if (prefs.format === 'video' && reads) quiet -= FORMAT_NUDGE;
    if (prefs.watch === 'go' && secs > 0 && secs <= 30) quiet += WATCH_NUDGE;
    if (prefs.watch === 'home' && secs >= 45) quiet += WATCH_NUDGE;
    if (prefs.watch === 'stadium' && gameday) quiet += WATCH_NUDGE;
  }
  const score = reasons.reduce((s, r) => s + r.score, 0) + quiet + 0.35 * freshness(item, now);
  // Explicit reasons always win the label; a fan who picked a player should read that, not
  // "because you watch", even when their history says the same thing louder.
  const explicit = reasons.filter((r) => r.kind !== 'watch' && r.kind !== 'affinity').sort((a, b) => b.score - a.score)[0];
  const best = explicit || reasons.filter((r) => r.label).sort((a, b) => b.score - a.score)[0] || null;
  return { score, why: best ? { kind: best.kind, key: best.key, label: best.label } : null };
}

/**
 * Returns { items, ranked, focus }. `ranked` is false when nothing is known about the watcher
 * (or what is known is too thin), in which case `items` is the input untouched, so callers can
 * report which order they served. When ranked, each reordered card that has a reason carries
 * it as `why: { kind, key, label }`. `focus` is the player slug that applied, or null.
 */
export function rankFeed(items, profile, { now = Date.now(), minEvents = MIN_EVENTS, prefs = null, presets = {}, offers = {}, names = {}, focus = null } = {}) {
  if (!Array.isArray(items) || !items.length) return { items: items || [], ranked: false };
  const p = prefs && prefs.explicit !== undefined ? prefs : makePrefs(prefs);
  const implicit = profile && typeof profile === 'object' && (Number(profile.events) || 0) >= minEvents ? profile : null;
  // A focus only counts when some card carries that player; otherwise it is a slug nobody
  // tagged and the shared order stands.
  const f = focus && items.some((i) => (i.entities?.players || []).includes(focus)) ? focus : null;
  if (!implicit && !p?.explicit && !f) return { items, ranked: false };
  const fixed = items.filter((i) => (i.sortIndex ?? 0) < RANKABLE_FROM);
  const pool = items.filter((i) => (i.sortIndex ?? 0) >= RANKABLE_FROM);
  if (pool.length < 2) return { items, ranked: false };

  const scored = pool.map((i, n) => {
    const { score, why } = explain(i, { profile: implicit, prefs: p, presets, offers, names, focus: f, now });
    return { i: why ? { ...i, why } : i, n, score };
  });
  // Stable: ties keep the shared (newest-first) order.
  scored.sort((a, b) => b.score - a.score || a.n - b.n);

  // Variety: never three cards in a row led by the same player. The third is pushed back
  // behind the next card with a different lead; if none exists it stays.
  const out = [];
  const rest = scored.map((s) => s.i);
  while (rest.length) {
    const cur = rest.shift();
    const l = lead(cur);
    const n = out.length;
    // The focus player is exempt: on their own page, their cards run as long as they last.
    if (l && l !== f && n >= 2 && lead(out[n - 1]) === l && lead(out[n - 2]) === l) {
      const k = rest.findIndex((x) => lead(x) !== l);
      if (k !== -1) { out.push(rest.splice(k, 1)[0]); rest.unshift(cur); continue; }
    }
    out.push(cur);
  }
  return { items: [...fixed, ...out], ranked: true, focus: f };
}

/**
 * Stories and podcasts never crowd the clips: at most one non-video card in every `every`
 * cards, in whatever order the list arrived. A read card that would land too soon waits for
 * the next slot; anything left over goes at the end. Editorial cards (before RANKABLE_FROM)
 * are never moved. `every` comes from the fan's answer: a mix every 3, mostly video every 6,
 * unanswered every 4. The first card is always a clip.
 */
export function mixFormats(items, { every = 4 } = {}) {
  if (!Array.isArray(items) || every <= 1) return items || [];
  const fixed = items.filter((i) => (i.sortIndex ?? 0) < RANKABLE_FROM);
  const pool = items.filter((i) => (i.sortIndex ?? 0) >= RANKABLE_FROM);
  const isRead = (i) => i.format === 'read' || i.format === 'listen';
  const out = [];
  const waiting = [];
  // Starts at zero, so the opener is always a clip and the first read waits its turn.
  let sinceRead = 0;
  for (const i of pool) {
    if (isRead(i)) {
      if (sinceRead >= every - 1) { out.push(i); sinceRead = 0; } else waiting.push(i);
      continue;
    }
    out.push(i); sinceRead++;
    if (waiting.length && sinceRead >= every - 1) { out.push(waiting.shift()); sinceRead = 0; }
  }
  return [...fixed, ...out, ...waiting];
}
export const mixEvery = (format) => (format === 'both' ? 3 : format === 'read' ? 2 : format === 'video' ? 6 : 4);

/** "Tank is BACK 🔥" and "Tank is BACK 🙌" are the same title to a fan: letters and digits only. */
export const titleKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/**
 * Two cards with the same title back to back read as a repeat, whatever the ids say. The first
 * occurrence keeps its place; later ones go to the end of the pool, where they still exist for
 * a fan who gets that far. Editorial cards never move.
 */
export function dedupeTitles(items) {
  if (!Array.isArray(items)) return items || [];
  const fixed = items.filter((i) => (i.sortIndex ?? 0) < RANKABLE_FROM);
  const pool = items.filter((i) => (i.sortIndex ?? 0) >= RANKABLE_FROM);
  const seen = new Set(), keep = [], later = [];
  for (const i of pool) {
    const k = titleKey(i.headline);
    if (k && seen.has(k)) later.push(i); else { seen.add(k); keep.push(i); }
  }
  return [...fixed, ...keep, ...later];
}

/* ---------- experiments ----------
 * A visitor lands in one arm of each running experiment by hashing their id with the key, so
 * the same person sees the same feed on every visit and nothing is stored to make that so.
 * Arms carry knob values; knobs are the only thing the feed page reads. Anything not in
 * KNOB_DEFAULTS is dropped on the floor, so an experiment can never reach past the dial it
 * was given.
 */
export const KNOB_DEFAULTS = {
  /** Where the "your feed" picker card appears (0-based position among the cards); -1 hides it. */
  picker_position: 2,
  /** Days before a fan who tapped "not now" is offered the picker again. */
  picker_reoffer_days: 7,
  /** Which reasons appear on cards: explicit (picks, lanes, follows, boosts), all (also "because you watch"), off. */
  reason_pills: 'explicit',
  /** Nudge once per session when the first video starts muted. */
  sound_hint: false,
  /** A data-capture card: { position, headline, blurb, cta, form, campaign, audience } or null. {{player}} in
   *  the headline, blurb or cta becomes the fan's first pick (or the page's player); audience is 'all',
   *  'prefs' (only fans who have set their feed) or 'new' (only fans who have not). */
  capture_card: null,
  /** Where a live boost offer is shown to a fan who already has preferences; -1 hides it. */
  offer_position: 2,
  /** Where "X week is over, back to your picks" appears after a boost lapses; -1 hides it. */
  expiry_position: 1,
  /** Where the weekly "your week" card appears; -1 hides it. */
  week_position: 4,
  /** Where one follow-up question (more of, going, how you watch) is asked of a fan who has set
   *  their feed but not answered it yet; one per visit; -1 asks nothing. */
  ask_position: 7,
  /** Rail layout only: how many lead tiles play a muted preview instead of a still (0 to 3). The
   *  strip is seen and scrolled past; a moving first tile is the invitation to tap. 0 is off. */
  rail_preview: 0,
  /** A fan the handshake recognised (Eloqua visitor GUID) opens on a "Welcome!" card carrying the
   *  picks they saved in any earlier session, or the player they watch most. 0 off, 1 on. */
  welcome_card: 0,
  /** How the first pick is asked for: 'card' (the picker card at picker_position) or 'chip' (one
   *  tap on the card after a completed clip: "More Tank Dell"; the picker card then only appears
   *  when the fan opens it from the Your feed chip). */
  pick_prompt: 'card',
};

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Deterministic: the same visitor and experiment always give the same arm. */
export function assignArm(exp, who) {
  if (!exp || !who || !exp.arms || typeof exp.arms !== 'object') return null;
  const u = fnv1a(`${exp.key}|${who}`) / 2 ** 32;
  const traffic = Number(exp.traffic);
  if (Number.isFinite(traffic) && u >= traffic) return null;
  const arms = Object.entries(exp.arms).filter(([, w]) => Number(w) > 0);
  const total = arms.reduce((s, [, w]) => s + Number(w), 0);
  if (!arms.length || !(total > 0)) return null;
  let v = (fnv1a(`arm|${exp.key}|${who}`) / 2 ** 32) * total;
  for (const [arm, w] of arms) { v -= Number(w); if (v < 0) return arm; }
  return arms[arms.length - 1][0];
}

/** Every running experiment resolved for one visitor: { experiments: {key: arm}, knobs }. */
export function resolveExperiments(list, who) {
  const knobs = { ...KNOB_DEFAULTS };
  const experiments = {};
  for (const exp of Array.isArray(list) ? list : []) {
    if (!exp || !KEY.test(String(exp.key ?? ''))) continue;
    const arm = assignArm(exp, who);
    if (!arm) continue;
    experiments[exp.key] = arm;
    const set = exp.knobs?.[arm];
    if (set && typeof set === 'object') {
      for (const [k, v] of Object.entries(set)) if (Object.hasOwn(KNOB_DEFAULTS, k)) knobs[k] = v;
    }
  }
  return { experiments, knobs };
}
