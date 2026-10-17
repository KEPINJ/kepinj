// Modul Olah Data: upload Excel/CSV -> rangkaian langkah pengolahan -> ekspor / simpan ke BKU / pajak
import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { parseSpreadsheet, buildWorkbook } from '../lib/excel.js';
import { insertEntries } from '../lib/ledger.js';
import { insertPajak, hitung } from './pajak.js';
import { bad, notFound, int, scopeSkpd, canWrite, sendFile, XLSX, required } from '../lib/http.js';
import { runPipeline, columnTotals } from '../../../shared/pipeline.js';
import { toNum } from '../../../shared/expr.js';
import { JENIS_BELANJA } from '../../../shared/tax.js';

export async function loadDataset(id, user) {
  const { rows: [ds] } = await query('SELECT * FROM datasets WHERE id = $1', [int(id)]);
  if (!ds) throw notFound('Dataset tidak ditemukan');
  if (user.role !== 'admin' && ds.created_by !== user.id) {
    const { rows: [owner] } = await query('SELECT skpd_id FROM users WHERE id = $1', [ds.created_by]);
    if (owner?.skpd_id !== user.skpd_id) throw notFound('Dataset tidak ditemukan');
  }
  const { rows } = await query('SELECT data FROM dataset_rows WHERE dataset_id = $1 ORDER BY row_no', [ds.id]);
  return { ds, rows: rows.map((r) => r.data) };
}

async function processDataset(body, user) {
  const { ds, rows } = await loadDataset(body.dataset_id, user);
  try {
    return { ds, ...runPipeline(ds.columns, rows, body.steps || []) };
  } catch (e) {
    throw bad(e.message, { log: e.log });
  }
}

