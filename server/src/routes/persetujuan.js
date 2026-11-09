// Persetujuan berjenjang untuk SPP dan SPJ fungsional bulanan. Tahapan dan perannya diatur admin
// (bawaan: verifikasi PPK-SKPD lalu persetujuan PA/KPA). SPM baru dapat terbit setelah SPP disetujui
// semua tahap; tutup buku bulanan menunggu SPJ disahkan bila diwajibkan.
import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, forbidden, notFound, int, scopeSkpd, canWrite, required } from '../lib/http.js';
import { getPengaturan, simpanPengaturan } from '../lib/pengaturan.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { NAMA_BULAN } from '../lib/kalender.js';
import { setelStatus, tahapUntuk, lengkapiKelengkapan } from '../lib/statusbku.js';
import { kirimNotifikasi } from '../lib/kirimnotif.js';
import { JENIS_DOKUMEN } from '../../../shared/dokumen.js';
import { JENIS_BKU } from '../lib/ledger.js';

const PERAN = ['verifikator', 'pimpinan', 'admin', 'bendahara'];

/** Mulai (atau ulang) alur persetujuan; putaran sebelumnya yang belum selesai dibatalkan. */
export async function buatAlur(c, objek, objekId, skpd, tahun, alurKhusus) {
  const alur = alurKhusus || (await getPengaturan())[`alur_${objek}`] || [];
  if (!alur.length) return [];
  const { rows: [m] } = await c.query('SELECT COALESCE(MAX(putaran),0)::int AS p FROM persetujuan WHERE objek = $1 AND objek_id = $2', [objek, String(objekId)]);
  await c.query("UPDATE persetujuan SET status = 'batal' WHERE objek = $1 AND objek_id = $2 AND status IN ('antre','menunggu')", [objek, String(objekId)]);
  const out = [];
  for (const [i, t] of alur.entries()) {
    const { rows: [r] } = await c.query(`INSERT INTO persetujuan (objek, objek_id, skpd_id, tahun, putaran, urutan, peran, label, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [objek, String(objekId), skpd, tahun, m.p + 1, i + 1, t.peran, t.label, i === 0 ? 'menunggu' : 'antre']);
    out.push(r);
  }
  return out;
}

/** Status alur terakhir: tanpa | proses | disetujui | ditolak, beserta tahapannya. */
export async function statusAlur(c, objek, objekId) {
  const { rows } = await c.query(`SELECT p.*, u.full_name AS oleh_nama FROM persetujuan p LEFT JOIN users u ON u.id = p.oleh
    WHERE p.objek = $1 AND p.objek_id = $2 AND p.putaran = (SELECT MAX(putaran) FROM persetujuan WHERE objek = $1 AND objek_id = $2) ORDER BY p.urutan`, [objek, String(objekId)]);
  return { status: ringkas(rows), tahap: rows };
}

function ringkas(rows) {
  if (!rows.length) return 'tanpa';
  if (rows.some((r) => r.status === 'tolak')) return 'ditolak';
  if (rows.every((r) => r.status === 'setuju')) return 'disetujui';
  if (rows.every((r) => r.status === 'batal')) return 'tanpa';
  return 'proses';
}

/** Status alur untuk banyak objek sekaligus (dipakai daftar SPP dan SPJ). */
export async function statusBanyak(objek, ids) {
  if (!ids.length) return {};
  const { rows } = await query(`SELECT p.*, u.full_name AS oleh_nama FROM persetujuan p LEFT JOIN users u ON u.id = p.oleh
    WHERE p.objek = $1 AND p.objek_id = ANY($2) AND p.putaran = (SELECT MAX(putaran) FROM persetujuan q WHERE q.objek = p.objek AND q.objek_id = p.objek_id) ORDER BY p.urutan`, [objek, ids.map(String)]);
  const out = {};
  for (const r of rows) (out[r.objek_id] ||= []).push(r);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { status: ringkas(v), tahap: v }]));
}

export const bolehPutuskan = (user, t) => user.role === 'admin' || user.role === t.peran;

export async function putuskan(c, user, id, setuju, catatan) {
  const { rows: [t] } = await c.query('SELECT * FROM persetujuan WHERE id = $1 FOR UPDATE', [int(id)]);
  if (!t) throw notFound('Tahap persetujuan tidak ditemukan');
  scopeSkpd(user, t.skpd_id);
  if (t.status !== 'menunggu') throw bad('Tahap ini tidak sedang menunggu keputusan');
  if (!bolehPutuskan(user, t)) throw forbidden(`Tahap "${t.label}" diputuskan oleh peran ${t.peran}`);
  if (!setuju && !String(catatan || '').trim()) throw bad('Alasan penolakan wajib diisi');
  let entri = null;
  if (t.objek === 'bku') {
    ({ rows: [entri] } = await c.query(`SELECT e.id, e.no_urut, e.uraian, e.created_by, e.penerimaan, e.pengeluaran, s.dokumen_status, s.dokumen_kurang, s.status
      FROM bku_entries e JOIN bku_status s ON s.entry_id = e.id WHERE e.id = $1`, [int(t.objek_id)]));
    if (!entri) throw notFound('Transaksi tidak ditemukan');
    if (entri.status === 'dikoreksi') throw bad('Transaksi sudah dikoreksi (jurnal balik) sehingga tidak perlu diputuskan');
    if (setuju && (await getPengaturan()).persetujuan_wajib_dokumen && ['sebagian', 'belum'].includes(entri.dokumen_status)) {
      throw bad(`Dokumen bukti No. ${entri.no_urut} belum lengkap: ${entri.dokumen_kurang.map((j) => JENIS_DOKUMEN[j] || j).join(', ')}. Tolak dengan catatan agar bendahara melengkapinya.`);
    }
  }
  await c.query('UPDATE persetujuan SET status = $2, catatan = $3, oleh = $4, waktu = now() WHERE id = $1', [t.id, setuju ? 'setuju' : 'tolak', catatan || null, user.id]);
  if (setuju) {
    await c.query("UPDATE persetujuan SET status = 'menunggu' WHERE objek = $1 AND objek_id = $2 AND putaran = $3 AND urutan = $4 AND status = 'antre'", [t.objek, t.objek_id, t.putaran, t.urutan + 1]);
  } else {
    await c.query("UPDATE persetujuan SET status = 'batal' WHERE objek = $1 AND objek_id = $2 AND putaran = $3 AND status = 'antre'", [t.objek, t.objek_id, t.putaran]);
    if (t.objek === 'spp') {
      await c.query("UPDATE spp SET status = 'ditolak', catatan = $2, updated_at = now() WHERE id = $1 AND status = 'spp'", [int(t.objek_id), `Ditolak pada tahap ${t.label}: ${catatan}`]);
    }
  }
  const st = await statusAlur(c, t.objek, t.objek_id);
  if (t.objek === 'bku') {
    const berikut = st.tahap.find((x) => x.status === 'menunggu');
    await setelStatus(c, int(t.objek_id), st.status === 'disetujui' ? { status: 'disetujui', catatan: catatan || null }
      : st.status === 'ditolak' ? { status: 'ditolak', catatan: `Ditolak pada tahap ${t.label}: ${catatan}` }
        : { status: 'menunggu', tahap: berikut?.label, peran: berikut?.peran });
    if (!setuju) {
      await kirimNotifikasi(c, { skpd_id: t.skpd_id, user_id: entri.created_by, kategori: 'persetujuan', tingkat: 'bahaya',
        judul: `Transaksi BKU No. ${entri.no_urut} ditolak`, pesan: `${t.label} oleh ${user.full_name}: “${catatan}”. ${entri.uraian.slice(0, 80)}`,
        link: `/bku?id=${entri.id}`, ref: `bku:${entri.id}` });
    }
  }
  await emit(c, 'persetujuan.updated', String(t.skpd_id), { skpd_id: t.skpd_id, objek: t.objek, objek_id: t.objek_id, status: st.status, tahap: t.label, setuju, user: user.full_name });
  if (t.objek === 'spp') await emit(c, 'spp.updated', String(t.skpd_id), { skpd_id: t.skpd_id, id: int(t.objek_id), status: setuju ? 'disetujui' : 'ditolak', user: user.full_name });
  return { ...st, keputusan: { ...t, status: setuju ? 'setuju' : 'tolak' } };
}

/** Status pengesahan SPJ per bulan untuk satu SKPD/tahun. */
export async function statusSpj(skpd, tahun) {
  const ids = Array.from({ length: 12 }, (_, i) => `${skpd}/${tahun}/${i + 1}`);
  const st = await statusBanyak('spj', ids);
  return Array.from({ length: 12 }, (_, i) => ({ bulan: i + 1, ...(st[ids[i]] || { status: 'tanpa', tahap: [] }) }));
}

daftarNotifikasi(async ({ user, skpd, tahun }) => {
  if (!['admin', 'verifikator', 'pimpinan'].includes(user.role)) return [];
  const { rows: [r] } = await query(`SELECT COUNT(*) FILTER (WHERE objek <> 'bku')::int AS n, COUNT(*) FILTER (WHERE objek = 'spp')::int AS spp,
      COUNT(*) FILTER (WHERE objek = 'bku')::int AS bku FROM persetujuan
    WHERE skpd_id = $1 AND tahun = $2 AND status = 'menunggu' AND ($3 = 'admin' OR peran = $3)`, [skpd, tahun, user.role]);
  const out = [];
  if (r.bku) {
    out.push({ id: `setuju-bku-${r.bku}`, tipe: 'persetujuan', kategori: 'persetujuan', tingkat: 'peringatan', judul: `${r.bku.toLocaleString('id-ID')} transaksi BKU menunggu ${user.role === 'pimpinan' ? 'persetujuan' : 'verifikasi'} Anda`,
      pesan: 'Periksa kelengkapan bukti lalu setujui atau tolak dengan alasan.', link: '/persetujuan?tab=bku', tanggal: null });
  }
  if (r.n) {
    out.push({ id: `setuju-${r.n}`, tipe: 'persetujuan', kategori: 'persetujuan', tingkat: 'peringatan', judul: `${r.n} dokumen SPP/SPJ menunggu persetujuan Anda`,
      pesan: `${r.spp} SPP dan ${r.n - r.spp} SPJ fungsional menunggu keputusan.`, link: '/persetujuan?tab=dokumen', tanggal: null });
  }
  return out;
});

export default async function persetujuanRoutes(app) {
  app.get('/api/persetujuan', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const { rows } = await query(`SELECT p.*, u.full_name AS oleh_nama FROM persetujuan p LEFT JOIN users u ON u.id = p.oleh
      WHERE p.skpd_id = $1 AND p.tahun = $2 AND p.objek <> 'bku' AND p.putaran = (SELECT MAX(putaran) FROM persetujuan q WHERE q.objek = p.objek AND q.objek_id = p.objek_id)
      ORDER BY p.objek, p.objek_id, p.urutan`, [skpd, tahun]);
    const grup = new Map();
    for (const r of rows) {
      const k = `${r.objek}:${r.objek_id}`;
      if (!grup.has(k)) grup.set(k, { objek: r.objek, objek_id: r.objek_id, putaran: r.putaran, tahap: [] });
      grup.get(k).tahap.push(r);
    }
    const items = [...grup.values()];
    const sppIds = items.filter((i) => i.objek === 'spp').map((i) => int(i.objek_id));
    const { rows: spp } = sppIds.length ? await query(`SELECT s.id, s.nomor_spp, s.jenis, s.nilai, s.uraian, s.tanggal_spp, s.status, rk.nama AS rekanan_nama, u.full_name AS dibuat_oleh
      FROM spp s LEFT JOIN rekanan rk ON rk.id = s.rekanan_id LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ANY($1)`, [sppIds]) : { rows: [] };
    const { rows: spj } = await query(`SELECT EXTRACT(MONTH FROM tanggal)::int AS bulan, COALESCE(SUM(pengeluaran) FILTER (WHERE jenis = 'BELANJA'),0)::float AS belanja, COUNT(*)::int AS transaksi
      FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 GROUP BY 1`, [skpd, tahun]);
    const out = items.map((i) => {
      const menunggu = i.tahap.find((t) => t.status === 'menunggu');
      const detail = i.objek === 'spp' ? spp.find((s) => s.id === int(i.objek_id))
        : (() => { const b = Number(i.objek_id.split('/')[2]); const x = spj.find((s) => s.bulan === b); return { bulan: b, nama: `SPJ Fungsional ${NAMA_BULAN[b - 1]} ${tahun}`, belanja: x?.belanja || 0, transaksi: x?.transaksi || 0 }; })();
      const terakhir = i.tahap.filter((t) => t.waktu).map((t) => t.waktu).sort().pop() || i.tahap[0].created_at;
      return { ...i, status: ringkas(i.tahap), menunggu: menunggu || null, giliran_saya: Boolean(menunggu && bolehPutuskan(req.user, menunggu)), detail, terakhir };
    }).sort((a, b) => Number(b.giliran_saya) - Number(a.giliran_saya) || String(b.terakhir).localeCompare(String(a.terakhir)));
    const cfg = await getPengaturan();
    return { items: out, alur: { spp: cfg.alur_spp, spj: cfg.alur_spj, bku: cfg.alur_bku }, bku_ambang_pimpinan: cfg.bku_ambang_pimpinan,
      alur_bku_aktif: cfg.alur_bku_aktif, persetujuan_wajib_dokumen: cfg.persetujuan_wajib_dokumen };
  });

  app.post('/api/persetujuan/:id/setuju', { preHandler: requireAuth }, async (req) => tx(async (c) => {
    const r = await putuskan(c, req.user, req.params.id, true, req.body?.catatan);
    await audit(c, req.user, 'persetujuan_setuju', r.keputusan.objek, r.keputusan.objek_id, { tahap: r.keputusan.label, catatan: req.body?.catatan || null }, req.ip);
    return r;
  }));
  app.post('/api/persetujuan/:id/tolak', { preHandler: requireAuth }, async (req) => tx(async (c) => {
    const r = await putuskan(c, req.user, req.params.id, false, req.body?.catatan);
    await audit(c, req.user, 'persetujuan_tolak', r.keputusan.objek, r.keputusan.objek_id, { tahap: r.keputusan.label, catatan: req.body?.catatan }, req.ip);
    return r;
  }));

  app.get('/api/spj/pengesahan', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    return { bulan: await statusSpj(skpd, int(req.query.tahun, new Date().getFullYear())), wajib: (await getPengaturan()).spj_wajib_disahkan };
  });

  app.post('/api/spj/ajukan', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['tahun', 'bulan']);
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    const tahun = int(b.tahun); const bulan = int(b.bulan);
    const now = new Date();
    if (tahun > now.getFullYear() || (tahun === now.getFullYear() && bulan > now.getMonth() + 1)) throw bad('SPJ hanya untuk bulan yang sedang berjalan atau sudah lewat');
    return tx(async (c) => {
      const id = `${skpd}/${tahun}/${bulan}`;
      const st = await statusAlur(c, 'spj', id);
      if (st.status === 'proses') throw bad('SPJ bulan ini sedang dalam proses persetujuan');
      if (st.status === 'disetujui') throw bad('SPJ bulan ini sudah disahkan');
      const tahap = await buatAlur(c, 'spj', id, skpd, tahun);
      if (!tahap.length) throw bad('Alur persetujuan SPJ belum diatur');
      await audit(c, req.user, 'spj_ajukan', 'spj', id, { bulan: NAMA_BULAN[bulan - 1] }, req.ip);
      await emit(c, 'persetujuan.updated', String(skpd), { skpd_id: skpd, objek: 'spj', objek_id: id, status: 'proses', user: req.user.full_name });
      return { tahap };
    });
  });

  // ---------- Persetujuan berjenjang transaksi BKU ----------
  // Kotak masuk transaksi: filter giliran saya / status / tahap, dengan kelengkapan dokumen
  app.get('/api/persetujuan/bku', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const p = [skpd, tahun]; const where = ['s.skpd_id = $1', 's.tahun = $2', 's.induk_id IS NULL'];
    const f = req.query.filter || 'saya';
    if (f === 'saya') {
      p.push(req.user.role);
      where.push(`s.status = 'menunggu' AND ($${p.length} = 'admin' OR s.peran_menunggu = $${p.length})`);
    } else if (['menunggu', 'disetujui', 'ditolak', 'dikoreksi'].includes(f)) { p.push(f); where.push(`s.status = $${p.length}`); }
    if (req.query.peran) { p.push(req.query.peran); where.push(`s.peran_menunggu = $${p.length}`); }
    if (req.query.dokumen === 'lengkap') where.push("s.dokumen_status IN ('lengkap','tidak_wajib')");
    else if (req.query.dokumen === 'kurang') where.push("s.dokumen_status IN ('sebagian','belum')");
    if (req.query.q) { p.push(`%${req.query.q}%`); where.push(`(e.uraian ILIKE $${p.length} OR e.no_bukti ILIKE $${p.length})`); }
    const pageSize = Math.min(int(req.query.pageSize, 25), 200);
    const page = Math.max(int(req.query.page, 1), 1);
    const { rows } = await query(`SELECT e.id, e.no_urut, e.tanggal, e.no_bukti, e.jenis, e.uraian, e.kode_rekening, e.metode, e.penerimaan, e.pengeluaran, e.created_at,
        u.full_name AS dibuat_oleh, rk.nama AS rekanan_nama, s.status, s.tahap, s.peran_menunggu, s.putaran, s.catatan, s.dokumen_status, s.dokumen_kurang, s.diperbarui_at,
        (SELECT COUNT(*) FROM lampiran l WHERE l.bku_entry_id = e.id AND l.dihapus_at IS NULL)::int AS jumlah_lampiran,
        COALESCE((SELECT SUM(x.penerimaan) FROM bku_status c JOIN bku_entries x ON x.id = c.entry_id WHERE c.induk_id = e.id), 0) AS potongan_pajak,
        COUNT(*) OVER () AS total_rows
      FROM bku_status s JOIN bku_entries e ON e.id = s.entry_id AND e.skpd_id = s.skpd_id AND e.tahun = s.tahun
      LEFT JOIN users u ON u.id = e.created_by LEFT JOIN rekanan rk ON rk.id = e.rekanan_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${f === 'saya' || f === 'menunggu' ? 'e.tanggal, e.no_urut' : 's.diperbarui_at DESC, e.no_urut DESC'} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, p);
    const total = rows[0]?.total_rows ?? 0;
    const tahap = await statusBanyak('bku', rows.map((r) => r.id));
    const items = rows.map(({ total_rows: _, ...r }) => {
      const t = tahap[String(r.id)]?.tahap || [];
      const menunggu = t.find((x) => x.status === 'menunggu') || null;
      return { ...r, tahap_alur: t, menunggu, giliran_saya: Boolean(menunggu && bolehPutuskan(req.user, menunggu)) };
    });
    const { rows: [hit] } = await query(`SELECT COUNT(*) FILTER (WHERE status = 'menunggu')::int AS menunggu,
        COUNT(*) FILTER (WHERE status = 'menunggu' AND ($3 = 'admin' OR peran_menunggu = $3))::int AS saya,
        COUNT(*) FILTER (WHERE status = 'menunggu' AND peran_menunggu = 'verifikator')::int AS di_verifikator,
        COUNT(*) FILTER (WHERE status = 'menunggu' AND peran_menunggu = 'pimpinan')::int AS di_pimpinan,
        COUNT(*) FILTER (WHERE status = 'disetujui')::int AS disetujui, COUNT(*) FILTER (WHERE status = 'ditolak')::int AS ditolak,
        COUNT(*) FILTER (WHERE status = 'dikoreksi')::int AS dikoreksi,
        COUNT(*) FILTER (WHERE status = 'menunggu' AND dokumen_status IN ('sebagian','belum'))::int AS menunggu_dokumen_kurang
      FROM bku_status WHERE skpd_id = $1 AND tahun = $2 AND induk_id IS NULL`, [skpd, tahun, req.user.role]);
    return { items, total, page, pageSize, hitung: hit, jenis: JENIS_BKU };
  });

  // Riwayat persetujuan lengkap (semua putaran) untuk satu transaksi
  app.get('/api/bku/:id/persetujuan', { preHandler: requireAuth }, async (req) => {
    const { rows: [s] } = await query('SELECT * FROM bku_status WHERE entry_id = $1', [int(req.params.id)]);
    if (!s) throw notFound();
    scopeSkpd(req.user, s.skpd_id);
    const { rows } = await query(`SELECT p.*, u.full_name AS oleh_nama FROM persetujuan p LEFT JOIN users u ON u.id = p.oleh
      WHERE p.objek = 'bku' AND p.objek_id = $1 ORDER BY p.putaran DESC, p.urutan`, [String(s.induk_id || s.entry_id)]);
    const putaran = [...new Set(rows.map((r) => r.putaran))].map((n) => ({ putaran: n, tahap: rows.filter((r) => r.putaran === n) }));
    const terkini = putaran[0]?.tahap || [];
    const menunggu = terkini.find((t) => t.status === 'menunggu') || null;
    return { status: s, putaran, menunggu, giliran_saya: Boolean(menunggu && bolehPutuskan(req.user, menunggu)) };
  });

  // Ajukan ulang transaksi yang ditolak setelah bukti dilengkapi
  app.post('/api/bku/:id/ajukan-ulang', { preHandler: requireRole('admin', 'bendahara') }, async (req) => tx(async (c) => {
    const { rows: [e] } = await c.query('SELECT e.*, s.status, s.putaran FROM bku_entries e JOIN bku_status s ON s.entry_id = e.id WHERE e.id = $1 FOR UPDATE OF s', [int(req.params.id)]);
    if (!e) throw notFound();
    canWrite(req.user, e.skpd_id);
    if (e.status !== 'ditolak') throw bad('Hanya transaksi berstatus ditolak yang dapat diajukan ulang');
    const tahap = await buatAlur(c, 'bku', e.id, e.skpd_id, e.tahun, tahapUntuk(e, await getPengaturan()));
    const catatan = String(req.body?.catatan || '').trim() || null;
    await setelStatus(c, e.id, { status: 'menunggu', tahap: tahap[0]?.label, peran: tahap[0]?.peran, catatan: catatan ? `Diajukan ulang: ${catatan}` : 'Diajukan ulang', putaran: tahap[0]?.putaran });
    await audit(c, req.user, 'bku_ajukan_ulang', 'bku', e.id, { catatan, putaran: tahap[0]?.putaran }, req.ip);
    await emit(c, 'persetujuan.updated', String(e.skpd_id), { skpd_id: e.skpd_id, objek: 'bku', objek_id: String(e.id), status: 'proses', user: req.user.full_name, ulang: true });
    return { tahap };
  }));

  // Keputusan massal (mis. verifikator memverifikasi puluhan transaksi sekaligus); kegagalan satu item tidak membatalkan yang lain
  app.post('/api/persetujuan/massal', { preHandler: requireAuth }, async (req) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 500);
    if (!ids.length) throw bad('Pilih tahap persetujuan yang akan diputuskan');
    const setuju = req.body?.setuju !== false;
    return tx(async (c) => {
      const berhasil = []; const gagal = [];
      for (const id of ids) {
        await c.query('SAVEPOINT satu');
        try {
          const r = await putuskan(c, req.user, id, setuju, req.body?.catatan);
          await c.query('RELEASE SAVEPOINT satu');
          berhasil.push({ id, objek_id: r.keputusan.objek_id, status: r.status });
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT satu');
          gagal.push({ id, alasan: e.message });
        }
      }
      await audit(c, req.user, setuju ? 'persetujuan_setuju_massal' : 'persetujuan_tolak_massal', 'persetujuan', null, { berhasil: berhasil.length, gagal: gagal.length, catatan: req.body?.catatan || null }, req.ip);
      return { berhasil, gagal };
    });
  });

  app.post('/api/bukti/hitung-ulang', { preHandler: requireRole('admin') }, async (req) => tx(async (c) => {
    const n = await lengkapiKelengkapan(c, { semua: true });
    await audit(c, req.user, 'dokumen_hitung_ulang', 'bku_status', null, { jumlah: n }, req.ip);
    return { jumlah: n };
  }));

  app.put('/api/persetujuan/alur', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    const bersih = (a) => {
      if (!Array.isArray(a) || !a.length || a.length > 4) throw bad('Alur berisi 1 sampai 4 tahap');
      return a.map((t) => {
        if (!PERAN.includes(t.peran)) throw bad(`Peran tidak dikenal: ${t.peran}`);
        return { peran: t.peran, label: String(t.label || '').trim().slice(0, 60) || `Persetujuan ${t.peran}` };
      });
    };
    const nilai = {};
    if (b.alur_spp) nilai.alur_spp = bersih(b.alur_spp);
    if (b.alur_spj) nilai.alur_spj = bersih(b.alur_spj);
    if (b.alur_bku) nilai.alur_bku = bersih(b.alur_bku);
    if (b.bku_ambang_pimpinan !== undefined) nilai.bku_ambang_pimpinan = Math.max(0, Number(b.bku_ambang_pimpinan) || 0);
    if (b.alur_bku_aktif !== undefined) nilai.alur_bku_aktif = Boolean(b.alur_bku_aktif);
    if (b.persetujuan_wajib_dokumen !== undefined) nilai.persetujuan_wajib_dokumen = Boolean(b.persetujuan_wajib_dokumen);
    if (b.spj_wajib_disahkan !== undefined) nilai.spj_wajib_disahkan = Boolean(b.spj_wajib_disahkan);
    return tx(async (c) => {
      await simpanPengaturan(c, nilai);
      await audit(c, req.user, 'alur_persetujuan_ubah', 'pengaturan', null, nilai, req.ip);
      return { ok: true };
    });
  });
}
