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

/** How a card leaves the screen. Set per card, because a promo and a clip want different pacing. */
export const ADVANCE = {
  AUTO: 'auto',      // hold for `seconds` (or until a video ends), then move on
  MANUAL: 'manual',  // stay until the viewer swipes
};

export const OVERLAY_SIZES = ['sm', 'md', 'lg', 'xl'];
export const OVERLAY_STYLES = ['plain', 'band', 'box'];
export const OVERLAY_COLORS = ['white', 'red', 'steel', 'blue'];

/**
 * A text or link block layered over the card, positioned as a percentage of the frame so it
 * holds its place at any size. `band` runs the full width and ignores x, the way the brand's
 * ticker strip does.
 */
export const SAFE_URL = /^(https?:\/\/|\/)/i;

/**
 * Block ids reach an HTML attribute in the studio canvas, and every other overlay field is
 * whitelisted or clamped — this one was not, so a client-supplied id could close the
 * attribute and add a handler. Ids are ours to generate; only our shape is accepted.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const newId = () => `ov-${Math.random().toString(36).slice(2, 8)}`;

export function makeOverlay(o = {}) {
  return {
    id: SAFE_ID.test(String(o.id ?? '')) ? String(o.id) : newId(),
    type: o.type === 'link' ? 'link' : 'text',
    text: String(o.text ?? '').slice(0, 220),
    // `javascript:` must never reach an href, and escaping does not stop a scheme.
    url: o.type === 'link'
      ? (o.url && SAFE_URL.test(String(o.url).trim()) ? String(o.url).trim() : (o.url ? '' : null))
      : null,
    x: clampPct(o.x, 50),
    y: clampPct(o.y, 50),
    align: ['left', 'center', 'right'].includes(o.align) ? o.align : 'center',
    size: OVERLAY_SIZES.includes(o.size) ? o.size : 'lg',
    style: OVERLAY_STYLES.includes(o.style) ? o.style : 'plain',
    color: OVERLAY_COLORS.includes(o.color) ? o.color : 'white',
  };
}
const clampPct = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback;
};

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

/**
 * A clip is a source plus two numbers, and those numbers are printed into an HTML attribute
 * on the public feed. They arrived unchecked, so a string could break out of the attribute.
 * Coerce here rather than escape at each sink: there is one model and many sinks.
 */
export function makeClip(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const start = Number(c.start);
  const end = Number(c.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const s = Math.max(0, start);
  if (!(end > s)) return null;
  const of = String(c.of ?? '').slice(0, 200);
  return { of, start: s, end, ...(c.playback === true ? { playback: true } : {}) };
}

const MAX_TEXT = 300;
const clean = (s, max = MAX_TEXT) =>
  (s == null ? null : String(s).trim().slice(0, max) || null);

/** A day is longer than any asset we will ever hold, and Infinity round-trips to null. */
const MAX_SECONDS = 86400;

export function makeItem(partial = {}) {
  const raw = Number(partial.durationSeconds);
  // `1e400` is Infinity: it produced an "Infinity:NaN" badge that persisted while the
  // numeric field serialised back to null, so a card disagreed with itself forever.
  const secs = Number.isFinite(raw) ? Math.min(MAX_SECONDS, Math.max(0, raw)) : 0;
  return {
    id: partial.id || `item-${Math.random().toString(36).slice(2, 10)}`,
    source: partial.source || 'manual',
    status: partial.status || STATUS.INBOX,
    collection: partial.collection || 'gameday',
    headline: clean(partial.headline, 140) || 'Untitled',
    caption: clean(partial.caption, 600),
    media: partial.media || { kind: 'none' },
    poster: Array.isArray(partial.poster) ? partial.poster.filter(Boolean) : [],
    durationSeconds: secs,
    duration: mmss(secs),
    publishedAt: partial.publishedAt || null,
    action: partial.action?.url && SAFE_URL.test(String(partial.action.url).trim())
      ? { label: clean(partial.action.label, 60) || 'Watch', url: String(partial.action.url).trim() }
      : null,
    sponsor: partial.sponsor || null,
    clip: makeClip(partial.clip),
    /**
     * `cover` fills the 9:16 frame and crops. `contain` letterboxes the graphic so there is
     * deliberate empty space above and below it for text to sit in — which is what "a text
     * block above or below the graphic" means in a fixed-aspect frame.
     */
    fit: partial.fit === 'contain' ? 'contain' : 'cover',
    // Coerce rather than trust: a malformed PATCH used to throw out of makeItem and surface
    // as a 500 with an internal message.
    overlays: (Array.isArray(partial.overlays) ? partial.overlays : [])
      .filter((o) => o && typeof o === 'object').slice(0, 24).map(makeOverlay),
    /**
     * The built-in headline / caption / action block. `auto` hides it once the card carries
     * its own overlays — if someone has composed the card, the default chrome competing with
     * it is a bug, not a feature.
     */
    chrome: ['auto', 'on', 'off'].includes(partial.chrome) ? partial.chrome : 'auto',
    advance: {
      mode: partial.advance?.mode === ADVANCE.MANUAL ? ADVANCE.MANUAL : ADVANCE.AUTO,
      seconds: Math.min(60, Math.max(2, Number(partial.advance?.seconds) || 6)),
    },
    links: Object.fromEntries(Object.entries(partial.links || {})
      .filter(([, u]) => typeof u === 'string' && SAFE_URL.test(u.trim()))),
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

export const mmss = (n) => {
  // Round first: rounding the seconds separately turned 59.6 into "0:60".
  const t = Math.round(Number(n) || 0);
  if (!(t > 0) || !Number.isFinite(t)) return '';
  const pad = (v) => String(v).padStart(2, '0');
  // An hour of presser used to read "60:00", and a day read "1439:59".
  return t >= 3600
    ? `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`
    : `${Math.floor(t / 60)}:${pad(t % 60)}`;
};

/** Problems worth blocking a publish on, and problems worth only flagging. */
export function validate(item) {
  const errors = [];
  const warnings = [];
  if (!item.headline || item.headline === 'Untitled') errors.push('needs a headline');
  if (!item.media || item.media.kind === 'none') errors.push('no playable media');
  if (!COLLECTIONS.some((c) => c.key === item.collection)) errors.push('unknown collection');
  // Optional chaining throughout: the store is a file someone can hand-edit, and an item
  // missing `flags` used to take /api/items down with a 500 while /api/feed served it.
  if (item.flags?.embeddable === false) errors.push('source forbids embedding');
  if (!item.poster?.length) warnings.push('no poster — will fall back to a generated frame');
  if (!item.flags?.hasCaptions) warnings.push('no caption track');
  if (item.durationSeconds > 180) warnings.push('over 3 min — clip it before publishing');
  if (!item.action && showsChrome(item)) warnings.push('no action button');
  for (const o of item.overlays || []) {
    if (!o.text.trim()) errors.push('an overlay has no text');
    if (o.type === 'link' && !o.url) errors.push(`overlay "${o.text.slice(0, 20)}" has no URL`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Whether the default headline block should render for this card. */
export const showsChrome = (item) =>
  item.chrome === 'on' || (item.chrome !== 'off' && !(item.overlays?.length));

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
