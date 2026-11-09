// Monitoring pagu dan realisasi anggaran belanja: total pagu, realisasi, sisa, persentase penyerapan,
// perbandingan antarbulan (realisasi vs rencana anggaran kas), perbandingan antar-SKPD, dan indikator
// penyerapan rendah / mendekati pagu / melampaui pagu.
//   Persentase realisasi = realisasi / pagu x 100%
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, int, scopeSkpd, sendFile, XLSX } from '../lib/http.js';
import { buildWorkbook } from '../lib/excel.js';
import { getPengaturan } from '../lib/pengaturan.js';
import { NAMA_BULAN } from '../lib/kalender.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';

// Realisasi belanja: belanja + SP2D LS, dikurangi koreksi; basis 'disetujui' hanya menghitung transaksi yang lolos persetujuan berjenjang
const NILAI = "CASE WHEN e.jenis = 'KOREKSI' THEN e.pengeluaran - e.penerimaan ELSE e.pengeluaran END";
const FILTER_REAL = (basis) => `e.kode_rekening IS NOT NULL AND e.jenis IN ('BELANJA','SP2D_LS','KOREKSI') AND e.kode_rekening LIKE '5%'
  ${basis === 'disetujui' ? "AND EXISTS (SELECT 1 FROM bku_status bs WHERE bs.entry_id = e.id AND bs.status IN ('disetujui','dikoreksi'))" : "AND NOT EXISTS (SELECT 1 FROM bku_status bs WHERE bs.entry_id = e.id AND bs.status IN ('ditolak'))"}`;

export const KELOMPOK = [
  { prefiks: '5.1.01', nama: 'Belanja Pegawai' }, { prefiks: '5.1.02', nama: 'Belanja Barang dan Jasa' }, { prefiks: '5.1.05', nama: 'Belanja Hibah' },
  { prefiks: '5.1', nama: 'Belanja Operasi lainnya' }, { prefiks: '5.2', nama: 'Belanja Modal' }, { prefiks: '5.3', nama: 'Belanja Tidak Terduga' }, { prefiks: '5.4', nama: 'Belanja Transfer' },
];
const kelompokDari = (kode) => KELOMPOK.find((k) => kode.startsWith(k.prefiks)) || { prefiks: '5', nama: 'Belanja lainnya' };

/**
 * Indikator penyerapan satu baris anggaran.
 * target = porsi rencana (anggaran kas) s.d. bulan berjalan, atau porsi waktu berlalu bila anggaran kas belum diisi.
 */
export function indikator({ pagu, realisasi, target }, { ambangPagu = 90, ambangRendah = 20 } = {}) {
  if (!pagu) return realisasi > 0 ? 'tanpa_pagu' : 'kosong';
  const persen = (realisasi / pagu) * 100;
  if (persen > 100) return 'melampaui';
  if (persen >= ambangPagu) return 'mendekati';
  if (target != null && target - persen >= ambangRendah) return 'rendah';
  return 'normal';
}

// Pusat notifikasi: rekening yang mendekati/melampaui pagu
daftarNotifikasi(async ({ user, skpd, tahun }) => {
  if (!['admin', 'bendahara', 'pimpinan', 'verifikator'].includes(user.role)) return [];
  const now = new Date();
  const bulanSd = now.getFullYear() === tahun ? now.getMonth() + 1 : 12;
  const d = await hitung({ skpd, semua: false, tahun, basis: 'semua', bulanSd });
  const lewat = d.per_rekening.filter((r) => r.indikator === 'melampaui');
  const dekat = d.per_rekening.filter((r) => r.indikator === 'mendekati');
  const out = [];
  if (lewat.length || dekat.length) {
    const daftar = [...lewat, ...dekat].slice(0, 2).map((r) => `${r.nama || r.kode_rekening} (${r.persen.toFixed(1)}%)`).join(', ');
    out.push({ id: `pagu-${tahun}-${lewat.length}-${dekat.length}`, tipe: 'anggaran', kategori: 'anggaran', tingkat: lewat.length ? 'bahaya' : 'peringatan',
      judul: lewat.length ? `${lewat.length} rekening melampaui pagu${dekat.length ? `, ${dekat.length} mendekati pagu` : ''}` : `${dekat.length} rekening mendekati pagu (≥ ${d.ambang.ambangPagu}%)`,
      pesan: `${daftar}${lewat.length + dekat.length > 2 ? ', …' : ''}. Tinjau sisa pagu sebelum belanja berikutnya.`, link: '/monitoring-anggaran', tanggal: null });
  }
  return out;
});

