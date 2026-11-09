// Pusat notifikasi (lonceng di topbar) dan monitoring aktivitas.
// Dua sumber digabung:
//   1. Notifikasi terhitung: kondisi yang masih berlaku saat ini (transaksi menunggu verifikasi, dokumen belum lengkap,
//      pagu mendekati batas, penutupan kas belum dilakukan, ...). Hilang dengan sendirinya setelah ditindaklanjuti.
//   2. Notifikasi tersimpan (tabel notifikasi): peristiwa sekali-terjadi yang tetap perlu diketahui walau pengguna
//      sedang tidak membuka aplikasi (transaksi ditolak, selisih rekonsiliasi, login mencurigakan, uji pemulihan gagal).
// Status "sudah dibaca" disimpan per pengguna di server (notifikasi_baca), sehingga konsisten antarperangkat.
import { query, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, int, scopeSkpd } from '../lib/http.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { UNTUK_PENGGUNA } from '../lib/kirimnotif.js';
import { kumpulkanNotifikasi } from './pengingat.js';
import { hariIni, NAMA_BULAN } from '../lib/kalender.js';

export const KATEGORI = {
  persetujuan: 'Persetujuan', dokumen: 'Dokumen', rekonsiliasi: 'Rekonsiliasi', anggaran: 'Anggaran', kas: 'Kas & tutup buku',
  pajak: 'Pajak', akuntansi: 'Akuntansi', keamanan: 'Keamanan', sistem: 'Sistem', tugas: 'Tugas lain',
};
const KATEGORI_TIPE = { verifikasi: 'persetujuan', persetujuan: 'persetujuan', dokumen: 'dokumen', rekonsiliasi: 'rekonsiliasi', anggaran: 'anggaran',
  tutup_buku: 'kas', kas: 'kas', pajak: 'pajak', akuntansi: 'akuntansi', anomali: 'anggaran', gu: 'kas', panjar: 'kas', pembantu: 'tugas', penerimaan: 'kas' };

// Penutupan kas akhir bulan belum dilakukan
daftarNotifikasi(async ({ user, skpd, tahun }) => {
  if (!['admin', 'bendahara', 'verifikator', 'pimpinan'].includes(user.role)) return [];
  const now = new Date();
  if (now.getFullYear() < tahun) return [];
  const bulanLalu = now.getFullYear() > tahun ? 12 : now.getMonth();   // bulan terakhir yang sudah berakhir
  if (!bulanLalu) return [];
  const akhir = new Date(Date.UTC(tahun, bulanLalu, 0)).toISOString().slice(0, 10);
  const { rows: [r] } = await query(`SELECT MAX(tanggal)::text AS terakhir,
      EXISTS (SELECT 1 FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND tanggal <= $3) AS ada_transaksi
    FROM penutupan_kas WHERE skpd_id = $1 AND EXTRACT(YEAR FROM tanggal) = $2`, [skpd, tahun, akhir]);
  if (!r.ada_transaksi || (r.terakhir && r.terakhir >= akhir)) return [];
  const bulanTerakhir = r.terakhir ? Number(r.terakhir.slice(5, 7)) : 0;
  const belum = bulanLalu - bulanTerakhir;
  return [{ id: `kas-${tahun}-${bulanLalu}-${r.terakhir || 'x'}`, tipe: 'kas', kategori: 'kas', tingkat: belum > 1 ? 'bahaya' : 'peringatan',
    judul: `Penutupan kas ${NAMA_BULAN[bulanLalu - 1]} ${tahun} belum dilakukan`,
    pesan: r.terakhir ? `Penutupan kas terakhir ${r.terakhir.split('-').reverse().join('/')}${belum > 1 ? ` (${belum} bulan tertinggal)` : ''}. Hitung kas tunai dan cocokkan saldo bank pada akhir bulan.`
      : 'Belum ada berita acara penutupan kas tahun ini. Hitung kas tunai dan cocokkan saldo bank pada akhir bulan.',
    link: '/penutupan-kas', tanggal: akhir }];
});

