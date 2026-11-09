// Keamanan data: pengaturan kebijakan login/sesi/password, buka kunci & reset password pengguna,
// daftar sesi aktif (dan pencabutannya), jejak audit perubahan data, serta ringkasan kondisi keamanan.
import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, notFound, int } from '../lib/http.js';
import { getPengaturan, simpanPengaturan } from '../lib/pengaturan.js';
import { gantiPassword, passwordSementara, lupakanSemuaSesi, cekKebijakan } from '../lib/keamanan.js';

// kunci: [min, maks, label]
export const BATAS = {
  login_maks_gagal: [3, 20, 'Maksimal percobaan login gagal'],
  login_kunci_menit: [1, 1440, 'Lama penguncian akun (menit)'],
  sesi_idle_menit: [5, 480, 'Batas waktu tidak aktif (menit)'],
  sesi_maks_jam: [1, 24, 'Umur sesi maksimum (jam)'],
  password_min: [8, 32, 'Panjang minimal password'],
  password_kedaluwarsa_hari: [0, 365, 'Masa berlaku password (hari, 0 = tidak kedaluwarsa)'],
  password_riwayat: [0, 12, 'Tidak boleh sama dengan N password terakhir'],
  lampiran_maks_mb: [1, 20, 'Ukuran maksimal dokumen bukti (MB)'],
};
const pilih = (cfg) => Object.fromEntries(Object.keys(BATAS).map((k) => [k, cfg[k]]));

