// Anggaran kas (rencana penarikan dana per bulan) dan perubahan anggaran: pergeseran antar rekening
// (total tetap) serta APBD Perubahan (total berubah). Pagu murni disimpan agar perbandingan tetap terlihat.
import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, notFound, int, isDate, money, scopeSkpd, required } from '../lib/http.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { NAMA_BULAN } from '../lib/kalender.js';

const REAL = `SUM(CASE WHEN jenis = 'KOREKSI' THEN pengeluaran - penerimaan ELSE pengeluaran END)`;
// Pola penarikan default: belanja pegawai merata, belanja lain menumpuk di semester II
export const POLA = { rata: Array(12).fill(1 / 12), triwulan: [4, 5, 6, 7, 8, 9, 9, 10, 10, 10, 11, 11].map((x) => x / 100) };

const bulanBerjalan = (tahun) => { const n = new Date(); return n.getFullYear() > tahun ? 12 : n.getFullYear() < tahun ? 0 : n.getMonth() + 1; };

/** Bagi `total` ke 12 bulan sesuai bobot; pembulatan ribuan, selisih ditaruh di Desember. */
export function bagiPola(total, bobot) {
  const out = bobot.map((b) => Math.floor((total * b) / 1000) * 1000);
  out[11] = money(total - out.slice(0, 11).reduce((s, v) => s + v, 0));
  return out;
}

export async function dataAnggaranKas(skpd, tahun) {
  const [{ rows: ang }, { rows: kas }, { rows: real }] = await Promise.all([
    query(`SELECT a.kode_rekening, r.nama, a.pagu::float AS pagu, COALESCE(a.pagu_murni, a.pagu)::float AS pagu_murni FROM anggaran a JOIN rekening r ON r.kode = a.kode_rekening
      WHERE a.skpd_id = $1 AND a.tahun = $2 ORDER BY a.kode_rekening`, [skpd, tahun]),
    query('SELECT kode_rekening, bulan, nilai::float AS nilai FROM anggaran_kas WHERE skpd_id = $1 AND tahun = $2', [skpd, tahun]),
    query(`SELECT kode_rekening, EXTRACT(MONTH FROM tanggal)::int AS bulan, ${REAL}::float AS nilai FROM bku_entries
      WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening IS NOT NULL AND jenis IN ('BELANJA','SP2D_LS','KOREKSI') GROUP BY 1,2`, [skpd, tahun]),
  ]);
  const bb = bulanBerjalan(tahun);
  const rows = ang.map((a) => {
    const rencana = Array.from({ length: 12 }, (_, i) => kas.find((k) => k.kode_rekening === a.kode_rekening && k.bulan === i + 1)?.nilai || 0);
    const realisasi = Array.from({ length: 12 }, (_, i) => real.find((k) => k.kode_rekening === a.kode_rekening && k.bulan === i + 1)?.nilai || 0);
    const sd = (arr) => arr.slice(0, bb).reduce((s, v) => s + v, 0);
    const totalRencana = rencana.reduce((s, v) => s + v, 0);
    return { ...a, rencana, realisasi, total_rencana: totalRencana, total_realisasi: realisasi.reduce((s, v) => s + v, 0),
      rencana_sd: sd(rencana), realisasi_sd: sd(realisasi), selisih_pagu: money(a.pagu - totalRencana), terisi: totalRencana > 0 };
  });
  const sum = (k) => Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s + r[k][i], 0));
  const rencana = sum('rencana'); const realisasi = sum('realisasi');
  let kr = 0; let kl = 0;
  const kumulatif = rencana.map((v, i) => { kr += v; kl += realisasi[i]; return { bulan: i + 1, nama: NAMA_BULAN[i].slice(0, 3), rencana: v, realisasi: i < bb ? realisasi[i] : null, rencana_kum: kr, realisasi_kum: i < bb ? kl : null }; });
  return {
    rows, kumulatif, bulan_berjalan: bb,
    total: { pagu: rows.reduce((s, r) => s + r.pagu, 0), pagu_murni: rows.reduce((s, r) => s + r.pagu_murni, 0), rencana: rencana.reduce((s, v) => s + v, 0),
      realisasi: realisasi.reduce((s, v) => s + v, 0), rencana_sd: rows.reduce((s, r) => s + r.rencana_sd, 0), realisasi_sd: rows.reduce((s, r) => s + r.realisasi_sd, 0) },
    melampaui: rows.filter((r) => r.terisi && r.realisasi_sd > r.rencana_sd + 0.5).map((r) => ({ kode_rekening: r.kode_rekening, nama: r.nama, lebih: r.realisasi_sd - r.rencana_sd })),
    belum_diisi: rows.filter((r) => !r.terisi).length,
  };
}

