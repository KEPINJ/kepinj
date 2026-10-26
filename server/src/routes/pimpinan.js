// Laporan pimpinan: perbandingan kinerja penatausahaan seluruh SKPD
import { query } from '../db.js';
import { requireRole } from '../auth.js';
import { int, sendFile, XLSX } from '../lib/http.js';
import { buildWorkbook } from '../lib/excel.js';
import { cariAnomali } from './anomali.js';
import { NAMA_BULAN } from '../lib/kalender.js';

export async function dataPimpinan(tahun) {
  const { rows } = await query(`
    SELECT s.id, s.kode, s.nama, s.bendahara_nama,
      COALESCE((SELECT SUM(pagu) FROM anggaran a WHERE a.skpd_id = s.id AND a.tahun = $1), 0)::float AS pagu,
      COALESCE((SELECT SUM(CASE WHEN e.jenis = 'KOREKSI' THEN e.pengeluaran - e.penerimaan ELSE e.pengeluaran END) FROM bku_entries e
        JOIN rekening r ON r.kode = e.kode_rekening AND r.jenis = 'belanja'
        WHERE e.skpd_id = s.id AND e.tahun = $1 AND e.jenis IN ('BELANJA','SP2D_LS','KOREKSI')), 0)::float AS realisasi,
      COALESCE((SELECT SUM(penerimaan - pengeluaran) FROM bku_entries WHERE skpd_id = s.id AND tahun = $1), 0)::float AS saldo,
      COALESCE((SELECT SUM(nominal) FROM pajak WHERE skpd_id = s.id AND tahun = $1 AND status = 'dipungut'), 0)::float AS pajak_belum_setor,
      (SELECT COUNT(*) FROM bku_entries e WHERE e.skpd_id = s.id AND e.tahun = $1
         AND NOT EXISTS (SELECT 1 FROM bku_verifications v WHERE v.entry_id = e.id))::int AS belum_verifikasi,
      (SELECT COUNT(*) FROM bku_entries WHERE skpd_id = s.id AND tahun = $1)::int AS transaksi,
      (SELECT MAX(tanggal) FROM bku_entries WHERE skpd_id = s.id AND tahun = $1) AS transaksi_terakhir,
      COALESCE((SELECT MAX(bulan) FROM periode_kunci WHERE skpd_id = s.id AND tahun = $1), 0)::int AS tutup_buku_sd,
      (SELECT COUNT(*) FROM panjar WHERE skpd_id = s.id AND tahun = $1 AND status = 'berjalan')::int AS panjar_berjalan,
      (SELECT COUNT(*) FROM spp WHERE skpd_id = s.id AND tahun = $1 AND status IN ('spp','spm'))::int AS spp_proses
    FROM skpd s ORDER BY s.kode`, [tahun]);
  const now = new Date();
  const bulanSelesai = now.getFullYear() > tahun ? 12 : now.getFullYear() < tahun ? 0 : now.getMonth();
  const target = bulanSelesai / 12 * 100;
  const out = [];
  for (const r of rows) {
    const an = await cariAnomali(r.id, tahun);
    const persen = r.pagu ? (r.realisasi / r.pagu) * 100 : 0;
    out.push({ ...r, persen, anomali_kritis: an.ringkasan.bahaya, anomali_peringatan: an.ringkasan.peringatan,
      tertunda_tutup_buku: Math.max(0, bulanSelesai - r.tutup_buku_sd),
      status: persen < target - 15 ? 'lambat' : persen > 100 ? 'melebihi' : 'wajar' });
  }
  out.sort((a, b) => b.persen - a.persen).forEach((r, i) => { r.peringkat = i + 1; });
  const total = out.reduce((t, r) => ({ pagu: t.pagu + r.pagu, realisasi: t.realisasi + r.realisasi, saldo: t.saldo + r.saldo, pajak_belum_setor: t.pajak_belum_setor + r.pajak_belum_setor }),
    { pagu: 0, realisasi: 0, saldo: 0, pajak_belum_setor: 0 });
  return { tahun, bulan_selesai: bulanSelesai, target_serapan: target, rows: out, total: { ...total, persen: total.pagu ? (total.realisasi / total.pagu) * 100 : 0 } };
}

export default async function pimpinanRoutes(app) {
  app.get('/api/laporan/pimpinan', { preHandler: requireRole('admin', 'pimpinan') }, async (req, reply) => {
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const d = await dataPimpinan(tahun);
    if (req.query.format !== 'xlsx') return d;
    const buf = await buildWorkbook({
      title: 'LAPORAN PIMPINAN - KINERJA PENATAUSAHAAN KAS SELURUH SKPD',
      subtitle: `Tahun Anggaran ${tahun}${d.bulan_selesai ? ` | s.d. ${NAMA_BULAN[d.bulan_selesai - 1]}` : ''} | Target serapan linear ${d.target_serapan.toFixed(1)}%`,
      sheetName: 'Pimpinan',
      columns: [
        { key: 'peringkat', header: 'Peringkat', width: 9 }, { key: 'kode', header: 'Kode SKPD', width: 22 }, { key: 'nama', header: 'SKPD', width: 40 },
        { key: 'pagu', header: 'Pagu Belanja', type: 'money' }, { key: 'realisasi', header: 'Realisasi', type: 'money' }, { key: 'persen_r', header: 'Serapan %', type: 'number', width: 10 },
        { key: 'saldo', header: 'Saldo Kas', type: 'money' }, { key: 'pajak_belum_setor', header: 'Pajak Belum Setor', type: 'money' },
        { key: 'belum_verifikasi', header: 'Belum Verifikasi', type: 'number', width: 12 }, { key: 'tutup_buku', header: 'Tutup Buku s.d.', width: 14 },
        { key: 'anomali_kritis', header: 'Anomali Kritis', type: 'number', width: 12 },
      ],
      rows: d.rows.map((r) => ({ ...r, persen_r: Math.round(r.persen * 100) / 100, tutup_buku: r.tutup_buku_sd ? NAMA_BULAN[r.tutup_buku_sd - 1] : '-' })),
      totals: { pagu: d.total.pagu, realisasi: d.total.realisasi, saldo: d.total.saldo, pajak_belum_setor: d.total.pajak_belum_setor },
    });
    return sendFile(reply, buf, `Laporan_Pimpinan_${tahun}.xlsx`, XLSX);
  });
}
