/**
 * Affinity ranking: the feed reorders itself for the person watching.
 *
 * A profile is what feed_rollup_profiles produces nightly from feed_events: weights in
 * 0..1 keyed `player:c-j-stroud`, `opponent:colts`, `theme:touchdown`, plus content-type
 * weights keyed `game_action`, and the number of events behind them. This module is pure so
 * the Worker, the local server and the tests all rank the same way.
 *
 * Editorial order is never touched. Cards an editor published (sortIndex below RANKABLE_FROM)
 * keep their place at the top; only the catalogue tail behind them is reordered.
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
 * Returns { items, ranked }. `ranked` is false when the profile is missing or too thin, in
 * which case `items` is the input untouched, so callers can report which order they served.
 */
export function rankFeed(items, profile, { now = Date.now(), minEvents = MIN_EVENTS } = {}) {
  if (!Array.isArray(items) || !items.length) return { items: items || [], ranked: false };
  if (!profile || typeof profile !== 'object' || (Number(profile.events) || 0) < minEvents) return { items, ranked: false };
  const fixed = items.filter((i) => (i.sortIndex ?? 0) < RANKABLE_FROM);
  const pool = items.filter((i) => (i.sortIndex ?? 0) >= RANKABLE_FROM);
  if (pool.length < 2) return { items, ranked: false };

  const scored = pool.map((i, n) => ({ i, n, score: affinity(i, profile) + 0.35 * freshness(i, now) }));
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
