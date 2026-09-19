import { makeItem } from '../content.js';
import { builder, publicId, originOf, parseClip } from '../cloudinary.js';

/**
 * Assets we control, addressed by public ID. This is the only source that plays in our own
 * player at our own aspect ratio, and the only one that can be clipped — `so_`/`eo_` trim
 * plus `g_auto` reframe, expressed entirely in the delivery URL.
 *
 * Takes a list rather than discovering assets, because listing requires an API secret and
 * the whole point is to stay credential-free. Editorial pastes URLs or IDs; both work.
 */
/** A readable name from a public ID's last segment. */
const nameFrom = (pid) => String(pid).split('/').pop()
  .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/^./, (c) => c.toUpperCase()).slice(0, 90) || 'Untitled';

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
      // A row we cannot resolve has no usable id; returning one anyway made several rows
      // share `cld-null`, so a single edit rewrote all of them.
      if (!pid) return null;
      // Honour a trim already present in the pasted URL, so hand-built clip URLs survive.
      const pasted = parseClip(r.media);
      const start = Number.isFinite(r.start) ? r.start : pasted?.start;
      const end = Number.isFinite(r.end) ? r.end : pasted?.end;
      const isClip = Number.isFinite(start) && Number.isFinite(end);
      const secs = isClip ? Math.round(end - start) : Number(r.durationSeconds) || 0;
      return makeItem({
        id: `cld-${pid}${isClip ? `-${Math.round(start)}-${Math.round(end)}` : ''}`,
        source: 'cloudinary',
        collection: r.collection,
        // Without this every Cloudinary pull arrives as "Untitled", which validation blocks,
        // so each one needed a manual retype before it could go anywhere.
        headline: r.headline || nameFrom(pid),
        caption: r.caption,
        media: {
          kind: 'cloudinary',
          publicId: pid,
          hls: isClip ? b.clip(pid, start, end) : b.hls(pid),
          mp4: isClip ? b.clip(pid, start, end, { ext: 'mp4' }) : b.mp4(pid),
          tile: b.tile(pid),
        },
        poster: [isClip ? b.clipPoster(pid, start, end) : b.poster(pid)],
        durationSeconds: secs,
        clip: isClip ? { of: pid, start, end } : null,
        publishedAt: r.publishedAt || null,
        flags: { vertical: true, hasCaptions: !!r.captions },
      });
    }).filter(Boolean);
  },
};
