import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { hashPassword } from '../auth.js';

/** Instalasi baru tanpa pengguna: buat akun admin pertama (password dari ADMIN_PASSWORD atau acak), wajib ganti saat login. */
export async function ensureAdmin(log = console) {
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (n) return;
  const password = process.env.ADMIN_PASSWORD || `${randomBytes(9).toString('base64url')}7a`;
  await pool.query("INSERT INTO users (username, full_name, password_hash, role, wajib_ganti_password) VALUES ('admin', 'Administrator', $1, 'admin', true)", [await hashPassword(password)]);
  log.warn(process.env.ADMIN_PASSWORD
    ? 'Akun admin pertama dibuat (username: admin, password dari ADMIN_PASSWORD). Password wajib diganti saat login pertama.'
    : `Akun admin pertama dibuat. username: admin  password: ${password}  (wajib diganti saat login pertama)`);
}
