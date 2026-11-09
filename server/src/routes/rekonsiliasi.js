// Rekonsiliasi bank otomatis/semiotomatis: unggah mutasi (CSV/Excel) -> baca kolom -> cocokkan dengan BKU kas bank
// -> bendahara mengonfirmasi -> laporan rekonsiliasi (layar, cetak, Excel).
import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, notFound, int, isDate, scopeSkpd, canWrite, sendFile, XLSX, required, money } from '../lib/http.js';
import { buildWorkbook } from '../lib/excel.js';
import { getPengaturan } from '../lib/pengaturan.js';
import { kirimNotifikasi } from '../lib/kirimnotif.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { loadDataset, normDate } from './data.js';
import { toNum } from '../../../shared/expr.js';
import { rekonsiliasi, ringkas, laporanSaldo, tebakKolom } from '../../../shared/rekonsiliasi.js';

const KATEGORI = { cocok: 'Cocok', selisih: 'Selisih', periksa: 'Perlu diperiksa', belum_bku: 'Belum tercatat di BKU', belum_bank: 'Belum ada di bank', duplikat: 'Duplikat' };

/** Baca baris mutasi dari dataset sesuai pemetaan kolom (debet/kredit atau satu kolom nilai bertanda). */
export function bacaMutasi(rows, m) {
  return rows.map((r, i) => {
    let masuk = toNum(r[m.kredit]); let keluar = toNum(r[m.debet]);
    if (m.nilai) { const n = toNum(r[m.nilai]); masuk = n > 0 ? n : 0; keluar = n < 0 ? -n : 0; }
    return { baris: i + 1, tanggal: normDate(r[m.tanggal]), keterangan: String(r[m.keterangan] ?? '').trim(), masuk: Math.abs(masuk || 0), keluar: Math.abs(keluar || 0),
      saldo: m.saldo && r[m.saldo] !== '' && r[m.saldo] != null ? toNum(r[m.saldo]) : null };
  }).filter((x) => x.tanggal && (x.masuk > 0 || x.keluar > 0));
}

/** BKU kas bank pada rentang tanggal; belanja dibandingkan juga dengan nilai netto setelah potongan pajak. */
async function bkuBank(skpd, dari, sampai, tol) {
  const { rows: semua } = await query(`SELECT e.id, e.no_urut, e.tanggal, e.no_bukti, e.jenis, e.uraian, e.penerimaan::float AS masuk, e.pengeluaran::float AS keluar, s.status
    FROM bku_entries e LEFT JOIN bku_status s ON s.entry_id = e.id
    WHERE e.skpd_id = $1 AND e.metode = 'bank' AND e.tanggal BETWEEN ($2::date - $4::int) AND ($3::date + $4::int) ORDER BY e.tanggal, e.no_urut`, [skpd, dari, sampai, tol]);
  // Pungutan pajak adalah pembukuan (bukan arus kas bank): belanja dibayar netto ke rekanan.
  const pungut = {};
  for (const e of semua) if (e.jenis === 'PAJAK_PUNGUT') pungut[`${e.no_bukti}|${e.tanggal}`] = (pungut[`${e.no_bukti}|${e.tanggal}`] || 0) + e.masuk;
  return semua.filter((e) => e.jenis !== 'PAJAK_PUNGUT').map((e) => ({ ...e, netto: e.keluar > 0 ? Math.round((e.keluar - (pungut[`${e.no_bukti}|${e.tanggal}`] || 0)) * 100) / 100 : 0 }));
}

/** Saldo kas bank menurut BKU per tanggal. Pungutan pajak ikut dihitung: belanja dibukukan bruto, pajaknya tetap
 *  mengendap di rekening sampai disetor, sehingga saldo buku = saldo yang seharusnya tampil di rekening koran. */
async function saldoBkuBank(skpd, tanggal) {
  const { rows: [r] } = await query(`SELECT COALESCE(SUM(penerimaan - pengeluaran), 0)::float AS saldo
    FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND metode = 'bank' AND tanggal <= $3`, [skpd, Number(tanggal.slice(0, 4)), tanggal]);
  return Math.round(r.saldo * 100) / 100;
}

