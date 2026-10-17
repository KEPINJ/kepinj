// Uji beban: isi N entri BKU lalu ukur waktu kueri utama.
// Pakai database terpisah: DATABASE_URL=postgres://bku:bku@localhost:5432/bku_load node scripts/loadtest.js 500000
import { pool, tx } from '../src/db.js';
import { migrate } from '../src/db/migrate.js';
import { insertEntries, verifyChain } from '../src/lib/ledger.js';

const N = Number(process.argv[2] || 100000);
await migrate();
const skipInsert = N === 0;
const { rows: [s] } = await pool.query("INSERT INTO skpd (kode, nama) VALUES ('LOAD', 'SKPD Uji Beban') ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama RETURNING id");
const { rows: [u] } = await pool.query("INSERT INTO users (username, full_name, password_hash, role, skpd_id) VALUES ('load', 'Uji Beban', 'x', 'bendahara', $1) ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id, full_name", [s.id]);
const t0 = Date.now();
for (let i = 0; !skipInsert && i < N; i += 10000) {
  const batch = Array.from({ length: Math.min(10000, N - i) }, (_, k) => {
    const n = i + k; const day = 1 + (n % 365);
    const d = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
    return n % 3 === 0 ? { tanggal: d, uraian: `Penerimaan uji ${n}`, penerimaan: 1_000_000 + (n % 997), jenis: 'PENERIMAAN', no_bukti: `L-${n}` }
      : { tanggal: d, uraian: `Belanja uji ${n}`, pengeluaran: 400_000 + (n % 991), jenis: 'BELANJA', no_bukti: `L-${n}` };
  });
  await tx((c) => insertEntries(c, u, s.id, batch));
}
const ins = (Date.now() - t0) / 1000;
console.log(`Insert ${N.toLocaleString('id-ID')} entri: ${ins.toFixed(1)} s (${Math.round(N / ins).toLocaleString('id-ID')} entri/detik)`);
await pool.query('ANALYZE bku_entries');
const time = async (label, sql, p) => { const t = Date.now(); await pool.query(sql, p); console.log(`${label}: ${Date.now() - t} ms`); };
await time('Halaman BKU 1 bulan (50 baris, saldo berjalan)', `WITH base AS (SELECT e.*, 0 + SUM(penerimaan - pengeluaran) OVER (ORDER BY tanggal, no_urut) saldo FROM bku_entries e
  WHERE skpd_id = $1 AND tahun = 2026 AND tanggal BETWEEN '2026-10-01' AND '2026-10-31')
  SELECT *, COUNT(*) OVER () FROM base ORDER BY tanggal, no_urut LIMIT 50`, [s.id]);
await time('Ringkasan saldo periode', `SELECT SUM(penerimaan - pengeluaran) FILTER (WHERE tanggal < '2026-10-01'), SUM(penerimaan) FILTER (WHERE tanggal BETWEEN '2026-10-01' AND '2026-10-31') FROM bku_entries WHERE skpd_id = $1 AND tahun = 2026`, [s.id]);
await time('Pencarian uraian', `SELECT * FROM bku_entries WHERE skpd_id = $1 AND tahun = 2026 AND uraian ILIKE '%uji 4242%' LIMIT 50`, [s.id]);
const t1 = Date.now();
const c = await pool.connect();
const v = await verifyChain(c, s.id, 2026);
c.release();
console.log(`Verifikasi rantai hash ${v.jumlah_entri.toLocaleString('id-ID')} entri: ${Date.now() - t1} ms, valid=${v.valid}`);
const { rows: [z] } = await pool.query("SELECT pg_size_pretty(pg_total_relation_size('bku_entries_2026')) AS ukuran");
console.log(`Ukuran partisi 2026: ${z.ukuran}`);
await pool.end();
