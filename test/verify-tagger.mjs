/**
 * The model tagging pass through mocks: what it asks Claude, what it accepts back, what it
 * writes, when it stops, and the routes and cron that run it. Nothing here reaches the network.
 */
import { createTagger, MODEL, MAX_CONF, MIN_CONF, BATCH } from '../workers/feed/src/tagger.js';
import { createApp } from '../workers/feed/src/app.js';

const ok = [], bad = [];
const t = (n, c) => (c ? ok : bad).push(n);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

const ALIASES = [
  { entity_type: 'player', entity_slug: 'c-j-stroud', alias: 'c.j. stroud', tier: 1 },
  { entity_type: 'player', entity_slug: 'c-j-stroud', alias: 'stroud', tier: 2 },
  { entity_type: 'player', entity_slug: 'tank-dell', alias: 'tank dell', tier: 1 },
  { entity_type: 'player', entity_slug: 'tank-dell', alias: 'tank', tier: 3 },
  { entity_type: 'player', entity_slug: 'ka-imi-fairbairn', alias: "ka'imi fairbairn", tier: 1 },
  { entity_type: 'coach', entity_slug: 'demeco-ryans', alias: 'demeco ryans', tier: 1 },
  { entity_type: 'theme', entity_slug: 'toro', alias: 'toro', tier: 1 },
  { entity_type: 'theme', entity_slug: 'toro', alias: 'mascot', tier: 2 },
  { entity_type: 'opponent', entity_slug: 'colts', alias: 'colts', tier: 1 },
];
const CLIPS = [
  { id: 'v1', title: 'QB1 👆', description: 'Subscribe: https://bit.ly/x' },
  { id: 'v2', title: 'Tackled? "Felt cool, actually." 😂', description: 'Asked about the fear of getting hit again, Tank had the perfect answer. #HoustonTexans' },
  { id: 'v3', title: 'oops 😬', description: 'Being a mascot looks easy until it isn\'t. Five oopsies in one reel.' },
  { id: 'v4', title: 'EIGHT sacks 😈', description: 'The Texans front kept coming all night long.' },
];

/** A mock of Supabase and Claude. `answer` builds Claude's reply per batch; `spent` is the day's spend so far. */
function world({ answer, spent = 0, clips = CLIPS, claudeStatus = 200, entityStatus = 201 } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.startsWith('https://api.anthropic.com/')) {
      if (claudeStatus !== 200) return res(claudeStatus, { error: { message: 'nope' } });
      const body = JSON.parse(opts.body);
      const ids = [...body.messages[0].content.matchAll(/^id: (\S+)$/gm)].map((m) => m[1]);
      const reply = answer(ids);
      return res(200, { model: MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }],
        usage: { input_tokens: 400, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 2600 } });
    }
    if (/\/rest\/v1\/rpc\/feed_model_tag_candidates$/.test(url)) {
      const lim = JSON.parse(opts.body).lim;
      return res(200, { spent_24h: spent, untagged_total: clips.length, candidates: clips.slice(0, lim) });
    }
    if (/\/rest\/v1\/feed_entity_aliases\?/.test(url)) return res(200, ALIASES);
    if (/\/rest\/v1\/feed_video_entities\?/.test(url)) return res(entityStatus, null);
    if (/\/rest\/v1\/feed_model_tag_runs\?/.test(url)) return res(201, null);
    const table = (url.split('/rest/v1/')[1] || '').split('?')[0];
    return res(table ? 200 : 404, []);
  };
  return { calls, fetch, claude: () => calls.filter((c) => c.url.startsWith('https://api.anthropic.com/')), writes: (tbl) => calls.filter((c) => c.url.includes(`/rest/v1/${tbl}?`) && c.opts.method === 'POST') };
}
const good = (ids) => ({ clips: ids.map((id) => ({ id, entities: {
  v1: [{ type: 'player', slug: 'c-j-stroud', confidence: 0.95 }],
  v2: [{ type: 'player', slug: 'tank-dell', confidence: 0.8 }, { type: 'player', slug: 'deshaun-watson', confidence: 0.9 }],
  v3: [{ type: 'theme', slug: 'toro', confidence: 0.7 }, { type: 'opponent', slug: 'colts', confidence: 0.9 }, { type: 'theme', slug: 'toro', confidence: 0.6 }],
  v4: [{ type: 'player', slug: 'c-j-stroud', confidence: 0.3 }],
}[id] || [] })) });
const ENV = { ANTHROPIC_API_KEY: 'sk-test', SUPABASE_SERVICE_KEY: 'service', SUPABASE_URL: 'https://x.supabase.co' };
const NOW = new Date('2026-11-04T12:45:00Z');

/* ---------- not configured ---------- */
{
  const w = world({ answer: good });
  const tg = createTagger({ fetch: w.fetch, now: () => NOW });
  let out = await tg.run({ SUPABASE_SERVICE_KEY: 'service' });
  t('without ANTHROPIC_API_KEY the pass does nothing and says so', out.configured === false && out.stopped === 'no api key' && w.calls.length === 0);
  out = await tg.run({ ANTHROPIC_API_KEY: 'k' });
  t('without the service key it does nothing either', out.configured === false && out.stopped === 'no service key' && w.calls.length === 0);
}

