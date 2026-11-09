import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query, tx, audit, aktor } from './db.js';
import { HttpError, forbidden, required } from './lib/http.js';
import { getPengaturan } from './lib/pengaturan.js';
import { buatSesi, cekSesi, gantiPassword, lupakanSesi, perluGanti, validasiPasswordBaru, PESAN_SESI } from './lib/keamanan.js';
import { kirimNotifikasi } from './lib/kirimnotif.js';

const COOKIE = 'bku_token';
// Jalur yang tetap boleh diakses saat password wajib diganti
const BEBAS_GANTI = ['/api/auth/'];

export function authPlugin(app) {
  app.decorateRequest('user', null);
  app.decorateRequest('sesi', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies?.[COOKIE] || req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) return;
    let p;
    try { p = jwt.verify(token, config.jwtSecret); } catch { return; /* token kedaluwarsa/invalid -> anonim */ }
    // Sesi server-side: batas waktu idle, batas maksimum, dan pencabutan (logout, ganti password, admin)
    const latar = req.headers['x-background'] === '1' || req.url.startsWith('/api/stream') || req.url.startsWith('/api/auth/sesi');
    const s = await cekSesi(p.sid, p.sub, { latar });
    req.sesi = { id: p.sid, ...s };
    if (!s.ok) return;
    req.user = { id: p.sub, username: p.username, full_name: p.full_name, role: p.role, skpd_id: p.skpd_id, unit_id: p.unit_id || null };
  });
  // Pelaku untuk jejak audit perubahan data (trigger basis data membaca bku.user_id)
  app.addHook('preHandler', (req, reply, done) => {
    if (!req.user) return done();
    aktor.run({ id: req.user.id, username: req.user.username }, done);
  });
}

export const requireAuth = async (req) => {
  if (!req.user) {
    const alasan = req.sesi && !req.sesi.ok ? req.sesi.alasan : null;
    const e = new HttpError(401, PESAN_SESI[alasan] || 'Silakan login terlebih dahulu');
    if (alasan) e.alasan = alasan;
    throw e;
  }
  if (req.sesi?.wajib_ganti && !BEBAS_GANTI.some((b) => req.url.startsWith(b))) {
    const e = new HttpError(403, req.sesi.wajib_ganti === 'kedaluwarsa' ? 'Masa berlaku password habis. Ganti password terlebih dahulu.' : 'Ganti password sementara Anda terlebih dahulu.');
    e.alasan = 'ganti_password';
    throw e;
  }
};

export const requireRole = (...roles) => async (req) => {
  await requireAuth(req);
  if (!roles.includes(req.user.role)) throw forbidden();
};

const sisaMenit = (t) => Math.max(1, Math.ceil((new Date(t).getTime() - Date.now()) / 60_000));

