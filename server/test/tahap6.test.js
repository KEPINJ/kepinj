// Pengujian unit fitur tahap 6: dokumen bukti, rekonsiliasi bank, jurnal akuntansi, indikator pagu,
// kebijakan password, pengenal QR aset, dan pengenal maksud asisten (mode lokal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dokumenWajib, statusKelengkapan, kenaliBerkas, namaBerkasAman } from '../../shared/dokumen.js';
import { rekonsiliasi, laporanSaldo } from '../../shared/rekonsiliasi.js';
import { susunJurnal, cekSeimbang, balikBaris, akunCermin } from '../../shared/jurnal.js';
import { indikator } from '../src/routes/monitoring.js';
import { cekKebijakan, passwordSementara } from '../src/lib/keamanan.js';
import { kenaliMaksud } from '../src/routes/asisten.js';

test('dokumen wajib: belanja bank berpajak perjalanan dinas memerlukan 4 jenis dokumen', () => {
  const w = dokumenWajib({ jenis: 'BELANJA', metode: 'bank', kode_rekening: '5.1.02.04.01.0001' }, { adaPajak: true });
  assert.deepEqual(new Set(w), new Set(['nota_kuitansi', 'bukti_transfer', 'dokumen_pajak', 'pertanggungjawaban']));
  assert.deepEqual(dokumenWajib({ jenis: 'SP2D_GU' }), ['sp2d']);
  assert.deepEqual(dokumenWajib({ jenis: 'PAJAK_PUNGUT' }), []);
});

test('status kelengkapan: lengkap, sebagian, belum, tidak wajib', () => {
  assert.equal(statusKelengkapan(['a', 'b'], ['a', 'b']).status, 'lengkap');
  assert.deepEqual(statusKelengkapan(['a', 'b'], ['a']), { status: 'sebagian', kurang: ['b'] });
  assert.equal(statusKelengkapan(['a'], []).status, 'belum');
  assert.equal(statusKelengkapan([], []).status, 'tidak_wajib');
});

test('berkas dikenali dari isi, bukan ekstensi; nama berkas dibersihkan', () => {
  assert.equal(kenaliBerkas(Buffer.from('%PDF-1.7\n....'))?.mime, 'application/pdf');
  assert.equal(kenaliBerkas(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime, 'image/png');
  assert.equal(kenaliBerkas(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))?.mime, 'image/jpeg');
  assert.equal(kenaliBerkas(Buffer.from('MZ\x90\x00 bukan pdf')), null);
  assert.equal(namaBerkasAman('../../etc/passwd'), 'passwd');
  assert.equal(namaBerkasAman('kuitansi"<x>.pdf'), 'kuitansi__x_.pdf');
});

test('rekonsiliasi: cocok, selisih, belum di BKU, belum di bank, dan duplikat', () => {
  const mutasi = [
    { baris: 1, tanggal: '2026-09-03', keterangan: 'TRF BKT-01 ATK', masuk: 0, keluar: 1_000_000 },
    { baris: 2, tanggal: '2026-09-05', keterangan: 'TRF BKT-02 Makan', masuk: 0, keluar: 506_500 },
    { baris: 3, tanggal: '2026-09-30', keterangan: 'JASA GIRO', masuk: 48_250, keluar: 0 },
    { baris: 4, tanggal: '2026-09-30', keterangan: 'JASA GIRO', masuk: 48_250, keluar: 0 },
  ];
  const bku = [
    { id: 1, no_urut: 1, tanggal: '2026-09-02', no_bukti: 'BKT-01', uraian: 'ATK', masuk: 0, keluar: 1_000_000, netto: 1_000_000 },
    { id: 2, no_urut: 2, tanggal: '2026-09-05', no_bukti: 'BKT-02', uraian: 'Makan', masuk: 0, keluar: 500_000, netto: 500_000 },
    { id: 3, no_urut: 3, tanggal: '2026-09-20', no_bukti: 'BKT-03', uraian: 'Cek beredar', masuk: 0, keluar: 750_000, netto: 750_000 },
  ];
  const r = rekonsiliasi(mutasi, bku, { toleransi_hari: 3, toleransi_persen: 5, dari: '2026-09-01', sampai: '2026-09-30' });
  const k = (x) => r.items.filter((i) => i.kategori === x);
  assert.equal(k('cocok').length, 1);
  assert.equal(k('selisih').length, 1);
  assert.equal(k('selisih')[0].selisih, 6_500);
  assert.equal(k('belum_bku').length, 1);
  assert.equal(k('belum_bku')[0].saran.jenis, 'PENERIMAAN');
  assert.equal(k('belum_bank').length, 1);
  assert.equal(k('duplikat').length, 1);
  assert.equal(r.ringkasan.persen_cocok, Math.round((1 / 3) * 1000) / 10);
  assert.equal(r.ringkasan.total_selisih, 6_500);
  // Laporan dua sisi: saldo BKU disesuaikan = saldo bank disesuaikan bila semua selisih terjelaskan
  const s = laporanSaldo(r.ringkasan, 10_000_000, 10_000_000 + 48_250 - 6_500 - 750_000);
  assert.equal(s.tak_terjelaskan, 0);
});

