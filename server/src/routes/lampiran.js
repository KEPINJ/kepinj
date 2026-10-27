// Lampiran bukti digital (foto nota, kuitansi, faktur PDF) per transaksi BKU
import { createHash } from 'node:crypto';
import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, notFound, int, scopeSkpd, canWrite } from '../lib/http.js';

const MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAKS = 5 * 1024 * 1024;

async function entri(id) {
  const { rows: [e] } = await query('SELECT id, skpd_id, tanggal FROM bku_entries WHERE id = $1', [int(id)]);
  if (!e) throw notFound('Transaksi tidak ditemukan');
  return e;
}

export default async function lampiranRoutes(app) {
  app.get('/api/bku/:id/lampiran', { preHandler: requireAuth }, async (req) => {
    const e = await entri(req.params.id);
    scopeSkpd(req.user, e.skpd_id);
    const { rows } = await query(`SELECT l.id, l.nama_file, l.mime, l.ukuran, l.sha256, l.keterangan, l.created_at, u.full_name AS diunggah_oleh
      FROM lampiran l LEFT JOIN users u ON u.id = l.uploaded_by WHERE l.bku_entry_id = $1 ORDER BY l.id`, [e.id]);
    return { rows };
  });

  app.post('/api/bku/:id/lampiran', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const e = await entri(req.params.id);
    canWrite(req.user, e.skpd_id);
    const file = await req.file();
    if (!file) throw bad('File belum dipilih');
    if (!MIME.includes(file.mimetype)) throw bad('Format lampiran harus JPG, PNG, WEBP atau PDF');
    const buf = await file.toBuffer();
    if (buf.length > MAKS) throw bad('Ukuran lampiran maksimal 5 MB');
    const sha = createHash('sha256').update(buf).digest('hex');
    return tx(async (c) => {
      const { rows: [dup] } = await c.query('SELECT id FROM lampiran WHERE bku_entry_id = $1 AND sha256 = $2', [e.id, sha]);
      if (dup) throw bad('File yang sama sudah dilampirkan pada transaksi ini');
      const ket = file.fields?.keterangan?.value || null;
      const { rows: [r] } = await c.query(`INSERT INTO lampiran (bku_entry_id, skpd_id, nama_file, mime, ukuran, sha256, data, keterangan, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, nama_file, mime, ukuran, sha256, keterangan, created_at`,
      [e.id, e.skpd_id, String(file.filename).slice(0, 200), file.mimetype, buf.length, sha, buf, ket, req.user.id]);
      await audit(c, req.user, 'lampiran_tambah', 'bku', e.id, { file: r.nama_file, sha256: sha }, req.ip);
      await emit(c, 'lampiran.updated', String(e.skpd_id), { skpd_id: e.skpd_id, entry_id: e.id });
      return { row: r };
    });
  });

  app.get('/api/lampiran/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { rows: [l] } = await query('SELECT * FROM lampiran WHERE id = $1', [int(req.params.id)]);
    if (!l) throw notFound('Lampiran tidak ditemukan');
    scopeSkpd(req.user, l.skpd_id);
    return reply.header('Content-Type', l.mime).header('Cache-Control', 'private, max-age=3600')
      .header('Content-Disposition', `${req.query.unduh ? 'attachment' : 'inline'}; filename="${encodeURIComponent(l.nama_file)}"`).send(l.data);
  });

  app.delete('/api/lampiran/:id', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    return tx(async (c) => {
      const { rows: [l] } = await c.query('SELECT l.id, l.skpd_id, l.bku_entry_id, l.nama_file, e.tanggal FROM lampiran l JOIN bku_entries e ON e.id = l.bku_entry_id WHERE l.id = $1', [int(req.params.id)]);
      if (!l) throw notFound('Lampiran tidak ditemukan');
      canWrite(req.user, l.skpd_id);
      const { rows: kunci } = await c.query('SELECT 1 FROM periode_kunci WHERE skpd_id = $1 AND tahun = $2 AND bulan = $3',
        [l.skpd_id, Number(l.tanggal.slice(0, 4)), Number(l.tanggal.slice(5, 7))]);
      if (kunci.length) throw bad('Lampiran transaksi pada bulan yang sudah ditutup buku tidak dapat dihapus');
      await c.query('DELETE FROM lampiran WHERE id = $1', [l.id]);
      await audit(c, req.user, 'lampiran_hapus', 'bku', l.bku_entry_id, { file: l.nama_file }, req.ip);
      await emit(c, 'lampiran.updated', String(l.skpd_id), { skpd_id: l.skpd_id, entry_id: l.bku_entry_id });
      return { ok: true };
    });
  });
}
