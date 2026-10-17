import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, int, isDate, scopeSkpd, canWrite, sendFile, XLSX, required, money } from '../lib/http.js';
import { buildWorkbook } from '../lib/excel.js';
import { listEntries } from './bku.js';
import { loadDataset, normDate } from './data.js';
import { toNum } from '../../../shared/expr.js';
import { terbilang } from '../../../shared/terbilang.js';

const REALISASI_SQL = `
  WITH real AS (
    SELECT kode_rekening, SUM(CASE WHEN jenis = 'KOREKSI' THEN pengeluaran - penerimaan ELSE pengeluaran END) AS realisasi
      FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening IS NOT NULL
       AND jenis IN ('BELANJA','SP2D_LS','KOREKSI') GROUP BY 1
  )
  SELECT COALESCE(a.kode_rekening, r.kode_rekening) AS kode_rekening, rk.nama, COALESCE(a.pagu, 0) AS pagu,
         COALESCE(r.realisasi, 0) AS realisasi
    FROM (SELECT * FROM anggaran WHERE skpd_id = $1 AND tahun = $2) a
    FULL JOIN real r ON r.kode_rekening = a.kode_rekening
    LEFT JOIN rekening rk ON rk.kode = COALESCE(a.kode_rekening, r.kode_rekening)
   ORDER BY 1`;

export const DENOMINASI = [100000, 75000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];

