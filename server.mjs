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
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAdapters, pull } from './src/adapters/index.js';
import { makeItem, validate, feedSort, liveCollections, STATUS, COLLECTIONS } from './src/content.js';
import { TEMPLATES, templatePatch } from './src/templates.js';

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
const EXT_OF = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/avif': '.avif', 'image/gif': '.gif', 'image/svg+xml': '.svg',
  'video/mp4': '.mp4', 'video/webm': '.webm' };

async function load() {
  if (!existsSync(STORE)) return { items: [], updatedAt: null };
  try { return JSON.parse(await readFile(STORE, 'utf8')); }
  catch { return { items: [], updatedAt: null }; }
}
async function save(state) {
  state.updatedAt = new Date().toISOString();
  await mkdir(dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify(state, null, 2) + '\n');
  return state;
}

const json = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body, null, 2));
};

const readBody = (req) => new Promise((ok, no) => {
  let b = ''; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > 4e6) { no(new Error('body too large')); req.destroy(); } b += c; });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } });
  req.on('error', no);
});

async function serveFile(res, rel) {
  const path = join(ROOT, rel);
  if (!path.startsWith(ROOT) || !existsSync(path)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, {
    'content-type': MIME[extname(path)] || 'application/octet-stream',
    'cache-control': 'no-store',
    // The feed is meant to be framed by houstontexans.com and the app webview.
    'access-control-allow-origin': '*',
  });
  res.end(await readFile(path));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type' });
      return res.end();
    }

    // ---- API -------------------------------------------------------------
    if (p === '/api/adapters') return json(res, 200, { adapters: listAdapters() });

    if (p === '/api/templates') return json(res, 200, {
      templates: TEMPLATES.map(({ key, name, note, apply }) => ({
        key, name, note, blocks: apply.overlays.length, fit: apply.fit, advance: apply.advance.mode,
      })),
    });

    if (p === '/api/apply-template' && req.method === 'POST') {
      const { id, template } = await readBody(req);
      const patch = templatePatch(template);
      if (!patch) return json(res, 404, { error: `no such template: ${template}` });
      const state = await load();
      let hit = false;
      state.items = state.items.map((i) => (i.id === id ? (hit = true, makeItem({ ...i, ...patch })) : i));
      if (!hit) return json(res, 404, { error: 'no such item' });
      await save(state);
      return json(res, 200, { applied: template });
    }

    if (p === '/api/feed') {
      const { items } = await load();
      const live = items.filter((i) => i.status === STATUS.PUBLISHED).sort(feedSort);
      const only = url.searchParams.get('collection');
      return json(res, 200, {
        generatedAt: new Date().toISOString(),
        collections: liveCollections(items),
        clips: only ? live.filter((i) => i.collection === only) : live,
      });
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
      const state = await load();
      const ids = new Set(Array.isArray(patch.ids) ? patch.ids : [patch.id]);
      let n = 0;
      state.items = state.items.map((i) => {
        if (!ids.has(i.id)) return i;
        n++;
        return makeItem({ ...i, ...patch.changes, id: i.id });
      });
      await save(state);
      return json(res, 200, { updated: n });
    }

    if (p === '/api/items' && req.method === 'DELETE') {
      const { ids = [] } = await readBody(req);
      const state = await load();
      const before = state.items.length;
      state.items = state.items.filter((i) => !ids.includes(i.id));
      await save(state);
      return json(res, 200, { removed: before - state.items.length });
    }

    // Uploads arrive as a data URL in JSON — no multipart parser, no dependency, and the
    // studio already has the bytes in hand from the file picker.
    if (p === '/api/upload' && req.method === 'POST') {
      const { filename = 'upload', dataUrl } = await readBody(req);
      const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl || '');
      if (!m) return json(res, 400, { error: 'expected a base64 data URL' });
      const [, contentType, b64] = m;
      const ext = EXT_OF[contentType];
      if (!ext) return json(res, 415, { error: `unsupported type: ${contentType}` });
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length > MAX_UPLOAD)
        return json(res, 413, { error: `too large: ${(bytes.length / 1e6).toFixed(1)}MB, max 12MB` });

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
      const state = await load();
      const known = new Set(state.items.map((i) => i.id));
      const added = fresh.filter((i) => !known.has(i.id));
      state.items = [...state.items, ...added];
      await save(state);
      return json(res, 200, { pulled: fresh.length, added: added.length,
        skipped: fresh.length - added.length });
    }

    // ---- static ----------------------------------------------------------
    if (p === '/' || p === '/studio') return serveFile(res, 'app/studio.html');
    if (p === '/feed') return serveFile(res, 'app/feed.html');
    if (p.startsWith('/app/') || p.startsWith('/content/')) return serveFile(res, p.slice(1));

    res.writeHead(404); res.end('not found');
  } catch (e) {
    json(res, 500, { error: e.message });
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
