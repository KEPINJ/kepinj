// Data master: SKPD, rekening, rekanan, pegawai, objek pajak, anggaran, pengguna
import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole, hashPassword } from '../auth.js';
import { bad, notFound, int, required, scopeSkpd } from '../lib/http.js';

const ENTITIES = {
  skpd: { table: 'skpd', key: 'id', order: 'kode', write: ['admin'], fields: ['kode', 'nama', 'alamat', 'npwp', 'nitku', 'kepala_nama', 'kepala_nip', 'bendahara_nama', 'bendahara_nip'], required: ['kode', 'nama'], search: ['kode', 'nama'] },
  rekening: { table: 'rekening', key: 'kode', order: 'kode', write: ['admin'], fields: ['kode', 'nama', 'jenis', 'level', 'parent'], required: ['kode', 'nama', 'jenis'], search: ['kode', 'nama'], upsert: true },
  rekanan: { table: 'rekanan', key: 'id', order: 'nama', write: ['admin', 'bendahara'], fields: ['nama', 'jenis', 'npwp', 'nik', 'nitku', 'alamat', 'bank', 'no_rekening'], required: ['nama'], search: ['nama', 'npwp', 'nik'] },
  pegawai: { table: 'pegawai', key: 'id', order: 'nama', write: ['admin', 'bendahara'], fields: ['skpd_id', 'nip', 'nama', 'nik', 'npwp', 'status_ptkp', 'golongan', 'jabatan', 'jenis', 'aktif'], required: ['nama'], search: ['nama', 'nip', 'npwp'], scoped: true },
  'objek-pajak': { table: 'objek_pajak', key: 'kode', order: 'jenis_pajak, kode', write: ['admin'], fields: ['kode', 'jenis_pajak', 'nama', 'tarif', 'dpp_persen', 'coretax_form', 'keterangan', 'aktif'], required: ['kode', 'jenis_pajak', 'nama', 'coretax_form'], search: ['kode', 'nama'], upsert: true },
  anggaran: { table: 'anggaran', key: 'id', order: 'tahun DESC, kode_rekening', write: ['admin'], fields: ['skpd_id', 'tahun', 'kode_rekening', 'pagu'], required: ['skpd_id', 'tahun', 'kode_rekening', 'pagu'], search: ['kode_rekening'], scoped: true, conflict: '(skpd_id, tahun, kode_rekening)' },
};

const clean = (v) => (v === '' ? null : v);

