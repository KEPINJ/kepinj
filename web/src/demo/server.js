// =====================================================================
//  Mode demo: backend BKU dijalankan langsung di browser.
//  Rute API server yang sama dipasang di router mini, database memakai
//  PGlite (PostgreSQL WASM) yang dimuat dari snapshot data contoh dan
//  disimpan ke IndexedDB browser setelah setiap perubahan. Tidak ada data yang dikirim ke server.
// =====================================================================
import { Buffer } from 'buffer';
import { setOpener } from '../../../server/src/db/pglite-pg.js';

globalThis.Buffer ??= Buffer;

const BASE = import.meta.env.BASE_URL;
const TOKEN_KEY = 'bku-demo.token';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* mode privat */ } },
};

// Isi database disimpan utuh (arsip data directory) sebagai satu blob di IndexedDB
const idb = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open('bku-demo', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('state');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('state', mode);
    const req = fn(tx.objectStore('state'));
    tx.oncomplete = () => { resolve(req?.result); open.result.close(); };
    tx.onerror = () => reject(tx.error);
  };
});
const saved = { get: () => idb('readonly', (s) => s.get('db')), put: (v) => idb('readwrite', (s) => s.put(v, 'db')), clear: () => idb('readwrite', (s) => s.clear()) };

let database;
async function openDemoDb(_dataDir, opts) {
  const { PGlite } = await import('@electric-sql/pglite');
  const prev = await saved.get().catch(() => null);
  let data = prev?.build === __DEMO_BUILD__ ? prev.blob : null;
  if (!data) {
    const r = await fetch(`${BASE}demo/bku-demo.tar.gz`);
    if (!r.ok) throw new Error('Snapshot data demo tidak ditemukan');
    data = await r.blob();
  }
  database = await PGlite.create({ ...opts, loadDataDir: data });
  return database;
}

let saveTimer;
let saving = Promise.resolve();
/** Simpan perubahan ke IndexedDB tak lama setelah ada transaksi tulis. */
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = saving.then(async () => {
      const blob = await database.dumpDataDir('gzip');
      await saved.put({ build: __DEMO_BUILD__, blob, at: new Date().toISOString() });
    }).catch((e) => console.warn('[demo] perubahan tidak tersimpan di browser', e));
  }, 800);
}

/** Hapus perubahan dan kembalikan data demo ke kondisi awal. */
export async function resetDemo() {
  clearTimeout(saveTimer);
  await saving;
  await saved.clear().catch(() => {});
  store.set(TOKEN_KEY, null);
  window.location.reload();
}

// ---- router mini dengan antarmuka mirip Fastify ----
function compile(path) {
  const keys = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  return { re, keys };
}

function createApp() {
  const routes = [];
  const hooks = [];
  const add = (method) => (path, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    const pre = opts.preHandler ? [].concat(opts.preHandler) : [];
    routes.push({ method, ...compile(path), pre, handler });
  };
  const app = {
    get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'),
    addHook: (name, fn) => { if (name === 'onRequest') hooks.push(fn); },
    decorateRequest() {},
    register: async (plugin) => plugin(app),
    log: console,
  };
  return { app, routes, hooks };
}

const ready = (async () => {
  setOpener(openDemoDb);
  // Diimpor setelah setOpener agar pool database memakai snapshot demo
  const [auth, bus, http, ...mods] = await Promise.all([
    import('../../../server/src/auth.js'),
    import('../../../server/src/events/bus.js'),
    import('../../../server/src/lib/http.js'),
    import('../../../server/src/routes/bku.js'),
    import('../../../server/src/routes/pajak.js'),
    import('../../../server/src/routes/data.js'),
    import('../../../server/src/routes/laporan.js'),
    import('../../../server/src/routes/master.js'),
    import('../../../server/src/routes/system.js'),
  ]);
  const { app, routes, hooks } = createApp();
  auth.authPlugin(app);
  auth.authRoutes(app);
  for (const m of mods) await app.register(m.default);
  await (await import('../../../server/src/db.js')).query('SELECT 1');
  return { routes, hooks, bus, http };
})();