/* ---------- the request ---------- */
{
  const w = world({ answer: good });
  const tg = createTagger({ fetch: w.fetch, now: () => NOW });
  const out = await tg.run(ENV);
  const req = w.claude()[0];
  const body = JSON.parse(req.opts.body);
  t('one request for four clips, on Claude Opus 5.5 at low effort with a JSON schema', w.claude().length === 1 && body.model === MODEL && body.output_config.effort === 'low' && body.output_config.format.type === 'json_schema' && body.output_config.format.schema.required.includes('clips'));
  t('the key travels in x-api-key with the version and the fallback beta', req.opts.headers['x-api-key'] === 'sk-test' && req.opts.headers['anthropic-version'] === '2026-10-21' && /server-side-fallback-2026-07-01/.test(req.opts.headers['anthropic-beta']) && body.fallbacks === 'default');
  t('no thinking parameter is sent (Opus 5.5 thinks on its own)', !('thinking' in body));
  const sys = body.system[0];
  t('the dictionary rides in the cached system block, sorted by type and slug', sys.cache_control.type === 'ephemeral' && /coach \/ demeco-ryans: demeco ryans/.test(sys.text) && sys.text.indexOf('coach / demeco') < sys.text.indexOf('player / c-j-stroud') && sys.text.indexOf('player / c-j-stroud') < sys.text.indexOf('player / tank-dell'));
  t('player spellings include nicknames; opponents are not in the dictionary', /player \/ tank-dell: tank dell, tank/.test(sys.text) && !/colts/.test(sys.text));
  t('the user turn carries every clip with id, title and description', /id: v1\ntitle: QB1 👆\ndescription: Subscribe/.test(body.messages[0].content) && /id: v4/.test(body.messages[0].content));
  t('the prompt says QB1 is Stroud and never names the other stadium', /QB1 is the starting quarterback/.test(sys.text) && /C\.J\. Stroud is QB1/.test(sys.text) && !/NRG/.test(sys.text));

  // What came back
  t('four asked, three found: Stroud, Dell and TORO', out.asked === 4 && out.found === 3 && out.labels === 3);
  const ents = JSON.parse(w.writes('feed_video_entities')[0].opts.body);
  const stroud = ents.find((e) => e.video_id === 'v1');
  t(`a 0.95 answer is written at ${MAX_CONF}, matched_on model`, stroud && stroud.entity_slug === 'c-j-stroud' && stroud.confidence === MAX_CONF && stroud.matched_on === 'model');
  t('a 0.8 answer keeps 0.7 too; the duplicate TORO is written once', ents.find((e) => e.video_id === 'v2').confidence === MAX_CONF && ents.filter((e) => e.video_id === 'v3').length === 1 && ents.find((e) => e.video_id === 'v3').confidence === 0.7);
  t('a slug outside the dictionary (an excluded name) and an opponent are refused and counted', !ents.some((e) => e.entity_slug === 'deshaun-watson' || e.entity_slug === 'colts') && out.rejected === 2);
  t(`a ${MIN_CONF} floor drops the 0.3 guess on v4`, !ents.some((e) => e.video_id === 'v4'));
  t('entities are written with ignore-duplicates so an alias tag is never overwritten', /on_conflict=video_id,entity_type,entity_slug/.test(w.writes('feed_video_entities')[0].url) && /ignore-duplicates/.test(w.writes('feed_video_entities')[0].opts.headers.prefer));
  const runs = JSON.parse(w.writes('feed_model_tag_runs')[0].opts.body);
  t('every clip asked gets a run row, found or not, with its share of the cost and tokens', runs.length === 4 && runs.every((r) => r.model === MODEL && r.asked_at === NOW.toISOString() && r.cost_usd > 0) && runs.find((r) => r.video_id === 'v4').labels.length === 0 && runs.find((r) => r.video_id === 'v2').rejected.length === 1);
  const expect = (400 * 4 + 120 * 20 + 2600 * 0.2) / 1e6;
  t('the cost is priced from usage at Opus 5.5 rates, cache reads at 20 cents', Math.abs(out.cost_usd - expect) < 1e-6 && Math.abs(runs.reduce((a, r) => a + r.cost_usd, 0) - expect) < 1e-4);
  t('the result reports the cap and a sample', out.cap_usd === 1 && out.sample.length === 4 && out.sample[0].labels[0].slug === 'c-j-stroud' && out.stopped === null && out.errors.length === 0);
}

