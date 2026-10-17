// Adaptor PGlite (PostgreSQL WASM) dengan antarmuka yang sama seperti modul `pg`.
// Dipakai untuk mode demo di browser (GitHub Pages) dan untuk membuat snapshot
// database demo saat build. Produksi tetap memakai PostgreSQL sungguhan.
const DATE = 1082;
const INT8 = 20;
const NUMERIC = 1700;

let opener = async (dataDir, opts) => {
  const { PGlite } = await import('@electric-sql/pglite');
  return new PGlite(dataDir, opts);
};
/** Ganti cara membuka database (mis. memuat snapshot di browser). */
export function setOpener(fn) { opener = fn; }

const parsers = { [DATE]: (v) => v, [INT8]: (v) => Number(v), [NUMERIC]: (v) => v };

class Mutex {
  #last = Promise.resolve();
  lock() {
    let release;
    const next = new Promise((r) => { release = r; });
    const wait = this.#last;
    this.#last = this.#last.then(() => next);
    return wait.then(() => release);
  }
}

async function run(db, text, params) {
  if (params?.length) {
    const r = await db.query(text, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length, fields: r.fields };
  }
  // Tanpa parameter: boleh berisi beberapa statement (mis. file migrasi)
  const all = await db.exec(text);
  const r = all[all.length - 1] || { rows: [], fields: [] };
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length, fields: r.fields };
}

class Pool {
  constructor({ connectionString }) {
    const dataDir = connectionString.replace(/^pglite:(\/\/)?/, '') || 'memory://';
    this.ready = opener(dataDir === 'memory' ? 'memory://' : dataDir, { parsers });
    this.mutex = new Mutex();
  }

  async query(text, params) {
    return run(await this.ready, text, params);
  }

  /** PGlite hanya punya satu koneksi: transaksi dijalankan bergantian. */
  async connect() {
    const db = await this.ready;
    const release = await this.mutex.lock();
    return { query: (text, params) => run(db, text, params), release };
  }

  async end() {
    const db = await this.ready;
    if (this.onEnd) await this.onEnd(db);
    await db.close();
  }
}

const noop = () => {};
export default { Pool, types: { setTypeParser: noop } };