export default async function laporanRoutes(app) {
  app.get('/api/dashboard', { preHandler: requireAuth }, async (req) => {
    const semua = req.query.semua === '1' && ['admin', 'pimpinan'].includes(req.user.role);
    const skpd = semua ? null : scopeSkpd(req.user, req.query.skpd_id);
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const bulanIni = new Date().getMonth() + 1;
    const cond = semua ? 'TRUE' : 'skpd_id = $2';
    const p = semua ? [tahun] : [tahun, skpd];
    const [kpi, bulanan, pajak, verif, terbaru, perSkpd, real] = await Promise.all([
      query(`SELECT COALESCE(SUM(penerimaan),0) AS penerimaan, COALESCE(SUM(pengeluaran),0) AS pengeluaran,
          COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode = 'bank'),0) AS saldo_bank,
          COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode = 'tunai'),0) AS saldo_tunai,
          COALESCE(SUM(penerimaan) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = ${bulanIni}),0) AS penerimaan_bulan_ini,
          COALESCE(SUM(pengeluaran) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = ${bulanIni}),0) AS pengeluaran_bulan_ini,
          COUNT(*)::int AS jumlah_transaksi
        FROM bku_entries WHERE tahun = $1 AND ${cond}`, p),
      // dari proyeksi event-stream (daily_summary)
      query(`SELECT EXTRACT(MONTH FROM tanggal)::int AS bulan, SUM(penerimaan) AS penerimaan, SUM(pengeluaran) AS pengeluaran, SUM(jumlah_transaksi)::int AS transaksi
        FROM daily_summary WHERE EXTRACT(YEAR FROM tanggal) = $1 AND ${cond} GROUP BY 1 ORDER BY 1`, p),
      query(`SELECT jenis_pajak, status, SUM(nominal) AS nominal, COUNT(*)::int AS jumlah FROM pajak WHERE tahun = $1 AND ${cond} GROUP BY 1,2`, p),
      query(`SELECT COUNT(*)::int AS belum FROM bku_entries e WHERE e.tahun = $1 AND ${cond.replace('skpd_id', 'e.skpd_id')}
        AND NOT EXISTS (SELECT 1 FROM bku_verifications v WHERE v.entry_id = e.id)`, p),
      query(`SELECT e.id, e.skpd_id, e.no_urut, e.tanggal, e.no_bukti, e.jenis, e.uraian, e.penerimaan, e.pengeluaran, e.created_at, s.kode AS skpd_kode
        FROM bku_entries e JOIN skpd s ON s.id = e.skpd_id WHERE e.tahun = $1 AND ${cond.replace('skpd_id', 'e.skpd_id')} ORDER BY e.created_at DESC LIMIT 10`, p),
      semua ? query(`SELECT s.id, s.kode, s.nama, COALESCE(SUM(e.penerimaan),0) AS penerimaan, COALESCE(SUM(e.pengeluaran),0) AS pengeluaran,
          COALESCE(SUM(e.penerimaan - e.pengeluaran),0) AS saldo, COUNT(e.id)::int AS transaksi
        FROM skpd s LEFT JOIN bku_entries e ON e.skpd_id = s.id AND e.tahun = $1 GROUP BY s.id ORDER BY s.kode`, [tahun]) : { rows: [] },
      semua ? query(`SELECT COALESCE((SELECT SUM(pagu) FROM anggaran WHERE tahun = $1),0) AS pagu,
          COALESCE((SELECT SUM(CASE WHEN jenis = 'KOREKSI' THEN pengeluaran - penerimaan ELSE pengeluaran END) FROM bku_entries WHERE tahun = $1 AND kode_rekening IS NOT NULL AND jenis IN ('BELANJA','SP2D_LS','KOREKSI')),0) AS realisasi`, [tahun])
        : query(REALISASI_SQL, [skpd, tahun]),
    ]);
    const k = kpi.rows[0];
    const realisasi = semua ? real.rows[0] : {
      pagu: real.rows.reduce((s, r) => s + Number(r.pagu), 0),
      realisasi: real.rows.reduce((s, r) => s + Number(r.realisasi), 0),
      rekening: real.rows.filter((r) => Number(r.pagu) > 0).sort((a, b) => Number(b.pagu) - Number(a.pagu)).slice(0, 8),
    };
    return {
      tahun, skpd_id: skpd, semua,
      kpi: Object.fromEntries(Object.entries(k).map(([a, b]) => [a, Number(b)])),
      belum_verifikasi: verif.rows[0].belum,
      bulanan: Array.from({ length: 12 }, (_, i) => {
        const r = bulanan.rows.find((x) => x.bulan === i + 1);
        return { bulan: i + 1, penerimaan: Number(r?.penerimaan || 0), pengeluaran: Number(r?.pengeluaran || 0), transaksi: r?.transaksi || 0 };
      }),
      pajak: pajak.rows.map((r) => ({ ...r, nominal: Number(r.nominal) })),
      terbaru: terbaru.rows,
      per_skpd: perSkpd.rows,
      realisasi,
    };
  });

  app.get('/api/laporan/realisasi', { preHandler: requireAuth }, async (req, reply) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const { rows } = await query(REALISASI_SQL, [skpd, tahun]);
    const data = rows.map((r) => ({ ...r, pagu: Number(r.pagu), realisasi: Number(r.realisasi), sisa: Number(r.pagu) - Number(r.realisasi), persen: Number(r.pagu) ? (Number(r.realisasi) / Number(r.pagu)) * 100 : null }));
    if (req.query.format !== 'xlsx') return { tahun, rows: data };
    const { rows: [s] } = await query('SELECT * FROM skpd WHERE id = $1', [skpd]);
    const buf = await buildWorkbook({
      title: `LAPORAN REALISASI ANGGARAN - ${s.nama.toUpperCase()}`, subtitle: `Tahun Anggaran ${tahun}`, sheetName: 'Realisasi',
      columns: [{ key: 'kode_rekening', header: 'Kode Rekening', width: 20 }, { key: 'nama', header: 'Uraian', width: 50 },
        { key: 'pagu', header: 'Pagu', type: 'money' }, { key: 'realisasi', header: 'Realisasi', type: 'money' },
        { key: 'sisa', header: 'Sisa', type: 'money' }, { key: 'persen', header: '%', type: 'number', width: 8 }],
      rows: data.map((r) => ({ ...r, persen: r.persen == null ? '' : Math.round(r.persen * 100) / 100 })),
      totals: { pagu: data.reduce((a, r) => a + r.pagu, 0), realisasi: data.reduce((a, r) => a + r.realisasi, 0), sisa: data.reduce((a, r) => a + r.sisa, 0) },
    });
    return sendFile(reply, buf, `Realisasi_${s.kode}_${tahun}.xlsx`, XLSX);
  });

  // Data lengkap untuk cetak BKU bulanan (format Permendagri 77/2020)
  app.get('/api/laporan/bku', { preHandler: requireAuth }, async (req) => {
    const data = await listEntries(req.user, req.query, { all: true });
    const { rows: [skpd] } = await query('SELECT * FROM skpd WHERE id = $1', [data.skpd_id]);
    return { ...data, skpd, terbilang_saldo: terbilang(data.ringkasan.saldo_akhir) };
  });

  app.get('/api/penutupan-kas', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const { rows } = await query('SELECT p.*, u.full_name AS dibuat_oleh FROM penutupan_kas p LEFT JOIN users u ON u.id = p.created_by WHERE p.skpd_id = $1 ORDER BY p.tanggal DESC, p.id DESC LIMIT 100', [skpd]);
    return { rows, denominasi: DENOMINASI };
  });

  app.get('/api/penutupan-kas/saldo', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!isDate(req.query.tanggal)) throw bad('Tanggal tidak valid');
    const { rows: [r] } = await query(`SELECT COALESCE(SUM(penerimaan),0) AS penerimaan, COALESCE(SUM(pengeluaran),0) AS pengeluaran,
        COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode='bank'),0) AS saldo_bank_bku,
        COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode='tunai'),0) AS saldo_tunai_bku
      FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND tanggal <= $3`, [skpd, Number(req.query.tanggal.slice(0, 4)), req.query.tanggal]);
    const o = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
    return { ...o, saldo_bku: o.penerimaan - o.pengeluaran };
  });

  app.post('/api/penutupan-kas', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['tanggal']);
    if (!isDate(b.tanggal)) throw bad('Tanggal tidak valid');
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    const denom = {};
    let tunai = 0;
    for (const d of DENOMINASI) { const n = Math.max(0, int(b.denominasi?.[d], 0)); if (n) { denom[d] = n; tunai += n * d; } }
    tunai += money(b.uang_logam_lain || 0);
    return tx(async (c) => {
      const { rows: [s] } = await c.query(`SELECT COALESCE(SUM(penerimaan - pengeluaran),0) AS saldo FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND tanggal <= $3`,
        [skpd, Number(b.tanggal.slice(0, 4)), b.tanggal]);
      const saldoBku = Number(s.saldo);
      const saldoBank = money(b.saldo_bank);
      const { rows: [row] } = await c.query(`INSERT INTO penutupan_kas (skpd_id, tanggal, saldo_bku, saldo_bank, kas_tunai, denominasi, selisih, keterangan, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [skpd, b.tanggal, saldoBku, saldoBank, tunai, denom, saldoBank + tunai - saldoBku, b.keterangan || null, req.user.id]);
      await audit(c, req.user, 'penutupan_kas', 'penutupan_kas', row.id, { selisih: row.selisih }, req.ip);
      return { row };
    });
  });

  // Rekonsiliasi bank: cocokkan mutasi rekening (dataset upload) dengan BKU kas bank
  app.post('/api/rekonsiliasi', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    required(b, ['dataset_id', 'mapping']);
    const m = b.mapping;
    required(m, ['tanggal']);
    if (!m.debet && !m.kredit && !m.nilai) throw bad('Petakan kolom debet/kredit atau nilai');
    const skpd = scopeSkpd(req.user, b.skpd_id);
    const tol = Math.min(Math.max(int(b.toleransi_hari, 3), 0), 31);
    const { rows: dsRows } = await loadDataset(b.dataset_id, req.user);
    const mutasi = dsRows.map((r, i) => {
      const no = i + 1;
      let masuk = toNum(r[m.kredit]); let keluar = toNum(r[m.debet]);
      if (m.nilai) { const n = toNum(r[m.nilai]); if (n >= 0) masuk = n; else keluar = -n; }
      return { baris: no, tanggal: normDate(r[m.tanggal]), keterangan: String(r[m.keterangan] ?? ''), masuk: Math.abs(masuk), keluar: Math.abs(keluar) };
    }).filter((x) => x.tanggal && (x.masuk > 0 || x.keluar > 0));
    if (!mutasi.length) throw bad('Tidak ada baris mutasi yang terbaca. Periksa pemetaan kolom.');
    const dari = b.dari || mutasi.map((x) => x.tanggal).sort()[0];
    const sampai = b.sampai || mutasi.map((x) => x.tanggal).sort().at(-1);
    const { rows: semuaBku } = await query(`SELECT id, no_urut, tanggal, no_bukti, jenis, uraian, penerimaan::float AS masuk, pengeluaran::float AS keluar
      FROM bku_entries WHERE skpd_id = $1 AND metode = 'bank' AND tanggal BETWEEN ($2::date - $4::int) AND ($3::date + $4::int) ORDER BY tanggal, no_urut`, [skpd, dari, sampai, tol]);
    // Pungutan pajak adalah pembukuan (bukan arus kas bank): belanja dibayar netto ke rekanan.
    const pungut = {};
    for (const e of semuaBku) if (e.jenis === 'PAJAK_PUNGUT') pungut[`${e.no_bukti}|${e.tanggal}`] = (pungut[`${e.no_bukti}|${e.tanggal}`] || 0) + e.masuk;
    const bku = semuaBku.filter((e) => e.jenis !== 'PAJAK_PUNGUT').map((e) => ({ ...e, netto: e.keluar - (e.keluar > 0 ? pungut[`${e.no_bukti}|${e.tanggal}`] || 0 : 0) }));
    const used = new Set();
    const days = (a, b2) => Math.abs((Date.parse(a) - Date.parse(b2)) / 86400000);
    const cocok = []; const hanyaBank = [];
    for (const mt of mutasi) {
      const masuk = mt.masuk > 0;
      const nilai = masuk ? mt.masuk : mt.keluar;
      let best = null; let bestScore = Infinity;
      for (const e of bku) {
        if (used.has(e.id)) continue;
        const ok = masuk ? Math.abs(e.masuk - nilai) < 0.005 : Math.abs(e.keluar - nilai) < 0.005 || Math.abs(e.netto - nilai) < 0.005;
        if (!ok) continue;
        const d = days(e.tanggal, mt.tanggal);
        if (d > tol) continue;
        const ref = e.no_bukti && e.no_bukti !== '-' && mt.keterangan.toLowerCase().includes(e.no_bukti.toLowerCase()) ? -10 : 0;
        if (d + ref < bestScore) { best = e; bestScore = d + ref; }
      }
      if (best) { used.add(best.id); cocok.push({ mutasi: mt, bku: best, selisih_hari: days(best.tanggal, mt.tanggal) }); } else hanyaBank.push(mt);
    }
    const hanyaBku = bku.filter((e) => !used.has(e.id) && e.tanggal >= dari && e.tanggal <= sampai);
    const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
    return {
      periode: { dari, sampai, toleransi_hari: tol },
      ringkasan: {
        mutasi: mutasi.length, cocok: cocok.length, hanya_bank: hanyaBank.length, hanya_bku: hanyaBku.length,
        persen_cocok: Math.round((cocok.length / mutasi.length) * 1000) / 10,
        bank_masuk: sum(mutasi, (x) => x.masuk), bank_keluar: sum(mutasi, (x) => x.keluar),
        bku_masuk: sum(bku.filter((e) => e.tanggal >= dari && e.tanggal <= sampai), (x) => x.masuk),
        bku_keluar: sum(bku.filter((e) => e.tanggal >= dari && e.tanggal <= sampai), (x) => x.netto),
      },
      cocok, hanya_bank: hanyaBank, hanya_bku: hanyaBku,
    };
  });
}
