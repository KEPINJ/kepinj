// Aset dengan QR Code: setiap aset memiliki token QR unik. Petugas memindai QR dengan kamera HP untuk melihat
// identitas, harga, tahun perolehan, lokasi, dan kondisi aset, lalu mencatat hasil pemeriksaan fisik
// (inventarisasi). Aset belanja modal dapat didaftarkan langsung dari transaksi BKU (kode rekening 5.2),
// sehingga data perbendaharaan, akuntansi (aset tetap) dan pelaporan BMD saling tertaut.
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { query, tx, audit } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, notFound, forbidden, int, isDate, money, scopeSkpd, sendFile, XLSX, required } from '../lib/http.js';
import { buildWorkbook } from '../lib/excel.js';

export const KONDISI = { B: 'Baik', RR: 'Rusak ringan', RB: 'Rusak berat' };
export const STATUS_ASET = { aktif: 'Aktif', dipindahkan: 'Dipindahkan', diusulkan_hapus: 'Diusulkan hapus', dihapus: 'Dihapus' };
// Kelompok kode barang (Permendagri 108/2016 / Kepmendagri 050-5889/2021) yang dipakai sebagai pilihan
export const KODE_BARANG = [
  ['1.3.02.01.01.0001', 'Kendaraan dinas bermotor perorangan'], ['1.3.02.01.01.0004', 'Sepeda motor'],
  ['1.3.02.05.01.0001', 'Mesin ketik / alat kantor'], ['1.3.02.05.02.0001', 'Meja kerja'], ['1.3.02.05.02.0002', 'Kursi kerja'],
  ['1.3.02.05.02.0006', 'Lemari arsip'], ['1.3.02.05.02.0010', 'AC (air conditioner)'], ['1.3.02.05.03.0001', 'Proyektor / alat studio'],
  ['1.3.02.06.02.0001', 'Komputer PC'], ['1.3.02.06.02.0002', 'Laptop / notebook'], ['1.3.02.06.03.0001', 'Printer'],
  ['1.3.02.06.03.0005', 'Scanner'], ['1.3.02.06.04.0001', 'Server / peralatan jaringan'], ['1.3.02.10.01.0001', 'Peralatan komunikasi'],
  ['1.3.03.01.01.0001', 'Bangunan gedung kantor'],
];
const PERAN_TULIS = ['admin', 'bendahara', 'verifikator'];

const tokenQr = () => randomBytes(9).toString('base64url');
export const urlQr = (origin, kode) => `${String(origin || '').replace(/\/$/, '')}/a/${kode}`;
const asalPermintaan = (req) => req.query.origin && /^https?:\/\/[^\s/]+$/.test(req.query.origin) ? req.query.origin
  : `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`;

const bolehTulis = (user, skpd) => {
  if (!PERAN_TULIS.includes(user.role)) throw forbidden('Hanya admin, bendahara, atau verifikator yang dapat mengubah data aset');
  if (user.role !== 'admin' && user.skpd_id !== skpd) throw forbidden('Anda hanya dapat mengubah aset SKPD Anda');
};

const KOLOM = `a.*, s.nama AS skpd_nama, s.kode AS skpd_kode, u.full_name AS dibuat_nama,
  e.no_bukti AS bku_no_bukti, e.tanggal AS bku_tanggal, e.no_urut AS bku_no_urut,
  (SELECT row_to_json(p) FROM (SELECT p.kondisi, p.lokasi, p.sesuai_lokasi, p.catatan, p.waktu, pu.full_name AS oleh_nama
     FROM aset_pemeriksaan p LEFT JOIN users pu ON pu.id = p.oleh WHERE p.aset_id = a.id ORDER BY p.waktu DESC LIMIT 1) p) AS pemeriksaan_terakhir`;
const DARI = 'FROM aset a JOIN skpd s ON s.id = a.skpd_id LEFT JOIN users u ON u.id = a.dibuat_oleh LEFT JOIN bku_entries e ON e.id = a.bku_entry_id';

