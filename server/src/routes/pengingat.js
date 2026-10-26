// Pengingat jatuh tempo pajak dan pusat notifikasi (lonceng di header)
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, int, scopeSkpd } from '../lib/http.js';
import { sumberNotifikasi } from '../lib/notifikasi.js';
import { jatuhTempo, hariIni, selisihHari, NAMA_BULAN } from '../lib/kalender.js';

const LABEL = { PPH21: 'PPh 21', PPH22: 'PPh 22', PPH23: 'PPh 23', PPH4A2: 'PPh 4(2)', PPN: 'PPN' };

/** Rekap kewajiban per masa pajak: nominal belum setor / belum lapor beserta jatuh temponya. */
export async function daftarJatuhTempo(skpd, tahun) {
  const { rows } = await query(`SELECT tahun, masa, jenis_pajak, status, COUNT(*)::int AS jumlah, SUM(nominal) AS nominal
    FROM pajak WHERE skpd_id = $1 AND tahun BETWEEN $2 - 1 AND $2 AND status <> 'dilaporkan'
    GROUP BY 1,2,3,4 ORDER BY 1,2`, [skpd, tahun]);
  const today = hariIni();
  const map = new Map();
  for (const r of rows) {
    const key = `${r.tahun}-${r.masa}`;
    if (!map.has(key)) {
      const jt = jatuhTempo(r.tahun, r.masa);
      map.set(key, { tahun: r.tahun, masa: r.masa, nama_masa: `${NAMA_BULAN[r.masa - 1]} ${r.tahun}`, batas_setor: jt.setor, batas_lapor: jt.lapor,
        belum_setor: 0, jumlah_belum_setor: 0, belum_lapor: 0, jumlah_belum_lapor: 0, per_jenis: {} });
    }
    const m = map.get(key);
    const n = Number(r.nominal);
    if (r.status === 'dipungut') { m.belum_setor += n; m.jumlah_belum_setor += r.jumlah; m.per_jenis[r.jenis_pajak] = (m.per_jenis[r.jenis_pajak] || 0) + n; }
    else { m.belum_lapor += n; m.jumlah_belum_lapor += r.jumlah; }
  }
  return [...map.values()].map((m) => {
    const tenggat = m.belum_setor > 0 ? m.batas_setor : m.batas_lapor;
    const sisa = selisihHari(today, tenggat);
    const tingkat = sisa < 0 ? 'lewat' : sisa <= 3 ? 'segera' : sisa <= 10 ? 'dekat' : 'aman';
    return { ...m, kewajiban: m.belum_setor > 0 ? 'setor' : 'lapor', tenggat, sisa_hari: sisa, tingkat,
      rincian: Object.entries(m.per_jenis).map(([j, v]) => `${LABEL[j]} ${Math.round(v).toLocaleString('id-ID')}`).join(' · ') };
  }).sort((a, b) => a.tenggat.localeCompare(b.tenggat));
}

const fmtTgl = (s) => s.split('-').reverse().join('/');
const rpx = (v) => `Rp ${Math.round(Number(v || 0)).toLocaleString('id-ID')}`;

export default async function pengingatRoutes(app) {
  app.get('/api/pajak/jatuh-tempo', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    return { hari_ini: hariIni(), rows: await daftarJatuhTempo(skpd, tahun) };
  });

  app.get('/api/notifikasi', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) return { items: [] };
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const today = hariIni();
    const items = [];

    for (const j of await daftarJatuhTempo(skpd, tahun)) {
      if (j.tingkat === 'aman') continue;
      const aksi = j.kewajiban === 'setor' ? `Setor pajak masa ${j.nama_masa} ${rpx(j.belum_setor)}` : `Laporkan SPT masa ${j.nama_masa} (${rpx(j.belum_lapor)})`;
      items.push({
        id: `pajak-${j.tahun}-${j.masa}-${j.kewajiban}`, tipe: 'pajak', tingkat: j.tingkat === 'lewat' ? 'bahaya' : 'peringatan',
        judul: j.tingkat === 'lewat' ? `Terlambat ${-j.sisa_hari} hari: ${aksi}` : `${aksi}`,
        pesan: `Jatuh tempo ${j.kewajiban} ${fmtTgl(j.tenggat)}${j.sisa_hari >= 0 ? ` (${j.sisa_hari === 0 ? 'hari ini' : `${j.sisa_hari} hari lagi`})` : ''}.${j.rincian ? ` ${j.rincian}` : ''}`,
        link: '/pajak/register', tanggal: j.tenggat,
      });
    }

    const { rows: [k] } = await query('SELECT COALESCE(MAX(bulan), 0)::int AS bulan FROM periode_kunci WHERE skpd_id = $1 AND tahun = $2', [skpd, tahun]);
    const now = new Date();
    const bulanSelesai = now.getFullYear() > tahun ? 12 : now.getFullYear() < tahun ? 0 : now.getMonth();
    if (k.bulan < bulanSelesai) {
      const belum = bulanSelesai - k.bulan;
      items.push({ id: `tutup-${tahun}-${k.bulan + 1}`, tipe: 'tutup_buku', tingkat: belum > 1 ? 'peringatan' : 'info',
        judul: `${belum} bulan belum ditutup buku`, pesan: `Periode ${NAMA_BULAN[k.bulan]}${belum > 1 ? ` s.d. ${NAMA_BULAN[bulanSelesai - 1]}` : ''} ${tahun} belum dikunci. Tutup buku setelah SPJ disahkan.`,
        link: '/tutup-buku', tanggal: today });
    }

    const { rows: [v] } = await query(`SELECT COUNT(*) FILTER (WHERE v.status IS NULL)::int AS belum, COUNT(*) FILTER (WHERE v.status = 'ditolak')::int AS ditolak
      FROM bku_entries e LEFT JOIN LATERAL (SELECT status FROM bku_verifications WHERE entry_id = e.id ORDER BY verified_at DESC LIMIT 1) v ON true
      WHERE e.skpd_id = $1 AND e.tahun = $2 AND NOT EXISTS (SELECT 1 FROM bku_entries k WHERE k.koreksi_of = e.id AND k.skpd_id = e.skpd_id)`, [skpd, tahun]);
    if (v.ditolak && ['admin', 'bendahara'].includes(req.user.role)) {
      items.push({ id: `ditolak-${v.ditolak}`, tipe: 'verifikasi', tingkat: 'bahaya', judul: `${v.ditolak} transaksi ditolak verifikator`,
        pesan: 'Periksa catatan penolakan lalu buat jurnal koreksi bila perlu.', link: '/bku?verif=ditolak', tanggal: today });
    }
    if (v.belum && ['admin', 'verifikator'].includes(req.user.role)) {
      items.push({ id: `verif-${v.belum}`, tipe: 'verifikasi', tingkat: 'info', judul: `${v.belum.toLocaleString('id-ID')} transaksi menunggu verifikasi`,
        pesan: 'Buka BKU dengan filter "Belum diverifikasi".', link: '/bku?verif=belum', tanggal: today });
    }

    for (const fn of sumberNotifikasi) items.push(...(await fn({ user: req.user, skpd, tahun, today })));

    const urut = { bahaya: 0, peringatan: 1, info: 2 };
    items.sort((a, b) => urut[a.tingkat] - urut[b.tingkat]);
    return { items };
  });
}