export default async function keamananRoutes(app) {
  app.get('/api/keamanan', { preHandler: requireRole('admin') }, async () => {
    const cfg = await getPengaturan();
    const [{ rows: [u] }, { rows: [s] }, { rows: [c] }, { rows: [ad] }, { rows: [la] }] = await Promise.all([
      query(`SELECT COUNT(*) FILTER (WHERE active)::int AS aktif, COUNT(*) FILTER (WHERE terkunci_sampai > now())::int AS terkunci,
          COUNT(*) FILTER (WHERE active AND role = 'admin')::int AS admin, COUNT(*) FILTER (WHERE active AND wajib_ganti_password)::int AS wajib_ganti,
          COUNT(*) FILTER (WHERE active AND $1::int > 0 AND password_diubah_at < now() - ($1::int || ' days')::interval)::int AS kedaluwarsa
        FROM users`, [Number(cfg.password_kedaluwarsa_hari) || 0]),
      query(`SELECT COUNT(*)::int AS aktif FROM sesi WHERE dicabut_at IS NULL AND kedaluwarsa_at > now()`),
      query(`SELECT (SELECT max(mulai) FROM uji_pemulihan) AS uji_terakhir, (SELECT berhasil FROM uji_pemulihan ORDER BY mulai DESC LIMIT 1) AS uji_berhasil,
          (SELECT COUNT(*)::int FROM audit_log WHERE action = 'login_gagal' AND created_at > now() - interval '24 hours') AS gagal_24j`),
      query(`SELECT COUNT(*)::int AS n, max(waktu) AS terakhir FROM audit_data WHERE waktu > now() - interval '30 days'`),
      query(`SELECT COUNT(*)::int AS n, pg_size_pretty(COALESCE(SUM(ukuran), 0)) AS ukuran FROM lampiran WHERE dihapus_at IS NULL`),
    ]);
    const hariUji = Number(cfg.uji_pulih_hari) || 7;
    // Daftar periksa keamanan (dipakai sebagai bukti pengendalian di laporan)
    const periksa = [
      { kunci: 'cadangan', ok: Boolean(cfg.cadangan_aktif) && Boolean(cfg.cadangan_terakhir), judul: 'Pencadangan otomatis harian aktif', rinci: cfg.cadangan_terakhir ? `Terakhir ${cfg.cadangan_terakhir}` : 'Belum pernah berjalan' },
      { kunci: 'uji', ok: Boolean(c.uji_terakhir) && c.uji_berhasil && Date.now() - new Date(c.uji_terakhir).getTime() < hariUji * 86400_000 * 1.5, judul: `Uji pemulihan dalam ${hariUji} hari terakhir`, rinci: c.uji_terakhir ? `${c.uji_berhasil ? 'Berhasil' : 'GAGAL'} pada ${new Date(c.uji_terakhir).toLocaleString('id-ID')}` : 'Belum pernah diuji' },
      { kunci: 'kunci', ok: Number(cfg.login_maks_gagal) <= 10, judul: 'Pembatasan percobaan login', rinci: `Dikunci ${cfg.login_kunci_menit} menit setelah ${cfg.login_maks_gagal} kali gagal` },
      { kunci: 'sesi', ok: Number(cfg.sesi_idle_menit) <= 60, judul: 'Session timeout', rinci: `Keluar otomatis setelah ${cfg.sesi_idle_menit} menit tidak aktif, maksimum ${cfg.sesi_maks_jam} jam` },
      { kunci: 'password', ok: Number(cfg.password_min) >= 8 && Number(cfg.password_riwayat) >= 1, judul: 'Kebijakan password', rinci: `Min. ${cfg.password_min} karakter huruf+angka, berlaku ${cfg.password_kedaluwarsa_hari || '∞'} hari, tidak mengulang ${cfg.password_riwayat} password terakhir` },
      { kunci: 'admin', ok: u.admin >= 1 && u.admin <= 3, judul: 'Jumlah akun administrator terbatas', rinci: `${u.admin} akun admin aktif` },
      { kunci: 'dokumen', ok: true, judul: 'Perlindungan berkas dokumen', rinci: `${la.n} berkas (${la.ukuran}) tersimpan di basis data dengan sidik SHA-256, diperiksa ulang saat diunduh, tidak dapat dihapus permanen` },
      { kunci: 'audit', ok: true, judul: 'Audit perubahan data', rinci: `${ad.n} perubahan data master tercatat 30 hari terakhir (sebelum & sesudah)` },
    ];
    return { pengaturan: pilih(cfg), batas: BATAS, pengguna: u, sesi_aktif: s.aktif, login_gagal_24j: c.gagal_24j, periksa,
      skor: Math.round((periksa.filter((p) => p.ok).length / periksa.length) * 100) };
  });

  app.put('/api/keamanan/pengaturan', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    const nilai = {};
    for (const [k, [min, maks, label]] of Object.entries(BATAS)) {
      if (!(k in b)) continue;
      const n = Number(b[k]);
      if (!Number.isFinite(n) || n < min || n > maks) throw bad(`${label}: isi antara ${min} dan ${maks}`);
      nilai[k] = Math.round(n);
    }
    if (!Object.keys(nilai).length) throw bad('Tidak ada pengaturan diubah');
    await tx(async (c) => { await simpanPengaturan(c, nilai); await audit(c, req.user, 'keamanan_pengaturan', 'pengaturan', null, nilai, req.ip); });
    lupakanSemuaSesi();   // batas idle/umur baru langsung berlaku
    return { ok: true, pengaturan: pilih(await getPengaturan()) };
  });

  // Uji kekuatan password di formulir (tanpa menyimpan)
  app.post('/api/keamanan/cek-password', { preHandler: requireAuth }, async (req) => {
    const cfg = await getPengaturan();
    const salah = cekKebijakan(req.body?.password, { username: req.body?.username || req.user.username, min: Number(cfg.password_min) || 8 });
    return { ok: !salah.length, salah };
  });

  app.post('/api/users/:id/buka-kunci', { preHandler: requireRole('admin') }, async (req) => tx(async (c) => {
    const { rows: [u] } = await c.query('UPDATE users SET terkunci_sampai = NULL, gagal_login = 0, gagal_terakhir = NULL WHERE id = $1 RETURNING id, username', [int(req.params.id)]);
    if (!u) throw notFound('Pengguna tidak ditemukan');
    await audit(c, req.user, 'akun_buka_kunci', 'user', u.id, { username: u.username }, req.ip);
    return { ok: true };
  }));

  // Reset password oleh admin: password sementara acak, wajib diganti saat login, semua sesi pengguna dicabut
  app.post('/api/users/:id/reset-password', { preHandler: requireRole('admin') }, async (req) => tx(async (c) => {
    const { rows: [u] } = await c.query('SELECT id, username FROM users WHERE id = $1', [int(req.params.id)]);
    if (!u) throw notFound('Pengguna tidak ditemukan');
    const sementara = passwordSementara();
    await gantiPassword(c, u.id, sementara, { wajibGanti: true, alasan: 'reset_admin' });
    await c.query('UPDATE users SET terkunci_sampai = NULL, gagal_login = 0 WHERE id = $1', [u.id]);
    await audit(c, req.user, 'reset_password', 'user', u.id, { username: u.username }, req.ip);
    lupakanSemuaSesi();
    return { ok: true, username: u.username, password_sementara: sementara };
  }));

  // Sesi: admin melihat semua, pengguna lain melihat sesinya sendiri
  app.get('/api/keamanan/sesi', { preHandler: requireAuth }, async (req) => {
    const semua = req.user.role === 'admin' && req.query.semua !== '0';
    const { rows } = await query(`SELECT s.id, s.user_id, u.username, u.full_name, u.role, s.dibuat_at, s.terakhir_aktif, s.kedaluwarsa_at, s.ip, s.user_agent,
        s.dicabut_at, s.alasan_cabut, (s.dicabut_at IS NULL AND s.kedaluwarsa_at > now()) AS aktif
      FROM sesi s JOIN users u ON u.id = s.user_id WHERE ($1 OR s.user_id = $2) AND s.dibuat_at > now() - interval '30 days'
      ORDER BY (s.dicabut_at IS NULL AND s.kedaluwarsa_at > now()) DESC, s.terakhir_aktif DESC LIMIT 200`, [semua, req.user.id]);
    return { rows: rows.map((r) => ({ ...r, id: undefined, ref: r.id.slice(0, 8), ini: r.id === req.sesi?.id })) };
  });

  app.post('/api/keamanan/sesi/cabut', { preHandler: requireAuth }, async (req) => {
    const ref = String(req.body?.ref || '');
    const userId = req.body?.user_id ? int(req.body.user_id) : null;
    if (!ref && !userId) throw bad('Pilih sesi atau pengguna');
    if (userId && req.user.role !== 'admin' && userId !== req.user.id) throw bad('Hanya admin yang dapat mengakhiri sesi pengguna lain');
    const r = await tx(async (c) => {
      const res = await c.query(`UPDATE sesi SET dicabut_at = now(), alasan_cabut = $4 WHERE dicabut_at IS NULL
          AND ($1 = '' OR left(id, 8) = $1) AND ($2::int IS NULL OR user_id = $2) AND ($3 OR user_id = $5) AND id <> COALESCE($6, '')`,
      [ref, userId, req.user.role === 'admin', req.user.role === 'admin' ? 'dicabut_admin' : 'dicabut', req.user.id, req.sesi?.id || null]);
      await audit(c, req.user, 'sesi_cabut', 'sesi', ref || `user:${userId}`, { jumlah: res.rowCount }, req.ip);
      return res.rowCount;
    });
    lupakanSemuaSesi();
    return { ok: true, dicabut: r };
  });

  // Jejak audit perubahan data (sebelum/sesudah) dari trigger basis data
  app.get('/api/audit-data', { preHandler: requireRole('admin', 'pimpinan') }, async (req) => {
    const p = []; const w = ['TRUE'];
    if (req.query.tabel) { p.push(String(req.query.tabel)); w.push(`d.tabel = $${p.length}`); }
    if (['INSERT', 'UPDATE', 'DELETE'].includes(req.query.aksi)) { p.push(req.query.aksi); w.push(`d.aksi = $${p.length}`); }
    if (req.query.q) { p.push(`%${String(req.query.q).slice(0, 80)}%`); w.push(`(d.kunci ILIKE $${p.length} OR d.username ILIKE $${p.length} OR d.sesudah::text ILIKE $${p.length} OR d.sebelum::text ILIKE $${p.length})`); }
    const limit = Math.min(int(req.query.limit, 30), 200);
    const page = Math.max(int(req.query.page, 1), 1);
    const { rows } = await query(`SELECT d.*, COUNT(*) OVER()::int AS total FROM audit_data d WHERE ${w.join(' AND ')} ORDER BY d.waktu DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, p);
    const { rows: tabel } = await query('SELECT tabel, COUNT(*)::int AS n FROM audit_data GROUP BY 1 ORDER BY 1');
    return {
      rows: rows.map((r) => {
        const a = r.sebelum || {}; const b = r.sesudah || {};
        const kolom = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
        return { ...r, berubah: r.aksi === 'UPDATE' ? kolom.map((k) => ({ kolom: k, sebelum: a[k], sesudah: b[k] })) : null };
      }),
      total: rows[0]?.total || 0, page, limit, tabel,
    };
  });
}
