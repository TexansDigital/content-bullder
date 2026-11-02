/**
 * Masters in R2, through the Worker's fetch seam. The bucket is an in-memory fake with the
 * same surface the Worker uses (get with range, head, put with onlyIf, delete). Supabase is
 * the same mock the worker suite uses: one Short, so a master can replace its embed.
 */
import { createApp } from '../workers/feed/src/app.js';
import { applyMedia, cardFromEntry, MAX_MEDIA_BYTES } from '../workers/feed/src/media.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);

/** A small R2. Objects hold bytes, a content type and an etag that changes on every put. */
function fakeBucket() {
  const store = new Map(); let n = 0;
  const etagOf = () => `"e${++n}"`;
  return {
    store,
    async head(key) { const o = store.get(key); return o ? { size: o.bytes.byteLength, etag: o.etag, httpEtag: o.etag, httpMetadata: { contentType: o.type } } : null; },
    async get(key, opts = {}) {
      const o = store.get(key); if (!o) return null;
      let bytes = o.bytes;
      if (opts.range) bytes = bytes.slice(opts.range.offset, opts.range.offset + opts.range.length);
      return { body: bytes, size: o.bytes.byteLength, etag: o.etag, httpEtag: o.etag, httpMetadata: { contentType: o.type }, text: async () => new TextDecoder().decode(o.bytes) };
    },
    async put(key, body, opts = {}) {
      const cur = store.get(key);
      if (opts.onlyIf instanceof Headers) { if (opts.onlyIf.get('if-none-match') === '*' && cur) return null; }
      else if (opts.onlyIf?.etagMatches && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
      const o = { bytes, type: opts.httpMetadata?.contentType || 'application/octet-stream', etag: etagOf() };
      store.set(key, o); return o;
    },
    async delete(key) { store.delete(key); },
  };
}

const VIDEOS = [{ id: 'Tq3sz_Yf-Nk', title: 'Tank is BACK', description: '', published_at: '2026-10-20T18:00:00Z', duration_seconds: 18, thumbnail_url: 'https://i.ytimg.com/vi/Tq3sz_Yf-Nk/hq720.jpg', lifetime_views: 1 }];
const mock = async (url) => {
  const path = url.split('/rest/v1/')[1] || '';
  const table = path.split('?')[0];
  const idEq = /[?&]id=eq\.([^&]+)/.exec(path);
  const body = { videos: idEq ? VIDEOS.filter((v) => v.id === decodeURIComponent(idEq[1])) : VIDEOS, excluded_players: [{ name: 'Deshaun Watson' }], feed_items: [], feed_entity_aliases: [], feed_presets: [], feed_boost_offers: [], feed_experiments: [], feed_preferences: [], short_labels: [], feed_video_entities: [], short_content_types: [], texans_games: [] }[table];
  return { ok: body !== undefined, status: body !== undefined ? 200 : 404, json: async () => body || [], text: async () => JSON.stringify(body || []) };
};
const MEDIA = fakeBucket();
const ENV = { SUPABASE_SERVICE_KEY: 'service-secret', POCKET_FEEDS: '', MEDIA, MEDIA_UPLOAD_KEY: 'open-sesame' };
const waits = []; const ctx = { waitUntil: (p) => waits.push(p) };
let clock = Date.parse('2026-11-02T06:00:00Z');
const app = createApp({ feedHtml: '<!doctype html><title>feed</title>', uploadHtml: '<!doctype html><title>Feed Masters</title>', deps: { fetch: mock, cache: null, now: () => new Date(clock) } });
const req = (path, init) => new Request(`https://feed.htow.nz${path}`, init);
const mp4 = (n) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 251));
const post = (path, body, type, key = 'open-sesame', extra = {}) => app.fetch(req(path, { method: 'POST', body, headers: { 'content-type': type, 'x-media-key': key, 'content-length': String(body.byteLength || body.length), ...extra } }), ENV, ctx);

