import { makeItem } from '../content.js';

/**
 * Files we upload directly — a graphic, a promo card, a still, or a video export.
 *
 * This is the path for content that was never on a platform at all: a ticket promo, a
 * sponsor card, an event announcement. The original brief asked for "4:5 or 9:16 promos",
 * and a promo is usually a designed graphic with a link, not a clip.
 *
 * Static cards hold for `durationSeconds` and then advance, the way a story does.
 */
export default {
  key: 'upload',
  label: 'Upload',
  needs: [],
  notes: 'Drop a graphic or a video. Add a headline and a link. No platform involved.',

  async fetch({ files = [] }) {
    return files.map((f, i) => {
      const isVideo = /^video\//.test(f.contentType || '') || /\.(mp4|webm|m3u8)$/i.test(f.url || '');
      return makeItem({
        // Keyed on the stored path, which is already unique per upload, so re-adding the
        // same file does not create a second card.
        id: f.id || `upload-${String(f.url || i).split('/').pop() || i}`.slice(0, 80),
        source: 'upload',
        collection: f.collection,
        headline: f.headline,
        caption: f.caption,
        media: isVideo
          ? { kind: 'file', url: f.url }
          : { kind: 'image', url: f.url, holdSeconds: Number(f.durationSeconds) || 6 },
        poster: [f.poster || f.url].filter(Boolean),
        durationSeconds: Number(f.durationSeconds) || (isVideo ? 0 : 6),
        publishedAt: f.publishedAt || new Date().toISOString(),
        action: f.actionUrl ? { label: f.actionLabel || 'Learn more', url: f.actionUrl } : null,
        links: f.originalUrl ? { original: f.originalUrl } : {},
        flags: { vertical: true, hasCaptions: false },
      });
    });
  },
};
