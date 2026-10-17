import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { hashPassword } from '../auth.js';

/** Instalasi baru tanpa pengguna: buat akun admin pertama (password dari ADMIN_PASSWORD atau acak). */
export async function ensureAdmin(log = console) {
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (n) return;
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  await pool.query("INSERT INTO users (username, full_name, password_hash, role) VALUES ('admin', 'Administrator', $1, 'admin')", [await hashPassword(password)]);
  log.warn(process.env.ADMIN_PASSWORD
    ? 'Akun admin pertama dibuat (username: admin, password dari ADMIN_PASSWORD). Segera ganti password setelah login.'
    : `Akun admin pertama dibuat. username: admin  password: ${password}  (segera ganti setelah login)`);
}
