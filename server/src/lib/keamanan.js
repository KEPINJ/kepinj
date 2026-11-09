// Keamanan akun: kebijakan password, riwayat password, sesi server-side (batas waktu idle & maksimum),
// serta penguncian akun setelah percobaan login gagal berulang.
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { getPengaturan } from './pengaturan.js';

const LEMAH = ['password', 'bku12345', '12345678', 'qwerty123', 'admin123', 'bendahara'];

/** Periksa password baru terhadap kebijakan. Mengembalikan daftar pelanggaran (kosong = lolos). */
export function cekKebijakan(pw, { username = '', min = 8 } = {}) {
  const p = String(pw || '');
  const salah = [];
  if (p.length < min) salah.push(`minimal ${min} karakter`);
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) salah.push('memuat huruf dan angka');
  if (username && p.toLowerCase().includes(String(username).toLowerCase())) salah.push('tidak memuat username');
  if (LEMAH.includes(p.toLowerCase())) salah.push('bukan password umum yang mudah ditebak');
  if (p.length > 72) salah.push('maksimal 72 karakter');
  return salah;
}

/** Validasi lengkap (kebijakan + tidak sama dengan N password terakhir). Melempar pesan bila ditolak. */
export async function validasiPasswordBaru(c, user, pw, cfg) {
  const conf = cfg || await getPengaturan();
  const salah = cekKebijakan(pw, { username: user.username, min: Number(conf.password_min) || 8 });
  if (salah.length) return `Password harus ${salah.join(', ')}`;
  const n = Math.max(0, Number(conf.password_riwayat) || 0);
  if (n) {
    const { rows } = await c.query(`(SELECT password_hash FROM users WHERE id = $1)
      UNION ALL (SELECT hash FROM password_riwayat WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2)`, [user.id, n]);
    for (const r of rows) if (r.password_hash && await bcrypt.compare(String(pw), r.password_hash)) return `Password tidak boleh sama dengan ${n} password terakhir`;
  }
  return null;
}

/** Simpan password baru: hash lama masuk riwayat, sesi lain dicabut. */
export async function gantiPassword(c, userId, pw, { wajibGanti = false, kecualiSesi = null, alasan = 'ganti_password' } = {}) {
  await c.query('INSERT INTO password_riwayat (user_id, hash) SELECT id, password_hash FROM users WHERE id = $1', [userId]);
  await c.query('UPDATE users SET password_hash = $2, password_diubah_at = now(), wajib_ganti_password = $3 WHERE id = $1', [userId, await bcrypt.hash(String(pw), 10), wajibGanti]);
  await c.query(`UPDATE sesi SET dicabut_at = now(), alasan_cabut = $3 WHERE user_id = $1 AND dicabut_at IS NULL AND ($2::text IS NULL OR id <> $2)`, [userId, kecualiSesi, alasan]);
}

/** Password sementara acak (untuk reset oleh admin). */
export function passwordSementara() {
  const huruf = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const b = randomBytes(10);
  let s = '';
  for (let i = 0; i < 8; i++) s += huruf[b[i] % huruf.length];
  return `${s}${10 + (b[8] % 90)}`;
}

/** Perlu ganti password? (ditandai admin atau sudah melewati masa berlaku) */
export function perluGanti(u, cfg) {
  if (u.wajib_ganti_password) return 'wajib';
  const hari = Number(cfg.password_kedaluwarsa_hari) || 0;
  if (hari && u.password_diubah_at && Date.now() - new Date(u.password_diubah_at).getTime() > hari * 86400_000) return 'kedaluwarsa';
  return null;
}

export async function buatSesi(c, user, req, cfg) {
  const id = randomBytes(24).toString('base64url');
  const jam = Math.max(1, Number(cfg.sesi_maks_jam) || 12);
  await c.query(`INSERT INTO sesi (id, user_id, kedaluwarsa_at, ip, user_agent) VALUES ($1,$2, now() + ($3 || ' hours')::interval, $4, $5)`,
    [id, user.id, String(jam), req.ip || null, String(req.headers['user-agent'] || '').slice(0, 300)]);
  return { id, maxAge: jam * 3600 };
}

