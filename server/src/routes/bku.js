import { query, tx, audit, emit, pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { insertEntries, verifyChain, JENIS_BKU } from '../lib/ledger.js';
import { verifySub } from '../lib/subledger.js';
import { bad, notFound, int, isDate, money, scopeSkpd, canWrite, sendFile, XLSX, required } from '../lib/http.js';
import { buildWorkbook } from '../lib/excel.js';
import { terbilang } from '../../../shared/terbilang.js';
import { catatTransaksi } from '../lib/transaksi.js';
import { setelStatus } from '../lib/statusbku.js';
import { putuskan, bolehPutuskan } from './persetujuan.js';


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
  // Status persetujuan berjenjang (parameter lama `verif` tetap dikenali)
  const status = q.status || { belum: 'menunggu', diverifikasi: 'disetujui', ditolak: 'ditolak' }[q.verif];
  if (status) { params.push(status); where.push(`s.status = $${params.length}`); }
  if (q.tahap) { params.push(q.tahap); where.push(`s.status = 'menunggu' AND s.peran_menunggu = $${params.length}`); }
  if (q.dokumen === 'lengkap') where.push("s.dokumen_status IN ('lengkap','tidak_wajib')");
  else if (q.dokumen === 'kurang') where.push("s.dokumen_status IN ('sebagian','belum')");

  const pageSize = Math.min(int(q.pageSize, 50), 1000);
  const page = Math.max(int(q.page, 1), 1);
  const base = `
    WITH base AS (
      SELECT e.*, $5::numeric + SUM(e.penerimaan - e.pengeluaran) OVER (ORDER BY e.tanggal, e.no_urut) AS saldo
        FROM bku_entries e WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.tanggal BETWEEN $3 AND $4
    )
    SELECT b.*, r.nama AS rekening_nama, rk.nama AS rekanan_nama, u.full_name AS dibuat_oleh,
           s.status AS status_persetujuan, s.tahap AS tahap_menunggu, s.peran_menunggu, s.catatan AS catatan_persetujuan,
           s.dokumen_status, s.dokumen_kurang, s.induk_id,
           EXISTS (SELECT 1 FROM bku_entries k WHERE k.koreksi_of = b.id AND k.skpd_id = b.skpd_id AND k.tahun = b.tahun) AS dikoreksi,
           (SELECT COUNT(*) FROM lampiran l WHERE l.bku_entry_id = b.id AND l.dihapus_at IS NULL)::int AS jumlah_lampiran,
           COUNT(*) OVER () AS total_rows
      FROM base b
      LEFT JOIN rekening r ON r.kode = b.kode_rekening
      LEFT JOIN rekanan rk ON rk.id = b.rekanan_id
      LEFT JOIN users u ON u.id = b.created_by
      LEFT JOIN bku_status s ON s.entry_id = b.id
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
        { key: 'metode', header: 'Kas', width: 8 }, { key: 'status_persetujuan', header: 'Status persetujuan', width: 16 },
        { key: 'dokumen_status', header: 'Kelengkapan dokumen', width: 16 },
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
      // Buku pembantu (BKU penerimaan & BKU bendahara pembantu) punya rantai hash sendiri
      const { rows: units } = await client.query('SELECT id, nama FROM unit_kerja WHERE skpd_id = $1 ORDER BY kode', [skpd]);
      res.buku_pembantu = [{ nama: 'BKU Bendahara Penerimaan', ...(await verifySub(client, 'bkp', skpd, tahun)) },
        ...(await Promise.all(units.map(async (u) => ({ nama: `BKU Pembantu ${u.nama}`, ...(await verifySub(client, 'bpp', u.id, tahun)) }))))].filter((b) => b.jumlah);
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
    const [{ rows: [skpd] }, { rows: pajak }, { rows: verifikasi }, { rows: koreksi }, { rows: [status] }] = await Promise.all([
      query('SELECT * FROM skpd WHERE id = $1', [e.skpd_id]),
      query(`SELECT * FROM pajak WHERE bku_entry_id = $1 OR (detail->>'belanja_entry_id')::bigint = $1 ORDER BY id`, [e.id]),
      query('SELECT v.*, u.full_name FROM bku_verifications v JOIN users u ON u.id = v.verified_by WHERE entry_id = $1 ORDER BY verified_at DESC', [e.id]),
      query('SELECT id, no_urut, tanggal, uraian FROM bku_entries WHERE koreksi_of = $1', [e.id]),
      query('SELECT * FROM bku_status WHERE entry_id = $1', [e.id]),
    ]);
    const nilai = Number(e.penerimaan) || Number(e.pengeluaran);
    return { entry: e, skpd, pajak, verifikasi, koreksi, status, terbilang: terbilang(nilai) };
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
      // Entri asal ditandai dikoreksi; tahap persetujuan yang masih berjalan dibatalkan. Jurnal koreksi sendiri melewati persetujuan.
      const { rows: [st] } = await c.query('SELECT status FROM bku_status WHERE entry_id = $1', [o.id]);
      await c.query("UPDATE persetujuan SET status = 'batal' WHERE objek = 'bku' AND objek_id = $1 AND status IN ('antre','menunggu')", [String(o.id)]);
      await setelStatus(c, o.id, { status: 'dikoreksi', catatan: `Dikoreksi oleh BKU No. ${k.no_urut}${st?.status === 'disetujui' ? ' (sebelumnya telah disetujui)' : ''}: ${req.body.alasan}` });
      await audit(c, req.user, 'bku_koreksi', 'bku', o.id, { koreksi_id: k.id, alasan: req.body.alasan, status_sebelumnya: st?.status }, req.ip);
      return { entry: k };
    });
  });

  // Kompatibilitas: verifikasi/penolakan satu tingkat kini diteruskan ke tahap persetujuan berjenjang yang sedang menunggu
  app.post('/api/bku/:id/verifikasi', { preHandler: requireRole('admin', 'verifikator', 'pimpinan') }, async (req) => {
    const status = req.body?.status;
    if (!['diverifikasi', 'ditolak'].includes(status)) throw bad('Status harus diverifikasi atau ditolak');
    if (status === 'ditolak' && !req.body.catatan) throw bad('Catatan wajib diisi bila ditolak');
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.params.id]).map(Number);
    return tx(async (c) => {
      const { rows } = await c.query(`SELECT p.id, p.skpd_id, p.peran, p.objek_id FROM persetujuan p
        WHERE p.objek = 'bku' AND p.objek_id = ANY($1) AND p.status = 'menunggu'`, [ids.map(String)]);
      let updated = 0; const gagal = [];
      for (const t of rows) {
        scopeSkpd(req.user, t.skpd_id);
        if (!bolehPutuskan(req.user, t)) { gagal.push({ id: t.objek_id, alasan: `Tahap ini diputuskan oleh ${t.peran}` }); continue; }
        await c.query('SAVEPOINT v');
        try { await putuskan(c, req.user, t.id, status === 'diverifikasi', req.body.catatan); await c.query('RELEASE SAVEPOINT v'); updated++; } catch (e) { await c.query('ROLLBACK TO SAVEPOINT v'); gagal.push({ id: t.objek_id, alasan: e.message }); }
      }
      if (updated) await emit(c, 'bku.verified', String(rows[0].skpd_id), { skpd_id: rows[0].skpd_id, ids, status, user: req.user.full_name });
      await audit(c, req.user, `bku_${status}`, 'bku', ids.join(','), { catatan: req.body.catatan, diputuskan: updated, gagal: gagal.length }, req.ip);
      return { updated, gagal, dilewati: ids.length - rows.length };
    });
  });
}

export { listEntries, periode };
