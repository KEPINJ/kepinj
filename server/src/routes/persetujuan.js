// Persetujuan berjenjang untuk SPP dan SPJ fungsional bulanan. Tahapan dan perannya diatur admin
// (bawaan: verifikasi PPK-SKPD lalu persetujuan PA/KPA). SPM baru dapat terbit setelah SPP disetujui
// semua tahap; tutup buku bulanan menunggu SPJ disahkan bila diwajibkan.
import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, forbidden, notFound, int, scopeSkpd, canWrite, required } from '../lib/http.js';
import { getPengaturan, simpanPengaturan } from '../lib/pengaturan.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { NAMA_BULAN } from '../lib/kalender.js';

const PERAN = ['verifikator', 'pimpinan', 'admin', 'bendahara'];

/** Mulai (atau ulang) alur persetujuan; putaran sebelumnya yang belum selesai dibatalkan. */
export async function buatAlur(c, objek, objekId, skpd, tahun) {
  const alur = (await getPengaturan())[`alur_${objek}`] || [];
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
  const { rows: [r] } = await query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE objek = 'spp')::int AS spp FROM persetujuan
    WHERE skpd_id = $1 AND tahun = $2 AND status = 'menunggu' AND ($3 = 'admin' OR peran = $3)`, [skpd, tahun, user.role]);
  if (!r.n) return [];
  return [{ id: `setuju-${r.n}`, tipe: 'persetujuan', tingkat: 'peringatan', judul: `${r.n} dokumen menunggu persetujuan Anda`,
    pesan: `${r.spp} SPP dan ${r.n - r.spp} SPJ fungsional menunggu keputusan.`, link: '/persetujuan', tanggal: null }];
});

export default async function persetujuanRoutes(app) {
  app.get('/api/persetujuan', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const { rows } = await query(`SELECT p.*, u.full_name AS oleh_nama FROM persetujuan p LEFT JOIN users u ON u.id = p.oleh
      WHERE p.skpd_id = $1 AND p.tahun = $2 AND p.putaran = (SELECT MAX(putaran) FROM persetujuan q WHERE q.objek = p.objek AND q.objek_id = p.objek_id)
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
    return { items: out, alur: { spp: cfg.alur_spp, spj: cfg.alur_spj } };
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
    if (b.spj_wajib_disahkan !== undefined) nilai.spj_wajib_disahkan = Boolean(b.spj_wajib_disahkan);
    return tx(async (c) => {
      await simpanPengaturan(c, nilai);
      await audit(c, req.user, 'alur_persetujuan_ubah', 'pengaturan', null, nilai, req.ip);
      return { ok: true };
    });
  });
}
