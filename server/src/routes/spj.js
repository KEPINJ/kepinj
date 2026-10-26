// Laporan Pertanggungjawaban (SPJ) Bendahara Pengeluaran dan Buku Pembantu (Permendagri 77/2020)
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, int, scopeSkpd, sendFile, XLSX } from '../lib/http.js';
import { buildWorkbook } from '../lib/excel.js';
import { NAMA_BULAN } from '../lib/kalender.js';
import { terbilang } from '../../../shared/terbilang.js';

const KELAS = ['ls_gaji', 'ls_barang', 'upgu'];
const PAJAK = ['PPN', 'PPh 21', 'PPh 22', 'PPh 23', 'PPh 4 ayat (2)'];
const akhirBulan = (t, b) => new Date(Date.UTC(t, b, 0)).toISOString().slice(0, 10);
const tiga = () => ({ lalu: 0, ini: 0, sd: 0 });
const add = (o, bulan, b, v) => { if (bulan < b) o.lalu += v; else o.ini += v; o.sd += v; };

// Belanja dikelompokkan: LS (no. bukti sama dengan SP2D LS) gaji/barang-jasa, atau UP/GU/TU
const KELAS_SQL = `
  CASE WHEN COALESCE(o.no_bukti, e.no_bukti) IN (SELECT no_bukti FROM ls)
       THEN CASE WHEN e.kode_rekening LIKE '5.1.01%' THEN 'ls_gaji' ELSE 'ls_barang' END
       ELSE 'upgu' END`;
const LS_CTE = `ls AS (SELECT DISTINCT no_bukti FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND jenis = 'SP2D_LS')`;

