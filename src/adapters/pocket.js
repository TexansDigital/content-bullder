import { makeItem } from '../content.js';

/**
 * houstontexans.com (Pocket CMS) publishes four RSS feeds: news, galleries, the club's own
 * video pages and the Texans All-Access podcast. Each item becomes a card with the story's
 * image, its headline and dek, and one action that opens the page. Nothing is re-hosted.
 *
 * The only taxonomy is `media:keywords`, a flat, messy, comma-separated string (casing
 * varies, tags repeat, spaces trail). Every tag is normalised to a slug and matched whole,
 * never as a substring. Players come from the entity dictionary's aliases; the opponent from
 * the long game tag ("New York Giants at Houston Texans (2026-REG-7)"), which is the reliable
 * one. Anything naming an excluded player is dropped before it becomes a card.
 *
 * Reference: docs/research/pocket-rss-feeds.md. Reads only.
 */
export const POCKET_FEEDS = {
  news: { url: 'https://www.houstontexans.com/rss/news', format: 'read', action: 'Read' },
  galleries: { url: 'https://www.houstontexans.com/rss/galleries', format: 'read', action: 'See the photos' },
  videos: { url: 'https://www.houstontexans.com/rss/videos', format: 'video', action: 'Watch' },
  audio: { url: 'https://www.houstontexans.com/rss/audio', format: 'listen', action: 'Listen' },
};

/** Lowercase, drop apostrophes, everything else to single dashes. "Ka'imi Fairbairn" → "kaimi-fairbairn". */
export const slugify = (s) => String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const cdata = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return (m ? m[1] : (s || '')).trim(); };
const decode = (s) => String(s || '')
  .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, c) => {
    if (c[0] === '#') {
      const n = c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[c.toLowerCase()] ?? m;
  })
  .replace(/<[^>]+>/g, '').trim();
