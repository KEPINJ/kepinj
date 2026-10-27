// Transfer massal lewat Cash Management System (CMS) bank: pembayaran belanja non-tunai kepada rekanan
// dikumpulkan menjadi satu berkas unggah. Nilai yang ditransfer = bruto dikurangi potongan pajak.
// Susunan kolom tiap bank berbeda per kontrak; templat di sini perlu dicocokkan dengan templat CMS bank Anda.
import ExcelJS from 'exceljs';
import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, notFound, int, isDate, scopeSkpd, canWrite, sendFile, XLSX } from '../lib/http.js';

// Kode bank (sandi kliring BI) untuk nama bank yang umum dipakai rekanan
export const KODE_BANK = { 'bank daerah': '110', bpd: '110', bri: '002', 'bank rakyat indonesia': '002', mandiri: '008', 'bank mandiri': '008', bni: '009', 'bank negara indonesia': '009',
  bca: '014', 'bank central asia': '014', btn: '200', bsi: '451', 'bank syariah indonesia': '451', cimb: '022', danamon: '011', permata: '013' };
export const kodeBank = (nama) => KODE_BANK[String(nama || '').toLowerCase().trim()] || null;

export const FORMAT = {
  csv_umum: { label: 'CSV umum (semua bank)', ext: 'csv' },
  mandiri_mcm: { label: 'Mandiri MCM (bulk CSV)', ext: 'csv' },
  bri_cms: { label: 'BRI CMS (mass transfer)', ext: 'csv' },
  bni_direct: { label: 'BNIDirect (bulk payment)', ext: 'csv' },
  xlsx: { label: 'Excel (daftar transfer)', ext: 'xlsx' },
};

