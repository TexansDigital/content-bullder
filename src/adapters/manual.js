import { makeItem } from '../content.js';

/**
 * The escape hatch, and the default. Anything a platform won't hand over — a TikTok, an
 * Instagram Reel, a file someone exported — enters here. Keeping this as a first-class
 * adapter rather than a special case is what stops the tool being YouTube-shaped.
 */
/** A pasted URL is a video, a graphic, or a link out — decide by extension. */
function mediaKind(url, durationSeconds) {
  if (/\.(m3u8|mp4|webm|mov)(\?|$)/i.test(url)) return { kind: 'file', url };
  if (/\.(jpg|jpeg|png|webp|avif|gif)(\?|$)/i.test(url))
    return { kind: 'image', url, holdSeconds: Number(durationSeconds) || 6 };
  return { kind: 'link', url };
}

export default {
  key: 'manual',
  label: 'Manual',
  needs: [],
  notes: 'Paste a URL and a headline. Covers anything no API will give us.',

  async fetch({ rows = [] }) {
    return rows.map((r, i) =>
      makeItem({
        id: r.id || `manual-${Date.now()}-${i}`,
        source: 'manual',
        collection: r.collection,
        headline: r.headline,
        caption: r.caption,
        media: r.url ? mediaKind(r.url, r.durationSeconds) : { kind: 'none' },
        poster: r.poster ? [r.poster] : [],
        durationSeconds: Number(r.durationSeconds) || 0,
        publishedAt: r.publishedAt || new Date().toISOString(),
        action: r.actionUrl ? { label: r.actionLabel || 'Watch', url: r.actionUrl } : null,
        links: r.originalUrl ? { original: r.originalUrl } : {},
        flags: { vertical: true },
      }));
  },
};
