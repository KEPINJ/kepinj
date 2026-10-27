// Bendahara penerimaan: BKU penerimaan, Surat Tanda Setoran (STS) ke kas daerah, dan target pendapatan.
// Penerimaan wajib disetor ke rekening kas umum daerah paling lambat 1 hari kerja (PP 12/2019 ps. 135).
import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, forbidden, notFound, int, isDate, money, scopeSkpd, required, sendFile, XLSX } from '../lib/http.js';
import { insertSub } from '../lib/subledger.js';
import { buildWorkbook } from '../lib/excel.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { hariIni, NAMA_BULAN, batasSetor } from '../lib/kalender.js';

export function canWritePenerimaan(user, skpdId) {
  if (user.role === 'admin') return true;
  if (user.role === 'bendahara_penerimaan' && user.skpd_id === skpdId) return true;
  throw forbidden('Hanya bendahara penerimaan SKPD terkait atau admin yang dapat mencatat penerimaan');
}

export { batasSetor };

const BELUM = `e.jenis = 'TERIMA' AND NOT EXISTS (SELECT 1 FROM sts_rincian r WHERE r.bkp_entry_id = e.id)`;

export async function belumDisetor(skpd, tahun) {
  const { rows } = await query(`SELECT e.*, k.nama AS rekening_nama FROM bkp_entries e LEFT JOIN rekening k ON k.kode = e.kode_rekening
    WHERE e.skpd_id = $1 AND e.tahun = $2 AND ${BELUM} ORDER BY e.tanggal, e.no_urut`, [skpd, tahun]);
  return rows;
}

