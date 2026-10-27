// Tutup tahun anggaran: daftar periksa akhir tahun, penyetoran sisa UP, penguncian Desember,
// saldo awal tahun berikutnya, dan Laporan Pertanggungjawaban (LPJ) bendahara setahun.
import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, int, isDate, scopeSkpd, canWrite, required } from '../lib/http.js';
import { insertEntries, JENIS_BKU } from '../lib/ledger.js';

const rupiah = (v) => `Rp ${Math.round(Number(v)).toLocaleString('id-ID')}`;

async function saldoPerMetode(c, skpd, tahun) {
  const { rows: [r] } = await c.query(`SELECT COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode = 'bank'),0)::float AS bank,
      COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode = 'tunai'),0)::float AS tunai FROM bku_entries WHERE skpd_id = $1 AND tahun = $2`, [skpd, tahun]);
  return { ...r, total: r.bank + r.tunai };
}

/** Daftar periksa akhir tahun. `wajib` harus terpenuhi sebelum tahun anggaran dapat ditutup. */
export async function periksaTahun(skpd, tahun, c = { query: (...a) => query(...a) }) {
  const [{ rows: [k] }, { rows: [v] }, { rows: [p] }, { rows: [pj] }, { rows: [u] }, { rows: [t] }, { rows: [s] }, { rows: [pk] }, saldo, { rows: [tt] }] = await Promise.all([
    c.query('SELECT COUNT(*) FILTER (WHERE bulan <= 11)::int AS n, bool_or(bulan = 12) AS des FROM periode_kunci WHERE skpd_id = $1 AND tahun = $2', [skpd, tahun]),
    c.query(`SELECT COUNT(*) FILTER (WHERE v.status IS NULL)::int AS belum, COUNT(*) FILTER (WHERE v.status = 'ditolak')::int AS ditolak FROM bku_entries e
      LEFT JOIN LATERAL (SELECT status FROM bku_verifications WHERE entry_id = e.id ORDER BY verified_at DESC LIMIT 1) v ON true WHERE e.skpd_id = $1 AND e.tahun = $2`, [skpd, tahun]),
    c.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(nominal),0)::float AS nilai FROM pajak WHERE skpd_id = $1 AND tahun = $2 AND status = 'dipungut'", [skpd, tahun]),
    c.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(nilai),0)::float AS nilai FROM panjar WHERE skpd_id = $1 AND tahun = $2 AND status = 'berjalan'", [skpd, tahun]),
    c.query(`SELECT COUNT(*) FILTER (WHERE saldo <> 0)::int AS bersaldo, COALESCE(SUM(saldo),0)::float AS saldo,
        (SELECT COUNT(*)::int FROM spj_pembantu WHERE skpd_id = $1 AND tahun = $2 AND status = 'diajukan') AS diajukan,
        (SELECT COUNT(*)::int FROM bpp_entries e WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.jenis = 'BELANJA' AND NOT EXISTS (SELECT 1 FROM spj_pembantu_rincian r WHERE r.bpp_entry_id = e.id)) AS belum_spj
      FROM (SELECT unit_id, SUM(penerimaan - pengeluaran) AS saldo FROM bpp_entries WHERE skpd_id = $1 AND tahun = $2 GROUP BY 1) x`, [skpd, tahun]),
    c.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(penerimaan),0)::float AS nilai FROM bkp_entries e WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.jenis = 'TERIMA'
      AND NOT EXISTS (SELECT 1 FROM sts_rincian r WHERE r.bkp_entry_id = e.id)`, [skpd, tahun]),
    c.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(nilai),0)::float AS nilai FROM spp WHERE skpd_id = $1 AND tahun = $2 AND status IN ('spp','spm')", [skpd, tahun]),
    c.query("SELECT COUNT(*)::int AS n FROM penutupan_kas WHERE skpd_id = $1 AND tanggal BETWEEN $2 AND $3", [skpd, `${tahun}-12-01`, `${tahun}-12-31`]),
    saldoPerMetode(c, skpd, tahun),
    c.query('SELECT t.*, u.full_name AS oleh FROM tutup_tahun t LEFT JOIN users u ON u.id = t.ditutup_oleh WHERE t.skpd_id = $1 AND t.tahun = $2', [skpd, tahun]),
  ]);
  const cek = (kode, judul, ok, detail, { wajib = true, link = null, aksi = null } = {}) => ({ kode, judul, status: ok ? 'ok' : wajib ? 'gagal' : 'peringatan', wajib, detail, link, aksi });
  const daftar = [
    cek('tutup_buku', 'Tutup buku Januari s.d. November', k.n >= 11, k.n >= 11 ? 'Seluruh bulan sebelum Desember sudah dikunci' : `${k.n} dari 11 bulan sudah ditutup buku`, { link: '/tutup-buku' }),
    cek('ditolak', 'Transaksi yang ditolak verifikator sudah dikoreksi', !v.ditolak, v.ditolak ? `${v.ditolak} transaksi ditolak dan perlu dikoreksi` : 'Tidak ada transaksi ditolak', { link: '/bku' }),
    cek('verifikasi', 'Seluruh transaksi BKU terverifikasi', !v.belum, v.belum ? `${v.belum} transaksi belum diverifikasi` : 'Semua transaksi sudah diverifikasi', { wajib: false, link: '/bku' }),
    cek('pajak', 'Pajak yang dipungut sudah disetor', !p.n, p.n ? `${p.n} bukti senilai ${rupiah(p.nilai)} belum disetor ke kas negara` : 'Semua pungutan pajak sudah disetor', { link: '/pajak/register' }),
    cek('panjar', 'Panjar kegiatan sudah dipertanggungjawabkan', !pj.n, pj.n ? `${pj.n} panjar senilai ${rupiah(pj.nilai)} masih berjalan` : 'Tidak ada panjar berjalan', { link: '/panjar' }),
    cek('pembantu', 'Bendahara pembantu: SPJ disahkan dan sisa UP dikembalikan', !u.bersaldo && !u.diajukan && !u.belum_spj,
      !u.bersaldo && !u.diajukan && !u.belum_spj ? 'Semua unit kerja nihil' : [u.belum_spj && `${u.belum_spj} belanja belum di-SPJ-kan`, u.diajukan && `${u.diajukan} SPJ menunggu pengesahan`, u.bersaldo && `${u.bersaldo} unit masih memegang kas ${rupiah(u.saldo)}`].filter(Boolean).join(', '), { link: '/pembantu' }),
    cek('penerimaan', 'Penerimaan sudah disetor ke kas daerah', !t.n, t.n ? `${t.n} penerimaan senilai ${rupiah(t.nilai)} belum dibuatkan STS` : 'Saldo bendahara penerimaan nihil', { link: '/penerimaan?tab=sts' }),
    cek('spp', 'Tidak ada SPP/SPM yang menggantung', !s.n, s.n ? `${s.n} pengajuan senilai ${rupiah(s.nilai)} belum menjadi SP2D` : 'Semua pengajuan sudah selesai', { wajib: false, link: '/spp' }),
    cek('penutupan_kas', 'Register penutupan kas Desember', pk.n > 0, pk.n ? 'Sudah dibuat' : 'Belum ada berita acara penutupan kas Desember', { wajib: false, link: '/penutupan-kas' }),
    cek('sisa_up', 'Sisa UP disetor ke kas daerah', Math.abs(saldo.total) < 0.01, Math.abs(saldo.total) < 0.01 ? 'Saldo kas bendahara nihil'
      : `Saldo ${rupiah(saldo.total)} (bank ${rupiah(saldo.bank)}, tunai ${rupiah(saldo.tunai)}). Bila tidak disetor, dibawa sebagai saldo awal TA ${tahun + 1}.`, { wajib: false, aksi: Math.abs(saldo.total) >= 0.01 && !p.n ? 'setor_sisa' : null }),
  ];
  return { daftar, saldo, siap: daftar.every((d) => !d.wajib || d.status === 'ok'), desember_dikunci: Boolean(k.des), tutup: tt || null };
}

/** LPJ bendahara pengeluaran setahun: mutasi per jenis, realisasi per rekening, pajak. */
async function lpj(skpd, tahun) {
  const [{ rows: jenis }, { rows: rek }, { rows: [pajak] }, { rows: [s] }] = await Promise.all([
    query(`SELECT jenis, SUM(penerimaan)::float AS penerimaan, SUM(pengeluaran)::float AS pengeluaran, COUNT(*)::int AS jumlah FROM bku_entries
      WHERE skpd_id = $1 AND tahun = $2 GROUP BY jenis`, [skpd, tahun]),
    query(`SELECT r.kode, r.nama, COALESCE(a.pagu,0)::float AS pagu, COALESCE(x.realisasi,0)::float AS realisasi FROM rekening r
      LEFT JOIN anggaran a ON a.kode_rekening = r.kode AND a.skpd_id = $1 AND a.tahun = $2
      LEFT JOIN (SELECT kode_rekening, SUM(CASE WHEN jenis = 'KOREKSI' THEN pengeluaran - penerimaan ELSE pengeluaran END) AS realisasi FROM bku_entries
        WHERE skpd_id = $1 AND tahun = $2 AND jenis IN ('BELANJA','SP2D_LS','KOREKSI') GROUP BY 1) x ON x.kode_rekening = r.kode
      WHERE r.jenis = 'belanja' AND (a.pagu IS NOT NULL OR x.realisasi IS NOT NULL) ORDER BY r.kode`, [skpd, tahun]),
    query(`SELECT COALESCE(SUM(nominal),0)::float AS pungut, COALESCE(SUM(nominal) FILTER (WHERE status <> 'dipungut'),0)::float AS setor
      FROM pajak WHERE skpd_id = $1 AND tahun = $2 AND bku_entry_id IS NOT NULL`, [skpd, tahun]),
    query('SELECT * FROM skpd WHERE id = $1', [skpd]),
  ]);
  const urut = Object.keys(JENIS_BKU);
  const mutasi = jenis.sort((a, b) => urut.indexOf(a.jenis) - urut.indexOf(b.jenis)).map((j) => ({ ...j, label: JENIS_BKU[j.jenis] }));
  const total = mutasi.reduce((t, m) => ({ penerimaan: t.penerimaan + m.penerimaan, pengeluaran: t.pengeluaran + m.pengeluaran }), { penerimaan: 0, pengeluaran: 0 });
  const pagu = rek.reduce((t, r) => t + r.pagu, 0); const real = rek.reduce((t, r) => t + r.realisasi, 0);
  return { skpd: s, mutasi, total, rekening: rek.map((r) => ({ ...r, sisa: r.pagu - r.realisasi, persen: r.pagu ? (r.realisasi / r.pagu) * 100 : null })),
    anggaran: { pagu, realisasi: real, sisa: pagu - real, persen: pagu ? (real / pagu) * 100 : 0 }, pajak };
}

export default async function tutupTahunRoutes(app) {
  app.get('/api/tutup-tahun', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const [periksa, laporan] = await Promise.all([periksaTahun(skpd, tahun), lpj(skpd, tahun)]);
    return { skpd_id: skpd, tahun, ...periksa, lpj: laporan };
  });

  // Setor sisa UP ke rekening kas umum daerah (per metode kas), biasanya bertanggal 31 Desember
  app.post('/api/tutup-tahun/setor-sisa', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['tahun']);
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    const tahun = int(b.tahun);
    const tanggal = isDate(b.tanggal) ? b.tanggal : `${tahun}-12-31`;
    if (Number(tanggal.slice(0, 4)) !== tahun) throw bad(`Tanggal penyetoran harus dalam TA ${tahun}`);
    return tx(async (c) => {
      const { rows: [p] } = await c.query("SELECT COUNT(*)::int AS n FROM pajak WHERE skpd_id = $1 AND tahun = $2 AND status = 'dipungut'", [skpd, tahun]);
      if (p.n) throw bad('Saldo kas masih memuat pajak yang belum disetor. Setor pajak terlebih dahulu di Register Pajak.');
      const saldo = await saldoPerMetode(c, skpd, tahun);
      const entries = ['bank', 'tunai'].filter((m) => saldo[m] > 0.005).map((m) => ({ tanggal, metode: m, jenis: 'PENYETORAN', pengeluaran: saldo[m],
        no_bukti: b.no_bukti || `STS-SISA-UP/${tahun}`, uraian: `Penyetoran sisa UP TA ${tahun} ke rekening kas umum daerah${m === 'tunai' ? ' (kas tunai)' : ''}` }));
      if (!entries.length) throw bad('Tidak ada sisa kas yang perlu disetor');
      const saved = await insertEntries(c, req.user, skpd, entries);
      await audit(c, req.user, 'setor_sisa_up', 'tutup_tahun', `${skpd}/${tahun}`, { saldo, no_bukti: entries[0].no_bukti }, req.ip);
      return { saved, total: saldo.total };
    });
  });

  app.post('/api/tutup-tahun', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['tahun']);
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    const tahun = int(b.tahun);
    if (tahun >= new Date().getFullYear() && !b.paksa) throw bad(`Tahun anggaran ${tahun} belum berakhir`);
    return tx(async (c) => {
      await c.query('LOCK TABLE periode_kunci IN SHARE ROW EXCLUSIVE MODE');
      const st = await periksaTahun(skpd, tahun, c);
      if (st.tutup) throw bad(`TA ${tahun} sudah ditutup pada ${new Date(st.tutup.ditutup_at).toLocaleDateString('id-ID')}`);
      const gagal = st.daftar.filter((d) => d.wajib && d.status !== 'ok');
      if (gagal.length) throw bad(`Belum dapat ditutup: ${gagal.map((d) => d.judul.toLowerCase()).join('; ')}`, { masalah: gagal });
      const { rows: [r] } = await c.query(`SELECT COALESCE(SUM(penerimaan),0)::float AS penerimaan, COALESCE(SUM(pengeluaran),0)::float AS pengeluaran, COUNT(*)::int AS transaksi,
          COALESCE(SUM(penerimaan) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = 12),0)::float AS penerimaan_des, COALESCE(SUM(pengeluaran) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = 12),0)::float AS pengeluaran_des,
          COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = 12)::int AS transaksi_des
        FROM bku_entries WHERE skpd_id = $1 AND tahun = $2`, [skpd, tahun]);
      const { rows: [last] } = await c.query('SELECT no_urut, hash FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 ORDER BY no_urut DESC LIMIT 1', [skpd, tahun]);
      if (!st.desember_dikunci) {
        await c.query(`INSERT INTO periode_kunci (skpd_id, tahun, bulan, ringkasan, catatan, dikunci_oleh) VALUES ($1,$2,12,$3,'Dikunci otomatis saat tutup tahun anggaran',$4)`,
          [skpd, tahun, { penerimaan: r.penerimaan_des, pengeluaran: r.pengeluaran_des, saldo_akhir: st.saldo.total, transaksi: r.transaksi_des, no_urut_terakhir: last?.no_urut || 0, hash_terakhir: last?.hash || null }, req.user.id]);
      }
      // Saldo awal tahun berikutnya bila masih ada sisa kas yang tidak disetor
      const berikut = tahun + 1;
      let saldoAwal = { status: 'nihil', ids: [] };
      if (Math.abs(st.saldo.total) >= 0.01) {
        const { rows: [jan] } = await c.query('SELECT 1 AS x FROM periode_kunci WHERE skpd_id = $1 AND tahun = $2 AND bulan = 1', [skpd, berikut]);
        const { rows: [ada] } = await c.query("SELECT 1 AS x FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND jenis = 'SALDO_AWAL' LIMIT 1", [skpd, berikut]);
        if (jan) saldoAwal = { status: 'manual', pesan: `Januari ${berikut} sudah ditutup buku; catat saldo awal secara manual melalui koreksi` };
        else if (ada) saldoAwal = { status: 'sudah_ada', pesan: `Saldo awal TA ${berikut} sudah pernah dicatat` };
        else {
          const saved = await insertEntries(c, req.user, skpd, ['bank', 'tunai'].filter((m) => st.saldo[m] > 0.005).map((m) => ({
            tanggal: `${berikut}-01-01`, jenis: 'SALDO_AWAL', metode: m, no_bukti: `SA/${berikut}`, penerimaan: st.saldo[m], kode_rekening: '0.0.00.00.00.0001',
            uraian: `Saldo awal ${m === 'bank' ? 'kas di bank' : 'kas tunai'} dari sisa TA ${tahun}` })));
          saldoAwal = { status: 'dibuat', ids: saved.map((x) => x.id), nilai: st.saldo.total };
        }
      }
      const ringkasan = { ...r, saldo_akhir: st.saldo, saldo_awal: saldoAwal, no_urut_terakhir: last?.no_urut || 0, hash_terakhir: last?.hash || null,
        peringatan: st.daftar.filter((d) => d.status === 'peringatan').map((d) => d.judul), catatan: b.catatan || null };
      const { rows: [t] } = await c.query('INSERT INTO tutup_tahun (skpd_id, tahun, ringkasan, saldo_awal_ids, ditutup_oleh) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [skpd, tahun, ringkasan, saldoAwal.ids, req.user.id]);
      await audit(c, req.user, 'tutup_tahun', 'tutup_tahun', `${skpd}/${tahun}`, ringkasan, req.ip);
      await emit(c, 'periode.dikunci', String(skpd), { skpd_id: skpd, tahun, bulan: 12, tutup_tahun: true, user: req.user.full_name });
      return { tutup: t };
    });
  });
}
