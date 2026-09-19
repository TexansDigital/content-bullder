import { makeItem } from '../content.js';
import { builder, publicId, originOf } from '../cloudinary.js';

/**
 * Assets we control, addressed by public ID. This is the only source that plays in our own
 * player at our own aspect ratio, and the only one that can be clipped — `so_`/`eo_` trim
 * plus `g_auto` reframe, expressed entirely in the delivery URL.
 *
 * Takes a list rather than discovering assets, because listing requires an API secret and
 * the whole point is to stay credential-free. Editorial pastes URLs or IDs; both work.
 */
export default {
  key: 'cloudinary',
  label: 'Cloudinary',
  needs: ['assets'],
  notes: 'Paste delivery URLs or bare public IDs. The only clippable source.',

  async fetch({ assets, baseUrl, cloud, named = false }) {
    const rows = typeof assets === 'string'
      ? assets.split('\n').map((s) => s.trim()).filter(Boolean).map((media) => ({ media }))
      : assets;

    const origin = baseUrl || originOf(rows[0]?.media) || undefined;
    const b = builder({ baseUrl: origin, cloud, named });

    return rows.map((r) => {
      const pid = publicId(r.media);
      const isClip = Number.isFinite(r.start) && Number.isFinite(r.end);
      const secs = isClip ? Math.round(r.end - r.start) : Number(r.durationSeconds) || 0;
      return makeItem({
        id: `cld-${pid}${isClip ? `-${Math.round(r.start)}` : ''}`,
        source: 'cloudinary',
        collection: r.collection,
        headline: r.headline,
        caption: r.caption,
        media: {
          kind: 'cloudinary',
          publicId: pid,
          hls: isClip ? b.clip(pid, r.start, r.end) : b.hls(pid),
          mp4: isClip ? b.clip(pid, r.start, r.end, { ext: 'mp4' }) : b.mp4(pid),
          tile: b.tile(pid),
        },
        poster: [isClip ? b.clipPoster(pid, r.start, r.end) : b.poster(pid)],
        durationSeconds: secs,
        clip: isClip ? { of: pid, start: r.start, end: r.end } : null,
        publishedAt: r.publishedAt || null,
        flags: { vertical: true, hasCaptions: !!r.captions },
      });
    });
  },
};
