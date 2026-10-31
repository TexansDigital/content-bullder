/**
 * The public feed, as a Cloudflare Worker. Same feed.html as the local studio serves, same
 * ContentItem shape, same adapters — but no file store: cards come from Supabase.
 *
 *   GET  /  /feed        the embeddable feed (what goes in the iframe on houstontexans.com)
 *   GET  /api/feed       published cards as JSON: studio-curated first, then the catalogue,
 *                        reordered for the watcher when ?sid= or ?did= names a known profile
 *   POST /api/events     what fans do in the feed, written to feed_events
 *   GET  /health         liveness plus how much of each source is being served
 *
 * Two sources merge into one feed. feed_items holds cards an editor published in the studio
 * (a community activation that should live evergreen, a composed promo). The catalogue
 * holds every Short the pipeline has typed, labelled and tagged. Curated cards keep their
 * editorial order and sit first; catalogue cards follow, newest first. A curated card with
 * the same id as a catalogue card replaces it, so an editor can take over any Short.
 *
 * Everything here reads with the publishable key under RLS, except the event write, which
 * needs the service key and is the one secret this Worker holds.
 */
import { makeItem, feedSort, liveCollections, STATUS } from '../../../src/content.js';
import catalogue, { excludedMatchers } from '../../../src/adapters/catalogue.js';
import { rankFeed } from '../../../src/rank.js';

const ID_SHAPE = /^[A-Za-z0-9._:-]{6,128}$/;
const EVENT_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_EVENTS = 50;
const MAX_EVENT_BODY = 64 * 1024;
const MAX_PARAMS_JSON = 4096;
/** How long an /api/feed answer may be reused before Supabase is asked again. */
const FEED_TTL_S = 60;

const FRAME_ANCESTORS_DEFAULT = "'self' https://www.houstontexans.com https://houstontexans.com";

