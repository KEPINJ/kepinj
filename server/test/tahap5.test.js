import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bagiPola, POLA } from '../src/routes/anggarankas.js';
import { normalisasiWa, susunPesan } from '../src/routes/pengingatluar.js';
import { susunBerkas, kodeBank } from '../src/routes/transfer.js';

test('anggaran kas: pola dibagi per ribuan dan jumlahnya sama dengan pagu', () => {
  for (const pagu of [1_119_000_000, 125_000_000, 7_654_321.5]) {
    for (const bobot of [POLA.rata, POLA.triwulan]) {
      const v = bagiPola(pagu, bobot);
      assert.equal(v.length, 12);
      assert.ok(Math.abs(v.reduce((s, x) => s + x, 0) - pagu) < 0.01);
      v.slice(0, 11).forEach((x) => assert.equal(x % 1000, 0));
    }
  }
});

test('nomor WhatsApp dinormalkan ke format 62', () => {
  assert.equal(normalisasiWa('0812-3456-7890'), '6281234567890');
  assert.equal(normalisasiWa('+62 812 3456 7890'), '6281234567890');
  assert.equal(normalisasiWa('81234567890'), '6281234567890');
});

test('pesan pengingat memuat semua butir', () => {
  const m = susunPesan({ full_name: 'Siti' }, [{ judul: 'Setor pajak', pesan: 'Jatuh tempo 15/11' }, { judul: 'Tutup buku' }]);
  assert.match(m.judul, /2 hal/);
  assert.match(m.isi, /1\. Setor pajak/);
  assert.match(m.wa, /\*Tutup buku\*/);
});

test('berkas transfer CMS: total, rekening sumber, dan karakter pemisah dibersihkan', async () => {
  const batch = { nomor: 'TRF-001/5.02/2026', tanggal: '2026-10-27', format: 'mandiri_mcm', rekening_sumber: '100-200-3000' };
  const items = [
    { nama: 'CV Maju, Jaya', bank: 'Bank Daerah', kode_bank: kodeBank('Bank Daerah'), no_rekening: '1001002003', bruto: 1000, potongan: 110, nilai: 890, berita: 'BKT-1 Belanja' },
    { nama: 'PT Sinar', bank: 'Mandiri', kode_bank: kodeBank('mandiri'), no_rekening: '5430987612', bruto: 500, potongan: 0, nilai: 500, berita: 'BKT-2' },
  ];
  const csv = (await susunBerkas(batch, items, { nama: 'BKAD' })).toString();
  const baris = csv.trim().split('\r\n');
  assert.equal(baris[0], 'P,20261027,1002003000,2,1390.00');
  assert.ok(baris[1].startsWith('1001002003,CV Maju Jaya,'));
  assert.match(baris[2], /,IBU,,/);
  for (const f of ['csv_umum', 'bri_cms', 'bni_direct']) assert.equal((await susunBerkas({ ...batch, format: f }, items, {})).toString().trim().split('\r\n').length, 3);
});
