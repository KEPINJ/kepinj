// Notifikasi tersimpan (pusat notifikasi): peristiwa yang perlu diketahui pengguna walaupun terjadi saat ia tidak membuka aplikasi.
import { emit } from '../db.js';

/**
 * Simpan notifikasi untuk satu pengguna (user_id) atau semua pengguna berperan tertentu pada satu SKPD.
 * kategori: persetujuan | dokumen | rekonsiliasi | anggaran | kas | keamanan | sistem
 */
export async function kirimNotifikasi(c, { skpd_id = null, user_id = null, peran = null, kategori, tingkat = 'info', judul, pesan = null, link = null, ref = null }) {
  const { rows: [n] } = await c.query(`INSERT INTO notifikasi (skpd_id, user_id, peran, kategori, tingkat, judul, pesan, link, ref)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`, [skpd_id, user_id, peran, kategori, tingkat, String(judul).slice(0, 200), pesan, link, ref]);
  await emit(c, 'notifikasi.baru', String(skpd_id ?? 0), { skpd_id, user_id, peran, kategori, tingkat, judul, id: n.id });
  return n;
}

/** Filter SQL notifikasi yang ditujukan kepada pengguna (parameter: $1 user id, $2 peran, $3 skpd terpilih). */
export const UNTUK_PENGGUNA = `(n.user_id = $1 OR (n.user_id IS NULL AND (n.peran IS NULL OR $2 = ANY(n.peran))
  AND (n.skpd_id IS NULL OR n.skpd_id = $3)))`;
