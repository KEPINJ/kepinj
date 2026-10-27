// Alur pengajuan SPP -> SPM -> SP2D. SP2D yang terbit langsung dibukukan di BKU.
import { query, tx, audit, emit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, notFound, int, isDate, money, scopeSkpd, canWrite, required } from '../lib/http.js';
import { insertEntries } from '../lib/ledger.js';
import { getPengaturan } from '../lib/pengaturan.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { buatAlur, statusAlur, statusBanyak } from './persetujuan.js';
import { cekAnggaranKas } from './anggarankas.js';

export const JENIS_SPP = { UP: 'Uang Persediaan', GU: 'Ganti Uang', TU: 'Tambahan Uang', LS_GAJI: 'LS Gaji & Tunjangan', LS_BARANG: 'LS Barang & Jasa' };
const KODE_UP = '0.0.00.00.00.0001';

/** Posisi UP: berapa belanja UP/GU yang belum diganti (dasar pengajuan GU). */
export async function statusUp(skpd, tahun) {
  const cfg = await getPengaturan();
  const { rows: [r] } = await query(`
    WITH ls AS (SELECT DISTINCT no_bukti FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND jenis = 'SP2D_LS')
    SELECT
      COALESCE(SUM(e.penerimaan) FILTER (WHERE e.jenis = 'SP2D_UP'), 0) AS up,
      COALESCE(SUM(e.penerimaan) FILTER (WHERE e.jenis = 'SP2D_GU'), 0) AS gu,
      COALESCE(SUM(e.penerimaan) FILTER (WHERE e.jenis = 'SP2D_TU'), 0) AS tu,
      COALESCE(SUM(CASE WHEN e.jenis = 'KOREKSI' THEN e.pengeluaran - e.penerimaan ELSE e.pengeluaran END)
        FILTER (WHERE e.jenis IN ('BELANJA','KOREKSI') AND r.jenis = 'belanja' AND COALESCE(o.no_bukti, e.no_bukti) NOT IN (SELECT no_bukti FROM ls)), 0) AS belanja_upgu,
      MAX(e.tanggal) FILTER (WHERE e.jenis = 'SP2D_GU') AS gu_terakhir
    FROM bku_entries e
    LEFT JOIN rekening r ON r.kode = e.kode_rekening
    LEFT JOIN bku_entries o ON o.id = e.koreksi_of AND o.skpd_id = e.skpd_id AND o.tahun = e.tahun
    WHERE e.skpd_id = $1 AND e.tahun = $2`, [skpd, tahun]);
  const { rows: [proses] } = await query(`SELECT COALESCE(SUM(nilai),0) AS nilai, COUNT(*)::int AS jumlah FROM spp
    WHERE skpd_id = $1 AND tahun = $2 AND jenis = 'GU' AND status IN ('spp','spm')`, [skpd, tahun]);
  const up = Number(r.up); const tu = Number(r.tu);
  const belumDiganti = Math.max(0, Number(r.belanja_upgu) - Number(r.gu) - tu);
  const persen = up ? (belumDiganti / up) * 100 : 0;
  const usulan = Math.max(0, belumDiganti - Number(proses.nilai));
  return {
    up, gu: Number(r.gu), tu, belanja_upgu: Number(r.belanja_upgu), belum_diganti: belumDiganti, sisa_up: up - belumDiganti,
    persen_terpakai: persen, gu_terakhir: r.gu_terakhir, gu_dalam_proses: Number(proses.nilai), ambang_persen: Number(cfg.ambang_gu_persen),
    usulan_gu: usulan, siap_gu: up > 0 && persen >= Number(cfg.ambang_gu_persen) && usulan > 0,
  };
}

async function nomorBaru(c, skpd, tahun, jenis) {
  const { rows: [r] } = await c.query('SELECT COUNT(*)::int + 1 AS n FROM spp WHERE skpd_id = $1 AND tahun = $2 AND jenis = $3', [skpd, tahun, jenis]);
  const { rows: [s] } = await c.query('SELECT kode FROM skpd WHERE id = $1', [skpd]);
  return `${String(r.n).padStart(4, '0')}/SPP-${jenis.replace('_', '-')}/${s.kode.slice(0, 4)}/${tahun}`;
}

