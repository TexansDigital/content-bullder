/**
 * The tag review studio (workstream 7, sql/700). Juan accepts or rejects a model tag in one tap.
 *
 * Every ask the feed makes rests on a tag: no player on a clip, no pick chip, nothing learned
 * about the fan who would have answered it. The model pass (tagger.js) writes what it finds at
 * 0.7. A person's verdict settles it: accept raises the label to 1.0 and marks it 'reviewed', so
 * the reviewed player leads the card and its chip; reject deletes it and records it in
 * feed_model_tag_runs.rejected with who and when, the examples a later prompt can learn from.
 *
 *   GET  /studio/tags   the page (app/tags.html). The key lives in the reviewer's browser.
 *   GET  /api/tags      with the upload key: the last 50 unreviewed model tags and the report.
 *   POST /api/tags      with the upload key: { video_id, type, slug, verdict: accept | reject }.
 *                       The reviewer's name comes from x-media-by, as it does for uploads.
 *
 * Both API routes need SUPABASE_SERVICE_KEY: the three functions are service key only.
 */
import { displayName } from '../../../src/rank.js';

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const VIDEO = /^[A-Za-z0-9_-]{6,20}$/;
const TYPES = new Set(['player', 'coach', 'staff', 'theme']);
const VERDICTS = new Set(['accept', 'reject']);
export const LIMIT = 50;

export function createTags({ fetch: get = (...a) => globalThis.fetch(...a), authorized, html = '' } = {}) {
  const base = (env) => String(env.SUPABASE_URL || 'https://xisvulbabqsyxnlyuwcz.supabase.co').replace(/\/$/, '');
  const headers = (env) => ({ apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, accept: 'application/json', 'content-type': 'application/json' });
  const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  const rpc = async (env, fn, args) => {
    const r = await get(`${base(env)}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(env), body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`tags: ${fn} ${r.status}`);
    return r.json();
  };

  function page() {
    if (!html) return new Response('not found', { status: 404 });
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'content-security-policy': "frame-ancestors 'none'" },
    });
  }

  async function list(env) {
    const [queue, report] = await Promise.all([rpc(env, 'feed_model_tag_queue', { lim: LIMIT }), rpc(env, 'feed_model_tag_review_report', {})]);
    const items = (Array.isArray(queue?.items) ? queue.items : []).map((i) => ({
      video_id: i.video_id, type: i.entity_type, slug: i.entity_slug, name: displayName(i.entity_slug, i.name ? { [i.entity_slug]: i.name } : {}),
      confidence: Number(i.confidence), title: i.title || '', description: i.description || '', published_at: i.published_at || null, asked_at: i.asked_at || null,
      poster: i.thumbnail_url || `https://i.ytimg.com/vi/${encodeURIComponent(i.video_id)}/hqdefault.jpg`,
      watch: `https://www.youtube.com/shorts/${encodeURIComponent(i.video_id)}`,
    }));
    return out({ pending: Number(queue?.pending) || 0, items, report: (Array.isArray(report) ? report[0] : report) || null });
  }

  async function review(request, env) {
    let b; try { b = await request.json(); } catch { return out({ error: 'send JSON: { video_id, type, slug, verdict }' }, 400); }
    const vid = String(b?.video_id || ''), type = String(b?.type || ''), slug = String(b?.slug || ''), verdict = String(b?.verdict || '');
    if (!VIDEO.test(vid) || !TYPES.has(type) || !SLUG.test(slug)) return out({ error: 'video_id, type and slug required' }, 400);
    if (!VERDICTS.has(verdict)) return out({ error: 'verdict is accept or reject' }, 400);
    const who = String(request.headers.get('x-media-by') || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    if (!who) return out({ error: 'say who is reviewing: the page asks for a first name' }, 400);
    const d = await rpc(env, 'feed_model_tag_review', { vid, etype: type, eslug: slug, verdict, reviewer: who });
    return out(d, d?.ok ? 200 : 409);
  }

  /** The one route seam app.js calls. Returns a Response for its paths, null for any other. */
  async function handle(request, env, method, p) {
    if (p === '/studio/tags') return method === 'GET' ? page() : null;
    if (p !== '/api/tags' || (method !== 'GET' && method !== 'POST')) return null;
    const denied = authorized(request, env); if (denied) return denied;
    if (!env.SUPABASE_SERVICE_KEY) return out({ error: 'tag review needs the SUPABASE_SERVICE_KEY secret' }, 503);
    try {
      return method === 'GET' ? await list(env) : await review(request, env);
    } catch (e) {
      console.error('txfeed tags', e?.message);
      return out({ error: 'tag review unavailable' }, 503);
    }
  }

  return { handle, page };
}
