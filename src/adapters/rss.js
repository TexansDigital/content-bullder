import { makeItem } from '../content.js';

/**
 * FORGE and most CMSes expose RSS with no API negotiation, no review and no quota. Useful
 * for the editorial join — which article does this clip belong to, which becomes the item's
 * action button — and as a same-day fallback when a platform API is rate-limited.
 *
 * Deliberately regex-based: one dependency-free pass over a well-formed feed beats pulling
 * an XML parser in for this.
 */
const tag = (xml, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? decode(m[1]) : null;
};
const attr = (xml, name, a) => {
  const m = new RegExp(`<${name}[^>]*\\b${a}="([^"]*)"`, 'i').exec(xml);
  return m ? decode(m[1]) : null;
};
const decode = (s) =>
  String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, c) => {
      if (c[0] === '#') {
        const n = c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
        // fromCodePoint throws above 0x10FFFF, which would lose the whole batch.
        return Number.isFinite(n) && n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[c.toLowerCase()] ?? m;
    })
    .replace(/<[^>]+>/g, '')
    .trim();

/** A feed can put `javascript:` in a <link>; it must never reach an href. */
const safeHref = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : null);

export default {
  key: 'rss',
  label: 'RSS',
  needs: ['url'],
  notes: 'No credentials, no quota. Best for the article join and CTA targets.',

  async fetch({ url, collection = 'series', max = 40 }) {
    // This endpoint takes a URL from the caller, so without these guards it is a timeout-free
    // probe of anything the server can reach.
    let target;
    try { target = new URL(url); } catch { throw new Error('rss: not a valid URL'); }
    if (!/^https?:$/.test(target.protocol)) throw new Error('rss: only http(s) URLs are allowed');
    if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/i.test(target.hostname)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(target.hostname))
      throw new Error('rss: refusing to fetch a private address');

    const r = await fetch(target, {
      headers: { accept: 'application/rss+xml, application/xml, text/xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`rss: ${r.status} from ${target.host}`);
    const raw = await r.text();
    const MAX = 5 * 1024 * 1024;
    if (raw.length > MAX) throw new Error(`rss: feed is over ${MAX / 1048576}MB`);
    const xml = raw;
    const entries = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];

    return entries.slice(0, max).map((e, i) => {
      const link = tag(e, 'link') || attr(e, 'link', 'href') || tag(e, 'guid');
      const thumb = attr(e, 'media:thumbnail', 'url') || attr(e, 'media:content', 'url')
                 || attr(e, 'enclosure', 'url');
      const title = tag(e, 'title') || 'Untitled';
      return makeItem({
        id: `rss-${(tag(e, 'guid') || link || `${i}`).replace(/\W+/g, '').slice(-24)}`,
        source: 'rss',
        collection,
        headline: title,
        caption: tag(e, 'description') || tag(e, 'summary'),
        media: { kind: 'link', url: safeHref(link) },
        poster: thumb ? [thumb] : [],
        publishedAt: tag(e, 'pubDate') || tag(e, 'published') || tag(e, 'updated'),
        action: safeHref(link) ? { label: 'Read the story', url: safeHref(link) } : null,
        links: safeHref(link) ? { article: safeHref(link) } : {},
        flags: { vertical: false },
      });
    });
  },
};