daftarNotifikasi(async ({ user, skpd, tahun, today }) => {
  if (!['admin', 'bendahara_penerimaan', 'pimpinan'].includes(user.role)) return [];
  const batas = batasSetor(today);
  const { rows: [r] } = await query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(e.penerimaan),0) AS nilai, MIN(e.tanggal) AS tertua FROM bkp_entries e
    WHERE e.skpd_id = $1 AND e.tahun = $2 AND ${BELUM} AND e.tanggal < $3`, [skpd, tahun, batas]);
  if (!r.n) return [];
  return [{ id: `sts-${r.n}-${r.tertua}`, tipe: 'penerimaan', tingkat: 'bahaya', judul: `${r.n} penerimaan belum disetor ke kas daerah`,
    pesan: `Total Rp ${Math.round(Number(r.nilai)).toLocaleString('id-ID')}, tertua ${r.tertua.split('-').reverse().join('/')}. Penerimaan wajib disetor paling lambat 1 hari kerja.`,
    link: '/penerimaan?tab=sts', tanggal: r.tertua }];
});

async function dataPenerimaan(skpd, tahun, bulan) {
  const dari = bulan ? `${tahun}-${String(bulan).padStart(2, '0')}-01` : `${tahun}-01-01`;
  const sampai = bulan ? new Date(Date.UTC(tahun, bulan, 0)).toISOString().slice(0, 10) : `${tahun}-12-31`;
  const [{ rows }, { rows: [awal] }, { rows: real }, { rows: bulanan }, belum] = await Promise.all([
    query(`SELECT * FROM (
        SELECT e.*, k.nama AS rekening_nama, s.nomor AS sts_nomor, s.tanggal AS sts_tanggal, u.full_name AS dibuat_oleh,
          SUM(e.penerimaan - e.pengeluaran) OVER (ORDER BY e.tanggal, e.no_urut) AS saldo
        FROM bkp_entries e LEFT JOIN rekening k ON k.kode = e.kode_rekening
        LEFT JOIN sts_rincian sr ON sr.bkp_entry_id = e.id LEFT JOIN sts s ON s.id = COALESCE(sr.sts_id, e.sts_id)
        LEFT JOIN users u ON u.id = e.created_by
        WHERE e.skpd_id = $1 AND e.tahun = $2) x WHERE tanggal BETWEEN $3 AND $4 ORDER BY tanggal, no_urut`, [skpd, tahun, dari, sampai]),
    query('SELECT COALESCE(SUM(penerimaan - pengeluaran),0)::float AS saldo FROM bkp_entries WHERE skpd_id = $1 AND tahun = $2 AND tanggal < $3', [skpd, tahun, dari]),
    query(`SELECT r.kode AS kode_rekening, r.nama, COALESCE(t.target,0)::float AS target, COALESCE(SUM(e.penerimaan) FILTER (WHERE e.jenis = 'TERIMA'),0)::float AS realisasi
      FROM rekening r LEFT JOIN target_pendapatan t ON t.kode_rekening = r.kode AND t.skpd_id = $1 AND t.tahun = $2
      LEFT JOIN bkp_entries e ON e.kode_rekening = r.kode AND e.skpd_id = $1 AND e.tahun = $2
      WHERE r.jenis = 'pendapatan' GROUP BY r.kode, r.nama, t.target HAVING COALESCE(t.target,0) > 0 OR COUNT(e.id) > 0 ORDER BY r.kode`, [skpd, tahun]),
    query(`SELECT EXTRACT(MONTH FROM tanggal)::int AS bulan, SUM(penerimaan) FILTER (WHERE jenis = 'TERIMA')::float AS terima, SUM(pengeluaran)::float AS setor
      FROM bkp_entries WHERE skpd_id = $1 AND tahun = $2 GROUP BY 1 ORDER BY 1`, [skpd, tahun]),
    belumDisetor(skpd, tahun),
  ]);
  const terima = rows.reduce((s, r) => s + Number(r.penerimaan), 0);
  const setor = rows.reduce((s, r) => s + Number(r.pengeluaran), 0);
  const batas = batasSetor(hariIni());
  return {
    dari, sampai, rows,
    ringkasan: { saldo_awal: awal.saldo, terima, setor, saldo_akhir: awal.saldo + terima - setor,
      belum_setor: { jumlah: belum.length, nilai: belum.reduce((s, r) => s + Number(r.penerimaan), 0), tertua: belum[0]?.tanggal || null,
        terlambat: belum.filter((r) => r.tanggal < batas).length } },
    realisasi: real.map((r) => ({ ...r, persen: r.target ? (r.realisasi / r.target) * 100 : null })),
    bulanan: Array.from({ length: 12 }, (_, i) => ({ bulan: i + 1, nama: NAMA_BULAN[i].slice(0, 3), terima: bulanan.find((b) => b.bulan === i + 1)?.terima || 0, setor: bulanan.find((b) => b.bulan === i + 1)?.setor || 0 })),
  };
}

/** Catat satu penerimaan (dipakai API dan seeder). */
export async function catatPenerimaan(c, user, skpd, b) {
  required(b, ['tanggal', 'kode_rekening', 'uraian', 'nilai']);
  const nilai = money(b.nilai);
  if (!(nilai > 0)) throw bad('Nilai penerimaan harus lebih dari nol');
  const { rows: [rek] } = await c.query('SELECT jenis FROM rekening WHERE kode = $1', [b.kode_rekening]);
  if (!rek || rek.jenis !== 'pendapatan') throw bad('Pilih kode rekening pendapatan (4.x)');
  const [e] = await insertSub(c, 'bkp', skpd, { skpd_id: skpd }, user, [{ tanggal: b.tanggal, no_bukti: b.no_bukti, jenis: 'TERIMA', kode_rekening: b.kode_rekening,
    uraian: b.uraian, penerimaan: nilai, metode: b.metode, penyetor: b.penyetor, dasar: b.dasar }]);
  await emit(c, 'penerimaan.updated', String(skpd), { skpd_id: skpd, id: e.id, user: user.full_name, nilai });
  return e;
}

/** Buat STS atas penerimaan terpilih dan bukukan penyetorannya. */
export async function buatSts(c, user, skpd, b) {
  required(b, ['tanggal']);
  if (!isDate(b.tanggal)) throw bad('Tanggal STS tidak valid');
  const ids = (b.entry_ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw bad('Pilih penerimaan yang akan disetor');
  const { rows } = await c.query(`SELECT e.* FROM bkp_entries e WHERE e.id = ANY($1) AND e.skpd_id = $2 AND ${BELUM} FOR UPDATE`, [ids, skpd]);
  if (rows.length !== ids.length) throw bad('Sebagian penerimaan tidak ditemukan atau sudah disetor');
  if (rows.some((r) => r.tanggal > b.tanggal)) throw bad('Tanggal STS tidak boleh sebelum tanggal penerimaan');
  const tahun = Number(b.tanggal.slice(0, 4));
  if (rows.some((r) => r.tahun !== tahun)) throw bad('STS hanya untuk penerimaan pada tahun anggaran yang sama');
  const total = money(rows.reduce((s, r) => s + Number(r.penerimaan), 0));
  const { rows: [n] } = await c.query('SELECT COUNT(*)::int + 1 AS n FROM sts WHERE skpd_id = $1 AND tahun = $2', [skpd, tahun]);
  const { rows: [s] } = await c.query('SELECT kode FROM skpd WHERE id = $1', [skpd]);
  const nomor = `${String(n.n).padStart(4, '0')}/STS/${s.kode.slice(0, 4)}/${tahun}`;
  const { rows: [sts] } = await c.query(`INSERT INTO sts (skpd_id, tahun, nomor, tanggal, bank, no_bukti_bank, uraian, total, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [skpd, tahun, nomor, b.tanggal, b.bank || 'Bank Daerah (RKUD)', b.no_bukti_bank || null,
    b.uraian || `Penyetoran ${rows.length} penerimaan ke rekening kas umum daerah`, total, user.id]);
  for (const r of rows) await c.query('INSERT INTO sts_rincian (bkp_entry_id, sts_id, kode_rekening, nilai) VALUES ($1,$2,$3,$4)', [r.id, sts.id, r.kode_rekening, r.penerimaan]);
  const perMetode = {};
  for (const r of rows) perMetode[r.metode] = (perMetode[r.metode] || 0) + Number(r.penerimaan);
  await insertSub(c, 'bkp', skpd, { skpd_id: skpd }, user, Object.entries(perMetode).map(([metode, v]) => ({
    tanggal: b.tanggal, no_bukti: nomor, jenis: 'SETOR', metode, sts_id: sts.id, pengeluaran: v,
    uraian: `Disetor ke kas daerah dengan ${nomor}${metode === 'tunai' ? ' (kas tunai)' : ''}`,
  })));
  await emit(c, 'penerimaan.updated', String(skpd), { skpd_id: skpd, sts: nomor, user: user.full_name, total });
  return sts;
}