function makeReply(onRaw) {
  const reply = {
    statusCode: 200, headers: {}, payload: undefined, sent: false, hijacked: false,
    code(s) { this.statusCode = s; return this; },
    status(s) { this.statusCode = s; return this; },
    header(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    type(v) { return this.header('content-type', v); },
    send(p) { this.payload = p; this.sent = true; return this; },
    setCookie: (_n, v) => { store.set(TOKEN_KEY, v); return reply; },
    clearCookie: () => { store.set(TOKEN_KEY, null); return reply; },
    hijack() { this.hijacked = true; },
    raw: onRaw,
  };
  return reply;
}

async function dispatch(method, rawUrl, body, raw) {
  const { routes, hooks, bus, http } = await ready;
  const u = new URL(rawUrl, window.location.origin);
  const query = Object.fromEntries(u.searchParams.entries());
  const file = body instanceof FormData ? body.get('file') : null;
  const req = {
    method, url: u.pathname + u.search, query, params: {}, headers: {}, ip: 'browser-demo', user: null, log: console,
    body: file ? undefined : (typeof body === 'string' ? JSON.parse(body) : body),
    cookies: { bku_token: store.get(TOKEN_KEY) || undefined },
    raw: raw?.req || { on() {} },
    file: async () => file && {
      filename: file.name, mimetype: file.type,
      toBuffer: async () => Buffer.from(await file.arrayBuffer()),
    },
  };
  const reply = makeReply(raw?.res);
  try {
    const route = routes.find((r) => r.method === method && r.re.test(u.pathname));
    if (!route) throw new http.HttpError(404, 'Endpoint tidak ditemukan');
    route.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(u.pathname.match(route.re)[i + 1]); });
    for (const h of hooks) await h(req, reply);
    for (const h of route.pre) if (!reply.sent) await h(req, reply);
    if (!reply.sent) {
      const out = await route.handler(req, reply);
      if (!reply.sent && !reply.hijacked) reply.send(out);
    }
  } catch (err) {
    const { status, body: b } = http.errorResponse(err);
    if (status >= 500) console.error(err);
    reply.code(status).send(b);
  }
  if (method !== 'GET') {
    await bus.drainOutbox().catch((e) => console.error('[demo] outbox', e));
    scheduleSave();
  }
  return reply;
}

/** Pengganti fetch() untuk URL /api/* di mode demo. */
export async function demoFetch(url, { method = 'GET', body } = {}) {
  const reply = await dispatch(method, url, body);
  const p = reply.payload;
  const headers = { ...reply.headers };
  if (p instanceof Uint8Array || p instanceof ArrayBuffer) return new Response(p, { status: reply.statusCode, headers });
  if (typeof p === 'string' && headers['content-type']) return new Response(p, { status: reply.statusCode, headers });
  return new Response(JSON.stringify(p ?? null), { status: reply.statusCode, headers: { ...headers, 'content-type': 'application/json' } });
}

/** EventSource tiruan: memakai rute /api/stream yang sama dan klien SSE di bus event. */
export class DemoEventSource {
  constructor(url) {
    this.listeners = {};
    this.closers = [];
    this.buffer = '';
    const res = { writeHead() {}, write: (s) => this.#feed(s) };
    const req = { on: (ev, fn) => { if (ev === 'close') this.closers.push(fn); } };
    dispatch('GET', url, undefined, { req, res }).then((reply) => {
      if (!reply.hijacked) this.onerror?.();
    });
  }

  #feed(chunk) {
    this.buffer += chunk;
    let i;
    while ((i = this.buffer.indexOf('\n\n')) >= 0) {
      const frame = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 2);
      let type = 'message'; let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) type = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (data) setTimeout(() => (this.listeners[type] || []).forEach((fn) => fn({ data })));
    }
  }

  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }

  close() { this.closers.forEach((fn) => fn()); this.closers = []; }
}