/** Peringatan untuk SPP: apakah nilai yang diajukan melampaui anggaran kas kumulatif s.d. bulan SPP. */
export async function cekAnggaranKas(c, skpd, kode, tanggal, nilai) {
  const tahun = Number(tanggal.slice(0, 4)); const bulan = Number(tanggal.slice(5, 7));
  const { rows: [r] } = await c.query(`SELECT (SELECT COALESCE(SUM(nilai),0) FROM anggaran_kas WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = $3 AND bulan <= $4)::float AS rencana,
      (SELECT COUNT(*) FROM anggaran_kas WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = $3)::int AS ada,
      (SELECT COALESCE(${REAL},0) FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = $3 AND jenis IN ('BELANJA','SP2D_LS','KOREKSI'))::float AS realisasi`, [skpd, tahun, kode, bulan]);
  if (!r.ada) return null;
  const sisa = r.rencana - r.realisasi;
  return nilai > sisa + 0.5 ? `Nilai melampaui sisa anggaran kas s.d. ${NAMA_BULAN[bulan - 1]} (Rp ${Math.round(Math.max(0, sisa)).toLocaleString('id-ID')})` : null;
}

daftarNotifikasi(async ({ user, skpd, tahun }) => {
  if (!['admin', 'bendahara', 'pimpinan'].includes(user.role)) return [];
  const d = await dataAnggaranKas(skpd, tahun);
  if (!d.melampaui.length) return [];
  return [{ id: `akas-${d.melampaui.length}-${d.bulan_berjalan}`, tipe: 'anggaran', tingkat: 'peringatan', judul: `${d.melampaui.length} rekening melampaui anggaran kas`,
    pesan: `${d.melampaui.slice(0, 2).map((m) => m.nama).join(', ')}${d.melampaui.length > 2 ? ', …' : ''}. Sesuaikan anggaran kas atau tunda belanja.`, link: '/anggaran-kas', tanggal: null }];
});

/** Terapkan pagu baru ke anggaran kas: bulan yang sudah lewat tetap, sisanya diskalakan. */
async function sesuaikanKas(c, skpd, tahun, kode, paguBaru) {
  const { rows } = await c.query('SELECT bulan, nilai::float AS nilai FROM anggaran_kas WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = $3 ORDER BY bulan', [skpd, tahun, kode]);
  if (!rows.length) return;
  const bb = bulanBerjalan(tahun);
  const lewat = rows.filter((r) => r.bulan <= bb).reduce((s, r) => s + r.nilai, 0);
  const depan = rows.filter((r) => r.bulan > bb);
  const sisa = Math.max(0, paguBaru - lewat);
  const totalDepan = depan.reduce((s, r) => s + r.nilai, 0);
  const baru = Object.fromEntries(rows.map((r) => [r.bulan, r.nilai]));
  if (!depan.length) baru[12] = money((baru[12] || 0) + (paguBaru - lewat));
  else {
    let dibagi = 0;
    depan.forEach((r, i) => {
      const v = i === depan.length - 1 ? money(sisa - dibagi) : Math.floor((totalDepan ? (r.nilai / totalDepan) * sisa : sisa / depan.length) / 1000) * 1000;
      baru[r.bulan] = v; dibagi += v;
    });
  }
  for (const [bulan, nilai] of Object.entries(baru)) {
    await c.query('UPDATE anggaran_kas SET nilai = $5 WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = $3 AND bulan = $4', [skpd, tahun, kode, Number(bulan), Math.max(0, nilai)]);
  }
}

