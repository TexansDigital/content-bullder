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
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[c.toLowerCase()] ?? m;
    })
    .replace(/<[^>]+>/g, '')
    .trim();

export default {
  key: 'rss',
  label: 'RSS',
  needs: ['url'],
  notes: 'No credentials, no quota. Best for the article join and CTA targets.',

  async fetch({ url, collection = 'series', max = 40 }) {
    const xml = await (await fetch(url, { headers: { accept: 'application/rss+xml, application/xml, text/xml' } })).text();
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
        media: { kind: 'link', url: link },
        poster: thumb ? [thumb] : [],
        publishedAt: tag(e, 'pubDate') || tag(e, 'published') || tag(e, 'updated'),
        action: link ? { label: 'Read the story', url: link } : null,
        links: { article: link },
        flags: { vertical: false },
      });
    });
  },
};
