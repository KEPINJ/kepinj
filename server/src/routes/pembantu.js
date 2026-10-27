// Bendahara pengeluaran pembantu: pelimpahan UP dari bendahara pengeluaran (induk) ke unit kerja,
// BKU pembantu per unit, dan SPJ pembantu yang disahkan induk lalu dibukukan sebagai belanja di BKU induk.
import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, forbidden, notFound, int, isDate, money, scopeSkpd, canWrite, required } from '../lib/http.js';
import { insertSub } from '../lib/subledger.js';
import { insertEntries } from '../lib/ledger.js';
import { catatTransaksi, LABEL_PAJAK } from '../lib/transaksi.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';

/** Penulis BKU pembantu: admin atau bendahara pembantu yang ditugaskan pada unit tersebut. */
export function canWriteUnit(user, unit) {
  if (user.role === 'admin') return true;
  if (user.role === 'bendahara_pembantu' && user.unit_id === unit.id) return true;
  throw forbidden('Hanya bendahara pembantu unit ini atau admin yang dapat mencatat di BKU pembantu');
}

async function getUnit(c, id, lock = false) {
  const { rows: [u] } = await c.query(`SELECT * FROM unit_kerja WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [int(id)]);
  if (!u) throw notFound('Unit kerja tidak ditemukan');
  return u;
}

function lihatUnit(user, unit) {
  scopeSkpd(user, unit.skpd_id);
  if (user.role === 'bendahara_pembantu' && user.unit_id !== unit.id) throw forbidden('Anda hanya dapat melihat unit kerja Anda');
}

async function saldoUnit(c, unitId, tahun) {
  const { rows: [r] } = await c.query('SELECT COALESCE(SUM(penerimaan - pengeluaran),0)::float AS saldo FROM bpp_entries WHERE unit_id = $1 AND tahun = $2', [unitId, tahun]);
  return r.saldo;
}

const RINGKAS = `SELECT k.*,
    COALESCE(SUM(e.penerimaan) FILTER (WHERE e.jenis = 'PELIMPAHAN'),0)::float AS dilimpahkan,
    COALESCE(SUM(e.pengeluaran) FILTER (WHERE e.jenis = 'BELANJA'),0)::float AS belanja,
    COALESCE(SUM(e.penerimaan) FILTER (WHERE e.jenis = 'PAJAK_PUNGUT'),0)::float - COALESCE(SUM(e.pengeluaran) FILTER (WHERE e.jenis = 'SERAH_PAJAK'),0)::float AS pajak_ditahan,
    COALESCE(SUM(e.pengeluaran) FILTER (WHERE e.jenis = 'PENGEMBALIAN'),0)::float AS dikembalikan,
    COALESCE(SUM(e.penerimaan - e.pengeluaran),0)::float AS saldo,
    COALESCE(SUM(e.pengeluaran) FILTER (WHERE e.jenis = 'BELANJA' AND NOT EXISTS (SELECT 1 FROM spj_pembantu_rincian r WHERE r.bpp_entry_id = e.id)),0)::float AS belum_spj,
    MAX(e.tanggal) AS terakhir,
    (SELECT COUNT(*)::int FROM spj_pembantu s WHERE s.unit_id = k.id AND s.tahun = $2 AND s.status = 'diajukan') AS spj_diajukan,
    (SELECT string_agg(full_name, ', ') FROM users WHERE unit_id = k.id AND active) AS pengguna
  FROM unit_kerja k LEFT JOIN bpp_entries e ON e.unit_id = k.id AND e.tahun = $2`;

export async function ringkasanUnit(skpd, tahun, unitId = null) {
  const { rows } = await query(`${RINGKAS} WHERE k.skpd_id = $1 ${unitId ? 'AND k.id = $3' : ''} GROUP BY k.id ORDER BY k.kode`, unitId ? [skpd, tahun, unitId] : [skpd, tahun]);
  return rows;
}

daftarNotifikasi(async ({ user, skpd, tahun }) => {
  if (!['admin', 'bendahara'].includes(user.role)) return [];
  const { rows } = await query(`SELECT s.nomor, s.total_belanja, k.nama FROM spj_pembantu s JOIN unit_kerja k ON k.id = s.unit_id
    WHERE s.skpd_id = $1 AND s.tahun = $2 AND s.status = 'diajukan' ORDER BY s.diajukan_at`, [skpd, tahun]);
  if (!rows.length) return [];
  return [{ id: `spjp-${rows.map((r) => r.nomor).join(',')}`, tipe: 'pembantu', tingkat: 'info', judul: `${rows.length} SPJ bendahara pembantu menunggu pengesahan`,
    pesan: rows.slice(0, 2).map((r) => `${r.nama} (Rp ${Math.round(Number(r.total_belanja)).toLocaleString('id-ID')})`).join(', '), link: '/pembantu?tab=spj', tanggal: null }];
});

/** Pelimpahan UP: keluar dari BKU induk, masuk ke BKU pembantu. */
export async function limpahUp(c, user, unit, b) {
  required(b, ['tanggal', 'nilai']);
  const nilai = money(b.nilai);
  if (!(nilai > 0)) throw bad('Nilai pelimpahan harus lebih dari nol');
  const tahun = Number(b.tanggal.slice(0, 4));
  const { rows: [n] } = await c.query("SELECT COUNT(*)::int + 1 AS n FROM bpp_entries WHERE skpd_id = $1 AND tahun = $2 AND jenis = 'PELIMPAHAN' AND penerimaan > 0", [unit.skpd_id, tahun]);
  const noBukti = b.no_bukti || `LMP-${String(n.n).padStart(3, '0')}/${unit.kode}/${tahun}`;
  const metode = b.metode === 'tunai' ? 'tunai' : 'bank';
  const [induk] = await insertEntries(c, user, unit.skpd_id, [{ tanggal: b.tanggal, no_bukti: noBukti, jenis: 'PELIMPAHAN', metode, pengeluaran: nilai,
    uraian: b.uraian || `Pelimpahan UP kepada bendahara pengeluaran pembantu ${unit.nama}` }]);
  const [e] = await insertSub(c, 'bpp', unit.id, { skpd_id: unit.skpd_id, unit_id: unit.id }, user, [{ tanggal: b.tanggal, no_bukti: noBukti, jenis: 'PELIMPAHAN', metode,
    penerimaan: nilai, uraian: b.uraian || 'Penerimaan pelimpahan UP dari bendahara pengeluaran', induk_id: induk.id }]);
  await emit(c, 'pembantu.updated', String(unit.skpd_id), { skpd_id: unit.skpd_id, unit_id: unit.id, user: user.full_name });
  return { induk, entry: e };
}

/** Belanja oleh bendahara pembantu beserta potongan pajaknya (pajak ditahan sampai SPJ disahkan). */
export async function belanjaPembantu(c, user, unit, b) {
  required(b, ['tanggal', 'kode_rekening', 'uraian', 'nilai']);
  const nilai = money(b.nilai);
  if (!(nilai > 0)) throw bad('Nilai belanja harus lebih dari nol');
  const { rows: [rek] } = await c.query('SELECT jenis FROM rekening WHERE kode = $1', [b.kode_rekening]);
  if (!rek || rek.jenis !== 'belanja') throw bad('Pilih kode rekening belanja (5.x)');
  const pajak = (Array.isArray(b.pajak) ? b.pajak : []).filter((p) => Number(p.nominal) > 0).map((p) => ({ ...p, nominal: money(p.nominal), dpp: money(p.dpp) }));
  const potongan = pajak.reduce((s, p) => s + p.nominal, 0);
  const tahun = Number(b.tanggal.slice(0, 4));
  await c.query('SELECT 1 FROM unit_kerja WHERE id = $1 FOR UPDATE', [unit.id]);
  const saldo = await saldoUnit(c, unit.id, tahun);
  if (saldo + potongan < nilai) throw bad(`Saldo kas bendahara pembantu tidak cukup (tersedia Rp ${Math.round(saldo).toLocaleString('id-ID')}). Ajukan pelimpahan UP terlebih dahulu.`);
  const metode = b.metode === 'bank' ? 'bank' : 'tunai';
  const base = { skpd_id: unit.skpd_id, unit_id: unit.id };
  const [e] = await insertSub(c, 'bpp', unit.id, base, user, [{ tanggal: b.tanggal, no_bukti: b.no_bukti, jenis: 'BELANJA', kode_rekening: b.kode_rekening, rekanan_id: b.rekanan_id,
    uraian: b.uraian, pengeluaran: nilai, metode, pajak }]);
  if (pajak.length) {
    await insertSub(c, 'bpp', unit.id, base, user, pajak.map((p) => ({ tanggal: b.tanggal, no_bukti: b.no_bukti, jenis: 'PAJAK_PUNGUT', metode, penerimaan: p.nominal,
      induk_id: e.id, uraian: `Diterima ${LABEL_PAJAK[p.jenis_pajak] || p.jenis_pajak} atas ${b.uraian}`.slice(0, 1000) })));
  }
  await emit(c, 'pembantu.updated', String(unit.skpd_id), { skpd_id: unit.skpd_id, unit_id: unit.id, user: user.full_name });
  return e;
}

/** Ajukan SPJ atas belanja yang belum di-SPJ-kan sampai tanggal tertentu. */
export async function ajukanSpj(c, user, unit, b) {
  required(b, ['tanggal']);
  if (!isDate(b.tanggal)) throw bad('Tanggal SPJ tidak valid');
  const sampai = isDate(b.sampai) ? b.sampai : b.tanggal;
  const tahun = Number(sampai.slice(0, 4));
  const { rows } = await c.query(`SELECT e.* FROM bpp_entries e WHERE e.unit_id = $1 AND e.tahun = $2 AND e.jenis = 'BELANJA' AND e.tanggal <= $3
    AND NOT EXISTS (SELECT 1 FROM spj_pembantu_rincian r WHERE r.bpp_entry_id = e.id) ORDER BY e.no_urut`, [unit.id, tahun, sampai]);
  if (!rows.length) throw bad('Tidak ada belanja yang belum dipertanggungjawabkan sampai tanggal tersebut');
  const total = money(rows.reduce((s, r) => s + Number(r.pengeluaran), 0));
  const pajak = money(rows.reduce((s, r) => s + (r.pajak || []).reduce((a, p) => a + Number(p.nominal || 0), 0), 0));
  const { rows: [n] } = await c.query('SELECT COUNT(*)::int + 1 AS n FROM spj_pembantu WHERE unit_id = $1 AND tahun = $2', [unit.id, tahun]);
  const nomor = `${String(n.n).padStart(3, '0')}/SPJ-BPP/${unit.kode}/${tahun}`;
  const { rows: [s] } = await c.query(`INSERT INTO spj_pembantu (skpd_id, unit_id, tahun, nomor, tanggal, sampai, total_belanja, total_pajak, diajukan_oleh, catatan)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [unit.skpd_id, unit.id, tahun, nomor, b.tanggal, sampai, total, pajak, user.id, b.catatan || null]);
  for (const r of rows) await c.query('INSERT INTO spj_pembantu_rincian (bpp_entry_id, spj_id) VALUES ($1,$2)', [r.id, s.id]);
  await emit(c, 'pembantu.updated', String(unit.skpd_id), { skpd_id: unit.skpd_id, unit_id: unit.id, spj: nomor, user: user.full_name });
  return { spj: s, jumlah: rows.length };
}

