// Panjar (uang muka kegiatan) kepada PPTK/pelaksana. Panjar dicatat di Buku Pembantu Panjar;
// saat dipertanggungjawabkan, realisasinya dibukukan sebagai belanja di BKU.
import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, notFound, int, isDate, money, scopeSkpd, canWrite, required } from '../lib/http.js';
import { catatTransaksi } from '../lib/transaksi.js';
import { getPengaturan } from '../lib/pengaturan.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { hariIni, selisihHari } from '../lib/kalender.js';

const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

daftarNotifikasi(async ({ skpd, tahun, today }) => {
  const { rows } = await query("SELECT nomor, penerima_nama, nilai, batas_tanggal FROM panjar WHERE skpd_id = $1 AND tahun = $2 AND status = 'berjalan' AND batas_tanggal < $3 ORDER BY batas_tanggal", [skpd, tahun, today]);
  if (!rows.length) return [];
  const total = rows.reduce((s, r) => s + Number(r.nilai), 0);
  return [{ id: `panjar-${rows.map((r) => r.nomor).join(',')}`, tipe: 'panjar', tingkat: 'peringatan',
    judul: `${rows.length} panjar melewati batas pertanggungjawaban`,
    pesan: `${rows.slice(0, 2).map((r) => `${r.penerima_nama} (${r.nomor})`).join(', ')}${rows.length > 2 ? ', …' : ''} · total Rp ${Math.round(total).toLocaleString('id-ID')}.`, link: '/panjar', tanggal: today }];
});

export default async function panjarRoutes(app) {
  app.get('/api/panjar', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const { rows } = await query(`SELECT p.*, r.nama AS rekening_nama, g.nip, g.jabatan, u.full_name AS dibuat_oleh
      FROM panjar p LEFT JOIN rekening r ON r.kode = p.kode_rekening LEFT JOIN pegawai g ON g.id = p.pegawai_id LEFT JOIN users u ON u.id = p.created_by
      WHERE p.skpd_id = $1 AND p.tahun = $2 ORDER BY p.status, p.tanggal DESC, p.id DESC`, [skpd, tahun]);
    const today = hariIni();
    const out = rows.map((r) => ({ ...r, sisa_hari: r.status === 'berjalan' ? selisihHari(today, r.batas_tanggal) : null }));
    const berjalan = out.filter((r) => r.status === 'berjalan');
    return {
      rows: out,
      ringkasan: {
        berjalan: berjalan.length, nilai_berjalan: berjalan.reduce((s, r) => s + Number(r.nilai), 0),
        lewat: berjalan.filter((r) => r.sisa_hari < 0).length,
        selesai: out.length - berjalan.length, realisasi: out.reduce((s, r) => s + Number(r.realisasi || 0), 0),
        dikembalikan: out.reduce((s, r) => s + Number(r.sisa_kembali || 0), 0),
      },
      batas_hari: Number((await getPengaturan()).batas_hari_panjar),
    };
  });

  app.post('/api/panjar', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['tanggal', 'kegiatan', 'nilai']);
    if (!isDate(b.tanggal)) throw bad('Tanggal tidak valid');
    const nilai = money(b.nilai);
    if (!(nilai > 0)) throw bad('Nilai panjar harus lebih dari nol');
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    const cfg = await getPengaturan();
    const batas = isDate(b.batas_tanggal) ? b.batas_tanggal : addDays(b.tanggal, Number(cfg.batas_hari_panjar));
    if (batas < b.tanggal) throw bad('Batas pertanggungjawaban tidak boleh sebelum tanggal panjar');
    return tx(async (c) => {
      let penerima = String(b.penerima_nama || '').trim();
      if (b.pegawai_id) {
        const { rows: [g] } = await c.query('SELECT nama FROM pegawai WHERE id = $1', [b.pegawai_id]);
        if (!g) throw bad('Pegawai tidak ditemukan');
        penerima = g.nama;
      }
      if (!penerima) throw bad('Pilih pegawai/PPTK atau isi nama penerima panjar');
      const tahun = Number(b.tanggal.slice(0, 4));
      const { rows: [n] } = await c.query('SELECT COUNT(*)::int + 1 AS n FROM panjar WHERE skpd_id = $1 AND tahun = $2', [skpd, tahun]);
      const nomor = `PJR-${String(n.n).padStart(3, '0')}/${tahun}`;
      const { rows: [r] } = await c.query(`INSERT INTO panjar (skpd_id, tahun, nomor, tanggal, pegawai_id, penerima_nama, kegiatan, kode_rekening, nilai, metode, batas_tanggal, catatan, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [skpd, tahun, nomor, b.tanggal, b.pegawai_id || null, penerima, String(b.kegiatan).slice(0, 500), b.kode_rekening || null, nilai, b.metode === 'bank' ? 'bank' : 'tunai', batas, b.catatan || null, req.user.id]);
      await audit(c, req.user, 'panjar_beri', 'panjar', r.id, { nomor, nilai, penerima }, req.ip);
      await emit(c, 'panjar.updated', String(skpd), { skpd_id: skpd, id: r.id, user: req.user.full_name });
      return { row: r };
    });
  });

  // Pertanggungjawaban: realisasi dibukukan sebagai belanja (beserta pajaknya), sisa dikembalikan ke bendahara
  app.post('/api/panjar/:id/selesai', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['tanggal', 'realisasi']);
    if (!isDate(b.tanggal)) throw bad('Tanggal tidak valid');
    const realisasi = money(b.realisasi);
    if (realisasi < 0) throw bad('Realisasi tidak boleh negatif');
    return tx(async (c) => {
      const { rows: [p] } = await c.query('SELECT * FROM panjar WHERE id = $1 FOR UPDATE', [int(req.params.id)]);
      if (!p) throw notFound();
      canWrite(req.user, p.skpd_id);
      if (p.status !== 'berjalan') throw bad('Panjar ini sudah dipertanggungjawabkan');
      if (b.tanggal < p.tanggal) throw bad('Tanggal pertanggungjawaban tidak boleh sebelum tanggal panjar');
      const kode = b.kode_rekening || p.kode_rekening;
      if (realisasi > 0 && !kode) throw bad('Pilih kode rekening belanja untuk realisasi panjar');
      const ids = [];
      if (realisasi > 0) {
        const { entry } = await catatTransaksi(c, req.user, p.skpd_id, {
          tanggal: b.tanggal, jenis: 'BELANJA', no_bukti: b.no_bukti || p.nomor, kode_rekening: kode, metode: p.metode,
          uraian: b.uraian || `Pertanggungjawaban panjar ${p.nomor}: ${p.kegiatan} (${p.penerima_nama})`, pengeluaran: realisasi, pajak: b.pajak || [],
        });
        ids.push(entry.id);
      }
      const sisa = Math.max(0, Number(p.nilai) - realisasi);
      const { rows: [r] } = await c.query(`UPDATE panjar SET status = 'selesai', tanggal_selesai = $2, realisasi = $3, sisa_kembali = $4, bku_entry_ids = $5,
        catatan = COALESCE($6, catatan), updated_at = now() WHERE id = $1 RETURNING *`, [p.id, b.tanggal, realisasi, sisa, ids, b.catatan || null]);
      await audit(c, req.user, 'panjar_selesai', 'panjar', p.id, { realisasi, sisa, bku: ids }, req.ip);
      await emit(c, 'panjar.updated', String(p.skpd_id), { skpd_id: p.skpd_id, id: p.id, user: req.user.full_name });
      return { row: r, kurang_bayar: Math.max(0, realisasi - Number(p.nilai)) };
    });
  });
}
