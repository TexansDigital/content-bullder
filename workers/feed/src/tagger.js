/**
 * The model tagging pass. Approved by Adam 4 Nov 2026 ("do the small spend").
 *
 * The alias tagger (sql/090) sees a player only when a dictionary spelling appears in the
 * title, or a full name in the description. Two thirds of the served Shorts say "QB1 👆" or
 * "Tank had the perfect answer" or "Imi is going to hold it down", so they carry no player,
 * no chip ever asks the fan about them, and nothing is learned. This pass sends those clips,
 * ten at a time, to Claude with the same dictionary and writes back only slugs the dictionary
 * knows, as matched_on = 'model' with confidence capped at 0.7 so an alias title match always
 * outranks it. A clip is asked once (feed_model_tag_runs remembers it, found or not), and the
 * pass stops for the day at MODEL_TAG_DAILY_USD (default one dollar).
 *
 * Runs from the Worker's cron (every two hours at :45, after the alias pass at :25) and from
 * POST /api/tag/model with the upload key. GET with the key is a dry run: what would be asked
 * and written, nothing written. Without the ANTHROPIC_API_KEY secret the pass does nothing.
 *
 * Raw fetch rather than the SDK on purpose: this Worker has no npm dependencies (the deploy
 * is `wrangler deploy` with no install step) and every other service here is reached the
 * same way, through the one fetch seam the tests mock.
 */
const API = 'https://api.anthropic.com/v1/messages';
export const MODEL = 'claude-opus-5-5';
// Dollars per million tokens, Claude Opus 5.5 (input, output, cache write, cache read).
const PRICE = { input: 4, output: 20, cache_write: 5, cache_read: 0.2 };
const TYPES = ['player', 'coach', 'staff', 'theme'];
export const BATCH = 10;
export const MAX_CONF = 0.7;
export const MIN_CONF = 0.5;

const SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: { type: { type: 'string' }, slug: { type: 'string' }, confidence: { type: 'number' } },
              required: ['type', 'slug', 'confidence'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'entities'],
        additionalProperties: false,
      },
    },
  },
  required: ['clips'],
  additionalProperties: false,
};

const INSTRUCTIONS = `You tag short Houston Texans video clips for the club's own feed, from each clip's title and description.

For each clip, name which dictionary entities the clip is about. Use only slugs from the dictionary below, with their exact type.
- Players: tag a player when the clip shows or is about them: a full name, a surname, a nickname, a jersey number, a role in context (QB1 is the starting quarterback), or an unmistakable reference. Do not tag a player who is merely on the field among many, and never guess a player from the team name alone.
- Themes: music is a performance, concert, anthem, halftime show, DJ or 713 Sessions clip; toro is TORO the mascot, his pranks and fails; london is the London game trip.
- Coaches and staff only when the clip is about them.
- Opponents are never tagged here.
Confidence is how sure you are, 0.5 to 1. Leave entities empty when nothing fits; most clips have zero or one entity.

Context: the current Houston Texans. C.J. Stroud is QB1. Ka'imi Fairbairn is the kicker, called Imi. Marvin Harrison Jr. plays for the Texans.

Dictionary (type / slug: spellings):
`;

