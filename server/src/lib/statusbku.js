// Status persetujuan berjenjang & kelengkapan dokumen untuk setiap entri BKU.
// Entri BKU bersifat append-only (rantai hash), sehingga status disimpan di tabel proyeksi bku_status.
import { getPengaturan } from './pengaturan.js';
import { ATURAN_DOKUMEN, dokumenWajib, statusKelengkapan } from '../../../shared/dokumen.js';

// Saldo awal berasal dari tutup tahun; pungutan pajak mengikuti status transaksi belanjanya
export const TANPA_PERSETUJUAN = ['SALDO_AWAL', 'PAJAK_PUNGUT'];

/** Tahapan persetujuan untuk satu entri: tahap pimpinan dilewati bila nilai di bawah ambang kewenangan. */
export function tahapUntuk(entry, cfg) {
  if (cfg.alur_bku_aktif === false) return [];
  const nilai = Number(entry.penerimaan) || Number(entry.pengeluaran) || 0;
  const ambang = Number(cfg.bku_ambang_pimpinan) || 0;
  const alur = cfg.alur_bku || [];
  const hasil = alur.filter((t) => !(t.peran === 'pimpinan' && ambang > 0 && nilai < ambang));
  return hasil.length ? hasil : alur.slice(0, 1);
}

const ins = (cols, types) => `SELECT * FROM unnest(${types.map((t, i) => `$${i + 1}::${t}[]`).join(', ')}) AS x(${cols.join(', ')})`;

/** Daftarkan entri baru: buat status awal dan tahap persetujuan (dipanggil di transaksi yang sama dengan pencatatan). */
export async function daftarkanEntri(c, rows) {
  if (!rows.length) return;
  const cfg = await getPengaturan();
  const st = { id: [], skpd: [], tahun: [], status: [], tahap: [], peran: [], setuju: [], catatan: [] };
  const pr = { id: [], skpd: [], tahun: [], urutan: [], peran: [], label: [], status: [] };
  for (const r of rows) {
    const tahap = TANPA_PERSETUJUAN.includes(r.jenis) ? [] : tahapUntuk(r, cfg);
    const otomatis = !tahap.length && r.jenis !== 'PAJAK_PUNGUT';
    st.id.push(r.id); st.skpd.push(r.skpd_id); st.tahun.push(r.tahun);
    st.status.push(otomatis ? 'disetujui' : 'menunggu');
    st.tahap.push(tahap[0]?.label || null); st.peran.push(tahap[0]?.peran || null);
    st.setuju.push(otomatis ? new Date().toISOString() : null);
    st.catatan.push(otomatis ? (r.jenis === 'SALDO_AWAL' ? 'Saldo awal hasil tutup tahun, tidak memerlukan persetujuan' : 'Alur persetujuan transaksi tidak aktif') : null);
    tahap.forEach((t, i) => {
      pr.id.push(String(r.id)); pr.skpd.push(r.skpd_id); pr.tahun.push(r.tahun); pr.urutan.push(i + 1);
      pr.peran.push(t.peran); pr.label.push(t.label); pr.status.push(i === 0 ? 'menunggu' : 'antre');
    });
  }
  await c.query(`INSERT INTO bku_status (entry_id, skpd_id, tahun, status, tahap, peran_menunggu, disetujui_at, catatan)
    ${ins(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], ['bigint', 'int', 'int', 'text', 'text', 'text', 'timestamptz', 'text'])}`,
  [st.id, st.skpd, st.tahun, st.status, st.tahap, st.peran, st.setuju, st.catatan]);
  if (pr.id.length) {
    await c.query(`INSERT INTO persetujuan (objek, objek_id, skpd_id, tahun, putaran, urutan, peran, label, status)
      SELECT 'bku', a, b, c, 1, d, e, f, g FROM (${ins(['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['text', 'int', 'int', 'int', 'text', 'text', 'text'])}) q`,
    [pr.id, pr.skpd, pr.tahun, pr.urutan, pr.peran, pr.label, pr.status]);
  }
}

/** Pungutan pajak mengikuti status transaksi belanja induknya. */
export async function tautkanInduk(c, anakIds, indukId) {
  if (!anakIds.length) return;
  await c.query(`UPDATE bku_status a SET induk_id = $2, status = i.status, disetujui_at = i.disetujui_at, diperbarui_at = now()
    FROM bku_status i WHERE i.entry_id = $2 AND a.entry_id = ANY($1)`, [anakIds, indukId]);
}

/** Setel status entri (dan pungutan pajak turunannya). */
export async function setelStatus(c, entryId, { status, tahap = null, peran = null, catatan, putaran }) {
  const set = ['status = $2', 'tahap = $3', 'peran_menunggu = $4', 'diperbarui_at = now()',
    "disetujui_at = CASE WHEN $2 = 'disetujui' THEN now() ELSE NULL END"];
  const p = [entryId, status, tahap, peran];
  if (catatan !== undefined) { p.push(catatan); set.push(`catatan = $${p.length}`); }
  if (putaran !== undefined) { p.push(putaran); set.push(`putaran = $${p.length}`); }
  await c.query(`UPDATE bku_status SET ${set.join(', ')} WHERE entry_id = $1 OR induk_id = $1`, p);
}

/** Hitung ulang kelengkapan dokumen untuk sejumlah entri. */
export async function hitungKelengkapan(c, ids, cfg) {
  const daftar = [...new Set(ids.map(Number))].filter(Boolean);
  if (!daftar.length) return;
  const aturan = (cfg || await getPengaturan()).aturan_dokumen || ATURAN_DOKUMEN;
  for (let i = 0; i < daftar.length; i += 2000) {
    const potong = daftar.slice(i, i + 2000);
    const { rows } = await c.query(`SELECT e.id, e.jenis, e.metode, e.kode_rekening,
        EXISTS (SELECT 1 FROM bku_status s2 WHERE s2.induk_id = e.id) AS ada_pajak,
        COALESCE((SELECT array_agg(DISTINCT l.jenis_dokumen) FROM lampiran l WHERE l.bku_entry_id = e.id AND l.dihapus_at IS NULL), '{}') AS ada
      FROM bku_entries e WHERE e.id = ANY($1)`, [potong]);
    const id = []; const st = []; const kurang = [];
    for (const r of rows) {
      const k = statusKelengkapan(dokumenWajib(r, { adaPajak: r.ada_pajak }, aturan), r.ada);
      id.push(r.id); st.push(k.status); kurang.push(`{${k.kurang.join(',')}}`);
    }
    await c.query(`UPDATE bku_status s SET dokumen_status = x.st, dokumen_kurang = x.k::text[]
      FROM unnest($1::bigint[], $2::text[], $3::text[]) AS x(id, st, k) WHERE s.entry_id = x.id`, [id, st, kurang]);
  }
}

/** Hitung kelengkapan semua entri yang belum punya status dokumen (data lama / setelah aturan diubah). */
export async function lengkapiKelengkapan(c, { semua = false, skpd = null } = {}) {
  const { rows } = await c.query(`SELECT entry_id FROM bku_status WHERE ($1 OR dokumen_status IS NULL) AND ($2::int IS NULL OR skpd_id = $2)`, [semua, skpd]);
  await hitungKelengkapan(c, rows.map((r) => r.entry_id));
  return rows.length;
}