// ---- the page and the gates ----
let r = await app.fetch(req('/studio/upload'), ENV, ctx);
t('the upload page is served and may not be framed', r.status === 200 && r.headers.get('content-security-policy') === "frame-ancestors 'none'" && (await r.text()).includes('Feed Masters'));
r = await post('/api/media?for=yt-Tq3sz_Yf-Nk', mp4(100), 'video/mp4', 'wrong');
t('a wrong key is refused', r.status === 401);
r = await app.fetch(req('/api/media?for=yt-Tq3sz_Yf-Nk', { method: 'POST', body: mp4(10), headers: { 'content-type': 'video/mp4' } }), { ...ENV, MEDIA_UPLOAD_KEY: undefined }, ctx);
t('without the secret, uploads say they are not enabled', r.status === 503 && /MEDIA_UPLOAD_KEY/.test(await r.text()));
r = await post('/api/media?for=yt-Tq3sz_Yf-Nk', mp4(10), 'application/zip');
t('an unsupported type is refused with the list of accepted ones', r.status === 415 && /video\/mp4/.test(await r.text()));
r = await post('/api/media?for=yt-Tq3sz_Yf-Nk', mp4(10), 'video/mp4', 'open-sesame', { 'content-length': String(MAX_MEDIA_BYTES + 1) });
t('a body over the limit is refused before it is read', r.status === 413);
r = await post('/api/media', mp4(10), 'video/mp4');
t('an upload must say what it is', r.status === 400 && /for=/.test(await r.text()));
r = await post('/api/media?for=yt-Tq3sz_Yf-Nk', mp4(10), 'image/jpeg');
t('a master for a card has to be a video', r.status === 415);
r = await post('/api/media?for=yt-Tq3sz_Yf-Nk', new Uint8Array(0), 'video/mp4');
t('an empty body is refused', r.status === 400);
r = await app.fetch(req('/health'), ENV, ctx);
let h = await r.json();
t('health says media is bound and uploads are enabled', h.media === true && h.uploads === true && h.counts.masters === 0 && h.counts.studio === 0);

// ---- a master for the Short ----
clock += 1000;
r = await post('/api/media?for=yt-Tq3sz_Yf-Nk', mp4(5000), 'video/mp4', 'open-sesame', { 'x-media-by': 'Adam' });
let d = await r.json();
t('a master is stored and answers with its served URL', r.status === 200 && d.ok && d.kind === 'master' && d.for === 'yt-Tq3sz_Yf-Nk' && /^https:\/\/feed\.htow\.nz\/media\/masters\/yt-Tq3sz_Yf-Nk\/[a-z0-9]+\.mp4$/.test(d.url) && d.by === 'Adam' && d.bytes === 5000);
const masterKey = d.key, masterId = d.id;
t('the bytes landed under the key with the video type', MEDIA.store.get(masterKey)?.type === 'video/mp4' && MEDIA.store.get(masterKey)?.bytes.byteLength === 5000);
t('the index lists it', JSON.parse(new TextDecoder().decode(MEDIA.store.get('index.json').bytes)).items.length === 1);