test('jurnal: belanja operasi dua basis seimbang; SALDO_AWAL dan belanja tanpa rekening masuk telaah', () => {
  const e = { jenis: 'BELANJA', metode: 'bank', kode_rekening: '5.1.02.01.01.0024', penerimaan: 0, pengeluaran: 2_500_000 };
  const j = susunJurnal(e);
  assert.equal(j.status, 'jurnal');
  assert.equal(j.aturan, 'BELANJA_OPERASI');
  const c = cekSeimbang(j.baris);
  assert.ok(c.seimbang);
  assert.deepEqual(Object.keys(c.per_basis).sort(), ['LO', 'LRA']);
  assert.ok(j.baris.some((b) => b.basis === 'LO' && b.akun_kode.startsWith('8.1') && b.debit === 2_500_000));
  assert.equal(susunJurnal({ ...e, kode_rekening: '5.2.02.05.01.0001' }).aturan, 'BELANJA_MODAL');
  assert.equal(susunJurnal({ ...e, kode_rekening: null }).status, 'telaah');
  assert.equal(susunJurnal({ jenis: 'SALDO_AWAL', penerimaan: 1, pengeluaran: 0 }).status, 'telaah');
  assert.equal(susunJurnal(e, { perlakuan: 'telaah', catatan: 'cek kapitalisasi' }).alasan, 'cek kapitalisasi');
  assert.ok(cekSeimbang(balikBaris(j.baris)).seimbang);
  assert.equal(akunCermin('5.1.02.01.01.0024').kode, '8.1.02.01.01.0024');
});

test('cek seimbang menolak jurnal debit ≠ kredit', () => {
  const c = cekSeimbang([{ basis: 'LO', debit: 100, kredit: 0 }, { basis: 'LO', debit: 0, kredit: 90 }]);
  assert.equal(c.seimbang, false);
  assert.equal(c.masalah.length, 1);
});

test('indikator pagu: melampaui, mendekati, rendah, normal, tanpa pagu', () => {
  assert.equal(indikator({ pagu: 100, realisasi: 101, target: 50 }), 'melampaui');
  assert.equal(indikator({ pagu: 100, realisasi: 92, target: 95 }), 'mendekati');
  assert.equal(indikator({ pagu: 100, realisasi: 30, target: 75 }), 'rendah');
  assert.equal(indikator({ pagu: 100, realisasi: 70, target: 75 }), 'normal');
  assert.equal(indikator({ pagu: 0, realisasi: 5 }), 'tanpa_pagu');
  assert.equal(indikator({ pagu: 0, realisasi: 0 }), 'kosong');
});

test('kebijakan password', () => {
  assert.deepEqual(cekKebijakan('Anggaran2026', { username: 'siti' }), []);
  assert.ok(cekKebijakan('pendek1').some((s) => s.includes('minimal')));
  assert.ok(cekKebijakan('hanyahurufsaja').some((s) => s.includes('huruf dan angka')));
  assert.ok(cekKebijakan('bendahara2026', { username: 'bendahara' }).some((s) => s.includes('username')));
  assert.ok(cekKebijakan('bku12345').length > 0);
  for (let i = 0; i < 20; i++) assert.deepEqual(cekKebijakan(passwordSementara()), []);
});

test('asisten mode lokal mengenali maksud pertanyaan sehari-hari', () => {
  assert.equal(kenaliMaksud('Berapa saldo kas hari ini?').alat, 'ringkasan_kas');
  const s = kenaliMaksud('Berapa sisa anggaran belanja modal bulan Juni?');
  assert.equal(s.alat, 'serapan_anggaran');
  assert.equal(s.input.prefiks, '5.2');
  assert.equal(s.input.bulan, 6);
  assert.equal(kenaliMaksud('Bandingkan serapan antar SKPD').input.semua_skpd, true);
  assert.equal(kenaliMaksud('Pajak apa yang belum disetor?').alat, 'kewajiban_pajak');
  assert.equal(kenaliMaksud('Ada berapa transaksi menunggu persetujuan?').alat, 'status_persetujuan');
  assert.equal(kenaliMaksud('Tampilkan neraca saldo').alat, 'neraca_saldo');
  assert.equal(kenaliMaksud('Berapa aset yang rusak berat?').alat, 'ringkasan_aset');
  assert.equal(kenaliMaksud('Siapa rekanan dengan pembayaran terbesar?').input.kelompok, 'rekanan');
  assert.equal(kenaliMaksud('halo apa kabar'), null);
});