export const LABEL_INDIKATOR = { melampaui: 'Melampaui pagu', mendekati: 'Mendekati pagu', rendah: 'Penyerapan rendah', normal: 'Dalam batas pagu', tanpa_pagu: 'Tanpa pagu', kosong: 'Belum ada pagu/realisasi' };

export async function hitung({ skpd, semua, tahun, prefiks, basis, bulanSd }) {
  const cfg = await getPengaturan();
  const pre = `${prefiks || '5'}%`;
  const condA = semua ? 'TRUE' : 'a.skpd_id = $3';
  const condE = semua ? 'TRUE' : 'e.skpd_id = $3';
  const p = semua ? [tahun, pre] : [tahun, pre, skpd];
  const [{ rows: rek }, { rows: bulanan }, { rows: ak }, { rows: perSkpd }] = await Promise.all([
    query(`WITH real AS (
        SELECT e.kode_rekening, SUM(${NILAI}) AS realisasi FROM bku_entries e
         WHERE e.tahun = $1 AND ${condE} AND e.kode_rekening LIKE $2 AND ${FILTER_REAL(basis)} AND EXTRACT(MONTH FROM e.tanggal) <= ${bulanSd} GROUP BY 1),
      pg AS (SELECT a.kode_rekening, SUM(a.pagu) AS pagu, SUM(COALESCE(a.pagu_murni, a.pagu)) AS pagu_murni FROM anggaran a WHERE a.tahun = $1 AND ${condA} AND a.kode_rekening LIKE $2 GROUP BY 1),
      rc AS (SELECT a.kode_rekening, SUM(a.nilai) FILTER (WHERE a.bulan <= ${bulanSd}) AS rencana_sd, SUM(a.nilai) AS rencana_total FROM anggaran_kas a WHERE a.tahun = $1 AND ${condA} AND a.kode_rekening LIKE $2 GROUP BY 1)
      SELECT COALESCE(pg.kode_rekening, real.kode_rekening) AS kode_rekening, r.nama, COALESCE(pg.pagu,0)::float AS pagu, COALESCE(pg.pagu_murni,0)::float AS pagu_murni,
             COALESCE(real.realisasi,0)::float AS realisasi, COALESCE(rc.rencana_sd,0)::float AS rencana_sd, COALESCE(rc.rencana_total,0)::float AS rencana_total
        FROM pg FULL JOIN real ON real.kode_rekening = pg.kode_rekening
        LEFT JOIN rc ON rc.kode_rekening = COALESCE(pg.kode_rekening, real.kode_rekening)
        LEFT JOIN rekening r ON r.kode = COALESCE(pg.kode_rekening, real.kode_rekening) ORDER BY 1`, p),
    query(`SELECT EXTRACT(MONTH FROM e.tanggal)::int AS bulan, SUM(${NILAI})::float AS realisasi, COUNT(*)::int AS transaksi FROM bku_entries e
      WHERE e.tahun = $1 AND ${condE} AND e.kode_rekening LIKE $2 AND ${FILTER_REAL(basis)} GROUP BY 1`, p),
    query(`SELECT a.bulan, SUM(a.nilai)::float AS rencana FROM anggaran_kas a WHERE a.tahun = $1 AND ${condA} AND a.kode_rekening LIKE $2 GROUP BY 1`, p),
    query(`SELECT s.id, s.kode, s.nama,
        COALESCE((SELECT SUM(a.pagu) FROM anggaran a WHERE a.skpd_id = s.id AND a.tahun = $1 AND a.kode_rekening LIKE $2), 0)::float AS pagu,
        COALESCE((SELECT SUM(${NILAI}) FROM bku_entries e WHERE e.skpd_id = s.id AND e.tahun = $1 AND e.kode_rekening LIKE $2 AND ${FILTER_REAL(basis)} AND EXTRACT(MONTH FROM e.tanggal) <= ${bulanSd}), 0)::float AS realisasi,
        COALESCE((SELECT SUM(a.nilai) FROM anggaran_kas a WHERE a.skpd_id = s.id AND a.tahun = $1 AND a.kode_rekening LIKE $2 AND a.bulan <= ${bulanSd}), 0)::float AS rencana_sd
      FROM skpd s ORDER BY s.kode`, [tahun, pre]),
  ]);
  const porsiWaktu = (bulanSd / 12) * 100;
  const opsi = { ambangPagu: Number(cfg.ambang_pagu_persen) || 90, ambangRendah: Number(cfg.ambang_serapan_rendah) || 20 };
  const baris = rek.map((r) => {
    const target = r.pagu ? (r.rencana_total ? (r.rencana_sd / r.pagu) * 100 : porsiWaktu) : null;
    const persen = r.pagu ? (r.realisasi / r.pagu) * 100 : null;
    return { ...r, kelompok: kelompokDari(r.kode_rekening).nama, sisa: r.pagu - r.realisasi, persen, target, deviasi: persen != null && target != null ? persen - target : null,
      indikator: indikator({ ...r, target }, opsi) };
  });
  const total = (k) => baris.reduce((s, r) => s + r[k], 0);
  const pagu = total('pagu'); const realisasi = total('realisasi'); const rencanaSd = total('rencana_sd'); const rencanaTotal = total('rencana_total');
  const targetTotal = pagu ? (rencanaTotal ? (rencanaSd / pagu) * 100 : porsiWaktu) : null;
  let kum = 0; let kumR = 0;
  const bln = Array.from({ length: 12 }, (_, i) => {
    const b = i + 1;
    const real = bulanan.find((x) => x.bulan === b)?.realisasi || 0;
    const ren = ak.find((x) => x.bulan === b)?.rencana || 0;
    kum += real; kumR += ren;
    return { bulan: b, nama: NAMA_BULAN[i], realisasi: real, rencana: ren, kumulatif: kum, kumulatif_rencana: kumR, persen_kumulatif: pagu ? (kum / pagu) * 100 : 0,
      transaksi: bulanan.find((x) => x.bulan === b)?.transaksi || 0, perubahan: i && bulanan.find((x) => x.bulan === b - 1)?.realisasi ? ((real / bulanan.find((x) => x.bulan === b - 1).realisasi) - 1) * 100 : null };
  });
  const kelompok = {};
  for (const r of baris) {
    const k = (kelompok[r.kelompok] ||= { nama: r.kelompok, pagu: 0, realisasi: 0 });
    k.pagu += r.pagu; k.realisasi += r.realisasi;
  }
  const skpdRows = perSkpd.map((s) => {
    const target = s.pagu ? (s.rencana_sd ? (s.rencana_sd / s.pagu) * 100 : porsiWaktu) : null;
    return { ...s, sisa: s.pagu - s.realisasi, persen: s.pagu ? (s.realisasi / s.pagu) * 100 : null, target, indikator: indikator({ ...s, target }, opsi) };
  }).sort((a, b) => (b.persen ?? -1) - (a.persen ?? -1));
  const persen = pagu ? (realisasi / pagu) * 100 : 0;
  const status = indikator({ pagu, realisasi, target: targetTotal }, opsi);
  const hitungInd = Object.fromEntries(Object.keys(LABEL_INDIKATOR).map((k) => [k, baris.filter((r) => r.indikator === k).length]));
  return {
    tahun, bulan_sd: bulanSd, basis, prefiks: prefiks || '5', semua,
    ringkasan: { pagu, pagu_murni: total('pagu_murni'), realisasi, sisa: pagu - realisasi, persen, target: targetTotal, deviasi: targetTotal != null ? persen - targetTotal : null,
      rencana_sd: rencanaSd, status, status_label: LABEL_INDIKATOR[status], indikator: hitungInd },
    bulanan: bln, per_rekening: baris, per_kelompok: Object.values(kelompok).map((k) => ({ ...k, sisa: k.pagu - k.realisasi, persen: k.pagu ? (k.realisasi / k.pagu) * 100 : null })),
    per_skpd: skpdRows, ambang: opsi, porsi_waktu: porsiWaktu,
  };
}

