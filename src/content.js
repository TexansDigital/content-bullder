/**
 * The canonical content model. Every source normalizes into this shape, and everything
 * downstream — feed, studio, embed — only ever sees this. Adding a source means writing an
 * adapter, not touching the feed.
 */

export const COLLECTIONS = [
  { key: 'gameday',   name: 'Gameday' },
  { key: 'series',    name: 'Series' },
  { key: 'presser',   name: 'Pressers' },
  { key: 'players',   name: 'Players' },
  { key: 'radio',     name: 'Texans Radio' },
  { key: 'community', name: 'Community & Foundation' },
  { key: 'flag',      name: 'Girls Flag & Youth Football' },
];

export const STATUS = { INBOX: 'inbox', PUBLISHED: 'published', ARCHIVED: 'archived' };

/**
 * @typedef {object} ContentItem
 * @property {string}  id            Stable, source-prefixed. Our key, never theirs.
 * @property {string}  source        Adapter that produced it.
 * @property {string}  status        inbox | published | archived
 * @property {string}  collection
 * @property {string}  headline
 * @property {string|null} caption
 * @property {object}  media         { kind, ...adapter-specific }
 * @property {string[]} poster       Candidate poster URLs, best first.
 * @property {number}  durationSeconds
 * @property {string|null} publishedAt
 * @property {object|null} action    { label, url }
 * @property {object|null} sponsor   { name, label }
 * @property {object|null} clip      { of, start, end } when cut from a longer asset.
 * @property {object}  links         Outbound originals, by platform.
 * @property {object}  flags
 * @property {number}  sortIndex     Editorial order within a collection.
 */

const clean = (s) => (s == null ? null : String(s).trim() || null);

export function makeItem(partial = {}) {
  const secs = Number(partial.durationSeconds) || 0;
  return {
    id: partial.id || `item-${Math.random().toString(36).slice(2, 10)}`,
    source: partial.source || 'manual',
    status: partial.status || STATUS.INBOX,
    collection: partial.collection || 'gameday',
    headline: clean(partial.headline) || 'Untitled',
    caption: clean(partial.caption),
    media: partial.media || { kind: 'none' },
    poster: Array.isArray(partial.poster) ? partial.poster.filter(Boolean) : [],
    durationSeconds: secs,
    duration: mmss(secs),
    publishedAt: partial.publishedAt || null,
    action: partial.action || null,
    sponsor: partial.sponsor || null,
    clip: partial.clip || null,
    links: partial.links || {},
    flags: {
      vertical: partial.flags?.vertical ?? (secs > 0 && secs <= 180),
      embeddable: partial.flags?.embeddable ?? true,
      hasCaptions: partial.flags?.hasCaptions ?? false,
      duplicate: partial.flags?.duplicate ?? false,
      ...partial.flags,
    },
    sortIndex: Number.isFinite(partial.sortIndex) ? partial.sortIndex : 0,
  };
}

export const mmss = (n) =>
  n > 0 ? `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}` : '';

/** Problems worth blocking a publish on, and problems worth only flagging. */
export function validate(item) {
  const errors = [];
  const warnings = [];
  if (!item.headline || item.headline === 'Untitled') errors.push('needs a headline');
  if (!item.media || item.media.kind === 'none') errors.push('no playable media');
  if (!COLLECTIONS.some((c) => c.key === item.collection)) errors.push('unknown collection');
  if (item.flags.embeddable === false) errors.push('source forbids embedding');
  if (!item.poster.length) warnings.push('no poster — will fall back to a generated frame');
  if (!item.flags.hasCaptions) warnings.push('no caption track');
  if (item.durationSeconds > 180) warnings.push('over 3 min — clip it before publishing');
  if (!item.action) warnings.push('no action button');
  return { ok: errors.length === 0, errors, warnings };
}

/** Feed order: editorial index first, then newest. */
export function feedSort(a, b) {
  if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
  return String(b.publishedAt).localeCompare(String(a.publishedAt));
}

/** Collections that actually have published items — never render an empty shelf. */
export function liveCollections(items) {
  const counts = {};
  for (const i of items) {
    if (i.status === STATUS.PUBLISHED) counts[i.collection] = (counts[i.collection] || 0) + 1;
  }
  return COLLECTIONS.filter((c) => counts[c.key]).map((c) => ({ ...c, count: counts[c.key] }));
}
