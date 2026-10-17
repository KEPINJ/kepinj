import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as tax from '../../shared/tax.js';
import { terbilang } from '../../shared/terbilang.js';

test('kategori TER sesuai PP 58/2023', () => {
  assert.equal(tax.kategoriTER('TK/0'), 'A');
  assert.equal(tax.kategoriTER('K/0'), 'A');
  assert.equal(tax.kategoriTER('TK/2'), 'B');
  assert.equal(tax.kategoriTER('K/2'), 'B');
  assert.equal(tax.kategoriTER('K/3'), 'C');
});

test('PPh 21 TER bulanan', () => {
  // TK/0 bruto 10.000.000 -> kategori A lapisan 9.650.001-10.050.000 = 2%
  assert.deepEqual(tax.pph21Bulanan({ bruto: 10_000_000, status: 'TK/0' }).pph, 200_000);
  // di bawah batas 5.400.000 -> 0
  assert.equal(tax.pph21Bulanan({ bruto: 5_400_000, status: 'TK/0' }).pph, 0);
  // K/1 (B) 8.689.680 -> 1%
  assert.equal(tax.pph21Bulanan({ bruto: 8_689_680, status: 'K/1' }).tarif, 1);
});

test('PTKP dan Pasal 17', () => {
  assert.equal(tax.ptkpSetahun('K/3'), 72_000_000);
  assert.equal(tax.pasal17(60_000_000).pajak, 3_000_000);
  assert.equal(tax.pasal17(100_000_000).pajak, 3_000_000 + 6_000_000);
});

test('PPh 21 Desember: setahun dikurangi yang sudah dipotong', () => {
  const r = tax.pph21Tahunan({ brutoSetahun: 120_000_000, status: 'TK/0', pphTelahDipotong: 2_000_000 });
  assert.equal(r.biayaJabatan, 6_000_000);
  assert.equal(r.pkp, 60_000_000);
  assert.equal(r.pphSetahun, 3_000_000);
  assert.equal(r.pphMasaTerakhir, 1_000_000);
});

test('PPN 12% x DPP 11/12 = efektif 11%', () => {
  const r = tax.ppn({ nilai: 11_100_000, termasukPPN: true });
  assert.equal(r.dpp, 10_000_000);
  assert.equal(r.ppn, 1_099_999); // pembulatan ke bawah DPP nilai lain
});

test('potongan belanja barang: PPN + PPh 22, batas Rp2 juta', () => {
  const r = tax.potonganBelanja({ nilai: 11_100_000, jenis: 'barang' });
  assert.deepEqual(r.potongan.map((p) => p.jenis_pajak), ['PPN', 'PPH22']);
  assert.equal(r.potongan[1].nominal, 150_000);
  const kecil = tax.potonganBelanja({ nilai: 1_500_000, jenis: 'barang' });
  assert.equal(kecil.potongan.length, 0);
});

test('honor ASN final per golongan & bukan pegawai', () => {
  assert.equal(tax.pph21HonorASN({ bruto: 1_000_000, golongan: 'III/c' }).pph, 50_000);
  assert.equal(tax.pph21HonorASN({ bruto: 1_000_000, golongan: 'II/a' }).pph, 0);
  assert.equal(tax.pph21HonorASN({ bruto: 1_000_000, golongan: 'IV/a' }).pph, 150_000);
  assert.equal(tax.pph21BukanPegawai({ bruto: 2_000_000 }).pph, 50_000);
});

test('terbilang', () => {
  assert.equal(terbilang(1_250_000), 'Satu juta dua ratus lima puluh ribu rupiah');
  assert.equal(terbilang(11_111), 'Sebelas ribu seratus sebelas rupiah');
  assert.equal(terbilang(0), 'Nol rupiah');
});
