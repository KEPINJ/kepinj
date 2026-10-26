// Peringatan anomali: menangkap kesalahan input sebelum menjadi temuan pemeriksa
import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, int, isDate, money, scopeSkpd } from '../lib/http.js';
import { getPengaturan } from '../lib/pengaturan.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { daftarJatuhTempo } from './pengingat.js';

const t = (s) => String(s).slice(0, 10).split('-').reverse().join('/');
const rp = (v) => `Rp ${Math.round(Number(v || 0)).toLocaleString('id-ID')}`;
// Entri yang sudah dikoreksi tidak dianggap anomali lagi
const BELUM_DIKOREKSI = (a) => `NOT EXISTS (SELECT 1 FROM bku_entries k WHERE k.koreksi_of = ${a}.id AND k.skpd_id = ${a}.skpd_id AND k.tahun = ${a}.tahun)`;

export async function cariAnomali(skpd, tahun) {
  const cfg = await getPengaturan();
  const p = [skpd, tahun];
  const [dup, buktiGanda, tunai, tunaiBesar, pagu, tanpaRek, negatif, pajak] = await Promise.all([
    query(`SELECT a.id AS id_a, a.no_urut AS no_a, b.id AS id_b, b.no_urut AS no_b, a.tanggal AS tgl_a, b.tanggal AS tgl_b, a.pengeluaran, a.uraian, rk.nama AS rekanan
        FROM bku_entries a JOIN bku_entries b ON b.skpd_id = a.skpd_id AND b.tahun = a.tahun AND b.id > a.id
         AND b.jenis = 'BELANJA' AND b.pengeluaran = a.pengeluaran AND COALESCE(b.kode_rekening,'') = COALESCE(a.kode_rekening,'')
         AND COALESCE(b.rekanan_id, 0) = COALESCE(a.rekanan_id, 0) AND abs(b.tanggal - a.tanggal) <= 3
        LEFT JOIN rekanan rk ON rk.id = a.rekanan_id
       WHERE a.skpd_id = $1 AND a.tahun = $2 AND a.jenis = 'BELANJA' AND ${BELUM_DIKOREKSI('a')} AND ${BELUM_DIKOREKSI('b')}
       ORDER BY a.tanggal DESC LIMIT 50`, p),
    query(`SELECT e.no_bukti, array_agg(e.no_urut ORDER BY e.no_urut) AS nomor, array_agg(e.id ORDER BY e.no_urut) AS ids, COUNT(*)::int AS jumlah
        FROM bku_entries e WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.jenis = 'BELANJA' AND e.no_bukti NOT IN ('-', '') AND ${BELUM_DIKOREKSI('e')}
       GROUP BY e.no_bukti HAVING COUNT(*) > 1 ORDER BY 4 DESC LIMIT 50`, p),
    query(`WITH h AS (SELECT tanggal, SUM(penerimaan - pengeluaran) AS mutasi FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND metode = 'tunai' GROUP BY 1),
        s AS (SELECT tanggal, SUM(mutasi) OVER (ORDER BY tanggal) AS saldo FROM h)
      SELECT tanggal, saldo FROM s WHERE saldo > $3 ORDER BY tanggal`, [...p, cfg.batas_kas_tunai]),
    query(`SELECT e.id, e.no_urut, e.tanggal, e.uraian, e.pengeluaran FROM bku_entries e
       WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.metode = 'tunai' AND e.jenis = 'BELANJA' AND e.pengeluaran > $3 AND ${BELUM_DIKOREKSI('e')}
       ORDER BY e.pengeluaran DESC LIMIT 50`, [...p, cfg.batas_transaksi_tunai]),
    query(`WITH real AS (SELECT kode_rekening, SUM(CASE WHEN jenis = 'KOREKSI' THEN pengeluaran - penerimaan ELSE pengeluaran END) AS realisasi
          FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND jenis IN ('BELANJA','SP2D_LS','KOREKSI') AND kode_rekening IS NOT NULL GROUP BY 1)
      SELECT a.kode_rekening, r.nama, a.pagu, COALESCE(x.realisasi,0) AS realisasi FROM anggaran a
        JOIN rekening r ON r.kode = a.kode_rekening LEFT JOIN real x ON x.kode_rekening = a.kode_rekening
       WHERE a.skpd_id = $1 AND a.tahun = $2 AND a.pagu > 0 AND COALESCE(x.realisasi,0) >= a.pagu * $3 / 100.0
       ORDER BY COALESCE(x.realisasi,0) / a.pagu DESC`, [...p, cfg.ambang_pagu_persen]),
    query(`SELECT e.id, e.no_urut, e.tanggal, e.uraian, e.pengeluaran FROM bku_entries e
       WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.jenis = 'BELANJA' AND e.kode_rekening IS NULL AND ${BELUM_DIKOREKSI('e')} ORDER BY e.tanggal DESC LIMIT 50`, p),
    query(`WITH h AS (SELECT tanggal, metode, SUM(penerimaan - pengeluaran) AS mutasi FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 GROUP BY 1,2),
        s AS (SELECT tanggal, metode, SUM(mutasi) OVER (PARTITION BY metode ORDER BY tanggal) AS saldo FROM h)
      SELECT metode, MIN(tanggal) AS tanggal, MIN(saldo) AS saldo, COUNT(*)::int AS hari FROM s WHERE saldo < 0 GROUP BY 1`, p),
    daftarJatuhTempo(skpd, tahun),
  ]);

  const items = [];
  const push = (o) => items.push(o);
  for (const d of dup.rows) {
    push({ kode: 'duplikat', tingkat: 'bahaya', kategori: 'Transaksi ganda',
      judul: `Kemungkinan transaksi ganda: No. ${d.no_a} & No. ${d.no_b}`,
      pesan: `${rp(d.pengeluaran)} · ${d.uraian.slice(0, 80)}${d.rekanan ? ` · ${d.rekanan}` : ''} · tanggal ${t(d.tgl_a)} dan ${t(d.tgl_b)}. Bila benar ganda, buat jurnal koreksi untuk salah satunya.`,
      entri: [d.id_a, d.id_b], link: `/bku?id=${d.id_b}&cari=${encodeURIComponent(d.uraian.slice(0, 40))}` });
  }
  for (const g of buktiGanda.rows) {
    push({ kode: 'bukti_ganda', tingkat: 'peringatan', kategori: 'No. bukti ganda',
      judul: `No. bukti "${g.no_bukti}" dipakai ${g.jumlah} transaksi belanja`, pesan: `Nomor BKU ${g.nomor.join(', ')}. Pastikan setiap bukti pengeluaran bernomor unik.`,
      entri: g.ids, link: `/bku?cari=${encodeURIComponent(g.no_bukti)}` });
  }
  if (tunai.rows.length) {
    const max = tunai.rows.reduce((m, r) => (Number(r.saldo) > Number(m.saldo) ? r : m));
    push({ kode: 'kas_tunai', tingkat: 'peringatan', kategori: 'Kas tunai berlebih',
      judul: `Saldo kas tunai melebihi batas ${rp(cfg.batas_kas_tunai)} selama ${tunai.rows.length} hari`,
      pesan: `Tertinggi ${rp(max.saldo)} pada ${t(max.tanggal)}. Setorkan kelebihan kas tunai ke rekening bendahara untuk mengurangi risiko.`, link: '/penutupan-kas' });
  }
  for (const t of tunaiBesar.rows) {
    push({ kode: 'tunai_besar', tingkat: 'info', kategori: 'Pembayaran tunai besar',
      judul: `Belanja tunai ${rp(t.pengeluaran)} (No. ${t.no_urut})`, pesan: `${t.uraian.slice(0, 90)} · ${t(t.tanggal)}. Pembayaran di atas ${rp(cfg.batas_transaksi_tunai)} sebaiknya non-tunai (transfer/CMS).`,
      entri: [t.id], link: `/bku?id=${t.id}&cari=${encodeURIComponent(t.uraian.slice(0, 40))}` });
  }
  for (const r of pagu.rows) {
    const persen = (Number(r.realisasi) / Number(r.pagu)) * 100;
    push({ kode: 'pagu', tingkat: persen > 100 ? 'bahaya' : 'peringatan', kategori: persen > 100 ? 'Melebihi pagu' : 'Mendekati pagu',
      judul: `${r.nama} ${persen > 100 ? 'melebihi' : 'mencapai'} ${persen.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% pagu`,
      pesan: `${r.kode_rekening} · realisasi ${rp(r.realisasi)} dari pagu ${rp(r.pagu)} (sisa ${rp(Number(r.pagu) - Number(r.realisasi))}).`, link: '/realisasi' });
  }
  for (const t of tanpaRek.rows) {
    push({ kode: 'tanpa_rekening', tingkat: 'peringatan', kategori: 'Tanpa kode rekening',
      judul: `Belanja No. ${t.no_urut} belum memiliki kode rekening`, pesan: `${t.uraian.slice(0, 90)} · ${rp(t.pengeluaran)}. Realisasi anggaran dan SPJ tidak akan memuat transaksi ini.`,
      entri: [t.id], link: `/bku?id=${t.id}&cari=${encodeURIComponent(t.uraian.slice(0, 40))}` });
  }
  for (const n of negatif.rows) {
    push({ kode: 'saldo_negatif', tingkat: 'bahaya', kategori: 'Saldo negatif',
      judul: `Saldo kas ${n.metode} negatif sejak ${t(n.tanggal)}`, pesan: `Saldo terendah ${rp(n.saldo)} selama ${n.hari} hari. Periksa urutan tanggal atau transaksi yang belum dicatat.`, link: '/bku' });
  }
  for (const j of pajak.filter((x) => x.tingkat === 'lewat')) {
    push({ kode: 'pajak_terlambat', tingkat: 'bahaya', kategori: 'Pajak terlambat',
      judul: `Pajak masa ${j.nama_masa} terlambat ${j.kewajiban === 'setor' ? 'disetor' : 'dilaporkan'} ${-j.sisa_hari} hari`,
      pesan: `${rp(j.kewajiban === 'setor' ? j.belum_setor : j.belum_lapor)} · jatuh tempo ${t(j.tenggat)}. Keterlambatan dapat dikenai sanksi bunga/denda.`, link: '/pajak/register' });
  }
  const urut = { bahaya: 0, peringatan: 1, info: 2 };
  items.sort((a, b) => urut[a.tingkat] - urut[b.tingkat]);
  const ringkasan = { bahaya: 0, peringatan: 0, info: 0 };
  items.forEach((i) => { ringkasan[i.tingkat] += 1; });
  return { items, ringkasan, pengaturan: cfg };
}

