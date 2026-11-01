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
      .map((b) => ({ key: String(b.key), until: Number.isFinite(Date.parse(b.until || '')) ? new Date(b.until).toISOString() : null }))
      .slice(0, 8),
  };
  out.explicit = Boolean(out.players.length || out.wants.length || out.follow || out.boosts.length);
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
export function explain(item, { profile, prefs, presets = {}, offers = {}, names = {}, now = Date.now() }) {
  const reasons = [];
  const add = (score, kind, key, label) => { if (score > 0) reasons.push({ score, kind, key, label }); };
  const e = item.entities || {};
  const players = e.players || [];

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
      if (!L) continue;
      const hit = (L.types || []).includes(item.contentType)
        || (L.collections || []).includes(item.collection)
        || (L.action && Boolean(item.action?.url));
      if (hit) add(LANE, 'lane', lane, `More ${L.name.toLowerCase()}, as you asked`);
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
      const text = `${item.headline || ''}\n${item.caption || ''}`.toLowerCase();
      const hit = (offer.content_types || []).includes(item.contentType)
        || (offer.keywords || []).some((k) => k && text.includes(String(k).toLowerCase()));
      if (hit) add(BOOST, 'boost', b.key, Number.isFinite(until) ? `${offer.label} · until ${short(until)}` : offer.label);
    }
  }

  const score = reasons.reduce((s, r) => s + r.score, 0) + 0.35 * freshness(item, now);
  // Explicit reasons always win the label; a fan who picked a player should read that, not
  // "because you watch", even when their history says the same thing louder.
  const explicit = reasons.filter((r) => r.kind !== 'watch' && r.kind !== 'affinity').sort((a, b) => b.score - a.score)[0];
  const best = explicit || reasons.filter((r) => r.label).sort((a, b) => b.score - a.score)[0] || null;
  return { score, why: best ? { kind: best.kind, key: best.key, label: best.label } : null };
}

/**
 * Returns { items, ranked }. `ranked` is false when nothing is known about the watcher (or
 * what is known is too thin), in which case `items` is the input untouched, so callers can
 * report which order they served. When ranked, each reordered card that has a reason carries
 * it as `why: { kind, key, label }`.
 */
export function rankFeed(items, profile, { now = Date.now(), minEvents = MIN_EVENTS, prefs = null, presets = {}, offers = {}, names = {} } = {}) {
  if (!Array.isArray(items) || !items.length) return { items: items || [], ranked: false };
  const p = prefs && prefs.explicit !== undefined ? prefs : makePrefs(prefs);
  const implicit = profile && typeof profile === 'object' && (Number(profile.events) || 0) >= minEvents ? profile : null;
  if (!implicit && !p?.explicit) return { items, ranked: false };
  const fixed = items.filter((i) => (i.sortIndex ?? 0) < RANKABLE_FROM);
  const pool = items.filter((i) => (i.sortIndex ?? 0) >= RANKABLE_FROM);
  if (pool.length < 2) return { items, ranked: false };

  const scored = pool.map((i, n) => {
    const { score, why } = explain(i, { profile: implicit, prefs: p, presets, offers, names, now });
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
    if (l && n >= 2 && lead(out[n - 1]) === l && lead(out[n - 2]) === l) {
      const k = rest.findIndex((x) => lead(x) !== l);
      if (k !== -1) { out.push(rest.splice(k, 1)[0]); rest.unshift(cur); continue; }
    }
    out.push(cur);
  }
  return { items: [...fixed, ...out], ranked: true };
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
  /** A data-capture card: { position, headline, blurb, cta, form, campaign } or null. */
  capture_card: null,
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