function parameter(req) {
  const semua = req.query.semua === '1' && ['admin', 'pimpinan'].includes(req.user.role);
  const skpd = semua ? null : scopeSkpd(req.user, req.query.skpd_id);
  if (!semua && !skpd) throw bad('Pilih SKPD terlebih dahulu');
  const tahun = int(req.query.tahun, new Date().getFullYear());
  const now = new Date();
  const bulanDefault = tahun < now.getFullYear() ? 12 : tahun > now.getFullYear() ? 0 : now.getMonth() + 1;
  const bulanSd = Math.min(12, Math.max(1, int(req.query.bulan, bulanDefault) || 1));
  const prefiks = /^5(\.\d+)*$/.test(String(req.query.prefiks || '')) ? req.query.prefiks : '5';
  return { skpd, semua, tahun, bulanSd, prefiks, basis: req.query.basis === 'disetujui' ? 'disetujui' : 'semua' };
}

export default async function monitoringRoutes(app) {
  app.get('/api/monitoring-anggaran', { preHandler: requireAuth }, async (req) => hitung(parameter(req)));

  app.get('/api/monitoring-anggaran/xlsx', { preHandler: requireAuth }, async (req, reply) => {
    const prm = parameter(req);
    const d = await hitung(prm);
    const { rows: [s] } = prm.semua ? { rows: [{ nama: 'Seluruh SKPD', kode: 'SEMUA' }] } : await query('SELECT nama, kode FROM skpd WHERE id = $1', [prm.skpd]);
    const buf = await buildWorkbook({
      title: `MONITORING PAGU DAN REALISASI ANGGARAN - ${s.nama.toUpperCase()}`,
      subtitle: `TA ${d.tahun} s.d. ${NAMA_BULAN[d.bulan_sd - 1]} · basis ${d.basis === 'disetujui' ? 'transaksi disetujui' : 'semua transaksi (kecuali ditolak)'} · penyerapan ${d.ringkasan.persen.toFixed(2)}%`,
      sheetName: 'Monitoring',
      columns: [{ key: 'kode_rekening', header: 'Kode Rekening', width: 20 }, { key: 'nama', header: 'Uraian', width: 50 }, { key: 'pagu', header: 'Pagu', type: 'money' },
        { key: 'realisasi', header: 'Realisasi', type: 'money' }, { key: 'sisa', header: 'Sisa', type: 'money' }, { key: 'persen', header: '% Realisasi', type: 'number', width: 10 },
        { key: 'target', header: '% Target', type: 'number', width: 10 }, { key: 'status', header: 'Indikator', width: 20 }],
      rows: d.per_rekening.map((r) => ({ ...r, persen: r.persen == null ? '' : Math.round(r.persen * 100) / 100, target: r.target == null ? '' : Math.round(r.target * 100) / 100, status: LABEL_INDIKATOR[r.indikator] })),
      totals: { pagu: d.ringkasan.pagu, realisasi: d.ringkasan.realisasi, sisa: d.ringkasan.sisa },
    });
    return sendFile(reply, buf, `Monitoring_Anggaran_${s.kode}_${d.tahun}.xlsx`, XLSX);
  });
}