export async function tetapkanPerubahan(c, user, id) {
  const { rows: [p] } = await c.query('SELECT * FROM perubahan_anggaran WHERE id = $1 FOR UPDATE', [int(id)]);
  if (!p) throw notFound('Dokumen perubahan tidak ditemukan');
  if (p.status !== 'draft') throw bad('Dokumen ini sudah ditetapkan');
  const rincian = p.rincian || [];
  if (!rincian.length) throw bad('Rincian perubahan masih kosong');
  const masalah = [];
  let delta = 0;
  for (const r of rincian) {
    const { rows: [a] } = await c.query('SELECT pagu::float AS pagu FROM anggaran WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = $3', [p.skpd_id, p.tahun, r.kode_rekening]);
    const { rows: [x] } = await c.query(`SELECT COALESCE(${REAL},0)::float AS realisasi FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = $3 AND jenis IN ('BELANJA','SP2D_LS','KOREKSI')`, [p.skpd_id, p.tahun, r.kode_rekening]);
    if (Number(r.pagu_baru) < x.realisasi) masalah.push(`${r.kode_rekening}: pagu baru di bawah realisasi (Rp ${Math.round(x.realisasi).toLocaleString('id-ID')})`);
    r.pagu_lama = a?.pagu || 0;
    delta += Number(r.pagu_baru) - r.pagu_lama;
  }
  if (p.jenis === 'pergeseran' && Math.abs(delta) > 0.5) masalah.push(`Pergeseran harus berjumlah nol; selisih saat ini Rp ${Math.round(delta).toLocaleString('id-ID')}`);
  if (masalah.length) throw bad(masalah.join('; '), { masalah });
  for (const r of rincian) {
    await c.query(`INSERT INTO anggaran (skpd_id, tahun, kode_rekening, pagu, pagu_murni) VALUES ($1,$2,$3,$4,0)
      ON CONFLICT (skpd_id, tahun, kode_rekening) DO UPDATE SET pagu = EXCLUDED.pagu`, [p.skpd_id, p.tahun, r.kode_rekening, money(r.pagu_baru)]);
    await sesuaikanKas(c, p.skpd_id, p.tahun, r.kode_rekening, Number(r.pagu_baru));
  }
  const { rows: [out] } = await c.query("UPDATE perubahan_anggaran SET status = 'ditetapkan', rincian = $3, ditetapkan_oleh = $2, ditetapkan_at = now() WHERE id = $1 RETURNING *", [p.id, user.id, JSON.stringify(rincian)]);
  return { ...out, delta };
}