/** Normalisasi tanggal dari berbagai format sel Excel/CSV menjadi YYYY-MM-DD. */
export function normDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const BULAN = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, aug: 8, ags: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
  m = s.toLowerCase().match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (m && BULAN[m[2].slice(0, 3)]) return `${m[3]}-${String(BULAN[m[2].slice(0, 3)]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const pick = (row, col) => (col ? row[col] : undefined);

export default async function dataRoutes(app) {
  app.post('/api/data/upload', { preHandler: requireAuth }, async (req) => {
    const file = await req.file();
    if (!file) throw bad('File belum dipilih');
    const buf = await file.toBuffer();
    const sheets = (await parseSpreadsheet(buf, file.filename)).filter((s) => s.rows.length);
    if (!sheets.length) throw bad('File tidak berisi data');
    const created = await tx(async (c) => {
      const out = [];
      for (const s of sheets) {
        const nama = sheets.length > 1 ? `${file.filename} — ${s.sheet}` : file.filename;
        const { rows: [ds] } = await c.query('INSERT INTO datasets (nama, file_name, columns, row_count, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [nama, file.filename, JSON.stringify(s.columns), s.rows.length, req.user.id]);
        for (let i = 0; i < s.rows.length; i += 2000) {
          const chunk = s.rows.slice(i, i + 2000);
          await c.query(`INSERT INTO dataset_rows (dataset_id, row_no, data)
            SELECT $1, (ord + $2)::int, value FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS t(value, ord)`, [ds.id, i, JSON.stringify(chunk)]);
        }
        out.push(ds);
      }
      await audit(c, req.user, 'data_upload', 'dataset', out.map((d) => d.id).join(','), { file: file.filename, baris: sheets.reduce((s, x) => s + x.rows.length, 0) }, req.ip);
      return out;
    });
    return { datasets: created };
  });

  app.get('/api/data/datasets', { preHandler: requireAuth }, async (req) => {
    const params = [];
    let where = '';
    if (req.user.role !== 'admin') { params.push(req.user.skpd_id); where = 'WHERE u.skpd_id = $1'; }
    const { rows } = await query(`SELECT d.id, d.nama, d.file_name, d.columns, d.row_count, d.created_at, u.full_name AS pengunggah
      FROM datasets d LEFT JOIN users u ON u.id = d.created_by ${where} ORDER BY d.id DESC LIMIT 200`, params);
    return { rows };
  });

  app.get('/api/data/datasets/:id', { preHandler: requireAuth }, async (req) => {
    const { ds, rows } = await loadDataset(req.params.id, req.user);
    return { dataset: ds, rows: rows.slice(0, int(req.query.limit, 100)) };
  });

  app.delete('/api/data/datasets/:id', { preHandler: requireAuth }, async (req) => {
    const { ds } = await loadDataset(req.params.id, req.user);
    await tx(async (c) => {
      await c.query('DELETE FROM datasets WHERE id = $1', [ds.id]);
      await audit(c, req.user, 'data_hapus', 'dataset', ds.id, { nama: ds.nama }, req.ip);
    });
    return { ok: true };
  });

  app.post('/api/data/run', { preHandler: requireAuth }, async (req) => {
    required(req.body, ['dataset_id']);
    const t0 = Date.now();
    const r = await processDataset(req.body, req.user);
    const limit = Math.min(int(req.body.limit, 200), 2000);
    return { columns: r.columns, rows: r.rows.slice(0, limit), total: r.rows.length, totals: columnTotals(r.columns, r.rows), log: r.log, ms: Date.now() - t0 };
  });

  app.post('/api/data/export', { preHandler: requireAuth }, async (req, reply) => {
    required(req.body, ['dataset_id']);
    const r = await processDataset(req.body, req.user);
    const totals = columnTotals(r.columns, r.rows);
    const buf = await buildWorkbook({
      title: req.body.judul || `Hasil Olah Data - ${r.ds.nama}`,
      subtitle: `Diproses ${new Date().toLocaleString('id-ID')} oleh ${req.user.full_name}`,
      sheetName: 'Hasil',
      columns: r.columns.map((c) => ({ key: c, header: c, type: totals[c] != null ? 'money' : 'text' })),
      rows: r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c, totals[c] != null ? toNum(row[c]) : row[c]]))),
      totals,
    });
    return sendFile(reply, buf, `olah-data-${r.ds.id}.xlsx`, XLSX);
  });

  // Templat pengolahan yang dapat dipakai ulang
  app.get('/api/data/pipelines', { preHandler: requireAuth }, async () => {
    const { rows } = await query('SELECT p.*, u.full_name AS pembuat FROM pipelines p LEFT JOIN users u ON u.id = p.created_by ORDER BY p.nama');
    return { rows };
  });
  app.post('/api/data/pipelines', { preHandler: requireAuth }, async (req) => {
    required(req.body, ['nama', 'config']);
    return tx(async (c) => {
      const { rows: [p] } = req.body.id
        ? await c.query('UPDATE pipelines SET nama = $2, deskripsi = $3, config = $4, updated_at = now() WHERE id = $1 RETURNING *', [req.body.id, req.body.nama, req.body.deskripsi || null, req.body.config])
        : await c.query('INSERT INTO pipelines (nama, deskripsi, config, created_by) VALUES ($1,$2,$3,$4) RETURNING *', [req.body.nama, req.body.deskripsi || null, req.body.config, req.user.id]);
      await audit(c, req.user, 'templat_simpan', 'pipeline', p.id, { nama: p.nama }, req.ip);
      return { row: p };
    });
  });
  app.delete('/api/data/pipelines/:id', { preHandler: requireAuth }, async (req) => {
    await tx(async (c) => {
      await c.query('DELETE FROM pipelines WHERE id = $1', [int(req.params.id)]);
      await audit(c, req.user, 'templat_hapus', 'pipeline', req.params.id, null, req.ip);
    });
    return { ok: true };
  });

  // Simpan hasil olahan sebagai transaksi BKU
  app.post('/api/data/commit/bku', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const { mapping = {}, defaults = {}, dry_run: dry } = req.body;
    required(mapping, ['tanggal', 'uraian']);
    if (!mapping.penerimaan && !mapping.pengeluaran && !mapping.nilai) throw bad('Petakan kolom penerimaan, pengeluaran, atau nilai');
    const skpd = scopeSkpd(req.user, req.body.skpd_id);
    canWrite(req.user, skpd);
    const r = await processDataset(req.body, req.user);
    const errors = [];
    const entries = [];
    r.rows.forEach((row, i) => {
      const tanggal = normDate(pick(row, mapping.tanggal));
      let penerimaan = toNum(pick(row, mapping.penerimaan));
      let pengeluaran = toNum(pick(row, mapping.pengeluaran));
      if (mapping.nilai) {
        const n = toNum(pick(row, mapping.nilai));
        const arah = String(pick(row, mapping.arah) ?? defaults.arah ?? 'pengeluaran').toLowerCase();
        if (/terima|masuk|debet|kredit_masuk|penerimaan|^in/.test(arah)) penerimaan = Math.abs(n); else pengeluaran = Math.abs(n);
      }
      const e = {
        tanggal, uraian: pick(row, mapping.uraian), no_bukti: pick(row, mapping.no_bukti) || defaults.no_bukti,
        kode_rekening: pick(row, mapping.kode_rekening) || defaults.kode_rekening || null,
        jenis: pick(row, mapping.jenis) || defaults.jenis || undefined, metode: pick(row, mapping.metode) || defaults.metode || 'bank',
        penerimaan, pengeluaran,
      };
      if (!tanggal) errors.push({ baris: i + 1, pesan: `Tanggal tidak dikenali: ${pick(row, mapping.tanggal) ?? '(kosong)'}` });
      else if (!e.uraian) errors.push({ baris: i + 1, pesan: 'Uraian kosong' });
      else if (!(penerimaan > 0) && !(pengeluaran > 0)) errors.push({ baris: i + 1, pesan: 'Nilai nol/kosong' });
      else entries.push(e);
    });
    if (dry || errors.length) {
      return { dry_run: true, valid: entries.length, errors: errors.slice(0, 200), jumlah_error: errors.length, contoh: entries.slice(0, 20),
        total_penerimaan: entries.reduce((s, e) => s + e.penerimaan, 0), total_pengeluaran: entries.reduce((s, e) => s + e.pengeluaran, 0) };
    }
    const batch = `IMP-${Date.now().toString(36).toUpperCase()}`;
    const saved = await tx(async (c) => {
      const s = await insertEntries(c, req.user, skpd, entries.map((e) => ({ ...e, import_batch: batch })));
      await audit(c, req.user, 'data_commit_bku', 'dataset', r.ds.id, { batch, jumlah: s.length }, req.ip);
      return s;
    });
    return { batch, saved: saved.length, no_urut_awal: saved[0]?.no_urut, no_urut_akhir: saved.at(-1)?.no_urut };
  });

  // Hitung pajak massal dari data (mis. daftar gaji/honor) lalu simpan sebagai bukti potong
  app.post('/api/data/commit/pajak', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const { mapping = {}, metode, tahun, masa, kode_objek, dry_run: dry } = req.body;
    required(req.body, ['metode', 'tahun', 'masa']);
    required(mapping, ['nama', 'bruto']);
    const skpd = scopeSkpd(req.user, req.body.skpd_id);
    canWrite(req.user, skpd);
    const r = await processDataset(req.body, req.user);
    const errors = []; const items = [];
    const JENIS = { pph21_bulanan: 'PPH21', pph21_bukan_pegawai: 'PPH21', pph21_honor_asn: 'PPH21', pph22: 'PPH22', pph23: 'PPH23', pph4a2: 'PPH4A2' };
    const DEFAULT_KODE = { pph21_bulanan: '21-100-01', pph21_bukan_pegawai: '21-100-07', pph21_honor_asn: '21-402-01', pph22: JENIS_BELANJA.barang.kode, pph23: JENIS_BELANJA.jasa.kode, pph4a2: JENIS_BELANJA.konstruksi.kode };
    if (!JENIS[metode]) throw bad('Metode perhitungan tidak dikenal');
    r.rows.forEach((row, i) => {
      const bruto = toNum(pick(row, mapping.bruto));
      const nama = pick(row, mapping.nama);
      const status = String(pick(row, mapping.status_ptkp) || 'TK/0').toUpperCase().replace(/\s/g, '');
      if (!nama || !(bruto > 0)) { errors.push({ baris: i + 1, pesan: 'Nama atau nilai bruto kosong' }); return; }
      let h;
      try {
        h = hitung(metode, { bruto, dpp: bruto, status, golongan: pick(row, mapping.golongan), tarif: toNum(pick(row, mapping.tarif)) || req.body.tarif, punyaNpwp: Boolean(pick(row, mapping.npwp)) });
      } catch (e) { errors.push({ baris: i + 1, pesan: e.message }); return; }
      items.push({
        tahun, masa, jenis_pajak: JENIS[metode], kode_objek: kode_objek || DEFAULT_KODE[metode], penerima_nama: String(nama),
        penerima_npwp: pick(row, mapping.npwp) || null, penerima_nik: pick(row, mapping.nik) || null,
        status_ptkp: JENIS[metode] === 'PPH21' ? status : null, dokumen_nomor: pick(row, mapping.dokumen_nomor) || null,
        dokumen_jenis: JENIS[metode] === 'PPH21' ? 'Other' : 'CommercialInvoice',
        dpp: h.dpp ?? bruto, tarif: h.tarif ?? h.tarifEfektif ?? 0, nominal: h.pph,
        detail: { bruto, metode: h.metode || metode, kategori: h.kategori, jabatan: pick(row, mapping.jabatan) || null, deemed: metode === 'pph21_bukan_pegawai' ? 50 : 100, dataset_id: r.ds.id },
      });
    });
    const total = items.reduce((s, x) => s + x.nominal, 0);
    if (dry || errors.length) return { dry_run: true, valid: items.length, errors: errors.slice(0, 200), jumlah_error: errors.length, contoh: items.slice(0, 50), total_pajak: total };
    const rows = await tx(async (c) => {
      const out = await insertPajak(c, req.user, skpd, items);
      await audit(c, req.user, 'data_commit_pajak', 'dataset', r.ds.id, { jumlah: out.length, total }, req.ip);
      return out;
    });
    return { saved: rows.length, total_pajak: total };
  });
}