// Cache singkat agar tidak setiap permintaan menulis ke basis data
const cache = new Map();
const SEGAR_MS = 15_000;

/**
 * Periksa sesi untuk satu permintaan. latar = permintaan latar (polling notifikasi, SSE) yang tidak dihitung
 * sebagai aktivitas pengguna, sehingga sesi tetap berakhir bila pengguna meninggalkan layar.
 * Mengembalikan { ok, alasan, sisa_idle_detik, wajib_ganti }.
 */
export async function cekSesi(sid, userId, { latar = false } = {}) {
  if (!sid) return { ok: false, alasan: 'tanpa_sesi' };
  const cfg = await getPengaturan();
  const idleMs = Math.max(1, Number(cfg.sesi_idle_menit) || 30) * 60_000;
  const now = Date.now();
  let s = cache.get(sid);
  if (!s || now - s.dibaca > SEGAR_MS) {
    const { rows: [r] } = await query(`SELECT s.user_id, s.terakhir_aktif, s.kedaluwarsa_at, s.dicabut_at, s.alasan_cabut, u.active, u.wajib_ganti_password, u.password_diubah_at
      FROM sesi s JOIN users u ON u.id = s.user_id WHERE s.id = $1`, [sid]);
    if (!r) { cache.delete(sid); return { ok: false, alasan: 'tanpa_sesi' }; }
    s = { ...r, terakhir: new Date(r.terakhir_aktif).getTime(), habis: new Date(r.kedaluwarsa_at).getTime(), dibaca: now, ditulis: new Date(r.terakhir_aktif).getTime() };
    cache.set(sid, s);
  }
  if (s.user_id !== userId || !s.active) return { ok: false, alasan: 'dicabut' };
  if (s.dicabut_at) return { ok: false, alasan: s.alasan_cabut || 'dicabut' };
  if (now > s.habis) return { ok: false, alasan: 'kedaluwarsa' };
  if (now - s.terakhir > idleMs) {
    await query("UPDATE sesi SET dicabut_at = now(), alasan_cabut = 'idle' WHERE id = $1 AND dicabut_at IS NULL", [sid]);
    s.dicabut_at = new Date(); s.alasan_cabut = 'idle';
    return { ok: false, alasan: 'idle' };
  }
  if (!latar) {
    s.terakhir = now;
    if (now - s.ditulis > SEGAR_MS) { s.ditulis = now; await query('UPDATE sesi SET terakhir_aktif = now() WHERE id = $1', [sid]); }
  }
  return { ok: true, sisa_idle_detik: Math.round((idleMs - (now - s.terakhir)) / 1000), idle_menit: idleMs / 60_000, berakhir: new Date(s.habis).toISOString(),
    wajib_ganti: perluGanti(s, cfg) };
}

export const lupakanSesi = (sid) => cache.delete(sid);
export const lupakanSemuaSesi = () => cache.clear();

export const PESAN_SESI = {
  idle: 'Sesi berakhir karena tidak ada aktivitas. Silakan login kembali.',
  kedaluwarsa: 'Sesi telah melewati batas waktu maksimum. Silakan login kembali.',
  dicabut: 'Sesi telah diakhiri. Silakan login kembali.',
  logout: 'Anda telah keluar.',
  ganti_password: 'Password akun telah diganti. Silakan login dengan password baru.',
  reset_admin: 'Password direset oleh administrator. Silakan login dengan password sementara.',
  dicabut_admin: 'Sesi diakhiri oleh administrator.',
  pemulihan: 'Basis data dipulihkan dari cadangan. Silakan login kembali.',
  tanpa_sesi: 'Silakan login terlebih dahulu',
};