/** Only an absolute http(s) URL can be shown from this origin: a studio upload at /content/uploads/ cannot. */
const servable = (item) => {
  const urls = [item.media?.url, item.media?.src, ...(item.poster || [])].filter(Boolean);
  if (item.media?.kind === 'youtube' && item.media?.videoId) return true;
  return urls.length > 0 && urls.every((u) => /^https?:\/\//i.test(String(u)));
};

const jsonHeaders = (extra = {}) => ({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  ...extra,
});

export function createApp({ feedHtml, deps = {} } = {}) {
  const get = deps.fetch || ((...a) => globalThis.fetch(...a));
  const now = deps.now || (() => new Date());

  const supa = (env) => ({
    base: String(env.SUPABASE_URL || 'https://xisvulbabqsyxnlyuwcz.supabase.co').replace(/\/$/, ''),
    key: env.SUPABASE_KEY || 'sb_publishable_9Tipf7u3W0i5I_GeJEkCgw_bdu8ZbGe',
  });

  const rest = async (env, path, key) => {
    const { base, key: anon } = supa(env);
    const k = key || anon;
    const r = await get(`${base}/rest/v1/${path}`, {
      headers: { apikey: k, authorization: `Bearer ${k}`, accept: 'application/json' },
    });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`feed: ${path.split('?')[0]} ${r.status}`);
    return r.json();
  };

  /** Studio-published cards, in editorial order, minus anything naming an excluded player. */
  async function curated(env, banned) {
    const rows = await rest(env,
      'feed_items?select=item&status=eq.published&order=sort_index.asc,published_at.desc.nullslast&limit=500');
    return rows.map((r) => makeItem({ ...r.item, status: STATUS.PUBLISHED }))
      .filter((i) => !banned.some((rx) => rx.test(`${i.headline}\n${i.caption || ''}`)));
  }

  async function buildFeed(env) {
    const months = Number(env.CATALOGUE_MONTHS) || 12;
    const max = Number(env.CATALOGUE_MAX) || 300;
    const warnings = [];
    // Curated cards need the denylist before they can be filtered, so that pair is one
    // promise: if the list cannot be read, curated cards are not served without it.
    const curP = rest(env, 'excluded_players?select=name')
      .then((ex) => curated(env, excludedMatchers(ex.map((e) => e.name))));
    const [cur, cat] = await Promise.allSettled([curP, catalogue.fetch({ months, max }, { fetch: get, env })]);
    if (cur.status === 'rejected') warnings.push(`feed_items: ${cur.reason.message}`);
    if (cat.status === 'rejected') warnings.push(`catalogue: ${cat.reason.message}`);
    const editorial = cur.status === 'fulfilled' ? cur.value : [];
    const taken = new Set(editorial.map((i) => i.id));
    // Catalogue cards rank after every curated card and keep publishedAt order among themselves.
    const shorts = (cat.status === 'fulfilled' ? cat.value : [])
      .filter((i) => !taken.has(i.id))
      .map((i) => ({ ...i, status: STATUS.PUBLISHED, sortIndex: 1_000_000 }));
    const all = [...editorial, ...shorts];
    const unservable = all.filter((i) => !servable(i)).length;
    if (unservable) warnings.push(`${unservable} card(s) skipped: media is not an absolute URL`);
    const live = all.filter(servable).sort(feedSort);
    return { live, counts: { curated: editorial.length, catalogue: shorts.length, served: live.length }, warnings };
  }

  const ga4 = (env) => (/^G-[A-Z0-9]{4,20}$/i.test(env.GA_MEASUREMENT_ID || '') ? env.GA_MEASUREMENT_ID : null);

  /**
   * The shared feed, built once per FEED_TTL_S and kept in the Cache API as JSON so every
   * visitor's request, personalised or not, starts from the same cards.
   */
  async function shared(request, env, ctx) {
    const cache = deps.cache === null ? null : (deps.cache || globalThis.caches?.default);
    const key = new Request(new URL(`/__shared?m=${env.CATALOGUE_MONTHS || 12}&x=${env.CATALOGUE_MAX || 300}`, request.url).toString(), { method: 'GET' });
    if (cache) {
      const hit = await cache.match(key);
      if (hit) return hit.json();
    }
    const built = await buildFeed(env);
    if (cache && built.live.length) {
      const put = cache.put(key, new Response(JSON.stringify(built), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${FEED_TTL_S}` } }));
      if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
    }
    return built;
  }

  /**
   * The watcher's profile, by pocket id or device id, read with the service key: profiles
   * are never readable with the publishable key. Any failure is "no profile", never an error
   * in the feed.
   */
  async function profileFor(env, who) {
    if (!who || !env.SUPABASE_SERVICE_KEY || !ID_SHAPE.test(who)) return null;
    try {
      const rows = await rest(env,
        `feed_profiles?select=entity_weights,content_type_weights,events&session_id=eq.${encodeURIComponent(who)}&limit=1`,
        env.SUPABASE_SERVICE_KEY);
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch (e) {
      console.error('feed_profiles read', e?.message);
      return null;
    }
  }

  async function apiFeed(request, env, ctx) {
    const url = new URL(request.url);
    const { live, counts, warnings } = await shared(request, env, ctx);
    // Who is watching: the host's pocket id if the handshake answered, else the feed's own
    // device id. Either ranks; neither is required.
    const who = url.searchParams.get('sid') || url.searchParams.get('did') || '';
    const profile = await profileFor(env, who);
    const { items, ranked } = rankFeed(live, profile);
    const only = url.searchParams.get('collection');
    const body = JSON.stringify({
      generatedAt: now().toISOString(),
      analytics: { ga4: ga4(env), events: env.SUPABASE_SERVICE_KEY ? '/api/events' : null, rank: ranked ? 'personal' : 'shared' },
      collections: liveCollections(items),
      clips: only ? items.filter((i) => i.collection === only) : items,
      counts,
      ...(warnings.length ? { warnings } : {}),
    });
    return new Response(body, {
      status: items.length ? 200 : 503,
      headers: jsonHeaders({
        // A personalised answer is one person's; it must never be cached for the next.
        'cache-control': !items.length ? 'no-store' : who ? 'private, no-store' : `public, max-age=${FEED_TTL_S}`,
        'access-control-allow-origin': '*',
        'vary': 'Accept',
      }),
    });
  }

  /** One client event into one feed_events row. Returns null for anything malformed. */
  function toRow(e, received) {
    if (!e || typeof e !== 'object') return null;
    const event = String(e.event || '');
    if (!EVENT_NAME.test(event) || event === 'hello') return null;
    const p = e.params && typeof e.params === 'object' && !Array.isArray(e.params) ? { ...e.params } : {};
    const sess = ID_SHAPE.test(String(p.pocket_id ?? '')) ? String(p.pocket_id) : null;
    const dev = ID_SHAPE.test(String(p.device_id ?? '')) ? String(p.device_id) : null;
    delete p.pocket_id; delete p.device_id;
    const cardId = typeof p.card_id === 'string' && p.card_id.length <= 80 ? p.card_id : null;
    const videoId = cardId && /^yt-[A-Za-z0-9_-]{6,20}$/.test(cardId) ? cardId.slice(3) : null;
    let at = received;
    const t = Date.parse(e.at || '');
    // Trust the client clock within a day either way; outside that, the arrival time wins.
    if (Number.isFinite(t) && Math.abs(t - received.getTime()) < 86400e3) at = new Date(t);
    let params = JSON.stringify(p);
    if (params.length > MAX_PARAMS_JSON) params = JSON.stringify({ truncated: true, event });
    return { session_id: sess, device_id: dev, event, card_id: cardId, video_id: videoId, params: JSON.parse(params), at: at.toISOString() };
  }

  async function apiEvents(request, env, ctx) {
    if (!env.SUPABASE_SERVICE_KEY) return new Response(null, { status: 204 });
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_EVENT_BODY) return new Response('too large', { status: 413 });
    let text = await request.text();
    if (text.length > MAX_EVENT_BODY) return new Response('too large', { status: 413 });
    let body;
    try { body = JSON.parse(text || '{}'); } catch { return new Response('bad json', { status: 400 }); }
    const list = Array.isArray(body?.events) ? body.events : [body];
    const received = now();
    const rows = list.slice(0, MAX_EVENTS).map((e) => toRow(e, received)).filter(Boolean);
    if (!rows.length) return new Response(null, { status: 204 });
    const { base } = supa(env);
    const write = get(`${base}/rest/v1/feed_events`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json', prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    }).then((r) => { if (!r.ok) console.error('feed_events write', r.status); })
      .catch((e) => console.error('feed_events write', e?.message));
    // Reply before the write lands: the beacon is fire-and-forget on the client too.
    if (ctx?.waitUntil) ctx.waitUntil(write); else await write;
    return new Response(null, { status: 204 });
  }

  function page(env) {
    return new Response(feedHtml || '<!doctype html><title>feed</title>feed.html was not bundled', {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        // Framing is the whole point, but only by the club's own site.
        'content-security-policy': `frame-ancestors ${env.FRAME_ANCESTORS || FRAME_ANCESTORS_DEFAULT}`,
      },
    });
  }

  return {
    async fetch(request, env = {}, ctx) {
      const url = new URL(request.url);
      const p = url.pathname.replace(/\/+$/, '') || '/';
      // HEAD is answered like GET; the runtime strips the body.
      const method = request.method === 'HEAD' ? 'GET' : request.method;
      try {
        if (method === 'GET' && (p === '/' || p === '/feed' || p === '/feed.html')) return page(env);
        if (method === 'GET' && p === '/api/feed') return apiFeed(request, env, ctx);
        if (method === 'POST' && p === '/api/events') return apiEvents(request, env, ctx);
        if (method === 'GET' && p === '/health') {
          const { counts, warnings } = await shared(request, env, ctx);
          return new Response(JSON.stringify({ ok: counts.served > 0, worker: 'txfeed', counts, warnings,
            events: Boolean(env.SUPABASE_SERVICE_KEY), ga4: Boolean(ga4(env)) }),
            { status: counts.served > 0 ? 200 : 503, headers: jsonHeaders({ 'cache-control': 'no-store' }) });
        }
        return new Response('not found', { status: 404 });
      } catch (e) {
        console.error('txfeed', e?.message);
        return new Response(JSON.stringify({ error: 'feed unavailable' }), { status: 503, headers: jsonHeaders({ 'cache-control': 'no-store' }) });
      }
    },
  };
}
