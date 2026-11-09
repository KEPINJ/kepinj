// Alat data untuk AI Assistant. Setiap alat membaca basis data dengan cakupan hak akses pengguna
// (SKPD sendiri, kecuali admin/pimpinan) dan mengembalikan ringkasan JSON yang ringkas.
// Alat yang sama dipakai oleh mode Claude (tool use) dan mode lokal (pencocokan maksud tanpa internet).
import { query } from '../db.js';
import { NAMA_BULAN } from './kalender.js';
import { hitung as hitungMonitoring } from '../routes/monitoring.js';
import { neracaSaldo } from '../routes/akuntansi.js';
import { daftarJatuhTempo, kumpulkanNotifikasi } from '../routes/pengingat.js';

const ymd = (d) => d.toISOString().slice(0, 10);
const isTgl = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const angka = (v) => Math.round(Number(v || 0) * 100) / 100;
const BUKAN_DITOLAK = "NOT EXISTS (SELECT 1 FROM bku_status bs WHERE bs.entry_id = e.id AND bs.status IN ('ditolak'))";

function rentang(ctx, { dari, sampai, bulan } = {}) {
  const t = ctx.tahun;
  if (bulan >= 1 && bulan <= 12) {
    return { dari: `${t}-${String(bulan).padStart(2, '0')}-01`, sampai: ymd(new Date(Date.UTC(t, bulan, 0))) };
  }
  return { dari: isTgl(dari) ? dari : `${t}-01-01`, sampai: isTgl(sampai) ? sampai : (new Date().getFullYear() === t ? ymd(new Date()) : `${t}-12-31`) };
}

