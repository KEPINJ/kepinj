// Tutup buku bulanan: setelah dikunci, transaksi pada bulan tersebut ditolak (juga oleh trigger database).
import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, notFound, int, scopeSkpd, canWrite, required } from '../lib/http.js';
import { NAMA_BULAN } from '../lib/kalender.js';

async function statusTahun(skpd, tahun) {
  const [{ rows: kunci }, { rows: bulanan }, { rows: penutupan }, { rows: pajak }] = await Promise.all([
    query('SELECT k.*, u.full_name AS oleh FROM periode_kunci k LEFT JOIN users u ON u.id = k.dikunci_oleh WHERE k.skpd_id = $1 AND k.tahun = $2', [skpd, tahun]),
    query(`SELECT EXTRACT(MONTH FROM e.tanggal)::int AS bulan, COUNT(*)::int AS transaksi,
        SUM(e.penerimaan) AS penerimaan, SUM(e.pengeluaran) AS pengeluaran,
        COUNT(*) FILTER (WHERE v.status IS NULL)::int AS belum_verifikasi,
        COUNT(*) FILTER (WHERE v.status = 'ditolak')::int AS ditolak
      FROM bku_entries e
      LEFT JOIN LATERAL (SELECT status FROM bku_verifications WHERE entry_id = e.id ORDER BY verified_at DESC LIMIT 1) v ON true
      WHERE e.skpd_id = $1 AND e.tahun = $2 GROUP BY 1`, [skpd, tahun]),
    query(`SELECT EXTRACT(MONTH FROM tanggal)::int AS bulan, COUNT(*)::int AS jumlah, MAX(tanggal) AS terakhir
      FROM penutupan_kas WHERE skpd_id = $1 AND EXTRACT(YEAR FROM tanggal) = $2 GROUP BY 1`, [skpd, tahun]),
    query(`SELECT masa AS bulan, SUM(nominal) FILTER (WHERE status = 'dipungut') AS belum_setor
      FROM pajak WHERE skpd_id = $1 AND tahun = $2 GROUP BY 1`, [skpd, tahun]),
  ]);
  const terakhirKunci = Math.max(0, ...kunci.map((k) => k.bulan));
  const now = new Date();
  const bulanBerjalan = now.getFullYear() > tahun ? 13 : now.getFullYear() < tahun ? 0 : now.getMonth() + 1;
  return Array.from({ length: 12 }, (_, i) => {
    const bulan = i + 1;
    const k = kunci.find((x) => x.bulan === bulan);
    const b = bulanan.find((x) => x.bulan === bulan);
    const pk = penutupan.find((x) => x.bulan === bulan);
    const pj = pajak.find((x) => x.bulan === bulan);
    const pemeriksaan = {
      transaksi: b?.transaksi || 0,
      belum_verifikasi: b?.belum_verifikasi || 0,
      ditolak: b?.ditolak || 0,
      penutupan_kas: pk?.jumlah || 0,
      pajak_belum_setor: Number(pj?.belum_setor || 0),
    };
    return {
      bulan, nama: NAMA_BULAN[i], dikunci: Boolean(k), dikunci_at: k?.dikunci_at || null, oleh: k?.oleh || null, catatan: k?.catatan || null,
      ringkasan: k?.ringkasan || { penerimaan: Number(b?.penerimaan || 0), pengeluaran: Number(b?.pengeluaran || 0), transaksi: b?.transaksi || 0 },
      pemeriksaan,
      siap: pemeriksaan.belum_verifikasi === 0 && pemeriksaan.ditolak === 0 && pemeriksaan.penutupan_kas > 0,
      bisa_kunci: !k && bulan === terakhirKunci + 1 && bulan < bulanBerjalan,
      bisa_buka: Boolean(k) && bulan === terakhirKunci,
    };
  });
}

export default async function tutupBukuRoutes(app) {
  app.get('/api/tutup-buku', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    return { skpd_id: skpd, tahun, bulan: await statusTahun(skpd, tahun) };
  });

  app.post('/api/tutup-buku', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['tahun', 'bulan']);
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    const tahun = int(b.tahun); const bulan = int(b.bulan);
    const status = (await statusTahun(skpd, tahun))[bulan - 1];
    if (!status) throw bad('Bulan tidak valid');
    if (status.dikunci) throw bad(`${status.nama} ${tahun} sudah ditutup`);
    if (!status.bisa_kunci) throw bad('Tutup buku harus berurutan dan hanya untuk bulan yang sudah berakhir. Tutup bulan sebelumnya terlebih dahulu.');
    return tx(async (c) => {
      await c.query('LOCK TABLE periode_kunci IN SHARE ROW EXCLUSIVE MODE');
      const akhir = new Date(Date.UTC(tahun, bulan, 0)).toISOString().slice(0, 10);
      const { rows: [r] } = await c.query(`SELECT
          COALESCE(SUM(penerimaan) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = $3), 0) AS penerimaan,
          COALESCE(SUM(pengeluaran) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = $3), 0) AS pengeluaran,
          COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE tanggal <= $4), 0) AS saldo_akhir,
          COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = $3)::int AS transaksi
        FROM bku_entries WHERE skpd_id = $1 AND tahun = $2`, [skpd, tahun, bulan, akhir]);
      const { rows: [last] } = await c.query('SELECT no_urut, hash FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 ORDER BY no_urut DESC LIMIT 1', [skpd, tahun]);
      const ringkasan = { penerimaan: Number(r.penerimaan), pengeluaran: Number(r.pengeluaran), saldo_akhir: Number(r.saldo_akhir), transaksi: r.transaksi,
        no_urut_terakhir: last?.no_urut || 0, hash_terakhir: last?.hash || null, pemeriksaan: status.pemeriksaan };
      await c.query('INSERT INTO periode_kunci (skpd_id, tahun, bulan, ringkasan, catatan, dikunci_oleh) VALUES ($1,$2,$3,$4,$5,$6)',
        [skpd, tahun, bulan, ringkasan, b.catatan || null, req.user.id]);
      await audit(c, req.user, 'tutup_buku', 'periode', `${skpd}/${tahun}/${bulan}`, ringkasan, req.ip);
      await emit(c, 'periode.dikunci', String(skpd), { skpd_id: skpd, tahun, bulan, user: req.user.full_name });
      return { ok: true, ringkasan };
    });
  });

  app.post('/api/tutup-buku/buka', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    required(b, ['skpd_id', 'tahun', 'bulan', 'alasan']);
    const skpd = int(b.skpd_id); const tahun = int(b.tahun); const bulan = int(b.bulan);
    return tx(async (c) => {
      const { rows } = await c.query('SELECT bulan FROM periode_kunci WHERE skpd_id = $1 AND tahun = $2 ORDER BY bulan DESC LIMIT 1 FOR UPDATE', [skpd, tahun]);
      if (!rows.length || rows[0].bulan !== bulan) throw (rows.length ? bad('Hanya bulan terakhir yang dikunci yang dapat dibuka') : notFound('Periode belum dikunci'));
      await c.query('DELETE FROM periode_kunci WHERE skpd_id = $1 AND tahun = $2 AND bulan = $3', [skpd, tahun, bulan]);
      await audit(c, req.user, 'buka_tutup_buku', 'periode', `${skpd}/${tahun}/${bulan}`, { alasan: b.alasan }, req.ip);
      await emit(c, 'periode.dibuka', String(skpd), { skpd_id: skpd, tahun, bulan, user: req.user.full_name });
      return { ok: true };
    });
  });
}
