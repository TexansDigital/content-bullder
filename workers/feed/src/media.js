/**
 * Masters: the club's own copies of its clips, uploaded by Adam and Juan from the studio page
 * at /studio/upload and kept in the texans-feed-media R2 bucket (the MEDIA binding).
 *
 * Two kinds of upload, one route:
 *   - a master FOR an existing card (`?for=yt-abc123`): the card keeps its headline, tags and
 *     posters, and plays from our file instead of the YouTube embed.
 *   - a NEW card from a file (`?new=1&headline=...&collection=...`): a story, a graphic, a
 *     community clip that was never on a platform. This is also how community stories are kept.
 *
 * One small index (index.json in the bucket) lists everything uploaded. The feed reads it when
 * it builds, so a master shows within a minute of upload. Bytes are served from /media/<key>
 * with range requests, which is what a <video> element needs to seek.
 *
 * Writes need the MEDIA_UPLOAD_KEY secret in the x-media-key header. Without the secret set,
 * every write answers 503 and says so; reads are public, like the rest of the feed.
 */
import { makeItem, COLLECTIONS, STATUS } from '../../../src/content.js';

export const MEDIA_TYPES = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};
/** A Worker request body may be 100 MB on the paid plan; a Short master is 10 to 60. */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
export const INDEX_KEY = 'index.json';
export const MEDIA_BASE_DEFAULT = 'https://feed.htow.nz';

const ID_SHAPE = /^[A-Za-z0-9._:-]{3,80}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,59}$/;
const KEY_SHAPE = /^(masters|cards|posters)\/[A-Za-z0-9._:-]{3,80}\/[a-z0-9]{4,20}\.(mp4|webm|mov|jpg|png|webp)$/;
const MAX_INDEX = 2000;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', ...extra },
});
const text = (s) => String(s ?? '').replace(/[<>]/g, '').trim();
const isVideo = (type) => /^video\//.test(type);

/** Turn an index entry into the feed's ContentItem shape (new cards only). */
export function cardFromEntry(e, base) {
  const url = `${base}/media/${e.key}`;
  const poster = e.posterKey ? `${base}/media/${e.posterKey}` : null;
  const video = isVideo(e.type);
  return makeItem({
    id: e.id,
    source: 'studio',
    collection: e.collection,
    headline: e.headline,
    caption: e.caption || null,
    media: video ? { kind: 'file', url } : { kind: 'image', url, holdSeconds: 6 },
    poster: [poster || (video ? null : url)].filter(Boolean),
    durationSeconds: 0,
    publishedAt: e.publishedAt || e.uploadedAt,
    action: e.actionUrl ? { label: e.actionLabel || 'Learn more', url: e.actionUrl } : null,
    entities: { players: e.players || [], opponent: null, themes: [] },
    contentType: e.collection === 'community' || e.collection === 'flag' ? 'community' : null,
    shelfLife: e.shelfLife || 'timely',
    flags: { vertical: true, hasCaptions: false, master: true, tags: e.tags || [] },
  });
}

/**
 * Merge the index into the card pool. A master replaces its card's media and keeps everything
 * else; a new card joins the pool. Returns the pool plus counts for /health.
 */
export function applyMedia(items, index, { base = MEDIA_BASE_DEFAULT, banned = [] } = {}) {
  const entries = (index?.items || []).filter((e) => e && e.id && e.key);
  const masters = new Map();
  for (const e of entries) if (e.kind === 'master') masters.set(e.for, e); // latest wins: entries are appended in time order
  let replaced = 0;
  const out = items.map((i) => {
    const m = masters.get(i.id);
    if (!m) return i;
    replaced++;
    const poster = m.posterKey ? `${base}/media/${m.posterKey}` : null;
    return { ...i, media: { kind: 'file', url: `${base}/media/${m.key}` }, poster: [poster, ...(i.poster || [])].filter(Boolean),
      flags: { ...(i.flags || {}), master: true } };
  });
  const have = new Set(out.map((i) => i.id));
  let added = 0;
  for (const e of entries) {
    if (e.kind !== 'card' || have.has(e.id)) continue;
    if (banned.some((rx) => rx.test(`${e.headline}\n${e.caption || ''}`))) continue;
    out.push({ ...cardFromEntry(e, base), status: STATUS.PUBLISHED, sortIndex: 1_000_000 });
    have.add(e.id); added++;
  }
  return { items: out, replaced, added };
}

