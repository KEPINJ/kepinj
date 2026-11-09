// Adaptor PGlite (PostgreSQL WASM) dengan antarmuka yang sama seperti modul `pg`.
// Dipakai untuk mode demo di browser (GitHub Pages), snapshot demo saat build, dan
// hosting tanpa server PostgreSQL (mis. shared hosting cPanel): DATABASE_URL=pglite:/path/folder.
const DATE = 1082;
const INT8 = 20;
const NUMERIC = 1700;

let opener = async (dataDir, opts) => {
  const { PGlite } = await import('@electric-sql/pglite');
  if (!dataDir.includes('://')) await lockDataDir(dataDir);
  return PGlite.create(dataDir, opts);
};

/**
 * PGlite hanya boleh dibuka satu proses. Saat hosting me-restart aplikasi, proses baru
 * menunggu proses lama selesai menutup database (maks. 30 detik).
 */
async function lockDataDir(dataDir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const lock = `${path.resolve(dataDir)}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  for (let i = 0; i < 60; i++) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      process.on('exit', () => { try { fs.unlinkSync(lock); } catch { /* sudah terhapus */ } });
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (!pid || pid === process.pid || !alive(pid)) { fs.rmSync(lock, { force: true }); continue; }
      await new Promise((r) => { setTimeout(r, 500); });
    }
  }
  throw new Error(`Database ${dataDir} sedang dipakai proses lain (lihat ${lock})`);
}

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