export async function dataSpj(skpd, tahun, bulan) {
  const akhir = akhirBulan(tahun, bulan);
  const [{ rows: belanja }, { rows: arus }, { rows: anggaran }, { rows: [skpdRow] }, { rows: [saldo] }] = await Promise.all([
    query(`WITH ${LS_CTE}
      SELECT e.kode_rekening, ${KELAS_SQL} AS kelas, EXTRACT(MONTH FROM e.tanggal)::int AS bulan,
             SUM(CASE WHEN e.jenis = 'KOREKSI' THEN e.pengeluaran - e.penerimaan ELSE e.pengeluaran END) AS nilai
        FROM bku_entries e
        JOIN rekening r ON r.kode = e.kode_rekening AND r.jenis = 'belanja'
        LEFT JOIN bku_entries o ON o.id = e.koreksi_of AND o.skpd_id = e.skpd_id AND o.tahun = e.tahun
       WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.tanggal <= $3 AND e.jenis IN ('BELANJA','SP2D_LS','KOREKSI')
       GROUP BY 1,2,3`, [skpd, tahun, akhir]),
    query(`WITH ${LS_CTE}
      SELECT e.jenis, EXTRACT(MONTH FROM e.tanggal)::int AS bulan,
             CASE WHEN e.jenis = 'SP2D_LS' THEN CASE WHEN e.kode_rekening LIKE '5.1.01%' THEN 'ls_gaji' ELSE 'ls_barang' END
                  WHEN e.jenis IN ('BELANJA','KOREKSI') AND r.jenis = 'belanja' THEN ${KELAS_SQL} END AS kelas,
             substring(e.uraian from '^(?:Diterima|Disetor) (PPN|PPh 21|PPh 22|PPh 23|PPh 4 ayat \\(2\\))') AS pajak,
             SUM(e.penerimaan) AS masuk, SUM(e.pengeluaran) AS keluar
        FROM bku_entries e
        LEFT JOIN rekening r ON r.kode = e.kode_rekening
        LEFT JOIN bku_entries o ON o.id = e.koreksi_of AND o.skpd_id = e.skpd_id AND o.tahun = e.tahun
       WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.tanggal <= $3
       GROUP BY 1,2,3,4`, [skpd, tahun, akhir]),
    query(`SELECT a.kode_rekening, r.nama, a.pagu FROM anggaran a JOIN rekening r ON r.kode = a.kode_rekening
      WHERE a.skpd_id = $1 AND a.tahun = $2 AND r.jenis = 'belanja' ORDER BY 1`, [skpd, tahun]),
    query('SELECT * FROM skpd WHERE id = $1', [skpd]),
    query(`SELECT COALESCE(SUM(penerimaan - pengeluaran),0) AS saldo,
        COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode='bank'),0) AS bank,
        COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode='tunai'),0) AS tunai
      FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND tanggal <= $3`, [skpd, tahun, akhir]),
  ]);

  // Bagian 1: realisasi per kode rekening
  const map = new Map(anggaran.map((a) => [a.kode_rekening, { kode_rekening: a.kode_rekening, nama: a.nama, pagu: Number(a.pagu), ...Object.fromEntries(KELAS.map((k) => [k, tiga()])) }]));
  const { rows: namaRek } = belanja.some((b) => !map.has(b.kode_rekening))
    ? await query('SELECT kode, nama FROM rekening WHERE kode = ANY($1)', [[...new Set(belanja.map((b) => b.kode_rekening))]]) : { rows: [] };
  for (const b of belanja) {
    if (!map.has(b.kode_rekening)) map.set(b.kode_rekening, { kode_rekening: b.kode_rekening, nama: namaRek.find((r) => r.kode === b.kode_rekening)?.nama || '', pagu: 0, ...Object.fromEntries(KELAS.map((k) => [k, tiga()])) });
    add(map.get(b.kode_rekening)[b.kelas], b.bulan, bulan, Number(b.nilai));
  }
  const rekening = [...map.values()].sort((a, c) => a.kode_rekening.localeCompare(c.kode_rekening)).map((r) => {
    const sd = KELAS.reduce((s, k) => s + r[k].sd, 0);
    return { ...r, jumlah_sd: sd, sisa: r.pagu - sd, persen: r.pagu ? (sd / r.pagu) * 100 : null };
  });
  const total = { pagu: 0, jumlah_sd: 0, sisa: 0, ...Object.fromEntries(KELAS.map((k) => [k, tiga()])) };
  for (const r of rekening) {
    total.pagu += r.pagu; total.jumlah_sd += r.jumlah_sd; total.sisa += r.sisa;
    for (const k of KELAS) for (const p of ['lalu', 'ini', 'sd']) total[k][p] += r[k][p];
  }

  // Bagian 2: penerimaan & pengeluaran kas bendahara
  const p = {
    sp2d_ls_gaji: tiga(), sp2d_ls_barang: tiga(), sp2d_upgutu: tiga(), ...Object.fromEntries(PAJAK.map((j) => [`pungut_${j}`, tiga()])), terima_lain: tiga(),
    spj_ls_gaji: tiga(), spj_ls_barang: tiga(), spj_upgutu: tiga(), ...Object.fromEntries(PAJAK.map((j) => [`setor_${j}`, tiga()])), keluar_lain: tiga(),
  };
  for (const a of arus) {
    const masuk = Number(a.masuk); const keluar = Number(a.keluar);
    if (a.jenis === 'SALDO_AWAL') continue;
    if (a.jenis === 'SP2D_LS') { add(p[a.kelas === 'ls_gaji' ? 'sp2d_ls_gaji' : 'sp2d_ls_barang'], a.bulan, bulan, masuk); if (keluar) add(p[a.kelas === 'ls_gaji' ? 'spj_ls_gaji' : 'spj_ls_barang'], a.bulan, bulan, keluar); continue; }
    if (['SP2D_UP', 'SP2D_GU', 'SP2D_TU'].includes(a.jenis)) { add(p.sp2d_upgutu, a.bulan, bulan, masuk - keluar); continue; }
    if (a.jenis === 'PAJAK_PUNGUT' && a.pajak) { add(p[`pungut_${a.pajak}`], a.bulan, bulan, masuk - keluar); continue; }
    if (a.jenis === 'PAJAK_SETOR' && a.pajak) { add(p[`setor_${a.pajak}`], a.bulan, bulan, keluar - masuk); continue; }
    if (a.kelas) { add(p[{ ls_gaji: 'spj_ls_gaji', ls_barang: 'spj_ls_barang', upgu: 'spj_upgutu' }[a.kelas]], a.bulan, bulan, keluar - masuk); continue; }
    if (a.jenis === 'PELIMPAHAN') continue; // pindah buku bank <-> tunai, bukan arus kas bendahara
    if (masuk) add(p.terima_lain, a.bulan, bulan, masuk);
    if (keluar) add(p.keluar_lain, a.bulan, bulan, keluar);
  }
  const sum = (keys) => keys.reduce((o, k) => ({ lalu: o.lalu + p[k].lalu, ini: o.ini + p[k].ini, sd: o.sd + p[k].sd }), tiga());
  const kPenerimaan = Object.keys(p).filter((k) => k.startsWith('sp2d') || k.startsWith('pungut') || k === 'terima_lain');
  const kPengeluaran = Object.keys(p).filter((k) => k.startsWith('spj') || k.startsWith('setor') || k === 'keluar_lain');
  const s = { saldo: Number(saldo.saldo), bank: Number(saldo.bank), tunai: Number(saldo.tunai) };
  return {
    skpd: skpdRow, tahun, bulan, nama_bulan: NAMA_BULAN[bulan - 1], akhir, rekening, total,
    arus: p, jumlah_penerimaan: sum(kPenerimaan), jumlah_pengeluaran: sum(kPengeluaran),
    saldo_kas: s, terbilang_saldo: terbilang(s.saldo),
  };
}