daftarNotifikasi(async ({ user, skpd }) => {
  if (!['admin', 'bendahara', 'verifikator'].includes(user.role)) return [];
  const { rows: [r] } = await query(`SELECT id, sampai, ringkasan FROM rekonsiliasi_bank WHERE skpd_id = $1 AND status = 'final' ORDER BY sampai DESC, id DESC LIMIT 1`, [skpd]);
  const now = new Date();
  const bulanLalu = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
  const out = [];
  if (!r || r.sampai < bulanLalu.slice(0, 8) + '01') {
    out.push({ id: `rekon-belum-${bulanLalu.slice(0, 7)}`, tipe: 'rekonsiliasi', kategori: 'rekonsiliasi', tingkat: 'info', judul: 'Rekonsiliasi bank bulan lalu belum difinalkan',
      pesan: `Unggah rekening koran s.d. ${bulanLalu.split('-').reverse().join('/')} untuk mencocokkan saldo BKU dengan bank.`, link: '/rekonsiliasi', tanggal: null });
  }
  return out;
});

export default async function rekonsiliasiRoutes(app) {
  app.get('/api/rekonsiliasi/riwayat', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const { rows } = await query(`SELECT r.id, r.dari, r.sampai, r.status, r.ringkasan, r.catatan, r.created_at, r.nama_file, r.saldo_bank, r.saldo_bku, r.difinalkan_at,
        jsonb_array_length(r.pasangan) AS jumlah_pasangan, u.full_name AS dibuat_oleh, f.full_name AS difinalkan_oleh_nama
      FROM rekonsiliasi_bank r LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users f ON f.id = r.difinalkan_oleh
      WHERE r.skpd_id = $1 ORDER BY r.created_at DESC LIMIT 50`, [skpd]);
    return { rows };
  });

  // Tebak pemetaan kolom dari dataset yang baru diunggah
  app.get('/api/rekonsiliasi/kolom/:dataset', { preHandler: requireAuth }, async (req) => {
    const { ds, rows } = await loadDataset(req.params.dataset, req.user);
    const mapping = tebakKolom(ds.columns);
    const contoh = bacaMutasi(rows.slice(0, 200), mapping);
    return { kolom: ds.columns, mapping, terbaca: contoh.length, contoh: contoh.slice(0, 5), baris: rows.length };
  });

  // Jalankan pencocokan otomatis
  app.post('/api/rekonsiliasi', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    required(b, ['dataset_id']);
    const skpd = scopeSkpd(req.user, b.skpd_id);
    const cfg = await getPengaturan();
    const { ds, rows } = await loadDataset(b.dataset_id, req.user);
    const m = b.mapping?.tanggal ? b.mapping : tebakKolom(ds.columns);
    if (!m.tanggal) throw bad('Kolom tanggal tidak ditemukan. Petakan kolom secara manual.');
    if (!m.debet && !m.kredit && !m.nilai) throw bad('Petakan kolom debet/kredit atau satu kolom nilai');
    const mutasi = bacaMutasi(rows, m);
    if (!mutasi.length) throw bad('Tidak ada baris mutasi yang terbaca. Periksa pemetaan kolom.');
    const tol = Math.min(Math.max(int(b.toleransi_hari, cfg.rekon_toleransi_hari), 0), 31);
    const tolPersen = Math.min(Math.max(Number(b.toleransi_persen ?? cfg.rekon_toleransi_selisih_persen), 0), 50);
    const urut = mutasi.map((x) => x.tanggal).sort();
    const dari = isDate(b.dari) ? b.dari : urut[0];
    const sampai = isDate(b.sampai) ? b.sampai : urut.at(-1);
    const bku = await bkuBank(skpd, dari, sampai, tol);
    const hasil = rekonsiliasi(mutasi.filter((x) => x.tanggal >= dari && x.tanggal <= sampai), bku, { toleransi_hari: tol, toleransi_persen: tolPersen, dari, sampai });
    // Saldo akhir bank: kolom saldo baris terakhir, atau isian pengguna
    const terakhirBersaldo = [...mutasi].filter((x) => x.saldo != null && x.tanggal <= sampai).sort((a, z) => a.tanggal.localeCompare(z.tanggal) || a.baris - z.baris).at(-1);
    const saldoBank = b.saldo_bank !== undefined && b.saldo_bank !== '' && b.saldo_bank !== null ? money(b.saldo_bank) : terakhirBersaldo?.saldo ?? null;
    const saldoBku = await saldoBkuBank(skpd, sampai);
    return { ...hasil, mapping: m, nama_file: ds.file_name || ds.nama, saldo: saldoBank == null ? { saldo_bku: saldoBku, saldo_bank: null } : laporanSaldo(hasil.ringkasan, saldoBku, saldoBank) };
  });

  // Hitung ulang indikator setelah konfirmasi/pemasangan manual di browser
  app.post('/api/rekonsiliasi/ringkas', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    const mutasi = items.filter((i) => i.mutasi).map((i) => i.mutasi);
    const bkuMap = new Map(); items.forEach((i) => i.bku?.forEach((e) => bkuMap.set(e.id, e)));
    const r = ringkas(items, mutasi, [...bkuMap.values()], b.dari, b.sampai, int(b.duplikat_bku, 0));
    return { ringkasan: r, saldo: b.saldo_bank == null || b.saldo_bank === '' ? null : laporanSaldo(r, Number(b.saldo_bku) || 0, money(b.saldo_bank)) };
  });

  // Simpan sebagai draf atau finalkan (hasil final menjadi laporan rekonsiliasi resmi)
  app.post('/api/rekonsiliasi/simpan', { preHandler: requireRole('admin', 'bendahara') }, async (req) => {
    const b = req.body || {};
    required(b, ['dari', 'sampai', 'ringkasan']);
    if (!isDate(b.dari) || !isDate(b.sampai)) throw bad('Periode tidak valid');
    const skpd = scopeSkpd(req.user, b.skpd_id);
    canWrite(req.user, skpd);
    const final = b.status === 'final';
    const items = Array.isArray(b.items) ? b.items.slice(0, 20000) : [];
    if (final && items.some((i) => i.kategori === 'periksa' && !i.konfirmasi)) throw bad('Masih ada baris "perlu diperiksa" yang belum dikonfirmasi. Terima, tolak, atau pasangkan manual sebelum finalisasi.');
    const pasangan = items.filter((i) => ['cocok', 'selisih', 'periksa'].includes(i.kategori) && i.konfirmasi !== 'ditolak' && i.bku?.length)
      .map((i) => ({ baris: i.mutasi?.baris, bku_ids: i.bku.map((e) => e.id), kategori: i.kategori, manual: Boolean(i.manual), konfirmasi: i.konfirmasi || 'otomatis', selisih: i.selisih || 0 }));
    return tx(async (c) => {
      const { rows: [r] } = await c.query(`INSERT INTO rekonsiliasi_bank (skpd_id, dari, sampai, ringkasan, pasangan, catatan, created_by, status, nama_file, saldo_bank, saldo_bku, hasil, difinalkan_oleh, difinalkan_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, created_at, status`,
      [skpd, b.dari, b.sampai, b.ringkasan, JSON.stringify(pasangan), b.catatan || null, req.user.id, final ? 'final' : 'draf', b.nama_file || null,
        b.saldo?.saldo_bank ?? null, b.saldo?.saldo_bku ?? null, JSON.stringify({ items, saldo: b.saldo || null, periode: b.periode || null, duplikat_bku: b.duplikat_bku || [] }),
        final ? req.user.id : null, final ? new Date().toISOString() : null]);
      await audit(c, req.user, final ? 'rekonsiliasi_final' : 'rekonsiliasi_simpan', 'rekonsiliasi', r.id, { dari: b.dari, sampai: b.sampai, ringkasan: b.ringkasan }, req.ip);
      const s = b.ringkasan || {};
      if (final && (s.selisih || s.belum_bku || Math.abs(Number(b.saldo?.tak_terjelaskan) || 0) >= 1)) {
        await kirimNotifikasi(c, { skpd_id: skpd, peran: ['bendahara', 'verifikator', 'admin'], kategori: 'rekonsiliasi', tingkat: 'peringatan',
          judul: `Rekonsiliasi ${b.dari.split('-').reverse().join('/')} – ${b.sampai.split('-').reverse().join('/')} menemukan selisih`,
          pesan: `${s.selisih || 0} pasangan selisih (total Rp ${Math.round(s.total_selisih || 0).toLocaleString('id-ID')}), ${s.belum_bku || 0} mutasi belum tercatat di BKU${b.saldo?.tak_terjelaskan ? `, selisih saldo tak terjelaskan Rp ${Math.round(b.saldo.tak_terjelaskan).toLocaleString('id-ID')}` : ''}.`,
          link: `/rekonsiliasi?id=${r.id}`, ref: `rekon:${r.id}` });
      }
      return { row: r };
    });
  });

  app.get('/api/rekonsiliasi/:id', { preHandler: requireAuth }, async (req) => {
    const { rows: [r] } = await query(`SELECT r.*, u.full_name AS dibuat_oleh, f.full_name AS difinalkan_oleh_nama, s.nama AS skpd_nama, s.kode AS skpd_kode,
        s.bendahara_nama, s.bendahara_nip, s.kepala_nama, s.kepala_nip, s.bank_bendahara, s.rekening_bendahara
      FROM rekonsiliasi_bank r JOIN skpd s ON s.id = r.skpd_id LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users f ON f.id = r.difinalkan_oleh WHERE r.id = $1`, [int(req.params.id)]);
    if (!r) throw notFound();
    scopeSkpd(req.user, r.skpd_id);
    return { row: r };
  });

  app.get('/api/rekonsiliasi/:id/xlsx', { preHandler: requireAuth }, async (req, reply) => {
    const { rows: [r] } = await query('SELECT r.*, s.nama AS skpd_nama, s.kode AS skpd_kode FROM rekonsiliasi_bank r JOIN skpd s ON s.id = r.skpd_id WHERE r.id = $1', [int(req.params.id)]);
    if (!r) throw notFound();
    scopeSkpd(req.user, r.skpd_id);
    const items = r.hasil?.items || [];
    const buf = await buildWorkbook({
      title: `LAPORAN REKONSILIASI BANK - ${r.skpd_nama.toUpperCase()}`,
      subtitle: `Periode ${r.dari} s.d. ${r.sampai} · status ${r.status} · ${r.ringkasan.persen_cocok}% cocok · total selisih Rp ${Math.round(r.ringkasan.total_selisih || 0).toLocaleString('id-ID')}`,
      sheetName: 'Rekonsiliasi',
      columns: [{ key: 'hasil', header: 'Hasil', width: 20 }, { key: 'tgl_bank', header: 'Tgl bank', width: 12 }, { key: 'ket', header: 'Keterangan bank', width: 40 },
        { key: 'bank', header: 'Nilai bank', type: 'money' }, { key: 'tgl_bku', header: 'Tgl BKU', width: 12 }, { key: 'no_bku', header: 'No. BKU', width: 10 },
        { key: 'uraian', header: 'Uraian BKU', width: 40 }, { key: 'nilai_bku', header: 'Nilai BKU', type: 'money' }, { key: 'selisih', header: 'Selisih', type: 'money' },
        { key: 'konfirmasi', header: 'Konfirmasi', width: 14 }, { key: 'alasan', header: 'Keterangan', width: 50 }],
      rows: items.map((i) => ({
        hasil: KATEGORI[i.kategori] || i.kategori, tgl_bank: i.mutasi?.tanggal || '', ket: i.mutasi?.keterangan || '',
        bank: i.mutasi ? (i.mutasi.masuk || -i.mutasi.keluar) : '', tgl_bku: i.bku?.map((e) => e.tanggal).join(', ') || '', no_bku: i.bku?.map((e) => e.no_urut).join(', ') || '',
        uraian: i.bku?.map((e) => e.uraian).join(' + ') || '', nilai_bku: i.bku?.length ? i.bku.reduce((s, e) => s + (e.masuk || -(e.netto || e.keluar)), 0) : '',
        selisih: i.selisih || '', konfirmasi: i.konfirmasi || (i.kategori === 'cocok' ? 'otomatis' : ''), alasan: i.alasan || '',
      })),
    });
    return sendFile(reply, buf, `Rekonsiliasi_${r.skpd_kode}_${r.dari}_${r.sampai}.xlsx`, XLSX);
  });
}