export function createMedia({ now = () => new Date() } = {}) {
  const base = (env) => String(env.MEDIA_PUBLIC_BASE || MEDIA_BASE_DEFAULT).replace(/\/$/, '');
  const by = (request) => text(request.headers.get('x-media-by') || '').slice(0, 40) || null;

  async function readIndex(env) {
    if (!env.MEDIA) return { items: [], etag: null };
    const obj = await env.MEDIA.get(INDEX_KEY);
    if (!obj) return { items: [], etag: null };
    try { const parsed = JSON.parse(await obj.text()); return { items: Array.isArray(parsed.items) ? parsed.items : [], etag: obj.etag || obj.httpEtag || null }; }
    catch { return { items: [], etag: obj.etag || null }; }
  }
  /** Two people may upload at once: the index is written only if nobody else wrote it first, with one retry. */
  async function appendIndex(env, mutate) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { items, etag } = await readIndex(env);
      if (!etag) {
        // First ever write: create the empty index only if nobody else just did, then go again
        // so the real write below is conditional like every other one.
        await env.MEDIA.put(INDEX_KEY, JSON.stringify({ items: [] }), { httpMetadata: { contentType: 'application/json' }, onlyIf: new Headers({ 'if-none-match': '*' }) });
        continue;
      }
      const next = mutate(items.slice());
      if (!next) return items;
      const body = JSON.stringify({ items: next.slice(-MAX_INDEX), updatedAt: now().toISOString() });
      const opts = { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag } };
      const put = await env.MEDIA.put(INDEX_KEY, body, opts);
      if (put) return next;
    }
    throw new Error('media: index write lost a race four times');
  }

  function authorized(request, env) {
    if (!env.MEDIA) return json({ error: 'media storage is not bound' }, 503);
    if (!env.MEDIA_UPLOAD_KEY) return json({ error: 'uploads are not enabled: set the MEDIA_UPLOAD_KEY secret' }, 503);
    const given = request.headers.get('x-media-key') || '';
    if (given.length !== env.MEDIA_UPLOAD_KEY.length || given !== env.MEDIA_UPLOAD_KEY) return json({ error: 'wrong upload key' }, 401);
    return null;
  }

  /** POST /api/media?for=<cardId> | ?new=1&headline=..&collection=.. | ?poster=<id>. Body: the file. */
  async function upload(request, env) {
    const denied = authorized(request, env); if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const type = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = MEDIA_TYPES[type];
    if (!ext) return json({ error: `unsupported type ${type || '(none)'}; send one of ${Object.keys(MEDIA_TYPES).join(', ')}` }, 415);
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_MEDIA_BYTES) return json({ error: `too large: ${(len / 1048576).toFixed(1)} MB, the limit is ${MAX_MEDIA_BYTES / 1048576} MB` }, 413);
    const stamp = now().getTime().toString(36);
    const who = by(request);

    const forId = q.get('for'), posterFor = q.get('poster');
    let entry;
    if (posterFor) {
      if (!ID_SHAPE.test(posterFor)) return json({ error: 'poster needs the id of an uploaded item' }, 400);
      if (isVideo(type)) return json({ error: 'a poster is an image' }, 415);
      const key = `posters/${posterFor}/${stamp}.${ext}`;
      const bytes = await store(env, key, request, type, len); if (bytes instanceof Response) return bytes;
      let found = false;
      await appendIndex(env, (items) => {
        for (const e of items) if (e.id === posterFor) { e.posterKey = key; found = true; }
        return found ? items : null;
      });
      if (!found) { await env.MEDIA.delete(key); return json({ error: `no uploaded item with id ${posterFor}` }, 404); }
      return json({ ok: true, id: posterFor, posterKey: key, url: `${base(env)}/media/${key}`, bytes });
    }
    if (forId) {
      if (!ID_SHAPE.test(forId)) return json({ error: 'for= needs a card id' }, 400);
      if (!isVideo(type)) return json({ error: 'a master for a card is a video; send an image as ?poster=' }, 415);
      const key = `masters/${forId}/${stamp}.${ext}`;
      const bytes = await store(env, key, request, type, len); if (bytes instanceof Response) return bytes;
      entry = { id: `master-${forId}-${stamp}`, kind: 'master', for: forId, key, type, bytes, uploadedAt: now().toISOString(), by: who };
    } else if (q.get('new') === '1') {
      const headline = text(q.get('headline')).slice(0, 120);
      const collection = q.get('collection') || '';
      if (!headline) return json({ error: 'a new card needs a headline' }, 400);
      if (!COLLECTIONS.some((c) => c.key === collection)) return json({ error: `collection must be one of ${COLLECTIONS.map((c) => c.key).join(', ')}` }, 400);
      const players = String(q.get('players') || '').split(',').map((s) => s.trim()).filter((s) => SLUG.test(s)).slice(0, 6);
      const id = `st-${stamp}${Math.random().toString(36).slice(2, 6)}`;
      const key = `cards/${id}/${stamp}.${ext}`;
      const bytes = await store(env, key, request, type, len); if (bytes instanceof Response) return bytes;
      const actionUrl = /^https:\/\/(www\.)?houstontexans\.com\//i.test(q.get('action') || '') ? q.get('action') : null;
      entry = { id, kind: 'card', key, type, bytes, headline, caption: text(q.get('caption')).slice(0, 300) || null, collection, players,
        actionUrl, actionLabel: text(q.get('action_label')).slice(0, 30) || null, shelfLife: q.get('shelf') === 'evergreen' ? 'evergreen' : 'timely',
        tags: String(q.get('tags') || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => SLUG.test(s)).slice(0, 12),
        publishedAt: now().toISOString(), uploadedAt: now().toISOString(), by: who };
    } else {
      return json({ error: 'say what this is: ?for=<cardId> for a master, ?new=1&headline=&collection= for a new card, ?poster=<id> for a poster' }, 400);
    }
    await appendIndex(env, (items) => { items.push(entry); return items; });
    return json({ ok: true, ...entry, url: `${base(env)}/media/${entry.key}` });
  }

  async function store(env, key, request, type, len) {
    const body = await request.arrayBuffer();
    if (!body.byteLength) return json({ error: 'the body was empty' }, 400);
    if (body.byteLength > MAX_MEDIA_BYTES) return json({ error: `too large: ${(body.byteLength / 1048576).toFixed(1)} MB` }, 413);
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
    return body.byteLength || len;
  }

  /** GET /api/media: the index, newest first, with served URLs. Needs the key: it names who uploaded what. */
  async function list(request, env) {
    const denied = authorized(request, env); if (denied) return denied;
    const { items } = await readIndex(env);
    const b = base(env);
    return json({ items: items.slice().reverse().map((e) => ({ ...e, url: `${b}/media/${e.key}`, posterUrl: e.posterKey ? `${b}/media/${e.posterKey}` : null })) });
  }

  /** DELETE /api/media?id=: drop the entry and its bytes. A card goes back to its embed; a new card disappears. */
  async function remove(request, env) {
    const denied = authorized(request, env); if (denied) return denied;
    const id = new URL(request.url).searchParams.get('id') || '';
    if (!ID_SHAPE.test(id)) return json({ error: 'id= required' }, 400);
    let gone = null;
    await appendIndex(env, (items) => {
      const i = items.findIndex((e) => e.id === id);
      if (i < 0) return null;
      gone = items[i]; items.splice(i, 1); return items;
    });
    if (!gone) return json({ error: 'not found' }, 404);
    await env.MEDIA.delete(gone.key).catch(() => {});
    if (gone.posterKey) await env.MEDIA.delete(gone.posterKey).catch(() => {});
    return json({ ok: true, removed: id });
  }

  /** GET /media/<key>: the bytes, with Range so a <video> can seek. Keys are unique per upload, so a year of cache. */
  async function serve(request, env, key) {
    if (!env.MEDIA) return new Response('not found', { status: 404 });
    if (!KEY_SHAPE.test(key)) return new Response('not found', { status: 404 });
    const rangeHeader = request.headers.get('range') || '';
    const head = await env.MEDIA.head(key);
    if (!head) return new Response('not found', { status: 404 });
    const size = head.size;
    const type = head.httpMetadata?.contentType || 'application/octet-stream';
    const common = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff', etag: head.httpEtag || head.etag || '' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (!m[1]) end = size - 1;
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      const obj = await env.MEDIA.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!obj) return new Response('not found', { status: 404 });
      return new Response(obj.body, { status: 206, headers: { ...common, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
    }
    const obj = await env.MEDIA.get(key);
    if (!obj) return new Response('not found', { status: 404 });
    return new Response(obj.body, { status: 200, headers: { ...common, 'content-length': String(size) } });
  }

  return { readIndex, upload, list, remove, serve, base };
}