/** Buku pembantu: kas tunai, bank, rincian objek belanja, UP/GU/TU. */
export async function dataBukuPembantu(skpd, tahun, { jenis, bulan, kode_rekening: kode }) {
  const dari = bulan ? `${tahun}-${String(bulan).padStart(2, '0')}-01` : `${tahun}-01-01`;
  const sampai = bulan ? akhirBulan(tahun, bulan) : `${tahun}-12-31`;
  const sel = 'e.id, e.no_urut, e.tanggal, e.no_bukti, e.jenis, e.kode_rekening, e.uraian, e.penerimaan::float AS masuk, e.pengeluaran::float AS keluar';
  let saldoAwal = 0; let rows = []; let extra = {};
  if (jenis === 'tunai' || jenis === 'bank') {
    const { rows: [s] } = await query(`SELECT COALESCE(SUM(penerimaan - pengeluaran),0)::float AS s FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND metode = $3 AND tanggal < $4`, [skpd, tahun, jenis, dari]);
    saldoAwal = s.s;
    ({ rows } = await query(`SELECT ${sel} FROM bku_entries e WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.metode = $3 AND e.tanggal BETWEEN $4 AND $5 ORDER BY e.tanggal, e.no_urut`, [skpd, tahun, jenis, dari, sampai]));
  } else if (jenis === 'upgu') {
    const filter = `(e.jenis IN ('SP2D_UP','SP2D_GU','SP2D_TU') OR (e.jenis IN ('BELANJA','KOREKSI') AND r.jenis = 'belanja' AND COALESCE(o.no_bukti, e.no_bukti) NOT IN (SELECT no_bukti FROM ls)))`;
    const base = `WITH ${LS_CTE} SELECT ${sel} FROM bku_entries e LEFT JOIN rekening r ON r.kode = e.kode_rekening
      LEFT JOIN bku_entries o ON o.id = e.koreksi_of AND o.skpd_id = e.skpd_id AND o.tahun = e.tahun WHERE e.skpd_id = $1 AND e.tahun = $2 AND ${filter}`;
    const { rows: before } = await query(`${base} AND e.tanggal < $3`, [skpd, tahun, dari]);
    saldoAwal = before.reduce((s, r) => s + r.masuk - r.keluar, 0);
    ({ rows } = await query(`${base} AND e.tanggal BETWEEN $3 AND $4 ORDER BY e.tanggal, e.no_urut`, [skpd, tahun, dari, sampai]));
  } else if (jenis === 'rincian') {
    if (!kode) {
      const { rows: list } = await query(`SELECT r.kode AS kode_rekening, r.nama, COALESCE(a.pagu,0)::float AS pagu,
          COALESCE(SUM(CASE WHEN e.jenis = 'KOREKSI' THEN e.pengeluaran - e.penerimaan ELSE e.pengeluaran END) FILTER (WHERE e.tanggal <= $3),0)::float AS realisasi,
          COUNT(e.id) FILTER (WHERE e.tanggal BETWEEN $4 AND $3)::int AS transaksi
        FROM rekening r
        LEFT JOIN anggaran a ON a.kode_rekening = r.kode AND a.skpd_id = $1 AND a.tahun = $2
        LEFT JOIN bku_entries e ON e.kode_rekening = r.kode AND e.skpd_id = $1 AND e.tahun = $2 AND e.jenis IN ('BELANJA','SP2D_LS','KOREKSI')
        WHERE r.jenis = 'belanja' GROUP BY r.kode, r.nama, a.pagu HAVING COALESCE(a.pagu,0) > 0 OR COUNT(e.id) > 0 ORDER BY r.kode`, [skpd, tahun, sampai, dari]);
      return { jenis, tahun, bulan, dari, sampai, daftar: list.map((l) => ({ ...l, sisa: l.pagu - l.realisasi })) };
    }
    const filter = `e.kode_rekening = $3 AND e.jenis IN ('BELANJA','SP2D_LS','KOREKSI')`;
    const nilai = `(CASE WHEN e.jenis = 'KOREKSI' THEN e.pengeluaran - e.penerimaan ELSE e.pengeluaran END)`;
    const { rows: [s] } = await query(`SELECT COALESCE(SUM(${nilai}),0)::float AS s FROM bku_entries e WHERE e.skpd_id = $1 AND e.tahun = $2 AND ${filter} AND e.tanggal < $4`, [skpd, tahun, kode, dari]);
    const { rows: [a] } = await query('SELECT a.pagu::float AS pagu, r.nama FROM rekening r LEFT JOIN anggaran a ON a.kode_rekening = r.kode AND a.skpd_id = $1 AND a.tahun = $2 WHERE r.kode = $3', [skpd, tahun, kode]);
    ({ rows } = await query(`SELECT ${sel}, ${nilai}::float AS nilai FROM bku_entries e WHERE e.skpd_id = $1 AND e.tahun = $2 AND ${filter} AND e.tanggal BETWEEN $4 AND $5 AND ${nilai} <> 0 ORDER BY e.tanggal, e.no_urut`, [skpd, tahun, kode, dari, sampai]));
    let kum = s.s;
    rows = rows.map((r) => { kum += r.nilai; return { ...r, kumulatif: kum, sisa_pagu: (a?.pagu || 0) - kum }; });
    return { jenis, tahun, bulan, dari, sampai, kode_rekening: kode, nama: a?.nama, pagu: a?.pagu || 0, realisasi_awal: s.s, rows, realisasi_akhir: kum };
  } else throw bad('Jenis buku pembantu tidak dikenal');

  let saldo = saldoAwal;
  rows = rows.map((r) => { saldo += r.masuk - r.keluar; return { ...r, saldo }; });
  extra = { penerimaan: rows.reduce((s, r) => s + r.masuk, 0), pengeluaran: rows.reduce((s, r) => s + r.keluar, 0) };
  return { jenis, tahun, bulan, dari, sampai, saldo_awal: saldoAwal, saldo_akhir: saldo, rows, ...extra };
}