/**
 * Pengesahan SPJ pembantu oleh bendahara pengeluaran. Di BKU induk: belanja (beserta pungutan pajak) dibukukan
 * dan pelimpahan yang terpakai dipertanggungjawabkan; di BKU pembantu: pajak yang ditahan diserahkan ke induk.
 */
export async function sahkanSpj(c, user, spjId, b = {}) {
  const { rows: [s] } = await c.query('SELECT * FROM spj_pembantu WHERE id = $1 FOR UPDATE', [int(spjId)]);
  if (!s) throw notFound('SPJ tidak ditemukan');
  canWrite(user, s.skpd_id);
  if (s.status !== 'diajukan') throw bad(`SPJ ini sudah ${s.status}`);
  const tanggal = isDate(b.tanggal) ? b.tanggal : new Date().toISOString().slice(0, 10);
  if (tanggal < s.tanggal) throw bad('Tanggal pengesahan tidak boleh sebelum tanggal pengajuan SPJ');
  const unit = await getUnit(c, s.unit_id);
  const { rows } = await c.query('SELECT e.* FROM spj_pembantu_rincian r JOIN bpp_entries e ON e.id = r.bpp_entry_id WHERE r.spj_id = $1 ORDER BY e.no_urut', [s.id]);
  const ids = [];
  for (const e of rows) {
    const { entry, pajak } = await catatTransaksi(c, user, s.skpd_id, { tanggal: e.tanggal, jenis: 'BELANJA', no_bukti: e.no_bukti, kode_rekening: e.kode_rekening,
      rekanan_id: e.rekanan_id, metode: 'bank', uraian: `${e.uraian} (BPP ${unit.nama})`, pengeluaran: Number(e.pengeluaran), pajak: e.pajak || [] });
    ids.push(entry.id, ...pajak.map((p) => p.bku_entry_id));
  }
  const [pj] = await insertEntries(c, user, s.skpd_id, [{ tanggal, no_bukti: s.nomor, jenis: 'PELIMPAHAN', metode: 'bank', penerimaan: Number(s.total_belanja),
    uraian: `Pertanggungjawaban pelimpahan UP ${unit.nama} (${s.nomor})` }]);
  ids.push(pj.id);
  if (Number(s.total_pajak) > 0) {
    await insertSub(c, 'bpp', unit.id, { skpd_id: unit.skpd_id, unit_id: unit.id }, user, [{ tanggal, no_bukti: s.nomor, jenis: 'SERAH_PAJAK', metode: 'bank',
      pengeluaran: Number(s.total_pajak), uraian: `Penyerahan pungutan pajak ${s.nomor} kepada bendahara pengeluaran untuk disetor` }]);
  }
  const { rows: [r] } = await c.query(`UPDATE spj_pembantu SET status = 'disahkan', bku_entry_ids = $2, diproses_oleh = $3, diproses_at = $4, catatan = COALESCE($5, catatan)
    WHERE id = $1 RETURNING *`, [s.id, ids, user.id, `${tanggal}T09:00:00+07:00`, b.catatan || null]);
  await emit(c, 'pembantu.updated', String(s.skpd_id), { skpd_id: s.skpd_id, unit_id: s.unit_id, spj: s.nomor, status: 'disahkan', user: user.full_name });
  return r;
}

