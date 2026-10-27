import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query, tx, audit } from './db.js';
import { HttpError, forbidden, required } from './lib/http.js';

const COOKIE = 'bku_token';

export function authPlugin(app) {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies?.[COOKIE] || req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) return;
    try {
      const p = jwt.verify(token, config.jwtSecret);
      req.user = { id: p.sub, username: p.username, full_name: p.full_name, role: p.role, skpd_id: p.skpd_id, unit_id: p.unit_id || null };
    } catch { /* token kedaluwarsa/invalid -> anonim */ }
  });
}

export const requireAuth = async (req) => {
  if (!req.user) throw new HttpError(401, 'Silakan login terlebih dahulu');
};

export const requireRole = (...roles) => async (req) => {
  await requireAuth(req);
  if (!roles.includes(req.user.role)) throw forbidden();
};

export function authRoutes(app) {
  app.post('/api/auth/login', { config: { rateLimit: true } }, async (req, reply) => {
    required(req.body, ['username', 'password']);
    const { rows } = await query('SELECT * FROM users WHERE username = $1 AND active', [String(req.body.username).toLowerCase().trim()]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(String(req.body.password), u.password_hash))) {
      await tx((c) => audit(c, { username: req.body.username }, 'login_gagal', 'user', null, null, req.ip));
      throw new HttpError(401, 'Username atau password salah');
    }
    const token = jwt.sign({ sub: u.id, username: u.username, full_name: u.full_name, role: u.role, skpd_id: u.skpd_id, unit_id: u.unit_id }, config.jwtSecret, { expiresIn: '12h' });
    await tx(async (c) => {
      await c.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
      await audit(c, u, 'login', 'user', u.id, null, req.ip);
    });
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: 12 * 3600 });
    return { user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, skpd_id: u.skpd_id, unit_id: u.unit_id } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.user) return { user: null };
    const { rows } = await query('SELECT u.id, u.username, u.full_name, u.role, u.skpd_id, u.unit_id, s.nama AS skpd_nama, k.nama AS unit_nama FROM users u LEFT JOIN skpd s ON s.id = u.skpd_id LEFT JOIN unit_kerja k ON k.id = u.unit_id WHERE u.id = $1', [req.user.id]);
    return { user: rows[0] };
  });

  app.post('/api/auth/password', { preHandler: requireAuth }, async (req) => {
    required(req.body, ['lama', 'baru']);
    if (String(req.body.baru).length < 8) throw new HttpError(400, 'Password baru minimal 8 karakter');
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(String(req.body.lama), rows[0].password_hash))) throw new HttpError(400, 'Password lama salah');
    await tx(async (c) => {
      await c.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(String(req.body.baru), 10), req.user.id]);
      await audit(c, req.user, 'ganti_password', 'user', req.user.id, null, req.ip);
    });
    return { ok: true };
  });
}

export const hashPassword = (p) => bcrypt.hash(p, 10);