/** Notifikasi gabungan untuk pengguna pada satu SKPD/tahun, lengkap dengan status dibaca. */
export async function notifikasiPengguna(user, skpd, tahun, { batasTersimpan = 30 } = {}) {
  const [hitung, { rows: simpan }] = await Promise.all([
    skpd ? kumpulkanNotifikasi(user, skpd, tahun) : [],
    query(`SELECT n.* FROM notifikasi n WHERE ${UNTUK_PENGGUNA} AND n.created_at > now() - interval '60 days' ORDER BY n.created_at DESC LIMIT ${batasTersimpan}`,
      [user.id, user.role, skpd || null]),
  ]);
  const items = [
    ...hitung.map((i) => ({ ...i, kunci: `h:${i.id}`, sumber: 'kondisi', kategori: i.kategori || KATEGORI_TIPE[i.tipe] || 'tugas' })),
    ...simpan.map((n) => ({ id: `n${n.id}`, kunci: `n:${n.id}`, sumber: 'peristiwa', kategori: n.kategori, tingkat: n.tingkat, judul: n.judul, pesan: n.pesan, link: n.link,
      tanggal: n.created_at, waktu: n.created_at })),
  ];
  const { rows: baca } = items.length
    ? await query('SELECT kunci FROM notifikasi_baca WHERE user_id = $1 AND kunci = ANY($2)', [user.id, items.map((i) => i.kunci)])
    : { rows: [] };
  const sudah = new Set(baca.map((b) => b.kunci));
  const urut = { bahaya: 0, peringatan: 1, info: 2, sukses: 3 };
  for (const i of items) i.dibaca = sudah.has(i.kunci);
  items.sort((a, b) => Number(a.dibaca) - Number(b.dibaca) || (urut[a.tingkat] ?? 9) - (urut[b.tingkat] ?? 9) || String(b.waktu || '').localeCompare(String(a.waktu || '')));
  const perKategori = {};
  for (const i of items) perKategori[i.kategori] = (perKategori[i.kategori] || 0) + (i.dibaca ? 0 : 1);
  return { items, belum_dibaca: items.filter((i) => !i.dibaca).length, per_kategori: perKategori, kategori: KATEGORI };
}