export default async function pembantuRoutes(app) {
  app.get('/api/pembantu', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const unitId = req.user.role === 'bendahara_pembantu' ? req.user.unit_id || -1 : null;
    const [units, { rows: spj }] = await Promise.all([
      ringkasanUnit(skpd, tahun, unitId),
      query(`SELECT s.*, k.nama AS unit_nama, k.kode AS unit_kode, a.full_name AS diajukan_nama, p.full_name AS diproses_nama,
          (SELECT COUNT(*)::int FROM spj_pembantu_rincian r WHERE r.spj_id = s.id) AS jumlah
        FROM spj_pembantu s JOIN unit_kerja k ON k.id = s.unit_id LEFT JOIN users a ON a.id = s.diajukan_oleh LEFT JOIN users p ON p.id = s.diproses_oleh
        WHERE s.skpd_id = $1 AND s.tahun = $2 ${unitId ? 'AND s.unit_id = $3' : ''} ORDER BY s.status = 'diajukan' DESC, s.tanggal DESC, s.id DESC`, unitId ? [skpd, tahun, unitId] : [skpd, tahun]),
    ]);
    const sum = (k) => units.reduce((s, u) => s + u[k], 0);
    return { units, spj, ringkasan: { unit: units.filter((u) => u.aktif).length, dilimpahkan: sum('dilimpahkan'), belanja: sum('belanja'), saldo: sum('saldo'),
      belum_spj: sum('belum_spj'), pajak_ditahan: sum('pajak_ditahan'), spj_diajukan: spj.filter((s) => s.status === 'diajukan').length } };
  });

  app.post('/api/pembantu/unit', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['kode', 'nama']);
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    return tx(async (c) => {
      const vals = [skpd, String(b.kode).trim().toUpperCase().slice(0, 20), String(b.nama).trim(), b.bendahara_nama || null, b.bendahara_nip || null, b.aktif !== false];
      const { rows: [u] } = b.id
        ? await c.query('UPDATE unit_kerja SET kode = $2, nama = $3, bendahara_nama = $4, bendahara_nip = $5, aktif = $6 WHERE id = $7 AND skpd_id = $1 RETURNING *', [...vals, int(b.id)])
        : await c.query('INSERT INTO unit_kerja (skpd_id, kode, nama, bendahara_nama, bendahara_nip, aktif) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', vals);
      if (!u) throw notFound();
      await audit(c, req.user, b.id ? 'unit_ubah' : 'unit_tambah', 'unit_kerja', u.id, { kode: u.kode, nama: u.nama }, req.ip);
      return { unit: u };
    });
  });

  app.get('/api/pembantu/unit/:id', { preHandler: requireAuth }, async (req) => {
    const unit = await getUnit({ query: (...a) => query(...a) }, req.params.id);
    lihatUnit(req.user, unit);
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const [[ring], { rows }] = await Promise.all([
      ringkasanUnit(unit.skpd_id, tahun, unit.id),
      query(`SELECT e.*, k.nama AS rekening_nama, rk.nama AS rekanan_nama, s.nomor AS spj_nomor, s.status AS spj_status, u.full_name AS dibuat_oleh,
          SUM(e.penerimaan - e.pengeluaran) OVER (ORDER BY e.no_urut) AS saldo
        FROM bpp_entries e LEFT JOIN rekening k ON k.kode = e.kode_rekening LEFT JOIN rekanan rk ON rk.id = e.rekanan_id
        LEFT JOIN spj_pembantu_rincian r ON r.bpp_entry_id = e.id LEFT JOIN spj_pembantu s ON s.id = r.spj_id LEFT JOIN users u ON u.id = e.created_by
        WHERE e.unit_id = $1 AND e.tahun = $2 ORDER BY e.no_urut`, [unit.id, tahun]),
    ]);
    return { unit: ring || unit, rows };
  });

  const aksiUnit = (path, roles, fn, action) => app.post(`/api/pembantu/unit/:id/${path}`, { preHandler: requireRole(...roles) }, async (req) => {
    const b = req.body || {};
    if (b.tanggal && !isDate(b.tanggal)) throw bad('Tanggal tidak valid');
    return tx(async (c) => {
      const unit = await getUnit(c, req.params.id);
      if (!unit.aktif) throw bad('Unit kerja tidak aktif');
      const out = await fn(c, req.user, unit, b);
      await audit(c, req.user, action, 'unit_kerja', unit.id, { ...b, pajak: undefined }, req.ip);
      return out;
    });
  });

  aksiUnit('limpah', ['admin', 'bendahara'], (c, user, unit, b) => { canWrite(user, unit.skpd_id); return limpahUp(c, user, unit, b); }, 'pembantu_limpah');
  aksiUnit('belanja', ['admin', 'bendahara_pembantu'], async (c, user, unit, b) => { canWriteUnit(user, unit); return { entry: await belanjaPembantu(c, user, unit, b) }; }, 'pembantu_belanja');
  aksiUnit('spj', ['admin', 'bendahara_pembantu'], (c, user, unit, b) => { canWriteUnit(user, unit); return ajukanSpj(c, user, unit, b); }, 'pembantu_spj_ajukan');
  aksiUnit('kembali', ['admin', 'bendahara_pembantu'], async (c, user, unit, b) => {
    canWriteUnit(user, unit);
    required(b, ['tanggal', 'nilai']);
    const nilai = money(b.nilai);
    const saldo = await saldoUnit(c, unit.id, Number(b.tanggal.slice(0, 4)));
    if (!(nilai > 0) || nilai > saldo + 0.001) throw bad(`Nilai pengembalian harus antara 1 dan saldo kas (Rp ${Math.round(saldo).toLocaleString('id-ID')})`);
    const { rows: [diajukan] } = await c.query("SELECT COUNT(*)::int AS n FROM spj_pembantu WHERE unit_id = $1 AND status = 'diajukan'", [unit.id]);
    const noBukti = b.no_bukti || `KMB-${unit.kode}/${b.tanggal.replaceAll('-', '')}`;
    const [e] = await insertSub(c, 'bpp', unit.id, { skpd_id: unit.skpd_id, unit_id: unit.id }, user, [{ tanggal: b.tanggal, no_bukti: noBukti, jenis: 'PENGEMBALIAN', metode: 'bank',
      pengeluaran: nilai, uraian: b.uraian || 'Pengembalian sisa UP kepada bendahara pengeluaran' }]);
    await insertEntries(c, user, unit.skpd_id, [{ tanggal: b.tanggal, no_bukti: noBukti, jenis: 'PELIMPAHAN', metode: 'bank', penerimaan: nilai,
      uraian: `Penerimaan pengembalian sisa UP dari bendahara pembantu ${unit.nama}` }]);
    await emit(c, 'pembantu.updated', String(unit.skpd_id), { skpd_id: unit.skpd_id, unit_id: unit.id, user: user.full_name });
    return { entry: e, peringatan: diajukan.n ? 'Masih ada SPJ yang menunggu pengesahan' : null };
  }, 'pembantu_kembali');

  app.get('/api/pembantu/spj/:id', { preHandler: requireAuth }, async (req) => {
    const { rows: [s] } = await query(`SELECT s.*, a.full_name AS diajukan_nama, p.full_name AS diproses_nama FROM spj_pembantu s
      LEFT JOIN users a ON a.id = s.diajukan_oleh LEFT JOIN users p ON p.id = s.diproses_oleh WHERE s.id = $1`, [int(req.params.id)]);
    if (!s) throw notFound('SPJ tidak ditemukan');
    const unit = await getUnit({ query: (...a) => query(...a) }, s.unit_id);
    lihatUnit(req.user, unit);
    const [{ rows }, { rows: [skpd] }, { rows: perRek }] = await Promise.all([
      query(`SELECT e.*, k.nama AS rekening_nama, rk.nama AS rekanan_nama FROM spj_pembantu_rincian r JOIN bpp_entries e ON e.id = r.bpp_entry_id
        LEFT JOIN rekening k ON k.kode = e.kode_rekening LEFT JOIN rekanan rk ON rk.id = e.rekanan_id WHERE r.spj_id = $1 ORDER BY e.no_urut`, [s.id]),
      query('SELECT * FROM skpd WHERE id = $1', [s.skpd_id]),
      query(`SELECT e.kode_rekening, k.nama, SUM(e.pengeluaran)::float AS nilai, COUNT(*)::int AS jumlah FROM spj_pembantu_rincian r JOIN bpp_entries e ON e.id = r.bpp_entry_id
        LEFT JOIN rekening k ON k.kode = e.kode_rekening WHERE r.spj_id = $1 GROUP BY 1,2 ORDER BY 1`, [s.id]),
    ]);
    return { spj: s, unit, skpd, rincian: rows, per_rekening: perRek };
  });

  app.post('/api/pembantu/spj/:id/sahkan', { preHandler: requireRole('admin', 'bendahara') }, async (req) => tx(async (c) => {
    const r = await sahkanSpj(c, req.user, req.params.id, req.body || {});
    await audit(c, req.user, 'pembantu_spj_sahkan', 'spj_pembantu', r.id, { nomor: r.nomor, total: r.total_belanja }, req.ip);
    return { spj: r };
  }));

  app.post('/api/pembantu/spj/:id/tolak', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['catatan']);
    return tx(async (c) => {
      const { rows: [s] } = await c.query('SELECT * FROM spj_pembantu WHERE id = $1 FOR UPDATE', [int(req.params.id)]);
      if (!s) throw notFound('SPJ tidak ditemukan');
      canWrite(req.user, s.skpd_id);
      if (s.status !== 'diajukan') throw bad(`SPJ ini sudah ${s.status}`);
      // Belanja dilepas agar dapat diperbaiki dan diajukan kembali pada SPJ berikutnya
      await c.query('DELETE FROM spj_pembantu_rincian WHERE spj_id = $1', [s.id]);
      const { rows: [r] } = await c.query("UPDATE spj_pembantu SET status = 'ditolak', catatan = $2, diproses_oleh = $3, diproses_at = now() WHERE id = $1 RETURNING *", [s.id, b.catatan, req.user.id]);
      await audit(c, req.user, 'pembantu_spj_tolak', 'spj_pembantu', s.id, { nomor: s.nomor, catatan: b.catatan }, req.ip);
      await emit(c, 'pembantu.updated', String(s.skpd_id), { skpd_id: s.skpd_id, unit_id: s.unit_id, spj: s.nomor, status: 'ditolak', user: req.user.full_name });
      return { spj: r };
    });
  });
}