const tag = (it, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(it); return m ? decode(cdata(m[1])) : ''; };
const attr = (it, t, a) => { const m = new RegExp(`<${t}\\b[^>]*\\s${a}="([^"]*)"`, 'i').exec(it); return m ? decode(m[1]) : ''; };
const safeHref = (u) => (/^https:\/\/(www\.)?houstontexans\.com\//i.test(String(u || '').trim()) ? String(u).trim() : null);

/** One feed's XML into plain entries. An empty body is a failure, not "no news". */
export function parsePocket(xml, feedKey) {
  if (!xml || !String(xml).trim()) throw new Error(`pocket: ${feedKey} returned an empty body`);
  const items = String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items.map((it) => {
    const kw = tag(it, 'media:keywords');
    const labels = kw ? kw.split(',').map((k) => k.trim()).filter(Boolean) : [];
    return {
      feed: feedKey,
      guid: tag(it, 'guid') || '',
      title: tag(it, 'title'),
      summary: tag(it, 'description'),
      url: tag(it, 'link'),
      image: attr(it, 'enclosure', 'url') || attr(it, 'media:content', 'url'),
      published: tag(it, 'pubDate'),
      labels,
      tags: [...new Set(labels.map(slugify).filter(Boolean))],
    };
  }).filter((e) => e.guid && e.title && e.url);
}

/** The landscape editorial image at a size the card can hold; the public id is the same Cloudinary id used everywhere. */
export const cardImage = (url) => String(url || '').replace('/t_editorial_landscape_12_desktop/', '/w_1080,c_limit,q_auto,f_auto/');

const GAME_LONG = /^(.+?) at (.+?) \(\d{4}-(?:REG|PRE|POST)-\d+\)$/i;
const GAME_SHORT = /^\d{4} (?:reg|pre|post)\d+ - ([a-z0-9 .-]+?)( - (?:video|photo))?$/i;
/** The opponent as a lower-case nickname ("giants"), from the long game tag first. */
export function opponentOf(labels) {
  for (const l of labels || []) {
    const m = GAME_LONG.exec(l.trim());
    if (!m) continue;
    const other = [m[1], m[2]].find((t) => !/houston texans/i.test(t));
    if (other) return slugify(other.trim().split(/\s+/).pop());
  }
  for (const l of labels || []) {
    const m = GAME_SHORT.exec(l.trim());
    if (m) return slugify(m[1].trim().split(/\s+/).pop());
  }
  return null;
}

const has = (tags, ...keys) => keys.some((k) => tags.includes(k));
/** Where a card sits, and what the catalogue would call it, from its tags and its feed. */
export function classify(entry) {
  const t = entry.tags;
  if (entry.feed === 'audio') return { collection: 'radio', contentType: null };
  if (has(t, 'girls-flag', 'youth-football', 'flag-football')) return { collection: 'flag', contentType: 'community' };
  if (has(t, 'community', 'foundation', 'texans-care')) return { collection: 'community', contentType: 'community' };
  if (has(t, 'press-conference', 'press-conferences')) return { collection: 'presser', contentType: 'coaches' };
  if (has(t, 'transaction', 'transactions', 'press-releases', 'roster-move')) return { collection: 'presser', contentType: 'front_office' };
  if (has(t, 'highlights', 'highlight')) return { collection: 'gameday', contentType: 'game_action' };
  if (has(t, 'gameday', 'how-to-watch', 'inactives', 'injury-report', 'game-preview', 'know-your-foe') || opponentOf(entry.labels)) {
    return { collection: 'gameday', contentType: 'opponent_week' };
  }
  if (has(t, 'vanderblog')) return { collection: 'series', contentType: 'player_stories' };
  return { collection: entry.feed === 'videos' ? 'series' : 'players', contentType: entry.feed === 'videos' ? null : 'player_stories' };
}

/**
 * Entries into cards. `names` is the dictionary (slug → alias) so a tag "C.J. Stroud" lands on
 * the slug the rest of the feed uses; `banned` are the excluded-name matchers.
 */
export function pocketItems(entries, { names = {}, banned = [], max = 40 } = {}) {
  const bySlug = new Map();
  for (const [slug, alias] of Object.entries(names || {})) { bySlug.set(slug, slug); bySlug.set(slugify(alias), slug); }
  const perFeed = {};
  const out = [];
  for (const e of entries) {
    if ((perFeed[e.feed] = (perFeed[e.feed] || 0) + 1) > max) continue;
    const feed = POCKET_FEEDS[e.feed];
    if (!feed) continue;
    const text = `${e.title}\n${e.summary}\n${e.labels.join(', ')}`;
    if (banned.some((rx) => rx.test(text))) continue;
    const link = safeHref(e.url);
    if (!link) continue;
    const players = [...new Set(e.tags.map((s) => bySlug.get(s)).filter(Boolean))];
    const { collection, contentType } = classify(e);
    const when = Date.parse(e.published);
    out.push(makeItem({
      id: `pk-${e.guid}`,
      source: 'pocket',
      collection,
      headline: e.title,
      caption: e.summary || null,
      media: e.image ? { kind: 'image', url: cardImage(e.image) } : { kind: 'none' },
      poster: e.image ? [cardImage(e.image)] : [],
      fit: 'contain',
      chrome: 'on',
      publishedAt: Number.isFinite(when) ? new Date(when).toISOString() : null,
      action: { label: feed.action, url: link },
      links: { page: link },
      entities: { players, opponent: opponentOf(e.labels), themes: [] },
      contentType,
      shelfLife: 'timely',
      format: feed.format,
      advance: { mode: 'auto', seconds: 8 },
      flags: { vertical: false, tags: e.tags.slice(0, 24) },
    }));
  }
  return out;
}

/** Fetch the feeds in parallel. A feed that fails is reported, not fatal; news failing alone is still not fatal here. */
export async function fetchPocket({ feeds = Object.keys(POCKET_FEEDS) } = {}, deps = {}) {
  const get = deps.fetch || globalThis.fetch;
  const warnings = [];
  const lists = await Promise.all(feeds.filter((k) => POCKET_FEEDS[k]).map(async (k) => {
    try {
      const r = await get(POCKET_FEEDS[k].url, { headers: { accept: 'application/rss+xml, application/xml', 'user-agent': 'txfeed/1' }, redirect: 'follow' });
      if (!r.ok) throw new Error(`pocket: ${k} ${r.status}`);
      return parsePocket(await r.text(), k);
    } catch (e) { warnings.push(e?.message || `pocket: ${k} failed`); return []; }
  }));
  return { entries: lists.flat(), warnings };
}

export default {
  key: 'pocket',
  label: 'houstontexans.com',
  needs: [],
  notes: 'News, galleries, club video pages and the podcast from the site\'s RSS feeds, as cards that open the page. Players and the opponent come from the tags; anything naming an excluded player is dropped.',
  async fetch({ feeds, max = 40, names = {}, banned = [] } = {}, deps = {}) {
    const { entries } = await fetchPocket({ feeds }, deps);
    return pocketItems(entries, { names, banned, max });
  },
};
