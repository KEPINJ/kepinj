// Pencadangan & pemulihan basis data dari dalam aplikasi (tanpa pg_dump, cocok untuk hosting bersama).
// Berkas: NDJSON terkompresi gzip, satu baris judul per tabel diikuti baris datanya, dengan sidik SHA-256.
// Pemulihan berjalan dalam satu transaksi: gagal di tengah = basis data kembali seperti semula.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { pool, query, tx, audit } from '../db.js';
import { requireRole } from '../auth.js';
import { bad, notFound } from '../lib/http.js';
import { config } from '../config.js';
import { getPengaturan, simpanPengaturan } from '../lib/pengaturan.js';
import { verifyChain } from '../lib/ledger.js';
import { daftarTugasHarian } from './pengingatluar.js';

const VERSI = 1;
const LEWATI = new Set(['schema_migrations']);
// Kunci periode dipulihkan paling akhir agar trigger kunci periode tidak menolak baris lama
const AKHIR = ['periode_kunci', 'tutup_tahun'];
const NAMA = /^bku-\d{8}-\d{6}(-(?:[a-z]+\d*|\d+))?\.ndjson\.gz$/;

/** Daftar tabel aplikasi berurutan sesuai ketergantungan foreign key (induk lebih dulu). */
async function urutanTabel(c) {
  const { rows: t } = await c.query(`SELECT c.relname AS nama FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY 1`);
  const { rows: fk } = await c.query(`SELECT cl.relname AS anak, pa.relname AS induk FROM pg_constraint k
    JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_class pa ON pa.oid = k.confrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE k.contype = 'f' AND n.nspname = 'public' AND NOT cl.relispartition AND cl.oid <> pa.oid`);
  const nama = t.map((r) => r.nama).filter((n) => !LEWATI.has(n));
  const out = []; const sudah = new Set();
  const kunjungi = (n, jejak = new Set()) => {
    if (sudah.has(n) || jejak.has(n)) return;
    jejak.add(n);
    for (const f of fk.filter((x) => x.anak === n)) if (nama.includes(f.induk)) kunjungi(f.induk, jejak);
    sudah.add(n); out.push(n);
  };
  nama.forEach((n) => kunjungi(n));
  return [...out.filter((n) => !AKHIR.includes(n)), ...AKHIR.filter((n) => out.includes(n))];
}

/** Pembaca baris berkas .ndjson.gz; galat gzip (berkas rusak/terpotong) diteruskan ke perulangan, tidak mematikan proses. */
function bacaBaris(path) {
  const src = createReadStream(path);
  const gz = createGunzip();
  src.on('error', (e) => gz.destroy(e));
  const rl = createInterface({ input: src.pipe(gz), crlfDelay: Infinity });
  rl.on('error', () => {});
  gz.on('close', () => src.destroy());
  return rl;
}

/** Baca seluruh isi berkas untuk memastikan gzip utuh dan berjudul cadangan BKU. */
async function periksaIsi(path) {
  let baris = 0; let judul = null; let galat = null;
  try {
    for await (const line of bacaBaris(path)) { if (!judul) judul = JSON.parse(line); else if (line.trim()) baris++; }
    if (judul?.format !== 'bku-cadangan') galat = 'Berkas bukan cadangan aplikasi BKU';
  } catch { galat = judul ? 'Isi berkas rusak atau terpotong' : 'Berkas bukan cadangan aplikasi BKU'; }
  return { judul, baris, galat };
}

const namaUnik = (akhiran) => {
  const dasar = `bku-${cap()}${akhiran ? `-${akhiran}` : ''}`;
  let nama = `${dasar}.ndjson.gz`;
  for (let i = 2; existsSync(`${config.backupDir}/${nama}`); i++) nama = `${akhiran ? dasar : `${dasar}-`}${i}.ndjson.gz`;
  return nama;
};
const cap = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

