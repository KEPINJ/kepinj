import { query, tx, audit, emit, pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { insertEntries, verifyChain, JENIS_BKU } from '../lib/ledger.js';
import { bad, notFound, int, isDate, money, scopeSkpd, canWrite, sendFile, XLSX, required } from '../lib/http.js';
import { buildWorkbook } from '../lib/excel.js';
import { terbilang } from '../../../shared/terbilang.js';
import { catatTransaksi } from '../lib/transaksi.js';


function periode(q) {
  const tahun = int(q.tahun, new Date().getFullYear());
  let dari = q.dari; let sampai = q.sampai;
  const bulan = int(q.bulan);
  if (bulan) {
    dari = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
    sampai = new Date(Date.UTC(tahun, bulan, 0)).toISOString().slice(0, 10);
  }
  if (!isDate(dari)) dari = `${tahun}-01-01`;
  if (!isDate(sampai)) sampai = `${tahun}-12-31`;
  return { tahun, dari, sampai };
}

async function listEntries(user, q, { all = false } = {}) {
  const skpd = scopeSkpd(user, q.skpd_id);
  if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
  const { tahun, dari, sampai } = periode(q);
  // Saldo awal dihitung sekali, lalu saldo berjalan hanya dalam periode (tetap cepat pada jutaan baris)
  const { rows: [sum] } = await query(`SELECT
      COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE tanggal < $3), 0) AS saldo_awal,
      COALESCE(SUM(penerimaan) FILTER (WHERE tanggal BETWEEN $3 AND $4), 0) AS penerimaan,
      COALESCE(SUM(pengeluaran) FILTER (WHERE tanggal BETWEEN $3 AND $4), 0) AS pengeluaran,
      COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE tanggal <= $4 AND metode = 'bank'), 0) AS saldo_bank,
      COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE tanggal <= $4 AND metode = 'tunai'), 0) AS saldo_tunai
    FROM bku_entries WHERE skpd_id = $1 AND tahun = $2`, [skpd, tahun, dari, sampai]);
  const params = [skpd, tahun, dari, sampai, sum.saldo_awal];
  const where = ['TRUE'];
  if (q.q) { params.push(`%${q.q}%`); where.push(`(b.uraian ILIKE $${params.length} OR b.no_bukti ILIKE $${params.length} OR b.kode_rekening ILIKE $${params.length})`); }
  if (q.jenis) { params.push(q.jenis); where.push(`b.jenis = $${params.length}`); }
  if (q.metode) { params.push(q.metode); where.push(`b.metode = $${params.length}`); }
  if (q.verif === 'belum') where.push('v.status IS NULL');
  else if (q.verif) { params.push(q.verif); where.push(`v.status = $${params.length}`); }

  const pageSize = Math.min(int(q.pageSize, 50), 1000);
  const page = Math.max(int(q.page, 1), 1);
  const base = `
    WITH base AS (
      SELECT e.*, $5::numeric + SUM(e.penerimaan - e.pengeluaran) OVER (ORDER BY e.tanggal, e.no_urut) AS saldo
        FROM bku_entries e WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.tanggal BETWEEN $3 AND $4
    )
    SELECT b.*, r.nama AS rekening_nama, rk.nama AS rekanan_nama, u.full_name AS dibuat_oleh,
           v.status AS verif_status, v.catatan AS verif_catatan,
           EXISTS (SELECT 1 FROM bku_entries k WHERE k.koreksi_of = b.id AND k.skpd_id = b.skpd_id AND k.tahun = b.tahun) AS dikoreksi,
           (SELECT COUNT(*) FROM lampiran l WHERE l.bku_entry_id = b.id)::int AS jumlah_lampiran,
           COUNT(*) OVER () AS total_rows
      FROM base b
      LEFT JOIN rekening r ON r.kode = b.kode_rekening
      LEFT JOIN rekanan rk ON rk.id = b.rekanan_id
      LEFT JOIN users u ON u.id = b.created_by
      LEFT JOIN LATERAL (SELECT status, catatan FROM bku_verifications WHERE entry_id = b.id ORDER BY verified_at DESC LIMIT 1) v ON true
     WHERE ${where.join(' AND ')}
     ORDER BY b.tanggal, b.no_urut`;
  const sql = all ? base : `${base} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const { rows } = await query(sql, params);
  const total = rows[0]?.total_rows ?? 0;
  rows.forEach((r) => delete r.total_rows);
  const ringkasan = {
    saldo_awal: Number(sum.saldo_awal), penerimaan: Number(sum.penerimaan), pengeluaran: Number(sum.pengeluaran),
    saldo_akhir: Number(sum.saldo_awal) + Number(sum.penerimaan) - Number(sum.pengeluaran),
    saldo_bank: Number(sum.saldo_bank), saldo_tunai: Number(sum.saldo_tunai),
  };
  return { skpd_id: skpd, tahun, dari, sampai, page, pageSize, total, rows, ringkasan };
}

async function cekAnggaran(client, skpd, tahun, entries) {
  const warnings = [];
  const perRek = {};
  for (const e of entries) if (e.kode_rekening && Number(e.pengeluaran) > 0) perRek[e.kode_rekening] = (perRek[e.kode_rekening] || 0) + Number(e.pengeluaran);
  for (const [kode, tambah] of Object.entries(perRek)) {
    const { rows: [r] } = await client.query(`
      SELECT a.pagu, COALESCE((SELECT SUM(CASE WHEN jenis = 'KOREKSI' THEN pengeluaran - penerimaan ELSE pengeluaran END) FROM bku_entries
        WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = $3 AND jenis IN ('BELANJA','SP2D_LS','KOREKSI')), 0) AS realisasi
      FROM anggaran a WHERE a.skpd_id = $1 AND a.tahun = $2 AND a.kode_rekening = $3`, [skpd, tahun, kode]);
    if (!r) warnings.push(`Rekening ${kode} belum memiliki pagu anggaran tahun ${tahun}.`);
    else if (Number(r.realisasi) + tambah > Number(r.pagu)) warnings.push(`Realisasi rekening ${kode} melebihi pagu (pagu ${Number(r.pagu).toLocaleString('id-ID')}, realisasi setelah transaksi ${(Number(r.realisasi) + tambah).toLocaleString('id-ID')}).`);
  }
  return warnings;
}

export default async function bkuRoutes(app) {
  app.get('/api/bku/meta', { preHandler: requireAuth }, async () => ({ jenis: JENIS_BKU }));

  app.get('/api/bku', { preHandler: requireAuth }, async (req) => listEntries(req.user, req.query));

  app.get('/api/bku/export.xlsx', { preHandler: requireAuth }, async (req, reply) => {
    const data = await listEntries(req.user, req.query, { all: true });
    const { rows: [skpd] } = await query('SELECT * FROM skpd WHERE id = $1', [data.skpd_id]);
    const buf = await buildWorkbook({
      title: `BUKU KAS UMUM - ${skpd.nama.toUpperCase()}`,
      subtitle: `Periode ${data.dari} s.d. ${data.sampai} | Saldo awal: Rp ${data.ringkasan.saldo_awal.toLocaleString('id-ID')}`,
      sheetName: 'BKU',
      columns: [
        { key: 'no_urut', header: 'No', width: 6 }, { key: 'tanggal', header: 'Tanggal', width: 12 },
        { key: 'no_bukti', header: 'No. Bukti', width: 20 }, { key: 'uraian', header: 'Uraian', width: 50 },
        { key: 'kode_rekening', header: 'Kode Rekening', width: 20 }, { key: 'penerimaan', header: 'Penerimaan', type: 'money', width: 18 },
        { key: 'pengeluaran', header: 'Pengeluaran', type: 'money', width: 18 }, { key: 'saldo', header: 'Saldo', type: 'money', width: 18 },
        { key: 'metode', header: 'Kas', width: 8 }, { key: 'verif_status', header: 'Verifikasi', width: 14 },
      ],
      rows: data.rows,
      totals: { penerimaan: data.ringkasan.penerimaan, pengeluaran: data.ringkasan.pengeluaran, saldo: data.ringkasan.saldo_akhir },
    });
    return sendFile(reply, buf, `BKU_${skpd.kode}_${data.dari}_${data.sampai}.xlsx`, XLSX);
  });

  app.get('/api/bku/integritas', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const client = await pool.connect();
    try {
      const res = await verifyChain(client, skpd, tahun);
      await audit(client, req.user, 'verifikasi_integritas', 'bku', `${skpd}/${tahun}`, { valid: res.valid, jumlah: res.jumlah_entri }, req.ip);
      return res;
    } finally { client.release(); }
  });

  app.get('/api/bku/:id', { preHandler: requireAuth }, async (req) => {
    const { rows: [e] } = await query(`
      SELECT e.*, r.nama AS rekening_nama, rk.nama AS rekanan_nama, rk.npwp AS rekanan_npwp, rk.alamat AS rekanan_alamat,
             rk.bank AS rekanan_bank, rk.no_rekening AS rekanan_no_rekening, u.full_name AS dibuat_oleh
        FROM bku_entries e LEFT JOIN rekening r ON r.kode = e.kode_rekening LEFT JOIN rekanan rk ON rk.id = e.rekanan_id
        LEFT JOIN users u ON u.id = e.created_by WHERE e.id = $1`, [int(req.params.id)]);
    if (!e) throw notFound();
    scopeSkpd(req.user, e.skpd_id);
    const [{ rows: [skpd] }, { rows: pajak }, { rows: verifikasi }, { rows: koreksi }] = await Promise.all([
      query('SELECT * FROM skpd WHERE id = $1', [e.skpd_id]),
      query(`SELECT * FROM pajak WHERE bku_entry_id = $1 OR (detail->>'belanja_entry_id')::bigint = $1 ORDER BY id`, [e.id]),
      query('SELECT v.*, u.full_name FROM bku_verifications v JOIN users u ON u.id = v.verified_by WHERE entry_id = $1 ORDER BY verified_at DESC', [e.id]),
      query('SELECT id, no_urut, tanggal, uraian FROM bku_entries WHERE koreksi_of = $1', [e.id]),
    ]);
    const nilai = Number(e.penerimaan) || Number(e.pengeluaran);
    return { entry: e, skpd, pajak, verifikasi, koreksi, terbilang: terbilang(nilai) };
  });

  app.post('/api/bku', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    return tx(async (c) => {
      const tahun = Number(String(b.tanggal).slice(0, 4));
      const warnings = await cekAnggaran(c, skpd, tahun, [b]);
      const { entry, pajak } = await catatTransaksi(c, req.user, skpd, b);
      await audit(c, req.user, 'bku_tambah', 'bku', entry.id, { no_urut: entry.no_urut, pajak: pajak.length }, req.ip);
      return { entry, pajak, warnings };
    });
  });

  app.post('/api/bku/:id/koreksi', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    required(req.body, ['alasan']);
    return tx(async (c) => {
      const { rows: [o] } = await c.query('SELECT * FROM bku_entries WHERE id = $1', [int(req.params.id)]);
      if (!o) throw notFound();
      canWrite(req.user, o.skpd_id);
      if (o.jenis === 'KOREKSI') throw bad('Entri koreksi tidak dapat dikoreksi lagi');
      const { rows: done } = await c.query('SELECT 1 FROM bku_entries WHERE koreksi_of = $1', [o.id]);
      if (done.length) throw bad('Entri ini sudah pernah dikoreksi');
      const tanggal = isDate(req.body.tanggal) ? req.body.tanggal : o.tanggal;
      const [k] = await insertEntries(c, req.user, o.skpd_id, [{
        tanggal, no_bukti: `KOR-${o.no_bukti}`, jenis: 'KOREKSI', kode_rekening: o.kode_rekening, metode: o.metode,
        uraian: `Koreksi BKU No. ${o.no_urut} (${o.uraian.slice(0, 120)}): ${req.body.alasan}`,
        penerimaan: o.pengeluaran, pengeluaran: o.penerimaan, koreksi_of: o.id, rekanan_id: o.rekanan_id,
      }]);
      await audit(c, req.user, 'bku_koreksi', 'bku', o.id, { koreksi_id: k.id, alasan: req.body.alasan }, req.ip);
      return { entry: k };
    });
  });

  app.post('/api/bku/:id/verifikasi', { preHandler: requireRole('admin', 'verifikator') }, async (req) => {
    const status = req.body?.status;
    if (!['diverifikasi', 'ditolak'].includes(status)) throw bad('Status harus diverifikasi atau ditolak');
    if (status === 'ditolak' && !req.body.catatan) throw bad('Catatan wajib diisi bila ditolak');
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.params.id]).map(Number);
    return tx(async (c) => {
      const { rows } = await c.query('SELECT id, skpd_id FROM bku_entries WHERE id = ANY($1)', [ids]);
      rows.forEach((r) => scopeSkpd(req.user, r.skpd_id));
      for (const r of rows) {
        await c.query('INSERT INTO bku_verifications (entry_id, status, catatan, verified_by) VALUES ($1,$2,$3,$4)', [r.id, status, req.body.catatan || null, req.user.id]);
      }
      if (rows.length) await emit(c, 'bku.verified', String(rows[0].skpd_id), { skpd_id: rows[0].skpd_id, ids: rows.map((r) => r.id), status, user: req.user.full_name });
      await audit(c, req.user, `bku_${status}`, 'bku', ids.join(','), { catatan: req.body.catatan }, req.ip);
      return { updated: rows.length };
    });
  });
}

export { listEntries, periode };