// the poster frame the page takes
r = await post(`/api/media?poster=${masterId}`, mp4(300), 'image/jpeg');
d = await r.json();
t('a poster attaches to the uploaded item', r.status === 200 && d.ok && /^posters\//.test(d.posterKey));
r = await post('/api/media?poster=nope-not-here', mp4(300), 'image/jpeg');
t('a poster for an unknown item is refused and its bytes dropped', r.status === 404 && ![...MEDIA.store.keys()].some((k) => k.startsWith('posters/nope')));
r = await post(`/api/media?poster=${masterId}`, mp4(300), 'video/mp4');
t('a poster must be an image', r.status === 415);

// ---- it plays from our file now ----
r = await app.fetch(req('/api/feed'), ENV, ctx);
d = await r.json();
let card = d.clips.find((c) => c.id === 'yt-Tq3sz_Yf-Nk');
t('the card now plays from the master, keeps its headline and its YouTube posters behind ours',
  card && card.media.kind === 'file' && card.media.url === `https://feed.htow.nz/media/${masterKey}` && card.headline === 'Tank is BACK' && /posters\//.test(card.poster[0]) && /ytimg/.test(card.poster[1]) && card.flags.master === true);
r = await app.fetch(req('/health'), ENV, ctx); h = await r.json();
t('health counts the master', h.counts.masters === 1);

// ---- serving with range ----
r = await app.fetch(req(`/media/${masterKey}`), ENV, ctx);
t('the file is served whole with a year of cache and open CORS', r.status === 200 && r.headers.get('content-type') === 'video/mp4' && r.headers.get('content-length') === '5000' && /immutable/.test(r.headers.get('cache-control')) && r.headers.get('access-control-allow-origin') === '*' && r.headers.get('accept-ranges') === 'bytes');
r = await app.fetch(req(`/media/${masterKey}`, { headers: { range: 'bytes=100-199' } }), ENV, ctx);
let buf = new Uint8Array(await r.arrayBuffer());
t('a byte range answers 206 with the right slice', r.status === 206 && r.headers.get('content-range') === 'bytes 100-199/5000' && buf.length === 100 && buf[0] === 100 % 251);
r = await app.fetch(req(`/media/${masterKey}`, { headers: { range: 'bytes=4900-' } }), ENV, ctx);
t('an open-ended range runs to the end', r.status === 206 && r.headers.get('content-range') === 'bytes 4900-4999/5000');
r = await app.fetch(req(`/media/${masterKey}`, { headers: { range: 'bytes=-10' } }), ENV, ctx);
t('a suffix range gives the last bytes', r.status === 206 && r.headers.get('content-range') === 'bytes 4990-4999/5000');
r = await app.fetch(req(`/media/${masterKey}`, { headers: { range: 'bytes=9000-' } }), ENV, ctx);
t('a range past the end is 416', r.status === 416);
r = await app.fetch(req('/media/masters/x/../../index.json'), ENV, ctx);
t('only media keys are served, never the index', r.status === 404);
r = await app.fetch(req('/media/index.json'), ENV, ctx);
t('the index itself is not public', r.status === 404);
r = await app.fetch(req(`/media/${masterKey}`), { ...ENV, MEDIA: undefined }, ctx);
t('without a bucket /media is a 404, not an error', r.status === 404);

// ---- a new card from a file ----
clock += 1000;
r = await post('/api/media?new=1&headline=Toyota%20Toy%20Drive%20at%20Reliant%20Stadium&collection=community&players=c-j-stroud,%20bad%20slug&caption=Hi&action=https://www.houstontexans.com/community&action_label=Join%20in&tags=community-story,Toyota&shelf=evergreen', mp4(800), 'video/mp4', 'open-sesame', { 'x-media-by': 'Juan' });
d = await r.json();
t('a new card is created with its copy, collection, player, link and tags', r.status === 200 && d.kind === 'card' && /^st-/.test(d.id) && d.collection === 'community' && d.players.join() === 'c-j-stroud' && d.actionUrl === 'https://www.houstontexans.com/community' && d.tags.join() === 'community-story,toyota' && d.shelfLife === 'evergreen');
const newId = d.id;
r = await post('/api/media?new=1&headline=&collection=community', mp4(10), 'video/mp4');
t('a new card needs a headline', r.status === 400);
r = await post('/api/media?new=1&headline=x&collection=nope', mp4(10), 'video/mp4');
t('a new card needs a real collection', r.status === 400 && /community/.test(await r.text()));
r = await post('/api/media?new=1&headline=Night%20with%20Deshaun%20Watson&collection=players', mp4(10), 'video/mp4');
const bannedId = (await r.json()).id;
r = await post('/api/media?new=1&headline=Off%20site&collection=players&action=https://evil.example/x', mp4(10), 'image/png');
d = await r.json();
t('a link off the club site is dropped, and a graphic is a card too', r.status === 200 && d.actionUrl === null && d.type === 'image/png');
const graphicId = d.id;

r = await app.fetch(req('/api/feed'), ENV, ctx);
d = await r.json();
card = d.clips.find((c) => c.id === newId);
t('the new card is in the feed, in its collection, with the poster the page sent or none, playing our file',
  card && card.collection === 'community' && card.media.kind === 'file' && card.entities.players.join() === 'c-j-stroud' && card.action.url === 'https://www.houstontexans.com/community' && card.action.label === 'Join in' && card.flags.tags.includes('community-story'));
t('a new card naming an excluded player never reaches the feed', !d.clips.some((c) => c.id === bannedId));
const graphic = d.clips.find((c) => c.id === graphicId);
t('a graphic is an image card that is its own poster', graphic && graphic.media.kind === 'image' && graphic.poster[0] === graphic.media.url);
r = await app.fetch(req('/health'), ENV, ctx); h = await r.json();
t('health counts the studio cards that serve, not the excluded one', h.counts.studio === 2 && h.counts.masters === 1);

// ---- where a Short stands, by link ----
r = await app.fetch(req('/api/media/lookup?yt=Tq3sz_Yf-Nk'), ENV, ctx);
t('lookup needs the key', r.status === 401);
r = await app.fetch(req('/api/media/lookup?yt=Tq3sz_Yf-Nk', { headers: { 'x-media-key': 'open-sesame' } }), ENV, ctx);
d = await r.json();
t('a live Short answers live, with its headline and poster', r.status === 200 && d.live === true && d.inCatalogue === true && d.title === 'Tank is BACK' && d.id === 'yt-Tq3sz_Yf-Nk' && d.why === null);
r = await app.fetch(req('/api/media/lookup?yt=notInAnything', { headers: { 'x-media-key': 'open-sesame' } }), ENV, ctx);
d = await r.json();
t('a Short the pipeline never saw says so', d.live === false && d.inCatalogue === false && /not in the catalogue/.test(d.why));
{
  // In the catalogue but older than the window the feed serves: the answer names the dates.
  const old = { id: 'EPDJ3lsqwok', title: 'Knocked the SONIC RINGS out of him', published_at: '2025-12-09T17:01:34Z', duration_seconds: 16 };
  const mock2 = async (url) => { if (/videos\?.*id=eq\.EPDJ3lsqwok/.test(url)) return { ok: true, status: 200, json: async () => [old], text: async () => JSON.stringify([old]) }; return mock(url); };
  const app2 = createApp({ feedHtml: 'x', deps: { fetch: mock2, cache: null } });
  r = await app2.fetch(req('/api/media/lookup?yt=EPDJ3lsqwok', { headers: { 'x-media-key': 'open-sesame' } }), ENV, ctx);
  d = await r.json();
  t('a Short older than the served window is explained with both dates', d.live === false && d.inCatalogue === true && d.title === old.title && /published 2025-12-09, before the oldest Short the feed serves \(2026-10-20\)/.test(d.why) && /300 newest/.test(d.why));
}
r = await app.fetch(req('/api/media/lookup?yt=bad%20id', { headers: { 'x-media-key': 'open-sesame' } }), ENV, ctx);
t('a malformed id is a 400', r.status === 400);

// ---- the list and removal ----
r = await app.fetch(req('/api/media'), ENV, ctx);
t('the list needs the key', r.status === 401);
r = await app.fetch(req('/api/media', { headers: { 'x-media-key': 'open-sesame' } }), ENV, ctx);
d = await r.json();
t('the list is newest first with served URLs and who uploaded', d.items[0].id === graphicId && d.items.at(-1).id === masterId && d.items.at(-1).by === 'Adam' && /^https:\/\/feed\.htow\.nz\/media\//.test(d.items[0].url) && d.items.at(-1).posterUrl);
r = await app.fetch(req(`/api/media?id=${masterId}`, { method: 'DELETE', headers: { 'x-media-key': 'open-sesame' } }), ENV, ctx);
t('removing a master drops its bytes and its poster', r.status === 200 && !MEDIA.store.has(masterKey) && ![...MEDIA.store.keys()].some((k) => k.startsWith(`posters/${masterId}`)));
r = await app.fetch(req('/api/feed'), ENV, ctx); d = await r.json();
card = d.clips.find((c) => c.id === 'yt-Tq3sz_Yf-Nk');
t('the card goes back to its YouTube embed', card && card.media.kind === 'youtube' && !card.flags.master);
r = await app.fetch(req('/api/media?id=never-was', { method: 'DELETE', headers: { 'x-media-key': 'open-sesame' } }), ENV, ctx);
t('removing an unknown id is a 404', r.status === 404);

// ---- two uploads at once: the index write is conditional ----
{
  const racy = fakeBucket();
  const origPut = racy.put.bind(racy); let raced = false;
  racy.put = async (key, body, opts) => {
    // Someone else wrote the index between our read and our write, once.
    if (key === 'index.json' && !raced) { raced = true; await origPut('index.json', JSON.stringify({ items: [{ id: 'other', kind: 'card', key: 'cards/other/aaaa.mp4', type: 'video/mp4', headline: 'Other', collection: 'gameday' }] }), { httpMetadata: { contentType: 'application/json' } }); }
    return origPut(key, body, opts);
  };
  const env2 = { ...ENV, MEDIA: racy };
  r = await app.fetch(req('/api/media?for=yt-Tq3sz_Yf-Nk', { method: 'POST', body: mp4(10), headers: { 'content-type': 'video/mp4', 'x-media-key': 'open-sesame' } }), env2, ctx);
  const idx = JSON.parse(new TextDecoder().decode(racy.store.get('index.json').bytes));
  t('a concurrent index write is not lost: both entries survive', r.status === 200 && idx.items.length === 2 && idx.items.some((e) => e.id === 'other') && idx.items.some((e) => e.kind === 'master'));
}

// ---- the pure merge ----
{
  const items = [{ id: 'a', headline: 'A', media: { kind: 'youtube', videoId: 'x' }, poster: ['https://i.ytimg.com/x.jpg'], flags: {} }];
  const idx = { items: [
    { id: 'm1', kind: 'master', for: 'a', key: 'masters/a/1.mp4', type: 'video/mp4' },
    { id: 'm2', kind: 'master', for: 'a', key: 'masters/a/2.mp4', type: 'video/mp4', posterKey: 'posters/m2/p.jpg' },
    { id: 'st-1', kind: 'card', key: 'cards/st-1/1.mp4', type: 'video/mp4', headline: 'New', collection: 'gameday', uploadedAt: '2026-11-02T00:00:00Z' },
    { id: 'a', kind: 'card', key: 'cards/a/1.mp4', type: 'video/mp4', headline: 'Dup', collection: 'gameday' },
  ] };
  const m = applyMedia(items, idx, { base: 'https://x.test' });
  t('the newest master for a card wins and brings its poster first', m.replaced === 1 && m.items[0].media.url === 'https://x.test/media/masters/a/2.mp4' && m.items[0].poster[0] === 'https://x.test/media/posters/m2/p.jpg' && m.items[0].poster[1] === 'https://i.ytimg.com/x.jpg');
  t('a new card joins; one whose id already exists does not', m.added === 1 && m.items.length === 2 && m.items[1].id === 'st-1');
  const c = cardFromEntry({ id: 'st-9', key: 'cards/st-9/1.jpg', type: 'image/jpeg', headline: 'G', collection: 'flag', uploadedAt: '2026-11-02T00:00:00Z' }, 'https://x.test');
  t('a graphic card holds as an image and is tagged community content', c.media.kind === 'image' && c.contentType === 'community' && c.status === 'inbox' && c.publishedAt === '2026-11-02T00:00:00Z');
}

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