export default async function masterRoutes(app) {
  for (const [name, cfg] of Object.entries(ENTITIES)) {
    app.get(`/api/master/${name}`, { preHandler: requireAuth }, async (req) => {
      const params = []; const where = [];
      if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(${cfg.search.map((c) => `${c}::text ILIKE $1`).join(' OR ')})`); }
      if (cfg.scoped && (req.query.skpd_id || !['admin', 'pimpinan'].includes(req.user.role))) { params.push(scopeSkpd(req.user, req.query.skpd_id)); where.push(`skpd_id = $${params.length}`); }
      if (name === 'anggaran' && req.query.tahun) { params.push(int(req.query.tahun)); where.push(`tahun = $${params.length}`); }
      if (name === 'rekening' && req.query.jenis) { params.push(req.query.jenis); where.push(`jenis = $${params.length}`); }
      const sql = name === 'anggaran'
        ? `SELECT a.*, r.nama AS rekening_nama, s.kode AS skpd_kode FROM anggaran a JOIN rekening r ON r.kode = a.kode_rekening JOIN skpd s ON s.id = a.skpd_id ${where.length ? `WHERE ${where.map((w) => w.replace(/\bskpd_id\b/, 'a.skpd_id').replace(/\btahun\b/, 'a.tahun').replace(/\bkode_rekening\b/, 'a.kode_rekening')).join(' AND ')}` : ''} ORDER BY a.tahun DESC, a.kode_rekening LIMIT 2000`
        : `SELECT * FROM ${cfg.table} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${cfg.order} LIMIT 2000`;
      const { rows } = await query(sql, params);
      return { rows };
    });

    const canWrite = requireRole(...cfg.write);

    app.post(`/api/master/${name}`, { preHandler: canWrite }, async (req) => {
      const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
      items.forEach((it, i) => { try { required(it, cfg.required); } catch (e) { throw bad(items.length > 1 ? `Baris ${i + 1}: ${e.message}` : e.message); } });
      return tx(async (c) => {
        const out = [];
        for (const it of items) {
          if (cfg.scoped && req.user.role !== 'admin') it.skpd_id = req.user.skpd_id;
          const cols = cfg.fields.filter((f) => f in it);
          const vals = cols.map((f) => clean(it[f]));
          const conflict = cfg.conflict || (cfg.upsert ? `(${cfg.key})` : null);
          const sql = `INSERT INTO ${cfg.table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})
            ${conflict ? `ON CONFLICT ${conflict} DO UPDATE SET ${cols.map((f) => `${f} = EXCLUDED.${f}`).join(', ')}` : ''} RETURNING *`;
          const { rows: [r] } = await c.query(sql, vals);
          out.push(r);
        }
        await audit(c, req.user, `${name}_simpan`, name, out.length === 1 ? out[0][cfg.key] : `${out.length} baris`, items.length === 1 ? items[0] : { jumlah: items.length }, req.ip);
        return { rows: out };
      });
    });

    app.put(`/api/master/${name}/:key`, { preHandler: canWrite }, async (req) => {
      const cols = cfg.fields.filter((f) => f in (req.body || {}) && !(f === cfg.key));
      if (!cols.length) throw bad('Tidak ada perubahan');
      return tx(async (c) => {
        if (cfg.scoped && req.user.role !== 'admin') {
          const { rows: [cur] } = await c.query(`SELECT skpd_id FROM ${cfg.table} WHERE ${cfg.key} = $1`, [req.params.key]);
          if (cur?.skpd_id !== req.user.skpd_id) throw notFound();
          delete req.body.skpd_id;
        }
        const { rows: [r] } = await c.query(`UPDATE ${cfg.table} SET ${cols.map((f, i) => `${f} = $${i + 2}`).join(', ')} WHERE ${cfg.key} = $1 RETURNING *`,
          [req.params.key, ...cols.map((f) => clean(req.body[f]))]);
        if (!r) throw notFound();
        await audit(c, req.user, `${name}_ubah`, name, req.params.key, req.body, req.ip);
        return { row: r };
      });
    });

    app.delete(`/api/master/${name}/:key`, { preHandler: canWrite }, async (req) => {
      return tx(async (c) => {
        try {
          const { rowCount } = await c.query(`DELETE FROM ${cfg.table} WHERE ${cfg.key} = $1`, [req.params.key]);
          if (!rowCount) throw notFound();
        } catch (e) {
          if (e.code === '23503') throw bad('Data masih dipakai oleh transaksi lain sehingga tidak dapat dihapus');
          throw e;
        }
        await audit(c, req.user, `${name}_hapus`, name, req.params.key, null, req.ip);
        return { ok: true };
      });
    });
  }

  // Pengguna
  app.get('/api/users', { preHandler: requireRole('admin') }, async () => {
    const { rows } = await query('SELECT u.id, u.username, u.full_name, u.role, u.skpd_id, u.active, u.last_login_at, s.kode AS skpd_kode FROM users u LEFT JOIN skpd s ON s.id = u.skpd_id ORDER BY u.username');
    return { rows };
  });
  app.post('/api/users', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    required(b, ['username', 'full_name', 'role']);
    return tx(async (c) => {
      let r;
      if (b.id) {
        ({ rows: [r] } = await c.query('UPDATE users SET full_name = $2, role = $3, skpd_id = $4, active = $5 WHERE id = $1 RETURNING id, username, full_name, role, skpd_id, active', [b.id, b.full_name, b.role, clean(b.skpd_id), b.active !== false]));
        if (b.password) {
          if (String(b.password).length < 8) throw bad('Password minimal 8 karakter');
          await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [b.id, await hashPassword(b.password)]);
        }
      } else {
        if (!b.password || String(b.password).length < 8) throw bad('Password minimal 8 karakter');
        ({ rows: [r] } = await c.query('INSERT INTO users (username, full_name, password_hash, role, skpd_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, full_name, role, skpd_id, active',
          [String(b.username).toLowerCase().trim(), b.full_name, await hashPassword(b.password), b.role, clean(b.skpd_id)]));
      }
      await audit(c, req.user, b.id ? 'user_ubah' : 'user_tambah', 'user', r.id, { username: r.username, role: r.role }, req.ip);
      return { row: r };
    });
  });
}
