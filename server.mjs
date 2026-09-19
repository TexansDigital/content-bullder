#!/usr/bin/env node
/**
 * The tool. One command, no install, no build step.
 *
 *   node server.mjs            → http://localhost:4400
 *
 *   /            studio — pull from sources, curate, publish
 *   /feed        the embeddable feed (this is what goes in the iframe)
 *   /api/feed    published items as JSON — the contract for any other renderer
 *
 * Storage is a JSON file by default so this runs anywhere with nothing provisioned.
 * STORE=/path/to/file.json overrides it; swapping in Postgres means replacing load/save.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAdapters, pull } from './src/adapters/index.js';
import { makeItem, validate, feedSort, liveCollections, STATUS, COLLECTIONS } from './src/content.js';
import { TEMPLATES, templatePatch, templateFromItem } from './src/templates.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4400);
const STORE = resolve(process.env.STORE || join(ROOT, 'content/store.json'));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.m3u8': 'application/vnd.apple.mpegurl', '.otf': 'font/otf' };

const UPLOADS = join(ROOT, 'content/uploads');
const MAX_UPLOAD = 12 * 1024 * 1024;
// A base64 data URL is ~1.37x the binary, plus JSON overhead. Below this the body cap
// would reject inside the advertised limit, and do it by resetting the connection.
const MAX_BODY = Math.ceil(MAX_UPLOAD * 1.5) + 65536;
// SVG is deliberately absent: it is a script-bearing document, and serving one from our
// own origin would give it full access to the store.
const EXT_OF = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/avif': '.avif', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm' };

async function loadRaw() {
  if (!existsSync(STORE)) return { items: [], templates: [], updatedAt: null };
  const text = await readFile(STORE, 'utf8');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) {
    // Swallowing this would return an empty store, and the next write would persist that
    // over the real file. Refuse instead, and say where the damaged copy went.
    const aside = `${STORE}.corrupt-${Date.now()}`;
    await writeFile(aside, text).catch(() => {});
    throw new Error(`store is not valid JSON (${e.message}). Moved a copy to ${aside} — `
      + 'fix or delete the store file before continuing.');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items))
    throw new Error('store is malformed: expected an object with an items array');
  parsed.templates ||= [];
  return parsed;
}

async function saveRaw(state) {
  state.updatedAt = new Date().toISOString();
  await mkdir(dirname(STORE), { recursive: true });
  // Write to a sibling then rename: a crash mid-write leaves the previous store intact
  // rather than a truncated file.
  const tmp = `${STORE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
  await rename(tmp, STORE);
  return state;
}

/**
 * Every mutation is read-modify-write against one file, so without serialisation two
 * overlapping requests silently overwrite each other while both report success. This queue
 * makes each mutation atomic with respect to the others.
 */
let chain = Promise.resolve();
const withStore = (fn) => {
  const run = chain.then(async () => {
    const state = await loadRaw();
    const result = await fn(state);
    if (result?.$save !== false) await saveRaw(state);
    return result;
  });
  chain = run.then(() => {}, () => {});   // keep the queue alive past a failure
  return run;
};
const load = loadRaw;

/** Only the published feed is readable cross-origin; everything else is same-origin. */
const json = (res, code, body, { public: pub = false } = {}) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(pub ? { 'access-control-allow-origin': '*' } : {}),
  });
  res.end(JSON.stringify(body, null, 2));
};

/**
 * There is no login, so a browser on any site could otherwise drive this API with the
 * editor's own session. Mutations must come from this origin, and may additionally require
 * a token when STUDIO_TOKEN is set.
 */
const TOKEN = process.env.STUDIO_TOKEN || '';
function mutationAllowed(req) {
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { return false; }
    if (host !== req.headers.host) return false;
  }
  if (TOKEN && req.headers['x-studio-token'] !== TOKEN) return false;
  return true;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const readBody = (req) => new Promise((ok, no) => {
  let b = ''; let n = 0; let done = false;
  req.on('data', (c) => {
    if (done) return;
    n += c.length;
    if (n > MAX_BODY) {
      done = true;
      // Stop reading but leave the socket alive so the 413 actually reaches the client.
      req.pause();
      no(new HttpError(413, `body too large — max ${(MAX_UPLOAD / 1048576).toFixed(0)}MB`));
      return;
    }
    b += c;
  });
  req.on('end', () => {
    if (done) return;
    try { ok(b ? JSON.parse(b) : {}); }
    catch { no(new HttpError(400, 'body is not valid JSON')); }
  });
  req.on('error', no);
});

