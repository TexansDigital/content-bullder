import { makeItem } from '../content.js';
import { posterCandidates } from '../youtube.js';

/**
 * The curated catalogue in Supabase — videos the YouTube pipeline has already classified,
 * labelled evergreen or timely, and (once the tagging job has run) tagged with the players,
 * opponent and themes each one is about.
 *
 * This is the source the feed should prefer over YouTube live: the same videos, already
 * typed and labelled, and readable with the project's publishable key under row-level
 * security that allows exactly these tables and nothing else.
 *
 * Reads only. Nothing in this adapter can write to the catalogue.
 */
const URL_DEFAULT = 'https://xisvulbabqsyxnlyuwcz.supabase.co';
// The publishable key is built to ship in client code; RLS limits it to anon_read on the
// catalogue tables. Override both with SUPABASE_URL / SUPABASE_KEY for another project.
const KEY_DEFAULT = 'sb_publishable_9Tipf7u3W0i5I_GeJEkCgw_bdu8ZbGe';

/** Catalogue content types onto the feed's collections. Unmapped types land in Series. */
const COLLECTION_OF = {
  game_action: 'gameday', opponent_week: 'gameday', hype_brand: 'gameday', calendar: 'gameday',
  player_stories: 'players', draft_roster: 'players', offseason_camp: 'players', workout_camp: 'players',
  coaches: 'presser', front_office: 'presser',
  community: 'community',
};

const rxEscape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Lowercase, drop dots, and collapse everything else to single spaces (so a possessive still ends at the name). */
const norm = (t) => String(t || '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * One matcher per excluded name, tested on word boundaries against normalised title plus
 * description, so "J.J. Watt", "JJ Watt" and "j.j. watt" are the same name. The full name
 * always matches. The surname alone also matches when it is five letters or more, so
 * "Mixon's best run" is caught while a four-letter surname like Kirk does not take every
 * Kirk Cousins clip with it. Never means never, so this leans toward dropping.
 */
export function excludedMatchers(names) {
  const out = [];
  const add = (phrase) => {
    const rx = new RegExp(`\\b${rxEscape(phrase)}\\b`);
    out.push({ test: (text) => rx.test(norm(text)) });
  };
  for (const raw of names || []) {
    const name = norm(raw);
    if (!name) continue;
    add(name);
    const last = name.split(' ').pop();
    if (last.length >= 5 && last !== name) add(last);
  }
  return out;
}

export default {
  key: 'catalogue',
  label: 'Catalogue',
  needs: [],
  notes: 'Shorts the pipeline has already typed and labelled, with the players and opponent each is about. Anything naming a player on excluded_players is dropped. Reads the Supabase catalogue; nothing is written.',

  async fetch({ months = 12, max = 300, contentType, onlyTagged = false } = {}, deps = {}) {
    const get = deps.fetch || globalThis.fetch;
    const base = (process.env.SUPABASE_URL || URL_DEFAULT).replace(/\/$/, '');
    const key = process.env.SUPABASE_KEY || KEY_DEFAULT;
    const rest = async (path) => {
      const r = await get(`${base}/rest/v1/${path}`, {
        headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
      });
      if (r.status === 404) return [];           // a table that does not exist yet reads as empty
      if (!r.ok) throw new Error(`catalogue: ${path.split('?')[0]} ${r.status}`);
      return r.json();
    };

    const since = new Date(Date.now() - Number(months) * 30 * 86400e3).toISOString();
    const limit = Math.min(1000, Math.max(1, Number(max) || 300));
    // excluded_players is the team's own denylist. A Short that so much as names one of
    // them in its title or description never reaches the feed. A 5xx here throws rather
    // than quietly serving the feed without the list.
    const [excluded, videos] = await Promise.all([
      rest('excluded_players?select=name'),
      rest(
      'videos?select=id,title,description,published_at,duration_seconds,thumbnail_url,lifetime_views'
      + `&creator_content_type=eq.SHORTS&is_active=not.is.false&published_at=gte.${since}`
      + `&order=published_at.desc&limit=${limit}`),
    ]);
    const banned = excludedMatchers(excluded.map((e) => e.name));
    const clean = videos.filter((v) => !banned.some((rx) => rx.test(`${v.title}\n${v.description || ''}`)));
    if (!clean.length) return [];

    const ids = clean.map((v) => v.id);
    const inList = (xs) => `in.(${xs.map((x) => `"${x}"`).join(',')})`;
    // Three label tables, each batched over the same ids. Any of them may be sparse.
    const [types, labels, entities] = await Promise.all([
      rest(`short_content_types?select=video_id,content_type&video_id=${inList(ids)}`),
      rest(`short_labels?select=video_id,label&video_id=${inList(ids)}`),
      rest(`feed_video_entities?select=video_id,entity_type,entity_slug,confidence&video_id=${inList(ids)}`),
    ]);
    const typeOf = Object.fromEntries(types.map((t) => [t.video_id, t.content_type]));
    const labelOf = Object.fromEntries(labels.map((l) => [l.video_id, l.label]));
    const entsOf = {};
    for (const e of entities) (entsOf[e.video_id] ||= []).push(e);

    return clean.flatMap((v) => {
      const ct = typeOf[v.id] || null;
      if (contentType && ct !== contentType) return [];
      const ents = entsOf[v.id] || [];
      if (onlyTagged && !ents.length) return [];
      const players = ents.filter((e) => e.entity_type === 'player')
        .sort((a, b) => b.confidence - a.confidence).map((e) => e.entity_slug);
      const opponent = ents.find((e) => e.entity_type === 'opponent')?.entity_slug || null;
      const themes = ents.filter((e) => e.entity_type === 'theme').map((e) => e.entity_slug);
      return [makeItem({
        id: `yt-${v.id}`,
        source: 'catalogue',
        collection: COLLECTION_OF[ct] || 'series',
        headline: v.title,
        caption: (v.description || '').split('\n')[0].slice(0, 200) || null,
        media: { kind: 'youtube', videoId: v.id, url: `https://www.youtube.com/shorts/${v.id}` },
        poster: [v.thumbnail_url, ...posterCandidates(v.id)].filter(Boolean),
        durationSeconds: v.duration_seconds || 0,
        publishedAt: v.published_at,
        links: { youtube: `https://www.youtube.com/shorts/${v.id}` },
        entities: { players, opponent, themes },
        contentType: ct,
        shelfLife: labelOf[v.id] || null,
        flags: { vertical: true, hasCaptions: false, views: v.lifetime_views || 0 },
      })];
    });
  },
};