daftarNotifikasi(async ({ user, skpd, tahun, today }) => {
  if (!['admin', 'bendahara'].includes(user.role)) return [];
  const s = await statusUp(skpd, tahun);
  if (!s.siap_gu) return [];
  return [{ id: `gu-${Math.round(s.usulan_gu)}`, tipe: 'gu', tingkat: s.persen_terpakai >= 80 ? 'peringatan' : 'info',
    judul: `UP terpakai ${s.persen_terpakai.toFixed(0)}%: saatnya mengajukan GU`,
    pesan: `Belanja UP yang belum diganti Rp ${Math.round(s.usulan_gu).toLocaleString('id-ID')}. Ajukan SPP-GU agar kas tetap cukup.`, link: '/spp?baru=GU', tanggal: today }];
});

export default async function sppRoutes(app) {
  app.get('/api/spp', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const [{ rows }, up] = await Promise.all([
      query(`SELECT s.*, r.nama AS rekening_nama, rk.nama AS rekanan_nama, u.full_name AS dibuat_oleh
        FROM spp s LEFT JOIN rekening r ON r.kode = s.kode_rekening LEFT JOIN rekanan rk ON rk.id = s.rekanan_id LEFT JOIN users u ON u.id = s.created_by
        WHERE s.skpd_id = $1 AND s.tahun = $2 ORDER BY s.tanggal_spp DESC, s.id DESC`, [skpd, tahun]),
      statusUp(skpd, tahun),
    ]);
    const alur = await statusBanyak('spp', rows.map((r) => r.id));
    for (const r of rows) r.persetujuan = alur[r.id] || null;
    const ringkasan = {};
    for (const r of rows) {
      ringkasan[r.status] = ringkasan[r.status] || { jumlah: 0, nilai: 0 };
      ringkasan[r.status].jumlah += 1; ringkasan[r.status].nilai += Number(r.nilai);
    }
    return { rows, ringkasan, up, jenis: JENIS_SPP };
  });

  app.post('/api/spp', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['jenis', 'tanggal_spp', 'uraian', 'nilai']);
    if (!JENIS_SPP[b.jenis]) throw bad('Jenis SPP tidak dikenal');
    if (!isDate(b.tanggal_spp)) throw bad('Tanggal SPP tidak valid');
    const nilai = money(b.nilai);
    if (!(nilai > 0)) throw bad('Nilai SPP harus lebih dari nol');
    if (b.jenis.startsWith('LS') && !b.kode_rekening) throw bad('SPP LS wajib memilih kode rekening belanja');
    if (b.jenis === 'LS_GAJI' && !String(b.kode_rekening).startsWith('5.1.01')) throw bad('SPP LS Gaji memakai rekening belanja pegawai (5.1.01…)');
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    const tahun = Number(b.tanggal_spp.slice(0, 4));
    return tx(async (c) => {
      if (b.jenis === 'UP') {
        const { rows } = await c.query("SELECT 1 FROM spp WHERE skpd_id = $1 AND tahun = $2 AND jenis = 'UP' AND status <> 'ditolak'", [skpd, tahun]);
        if (rows.length) throw bad('SPP UP hanya diajukan sekali dalam satu tahun anggaran');
      }
      const nomor = String(b.nomor_spp || '').trim() || await nomorBaru(c, skpd, tahun, b.jenis);
      const { rows: [r] } = await c.query(`INSERT INTO spp (skpd_id, tahun, jenis, nomor_spp, tanggal_spp, uraian, nilai, kode_rekening, rekanan_id, catatan, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [skpd, tahun, b.jenis, nomor, b.tanggal_spp, String(b.uraian).slice(0, 500), nilai, b.kode_rekening || null, b.rekanan_id || null, b.catatan || null, req.user.id]);
      const tahap = await buatAlur(c, 'spp', r.id, skpd, tahun);
      const peringatan = b.kode_rekening && b.jenis.startsWith('LS') ? await cekAnggaranKas(c, skpd, b.kode_rekening, b.tanggal_spp, nilai) : null;
      await audit(c, req.user, 'spp_ajukan', 'spp', r.id, { nomor, jenis: b.jenis, nilai }, req.ip);
      await emit(c, 'spp.updated', String(skpd), { skpd_id: skpd, id: r.id, status: 'spp', user: req.user.full_name });
      return { row: r, tahap, peringatan };
    });
  });

  const lanjut = (status) => async (req) => {
    const b = req.body || {};
    return tx(async (c) => {
      const { rows: [s] } = await c.query('SELECT * FROM spp WHERE id = $1 FOR UPDATE', [int(req.params.id)]);
      if (!s) throw notFound();
      scopeSkpd(req.user, s.skpd_id);
      let r;
      if (status === 'spm') {
        if (s.status !== 'spp') throw bad('SPM hanya dapat diterbitkan untuk SPP yang sedang diajukan');
        const alur = await statusAlur(c, 'spp', s.id);
        if (alur.status === 'proses') throw bad(`SPP belum disetujui berjenjang: menunggu ${alur.tahap.find((t) => t.status === 'menunggu')?.label || 'persetujuan'}`);
        const tgl = isDate(b.tanggal_spm) ? b.tanggal_spm : null;
        if (!tgl) throw bad('Tanggal SPM tidak valid');
        if (tgl < s.tanggal_spp) throw bad('Tanggal SPM tidak boleh sebelum tanggal SPP');
        const nomor = String(b.nomor_spm || '').trim() || s.nomor_spp.replace('SPP', 'SPM');
        ({ rows: [r] } = await c.query("UPDATE spp SET status = 'spm', nomor_spm = $2, tanggal_spm = $3, updated_at = now() WHERE id = $1 RETURNING *", [s.id, nomor, tgl]));
      } else if (status === 'ditolak') {
        if (!['spp', 'spm'].includes(s.status)) throw bad('Pengajuan ini tidak dapat ditolak');
        if (!b.catatan) throw bad('Alasan penolakan wajib diisi');
        ({ rows: [r] } = await c.query("UPDATE spp SET status = 'ditolak', catatan = $2, updated_at = now() WHERE id = $1 RETURNING *", [s.id, b.catatan]));
        await c.query("UPDATE persetujuan SET status = 'batal' WHERE objek = 'spp' AND objek_id = $1 AND status IN ('antre','menunggu')", [String(s.id)]);
      } else if (status === 'sp2d') {
        canWrite(req.user, s.skpd_id);
        if (s.status !== 'spm') throw bad('SP2D dicatat setelah SPM terbit');
        const tgl = isDate(b.tanggal_sp2d) ? b.tanggal_sp2d : null;
        if (!tgl) throw bad('Tanggal SP2D tidak valid');
        if (tgl < s.tanggal_spm) throw bad('Tanggal SP2D tidak boleh sebelum tanggal SPM');
        const nomor = String(b.nomor_sp2d || '').trim();
        if (!nomor) throw bad('Nomor SP2D wajib diisi');
        const nilai = Number(s.nilai);
        const entries = s.jenis.startsWith('LS') ? [
          { tanggal: tgl, no_bukti: nomor, jenis: 'SP2D_LS', kode_rekening: s.kode_rekening, rekanan_id: s.rekanan_id, uraian: `Penerimaan SP2D ${JENIS_SPP[s.jenis]}: ${s.uraian}`, penerimaan: nilai },
          { tanggal: tgl, no_bukti: nomor, jenis: 'BELANJA', kode_rekening: s.kode_rekening, rekanan_id: s.rekanan_id, uraian: `Pembayaran ${JENIS_SPP[s.jenis]}: ${s.uraian}`, pengeluaran: nilai },
        ] : [{ tanggal: tgl, no_bukti: nomor, jenis: `SP2D_${s.jenis}`, kode_rekening: KODE_UP, uraian: `Penerimaan SP2D ${JENIS_SPP[s.jenis]} (${s.jenis}): ${s.uraian}`, penerimaan: nilai }];
        const saved = await insertEntries(c, req.user, s.skpd_id, entries);
        ({ rows: [r] } = await c.query("UPDATE spp SET status = 'sp2d', nomor_sp2d = $2, tanggal_sp2d = $3, bku_entry_ids = $4, updated_at = now() WHERE id = $1 RETURNING *",
          [s.id, nomor, tgl, saved.map((e) => e.id)]));
      }
      await audit(c, req.user, `spp_${status}`, 'spp', s.id, b, req.ip);
      await emit(c, 'spp.updated', String(s.skpd_id), { skpd_id: s.skpd_id, id: s.id, status, user: req.user.full_name });
      return { row: r };
    });
  };
  // SPM diterbitkan PA/PPK-SKPD (diwakili verifikator/pimpinan/admin); SP2D dicatat bendahara saat terbit dari BUD
  app.post('/api/spp/:id/spm', { preHandler: requireRole('admin', 'verifikator', 'pimpinan') }, lanjut('spm'));
  app.post('/api/spp/:id/tolak', { preHandler: requireRole('admin', 'verifikator', 'pimpinan') }, lanjut('ditolak'));
  app.post('/api/spp/:id/sp2d', { preHandler: requireRole('admin', 'bendahara') }, lanjut('sp2d'));
}