export default async function notifikasiRoutes(app) {
  app.get('/api/notifikasi', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    return notifikasiPengguna(req.user, skpd, int(req.query.tahun, new Date().getFullYear()));
  });

  app.post('/api/notifikasi/baca', { preHandler: requireAuth }, async (req) => {
    const kunci = [...new Set((req.body?.kunci || []).map(String))].filter((k) => /^[hn]:/.test(k) && k.length <= 200).slice(0, 500);
    if (!kunci.length) throw bad('Tidak ada notifikasi dipilih');
    await query(`INSERT INTO notifikasi_baca (user_id, kunci) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [req.user.id, kunci]);
    return { ok: true, dibaca: kunci.length };
  });

  app.post('/api/notifikasi/baca-semua', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.body?.skpd_id);
    const { items } = await notifikasiPengguna(req.user, skpd, int(req.body?.tahun, new Date().getFullYear()), { batasTersimpan: 200 });
    const kunci = items.filter((i) => !i.dibaca).map((i) => i.kunci);
    if (kunci.length) await query(`INSERT INTO notifikasi_baca (user_id, kunci) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [req.user.id, kunci]);
    return { ok: true, dibaca: kunci.length };
  });

  // Riwayat notifikasi tersimpan (peristiwa), dengan filter kategori
  app.get('/api/notifikasi/riwayat', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const limit = Math.min(int(req.query.limit, 50), 200);
    const page = Math.max(int(req.query.page, 1), 1);
    const p = [req.user.id, req.user.role, skpd || null];
    let w = UNTUK_PENGGUNA;
    if (req.query.kategori && KATEGORI[req.query.kategori]) { p.push(req.query.kategori); w += ` AND n.kategori = $${p.length}`; }
    const { rows } = await query(`SELECT n.*, (b.kunci IS NOT NULL) AS dibaca, COUNT(*) OVER()::int AS total FROM notifikasi n
      LEFT JOIN notifikasi_baca b ON b.user_id = $1 AND b.kunci = 'n:' || n.id
      WHERE ${w} ORDER BY n.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, p);
    return { rows, total: rows[0]?.total || 0, page, limit };
  });

  // Monitoring aktivitas: login, sesi aktif, percobaan gagal, aktivitas per pengguna, perubahan data terbaru
  app.get('/api/monitoring-aktivitas', { preHandler: requireRole('admin', 'pimpinan') }, async (req) => {
    const hari = Math.min(Math.max(int(req.query.hari, 7), 1), 90);
    const [harian, sesi, gagal, perPengguna, aksi, terbaru, kunci] = await Promise.all([
      query(`SELECT to_char(d, 'YYYY-MM-DD') AS tanggal,
          COUNT(a.id) FILTER (WHERE a.action = 'login')::int AS login, COUNT(a.id) FILTER (WHERE a.action = 'login_gagal')::int AS gagal,
          COUNT(a.id) FILTER (WHERE a.action NOT IN ('login','login_gagal','logout'))::int AS aktivitas
        FROM generate_series(current_date - ($1::int - 1), current_date, interval '1 day') d
        LEFT JOIN audit_log a ON a.created_at >= d AND a.created_at < d + interval '1 day' GROUP BY d ORDER BY d`, [hari]),
      query(`SELECT s.id, s.user_id, u.username, u.full_name, u.role, s.dibuat_at, s.terakhir_aktif, s.kedaluwarsa_at, s.ip, s.user_agent
        FROM sesi s JOIN users u ON u.id = s.user_id WHERE s.dicabut_at IS NULL AND s.kedaluwarsa_at > now() ORDER BY s.terakhir_aktif DESC LIMIT 100`),
      query(`SELECT a.username, a.ip, COUNT(*)::int AS jumlah, MAX(a.created_at) AS terakhir FROM audit_log a
        WHERE a.action = 'login_gagal' AND a.created_at > now() - ($1::int || ' days')::interval GROUP BY 1,2 ORDER BY 3 DESC, 4 DESC LIMIT 20`, [hari]),
      query(`SELECT a.username, COUNT(*)::int AS jumlah, MAX(a.created_at) AS terakhir FROM audit_log a
        WHERE a.created_at > now() - ($1::int || ' days')::interval AND a.action NOT IN ('login_gagal') GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, [hari]),
      query(`SELECT a.action, COUNT(*)::int AS jumlah FROM audit_log a WHERE a.created_at > now() - ($1::int || ' days')::interval GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, [hari]),
      query(`SELECT d.id, d.tabel, d.aksi, d.kunci, d.username, d.waktu FROM audit_data d ORDER BY d.waktu DESC LIMIT 15`),
      query(`SELECT id, username, full_name, role, gagal_login, terkunci_sampai FROM users WHERE terkunci_sampai > now() ORDER BY terkunci_sampai DESC`),
    ]);
    const tot = harian.rows.reduce((s, r) => ({ login: s.login + r.login, gagal: s.gagal + r.gagal, aktivitas: s.aktivitas + r.aktivitas }), { login: 0, gagal: 0, aktivitas: 0 });
    return { hari, hari_ini: hariIni(), ringkasan: { ...tot, sesi_aktif: sesi.rows.length, akun_terkunci: kunci.rows.length },
      harian: harian.rows, sesi: sesi.rows, login_gagal: gagal.rows, per_pengguna: perPengguna.rows, per_aksi: aksi.rows, perubahan_data: terbaru.rows, terkunci: kunci.rows };
  });

  // Pengujian: kirim notifikasi uji ke diri sendiri (admin), untuk memastikan lonceng & SSE berjalan
  app.post('/api/notifikasi/uji', { preHandler: requireRole('admin') }, async (req) => {
    const { kirimNotifikasi } = await import('../lib/kirimnotif.js');
    await tx((c) => kirimNotifikasi(c, { user_id: req.user.id, kategori: 'sistem', tingkat: 'info', judul: 'Notifikasi uji', pesan: 'Pusat notifikasi berfungsi.', link: '/notifikasi' }));
    return { ok: true };
  });
}
