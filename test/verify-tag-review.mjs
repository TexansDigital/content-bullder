/**
 * The tag review studio through mocks: the page, the key, the queue it lists, the verdicts it
 * sends, and the SQL it rests on (sql/700). Nothing here reaches the network.
 */
import { readFileSync } from 'node:fs';
import { createTags, LIMIT } from '../workers/feed/src/tags.js';
import { createApp } from '../workers/feed/src/app.js';
import { displayName } from '../src/rank.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

const QUEUE = {
  pending: 20,
  items: [
    { video_id: 'f1qE28Sn8yc', entity_type: 'player', entity_slug: 'c-j-stroud', confidence: 0.7, name: 'c.j. stroud', title: 'QB1 🫶', description: 'Subscribe', thumbnail_url: 'https://i.ytimg.com/vi/f1qE28Sn8yc/default.jpg', published_at: '2026-11-02T18:00:00Z', asked_at: '2026-11-04T10:45:00Z' },
    { video_id: 'NA_7du9c8F8', entity_type: 'player', entity_slug: 'tank-dell', confidence: 0.7, name: null, title: 'Houston, fill it up 🔊', description: '', thumbnail_url: null, published_at: '2026-11-01T18:00:00Z', asked_at: '2026-11-04T10:45:00Z' },
    { video_id: 'vJQaoaoas94', entity_type: 'player', entity_slug: 'ka-imi-fairbairn', confidence: 0.7, name: "ka'imi fairbairn", title: 'WE GOT IMI ON OUR TEAM', description: '', thumbnail_url: 'https://x/y.jpg', published_at: null, asked_at: null },
  ],
};
const REPORT = [{ reviewed_24h: 4, accepted_24h: 3, rejected_24h: 1, accept_rate_24h: 0.75, reviewed: 4, accepted: 3, rejected: 1, accept_rate: 0.75, pending: 20, reviewers: 1, most_rejected: 'player/tank-dell', last_reviewed_at: '2026-11-04T11:00:00Z' }];