/* ---------- batches, the cap, dry runs, failures ---------- */
{
  const many = Array.from({ length: 23 }, (_, i) => ({ id: `m${i}`, title: `clip ${i}`, description: '' }));
  const w = world({ answer: (ids) => ({ clips: ids.map((id) => ({ id, entities: [] })) }), clips: many });
  const tg = createTagger({ fetch: w.fetch, now: () => NOW });
  const out = await tg.run(ENV);
  t(`23 clips go in three requests of at most ${BATCH}`, w.claude().length === 3 && out.batches === 3 && out.asked === 23 && out.found === 0);
  t('the candidates call asks for the run size and the catalogue window', JSON.parse(w.calls[0].opts.body).lim === 40 && JSON.parse(w.calls[0].opts.body).served === 300);
  const w2 = world({ answer: good, spent: 1.2 });
  const out2 = await createTagger({ fetch: w2.fetch, now: () => NOW }).run(ENV);
  t('over the daily cap the pass stops before asking anything', out2.stopped === 'cap' && w2.claude().length === 0 && out2.spent_24h === 1.2);
  const w3 = world({ answer: good, spent: 0.4 });
  const out3 = await createTagger({ fetch: w3.fetch, now: () => NOW }).run({ ...ENV, MODEL_TAG_DAILY_USD: '0.5', MODEL_TAG_PER_RUN: '2' });
  t('the cap and the run size come from the vars', out3.cap_usd === 0.5 && JSON.parse(w3.calls[0].opts.body).lim === 2 && out3.asked === 2);
  const w4 = world({ answer: good });
  const out4 = await createTagger({ fetch: w4.fetch, now: () => NOW }).run(ENV, { dry: true, limit: 3 });
  t('a dry run asks Claude and writes nothing', out4.dry === true && w4.claude().length === 1 && w4.writes('feed_video_entities').length === 0 && w4.writes('feed_model_tag_runs').length === 0 && out4.asked === 3 && out4.sample.length === 3);
  const w5 = world({ answer: good, claudeStatus: 429 });
  const out5 = await createTagger({ fetch: w5.fetch, now: () => NOW }).run(ENV);
  t('a Claude error is reported, nothing is written, nothing is marked asked', /claude 429/.test(out5.errors[0]) && w5.writes('feed_model_tag_runs').length === 0 && out5.asked === 0);
  const w6 = world({ answer: good, entityStatus: 500 });
  const out6 = await createTagger({ fetch: w6.fetch, now: () => NOW }).run(ENV);
  t('a failed write is reported and the run rows are not written either', /write entities 500/.test(out6.errors[0]) && w6.writes('feed_model_tag_runs').length === 0);
  const w7 = world({ answer: good, clips: [] });
  const out7 = await createTagger({ fetch: w7.fetch, now: () => NOW }).run(ENV);
  t('with nothing untagged there is nothing to ask', out7.stopped === 'nothing to ask' && w7.claude().length === 0);
}

/* ---------- through the Worker ---------- */
{
  const w = world({ answer: good });
  const app = createApp({ feedHtml: 'x', deps: { fetch: w.fetch, cache: null, now: () => NOW } });
  const ctx = { waitUntil: () => {} };
  const req = (path, init) => new Request(`https://feed.htow.nz${path}`, init);
  const KEYED = { ...ENV, MEDIA: {}, MEDIA_UPLOAD_KEY: 'open-sesame' };
  let r = await app.fetch(req('/api/tag/model', { method: 'POST' }), KEYED, ctx);
  t('the route needs the upload key', r.status === 401);
  r = await app.fetch(req('/api/tag/model?limit=2', { method: 'GET', headers: { 'x-media-key': 'open-sesame' } }), KEYED, ctx);
  let d = await r.json();
  t('GET with the key is a dry run of the asked size', r.status === 200 && d.dry === true && d.asked === 2 && w.writes('feed_model_tag_runs').length === 0);
  r = await app.fetch(req('/api/tag/model', { method: 'POST', headers: { 'x-media-key': 'open-sesame' } }), KEYED, ctx);
  d = await r.json();
  t('POST with the key runs the pass and writes', r.status === 200 && d.dry === false && d.asked === 4 && w.writes('feed_model_tag_runs').length === 1);
  r = await app.fetch(req('/api/tag/model', { method: 'POST', headers: { 'x-media-key': 'open-sesame' } }), { MEDIA: {}, MEDIA_UPLOAD_KEY: 'open-sesame', SUPABASE_SERVICE_KEY: 'service' }, ctx);
  t('without the api key the route answers 503 and names the gap', r.status === 503 && (await r.json()).stopped === 'no api key');
  r = await app.fetch(req('/health'), KEYED, ctx);
  t('health says model_tags true with both keys, false without', (await r.json()).model_tags === true && (await (await app.fetch(req('/health'), {}, ctx)).json()).model_tags === false);
  const before = w.writes('feed_model_tag_runs').length;
  let waited = null;
  await app.scheduled({ cron: '45 */2 * * *' }, KEYED, { waitUntil: (p) => { waited = p; } });
  await waited;
  t('the cron handler runs the pass under waitUntil', waited !== null && w.writes('feed_model_tag_runs').length === before + 1);
  await app.scheduled({ cron: '45 */2 * * *' }, {}, { waitUntil: (p) => { waited = p; } });
  await waited;
  t('the cron without keys is a quiet no-op', w.writes('feed_model_tag_runs').length === before + 1);
}

console.log('PASS ' + ok.length); ok.forEach((x) => console.log('  + ' + x));
if (bad.length) { console.log('FAIL ' + bad.length); bad.forEach((x) => console.log('  - ' + x)); process.exit(1); }
