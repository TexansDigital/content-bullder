import { makeItem } from '../content.js';

/**
 * The escape hatch, and the default. Anything a platform won't hand over — a TikTok, an
 * Instagram Reel, a file someone exported — enters here. Keeping this as a first-class
 * adapter rather than a special case is what stops the tool being YouTube-shaped.
 */
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
        media: r.url
          ? { kind: /\.(m3u8|mp4|webm)(\?|$)/i.test(r.url) ? 'file' : 'link', url: r.url }
          : { kind: 'none' },
        poster: r.poster ? [r.poster] : [],
        durationSeconds: Number(r.durationSeconds) || 0,
        publishedAt: r.publishedAt || new Date().toISOString(),
        action: r.actionUrl ? { label: r.actionLabel || 'Watch', url: r.actionUrl } : null,
        links: r.originalUrl ? { original: r.originalUrl } : {},
        flags: { vertical: true },
      }));
  },
};