export const JUDUL_PEMBANTU = { tunai: 'BUKU PEMBANTU KAS TUNAI', bank: 'BUKU PEMBANTU SIMPANAN/BANK', upgu: 'BUKU PEMBANTU UP/GU/TU', rincian: 'BUKU PEMBANTU RINCIAN OBJEK BELANJA' };

export default async function spjRoutes(app) {
  app.get('/api/spj', { preHandler: requireAuth }, async (req, reply) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const bulan = Math.min(Math.max(int(req.query.bulan, new Date().getMonth() + 1), 1), 12);
    const d = await dataSpj(skpd, tahun, bulan);
    if (req.query.format !== 'xlsx') return d;
    const flat = (r) => Object.fromEntries(KELAS.flatMap((k) => ['lalu', 'ini', 'sd'].map((p) => [`${k}_${p}`, r[k][p]])));
    const buf = await buildWorkbook({
      title: `LAPORAN PERTANGGUNGJAWABAN BENDAHARA PENGELUARAN (SPJ ${req.query.versi === 'administratif' ? 'ADMINISTRATIF' : 'FUNGSIONAL'}) - ${d.skpd.nama.toUpperCase()}`,
      subtitle: `Bulan ${d.nama_bulan} ${tahun}`,
      sheetName: 'SPJ',
      columns: [
        { key: 'kode_rekening', header: 'Kode Rekening', width: 20 }, { key: 'nama', header: 'Uraian', width: 44 }, { key: 'pagu', header: 'Jumlah Anggaran', type: 'money' },
        ...[['ls_gaji', 'LS Gaji'], ['ls_barang', 'LS Barang & Jasa'], ['upgu', 'UP/GU/TU']].flatMap(([k, l]) => [
          { key: `${k}_lalu`, header: `${l} s.d. Bulan Lalu`, type: 'money' }, { key: `${k}_ini`, header: `${l} Bulan Ini`, type: 'money' }, { key: `${k}_sd`, header: `${l} s.d. Bulan Ini`, type: 'money' }]),
        { key: 'jumlah_sd', header: 'Jumlah SPJ s.d. Bulan Ini', type: 'money' }, { key: 'sisa', header: 'Sisa Pagu Anggaran', type: 'money' },
      ],
      rows: d.rekening.map((r) => ({ ...r, ...flat(r) })),
      totals: { pagu: d.total.pagu, ...flat(d.total), jumlah_sd: d.total.jumlah_sd, sisa: d.total.sisa },
    });
    return sendFile(reply, buf, `SPJ_${d.skpd.kode}_${tahun}_${String(bulan).padStart(2, '0')}.xlsx`, XLSX);
  });

  app.get('/api/buku-pembantu', { preHandler: requireAuth }, async (req, reply) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    const bulan = int(req.query.bulan) || null;
    const d = await dataBukuPembantu(skpd, tahun, { jenis: req.query.jenis, bulan, kode_rekening: req.query.kode_rekening });
    const { rows: [s] } = await query('SELECT * FROM skpd WHERE id = $1', [skpd]);
    if (req.query.format !== 'xlsx') return { ...d, skpd: s };
    const periode = bulan ? `${NAMA_BULAN[bulan - 1]} ${tahun}` : `Tahun ${tahun}`;
    if (d.daftar) {
      const buf = await buildWorkbook({ title: `${JUDUL_PEMBANTU.rincian} - ${s.nama.toUpperCase()}`, subtitle: periode, sheetName: 'Rincian Objek',
        columns: [{ key: 'kode_rekening', header: 'Kode Rekening', width: 20 }, { key: 'nama', header: 'Uraian', width: 50 }, { key: 'pagu', header: 'Pagu', type: 'money' },
          { key: 'realisasi', header: 'Realisasi', type: 'money' }, { key: 'sisa', header: 'Sisa', type: 'money' }], rows: d.daftar });
      return sendFile(reply, buf, `BukuPembantu_RincianObjek_${s.kode}_${tahun}.xlsx`, XLSX);
    }
    const isRincian = d.jenis === 'rincian';
    const buf = await buildWorkbook({
      title: `${JUDUL_PEMBANTU[d.jenis]} - ${s.nama.toUpperCase()}`,
      subtitle: `${periode}${isRincian ? ` | ${d.kode_rekening} ${d.nama} | Pagu Rp ${Number(d.pagu).toLocaleString('id-ID')}` : ` | Saldo awal Rp ${d.saldo_awal.toLocaleString('id-ID')}`}`,
      sheetName: 'Buku Pembantu',
      columns: [{ key: 'no_urut', header: 'No BKU', width: 8 }, { key: 'tanggal', header: 'Tanggal', width: 12 }, { key: 'no_bukti', header: 'No. Bukti', width: 20 }, { key: 'uraian', header: 'Uraian', width: 50 },
        ...(isRincian ? [{ key: 'nilai', header: 'Realisasi', type: 'money' }, { key: 'kumulatif', header: 'Jumlah s.d.', type: 'money' }, { key: 'sisa_pagu', header: 'Sisa Pagu', type: 'money' }]
          : [{ key: 'masuk', header: 'Penerimaan', type: 'money' }, { key: 'keluar', header: 'Pengeluaran', type: 'money' }, { key: 'saldo', header: 'Saldo', type: 'money' }])],
      rows: d.rows,
    });
    return sendFile(reply, buf, `BukuPembantu_${d.jenis}_${s.kode}_${tahun}${bulan ? `_${bulan}` : ''}.xlsx`, XLSX);
  });
}