const bersih = (s, n = 35) => String(s || '').replace(/[,;"\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const ymd = (d) => d.replaceAll('-', '');

/** Susun isi berkas sesuai format bank. */
export async function susunBerkas(batch, items, skpd) {
  const total = items.reduce((s, i) => s + Number(i.nilai), 0).toFixed(2);
  const sumber = (batch.rekening_sumber || '').replace(/\D/g, '');
  if (batch.format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Transfer');
    ws.addRow([`DAFTAR TRANSFER ${batch.nomor} - ${skpd.nama}`]).font = { bold: true };
    ws.addRow([`Rekening sumber: ${batch.rekening_sumber || '-'} · tanggal ${batch.tanggal}`]);
    ws.addRow([]);
    ws.addRow(['No', 'Nama penerima', 'Bank', 'Kode bank', 'No. rekening', 'Bruto', 'Potongan', 'Ditransfer', 'Berita']).font = { bold: true };
    items.forEach((i, n) => ws.addRow([n + 1, i.nama, i.bank, i.kode_bank, i.no_rekening, Number(i.bruto), Number(i.potongan), Number(i.nilai), i.berita]));
    ws.addRow(['', 'JUMLAH', '', '', '', items.reduce((s, i) => s + Number(i.bruto), 0), items.reduce((s, i) => s + Number(i.potongan), 0), Number(total)]).font = { bold: true };
    ws.columns.forEach((c, i) => { c.width = [5, 32, 16, 10, 18, 16, 14, 16, 40][i]; if (i >= 5 && i <= 7) c.numFmt = '#,##0.00'; });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  let baris;
  if (batch.format === 'mandiri_mcm') {
    baris = [`P,${ymd(batch.tanggal)},${sumber},${items.length},${total}`,
      ...items.map((i) => [i.no_rekening, bersih(i.nama), '', '', '', 'IDR', Number(i.nilai).toFixed(2), bersih(i.berita, 40), '', i.kode_bank === '008' ? 'IBU' : 'LBU',
        i.kode_bank === '008' ? '' : i.kode_bank, bersih(i.bank), '', '', '', 'N', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Y', ''].join(','))];
  } else if (batch.format === 'bri_cms') {
    baris = ['NO;REKENING_TUJUAN;NAMA_PENERIMA;NOMINAL;KETERANGAN;KODE_BANK;REKENING_SUMBER',
      ...items.map((i, n) => [n + 1, i.no_rekening, bersih(i.nama), Number(i.nilai).toFixed(2), bersih(i.berita, 36), i.kode_bank || '', sumber].join(';'))];
  } else if (batch.format === 'bni_direct') {
    baris = [`${ymd(batch.tanggal)},${items.length},${total},${sumber}`,
      ...items.map((i) => [i.no_rekening, bersih(i.nama), Number(i.nilai).toFixed(2), bersih(i.berita, 40), i.kode_bank === '009' ? 'IN HOUSE' : 'ONLINE', i.kode_bank || '', bersih(i.bank)].join(','))];
  } else {
    baris = ['No,Nama Penerima,Bank,Kode Bank,No Rekening,Nominal,Berita',
      ...items.map((i, n) => [n + 1, bersih(i.nama), bersih(i.bank), i.kode_bank || '', i.no_rekening, Number(i.nilai).toFixed(2), bersih(i.berita, 60)].join(','))];
  }
  return Buffer.from(`${baris.join('\r\n')}\r\n`, 'utf8');
}

/** Belanja non-tunai kepada rekanan yang belum masuk berkas transfer (atau transfer sebelumnya gagal). */
export async function kandidatTransfer(skpd, tahun, { dari, sampai } = {}) {
  const { rows } = await query(`SELECT e.id, e.tanggal, e.no_bukti, e.uraian, e.pengeluaran::float AS bruto, e.kode_rekening, rk.id AS rekanan_id, rk.nama, rk.bank, rk.no_rekening,
      COALESCE((SELECT SUM(p.nominal) FROM pajak p WHERE (p.detail->>'belanja_entry_id')::bigint = e.id), 0)::float AS potongan
    FROM bku_entries e JOIN rekanan rk ON rk.id = e.rekanan_id
    WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.jenis = 'BELANJA' AND e.metode = 'bank' AND ($3::date IS NULL OR e.tanggal >= $3) AND ($4::date IS NULL OR e.tanggal <= $4)
      AND NOT EXISTS (SELECT 1 FROM bku_entries k WHERE k.koreksi_of = e.id AND k.skpd_id = e.skpd_id)
      AND NOT EXISTS (SELECT 1 FROM transfer_item t JOIN transfer_batch b ON b.id = t.batch_id WHERE t.bku_entry_id = e.id AND b.status <> 'batal' AND t.status <> 'gagal')
    ORDER BY e.tanggal DESC, e.no_urut DESC LIMIT 500`, [skpd, tahun, dari || null, sampai || null]);
  return rows.map((r) => {
    const masalah = [];
    if (!r.no_rekening) masalah.push('Rekening rekanan kosong');
    else if (!/^\d{6,20}$/.test(String(r.no_rekening).replace(/[\s.-]/g, ''))) masalah.push('Format nomor rekening tidak valid');
    if (!kodeBank(r.bank)) masalah.push('Kode bank tidak dikenali');
    return { ...r, nilai: Math.round((r.bruto - r.potongan) * 100) / 100, kode_bank: kodeBank(r.bank), masalah };
  });
}

export default async function transferRoutes(app) {
  app.get('/api/transfer', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const [kandidat, { rows: batch }, { rows: [s] }] = await Promise.all([
      kandidatTransfer(skpd, tahun, { dari: req.query.dari, sampai: req.query.sampai }),
      query(`SELECT b.*, u.full_name AS dibuat_oleh, (SELECT COUNT(*) FILTER (WHERE status = 'gagal')::int FROM transfer_item WHERE batch_id = b.id) AS gagal,
          (SELECT COUNT(*) FILTER (WHERE status = 'berhasil')::int FROM transfer_item WHERE batch_id = b.id) AS berhasil
        FROM transfer_batch b LEFT JOIN users u ON u.id = b.created_by WHERE b.skpd_id = $1 AND b.tahun = $2 ORDER BY b.id DESC`, [skpd, tahun]),
      query('SELECT rekening_bendahara, bank_bendahara FROM skpd WHERE id = $1', [skpd]),
    ]);
    return { kandidat, batch, format: FORMAT, sumber: s };
  });

  app.get('/api/transfer/:id', { preHandler: requireAuth }, async (req) => {
    const { rows: [b] } = await query('SELECT b.*, u.full_name AS dibuat_oleh FROM transfer_batch b LEFT JOIN users u ON u.id = b.created_by WHERE b.id = $1', [int(req.params.id)]);
    if (!b) throw notFound();
    scopeSkpd(req.user, b.skpd_id);
    const { rows: items } = await query('SELECT t.*, e.tanggal, e.no_bukti FROM transfer_item t LEFT JOIN bku_entries e ON e.id = t.bku_entry_id AND e.skpd_id = $2 WHERE t.batch_id = $1 ORDER BY t.id', [b.id, b.skpd_id]);
    return { batch: b, items };
  });

  app.post('/api/transfer', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    if (!FORMAT[b.format]) throw bad('Format berkas tidak dikenal');
    if (!isDate(b.tanggal)) throw bad('Tanggal transfer tidak valid');
    const ids = (b.entry_ids || []).map(Number).filter(Boolean);
    if (!ids.length) throw bad('Pilih pembayaran yang akan ditransfer');
    const tahun = Number(b.tanggal.slice(0, 4));
    const pilih = (await kandidatTransfer(skpd, tahun)).filter((k) => ids.includes(k.id));
    if (pilih.length !== ids.length) throw bad('Sebagian pembayaran sudah masuk berkas lain atau tidak ditemukan');
    const salah = pilih.filter((k) => k.masalah.length || !(k.nilai > 0));
    if (salah.length) throw bad(`${salah.length} pembayaran belum valid (periksa rekening/bank rekanan): ${salah.slice(0, 3).map((k) => k.nama).join(', ')}`);
    return tx(async (c) => {
      const { rows: [s] } = await c.query('SELECT kode, rekening_bendahara FROM skpd WHERE id = $1', [skpd]);
      if (!String(b.rekening_sumber || s.rekening_bendahara || '').trim()) throw bad('Isi rekening sumber (rekening bendahara pengeluaran) terlebih dahulu');
      const { rows: [n] } = await c.query('SELECT COUNT(*)::int + 1 AS n FROM transfer_batch WHERE skpd_id = $1 AND tahun = $2', [skpd, tahun]);
      const nomor = `TRF-${String(n.n).padStart(3, '0')}/${s.kode.slice(0, 4)}/${tahun}`;
      const total = pilih.reduce((t, k) => t + k.nilai, 0);
      const { rows: [batch] } = await c.query(`INSERT INTO transfer_batch (skpd_id, tahun, nomor, tanggal, format, rekening_sumber, total, jumlah, catatan, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [skpd, tahun, nomor, b.tanggal, b.format, b.rekening_sumber || s.rekening_bendahara, total, pilih.length, b.catatan || null, req.user.id]);
      for (const k of pilih) {
        await c.query(`INSERT INTO transfer_item (batch_id, bku_entry_id, rekanan_id, nama, bank, kode_bank, no_rekening, bruto, potongan, nilai, berita) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [batch.id, k.id, k.rekanan_id, k.nama, k.bank, k.kode_bank, String(k.no_rekening).replace(/[\s.-]/g, ''), k.bruto, k.potongan, k.nilai, `${k.no_bukti} ${k.uraian}`.slice(0, 120)]);
      }
      await audit(c, req.user, 'transfer_buat', 'transfer_batch', batch.id, { nomor, jumlah: pilih.length, total, format: b.format }, req.ip);
      return { batch };
    });
  });

  app.get('/api/transfer/:id/berkas', { preHandler: requireAuth }, async (req, reply) => {
    const { rows: [b] } = await query('SELECT * FROM transfer_batch WHERE id = $1', [int(req.params.id)]);
    if (!b) throw notFound();
    scopeSkpd(req.user, b.skpd_id);
    if (b.status === 'batal') throw bad('Berkas sudah dibatalkan');
    const [{ rows: items }, { rows: [s] }] = await Promise.all([
      query("SELECT * FROM transfer_item WHERE batch_id = $1 AND status <> 'gagal' ORDER BY id", [b.id]),
      query('SELECT * FROM skpd WHERE id = $1', [b.skpd_id]),
    ]);
    const buf = await susunBerkas(b, items, s);
    await tx(async (c) => {
      await c.query("UPDATE transfer_batch SET status = CASE WHEN status = 'draft' THEN 'dikirim' ELSE status END, diunduh_at = now() WHERE id = $1", [b.id]);
      await audit(c, req.user, 'transfer_unduh', 'transfer_batch', b.id, { nomor: b.nomor, format: b.format }, req.ip);
    });
    const ext = FORMAT[b.format].ext;
    return sendFile(reply, buf, `${b.nomor.replaceAll('/', '_')}_${b.format}.${ext}`, ext === 'xlsx' ? XLSX : 'text/csv; charset=utf-8');
  });

  // Hasil eksekusi dari CMS: tandai berhasil semua atau item tertentu gagal (dapat diajukan ulang di berkas baru)
  app.post('/api/transfer/:id/hasil', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    return tx(async (c) => {
      const { rows: [batch] } = await c.query('SELECT * FROM transfer_batch WHERE id = $1 FOR UPDATE', [int(req.params.id)]);
      if (!batch) throw notFound();
      canWrite(req.user, batch.skpd_id);
      if (batch.status === 'batal') throw bad('Berkas sudah dibatalkan');
      if (b.batal) {
        if (batch.status === 'selesai') throw bad('Berkas yang sudah selesai tidak dapat dibatalkan');
        await c.query("UPDATE transfer_batch SET status = 'batal' WHERE id = $1", [batch.id]);
      } else {
        if (batch.status === 'draft') throw bad('Unduh berkas dan unggah ke CMS bank terlebih dahulu');
        if (batch.status === 'selesai') throw bad('Hasil transfer berkas ini sudah dicatat');
        const gagal = (b.gagal || []).map(Number);
        await c.query("UPDATE transfer_item SET status = CASE WHEN id = ANY($2) THEN 'gagal' ELSE 'berhasil' END, keterangan = CASE WHEN id = ANY($2) THEN $3 ELSE keterangan END WHERE batch_id = $1",
          [batch.id, gagal, b.keterangan || 'Ditolak bank']);
        await c.query("UPDATE transfer_batch SET status = 'selesai' WHERE id = $1", [batch.id]);
      }
      await audit(c, req.user, b.batal ? 'transfer_batal' : 'transfer_hasil', 'transfer_batch', batch.id, b, req.ip);
      return { ok: true };
    });
  });

  app.put('/api/transfer/sumber', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    await query('UPDATE skpd SET rekening_bendahara = $2, bank_bendahara = $3 WHERE id = $1', [skpd, String(b.rekening_bendahara || '').trim() || null, String(b.bank_bendahara || '').trim() || null]);
    return { ok: true };
  });
}
