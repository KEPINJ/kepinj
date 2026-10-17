import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { setorPajak } from '../lib/transaksi.js';
import { bad, notFound, int, isDate, money, scopeSkpd, canWrite, sendFile, XLSX, required } from '../lib/http.js';
import { buildWorkbook } from '../lib/excel.js';
import { buildCoretaxXml, validateForCoretax } from '../lib/coretax.js';
import * as tax from '../../../shared/tax.js';


/** Kalkulator: satu pintu untuk semua jenis perhitungan (dipakai juga oleh impor massal). */
export function hitung(type, p = {}) {
  switch (type) {
    case 'pph21_bulanan': return tax.pph21Bulanan({ bruto: p.bruto, status: p.status });
    case 'pph21_tahunan': return tax.pph21Tahunan(p);
    case 'pph21_bukan_pegawai': return tax.pph21BukanPegawai(p);
    case 'pph21_honor_asn': return tax.pph21HonorASN(p);
    case 'pph22': return tax.pph22Bendahara(p);
    case 'pph23': return tax.pph23(p);
    case 'pph4a2': return tax.pph4a2(p);
    case 'ppn': return tax.ppn(p);
    case 'potongan_belanja': return tax.potonganBelanja(p);
    default: throw bad(`Jenis perhitungan tidak dikenal: ${type}`);
  }
}

