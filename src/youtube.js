/**
 * YouTube Data API v3 → ContentItem.
 *
 * The API is the only source we have working access to today, and it is metadata-only:
 * it never returns the video file and its terms require playback in YouTube's own
 * embedded player. See docs/research/02-social-ingestion-constraints.md.
 */

/**
 * Both `videos.list` and `search.list` return HTML-escaped titles and descriptions
 * (`Q&amp;A`, `Montgomery&#39;s`). Decode before anything is rendered or matched against.
 */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(text) {
  return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

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
  [/foundation|community|charit|donat|volunteer|hospital|school visit/i, 'community'],
  [/texans radio/i, 'radio'],
  [/full q ?& ?a|address(es)? the media|press conference|presser|previews .* week/i, 'presser'],
  [/all angles|best plays|highlights|top plays/i, 'gameday'],
  [/mic'?d up|episode|ep\.? ?\d|behind the scenes|inside the/i, 'series'],
  [/signs|contract|draft|roster|welcome|introduc|training camp/i, 'players'],
];

export function guessCollection(title = '', description = '') {
  const hay = decodeEntities(`${title} ${description}`);
  for (const [re, key] of RULES) if (re.test(hay)) return key;
  return 'gameday';
}

/**
 * A live stream and the edited cut of the same session both get published. The `LIVE:`
 * prefix marks the raw stream; the `| Full Q&A` cut is the one worth surfacing.
 */
export const isLiveStreamDupe = (title) => /^\s*LIVE:/i.test(decodeEntities(title));

/**
 * `search.list` DOES NOT RETURN SHORTS. Verified 2026-09-19: a date-ordered search of the
 * Texans channel returned 21 long-form videos and zero of the ten known Shorts published in
 * the same window. It also truncates descriptions and omits duration and status entirely.
 *
 * Harvest the uploads playlist instead — `channels.list(part=contentDetails)` gives
 * `relatedPlaylists.uploads`, then `playlistItems.list` over it, then `videos.list` for the
 * full record. See tools/harvest-channel.mjs.
 */
export function normalizeSearch(response) {
  return (response?.items || [])
    .filter((i) => i.id?.kind === 'youtube#video')
    .map((i) => ({
      youtubeId: i.id.videoId,
      title: decodeEntities(i.snippet?.title),
      publishedAt: i.snippet?.publishedAt || null,
      collection: guessCollection(i.snippet?.title),
      liveDupe: isLiveStreamDupe(i.snippet?.title),
    }))
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

/** Normalize one `youtube#video` resource into our ContentItem shape. */
export function toContentItem(v) {
  const s = v.snippet || {};
  const c = v.contentDetails || {};
  const st = v.status || {};
  const secs = durationSeconds(c.duration);
  const desc = decodeEntities(cleanDescription(s.description));

  return {
    id: `yt-${v.id}`,
    media: null,
    mediaType: 'youtube',
    youtubeId: v.id,
    collection: guessCollection(s.title, desc),
    liveDupe: isLiveStreamDupe(s.title),
    headline: decodeEntities(s.title),
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
