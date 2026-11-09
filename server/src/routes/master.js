// Data master: SKPD, rekening, rekanan, pegawai, objek pajak, anggaran, pengguna
import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole, hashPassword } from '../auth.js';
import { bad, notFound, int, required, scopeSkpd } from '../lib/http.js';
import { cekKebijakan, gantiPassword } from '../lib/keamanan.js';
import { getPengaturan } from '../lib/pengaturan.js';

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
    const { rows } = await query('SELECT u.id, u.username, u.full_name, u.role, u.skpd_id, u.unit_id, u.email, u.no_wa, u.active, u.last_login_at, u.gagal_login, u.terkunci_sampai, u.password_diubah_at, u.wajib_ganti_password, (SELECT COUNT(*)::int FROM sesi x WHERE x.user_id = u.id AND x.dicabut_at IS NULL AND x.kedaluwarsa_at > now()) AS sesi_aktif, s.kode AS skpd_kode, k.nama AS unit_nama FROM users u LEFT JOIN skpd s ON s.id = u.skpd_id LEFT JOIN unit_kerja k ON k.id = u.unit_id ORDER BY u.username');
    return { rows };
  });
  app.post('/api/users', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    required(b, ['username', 'full_name', 'role']);
    // Password yang ditetapkan admin bersifat sementara: pengguna wajib menggantinya saat login pertama
    if (b.password) {
      const salah = cekKebijakan(b.password, { username: b.username, min: Number((await getPengaturan()).password_min) || 8 });
      if (salah.length) throw bad(`Password harus ${salah.join(', ')}`);
    }
    return tx(async (c) => {
      let r;
      if (b.id) {
        ({ rows: [r] } = await c.query('UPDATE users SET full_name = $2, role = $3, skpd_id = $4, active = $5, unit_id = $6, email = $7, no_wa = $8 WHERE id = $1 RETURNING id, username, full_name, role, skpd_id, unit_id, email, no_wa, active', [b.id, b.full_name, b.role, clean(b.skpd_id), b.active !== false, b.role === 'bendahara_pembantu' ? clean(b.unit_id) ?? null : null, clean(b.email) ?? null, clean(b.no_wa) ?? null]));
        if (b.password) await gantiPassword(c, b.id, b.password, { wajibGanti: true, alasan: 'reset_admin' });
        if (b.active === false) await c.query("UPDATE sesi SET dicabut_at = now(), alasan_cabut = 'dicabut_admin' WHERE user_id = $1 AND dicabut_at IS NULL", [b.id]);
      } else {
        if (!b.password) throw bad('Password awal wajib diisi');
        ({ rows: [r] } = await c.query('INSERT INTO users (username, full_name, password_hash, role, skpd_id, unit_id, email, no_wa, wajib_ganti_password) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id, username, full_name, role, skpd_id, unit_id, email, no_wa, active',
          [String(b.username).toLowerCase().trim(), b.full_name, await hashPassword(b.password), b.role, clean(b.skpd_id), b.role === 'bendahara_pembantu' ? clean(b.unit_id) ?? null : null, clean(b.email) ?? null, clean(b.no_wa) ?? null]));
      }
      await audit(c, req.user, b.id ? 'user_ubah' : 'user_tambah', 'user', r.id, { username: r.username, role: r.role }, req.ip);
      return { row: r };
    });
  });
}