/** A mock of Supabase's three functions. `review` answers the verdict RPC. */
function world({ review = (a) => ({ ok: true, verdict: a.verdict, video_id: a.vid, type: a.etype, slug: a.eslug, record: { reviewed_by: a.reviewer } }), status = 200 } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (status !== 200) return res(status, { message: 'down' });
    if (/\/rest\/v1\/rpc\/feed_model_tag_queue$/.test(url)) return res(200, QUEUE);
    if (/\/rest\/v1\/rpc\/feed_model_tag_review_report$/.test(url)) return res(200, REPORT);
    if (/\/rest\/v1\/rpc\/feed_model_tag_review$/.test(url)) return res(200, review(JSON.parse(opts.body)));
    return res(200, []);
  };
  return { calls, fetch, rpc: (fn) => calls.filter((c) => c.url.endsWith(`/rpc/${fn}`)) };
}
const KEY = 'open-sesame';
const ENV = { MEDIA: {}, MEDIA_UPLOAD_KEY: KEY, SUPABASE_SERVICE_KEY: 'service', SUPABASE_URL: 'https://x.supabase.co' };
const PAGE = readFileSync(new URL('../app/tags.html', import.meta.url), 'utf8');
const req = (path, init) => new Request(`https://feed.htow.nz${path}`, init);
const keyed = (extra = {}) => ({ 'x-media-key': KEY, ...extra });
const post = (body, headers = keyed({ 'x-media-by': 'Juan' })) => req('/api/tags', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const ctx = { waitUntil: () => {} };

/* ---------- the page ---------- */
{
  const w = world();
  const app = createApp({ feedHtml: 'x', tagsHtml: PAGE, deps: { fetch: w.fetch, cache: null } });
  const r = await app.fetch(req('/studio/tags'), {}, ctx);
  const html = await r.text();
  t('GET /studio/tags serves the page with no key and no secrets in it', r.status === 200 && /<title>Tag Review<\/title>/.test(html) && !html.includes(KEY) && !/service/i.test(r.headers.get('set-cookie') || ''));
  t('the page is never framed, never cached, never sends a referrer', r.headers.get('content-security-policy') === "frame-ancestors 'none'" && /no-store/.test(r.headers.get('cache-control')) && r.headers.get('referrer-policy') === 'no-referrer');
  t('a trailing slash and HEAD reach it too', (await app.fetch(req('/studio/tags/'), {}, ctx)).status === 200 && (await app.fetch(req('/studio/tags', { method: 'HEAD' }), {}, ctx)).status === 200);
  t('without the bundled page the route is a plain 404', (await createApp({ feedHtml: 'x', deps: { fetch: w.fetch } }).fetch(req('/studio/tags'), {}, ctx)).status === 404);
  t('a POST to the page path is not found', (await app.fetch(req('/studio/tags', { method: 'POST' }), ENV, ctx)).status === 404);
  t('the key lives in the browser under the same name as the masters page', /localStorage\.getItem\(KEY\)/.test(PAGE) && /'txfeed_media_key'/.test(PAGE) && /'txfeed_media_by'/.test(PAGE));
  t('it calls /api/tags with x-media-key and sends who is reviewing', /fetch\('\/api\/tags', \{ headers: \{ 'x-media-key': key \}/.test(PAGE) && /'x-media-by': who\(\)/.test(PAGE));
  t('the page uses the brand palette and never names the other stadium', ['#021018', '#ED0028', '#0080C6', '#FFFFFF'].every((c) => PAGE.includes(c)) && !/NRG/i.test(PAGE));
  t('the page escapes what it shows', /const esc = /.test(PAGE) && /\$\{esc\(i\.title\)\}/.test(PAGE) && /\$\{esc\(i\.name\)\}/.test(PAGE));
  t('the buttons are thumb-sized on a phone', /\.acts button\{[^}]*min-height:44px/.test(PAGE));
}

/* ---------- the key and the service key ---------- */
{
  const w = world();
  const app = createApp({ feedHtml: 'x', tagsHtml: PAGE, deps: { fetch: w.fetch } });
  let r = await app.fetch(req('/api/tags'), ENV, ctx);
  t('GET /api/tags without the key is 401 and asks Supabase nothing', r.status === 401 && w.calls.length === 0);
  r = await app.fetch(req('/api/tags', { headers: { 'x-media-key': 'open-sesamE' } }), ENV, ctx);
  t('a wrong key of the same length is refused', r.status === 401);
  r = await app.fetch(post({ video_id: 'f1qE28Sn8yc', type: 'player', slug: 'c-j-stroud', verdict: 'accept' }, { 'x-media-by': 'Juan' }), ENV, ctx);
  t('POST without the key is 401 and writes nothing', r.status === 401 && w.rpc('feed_model_tag_review').length === 0);
  r = await app.fetch(req('/api/tags', { headers: keyed() }), { MEDIA: {}, MEDIA_UPLOAD_KEY: KEY }, ctx);
  t('without the service key it answers 503 and names the secret', r.status === 503 && /SUPABASE_SERVICE_KEY/.test((await r.json()).error));
  r = await app.fetch(req('/api/tags', { headers: keyed() }), { SUPABASE_SERVICE_KEY: 'service' }, ctx);
  t('without uploads enabled it is the same 503 as the masters routes', r.status === 503);
  r = await app.fetch(req('/api/tags', { method: 'DELETE', headers: keyed() }), ENV, ctx);
  t('other methods fall through to not found', r.status === 404);
}

/* ---------- the queue ---------- */
{
  const w = world();
  const app = createApp({ feedHtml: 'x', tagsHtml: PAGE, deps: { fetch: w.fetch } });
  const r = await app.fetch(req('/api/tags', { headers: keyed() }), ENV, ctx);
  const d = await r.json();
  const q = w.rpc('feed_model_tag_queue')[0];
  t(`the queue asks for the last ${LIMIT} with the service key`, LIMIT === 50 && JSON.parse(q.opts.body).lim === 50 && q.opts.headers.authorization === 'Bearer service' && q.opts.headers.apikey === 'service' && q.opts.method === 'POST');
  t('the report is read in the same load', w.rpc('feed_model_tag_review_report').length === 1 && d.report.accept_rate_24h === 0.75 && d.report.most_rejected === 'player/tank-dell');
  t('never cached, JSON', r.status === 200 && /no-store/.test(r.headers.get('cache-control')) && /application\/json/.test(r.headers.get('content-type')));
  t('pending and three items come back', d.pending === 20 && d.items.length === 3);
  const [a, b, c] = d.items;
  t('each item carries the clip, the label and what the model said', a.video_id === 'f1qE28Sn8yc' && a.type === 'player' && a.slug === 'c-j-stroud' && a.confidence === 0.7 && a.title === 'QB1 🫶' && a.description === 'Subscribe');
  t('names read as the feed chip writes them: C.J. Stroud, and Tank Dell from the slug when no alias came back', a.name === 'C.J. Stroud' && b.name === 'Tank Dell' && c.name === displayName('ka-imi-fairbairn', { 'ka-imi-fairbairn': "ka'imi fairbairn" }));
  t('the poster is the thumbnail, or the YouTube still when there is none', a.poster === 'https://i.ytimg.com/vi/f1qE28Sn8yc/default.jpg' && b.poster === 'https://i.ytimg.com/vi/NA_7du9c8F8/hqdefault.jpg');
  t('each item links to the Short to watch', a.watch === 'https://www.youtube.com/shorts/f1qE28Sn8yc');
  const down = world({ status: 500 });
  const r2 = await createApp({ feedHtml: 'x', deps: { fetch: down.fetch } }).fetch(req('/api/tags', { headers: keyed() }), ENV, ctx);
  t('a Supabase failure is a 503 that leaks nothing', r2.status === 503 && (await r2.json()).error === 'tag review unavailable');
}

/* ---------- verdicts ---------- */
{
  const w = world();
  const app = createApp({ feedHtml: 'x', tagsHtml: PAGE, deps: { fetch: w.fetch } });
  let r = await app.fetch(post({ video_id: 'f1qE28Sn8yc', type: 'player', slug: 'c-j-stroud', verdict: 'accept' }), ENV, ctx);
  let d = await r.json();
  const call = w.rpc('feed_model_tag_review')[0];
  t('accept goes to feed_model_tag_review with the clip, label, verdict and reviewer', r.status === 200 && d.ok === true && JSON.stringify(JSON.parse(call.opts.body)) === JSON.stringify({ vid: 'f1qE28Sn8yc', etype: 'player', eslug: 'c-j-stroud', verdict: 'accept', reviewer: 'Juan' }));
  r = await app.fetch(post({ video_id: 'NA_7du9c8F8', type: 'player', slug: 'tank-dell', verdict: 'reject' }), ENV, ctx);
  t('reject goes the same way', r.status === 200 && JSON.parse(w.rpc('feed_model_tag_review')[1].opts.body).verdict === 'reject');
  const n = w.rpc('feed_model_tag_review').length;
  const tries = [
    ['a verdict other than accept or reject', { video_id: 'f1qE28Sn8yc', type: 'player', slug: 'c-j-stroud', verdict: 'maybe' }],
    ['an opponent label (never model-tagged)', { video_id: 'f1qE28Sn8yc', type: 'opponent', slug: 'colts', verdict: 'reject' }],
    ['a slug with a filter in it', { video_id: 'f1qE28Sn8yc', type: 'player', slug: 'c-j-stroud&matched_on=eq.title', verdict: 'reject' }],
    ['a malformed video id', { video_id: '../x', type: 'player', slug: 'c-j-stroud', verdict: 'accept' }],
  ];
  for (const [name, body] of tries) {
    r = await app.fetch(post(body), ENV, ctx);
    t(`${name} is a 400`, r.status === 400);
  }
  r = await app.fetch(post('not json'), ENV, ctx);
  t('a body that is not JSON is a 400', r.status === 400);
  r = await app.fetch(post({ video_id: 'f1qE28Sn8yc', type: 'player', slug: 'c-j-stroud', verdict: 'accept' }, keyed()), ENV, ctx);
  d = await r.json();
  t('a verdict without a reviewer name is refused: every verdict says who made it', r.status === 400 && /who/.test(d.error));
  t('none of the refused verdicts reached Supabase', w.rpc('feed_model_tag_review').length === n);
  r = await app.fetch(post({ video_id: 'f1qE28Sn8yc', type: 'player', slug: 'c-j-stroud', verdict: 'accept' }, keyed({ 'x-media-by': '  Juan Pablo with a very long name indeed, more than forty  ' })), ENV, ctx);
  t('the reviewer name is trimmed to 40 characters', JSON.parse(w.rpc('feed_model_tag_review').at(-1).opts.body).reviewer.length === 40);
  const twice = world({ review: () => ({ ok: false, error: 'no unreviewed model tag for that clip and label' }) });
  r = await createApp({ feedHtml: 'x', deps: { fetch: twice.fetch } }).fetch(post({ video_id: 'f1qE28Sn8yc', type: 'player', slug: 'c-j-stroud', verdict: 'reject' }), ENV, ctx);
  d = await r.json();
  t('a second tap on a settled tag is a 409 with the reason', r.status === 409 && d.ok === false && /no unreviewed/.test(d.error));
}

/* ---------- the module on its own ---------- */
{
  const w = world();
  const tags = createTags({ fetch: w.fetch, authorized: () => null, html: PAGE });
  t('handle() returns null for paths it does not own', (await tags.handle(req('/api/feed'), ENV, 'GET', '/api/feed')) === null && (await tags.handle(req('/api/tags'), ENV, 'PUT', '/api/tags')) === null);
}

/* ---------- the SQL (sql/700) ---------- */
{
  const sql = readFileSync(new URL('../sql/700-feed-model-tag-review.sql', import.meta.url), 'utf8');
  const fns = ['feed_model_tag_queue(integer)', 'feed_model_tag_review(text, text, text, text, text)', 'feed_model_tag_review_report()'];
  t('all three functions exist and are revoked from anon and authenticated', fns.every((f) => sql.includes(`function public.${f.split('(')[0]}(`) && new RegExp(`revoke execute on function public\\.${f.replace(/[()]/g, '\\$&')} from public, anon, authenticated`).test(sql)));
  t('the queue lists only matched_on = model rows joined to the run and the video', /where e\.matched_on = 'model'/.test(sql) && /join public\.feed_model_tag_runs r on r\.video_id = e\.video_id/.test(sql) && /join public\.videos v on v\.id = e\.video_id/.test(sql));
  t('accept sets confidence 1.0 and matched_on reviewed', /set confidence = 1\.0, matched_on = 'reviewed'/.test(sql));
  t('reject deletes the label and appends to rejected with reviewed_by and reviewed_at', /delete from public\.feed_video_entities/.test(sql) && /set rejected = rejected \|\| jsonb_build_array\(rec\)/.test(sql) && /'reviewed_by'/.test(sql) && /'reviewed_at', now\(\)/.test(sql));
  t('a verdict needs a row still at model, under a lock, so a double tap records once', /e\.matched_on = 'model'\s+for update/.test(sql) && /if not found then/.test(sql));
  t('accepts are kept in their own list so the rate is a count', /add column if not exists accepted jsonb not null default '\[\]'/.test(sql) && /set accepted = accepted \|\| jsonb_build_array\(rec\)/.test(sql));
  t('the report counts only reviewed rejections, not dictionary refusals', /where x \? 'reviewed_at'/.test(sql) && /accept_rate_24h/.test(sql) && /most_rejected/.test(sql));
  t('the SQL never names the other stadium', !/NRG/i.test(sql));
}

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
