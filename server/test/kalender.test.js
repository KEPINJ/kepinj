import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jatuhTempo, hariKerja, selisihHari, batasSetor } from '../src/lib/kalender.js';

test('jatuh tempo setor tgl 15 & lapor tgl 20 bulan berikutnya', () => {
  // masa Oktober 2026: 15 Nov 2026 hari Minggu -> Senin 16 Nov; 20 Nov 2026 Jumat
  assert.deepEqual(jatuhTempo(2026, 10), { setor: '2026-11-16', lapor: '2026-11-20' });
});

test('masa Desember jatuh tempo di Januari tahun berikutnya', () => {
  assert.deepEqual(jatuhTempo(2026, 12), { setor: '2027-01-15', lapor: '2027-01-20' });
});

test('Sabtu/Minggu bergeser ke Senin', () => {
  assert.equal(hariKerja(2026, 8, 15), '2026-08-17'); // Sabtu -> Senin
  assert.equal(hariKerja(2026, 9, 15), '2026-09-15'); // Selasa tetap
});

test('selisih hari', () => {
  assert.equal(selisihHari('2026-10-26', '2026-11-16'), 21);
  assert.equal(selisihHari('2026-10-26', '2026-10-20'), -6);
});

test('batas setor penerimaan = hari kerja sebelumnya', () => {
  assert.equal(batasSetor('2026-10-27'), '2026-10-26'); // Selasa -> Senin
  assert.equal(batasSetor('2026-10-26'), '2026-10-23'); // Senin -> Jumat
});