export default async function anggaranKasRoutes(app) {
  app.get('/api/anggaran-kas', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    return dataAnggaranKas(skpd, int(req.query.tahun, new Date().getFullYear()));
  });

  app.put('/api/anggaran-kas', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    required(b, ['skpd_id', 'tahun', 'kode_rekening', 'rencana']);
    if (!Array.isArray(b.rencana) || b.rencana.length !== 12) throw bad('Rencana harus 12 bulan');
    const rencana = b.rencana.map(money);
    if (rencana.some((v) => v < 0)) throw bad('Nilai rencana tidak boleh negatif');
    return tx(async (c) => {
      const { rows: [a] } = await c.query('SELECT pagu::float AS pagu FROM anggaran WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = $3', [int(b.skpd_id), int(b.tahun), b.kode_rekening]);
      if (!a) throw bad('Rekening ini belum memiliki pagu anggaran');
      const total = rencana.reduce((s, v) => s + v, 0);
      if (Math.abs(total - a.pagu) > 0.5) throw bad(`Jumlah anggaran kas (Rp ${Math.round(total).toLocaleString('id-ID')}) harus sama dengan pagu (Rp ${Math.round(a.pagu).toLocaleString('id-ID')})`);
      for (const [i, v] of rencana.entries()) {
        await c.query(`INSERT INTO anggaran_kas (skpd_id, tahun, kode_rekening, bulan, nilai) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (skpd_id, tahun, kode_rekening, bulan) DO UPDATE SET nilai = EXCLUDED.nilai`, [int(b.skpd_id), int(b.tahun), b.kode_rekening, i + 1, v]);
      }
      await audit(c, req.user, 'anggaran_kas_ubah', 'anggaran_kas', `${b.skpd_id}/${b.tahun}/${b.kode_rekening}`, { rencana }, req.ip);
      return { ok: true };
    });
  });

  // Isi otomatis anggaran kas yang masih kosong (atau timpa semua) dengan pola penarikan
  app.post('/api/anggaran-kas/otomatis', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    required(b, ['skpd_id', 'tahun']);
    const skpd = int(b.skpd_id); const tahun = int(b.tahun);
    return tx(async (c) => {
      const { rows } = await c.query(`SELECT a.kode_rekening, a.pagu::float AS pagu, EXISTS (SELECT 1 FROM anggaran_kas k WHERE k.skpd_id = a.skpd_id AND k.tahun = a.tahun AND k.kode_rekening = a.kode_rekening) AS ada
        FROM anggaran a WHERE a.skpd_id = $1 AND a.tahun = $2`, [skpd, tahun]);
      let n = 0;
      for (const r of rows) {
        if (r.ada && !b.timpa) continue;
        const bobot = b.pola === 'rata' || r.kode_rekening.startsWith('5.1.01') ? POLA.rata : POLA.triwulan;
        for (const [i, v] of bagiPola(r.pagu, bobot).entries()) {
          await c.query(`INSERT INTO anggaran_kas (skpd_id, tahun, kode_rekening, bulan, nilai) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (skpd_id, tahun, kode_rekening, bulan) DO UPDATE SET nilai = EXCLUDED.nilai`, [skpd, tahun, r.kode_rekening, i + 1, v]);
        }
        n++;
      }
      await audit(c, req.user, 'anggaran_kas_otomatis', 'anggaran_kas', `${skpd}/${tahun}`, { jumlah: n, timpa: Boolean(b.timpa) }, req.ip);
      return { jumlah: n };
    });
  });

  app.get('/api/perubahan-anggaran', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const { rows } = await query(`SELECT p.*, u.full_name AS dibuat_oleh, t.full_name AS ditetapkan_nama FROM perubahan_anggaran p
      LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users t ON t.id = p.ditetapkan_oleh WHERE p.skpd_id = $1 AND p.tahun = $2 ORDER BY p.tanggal DESC, p.id DESC`, [skpd, tahun]);
    return { rows };
  });

  app.post('/api/perubahan-anggaran', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    required(b, ['skpd_id', 'tahun', 'jenis', 'tanggal']);
    if (!['pergeseran', 'perubahan'].includes(b.jenis)) throw bad('Jenis perubahan tidak dikenal');
    if (!isDate(b.tanggal)) throw bad('Tanggal tidak valid');
    const rincian = (b.rincian || []).filter((r) => r.kode_rekening).map((r) => ({ kode_rekening: r.kode_rekening, pagu_lama: money(r.pagu_lama), pagu_baru: money(r.pagu_baru), alasan: r.alasan || null }));
    if (rincian.some((r) => r.pagu_baru < 0)) throw bad('Pagu baru tidak boleh negatif');
    return tx(async (c) => {
      const skpd = int(b.skpd_id); const tahun = int(b.tahun);
      for (const r of rincian) {
        const { rows: [a] } = await c.query('SELECT pagu::float AS pagu FROM anggaran WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = $3', [skpd, tahun, r.kode_rekening]);
        r.pagu_lama = a?.pagu || 0;
      }
      const { rows: [n] } = await c.query('SELECT COUNT(*)::int + 1 AS n FROM perubahan_anggaran WHERE skpd_id = $1 AND tahun = $2', [skpd, tahun]);
      const nomor = String(b.nomor || '').trim() || `${String(n.n).padStart(3, '0')}/${b.jenis === 'pergeseran' ? 'PGS' : 'APBD-P'}/${tahun}`;
      const { rows: [p] } = await c.query(`INSERT INTO perubahan_anggaran (skpd_id, tahun, nomor, jenis, tanggal, dasar, uraian, rincian, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [skpd, tahun, nomor, b.jenis, b.tanggal, b.dasar || null, b.uraian || null, JSON.stringify(rincian), req.user.id]);
      let out = p;
      if (b.tetapkan) out = await tetapkanPerubahan(c, req.user, p.id);
      await audit(c, req.user, b.tetapkan ? 'perubahan_anggaran_tetapkan' : 'perubahan_anggaran_draft', 'perubahan_anggaran', p.id, { nomor, jenis: b.jenis, rincian }, req.ip);
      return { row: out };
    });
  });

  app.post('/api/perubahan-anggaran/:id/tetapkan', { preHandler: requireRole('admin') }, async (req) => tx(async (c) => {
    const r = await tetapkanPerubahan(c, req.user, req.params.id);
    await audit(c, req.user, 'perubahan_anggaran_tetapkan', 'perubahan_anggaran', r.id, { nomor: r.nomor, delta: r.delta }, req.ip);
    return { row: r };
  }));

  app.delete('/api/perubahan-anggaran/:id', { preHandler: requireRole('admin') }, async (req) => tx(async (c) => {
    const { rowCount } = await c.query("DELETE FROM perubahan_anggaran WHERE id = $1 AND status = 'draft'", [int(req.params.id)]);
    if (!rowCount) throw bad('Hanya draf yang dapat dihapus');
    await audit(c, req.user, 'perubahan_anggaran_hapus', 'perubahan_anggaran', req.params.id, null, req.ip);
    return { ok: true };
  }));
}