function filters(user, q) {
  const skpd = scopeSkpd(user, q.skpd_id);
  const params = [skpd, int(q.tahun, new Date().getFullYear())];
  const where = ['p.skpd_id = $1', 'p.tahun = $2'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (int(q.masa)) add('p.masa = ?', int(q.masa));
  if (q.jenis_pajak) add('p.jenis_pajak = ?', q.jenis_pajak);
  if (q.status) add('p.status = ?', q.status);
  if (q.form && q.form !== 'ALL') add("COALESCE(o.coretax_form, CASE WHEN p.jenis_pajak = 'PPN' THEN 'PPN' WHEN p.jenis_pajak = 'PPH21' THEN 'BP21' ELSE 'BPPU' END) = ?", q.form);
  if (q.q) add('(p.penerima_nama ILIKE ? OR p.penerima_npwp ILIKE ? OR p.dokumen_nomor ILIKE ?)'.replaceAll('?', `$${params.length + 1}`), `%${q.q}%`);
  return { skpd, params, where: where.join(' AND ') };
}

const SELECT = `SELECT p.*, o.nama AS objek_nama, o.coretax_form,
  COALESCE(o.coretax_form, CASE WHEN p.jenis_pajak = 'PPN' THEN 'PPN' WHEN p.jenis_pajak = 'PPH21' THEN 'BP21' ELSE 'BPPU' END) AS form
  FROM pajak p LEFT JOIN objek_pajak o ON o.kode = p.kode_objek`;

export async function insertPajak(c, user, skpd, list) {
  const out = [];
  for (const p of list) {
    if (!p.penerima_nama) throw bad('Nama penerima wajib diisi');
    if (!tax.STATUS_PTKP.includes(p.status_ptkp || 'TK/0')) throw bad(`Status PTKP tidak valid: ${p.status_ptkp}`);
    const { rows: [r] } = await c.query(`
      INSERT INTO pajak (skpd_id, tahun, masa, jenis_pajak, kode_objek, penerima_nama, penerima_npwp, penerima_nik, penerima_nitku, status_ptkp,
        dokumen_jenis, dokumen_nomor, dokumen_tanggal, dpp, tarif, nominal, ditanggung_pemerintah, keterangan, detail, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`, [
      skpd, int(p.tahun), int(p.masa), p.jenis_pajak, p.kode_objek || null, String(p.penerima_nama).slice(0, 200),
      p.penerima_npwp ? String(p.penerima_npwp).replace(/\D/g, '') : null, p.penerima_nik ? String(p.penerima_nik).replace(/\D/g, '') : null,
      p.penerima_nitku || null, p.status_ptkp || null, p.dokumen_jenis || null, p.dokumen_nomor || null,
      isDate(p.dokumen_tanggal) ? p.dokumen_tanggal : null, money(p.dpp), Number(p.tarif) || 0, money(p.nominal),
      Boolean(p.ditanggung_pemerintah), p.keterangan || null, p.detail || {}, user.id]);
    out.push(r);
  }
  if (out.length) await emit(c, 'pajak.created', String(skpd), { skpd_id: skpd, count: out.length, nominal: out.reduce((s, r) => s + Number(r.nominal), 0) });
  return out;
}

export default async function pajakRoutes(app) {
  app.post('/api/pajak/hitung', { preHandler: requireAuth }, async (req) => {
    required(req.body, ['type']);
    try { return hitung(req.body.type, req.body.params); } catch (e) { throw bad(e.message); }
  });

  app.get('/api/pajak/referensi', { preHandler: requireAuth }, async () => {
    const { rows } = await query('SELECT * FROM objek_pajak WHERE aktif ORDER BY jenis_pajak, kode');
    return { objek: rows, ter: tax.TER, status_ptkp: tax.STATUS_PTKP, jenis_belanja: tax.JENIS_BELANJA, lapisan: tax.LAPISAN_PASAL17.map(([a, t]) => [a === Infinity ? null : a, t]) };
  });

  app.get('/api/pajak', { preHandler: requireAuth }, async (req) => {
    const f = filters(req.user, req.query);
    const { rows } = await query(`${SELECT} WHERE ${f.where} ORDER BY p.masa, p.id LIMIT 5000`, f.params);
    const ringkasan = {};
    for (const r of rows) {
      ringkasan[r.status] = (ringkasan[r.status] || 0) + Number(r.nominal);
    }
    return { rows, ringkasan };
  });

  app.get('/api/pajak/rekap', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const { rows } = await query(`SELECT masa, jenis_pajak, status, COUNT(*)::int AS jumlah, SUM(dpp) AS dpp, SUM(nominal) AS nominal
      FROM pajak WHERE skpd_id = $1 AND tahun = $2 GROUP BY 1,2,3 ORDER BY 1,2,3`, [skpd, tahun]);
    return { tahun, rows };
  });

  app.post('/api/pajak', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [b];
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    items.forEach((p) => required(p, ['tahun', 'masa', 'jenis_pajak', 'penerima_nama']));
    return tx(async (c) => {
      const rows = await insertPajak(c, req.user, skpd, items);
      await audit(c, req.user, 'pajak_tambah', 'pajak', rows.map((r) => r.id).join(','), { jumlah: rows.length }, req.ip);
      return { rows };
    });
  });

  app.patch('/api/pajak/:id', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    return tx(async (c) => {
      const { rows: [p] } = await c.query('SELECT * FROM pajak WHERE id = $1 FOR UPDATE', [int(req.params.id)]);
      if (!p) throw notFound();
      canWrite(req.user, p.skpd_id);
      if (p.status === 'dilaporkan') throw bad('Bukti potong yang sudah dilaporkan tidak dapat diubah');
      const allowed = ['kode_objek', 'penerima_nama', 'penerima_npwp', 'penerima_nik', 'penerima_nitku', 'status_ptkp', 'dokumen_jenis', 'dokumen_nomor', 'dokumen_tanggal', 'keterangan', 'id_billing', 'no_bukti_potong'];
      const sets = []; const vals = [];
      for (const k of allowed) if (k in req.body) { vals.push(req.body[k] === '' ? null : req.body[k]); sets.push(`${k} = $${vals.length}`); }
      if (!p.bku_entry_id) for (const k of ['dpp', 'tarif', 'nominal']) if (k in req.body) { vals.push(Number(req.body[k])); sets.push(`${k} = $${vals.length}`); }
      if (!sets.length) return { row: p };
      vals.push(p.id);
      const { rows: [r] } = await c.query(`UPDATE pajak SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
      await audit(c, req.user, 'pajak_ubah', 'pajak', p.id, req.body, req.ip);
      return { row: r };
    });
  });

  app.delete('/api/pajak/:id', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    return tx(async (c) => {
      const { rows: [p] } = await c.query('SELECT * FROM pajak WHERE id = $1 FOR UPDATE', [int(req.params.id)]);
      if (!p) throw notFound();
      canWrite(req.user, p.skpd_id);
      if (p.bku_entry_id || p.status !== 'dipungut') throw bad('Hanya data pajak manual berstatus "dipungut" yang dapat dihapus. Gunakan koreksi BKU untuk pungutan yang tercatat.');
      await c.query('DELETE FROM pajak WHERE id = $1', [p.id]);
      await audit(c, req.user, 'pajak_hapus', 'pajak', p.id, p, req.ip);
      return { ok: true };
    });
  });

  // Penyetoran: catat NTPN & ID billing, dan bukukan pengeluaran setoran di BKU
  app.post('/api/pajak/setor', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['ids', 'ntpn', 'tanggal_setor']);
    return tx(async (c) => {
      const { rows: [first] } = await c.query('SELECT skpd_id FROM pajak WHERE id = $1', [Number(b.ids[0])]);
      if (!first) throw notFound();
      canWrite(req.user, first.skpd_id);
      const { rows, saved } = await setorPajak(c, req.user, b.ids, b);
      await audit(c, req.user, 'pajak_setor', 'pajak', rows.map((r) => r.id).join(','), { ntpn: b.ntpn, bku: saved.map((s) => s.id) }, req.ip);
      return { updated: rows.length, bku: saved };
    });
  });

  app.post('/api/pajak/lapor', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    required(req.body, ['ids']);
    return tx(async (c) => {
      const { rows } = await c.query(`UPDATE pajak SET status = 'dilaporkan', updated_at = now() WHERE id = ANY($1) AND status = 'disetor' RETURNING id, skpd_id`, [req.body.ids.map(Number)]);
      rows.forEach((r) => canWrite(req.user, r.skpd_id));
      await audit(c, req.user, 'pajak_lapor', 'pajak', rows.map((r) => r.id).join(','), null, req.ip);
      return { updated: rows.length };
    });
  });

  app.get('/api/pajak/coretax/preview', { preHandler: requireAuth }, async (req) => {
    const form = req.query.form || 'BPPU';
    const f = filters(req.user, { ...req.query, form });
    const { rows } = await query(`${SELECT} WHERE ${f.where} ORDER BY p.masa, p.id`, f.params);
    return { form, jumlah: rows.length, total_dpp: rows.reduce((s, r) => s + Number(r.dpp), 0), total_pajak: rows.reduce((s, r) => s + Number(r.nominal), 0), masalah: validateForCoretax(form, rows), rows };
  });

  app.get('/api/pajak/coretax/export', { preHandler: requireAuth }, async (req, reply) => {
    const form = req.query.form || 'BPPU';
    const f = filters(req.user, { ...req.query, form });
    const { rows } = await query(`${SELECT} WHERE ${f.where} ORDER BY p.masa, p.id`, f.params);
    if (!rows.length) throw bad('Tidak ada data untuk diekspor pada filter ini');
    const { rows: [skpd] } = await query('SELECT * FROM skpd WHERE id = $1', [f.skpd]);
    const tag = `${form}_${skpd.kode}_${req.query.tahun || ''}${req.query.masa ? `-${String(req.query.masa).padStart(2, '0')}` : ''}`;
    await tx((c) => audit(c, req.user, 'coretax_export', 'pajak', form, { jumlah: rows.length, format: req.query.format }, req.ip));
    if (req.query.format === 'xlsx' || form === 'PPN' || form === 'ALL') {
      const buf = await buildWorkbook({
        title: `${form === 'ALL' ? 'Buku Pembantu Pajak' : form === 'PPN' ? 'Daftar Pemungutan PPN' : `Daftar Bukti Potong ${form}`} - ${skpd.nama}`,
        subtitle: `NPWP Pemotong: ${skpd.npwp || '-'} | Tahun ${req.query.tahun || ''} Masa ${req.query.masa || 'semua'}`,
        sheetName: form,
        columns: [
          { key: 'masa', header: 'Masa', width: 7 }, { key: 'tahun', header: 'Tahun', width: 7 },
          { key: 'penerima_npwp', header: 'NPWP/NIK Penerima', width: 20 }, { key: 'penerima_nama', header: 'Nama Penerima', width: 30 },
          { key: 'status_ptkp', header: 'PTKP', width: 7 }, { key: 'kode_objek', header: 'Kode Objek Pajak', width: 14 },
          { key: 'dokumen_jenis', header: 'Jenis Dokumen', width: 16 }, { key: 'dokumen_nomor', header: 'Nomor Dokumen', width: 20 },
          { key: 'dokumen_tanggal', header: 'Tgl Dokumen', width: 12 }, { key: 'dpp', header: 'DPP / Bruto', type: 'money', width: 18 },
          { key: 'tarif', header: 'Tarif (%)', type: 'number', width: 9 }, { key: 'nominal', header: 'Pajak', type: 'money', width: 16 },
          { key: 'id_billing', header: 'ID Billing', width: 18 }, { key: 'ntpn', header: 'NTPN', width: 18 }, { key: 'status', header: 'Status', width: 11 },
        ],
        rows: rows.map((r) => ({ ...r, penerima_npwp: r.penerima_npwp || r.penerima_nik })),
        totals: { dpp: rows.reduce((s, r) => s + Number(r.dpp), 0), nominal: rows.reduce((s, r) => s + Number(r.nominal), 0) },
      });
      return sendFile(reply, buf, `${tag}.xlsx`, XLSX);
    }
    const issues = validateForCoretax(form, rows);
    if (issues.length && req.query.paksa !== '1') throw bad(`${issues.length} data belum valid untuk Coretax. Perbaiki dulu atau ekspor paksa.`, { masalah: issues });
    return sendFile(reply, buildCoretaxXml(form, skpd, rows), `${tag}.xml`, 'application/xml; charset=utf-8');
  });
}