export function createTagger({ fetch: get = (...a) => globalThis.fetch(...a), now = () => new Date() } = {}) {
  const configured = (env) => Boolean(env.ANTHROPIC_API_KEY && env.SUPABASE_SERVICE_KEY);
  const base = (env) => String(env.SUPABASE_URL || 'https://xisvulbabqsyxnlyuwcz.supabase.co').replace(/\/$/, '');
  const dailyCap = (env) => { const n = Number(env.MODEL_TAG_DAILY_USD); return Number.isFinite(n) && n >= 0 ? n : 1; };
  const perRun = (env) => { const n = Number(env.MODEL_TAG_PER_RUN); return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 40; };

  const supaHeaders = (env, extra = {}) => ({ apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, accept: 'application/json', 'content-type': 'application/json', ...extra });

  /** The dictionary the alias tagger uses, grouped by type and slug, sorted so the cached prompt never moves. */
  async function dictionary(env) {
    const r = await get(`${base(env)}/rest/v1/feed_entity_aliases?select=entity_type,entity_slug,alias,tier&order=entity_type,entity_slug,tier,alias`, { headers: supaHeaders(env) });
    if (!r.ok) throw new Error(`tagger: aliases ${r.status}`);
    const rows = await r.json();
    const known = new Map(); // `${type}/${slug}` -> aliases[]
    for (const a of rows) {
      if (!TYPES.includes(a.entity_type) || !a.entity_slug) continue;
      const k = `${a.entity_type}/${a.entity_slug}`;
      if (!known.has(k)) known.set(k, []);
      known.get(k).push(String(a.alias));
    }
    const lines = [...known.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, aliases]) => `${k.replace('/', ' / ')}: ${[...new Set(aliases)].join(', ')}`);
    return { known, text: lines.join('\n') };
  }

  async function candidates(env, limit) {
    const r = await get(`${base(env)}/rest/v1/rpc/feed_model_tag_candidates`, {
      method: 'POST', headers: supaHeaders(env),
      body: JSON.stringify({ lim: limit, months: Number(env.CATALOGUE_MONTHS) || 12, served: Number(env.CATALOGUE_MAX) || 300 }),
    });
    if (!r.ok) throw new Error(`tagger: candidates ${r.status}`);
    const d = await r.json();
    return { spent: Number(d?.spent_24h) || 0, untagged: Number(d?.untagged_total) || 0, clips: Array.isArray(d?.candidates) ? d.candidates : [] };
  }

  const clipLine = (c) => `id: ${c.id}\ntitle: ${String(c.title || '').replace(/\s+/g, ' ').trim()}\ndescription: ${String(c.description || '').replace(/\s+/g, ' ').trim().slice(0, 600)}`;

  const cost = (u = {}) => (
    (Number(u.input_tokens) || 0) * PRICE.input
    + (Number(u.output_tokens) || 0) * PRICE.output
    + (Number(u.cache_creation_input_tokens) || 0) * PRICE.cache_write
    + (Number(u.cache_read_input_tokens) || 0) * PRICE.cache_read) / 1e6;

  /** One request for up to BATCH clips. Returns { byId: Map<id, entities[]>, usage, cost, model } or throws. */
  async function ask(env, dict, clips) {
    const body = {
      model: MODEL,
      max_tokens: 4000,
      fallbacks: 'default',
      system: [{ type: 'text', text: INSTRUCTIONS + dict.text, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Tag these ${clips.length} clips. Answer for every id.\n\n${clips.map(clipLine).join('\n\n')}` }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    };
    const r = await get(API, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json())?.error?.message || ''; } catch { /* no body */ }
      throw new Error(`tagger: claude ${r.status}${msg ? ` ${msg.slice(0, 160)}` : ''}`);
    }
    const d = await r.json();
    if (d.stop_reason === 'refusal') throw new Error(`tagger: claude refused (${d.stop_details?.category || 'no category'})`);
    const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('tagger: claude answered without JSON'); }
    const byId = new Map();
    for (const c of parsed?.clips || []) if (c && typeof c.id === 'string') byId.set(c.id, Array.isArray(c.entities) ? c.entities : []);
    return { byId, usage: d.usage || {}, cost: cost(d.usage), model: d.model || MODEL };
  }

  /** Keep only dictionary slugs of the right type, confidence clamped to [MIN_CONF, MAX_CONF]. */
  function accept(dict, proposed) {
    const labels = [], rejected = [];
    const seen = new Set();
    for (const e of proposed || []) {
      const type = String(e?.type || '').toLowerCase(), slug = String(e?.slug || '').toLowerCase().trim();
      const conf = Number(e?.confidence);
      const key = `${type}/${slug}`;
      if (!dict.known.has(key)) { rejected.push({ type, slug, confidence: conf }); continue; }
      if (!(conf >= MIN_CONF) || seen.has(key)) continue;
      seen.add(key);
      labels.push({ type, slug, confidence: Math.min(MAX_CONF, Math.round(conf * 100) / 100) });
    }
    return { labels, rejected };
  }

  async function write(env, rows, runs) {
    if (rows.length) {
      const r = await get(`${base(env)}/rest/v1/feed_video_entities?on_conflict=video_id,entity_type,entity_slug`, {
        method: 'POST', headers: supaHeaders(env, { prefer: 'resolution=ignore-duplicates,return=minimal' }), body: JSON.stringify(rows),
      });
      if (!r.ok) throw new Error(`tagger: write entities ${r.status}`);
    }
    const r = await get(`${base(env)}/rest/v1/feed_model_tag_runs?on_conflict=video_id`, {
      method: 'POST', headers: supaHeaders(env, { prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(runs),
    });
    if (!r.ok) throw new Error(`tagger: write runs ${r.status}`);
  }

  /**
   * The pass. { configured, asked, found, labels, rejected, cost_usd, spent_24h, cap_usd, untagged_before,
   * stopped: null | 'cap' | 'nothing to ask', batches, errors[], dry, sample[] }.
   */
  async function run(env, { limit, dry = false } = {}) {
    const out = { configured: configured(env), dry, asked: 0, found: 0, labels: 0, rejected: 0, cost_usd: 0, spent_24h: 0, cap_usd: dailyCap(env), untagged_before: 0, stopped: null, batches: 0, errors: [], sample: [], model: MODEL };
    if (!out.configured) { out.stopped = env.ANTHROPIC_API_KEY ? 'no service key' : 'no api key'; return out; }
    const want = Math.max(1, Math.min(Number(limit) || perRun(env), 200));
    const { spent, untagged, clips } = await candidates(env, want);
    out.spent_24h = spent; out.untagged_before = untagged;
    if (spent >= out.cap_usd) { out.stopped = 'cap'; return out; }
    if (!clips.length) { out.stopped = 'nothing to ask'; return out; }
    const dict = await dictionary(env);
    const at = now().toISOString();
    for (let i = 0; i < clips.length; i += BATCH) {
      if (out.spent_24h + out.cost_usd >= out.cap_usd) { out.stopped = 'cap'; break; }
      const batch = clips.slice(i, i + BATCH);
      let answer;
      try { answer = await ask(env, dict, batch); } catch (e) { out.errors.push(e?.message || 'ask failed'); break; }
      out.batches += 1; out.cost_usd += answer.cost;
      const share = answer.cost / batch.length;
      const u = answer.usage;
      const rows = [], runs = [];
      for (const c of batch) {
        const { labels, rejected } = accept(dict, answer.byId.get(c.id));
        out.asked += 1; out.labels += labels.length; out.rejected += rejected.length;
        if (labels.length) out.found += 1;
        if (out.sample.length < 20) out.sample.push({ id: c.id, title: c.title, labels, rejected });
        for (const l of labels) rows.push({ video_id: c.id, entity_type: l.type, entity_slug: l.slug, confidence: l.confidence, matched_on: 'model' });
        runs.push({ video_id: c.id, model: answer.model, asked_at: at, cost_usd: Number(share.toFixed(6)), labels, rejected,
          input_tokens: Math.round((Number(u.input_tokens) || 0) / batch.length), output_tokens: Math.round((Number(u.output_tokens) || 0) / batch.length),
          cache_read_tokens: Math.round((Number(u.cache_read_input_tokens) || 0) / batch.length), cache_write_tokens: Math.round((Number(u.cache_creation_input_tokens) || 0) / batch.length) });
      }
      if (dry) continue;
      try { await write(env, rows, runs); } catch (e) { out.errors.push(e?.message || 'write failed'); break; }
    }
    out.cost_usd = Number(out.cost_usd.toFixed(6));
    return out;
  }

  return { configured, run, dictionary, accept, INSTRUCTIONS, SCHEMA };
}