/** Definisi alat (format tool Claude Messages API). */
export const DEFINISI = [
  { name: 'ringkasan_kas', description: 'Saldo kas BKU (total, rekening bank, tunai) per tanggal, serta total penerimaan dan pengeluaran dalam rentang tanggal. Gunakan untuk pertanyaan saldo, kas, uang tersedia, penerimaan/pengeluaran.',
    input_schema: { type: 'object', properties: { sampai: { type: 'string', description: 'Tanggal posisi saldo YYYY-MM-DD (default hari ini)' }, dari: { type: 'string', description: 'Awal rentang mutasi YYYY-MM-DD (default 1 Januari)' }, bulan: { type: 'integer', description: 'Bulan 1-12 bila pertanyaan menyebut satu bulan' } } } },
  { name: 'serapan_anggaran', description: 'Pagu, realisasi, sisa, dan persentase penyerapan anggaran belanja (Realisasi/Pagu x 100%) termasuk rincian per rekening, per kelompok belanja, per bulan, dan indikator mendekati/melampaui pagu atau penyerapan rendah.',
    input_schema: { type: 'object', properties: { bulan: { type: 'integer', description: 'Realisasi s.d. bulan 1-12 (default bulan berjalan)' }, prefiks: { type: 'string', description: 'Awalan kode rekening, mis. 5.1.02 (barang dan jasa) atau 5.2 (modal)' }, semua_skpd: { type: 'boolean', description: 'Bandingkan seluruh SKPD (hanya admin/pimpinan)' } } } },
  { name: 'cari_transaksi', description: 'Cari transaksi BKU berdasarkan kata kunci uraian/no bukti/rekanan, rentang tanggal, jenis, nilai minimum, atau status persetujuan. Mengembalikan maksimal 15 transaksi terbesar/terbaru.',
    input_schema: { type: 'object', properties: { q: { type: 'string' }, dari: { type: 'string' }, sampai: { type: 'string' }, bulan: { type: 'integer' },
      jenis: { type: 'string', description: 'BELANJA, PENERIMAAN, SP2D_UP, SP2D_GU, SP2D_LS, PAJAK_PUNGUT, PAJAK_SETOR, PENYETORAN, PELIMPAHAN, KOREKSI' },
      min_nilai: { type: 'number' }, status: { type: 'string', description: 'menunggu, disetujui, ditolak, dikoreksi' }, urut: { type: 'string', description: 'nilai (terbesar) atau tanggal (terbaru)' } } } },
  { name: 'rekap_belanja', description: 'Rekap total belanja dikelompokkan per rekening, per bulan, atau per rekanan dalam rentang tanggal. Gunakan untuk pertanyaan "belanja terbesar", "per bulan", "rekanan paling banyak dibayar".',
    input_schema: { type: 'object', properties: { kelompok: { type: 'string', enum: ['rekening', 'bulan', 'rekanan'] }, dari: { type: 'string' }, sampai: { type: 'string' }, bulan: { type: 'integer' } }, required: ['kelompok'] } },
  { name: 'status_persetujuan', description: 'Jumlah transaksi BKU menunggu verifikasi/persetujuan per tahap, ditolak (dengan alasan), dan disetujui; termasuk kelengkapan dokumen bukti.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'kewajiban_pajak', description: 'Pajak yang belum disetor atau belum dilaporkan per masa beserta tanggal jatuh tempo.', input_schema: { type: 'object', properties: {} } },
  { name: 'rekonsiliasi_bank', description: 'Hasil rekonsiliasi bank terakhir: persentase cocok, selisih, transaksi belum tercatat, dan saldo bank vs BKU.', input_schema: { type: 'object', properties: {} } },
  { name: 'neraca_saldo', description: 'Neraca saldo akuntansi dari jurnal (basis LO akrual atau LRA kas) beserta keseimbangan debit-kredit dan saldo akun utama.',
    input_schema: { type: 'object', properties: { basis: { type: 'string', enum: ['LO', 'LRA'] }, sampai: { type: 'string' } } } },
  { name: 'ringkasan_aset', description: 'Jumlah dan nilai aset, kondisi (baik/rusak ringan/rusak berat), aset yang belum diperiksa setahun, dan progres inventarisasi berjalan.', input_schema: { type: 'object', properties: {} } },
  { name: 'peringatan', description: 'Daftar peringatan/tugas tertunda saat ini (pajak jatuh tempo, tutup buku, persetujuan, dokumen kurang, pagu, rekonsiliasi, penutupan kas).', input_schema: { type: 'object', properties: {} } },
];

export const ALAT = {
  async ringkasan_kas(ctx, i = {}) {
    const r = rentang(ctx, i);
    const { rows: [s] } = await query(`SELECT
        COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE tanggal <= $3), 0)::float AS saldo,
        COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE tanggal <= $3 AND metode = 'bank'), 0)::float AS saldo_bank,
        COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE tanggal <= $3 AND metode = 'tunai'), 0)::float AS saldo_tunai,
        COALESCE(SUM(penerimaan) FILTER (WHERE tanggal BETWEEN $4 AND $3), 0)::float AS penerimaan,
        COALESCE(SUM(pengeluaran) FILTER (WHERE tanggal BETWEEN $4 AND $3), 0)::float AS pengeluaran,
        COUNT(*) FILTER (WHERE tanggal BETWEEN $4 AND $3)::int AS transaksi
      FROM bku_entries e WHERE skpd_id = $1 AND tahun = $2`, [ctx.skpd, ctx.tahun, r.sampai, r.dari]);
    return { skpd: ctx.skpdNama, posisi: r.sampai, rentang_mutasi: r, ...s };
  },

  async serapan_anggaran(ctx, i = {}) {
    const now = new Date();
    const bulanSd = i.bulan >= 1 && i.bulan <= 12 ? i.bulan : (now.getFullYear() === ctx.tahun ? now.getMonth() + 1 : 12);
    const semua = Boolean(i.semua_skpd) && ['admin', 'pimpinan'].includes(ctx.user.role);
    const prefiks = /^5(\.\d+)*$/.test(String(i.prefiks || '')) ? i.prefiks : '5';
    const d = await hitungMonitoring({ skpd: ctx.skpd, semua, tahun: ctx.tahun, prefiks, basis: 'semua', bulanSd });
    const rek = [...d.per_rekening].sort((a, b) => (b.persen ?? -1) - (a.persen ?? -1));
    return {
      cakupan: semua ? 'seluruh SKPD' : ctx.skpdNama, tahun: ctx.tahun, sd_bulan: NAMA_BULAN[bulanSd - 1], prefiks,
      ringkasan: { pagu: d.ringkasan.pagu, realisasi: d.ringkasan.realisasi, sisa: d.ringkasan.sisa, persen: angka(d.ringkasan.persen), target_persen: angka(d.ringkasan.target), status: d.ringkasan.status_label },
      per_kelompok: d.per_kelompok.map((k) => ({ nama: k.nama, pagu: k.pagu, realisasi: k.realisasi, persen: angka(k.persen) })),
      rekening_tertinggi: rek.slice(0, 5).map((r) => ({ kode: r.kode_rekening, nama: r.nama, pagu: r.pagu, realisasi: r.realisasi, persen: angka(r.persen), indikator: r.indikator })),
      rekening_terendah: rek.filter((r) => r.pagu > 0).slice(-3).map((r) => ({ kode: r.kode_rekening, nama: r.nama, persen: angka(r.persen), indikator: r.indikator })),
      bulanan: d.bulanan.slice(0, bulanSd).map((b) => ({ bulan: b.nama, realisasi: b.realisasi, rencana: b.rencana })),
      ...(semua ? { per_skpd: d.per_skpd.map((s) => ({ skpd: s.nama, pagu: s.pagu, realisasi: s.realisasi, persen: angka(s.persen), indikator: s.indikator })) } : {}),
    };
  },

  async cari_transaksi(ctx, i = {}) {
    const r = rentang(ctx, i);
    const p = [ctx.skpd, ctx.tahun, r.dari, r.sampai]; const w = ['e.skpd_id = $1', 'e.tahun = $2', 'e.tanggal BETWEEN $3 AND $4'];
    if (i.q) { p.push(`%${String(i.q).slice(0, 60)}%`); w.push(`(e.uraian ILIKE $${p.length} OR e.no_bukti ILIKE $${p.length} OR rk.nama ILIKE $${p.length})`); }
    if (i.jenis) { p.push(String(i.jenis).toUpperCase()); w.push(`e.jenis = $${p.length}`); }
    if (Number(i.min_nilai) > 0) { p.push(Number(i.min_nilai)); w.push(`GREATEST(e.penerimaan, e.pengeluaran) >= $${p.length}`); }
    if (i.status) { p.push(i.status); w.push(`s.status = $${p.length}`); }
    const urut = i.urut === 'tanggal' ? 'e.tanggal DESC, e.no_urut DESC' : 'GREATEST(e.penerimaan, e.pengeluaran) DESC';
    const { rows } = await query(`SELECT e.id, e.no_urut, e.tanggal, e.no_bukti, e.jenis, e.uraian, e.kode_rekening, e.metode, e.penerimaan::float, e.pengeluaran::float,
        rk.nama AS rekanan, s.status AS status_persetujuan, s.dokumen_status, COUNT(*) OVER()::int AS total, SUM(GREATEST(e.penerimaan, e.pengeluaran)) OVER()::float AS total_nilai
      FROM bku_entries e LEFT JOIN rekanan rk ON rk.id = e.rekanan_id LEFT JOIN bku_status s ON s.entry_id = e.id
      WHERE ${w.join(' AND ')} ORDER BY ${urut} LIMIT 15`, p);
    return { rentang: r, ditemukan: rows[0]?.total || 0, total_nilai: rows[0]?.total_nilai || 0, transaksi: rows.map(({ total, total_nilai, ...x }) => x) };
  },

  async rekap_belanja(ctx, i = {}) {
    const r = rentang(ctx, i);
    const kel = ['rekening', 'bulan', 'rekanan'].includes(i.kelompok) ? i.kelompok : 'rekening';
    const kol = { rekening: "e.kode_rekening || ' ' || COALESCE(rr.nama, '')", bulan: "to_char(e.tanggal, 'MM')", rekanan: "COALESCE(rk.nama, '(tanpa rekanan)')" }[kel];
    const { rows } = await query(`SELECT ${kol} AS kunci, SUM(CASE WHEN e.jenis = 'KOREKSI' THEN e.pengeluaran - e.penerimaan ELSE e.pengeluaran END)::float AS nilai, COUNT(*)::int AS transaksi
      FROM bku_entries e LEFT JOIN rekening rr ON rr.kode = e.kode_rekening LEFT JOIN rekanan rk ON rk.id = e.rekanan_id
      WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.tanggal BETWEEN $3 AND $4 AND e.jenis IN ('BELANJA','SP2D_LS','KOREKSI') AND e.kode_rekening LIKE '5%' AND ${BUKAN_DITOLAK}
      GROUP BY 1 ORDER BY ${kel === 'bulan' ? '1' : '2 DESC'} LIMIT 15`, [ctx.skpd, ctx.tahun, r.dari, r.sampai]);
    return { kelompok: kel, rentang: r, total: rows.reduce((s, x) => s + x.nilai, 0),
      baris: rows.map((x) => ({ ...x, kunci: kel === 'bulan' ? NAMA_BULAN[Number(x.kunci) - 1] : x.kunci })) };
  },

  async status_persetujuan(ctx) {
    const { rows } = await query(`SELECT s.status, s.tahap, COUNT(*)::int AS n, COALESCE(SUM(GREATEST(e.penerimaan, e.pengeluaran)), 0)::float AS nilai,
        COUNT(*) FILTER (WHERE s.dokumen_status IN ('belum','sebagian'))::int AS dokumen_kurang
      FROM bku_status s JOIN bku_entries e ON e.id = s.entry_id WHERE s.skpd_id = $1 AND s.tahun = $2 AND s.induk_id IS NULL GROUP BY 1, 2 ORDER BY 1, 2`, [ctx.skpd, ctx.tahun]);
    const { rows: tolak } = await query(`SELECT e.no_urut, e.tanggal, e.no_bukti, e.uraian, GREATEST(e.penerimaan, e.pengeluaran)::float AS nilai, s.catatan
      FROM bku_status s JOIN bku_entries e ON e.id = s.entry_id WHERE s.skpd_id = $1 AND s.tahun = $2 AND s.status = 'ditolak' AND s.induk_id IS NULL ORDER BY e.tanggal DESC LIMIT 5`, [ctx.skpd, ctx.tahun]);
    return { per_status: rows, ditolak_terbaru: tolak };
  },

  async kewajiban_pajak(ctx) {
    const rows = await daftarJatuhTempo(ctx.skpd, ctx.tahun);
    return { masa: rows.map((m) => ({ masa: m.nama_masa, kewajiban: m.kewajiban, belum_setor: m.belum_setor, belum_lapor: m.belum_lapor, jatuh_tempo: m.tenggat, sisa_hari: m.sisa_hari, rincian: m.rincian })) };
  },

  async rekonsiliasi_bank(ctx) {
    const { rows } = await query(`SELECT id, dari, sampai, status, nama_file, saldo_bank::float, saldo_bku::float, ringkasan, difinalkan_at, created_at
      FROM rekonsiliasi_bank WHERE skpd_id = $1 ORDER BY sampai DESC, id DESC LIMIT 3`, [ctx.skpd]);
    if (!rows.length) return { pesan: 'Belum ada rekonsiliasi bank yang disimpan untuk SKPD ini.' };
    return { terakhir: rows.map((r) => ({ periode: `${r.dari} s.d. ${r.sampai}`, status: r.status, saldo_bank: r.saldo_bank, saldo_bku: r.saldo_bku,
      persen_cocok: r.ringkasan?.persen_cocok, cocok: r.ringkasan?.cocok, selisih: r.ringkasan?.selisih, belum_bku: r.ringkasan?.belum_bku, belum_bank: r.ringkasan?.belum_bank,
      total_selisih: r.ringkasan?.total_selisih, duplikat: r.ringkasan?.duplikat })) };
  },

  async neraca_saldo(ctx, i = {}) {
    const basis = i.basis === 'LRA' ? 'LRA' : 'LO';
    const sampai = isTgl(i.sampai) ? i.sampai : `${ctx.tahun}-12-31`;
    const d = await neracaSaldo(ctx.skpd, ctx.tahun, `${ctx.tahun}-01-01`, sampai, basis);
    const { rows: [j] } = await query('SELECT COUNT(*)::int AS jurnal, MAX(tanggal) AS terakhir FROM jurnal WHERE skpd_id = $1 AND tahun = $2', [ctx.skpd, ctx.tahun]);
    return { basis, sampai, jurnal: j.jurnal, tanggal_jurnal_terakhir: j.terakhir, seimbang: d.seimbang, total: d.total,
      akun: d.rows.filter((r) => r.saldo_debit || r.saldo_kredit).sort((a, b) => (b.saldo_debit + b.saldo_kredit) - (a.saldo_debit + a.saldo_kredit)).slice(0, 12)
        .map((r) => ({ kode: r.kode, nama: r.nama, kelompok: r.kelompok, saldo_debit: r.saldo_debit, saldo_kredit: r.saldo_kredit })) };
  },

  async ringkasan_aset(ctx) {
    const { rows: [r] } = await query(`SELECT COUNT(*)::int AS jumlah, COALESCE(SUM(harga_perolehan), 0)::float AS nilai,
        COUNT(*) FILTER (WHERE kondisi = 'B')::int AS baik, COUNT(*) FILTER (WHERE kondisi = 'RR')::int AS rusak_ringan, COUNT(*) FILTER (WHERE kondisi = 'RB')::int AS rusak_berat,
        COUNT(*) FILTER (WHERE terakhir_diperiksa IS NULL OR terakhir_diperiksa < now() - interval '1 year')::int AS belum_diperiksa_setahun
      FROM aset WHERE skpd_id = $1 AND status <> 'dihapus'`, [ctx.skpd]);
    const { rows: [inv] } = await query(`SELECT i.nama, i.tanggal_mulai, (SELECT COUNT(DISTINCT aset_id)::int FROM aset_pemeriksaan p WHERE p.inventarisasi_id = i.id) AS diperiksa
      FROM inventarisasi i WHERE i.skpd_id = $1 AND i.status = 'berjalan'`, [ctx.skpd]);
    const { rows: kel } = await query(`SELECT left(kode_barang, 11) AS kelompok, COUNT(*)::int AS n, SUM(harga_perolehan)::float AS nilai FROM aset WHERE skpd_id = $1 AND status <> 'dihapus' GROUP BY 1 ORDER BY 3 DESC LIMIT 6`, [ctx.skpd]);
    return { ...r, per_kelompok_kode: kel, inventarisasi_berjalan: inv ? { ...inv, total: r.jumlah, persen: r.jumlah ? Math.round((inv.diperiksa / r.jumlah) * 100) : 0 } : null };
  },

  async peringatan(ctx) {
    const items = await kumpulkanNotifikasi(ctx.user, ctx.skpd, ctx.tahun);
    return { jumlah: items.length, items: items.slice(0, 12).map((x) => ({ tingkat: x.tingkat, judul: x.judul, pesan: x.pesan, link: x.link })) };
  },
};

export async function jalankanAlat(ctx, nama, input) {
  const fn = ALAT[nama];
  if (!fn) throw new Error(`Alat tidak dikenal: ${nama}`);
  return fn(ctx, input && typeof input === 'object' ? input : {});
}