function bersihkan(b) {
  const o = {
    kode_barang: String(b.kode_barang || '').trim(), nama: String(b.nama || '').trim(), merk_tipe: b.merk_tipe?.trim() || null, spesifikasi: b.spesifikasi?.trim() || null,
    nomor_seri: b.nomor_seri?.trim() || null, tahun_perolehan: int(b.tahun_perolehan), tanggal_perolehan: isDate(b.tanggal_perolehan) ? b.tanggal_perolehan : null,
    harga_perolehan: money(b.harga_perolehan), sumber_dana: b.sumber_dana?.trim() || null, cara_perolehan: b.cara_perolehan || 'pembelian',
    lokasi: b.lokasi?.trim() || null, penanggung_jawab: b.penanggung_jawab?.trim() || null, kondisi: b.kondisi || 'B', keterangan: b.keterangan?.trim() || null,
  };
  if (!/^1\.3(\.\d+){1,4}$/.test(o.kode_barang)) throw bad('Kode barang harus kode aset tetap (diawali 1.3)');
  if (!o.nama) throw bad('Nama aset wajib diisi');
  if (!o.tahun_perolehan || o.tahun_perolehan < 1950 || o.tahun_perolehan > new Date().getFullYear() + 1) throw bad('Tahun perolehan tidak valid');
  if (!(o.harga_perolehan >= 0)) throw bad('Harga perolehan tidak valid');
  if (!KONDISI[o.kondisi]) throw bad('Kondisi harus B, RR, atau RB');
  if (!['pembelian', 'hibah', 'transfer', 'lainnya'].includes(o.cara_perolehan)) throw bad('Cara perolehan tidak valid');
  return o;
}

