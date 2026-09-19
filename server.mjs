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

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4400);
const STORE = resolve(process.env.STORE || join(ROOT, 'content/store.json'));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.otf': 'font/otf' };

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

server.listen(PORT, () => {
  console.log(`\n  studio   http://localhost:${PORT}/`);
  console.log(`  feed     http://localhost:${PORT}/feed`);
  console.log(`  api      http://localhost:${PORT}/api/feed`);
  console.log(`  store    ${STORE}\n`);
});
