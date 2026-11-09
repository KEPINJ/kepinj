// Manajemen dokumen & bukti transaksi BKU: unggah (PDF/JPG/PNG), pratinjau, unduh, riwayat, status kelengkapan.
// Berkas disimpan di basis data (bukan folder publik), divalidasi dari isinya, bersidik SHA-256, dan
// tidak pernah dihapus permanen; dokumen transaksi yang sudah disetujui terkunci.
import { createHash } from 'node:crypto';
import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, notFound, int, scopeSkpd, canWrite, forbidden } from '../lib/http.js';
import { getPengaturan } from '../lib/pengaturan.js';
import { hitungKelengkapan } from '../lib/statusbku.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { JENIS_DOKUMEN, ATURAN_DOKUMEN, dokumenWajib, kenaliBerkas, namaBerkasAman } from '../../../shared/dokumen.js';
import { JENIS_BKU } from '../lib/ledger.js';

const EKSTENSI = { 'application/pdf': ['pdf'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'] };

async function entri(id) {
  const { rows: [e] } = await query(`SELECT e.id, e.skpd_id, e.tahun, e.tanggal, e.jenis, e.metode, e.kode_rekening, e.no_urut, s.status, s.dokumen_status, s.dokumen_kurang,
      EXISTS (SELECT 1 FROM bku_status c WHERE c.induk_id = e.id) AS ada_pajak
    FROM bku_entries e LEFT JOIN bku_status s ON s.entry_id = e.id WHERE e.id = $1`, [int(id)]);
  if (!e) throw notFound('Transaksi tidak ditemukan');
  return e;
}

/** Validasi berkas unggahan: jenis dari isi berkas (magic bytes), ekstensi cocok, ukuran dalam batas. */
export function validasiBerkas(buf, namaFile, maksMb) {
  if (!buf?.length) throw bad('Berkas kosong');
  if (buf.length > maksMb * 1024 * 1024) throw bad(`Ukuran dokumen maksimal ${maksMb} MB`);
  const jenis = kenaliBerkas(buf);
  if (!jenis) throw bad('Format dokumen harus PDF, JPG atau PNG (isi berkas tidak dikenali)');
  const ext = String(namaFile).toLowerCase().split('.').pop();
  if (!EKSTENSI[jenis.mime].includes(ext)) throw bad(`Ekstensi .${ext} tidak sesuai dengan isi berkas (${jenis.mime})`);
  if (jenis.mime === 'application/pdf' && /\/JavaScript|\/JS\s|\/Launch|\/EmbeddedFile/.test(buf.toString('latin1'))) {
    throw bad('PDF mengandung skrip, aksi otomatis atau berkas sisipan; simpan ulang sebagai PDF biasa');
  }
  return jenis.mime;
}

daftarNotifikasi(async ({ user, skpd, tahun }) => {
  if (!['admin', 'bendahara', 'verifikator'].includes(user.role)) return [];
  const { rows: [r] } = await query(`SELECT COUNT(*) FILTER (WHERE dokumen_status IN ('sebagian','belum'))::int AS kurang,
      COUNT(*) FILTER (WHERE dokumen_status IN ('sebagian','belum') AND status = 'menunggu')::int AS menunggu
    FROM bku_status WHERE skpd_id = $1 AND tahun = $2 AND induk_id IS NULL AND status <> 'dikoreksi'`, [skpd, tahun]);
  if (!r.menunggu) return [];
  return [{ id: `dokumen-${r.menunggu}`, tipe: 'dokumen', kategori: 'dokumen', tingkat: 'peringatan', judul: `${r.menunggu.toLocaleString('id-ID')} transaksi menunggu persetujuan dengan dokumen belum lengkap`,
    pesan: `Transaksi ini tidak dapat disetujui sebelum bukti wajib diunggah. Total ${r.kurang.toLocaleString('id-ID')} transaksi tahun ${tahun} belum lengkap dokumennya.`,
    link: '/bukti?kelengkapan=kurang&status=menunggu', tanggal: null }];
});

export default async function lampiranRoutes(app) {
  app.get('/api/bukti/meta', { preHandler: requireAuth }, async () => {
    const cfg = await getPengaturan();
    return { jenis: JENIS_DOKUMEN, aturan: cfg.aturan_dokumen || ATURAN_DOKUMEN, maks_mb: cfg.lampiran_maks_mb, format: ['PDF', 'JPG', 'PNG'], jenis_bku: JENIS_BKU };
  });

  app.get('/api/bku/:id/lampiran', { preHandler: requireAuth }, async (req) => {
    const e = await entri(req.params.id);
    scopeSkpd(req.user, e.skpd_id);
    const cfg = await getPengaturan();
    const [{ rows }, { rows: riwayat }] = await Promise.all([
      query(`SELECT l.id, l.nama_file, l.mime, l.ukuran, l.sha256, l.keterangan, l.jenis_dokumen, l.nomor_dokumen, l.tanggal_dokumen, l.created_at,
          l.dihapus_at, l.alasan_hapus, u.full_name AS diunggah_oleh, d.full_name AS dihapus_oleh_nama
        FROM lampiran l LEFT JOIN users u ON u.id = l.uploaded_by LEFT JOIN users d ON d.id = l.dihapus_oleh WHERE l.bku_entry_id = $1 ORDER BY l.id`, [e.id]),
      query(`SELECT r.*, u.full_name AS oleh_nama FROM lampiran_riwayat r LEFT JOIN users u ON u.id = r.oleh WHERE r.bku_entry_id = $1 ORDER BY r.waktu DESC LIMIT 50`, [e.id]),
    ]);
    const wajib = dokumenWajib(e, { adaPajak: e.ada_pajak }, cfg.aturan_dokumen);
    return {
      rows: rows.filter((r) => !r.dihapus_at), dihapus: rows.filter((r) => r.dihapus_at), riwayat,
      kelengkapan: { status: e.dokumen_status, kurang: e.dokumen_kurang || [], wajib },
      terkunci: e.status === 'disetujui', maks_mb: cfg.lampiran_maks_mb,
    };
  });

  app.post('/api/bku/:id/lampiran', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const e = await entri(req.params.id);
    canWrite(req.user, e.skpd_id);
    if (e.status === 'dikoreksi') throw bad('Transaksi sudah dikoreksi; lampirkan bukti pada transaksi koreksinya');
    const cfg = await getPengaturan();
    const file = await req.file();
    if (!file) throw bad('File belum dipilih');
    const buf = await file.toBuffer();
    const mime = validasiBerkas(buf, file.filename, Number(cfg.lampiran_maks_mb) || 5);
    const f = (k) => file.fields?.[k]?.value || null;
    const jenisDok = f('jenis_dokumen') || 'bukti_transaksi';
    if (!JENIS_DOKUMEN[jenisDok]) throw bad('Jenis dokumen tidak dikenal');
    const tglDok = f('tanggal_dokumen');
    if (tglDok && !/^\d{4}-\d{2}-\d{2}$/.test(tglDok)) throw bad('Tanggal dokumen tidak valid');
    const sha = createHash('sha256').update(buf).digest('hex');
    const nama = namaBerkasAman(file.filename);
    return tx(async (c) => {
      const { rows: [dup] } = await c.query('SELECT id FROM lampiran WHERE bku_entry_id = $1 AND sha256 = $2 AND dihapus_at IS NULL', [e.id, sha]);
      if (dup) throw bad('File yang sama sudah dilampirkan pada transaksi ini');
      const { rows: [r] } = await c.query(`INSERT INTO lampiran (bku_entry_id, skpd_id, nama_file, mime, ukuran, sha256, data, keterangan, uploaded_by, jenis_dokumen, nomor_dokumen, tanggal_dokumen)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, nama_file, mime, ukuran, sha256, keterangan, jenis_dokumen, nomor_dokumen, tanggal_dokumen, created_at`,
      [e.id, e.skpd_id, nama, mime, buf.length, sha, buf, f('keterangan'), req.user.id, jenisDok, f('nomor_dokumen'), tglDok]);
      await c.query('INSERT INTO lampiran_riwayat (lampiran_id, bku_entry_id, skpd_id, aksi, nama_file, jenis_dokumen, oleh, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [r.id, e.id, e.skpd_id, 'unggah', nama, jenisDok, req.user.id, req.ip]);
      await hitungKelengkapan(c, [e.id], cfg);
      await audit(c, req.user, 'lampiran_tambah', 'bku', e.id, { file: r.nama_file, jenis: jenisDok, sha256: sha }, req.ip);
      await emit(c, 'lampiran.updated', String(e.skpd_id), { skpd_id: e.skpd_id, entry_id: e.id });
      const { rows: [k] } = await c.query('SELECT dokumen_status, dokumen_kurang FROM bku_status WHERE entry_id = $1', [e.id]);
      return { row: r, kelengkapan: k };
    });
  });

  // Pratinjau (inline) / unduh. Sidik SHA-256 diperiksa ulang agar berkas yang rusak/diubah di basis data terdeteksi.
  app.get('/api/lampiran/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { rows: [l] } = await query('SELECT * FROM lampiran WHERE id = $1', [int(req.params.id)]);
    if (!l) throw notFound('Lampiran tidak ditemukan');
    scopeSkpd(req.user, l.skpd_id);
    if (createHash('sha256').update(l.data).digest('hex') !== l.sha256) throw bad('Integritas berkas gagal: isi berkas tidak cocok dengan sidik saat diunggah');
    const unduh = Boolean(req.query.unduh);
    if (unduh) {
      await tx((c) => c.query('INSERT INTO lampiran_riwayat (lampiran_id, bku_entry_id, skpd_id, aksi, nama_file, jenis_dokumen, oleh, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [l.id, l.bku_entry_id, l.skpd_id, 'unduh', l.nama_file, l.jenis_dokumen, req.user.id, req.ip]));
    }
    // Gambar dikirim dengan CSP sandbox; PDF tidak (penampil PDF browser menolak dokumen ber-sandbox), cukup nosniff + MIME tervalidasi
    if (l.mime !== 'application/pdf') reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; sandbox");
    return reply.header('Content-Type', l.mime).header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `${unduh ? 'attachment' : 'inline'}; filename="${encodeURIComponent(l.nama_file)}"; filename*=UTF-8''${encodeURIComponent(l.nama_file)}`)
      .send(l.data);
  });

  // Hapus = tandai dihapus beserta alasan; berkas tetap tersimpan untuk jejak pemeriksaan
  app.delete('/api/lampiran/:id', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    return tx(async (c) => {
      const { rows: [l] } = await c.query(`SELECT l.id, l.skpd_id, l.bku_entry_id, l.nama_file, l.jenis_dokumen, l.dihapus_at, e.tanggal, s.status
        FROM lampiran l JOIN bku_entries e ON e.id = l.bku_entry_id LEFT JOIN bku_status s ON s.entry_id = l.bku_entry_id WHERE l.id = $1`, [int(req.params.id)]);
      if (!l) throw notFound('Lampiran tidak ditemukan');
      canWrite(req.user, l.skpd_id);
      if (l.dihapus_at) throw bad('Lampiran sudah dihapus');
      if (l.status === 'disetujui') throw forbidden('Transaksi sudah disetujui: dokumen bukti terkunci dan tidak dapat dihapus');
      const { rows: kunci } = await c.query('SELECT 1 FROM periode_kunci WHERE skpd_id = $1 AND tahun = $2 AND bulan = $3',
        [l.skpd_id, Number(l.tanggal.slice(0, 4)), Number(l.tanggal.slice(5, 7))]);
      if (kunci.length) throw bad('Lampiran transaksi pada bulan yang sudah ditutup buku tidak dapat dihapus');
      const alasan = String(req.query.alasan || req.body?.alasan || '').trim() || 'Dihapus oleh pengunggah';
      await c.query('UPDATE lampiran SET dihapus_at = now(), dihapus_oleh = $2, alasan_hapus = $3 WHERE id = $1', [l.id, req.user.id, alasan]);
      await c.query('INSERT INTO lampiran_riwayat (lampiran_id, bku_entry_id, skpd_id, aksi, nama_file, jenis_dokumen, catatan, oleh, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [l.id, l.bku_entry_id, l.skpd_id, 'hapus', l.nama_file, l.jenis_dokumen, alasan, req.user.id, req.ip]);
      await hitungKelengkapan(c, [l.bku_entry_id]);
      await audit(c, req.user, 'lampiran_hapus', 'bku', l.bku_entry_id, { file: l.nama_file, alasan }, req.ip);
      await emit(c, 'lampiran.updated', String(l.skpd_id), { skpd_id: l.skpd_id, entry_id: l.bku_entry_id });
      return { ok: true };
    });
  });

  // Daftar transaksi beserta kelengkapan dokumennya (halaman Manajemen Dokumen)
  app.get('/api/bukti', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const p = [skpd, tahun]; const where = ['s.skpd_id = $1', 's.tahun = $2', 's.induk_id IS NULL'];
    const k = req.query.kelengkapan;
    if (k === 'kurang') where.push("s.dokumen_status IN ('sebagian','belum')");
    else if (['lengkap', 'sebagian', 'belum', 'tidak_wajib'].includes(k)) { p.push(k); where.push(`s.dokumen_status = $${p.length}`); }
    if (req.query.status) { p.push(req.query.status); where.push(`s.status = $${p.length}`); }
    if (req.query.bulan) { p.push(int(req.query.bulan)); where.push(`EXTRACT(MONTH FROM e.tanggal) = $${p.length}`); }
    if (req.query.jenis) { p.push(req.query.jenis); where.push(`e.jenis = $${p.length}`); }
    if (req.query.kurang) { p.push(req.query.kurang); where.push(`$${p.length} = ANY(s.dokumen_kurang)`); }
    if (req.query.q) { p.push(`%${req.query.q}%`); where.push(`(e.uraian ILIKE $${p.length} OR e.no_bukti ILIKE $${p.length})`); }
    const pageSize = Math.min(int(req.query.pageSize, 25), 200);
    const page = Math.max(int(req.query.page, 1), 1);
    const [{ rows }, { rows: [ring] }, { rows: perJenis }] = await Promise.all([
      query(`SELECT e.id, e.no_urut, e.tanggal, e.no_bukti, e.jenis, e.uraian, e.metode, e.kode_rekening, e.penerimaan, e.pengeluaran,
          s.status, s.dokumen_status, s.dokumen_kurang,
          COALESCE((SELECT json_agg(json_build_object('id', l.id, 'jenis', l.jenis_dokumen, 'nama', l.nama_file, 'mime', l.mime) ORDER BY l.id)
            FROM lampiran l WHERE l.bku_entry_id = e.id AND l.dihapus_at IS NULL), '[]') AS dokumen,
          COUNT(*) OVER () AS total_rows
        FROM bku_status s JOIN bku_entries e ON e.id = s.entry_id AND e.skpd_id = s.skpd_id AND e.tahun = s.tahun
        WHERE ${where.join(' AND ')} ORDER BY e.tanggal DESC, e.no_urut DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, p),
      query(`SELECT COUNT(*)::int AS transaksi, COUNT(*) FILTER (WHERE dokumen_status = 'lengkap')::int AS lengkap,
          COUNT(*) FILTER (WHERE dokumen_status = 'sebagian')::int AS sebagian, COUNT(*) FILTER (WHERE dokumen_status = 'belum')::int AS belum,
          COUNT(*) FILTER (WHERE dokumen_status = 'tidak_wajib')::int AS tidak_wajib,
          (SELECT COUNT(*)::int FROM lampiran l WHERE l.skpd_id = $1 AND l.dihapus_at IS NULL AND EXTRACT(YEAR FROM l.created_at) >= $2 - 1) AS berkas,
          (SELECT COALESCE(SUM(l.ukuran),0)::bigint FROM lampiran l WHERE l.skpd_id = $1 AND l.dihapus_at IS NULL) AS ukuran
        FROM bku_status WHERE skpd_id = $1 AND tahun = $2 AND induk_id IS NULL AND status <> 'dikoreksi'`, [skpd, tahun]),
      query(`SELECT k AS jenis, COUNT(*)::int AS jumlah FROM bku_status, unnest(dokumen_kurang) k
        WHERE skpd_id = $1 AND tahun = $2 AND induk_id IS NULL AND status <> 'dikoreksi' GROUP BY 1 ORDER BY 2 DESC`, [skpd, tahun]),
    ]);
    const total = rows[0]?.total_rows ?? 0;
    const wajibDinilai = ring.transaksi - ring.tidak_wajib;
    return {
      rows: rows.map(({ total_rows: _, ...r }) => r), total, page, pageSize,
      ringkasan: { ...ring, persen_lengkap: wajibDinilai ? Math.round((ring.lengkap / wajibDinilai) * 1000) / 10 : 100 },
      kurang_per_jenis: perJenis,
    };
  });

  // Riwayat unggahan / penghapusan / unduhan dokumen untuk satu SKPD
  app.get('/api/bukti/riwayat', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const { rows } = await query(`SELECT r.*, u.full_name AS oleh_nama, e.no_urut, e.uraian FROM lampiran_riwayat r
      LEFT JOIN users u ON u.id = r.oleh LEFT JOIN bku_entries e ON e.id = r.bku_entry_id
      WHERE r.skpd_id = $1 ${req.query.aksi ? 'AND r.aksi = $3' : ''} ORDER BY r.waktu DESC LIMIT $2`,
    [skpd, Math.min(int(req.query.limit, 100), 500), ...(req.query.aksi ? [req.query.aksi] : [])]);
    return { rows };
  });
}