export default async function penerimaanRoutes(app) {
  app.get('/api/penerimaan', { preHandler: requireAuth }, async (req, reply) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const d = await dataPenerimaan(skpd, tahun, int(req.query.bulan) || null);
    if (req.query.format !== 'xlsx') return d;
    const { rows: [s] } = await query('SELECT kode, nama FROM skpd WHERE id = $1', [skpd]);
    const buf = await buildWorkbook({
      title: `BUKU KAS UMUM PENERIMAAN - ${s.nama.toUpperCase()}`, subtitle: `Periode ${d.dari} s.d. ${d.sampai}`, sheetName: 'BKU Penerimaan',
      columns: [{ key: 'no_urut', header: 'No', width: 6 }, { key: 'tanggal', header: 'Tanggal', width: 12 }, { key: 'no_bukti', header: 'No. Bukti', width: 22 },
        { key: 'kode_rekening', header: 'Kode Rekening', width: 20 }, { key: 'uraian', header: 'Uraian', width: 50 }, { key: 'penerimaan', header: 'Penerimaan', type: 'money' },
        { key: 'pengeluaran', header: 'Penyetoran', type: 'money' }, { key: 'saldo', header: 'Saldo', type: 'money' }, { key: 'sts_nomor', header: 'No. STS', width: 22 }],
      rows: d.rows, totals: { penerimaan: d.ringkasan.terima, pengeluaran: d.ringkasan.setor },
    });
    return sendFile(reply, buf, `BKU_Penerimaan_${tahun}.xlsx`, XLSX);
  });

  app.post('/api/penerimaan', { preHandler: requireRole('admin', 'bendahara_penerimaan') }, async (req) => {
    const b = req.body || {};
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWritePenerimaan(req.user, skpd);
    return tx(async (c) => {
      const e = await catatPenerimaan(c, req.user, skpd, b);
      await audit(c, req.user, 'penerimaan_catat', 'bkp', e.id, { nilai: e.penerimaan, kode: e.kode_rekening }, req.ip);
      return { entry: e };
    });
  });

  app.get('/api/sts', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const [{ rows }, belum] = await Promise.all([
      query(`SELECT s.*, u.full_name AS dibuat_oleh, (SELECT COUNT(*)::int FROM sts_rincian r WHERE r.sts_id = s.id) AS jumlah
        FROM sts s LEFT JOIN users u ON u.id = s.created_by WHERE s.skpd_id = $1 AND s.tahun = $2 ORDER BY s.tanggal DESC, s.id DESC`, [skpd, tahun]),
      belumDisetor(skpd, tahun),
    ]);
    return { rows, belum, batas: batasSetor(hariIni()) };
  });

  app.get('/api/sts/:id', { preHandler: requireAuth }, async (req) => {
    const { rows: [s] } = await query('SELECT s.*, u.full_name AS dibuat_oleh FROM sts s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = $1', [int(req.params.id)]);
    if (!s) throw notFound('STS tidak ditemukan');
    scopeSkpd(req.user, s.skpd_id);
    const [{ rows: rincian }, { rows: [skpd] }, { rows: perRek }] = await Promise.all([
      query(`SELECT e.tanggal, e.no_bukti, e.uraian, e.penyetor, r.kode_rekening, k.nama AS rekening_nama, r.nilai FROM sts_rincian r
        JOIN bkp_entries e ON e.id = r.bkp_entry_id LEFT JOIN rekening k ON k.kode = r.kode_rekening WHERE r.sts_id = $1 ORDER BY e.tanggal, e.no_urut`, [s.id]),
      query('SELECT * FROM skpd WHERE id = $1', [s.skpd_id]),
      query(`SELECT r.kode_rekening, k.nama, SUM(r.nilai)::float AS nilai FROM sts_rincian r LEFT JOIN rekening k ON k.kode = r.kode_rekening
        WHERE r.sts_id = $1 GROUP BY 1,2 ORDER BY 1`, [s.id]),
    ]);
    return { sts: s, rincian, per_rekening: perRek, skpd };
  });

  app.post('/api/sts', { preHandler: requireRole('admin', 'bendahara_penerimaan') }, async (req) => {
    const b = req.body || {};
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWritePenerimaan(req.user, skpd);
    return tx(async (c) => {
      const sts = await buatSts(c, req.user, skpd, b);
      await audit(c, req.user, 'sts_buat', 'sts', sts.id, { nomor: sts.nomor, total: sts.total }, req.ip);
      return { sts };
    });
  });

  app.put('/api/penerimaan/target', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    required(b, ['skpd_id', 'tahun', 'kode_rekening']);
    const target = money(b.target);
    if (target < 0) throw bad('Target tidak boleh negatif');
    await query(`INSERT INTO target_pendapatan (skpd_id, tahun, kode_rekening, target) VALUES ($1,$2,$3,$4)
      ON CONFLICT (skpd_id, tahun, kode_rekening) DO UPDATE SET target = EXCLUDED.target`, [int(b.skpd_id), int(b.tahun), b.kode_rekening, target]);
    return { ok: true };
  });
}