/** Daftarkan satu atau beberapa aset (jumlah > 1 = unit identik dengan NUP berurutan). */
export async function daftarAset(c, user, skpd, data, jumlah = 1, bkuEntryId = null) {
  const { rows: [m] } = await c.query('SELECT COALESCE(MAX(nup), 0)::int AS n FROM aset WHERE skpd_id = $1 AND kode_barang = $2', [skpd, data.kode_barang]);
  const hasil = [];
  for (let i = 1; i <= jumlah; i++) {
    const { rows: [r] } = await c.query(`INSERT INTO aset (skpd_id, kode_barang, nup, nama, merk_tipe, spesifikasi, nomor_seri, tahun_perolehan, tanggal_perolehan, harga_perolehan,
        sumber_dana, cara_perolehan, lokasi, penanggung_jawab, kondisi, kode_qr, bku_entry_id, keterangan, dibuat_oleh)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [skpd, data.kode_barang, m.n + i, data.nama, data.merk_tipe, data.spesifikasi, jumlah > 1 ? null : data.nomor_seri, data.tahun_perolehan, data.tanggal_perolehan,
      data.harga_perolehan, data.sumber_dana, data.cara_perolehan, data.lokasi, data.penanggung_jawab, data.kondisi, tokenQr(), bkuEntryId, data.keterangan, user?.id || null]);
    hasil.push(r);
  }
  return hasil;
}

async function ringkasanAset(skpd) {
  const { rows: [r] } = await query(`SELECT COUNT(*) FILTER (WHERE status <> 'dihapus')::int AS jumlah, COALESCE(SUM(harga_perolehan) FILTER (WHERE status <> 'dihapus'), 0)::float AS nilai,
      COUNT(*) FILTER (WHERE kondisi = 'B' AND status <> 'dihapus')::int AS baik, COUNT(*) FILTER (WHERE kondisi = 'RR' AND status <> 'dihapus')::int AS rusak_ringan,
      COUNT(*) FILTER (WHERE kondisi = 'RB' AND status <> 'dihapus')::int AS rusak_berat,
      COUNT(*) FILTER (WHERE status <> 'dihapus' AND (terakhir_diperiksa IS NULL OR terakhir_diperiksa < now() - interval '1 year'))::int AS belum_diperiksa_setahun,
      COUNT(DISTINCT lokasi)::int AS lokasi
    FROM aset WHERE skpd_id = $1`, [skpd]);
  return r;
}

async function progresInventarisasi(inv) {
  const { rows: [p] } = await query(`SELECT
      (SELECT COUNT(*)::int FROM aset WHERE skpd_id = $1 AND status NOT IN ('dihapus')) AS total,
      COUNT(DISTINCT p.aset_id)::int AS diperiksa,
      COUNT(DISTINCT p.aset_id) FILTER (WHERE p.sesuai_lokasi = false)::int AS beda_lokasi,
      COUNT(DISTINCT p.aset_id) FILTER (WHERE p.kondisi <> 'B')::int AS rusak
    FROM aset_pemeriksaan p WHERE p.inventarisasi_id = $2`, [inv.skpd_id, inv.id]);
  return { ...p, belum: p.total - p.diperiksa, persen: p.total ? Math.round((p.diperiksa / p.total) * 1000) / 10 : 0 };
}

export default async function asetRoutes(app) {
  app.get('/api/aset/meta', { preHandler: requireAuth }, async () => ({ kondisi: KONDISI, status: STATUS_ASET, kode_barang: KODE_BARANG }));

  app.get('/api/aset', { preHandler: requireAuth }, async (req, reply) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD');
    const p = [skpd]; const w = ['a.skpd_id = $1'];
    if (req.query.status) { p.push(req.query.status); w.push(`a.status = $${p.length}`); } else w.push("a.status <> 'dihapus'");
    if (KONDISI[req.query.kondisi]) { p.push(req.query.kondisi); w.push(`a.kondisi = $${p.length}`); }
    if (req.query.lokasi) { p.push(req.query.lokasi); w.push(`a.lokasi = $${p.length}`); }
    if (req.query.kode) { p.push(`${req.query.kode}%`); w.push(`a.kode_barang LIKE $${p.length}`); }
    if (req.query.q) { p.push(`%${String(req.query.q).slice(0, 80)}%`); w.push(`(a.nama ILIKE $${p.length} OR a.merk_tipe ILIKE $${p.length} OR a.kode_barang ILIKE $${p.length} OR a.nomor_seri ILIKE $${p.length} OR a.lokasi ILIKE $${p.length})`); }
    if (req.query.diperiksa === 'belum') w.push("(a.terakhir_diperiksa IS NULL OR a.terakhir_diperiksa < now() - interval '1 year')");
    if (req.query.format === 'xlsx') {
      const { rows } = await query(`SELECT ${KOLOM} ${DARI} WHERE ${w.join(' AND ')} ORDER BY a.kode_barang, a.nup`, p);
      const buf = await buildWorkbook({
        title: `DAFTAR ASET (KARTU INVENTARIS BARANG) - ${rows[0]?.skpd_nama?.toUpperCase() || ''}`, subtitle: `Dicetak ${new Date().toLocaleDateString('id-ID')} · ${rows.length} aset`, sheetName: 'Aset',
        columns: [{ key: 'kode_barang', header: 'Kode Barang', width: 20 }, { key: 'nup', header: 'NUP', width: 6 }, { key: 'nama', header: 'Nama Barang', width: 34 },
          { key: 'merk_tipe', header: 'Merk/Tipe', width: 22 }, { key: 'tahun_perolehan', header: 'Tahun', width: 8 }, { key: 'harga_perolehan', header: 'Harga Perolehan', type: 'money' },
          { key: 'lokasi', header: 'Lokasi', width: 24 }, { key: 'kondisi_label', header: 'Kondisi', width: 14 }, { key: 'status_label', header: 'Status', width: 14 },
          { key: 'diperiksa', header: 'Terakhir Diperiksa', width: 18 }, { key: 'kode_qr', header: 'Kode QR', width: 16 }],
        rows: rows.map((r) => ({ ...r, harga_perolehan: Number(r.harga_perolehan), kondisi_label: KONDISI[r.kondisi], status_label: STATUS_ASET[r.status], diperiksa: r.terakhir_diperiksa ? new Date(r.terakhir_diperiksa).toLocaleDateString('id-ID') : '-' })),
        totals: { harga_perolehan: rows.reduce((s, r) => s + Number(r.harga_perolehan), 0) },
      });
      return sendFile(reply, buf, 'daftar-aset.xlsx', XLSX);
    }
    const limit = Math.min(int(req.query.limit, 25), 500);
    const page = Math.max(int(req.query.page, 1), 1);
    const [{ rows }, ringkasan, { rows: lokasi }] = await Promise.all([
      query(`SELECT ${KOLOM}, COUNT(*) OVER()::int AS total ${DARI} WHERE ${w.join(' AND ')} ORDER BY a.kode_barang, a.nup LIMIT ${limit} OFFSET ${(page - 1) * limit}`, p),
      ringkasanAset(skpd),
      query("SELECT lokasi, COUNT(*)::int AS n FROM aset WHERE skpd_id = $1 AND status <> 'dihapus' AND lokasi IS NOT NULL GROUP BY 1 ORDER BY 1", [skpd]),
    ]);
    return { rows, total: rows[0]?.total || 0, page, limit, ringkasan, lokasi };
  });

  // Detail aset dari hasil pindai QR (perlu login: menampilkan harga & riwayat)
  app.get('/api/aset/qr/:kode', { preHandler: requireAuth }, async (req) => {
    const { rows: [a] } = await query(`SELECT ${KOLOM} ${DARI} WHERE a.kode_qr = $1`, [String(req.params.kode)]);
    if (!a) throw notFound('QR tidak dikenal: aset tidak terdaftar di aplikasi ini');
    if (!['admin', 'pimpinan'].includes(req.user.role) && a.skpd_id !== req.user.skpd_id) throw forbidden('Aset ini milik SKPD lain');
    const { rows: riwayat } = await query(`SELECT p.*, u.full_name AS oleh_nama, i.nama AS inventarisasi_nama FROM aset_pemeriksaan p
      LEFT JOIN users u ON u.id = p.oleh LEFT JOIN inventarisasi i ON i.id = p.inventarisasi_id WHERE p.aset_id = $1 ORDER BY p.waktu DESC LIMIT 20`, [a.id]);
    const { rows: [inv] } = await query("SELECT id, nama FROM inventarisasi WHERE skpd_id = $1 AND status = 'berjalan'", [a.skpd_id]);
    return { aset: a, riwayat, inventarisasi: inv || null, umur_tahun: new Date().getFullYear() - a.tahun_perolehan };
  });

  app.get('/api/aset/:id', { preHandler: requireAuth }, async (req) => {
    const { rows: [a] } = await query(`SELECT ${KOLOM} ${DARI} WHERE a.id = $1`, [int(req.params.id)]);
    if (!a) throw notFound();
    scopeSkpd(req.user, a.skpd_id);
    const { rows: riwayat } = await query(`SELECT p.*, u.full_name AS oleh_nama, i.nama AS inventarisasi_nama FROM aset_pemeriksaan p
      LEFT JOIN users u ON u.id = p.oleh LEFT JOIN inventarisasi i ON i.id = p.inventarisasi_id WHERE p.aset_id = $1 ORDER BY p.waktu DESC LIMIT 50`, [a.id]);
    return { aset: a, riwayat };
  });

  // Halaman publik saat QR dipindai kamera biasa: identitas minimal saja (tanpa harga), untuk konfirmasi label
  app.get('/api/publik/aset/:kode', async (req) => {
    const { rows: [a] } = await query(`SELECT a.kode_barang, a.nup, a.nama, a.merk_tipe, a.tahun_perolehan, a.lokasi, a.kondisi, a.status, s.nama AS skpd_nama
      FROM aset a JOIN skpd s ON s.id = a.skpd_id WHERE a.kode_qr = $1`, [String(req.params.kode)]);
    if (!a) throw notFound('Label QR tidak dikenal');
    return { aset: { ...a, kondisi_label: KONDISI[a.kondisi], status_label: STATUS_ASET[a.status] } };
  });

  // Gambar QR (PNG/SVG) untuk label
  app.get('/api/aset/:id/qr', { preHandler: requireAuth }, async (req, reply) => {
    const { rows: [a] } = await query('SELECT id, skpd_id, kode_qr, kode_barang, nup FROM aset WHERE id = $1', [int(req.params.id)]);
    if (!a) throw notFound();
    scopeSkpd(req.user, a.skpd_id);
    const isi = urlQr(asalPermintaan(req), a.kode_qr);
    if (req.query.format === 'svg') return reply.header('Content-Type', 'image/svg+xml').send(await QRCode.toString(isi, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
    const png = await QRCode.toBuffer(isi, { type: 'png', margin: 1, width: 600, errorCorrectionLevel: 'M' });
    return reply.header('Content-Type', 'image/png').header('Content-Disposition', `inline; filename="qr-${a.kode_barang}-${a.nup}.png"`).send(png);
  });

  // Label siap cetak: data + QR (SVG) untuk banyak aset sekaligus
  app.post('/api/aset/label', { preHandler: requireAuth }, async (req) => {
    const ids = (req.body?.ids || []).map(Number).filter(Boolean).slice(0, 200);
    if (!ids.length) throw bad('Pilih aset yang akan dicetak labelnya');
    const { rows } = await query('SELECT a.id, a.skpd_id, a.kode_barang, a.nup, a.nama, a.tahun_perolehan, a.lokasi, a.kode_qr, s.nama AS skpd_nama FROM aset a JOIN skpd s ON s.id = a.skpd_id WHERE a.id = ANY($1) ORDER BY a.kode_barang, a.nup', [ids]);
    for (const r of rows) scopeSkpd(req.user, r.skpd_id);
    const asal = req.body?.origin && /^https?:\/\/[^\s/]+$/.test(req.body.origin) ? req.body.origin : asalPermintaan(req);
    return { rows: await Promise.all(rows.map(async (r) => ({ ...r, url: urlQr(asal, r.kode_qr), svg: await QRCode.toString(urlQr(asal, r.kode_qr), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }) }))) };
  });

  app.post('/api/aset', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    const skpd = scopeSkpd(req.user, b.skpd_id);
    bolehTulis(req.user, skpd);
    const data = bersihkan(b);
    const jumlah = Math.min(Math.max(int(b.jumlah, 1), 1), 100);
    let bkuId = null;
    if (b.bku_entry_id) {
      const { rows: [e] } = await query("SELECT id, skpd_id, kode_rekening, pengeluaran FROM bku_entries WHERE id = $1 AND jenis = 'BELANJA'", [int(b.bku_entry_id)]);
      if (!e || e.skpd_id !== skpd) throw bad('Transaksi BKU tidak ditemukan pada SKPD ini');
      if (!String(e.kode_rekening).startsWith('5.2')) throw bad('Hanya belanja modal (5.2) yang menghasilkan aset tetap');
      bkuId = e.id;
    }
    return tx(async (c) => {
      const rows = await daftarAset(c, req.user, skpd, data, jumlah, bkuId);
      await audit(c, req.user, 'aset_tambah', 'aset', rows[0].id, { jumlah, nama: data.nama, kode_barang: data.kode_barang }, req.ip);
      return { rows };
    });
  });

  app.put('/api/aset/:id', { preHandler: requireAuth }, async (req) => {
    const id = int(req.params.id);
    const { rows: [a] } = await query('SELECT * FROM aset WHERE id = $1', [id]);
    if (!a) throw notFound();
    bolehTulis(req.user, a.skpd_id);
    if (a.status === 'dihapus') throw bad('Aset yang sudah dihapus dari daftar tidak dapat diubah');
    const b = req.body || {};
    const data = bersihkan({ ...a, ...b });
    const status = b.status && STATUS_ASET[b.status] ? b.status : a.status;
    if (status !== a.status && ['diusulkan_hapus', 'dihapus'].includes(status) && !String(b.alasan || '').trim()) throw bad('Alasan perubahan status wajib diisi');
    if (status === 'dihapus' && req.user.role !== 'admin') throw forbidden('Penghapusan aset dari daftar hanya oleh admin setelah ada SK penghapusan');
    return tx(async (c) => {
      const { rows: [r] } = await c.query(`UPDATE aset SET kode_barang = $2, nama = $3, merk_tipe = $4, spesifikasi = $5, nomor_seri = $6, tahun_perolehan = $7, tanggal_perolehan = $8,
          harga_perolehan = $9, sumber_dana = $10, cara_perolehan = $11, lokasi = $12, penanggung_jawab = $13, kondisi = $14, keterangan = $15, status = $16, diubah_at = now()
        WHERE id = $1 RETURNING *`, [id, data.kode_barang, data.nama, data.merk_tipe, data.spesifikasi, data.nomor_seri, data.tahun_perolehan, data.tanggal_perolehan,
        data.harga_perolehan, data.sumber_dana, data.cara_perolehan, data.lokasi, data.penanggung_jawab, data.kondisi,
        status !== a.status && b.alasan ? [data.keterangan, `Status → ${STATUS_ASET[status]}: ${String(b.alasan).trim()}`].filter(Boolean).join(' | ') : data.keterangan, status]);
      await audit(c, req.user, 'aset_ubah', 'aset', id, { status: status !== a.status ? `${a.status}→${status}` : undefined, alasan: b.alasan || undefined }, req.ip);
      return { row: r };
    });
  });

  // Catat hasil pemeriksaan fisik (dari pemindaian QR atau manual)
  app.post('/api/aset/:id/periksa', { preHandler: requireAuth }, async (req) => {
    const id = int(req.params.id);
    const b = req.body || {};
    const { rows: [a] } = await query('SELECT * FROM aset WHERE id = $1', [id]);
    if (!a) throw notFound();
    if (!['admin', 'pimpinan'].includes(req.user.role) && a.skpd_id !== req.user.skpd_id) throw forbidden('Aset ini milik SKPD lain');
    if (a.status === 'dihapus') throw bad('Aset sudah dihapus dari daftar');
    if (!KONDISI[b.kondisi]) throw bad('Pilih kondisi aset saat diperiksa');
    const lokasi = String(b.lokasi || a.lokasi || '').trim() || null;
    const sesuai = !a.lokasi || !lokasi ? null : a.lokasi.trim().toLowerCase() === lokasi.toLowerCase();
    return tx(async (c) => {
      const { rows: [inv] } = await c.query("SELECT id FROM inventarisasi WHERE skpd_id = $1 AND status = 'berjalan'", [a.skpd_id]);
      const { rows: [p] } = await c.query(`INSERT INTO aset_pemeriksaan (aset_id, inventarisasi_id, kondisi, lokasi, sesuai_lokasi, catatan, cara, oleh) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [id, inv?.id || null, b.kondisi, lokasi, sesuai, String(b.catatan || '').trim() || null, b.cara === 'manual' ? 'manual' : 'qr', req.user.id]);
      // Kondisi terbaru dipakai di daftar aset; lokasi kartu aset diperbarui bila petugas menyatakan aset dipindah
      await c.query(`UPDATE aset SET kondisi = $2, terakhir_diperiksa = now(), lokasi = CASE WHEN $3 THEN $4 ELSE lokasi END, diubah_at = now() WHERE id = $1`,
        [id, b.kondisi, Boolean(b.perbarui_lokasi) && Boolean(lokasi), lokasi]);
      await audit(c, req.user, 'aset_periksa', 'aset', id, { kondisi: b.kondisi, inventarisasi: inv?.id || null }, req.ip);
      return { pemeriksaan: p, inventarisasi_id: inv?.id || null };
    });
  });

  // Belanja modal (5.2) di BKU yang belum didaftarkan sebagai aset
  app.get('/api/aset/kandidat-bku', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const { rows } = await query(`SELECT e.id, e.tanggal, e.no_bukti, e.no_urut, e.uraian, e.kode_rekening, r.nama AS rekening_nama, e.pengeluaran, rk.nama AS rekanan, s.status AS status_persetujuan
      FROM bku_entries e LEFT JOIN rekening r ON r.kode = e.kode_rekening LEFT JOIN rekanan rk ON rk.id = e.rekanan_id LEFT JOIN bku_status s ON s.entry_id = e.id
      WHERE e.skpd_id = $1 AND e.jenis = 'BELANJA' AND e.kode_rekening LIKE '5.2%' AND COALESCE(s.status, '') NOT IN ('ditolak','dikoreksi')
        AND NOT EXISTS (SELECT 1 FROM aset a WHERE a.bku_entry_id = e.id) ORDER BY e.tanggal DESC LIMIT 100`, [skpd]);
    return { rows };
  });

  // Inventarisasi (pemeriksaan fisik berkala)
  app.get('/api/inventarisasi', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const { rows } = await query(`SELECT i.*, u.full_name AS dibuat_nama FROM inventarisasi i LEFT JOIN users u ON u.id = i.dibuat_oleh WHERE i.skpd_id = $1 ORDER BY i.dibuat_at DESC LIMIT 20`, [skpd]);
    const berjalan = rows.find((r) => r.status === 'berjalan');
    return { rows, berjalan: berjalan ? { ...berjalan, progres: await progresInventarisasi(berjalan) } : null };
  });

  app.post('/api/inventarisasi', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    required(b, ['nama']);
    const skpd = scopeSkpd(req.user, b.skpd_id);
    bolehTulis(req.user, skpd);
    return tx(async (c) => {
      const { rows: [r] } = await c.query('INSERT INTO inventarisasi (skpd_id, nama, catatan, dibuat_oleh) VALUES ($1,$2,$3,$4) RETURNING *', [skpd, String(b.nama).trim(), b.catatan || null, req.user.id])
        .catch((e) => { if (e.code === '23505') throw bad('Masih ada inventarisasi yang berjalan. Selesaikan dahulu.'); throw e; });
      await audit(c, req.user, 'inventarisasi_mulai', 'inventarisasi', r.id, { nama: r.nama }, req.ip);
      return { row: r };
    });
  });

  app.get('/api/inventarisasi/:id', { preHandler: requireAuth }, async (req) => {
    const { rows: [inv] } = await query('SELECT * FROM inventarisasi WHERE id = $1', [int(req.params.id)]);
    if (!inv) throw notFound();
    scopeSkpd(req.user, inv.skpd_id);
    const [progres, { rows: hasil }, { rows: belum }] = await Promise.all([
      progresInventarisasi(inv),
      query(`SELECT DISTINCT ON (p.aset_id) p.*, a.kode_barang, a.nup, a.nama, a.lokasi AS lokasi_tercatat, u.full_name AS oleh_nama
        FROM aset_pemeriksaan p JOIN aset a ON a.id = p.aset_id LEFT JOIN users u ON u.id = p.oleh WHERE p.inventarisasi_id = $1 ORDER BY p.aset_id, p.waktu DESC`, [inv.id]),
      query(`SELECT a.id, a.kode_barang, a.nup, a.nama, a.lokasi, a.kondisi FROM aset a WHERE a.skpd_id = $1 AND a.status <> 'dihapus'
        AND NOT EXISTS (SELECT 1 FROM aset_pemeriksaan p WHERE p.aset_id = a.id AND p.inventarisasi_id = $2) ORDER BY a.lokasi NULLS LAST, a.kode_barang, a.nup LIMIT 300`, [inv.skpd_id, inv.id]),
    ]);
    return { inventarisasi: inv, progres, hasil: hasil.sort((x, y) => String(y.waktu).localeCompare(String(x.waktu))), belum };
  });

  app.post('/api/inventarisasi/:id/selesai', { preHandler: requireAuth }, async (req) => {
    const { rows: [inv] } = await query('SELECT * FROM inventarisasi WHERE id = $1', [int(req.params.id)]);
    if (!inv) throw notFound();
    bolehTulis(req.user, inv.skpd_id);
    if (inv.status === 'selesai') throw bad('Inventarisasi sudah selesai');
    const progres = await progresInventarisasi(inv);
    return tx(async (c) => {
      const { rows: [r] } = await c.query("UPDATE inventarisasi SET status = 'selesai', tanggal_selesai = current_date, ringkasan = $2 WHERE id = $1 RETURNING *", [inv.id, progres]);
      await audit(c, req.user, 'inventarisasi_selesai', 'inventarisasi', inv.id, progres, req.ip);
      return { row: r };
    });
  });
}
