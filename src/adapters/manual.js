import { makeItem } from '../content.js';

/**
 * The escape hatch, and the default. Anything a platform won't hand over — a TikTok, an
 * Instagram Reel, a file someone exported — enters here. Keeping this as a first-class
 * adapter rather than a special case is what stops the tool being YouTube-shaped.
 */
/** Short stable digest, so the same URL always yields the same id. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** A readable name from a URL, for the inbox, before anyone edits it. */
function titleFrom(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const host = u.hostname.replace(/^www\./, '');
    // Post IDs carry no meaning, so on a numeric or opaque last segment fall back to the
    // handle and the platform — "TikTok · @houstontexans" beats "123".
    // Strip the extension before judging: "three.jpg" is nine characters with no separator,
    // which made a perfectly good name look like an opaque id.
    const last = (segs[segs.length - 1] || '').replace(/\.[a-z0-9]{1,5}$/i, '');
    const opaque = !last
      || /^\d+$/.test(last)                                   // a numeric post id
      || (last.length >= 11 && !/[-_ ]/.test(last)             // one long unbroken token…
          && !/^[a-z]+$/i.test(last));                         // …that isn't just a word
    if (opaque) {
      const handle = segs.find((s) => s.startsWith('@'));
      const site = host.split('.')[0];
      const platform = site.charAt(0).toUpperCase() + site.slice(1);
      return handle ? `${platform} · ${handle}` : platform;
    }
    return decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || host;
  } catch { return String(url).slice(0, 90); }
}

/** A pasted URL is a video, a graphic, or a link out — decide by extension. */
function mediaKind(url, durationSeconds) {
  if (/\.(m3u8|mp4|webm|mov)(\?|$)/i.test(url)) return { kind: 'file', url };
  if (/\.(jpg|jpeg|png|webp|avif|gif)(\?|$)/i.test(url))
    return { kind: 'image', url, holdSeconds: Number(durationSeconds) || 6 };
  return { kind: 'link', url };
}

export default {
  key: 'manual',
  label: 'Paste URLs',
  needs: ['urls'],
  notes: 'One URL per line — a TikTok, a Reel, a graphic, an article. Anything no API gives us.',

  async fetch({ urls, rows, collection = 'series', headline }) {
    const list = rows || String(urls || '')
      .split('\n').map((u) => u.trim()).filter(Boolean)
      .map((url) => ({
        url,
        collection,
        // A bare URL still needs a name. Fall back to the last meaningful path segment so
        // the inbox is readable before anyone edits it.
        headline: headline || titleFrom(url),
        originalUrl: url,
      }));

    return list.map((r, i) =>
      makeItem({
        // Derived from the URL, so pulling the same list twice is a no-op rather than a
        // second copy of everything.
        id: r.id || `manual-${hash(r.url || `${i}`)}`,
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