async function sha256File(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

/** Buat cadangan lengkap; mengembalikan metadata. */
export async function buatCadangan({ pemicu = 'manual', user = null } = {}) {
  await mkdir(config.backupDir, { recursive: true });
  const nama = namaUnik(pemicu === 'otomatis' ? 'auto' : pemicu === 'pra-pulih' ? 'prapulih' : '');
  const tujuan = `${config.backupDir}/${nama}`;
  const c = await pool.connect();
  const ringkas = {};
  try {
    // Snapshot konsisten: semua tabel dibaca dari titik waktu yang sama
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tabel = await urutanTabel(c);
    const { rows: mig } = await c.query('SELECT name FROM schema_migrations ORDER BY name').catch(() => ({ rows: [] }));
    async function* baris() {
      yield `${JSON.stringify({ format: 'bku-cadangan', versi: VERSI, dibuat: new Date().toISOString(), migrasi: mig.map((m) => m.name), tabel, pemicu, oleh: user?.username || null })}\n`;
      for (const t of tabel) {
        const { rows: [{ n }] } = await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
        ringkas[t] = n;
        yield `${JSON.stringify({ tabel: t, jumlah: n })}\n`;
        for (let off = 0; off < n; off += 2000) {
          const { rows } = await c.query(`SELECT row_to_json(x)::text AS j FROM (SELECT * FROM "${t}" ORDER BY 1 LIMIT 2000 OFFSET ${off}) x`);
          yield `${rows.map((r) => r.j).join('\n')}\n`;
        }
      }
    }
    await pipeline(Readable.from(baris()), createGzip({ level: 6 }), createWriteStream(`${tujuan}.tmp`));
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    await unlink(`${tujuan}.tmp`).catch(() => {});
    throw e;
  } finally { c.release(); }
  await rename(`${tujuan}.tmp`, tujuan);
  const meta = { nama, dibuat: new Date().toISOString(), ukuran: (await stat(tujuan)).size, sha256: await sha256File(tujuan), pemicu, oleh: user?.username || null,
    tabel: Object.keys(ringkas).length, baris: Object.values(ringkas).reduce((s, n) => s + n, 0), bku: ringkas.bku_entries || 0 };
  await writeFile(`${tujuan}.json`, JSON.stringify(meta, null, 2));
  await rotasi();
  return meta;
}

/** Simpan N cadangan otomatis terbaru; cadangan manual tidak dihapus otomatis. */
async function rotasi() {
  const simpan = Number((await getPengaturan()).cadangan_simpan) || 14;
  const auto = (await daftarCadangan()).filter((m) => m.pemicu === 'otomatis');
  for (const m of auto.slice(simpan)) {
    await unlink(`${config.backupDir}/${m.nama}`).catch(() => {});
    await unlink(`${config.backupDir}/${m.nama}.json`).catch(() => {});
  }
}

export async function daftarCadangan() {
  await mkdir(config.backupDir, { recursive: true });
  const files = (await readdir(config.backupDir)).filter((f) => NAMA.test(f));
  const out = [];
  for (const f of files) {
    const meta = await readFile(`${config.backupDir}/${f}.json`, 'utf8').then(JSON.parse).catch(async () => ({ nama: f, dibuat: (await stat(`${config.backupDir}/${f}`)).mtime.toISOString(), ukuran: (await stat(`${config.backupDir}/${f}`)).size, pemicu: 'unggahan' }));
    out.push(meta);
  }
  return out.sort((a, b) => b.dibuat.localeCompare(a.dibuat));
}

const jalur = (nama) => {
  if (!NAMA.test(String(nama))) throw bad('Nama berkas cadangan tidak valid');
  return `${config.backupDir}/${nama}`;
};

/** Pulihkan basis data dari berkas cadangan. Semua tabel aplikasi diganti isinya. */
export async function pulihkan(nama, user) {
  const path = jalur(nama);
  const meta = await readFile(`${path}.json`, 'utf8').then(JSON.parse).catch(() => null);
  if (meta?.sha256 && meta.sha256 !== await sha256File(path)) throw bad('Sidik berkas tidak cocok: berkas cadangan rusak atau telah diubah');
  const { galat } = await periksaIsi(path);
  if (galat) throw bad(galat);
  const pra = await buatCadangan({ pemicu: 'pra-pulih', user });
  const c = await pool.connect();
  const hasil = {};
  try {
    await c.query('BEGIN');
    const tabelDb = await urutanTabel(c);
    const rl = bacaBaris(path);
    let judul = null; let tabel = null; let buf = [];
    const flush = async () => {
      if (!buf.length) return;
      await c.query(`INSERT INTO "${tabel}" SELECT * FROM json_populate_recordset(NULL::"${tabel}", $1::json)`, [`[${buf.join(',')}]`]);
      hasil[tabel] = (hasil[tabel] || 0) + buf.length; buf = [];
    };
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (!judul) {
        judul = JSON.parse(line);
        if (judul.format !== 'bku-cadangan') throw bad('Bukan berkas cadangan aplikasi BKU');
        const kurang = judul.tabel.filter((t) => !tabelDb.includes(t));
        if (kurang.length) throw bad(`Struktur basis data tidak cocok (tabel tidak ada: ${kurang.join(', ')})`);
        await c.query(`TRUNCATE ${tabelDb.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
        continue;
      }
      if (line.startsWith('{"tabel":')) {
        const h = JSON.parse(line);
        if (h.jumlah !== undefined && Object.keys(h).length === 2) { await flush(); tabel = h.tabel; continue; }
      }
      buf.push(line);
      if (buf.length >= 1000) await flush();
    }
    await flush();
    // Sinkronkan sequence (id serial) dengan data yang dipulihkan
    const { rows: seq } = await c.query(`SELECT c.relname AS tabel, a.attname AS kolom, pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS seq
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition AND a.attnum > 0 AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL`);
    for (const s of seq) await c.query(`SELECT setval($1, COALESCE((SELECT MAX("${s.kolom}") FROM "${s.tabel}"), 0) + 1, false)`, [s.seq]);
    await audit(c, user, 'cadangan_pulihkan', 'cadangan', nama, { baris: Object.values(hasil).reduce((a, b) => a + b, 0), cadangan_pra_pulih: pra.nama }, null);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
  // Periksa ulang rantai hash BKU setelah pemulihan
  const { rows: rantai } = await query('SELECT DISTINCT skpd_id, tahun FROM bku_entries ORDER BY 1, 2');
  const cek = await pool.connect();
  const integritas = [];
  try { for (const r of rantai) integritas.push({ ...r, valid: (await verifyChain(cek, r.skpd_id, r.tahun)).valid }); } finally { cek.release(); }
  return { tabel: Object.keys(hasil).length, baris: Object.values(hasil).reduce((a, b) => a + b, 0), cadangan_pra_pulih: pra.nama, integritas_utuh: integritas.every((i) => i.valid), integritas };
}

daftarTugasHarian('cadangan_terakhir', 'cadangan_jam', 'cadangan_aktif', () => buatCadangan({ pemicu: 'otomatis' }));

export default async function cadanganRoutes(app) {
  app.get('/api/cadangan', { preHandler: requireRole('admin') }, async () => {
    const cfg = await getPengaturan();
    const daftar = await daftarCadangan();
    return { daftar, pengaturan: { cadangan_aktif: cfg.cadangan_aktif, cadangan_jam: cfg.cadangan_jam, cadangan_simpan: cfg.cadangan_simpan }, terakhir: cfg.cadangan_terakhir || null,
      folder: config.backupDir, total_ukuran: daftar.reduce((s, m) => s + (m.ukuran || 0), 0) };
  });

  app.post('/api/cadangan', { preHandler: requireRole('admin') }, async (req) => {
    const meta = await buatCadangan({ pemicu: 'manual', user: req.user });
    await tx((c) => audit(c, req.user, 'cadangan_buat', 'cadangan', meta.nama, { ukuran: meta.ukuran, baris: meta.baris }, req.ip));
    return meta;
  });

  app.get('/api/cadangan/:nama/unduh', { preHandler: requireRole('admin') }, async (req, reply) => {
    const path = jalur(req.params.nama);
    await stat(path).catch(() => { throw notFound('Berkas cadangan tidak ditemukan'); });
    await tx((c) => audit(c, req.user, 'cadangan_unduh', 'cadangan', req.params.nama, null, req.ip));
    return reply.header('Content-Type', 'application/gzip').header('Content-Disposition', `attachment; filename="${req.params.nama}"`).send(createReadStream(path));
  });

  app.post('/api/cadangan/:nama/verifikasi', { preHandler: requireRole('admin') }, async (req) => {
    const path = jalur(req.params.nama);
    const meta = await readFile(`${path}.json`, 'utf8').then(JSON.parse).catch(() => null);
    const sidik = await sha256File(path);
    const { judul, baris, galat } = await periksaIsi(path);
    return { utuh: !galat && (!meta?.sha256 || meta.sha256 === sidik), galat, sidik, tercatat: meta?.sha256 || null, versi: judul?.versi, dibuat: judul?.dibuat, tabel: judul?.tabel?.length, baris_berkas: baris };
  });

  app.post('/api/cadangan/:nama/pulihkan', { preHandler: requireRole('admin') }, async (req) => {
    if (req.body?.konfirmasi !== 'PULIHKAN') throw bad('Ketik PULIHKAN untuk mengonfirmasi pemulihan');
    return pulihkan(req.params.nama, req.user);
  });

  app.post('/api/cadangan/unggah', { preHandler: requireRole('admin') }, async (req) => {
    const file = await req.file();
    if (!file) throw bad('Pilih berkas cadangan (.ndjson.gz)');
    await mkdir(config.backupDir, { recursive: true });
    const nama = namaUnik('unggah');
    await pipeline(file.file, createWriteStream(`${config.backupDir}/${nama}`));
    if (file.file.truncated) { await unlink(`${config.backupDir}/${nama}`); throw bad('Berkas melebihi batas unggah'); }
    // Validasi seluruh isi berkas sebelum diterima
    const { galat } = await periksaIsi(`${config.backupDir}/${nama}`);
    if (galat) { await unlink(`${config.backupDir}/${nama}`).catch(() => {}); throw bad(galat); }
    const p = `${config.backupDir}/${nama}`;
    const meta = { nama, dibuat: new Date().toISOString(), ukuran: (await stat(p)).size, sha256: await sha256File(p), pemicu: 'unggahan', oleh: req.user.username, asal: file.filename };
    await writeFile(`${p}.json`, JSON.stringify(meta, null, 2));
    await tx((c) => audit(c, req.user, 'cadangan_unggah', 'cadangan', nama, { asal: file.filename }, req.ip));
    return meta;
  });

  app.delete('/api/cadangan/:nama', { preHandler: requireRole('admin') }, async (req) => {
    const path = jalur(req.params.nama);
    await unlink(path).catch(() => { throw notFound(); });
    await unlink(`${path}.json`).catch(() => {});
    await tx((c) => audit(c, req.user, 'cadangan_hapus', 'cadangan', req.params.nama, null, req.ip));
    return { ok: true };
  });

  app.put('/api/cadangan/pengaturan', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    const nilai = {};
    if ('cadangan_aktif' in b) nilai.cadangan_aktif = Boolean(b.cadangan_aktif);
    if ('cadangan_jam' in b) { if (!/^\d{2}:\d{2}$/.test(b.cadangan_jam)) throw bad('Jam format HH:MM'); nilai.cadangan_jam = b.cadangan_jam; }
    if ('cadangan_simpan' in b) nilai.cadangan_simpan = Math.max(1, Math.min(90, Number(b.cadangan_simpan) || 14));
    return tx(async (c) => { await simpanPengaturan(c, nilai); await audit(c, req.user, 'cadangan_pengaturan', 'pengaturan', null, nilai, req.ip); return { ok: true }; });
  });
}
