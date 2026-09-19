/**
 * YouTube Data API v3 → ContentItem.
 *
 * The API is the only source we have working access to today, and it is metadata-only:
 * it never returns the video file and its terms require playback in YouTube's own
 * embedded player. See docs/research/02-social-ingestion-constraints.md.
 */

/** ISO-8601 duration → seconds. Handles the PT#H#M#S shapes YouTube emits. */
export function durationSeconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d, h, mi, s] = m;
  return (+d || 0) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + Math.round(+s || 0);
}

export const mmss = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

/**
 * YouTube has no "is this a Short" flag. Vertical uploads under ~3 minutes are Shorts in
 * practice, and the API won't tell us the aspect ratio either — so duration is the only
 * signal available. Deliberately conservative.
 */
export const looksLikeShort = (secs) => secs > 0 && secs <= 180;

/** Poster candidates, best first. `oar` is the Shorts-native vertical frame and is not
 *  returned by the API — it exists for Shorts and 404s otherwise, so try it first and
 *  let the client fall back. */
export function posterCandidates(id) {
  return [
    `https://i.ytimg.com/vi/${id}/oardefault.jpg`,
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ];
}

/** YouTube boilerplate that carries no editorial meaning. */
const BOILERPLATE = [
  /^subscribe:\s*\S+$/i,
  /^tickets:\s*\S+$/i,
  /^https?:\/\/\S+$/i,
];

export function cleanDescription(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !BOILERPLATE.some((re) => re.test(l)))
    .join(' ')
    .trim();
}

/**
 * Best-effort collection guess. Titles are the only usable signal — descriptions are
 * boilerplate — so this is a starting point for an editor, not a verdict. Everything it
 * can't place lands in `gameday`, which is also the honest default for this channel.
 */
const RULES = [
  [/girls flag|youth football|flag football/i, 'flag'],
  [/foundation|community|charit|donat|volunteer|hospital|school/i, 'community'],
  [/press conference|presser|address(es)? the media|q ?& ?a|full interview|mic'?d up|all angles|episode|ep\.? ?\d/i, 'series'],
  [/signs|contract|draft|roster|welcome|introduc|camp|practice/i, 'players'],
];

export function guessCollection(title = '', description = '') {
  const hay = `${title} ${description}`;
  for (const [re, key] of RULES) if (re.test(hay)) return key;
  return 'gameday';
}

/** Normalize one `youtube#video` resource into our ContentItem shape. */
export function toContentItem(v) {
  const s = v.snippet || {};
  const c = v.contentDetails || {};
  const st = v.status || {};
  const secs = durationSeconds(c.duration);
  const desc = cleanDescription(s.description);

  return {
    id: `yt-${v.id}`,
    media: null,
    mediaType: 'youtube',
    youtubeId: v.id,
    collection: guessCollection(s.title, desc),
    headline: s.title || '',
    caption: desc || null,
    durationSeconds: secs,
    duration: mmss(secs),
    publishedAt: s.publishedAt || null,
    poster: posterCandidates(v.id),
    action: null,
    sources: { youtube: v.id, instagram: null, tiktok: null },
    sponsor: null,
    audioSource: 'unknown',
    flags: {
      isShort: looksLikeShort(secs),
      embeddable: st.embeddable !== false,
      public: st.privacyStatus === 'public',
      hasCaptions: c.caption === 'true' || c.caption === true,
      licensedContent: c.licensedContent === true,
    },
  };
}

/** Normalize a full `videos.list` response, newest first. */
export function normalize(response) {
  return (response?.items || [])
    .map(toContentItem)
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

/** Counts worth surfacing to an editor before anything is published. */
export function audit(items) {
  const by = (k) => items.reduce((a, i) => ((a[i[k]] = (a[i[k]] || 0) + 1), a), {});
  const d = items.map((i) => i.durationSeconds).sort((a, b) => a - b);
  return {
    total: items.length,
    byCollection: by('collection'),
    notEmbeddable: items.filter((i) => !i.flags.embeddable).map((i) => i.youtubeId),
    notPublic: items.filter((i) => !i.flags.public).map((i) => i.youtubeId),
    withoutCaptions: items.filter((i) => !i.flags.hasCaptions).length,
    licensedContent: items.filter((i) => i.flags.licensedContent).length,
    notShorts: items.filter((i) => !i.flags.isShort).map((i) => i.youtubeId),
    durationSeconds: d.length
      ? { min: d[0], median: d[d.length >> 1], max: d[d.length - 1] }
      : null,
  };
}