daftarNotifikasi(async ({ skpd, tahun, today }) => {
  const { ringkasan, items } = await cariAnomali(skpd, tahun);
  const serius = items.filter((i) => i.tingkat === 'bahaya' && i.kode !== 'pajak_terlambat').length;
  if (!serius && !ringkasan.peringatan) return [];
  return [{ id: `anomali-${serius}-${ringkasan.peringatan}`, tipe: 'anomali', tingkat: serius ? 'bahaya' : 'peringatan',
    judul: `${serius + ringkasan.peringatan} peringatan anomali data`, pesan: 'Kemungkinan transaksi ganda, kas tunai berlebih, pagu terlampaui, dll.', link: '/peringatan', tanggal: today }];
});

export default async function anomaliRoutes(app) {
  app.get('/api/anomali', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    return cariAnomali(skpd, int(req.query.tahun, new Date().getFullYear()));
  });

  // Dipakai formulir transaksi: cari transaksi serupa sebelum disimpan
  app.post('/api/bku/cek-duplikat', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    const skpd = scopeSkpd(req.user, b.skpd_id);
    const nilai = money(b.nilai);
    if (!isDate(b.tanggal) || !(nilai > 0)) return { rows: [] };
    const { rows } = await query(`SELECT e.id, e.no_urut, e.tanggal, e.no_bukti, e.uraian, e.penerimaan, e.pengeluaran
        FROM bku_entries e WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.jenis NOT IN ('PAJAK_PUNGUT','KOREKSI')
         AND ((abs(e.tanggal - $3::date) <= 7 AND (e.pengeluaran = $4 OR e.penerimaan = $4) AND ($5::int IS NULL OR e.rekanan_id = $5 OR e.rekanan_id IS NULL))
              OR (NULLIF($6, '') IS NOT NULL AND e.no_bukti = $6 AND e.jenis = 'BELANJA'))
         AND ${BELUM_DIKOREKSI('e')}
       ORDER BY abs(e.tanggal - $3::date) LIMIT 5`, [skpd, Number(b.tanggal.slice(0, 4)), b.tanggal, nilai, b.rekanan_id ? Number(b.rekanan_id) : null, String(b.no_bukti || '').trim()]);
    return { rows };
  });

  app.get('/api/pengaturan', { preHandler: requireAuth }, async () => getPengaturan());
  app.put('/api/pengaturan', { preHandler: requireRole('admin') }, async (req) => {
    const allowed = ['batas_kas_tunai', 'batas_transaksi_tunai', 'ambang_pagu_persen', 'ambang_gu_persen', 'batas_hari_panjar'];
    const changes = Object.entries(req.body || {}).filter(([k, v]) => allowed.includes(k) && Number.isFinite(Number(v)) && Number(v) >= 0);
    if (!changes.length) throw bad('Tidak ada pengaturan yang valid');
    return tx(async (c) => {
      for (const [k, v] of changes) await c.query('INSERT INTO pengaturan (kunci, nilai, updated_at) VALUES ($1, $2, now()) ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, updated_at = now()', [k, JSON.stringify(Number(v))]);
      await audit(c, req.user, 'pengaturan_ubah', 'pengaturan', null, Object.fromEntries(changes), req.ip);
      return getPengaturan();
    });
  });
}
