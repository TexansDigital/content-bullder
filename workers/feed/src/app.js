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
import { rankFeed, makePrefs, resolveExperiments, displayName, LANES, MAX_PICKS, MIN_EVENTS } from '../../../src/rank.js';

const ID_SHAPE = /^[A-Za-z0-9._:-]{6,128}$/;
/** A player slug as the dictionary spells it: the page the feed is framed on names one. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,59}$/;
const FORM_NAME = /^[A-Za-z0-9_.-]{3,120}$/;
const MAX_PREFS_BODY = 8 * 1024;
/** How many players the picker offers. The most-tagged in the catalogue being served. */
const PICKER_PLAYERS = 12;
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

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createApp({ feedHtml, enterHtml, deps = {} } = {}) {
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
    // The preference layer's public config rides along: player display names for the
    // picker and the reason pills, presets a fan can follow, live boost offers, running
    // experiments. Each is optional; a failure is a warning, never a dark feed.
    const side = (path, label) => rest(env, path).catch((e) => { warnings.push(`${label}: ${e.message}`); return []; });
    // Is there anywhere to save a preference yet? Under RLS the publishable key gets an empty
    // list from a table that exists and a 404 from one that does not; the picker is withheld
    // until the table is there, so no fan is offered a save that cannot land.
    const { base, key: anon } = supa(env);
    const probe = get(`${base}/rest/v1/feed_preferences?select=session_id&limit=1`, { headers: { apikey: anon, authorization: `Bearer ${anon}`, accept: 'application/json' } })
      .then((r) => r.status !== 404).catch(() => false);
    const [cur, cat, aliases, presetRows, offerRows, expRows, ready] = await Promise.allSettled([
      curP, catalogue.fetch({ months, max }, { fetch: get, env }),
      side('feed_entity_aliases?select=entity_slug,alias&entity_type=eq.player&tier=eq.1&limit=1000', 'aliases'),
      side('feed_presets?select=slug,name,blurb,entity_weights,content_type_weights&active=is.true&limit=50', 'presets'),
      side('feed_boost_offers?select=key,label,blurb,content_types,keywords,ends_at&active=is.true&limit=20', 'offers'),
      side('feed_experiments?select=key,arms,knobs,traffic&status=eq.running&limit=50', 'experiments'),
      probe,
    ]);
    const prefsReady = ready.status === 'fulfilled' && ready.value === true;
    if (!prefsReady) warnings.push('feed_preferences: table not found; the picker is withheld');
    if (cur.status === 'rejected') warnings.push(`feed_items: ${cur.reason.message}`);
    if (cat.status === 'rejected') warnings.push(`catalogue: ${cat.reason.message}`);
    const shortsAll = cat.status === 'fulfilled' ? cat.value : [];
    const byId = new Map(shortsAll.map((i) => [i.id, i]));
    // An editor who takes over a Short keeps its tags: the takeover is about the copy and the
    // place in the order, not about forgetting which player the clip shows. Without this a
    // taken-over card fell out of the picker and out of every "because you picked" reason.
    const editorial = (cur.status === 'fulfilled' ? cur.value : []).map((i) => {
      const src = byId.get(i.id);
      if (!src) return i;
      const bare = !(i.entities?.players?.length) && !i.entities?.opponent && !(i.entities?.themes?.length);
      return { ...i, entities: bare ? src.entities : i.entities, contentType: i.contentType || src.contentType, shelfLife: i.shelfLife || src.shelfLife };
    });
    // Prefer the alias with initials ("c.j. stroud") over the spelled-out one.
    const names = {};
    for (const a of aliases.value || []) {
      if (!a?.entity_slug || !a?.alias) continue;
      if (!names[a.entity_slug] || (a.alias.includes('.') && !names[a.entity_slug].includes('.'))) names[a.entity_slug] = a.alias;
    }
    const presets = Object.fromEntries((presetRows.value || []).filter((p) => p?.slug).map((p) => [p.slug, p]));
    const nowMs = now().getTime();
    const offers = Object.fromEntries((offerRows.value || [])
      .filter((o) => o?.key && Date.parse(o.ends_at || '') > nowMs).map((o) => [o.key, o]));
    const experiments = (expRows.value || []).filter((x) => x?.key && x?.arms);
    const taken = new Set(editorial.map((i) => i.id));
    // Catalogue cards rank after every curated card and keep publishedAt order among themselves.
    const shorts = shortsAll
      .filter((i) => !taken.has(i.id))
      .map((i) => ({ ...i, status: STATUS.PUBLISHED, sortIndex: 1_000_000 }));
    const all = [...editorial, ...shorts];
    const unservable = all.filter((i) => !servable(i)).length;
    if (unservable) warnings.push(`${unservable} card(s) skipped: media is not an absolute URL`);
    const live = all.filter(servable).sort(feedSort);
    // The picker offers the players this feed actually has cards about, most-tagged first,
    // named from the dictionary. The dictionary refuses excluded names, so none can appear.
    const tally = {};
    for (const i of live) for (const p of i.entities?.players || []) tally[p] = (tally[p] || 0) + 1;
    const pickerPlayers = Object.entries(tally).filter(([slug]) => names[slug])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, PICKER_PLAYERS)
      .map(([slug, cards]) => ({ slug, name: displayName(slug, names), cards }));
    const picker = {
      players: pickerPlayers,
      lanes: Object.entries(LANES).map(([key, l]) => ({ key, name: l.name })),
      presets: Object.values(presets).map((p) => ({ slug: p.slug, name: p.name, blurb: p.blurb || '' })),
      offers: Object.values(offers).map((o) => ({ key: o.key, label: o.label, blurb: o.blurb || '', ends_at: o.ends_at })),
      max_players: MAX_PICKS,
    };
    return { live, counts: { curated: editorial.length, catalogue: shorts.length, served: live.length }, warnings,
      names, presets, offers, experiments, picker, prefsReady };
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

  /** What the fan told us, by the same id as their profile. Service key only; failure is "nothing". */
  async function prefsFor(env, who) {
    if (!who || !env.SUPABASE_SERVICE_KEY || !ID_SHAPE.test(who)) return null;
    try {
      const rows = await rest(env,
        `feed_preferences?select=players,wants,format,follow,boosts,updated_at&session_id=eq.${encodeURIComponent(who)}&limit=1`,
        env.SUPABASE_SERVICE_KEY);
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch (e) {
      console.error('feed_preferences read', e?.message);
      return null;
    }
  }

  /** The shape the page gets back: what was saved, nothing about how it is stored. */
  const publicPrefs = (p) => (p ? { players: p.players, wants: p.wants, format: p.format, follow: p.follow, boosts: p.boosts, updated_at: p.updated_at || null } : null);

  async function apiFeed(request, env, ctx) {
    const url = new URL(request.url);
    const built = await shared(request, env, ctx);
    const { live, counts, warnings, names = {}, presets = {}, offers = {}, experiments = [], picker = null, prefsReady = false } = built;
    // Who is watching: the host's pocket id if the handshake answered, else the feed's own
    // device id. Either ranks; neither is required.
    const who = url.searchParams.get('sid') || url.searchParams.get('did') || '';
    // The player whose page this is, when the roster frames the feed. Only a name the
    // dictionary knows counts, so an excluded or misspelled slug changes nothing.
    const wanted = url.searchParams.get('focus') || '';
    const focus = SLUG.test(wanted) && names[wanted] ? wanted : null;
    const [profile, prefRow] = await Promise.all([profileFor(env, who), prefsFor(env, who)]);
    const prefs = prefRow ? makePrefs(prefRow) : null;
    const { items, ranked, focus: focused } = rankFeed(live, profile, { prefs, presets, offers, names, focus, now: now().getTime() });
    const assigned = resolveExperiments(experiments, who);
    const only = url.searchParams.get('collection');
    const body = JSON.stringify({
      generatedAt: now().toISOString(),
      analytics: { ga4: ga4(env), events: env.SUPABASE_SERVICE_KEY ? '/api/events' : null,
        rank: !ranked ? 'shared' : prefs?.explicit ? 'personal' : profile && (Number(profile.events) || 0) >= MIN_EVENTS ? 'implicit' : 'focused' },
      ...(focused ? { focus: { slug: focused, name: displayName(focused, names) } } : {}),
      collections: liveCollections(items),
      clips: only ? items.filter((i) => i.collection === only) : items,
      counts,
      prefs: prefs ? publicPrefs({ ...prefs, updated_at: prefRow?.updated_at }) : null,
      // The picker needs an id to save against; with none it is not offered.
      picker: who && env.SUPABASE_SERVICE_KEY && prefsReady ? picker : null,
      experiments: assigned.experiments,
      knobs: assigned.knobs,
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

  /**
   * What a fan picked, saved against their pseudonymous id. Validated to the shapes ranking
   * understands: three players at most, lanes from the fixed list, a preset that exists, boosts
   * from live offers (the offer's end date is stamped on, so a boost cannot outlive it).
   */
  async function apiPrefs(request, env, ctx) {
    if (!env.SUPABASE_SERVICE_KEY) return new Response(JSON.stringify({ error: 'preferences are not enabled' }), { status: 503, headers: jsonHeaders({ 'cache-control': 'no-store' }) });
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_PREFS_BODY) return new Response('too large', { status: 413 });
    const text = await request.text();
    if (text.length > MAX_PREFS_BODY) return new Response('too large', { status: 413 });
    let body;
    try { body = JSON.parse(text || '{}'); } catch { return new Response('bad json', { status: 400 }); }
    const who = [body?.pocket_id, body?.device_id].map((v) => String(v ?? '')).find((v) => ID_SHAPE.test(v));
    if (!who) return new Response(JSON.stringify({ error: 'no id' }), { status: 400, headers: jsonHeaders() });
    const { presets = {}, offers = {} } = await shared(request, env, ctx);
    const p = makePrefs(body);
    const row = {
      session_id: who,
      players: p.players,
      wants: p.wants,
      format: p.format,
      follow: p.follow && presets[p.follow] ? p.follow : null,
      boosts: p.boosts.filter((b) => offers[b.key]).map((b) => ({ key: b.key, until: offers[b.key].ends_at })),
      source: body?.source === 'edit' ? 'edit' : 'picker',
      updated_at: now().toISOString(),
    };
    const { base } = supa(env);
    const r = await get(`${base}/rest/v1/feed_preferences?on_conflict=session_id`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      console.error('feed_preferences write', r.status);
      return new Response(JSON.stringify({ error: 'could not save' }), { status: 503, headers: jsonHeaders({ 'cache-control': 'no-store' }) });
    }
    return new Response(JSON.stringify({ ok: true, prefs: publicPrefs(row) }), {
      status: 200, headers: jsonHeaders({ 'cache-control': 'private, no-store', 'access-control-allow-origin': '*' }),
    });
  }

  /**
   * The data-capture form, served with the fan's pseudonymous id and the card that led here
   * in its hidden fields, so a sweepstakes entry can later be joined to what that fan watched.
   * The markup is the club's own Eloqua template with the NFL privacy block; this only fills
   * placeholders, all escaped. Form and campaign names are shape-checked before they reach it.
   */
  function enter(request, env) {
    if (!enterHtml) return new Response('not found', { status: 404 });
    const q = new URL(request.url).searchParams;
    const pick = (v, re) => (re.test(String(v || '')) ? String(v) : '');
    const html = enterHtml
      .replaceAll('{{POCKET_ID}}', escHtml(pick(q.get('pid'), ID_SHAPE)))
      .replaceAll('{{FORM_NAME}}', escHtml(pick(q.get('form'), FORM_NAME) || env.ELOQUA_FORM_NAME || ''))
      .replaceAll('{{CAMPAIGN_ID}}', escHtml(pick(q.get('cid'), FORM_NAME) || env.ELOQUA_CAMPAIGN_ID || ''))
      .replaceAll('{{UTM_CONTENT}}', escHtml(pick(q.get('card'), /^[A-Za-z0-9._:-]{1,80}$/)))
      .replaceAll('{{TITLE}}', escHtml(pick(q.get('title'), /^[^<>]{1,80}$/) || 'Enter'));
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'content-security-policy': `frame-ancestors 'self' ${env.FRAME_ANCESTORS || FRAME_ANCESTORS_DEFAULT}`,
      },
    });
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
        if (method === 'POST' && p === '/api/prefs') return apiPrefs(request, env, ctx);
        if (method === 'GET' && p === '/enter') return enter(request, env);
        if (method === 'GET' && p === '/health') {
          const built = await shared(request, env, ctx);
          const { counts, warnings, experiments = [], offers = {}, presets = {} } = built;
          return new Response(JSON.stringify({ ok: counts.served > 0, worker: 'txfeed', counts, warnings,
            events: Boolean(env.SUPABASE_SERVICE_KEY), prefs: Boolean(env.SUPABASE_SERVICE_KEY) && built.prefsReady === true, ga4: Boolean(ga4(env)),
            experiments: experiments.map((x) => x.key), offers: Object.keys(offers), presets: Object.keys(presets) }),
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