async function serveFile(res, rel) {
  const path = join(ROOT, rel);
  // A directory here used to reach readFile and throw EISDIR from an unawaited promise,
  // which took the whole process down on one unauthenticated request.
  let stat;
  try { stat = statSync(path); } catch { stat = null; }
  if (!path.startsWith(ROOT) || !stat?.isFile()) { res.writeHead(404); return res.end('not found'); }
  const uploaded = rel.startsWith('content/uploads/');
  res.writeHead(200, {
    'content-type': MIME[extname(path)] || 'application/octet-stream',
    'cache-control': 'no-store',
    // The feed is meant to be framed by houstontexans.com and the app webview.
    'access-control-allow-origin': '*',
    // Uploaded files are attacker-influenced content on our own origin, so deny them any
    // script execution and stop the browser sniffing a type we didn't set.
    'x-content-type-options': 'nosniff',
    ...(uploaded ? { 'content-security-policy': "sandbox; default-src 'none'" } : {}),
  });
  res.end(await readFile(path));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    if (req.method === 'OPTIONS') {
      // Only the read-only feed is offered cross-origin. Answering this for PATCH/DELETE
      // is what would let another site mutate the store.
      res.writeHead(204, { 'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-allow-headers': 'content-type' });
      return res.end();
    }

    if (req.method !== 'GET' && !mutationAllowed(req))
      return json(res, 403, { error: 'cross-origin or unauthenticated write refused' });

    // ---- API -------------------------------------------------------------
    if (p === '/api/adapters') return json(res, 200, { adapters: listAdapters() });

    if (p === '/api/templates' && req.method === 'GET') {
      const { templates = [] } = await load();
      return json(res, 200, {
        templates: [...TEMPLATES, ...templates].map(({ key, name, note, custom, apply }) => ({
          key, name, note, custom: !!custom, blocks: apply.overlays.length,
          fit: apply.fit, advance: apply.advance.mode,
        })),
      });
    }

    if (p === '/api/templates' && req.method === 'POST') {
      const { id, name, draft } = await readBody(req);
      if (!String(name || '').trim()) throw new HttpError(400, 'needs a name');
      return json(res, 200, await withStore((state) => {
        const stored = state.items.find((i) => i.id === id);
        if (!stored) throw new HttpError(404, 'no such item');
        // Save what is on the canvas, not what was last written. Otherwise unsaved blocks
        // are silently dropped while the toast still reports success.
        const source = draft ? makeItem({ ...stored, ...draft, id: stored.id }) : stored;
        if (!source.overlays?.length)
          throw new HttpError(400, 'nothing to save — this card has no blocks');
        const taken = new Set((state.templates || []).map((t) => t.key));
        const t = templateFromItem(source, name, taken);
        state.templates = [...(state.templates || []), t];
        return { saved: t.key, name: t.name };
      }));
    }

    if (p === '/api/templates' && req.method === 'DELETE') {
      const { key } = await readBody(req);
      return json(res, 200, await withStore((state) => {
        const before = (state.templates || []).length;
        state.templates = (state.templates || []).filter((t) => t.key !== key);
        return { removed: before - state.templates.length };
      }));
    }

    if (p === '/api/apply-template' && req.method === 'POST') {
      const { id, template } = await readBody(req);
      return json(res, 200, await withStore((state) => {
        const patch = templatePatch(template, state.templates || []);
        if (!patch) throw new HttpError(404, `no such template: ${template}`);
        let hit = false;
        state.items = state.items.map((i) =>
          (i.id === id ? (hit = true, makeItem({ ...i, ...patch })) : i));
        if (!hit) throw new HttpError(404, 'no such item');
        return { applied: template };
      }));
    }

    if (p === '/api/feed') {
      const { items } = await load();
      const live = items.filter((i) => i.status === STATUS.PUBLISHED).sort(feedSort);
      const only = url.searchParams.get('collection');
      return json(res, 200, {
        generatedAt: new Date().toISOString(),
        collections: liveCollections(items),
        clips: only ? live.filter((i) => i.collection === only) : live,
      }, { public: true });
    }

    if (p === '/api/items' && req.method === 'GET') {
      const { items, updatedAt } = await load();
      return json(res, 200, {
        updatedAt, collections: COLLECTIONS,
        counts: items.reduce((a, i) => ((a[i.status] = (a[i.status] || 0) + 1), a), {}),
        items: items.map((i) => ({ ...i, validation: validate(i) })),
      });
    }

    if (p === '/api/items' && req.method === 'PATCH') {
      const patch = await readBody(req);
      const ids = new Set(Array.isArray(patch.ids) ? patch.ids : [patch.id]);
      return json(res, 200, await withStore((state) => {
        let n = 0;
        const rejected = [];
        state.items = state.items.map((i) => {
          if (!ids.has(i.id)) return i;
          const next = makeItem({ ...i, ...patch.changes, id: i.id });
          // The studio gates Publish on validation, but the API has to as well — otherwise
          // anything can push a broken card into the live feed.
          if (next.status === STATUS.PUBLISHED && i.status !== STATUS.PUBLISHED) {
            const v = validate(next);
            if (!v.ok) { rejected.push({ id: i.id, errors: v.errors }); return i; }
          }
          n++;
          return next;
        });
        return { updated: n, ...(rejected.length ? { rejected } : {}) };
      }));
    }

    if (p === '/api/items' && req.method === 'DELETE') {
      const { ids = [] } = await readBody(req);
      return json(res, 200, await withStore((state) => {
        const before = state.items.length;
        state.items = state.items.filter((i) => !ids.includes(i.id));
        return { removed: before - state.items.length };
      }));
    }

    // Uploads arrive as a data URL in JSON — no multipart parser, no dependency, and the
    // studio already has the bytes in hand from the file picker.
    if (p === '/api/upload' && req.method === 'POST') {
      const { filename = 'upload', dataUrl } = await readBody(req);
      const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl || '');
      if (!m) throw new HttpError(400, 'expected a base64 data URL');
      const [, contentType, b64] = m;
      const ext = EXT_OF[contentType];
      if (!ext) throw new HttpError(415,
        `unsupported type: ${contentType}. Allowed: ${[...new Set(Object.values(EXT_OF))].join(' ')}`);
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length > MAX_UPLOAD)
        throw new HttpError(413,
          `too large: ${(bytes.length / 1048576).toFixed(1)}MB, max ${MAX_UPLOAD / 1048576}MB`);

      const safe = String(filename).replace(/\.[^.]*$/, '').replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '').slice(0, 48).toLowerCase() || 'upload';
      const name = `${Date.now().toString(36)}-${safe}${ext}`;
      await mkdir(UPLOADS, { recursive: true });
      await writeFile(join(UPLOADS, name), bytes);
      return json(res, 200, { url: `/content/uploads/${name}`, contentType, bytes: bytes.length });
    }

    if (p === '/api/pull' && req.method === 'POST') {
      const { adapter, config = {} } = await readBody(req);
      const fresh = await pull(adapter, config);
      return json(res, 200, await withStore((state) => {
        const seen = new Set(state.items.map((i) => i.id));
        const added = [];
        let malformed = 0;
        for (const item of fresh) {
          // Dedupe within the batch as well as against the store: a source that cannot
          // resolve an id would otherwise emit several items sharing one, and a single
          // later edit would rewrite all of them.
          if (!item.id || /(^|-)(null|undefined)$/.test(item.id)) { malformed++; continue; }
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          added.push(item);
        }
        state.items = [...state.items, ...added];
        return { pulled: fresh.length, added: added.length,
          skipped: fresh.length - added.length - malformed,
          ...(malformed ? { malformed } : {}) };
      }));
    }

    // ---- static ----------------------------------------------------------
    if (p === '/' || p === '/studio') return await serveFile(res, 'app/studio.html');
    if (p === '/feed') return await serveFile(res, 'app/feed.html');
    if (p.startsWith('/app/') || p.startsWith('/content/')) return await serveFile(res, p.slice(1));

    res.writeHead(404); res.end('not found');
  } catch (e) {
    const status = e.status || (/^(no such|missing|unsupported|needs a|nothing to|expected)/i.test(e.message) ? 400 : 500);
    json(res, status, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — the server may already be running.`);
    console.error(`  Open http://localhost:${PORT}/ , or start on another port:\n`);
    console.error(`      PORT=4401 node server.mjs\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  const line = '─'.repeat(52);
  console.log(`\n${line}`);
  console.log('  Running. Open this in your browser:\n');
  console.log(`      http://localhost:${PORT}/`);
  console.log('\n  studio   /          pull, curate, publish');
  console.log('  feed     /feed      what goes in the iframe');
  console.log('  api      /api/feed  published items as JSON');
  console.log(`\n  store    ${STORE}`);
  console.log(`${line}`);
  console.log('  Leave this window open — Ctrl-C stops the server.\n');
});

process.on('SIGINT', () => { console.log('\n  Stopped.\n'); process.exit(0); });