/** Catat login gagal: penguncian akun setelah N kali dan pemberitahuan ke admin. */
async function loginGagal(u, username, req, cfg) {
  const maks = Math.max(1, Number(cfg.login_maks_gagal) || 5);
  const menit = Math.max(1, Number(cfg.login_kunci_menit) || 15);
  await tx(async (c) => {
    await audit(c, { id: u?.id, username }, 'login_gagal', 'user', u?.id ?? null, u ? null : { alasan: 'username tidak dikenal' }, req.ip);
    if (!u) {
      // Banyak percobaan dengan username tak dikenal dari satu IP: tanda pemindaian akun
      const { rows: [r] } = await c.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'login_gagal' AND ip = $1 AND user_id IS NULL AND created_at > now() - interval '15 minutes'`, [req.ip]);
      if (r.n === 10) await kirimNotifikasi(c, { peran: ['admin'], kategori: 'keamanan', tingkat: 'bahaya', judul: `Login mencurigakan dari IP ${req.ip}`,
        pesan: `10 percobaan login dengan username yang tidak terdaftar dalam 15 menit (terakhir: "${String(username).slice(0, 40)}").`, link: '/keamanan?tab=aktivitas', ref: `ip:${req.ip}` });
      return;
    }
    const reset = u.gagal_terakhir && Date.now() - new Date(u.gagal_terakhir).getTime() > menit * 60_000;
    const n = (reset ? 0 : u.gagal_login) + 1;
    if (n >= maks) {
      await c.query(`UPDATE users SET gagal_login = 0, gagal_terakhir = now(), terkunci_sampai = now() + ($2 || ' minutes')::interval WHERE id = $1`, [u.id, String(menit)]);
      await audit(c, { id: u.id, username: u.username }, 'akun_terkunci', 'user', u.id, { percobaan: n, menit }, req.ip);
      await kirimNotifikasi(c, { peran: ['admin'], kategori: 'keamanan', tingkat: 'bahaya', judul: `Akun ${u.username} dikunci ${menit} menit`,
        pesan: `${n} kali salah password berturut-turut dari IP ${req.ip}. Buka kunci dari menu Keamanan bila pemilik akun sudah dikonfirmasi.`, link: '/keamanan?tab=pengguna', ref: `kunci:${u.id}` });
      await kirimNotifikasi(c, { user_id: u.id, kategori: 'keamanan', tingkat: 'peringatan', judul: 'Akun Anda sempat dikunci',
        pesan: `Ada ${n} percobaan login gagal dari IP ${req.ip}. Bila itu bukan Anda, segera ganti password.`, link: '/akun' });
    } else {
      await c.query('UPDATE users SET gagal_login = $2, gagal_terakhir = now() WHERE id = $1', [u.id, n]);
    }
  });
}

export function authRoutes(app) {
  app.post('/api/auth/login', { config: { rateLimit: true } }, async (req, reply) => {
    required(req.body, ['username', 'password']);
    const cfg = await getPengaturan();
    const username = String(req.body.username).toLowerCase().trim();
    const { rows } = await query('SELECT * FROM users WHERE username = $1 AND active', [username]);
    const u = rows[0];
    if (u?.terkunci_sampai && new Date(u.terkunci_sampai) > new Date()) {
      await tx((c) => audit(c, { id: u.id, username }, 'login_ditolak_terkunci', 'user', u.id, null, req.ip));
      throw new HttpError(423, `Akun dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi ${sisaMenit(u.terkunci_sampai)} menit lagi atau hubungi administrator.`);
    }
    if (!u || !(await bcrypt.compare(String(req.body.password), u.password_hash))) {
      await loginGagal(u, username, req, cfg);
      const maks = Number(cfg.login_maks_gagal) || 5;
      const sisa = u ? maks - ((u.gagal_terakhir && Date.now() - new Date(u.gagal_terakhir).getTime() > (Number(cfg.login_kunci_menit) || 15) * 60_000 ? 0 : u.gagal_login) + 1) : null;
      throw new HttpError(sisa === 0 ? 423 : 401, sisa === 0 ? `Akun dikunci ${cfg.login_kunci_menit || 15} menit karena ${maks} kali salah password.`
        : `Username atau password salah${sisa != null && sisa <= 2 ? ` (sisa ${sisa} percobaan sebelum akun dikunci)` : ''}`);
    }
    const sesi = await tx(async (c) => {
      // Login dari IP yang belum pernah dipakai 30 hari terakhir setelah ada percobaan gagal: beri tahu pemilik akun
      const { rows: [r] } = await c.query(`SELECT EXISTS (SELECT 1 FROM audit_log WHERE user_id = $1 AND action = 'login' AND ip = $2 AND created_at > now() - interval '30 days') AS dikenal,
          EXISTS (SELECT 1 FROM audit_log WHERE action = 'login') AS pernah`, [u.id, req.ip]);
      if (!r.dikenal && r.pernah && u.gagal_login > 0) {
        await kirimNotifikasi(c, { user_id: u.id, kategori: 'keamanan', tingkat: 'peringatan', judul: 'Login dari alamat baru setelah percobaan gagal',
          pesan: `Login berhasil dari IP ${req.ip} setelah ${u.gagal_login} percobaan gagal. Bila bukan Anda, ganti password dan hubungi administrator.`, link: '/akun' });
      }
      await c.query('UPDATE users SET last_login_at = now(), gagal_login = 0, gagal_terakhir = NULL, terkunci_sampai = NULL WHERE id = $1', [u.id]);
      await audit(c, u, 'login', 'user', u.id, null, req.ip);
      return buatSesi(c, u, req, cfg);
    });
    const token = jwt.sign({ sub: u.id, sid: sesi.id, username: u.username, full_name: u.full_name, role: u.role, skpd_id: u.skpd_id, unit_id: u.unit_id }, config.jwtSecret, { expiresIn: sesi.maxAge });
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: sesi.maxAge });
    return { user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, skpd_id: u.skpd_id, unit_id: u.unit_id }, wajib_ganti_password: perluGanti(u, cfg) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sesi?.id) {
      await query("UPDATE sesi SET dicabut_at = now(), alasan_cabut = 'logout' WHERE id = $1 AND dicabut_at IS NULL", [req.sesi.id]);
      lupakanSesi(req.sesi.id);
      if (req.user) await tx((c) => audit(c, req.user, 'logout', 'user', req.user.id, null, req.ip));
    }
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.user) return { user: null, alasan: req.sesi && !req.sesi.ok ? req.sesi.alasan : null, pesan: req.sesi && !req.sesi.ok ? PESAN_SESI[req.sesi.alasan] : null };
    const { rows } = await query('SELECT u.id, u.username, u.full_name, u.role, u.skpd_id, u.unit_id, u.password_diubah_at, s.nama AS skpd_nama, k.nama AS unit_nama FROM users u LEFT JOIN skpd s ON s.id = u.skpd_id LEFT JOIN unit_kerja k ON k.id = u.unit_id WHERE u.id = $1', [req.user.id]);
    return { user: rows[0], sesi: { sisa_idle_detik: req.sesi.sisa_idle_detik, idle_menit: req.sesi.idle_menit, berakhir: req.sesi.berakhir }, wajib_ganti_password: req.sesi.wajib_ganti || null };
  });

  // Status sesi untuk peringatan "sesi akan berakhir" di browser (tidak dihitung sebagai aktivitas)
  app.get('/api/auth/sesi', async (req) => {
    if (!req.user) return { aktif: false, alasan: req.sesi?.alasan || null, pesan: PESAN_SESI[req.sesi?.alasan] || null };
    return { aktif: true, sisa_idle_detik: req.sesi.sisa_idle_detik, idle_menit: req.sesi.idle_menit, berakhir: req.sesi.berakhir };
  });
  // Perpanjang sesi (tombol "Tetap masuk"): permintaan biasa sudah memperbarui waktu aktivitas
  app.post('/api/auth/sesi/perpanjang', { preHandler: requireAuth }, async (req) => ({ ok: true, sisa_idle_detik: req.sesi.idle_menit * 60 }));

  app.post('/api/auth/password', { preHandler: requireAuth }, async (req) => {
    required(req.body, ['lama', 'baru']);
    const { rows: [u] } = await query('SELECT id, username, password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(String(req.body.lama), u.password_hash))) throw new HttpError(400, 'Password lama salah');
    await tx(async (c) => {
      const salah = await validasiPasswordBaru(c, u, req.body.baru);
      if (salah) throw new HttpError(400, salah);
      await gantiPassword(c, u.id, req.body.baru, { kecualiSesi: req.sesi?.id });
      await audit(c, req.user, 'ganti_password', 'user', req.user.id, null, req.ip);
    });
    req.sesi.wajib_ganti = null;
    lupakanSesi(req.sesi?.id);
    return { ok: true };
  });
}

export const hashPassword = (p) => bcrypt.hash(p, 10);
