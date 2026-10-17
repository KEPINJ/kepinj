import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoretaxXml, validateForCoretax, tin16, nitku } from '../src/lib/coretax.js';
import { chainHash, GENESIS } from '../src/lib/hash.js';

test('NPWP 15 digit dikonversi ke 16 digit, NITKU 22 digit', () => {
  assert.equal(tin16('01.234.567.8-901.000'), '0012345678901000');
  assert.equal(nitku('0012345678901000'), '0012345678901000000000');
});

test('XML BPPU berisi elemen wajib & di-escape', () => {
  const xml = buildCoretaxXml('BPPU', { npwp: '0012345678901000' }, [
    { id: 1, masa: 9, tahun: 2026, penerima_npwp: '0123456789012000', kode_objek: '24-104-14', dpp: 1000000, tarif: 2, dokumen_nomor: 'A&B', detail: {} },
  ]);
  assert.match(xml, /<BpuBulk/);
  assert.match(xml, /<TaxObjectCode>24-104-14<\/TaxObjectCode>/);
  assert.match(xml, /<DocumentNumber>A&amp;B<\/DocumentNumber>/);
  assert.match(xml, /<WithholdingDate>2026-09-30<\/WithholdingDate>/);
});

test('validasi menolak NPWP tidak lengkap', () => {
  const issues = validateForCoretax('BP21', [{ id: 1, penerima_nama: 'X', penerima_npwp: '123', kode_objek: '21-100-07', dpp: 10, status_ptkp: 'TK/0' }]);
  assert.equal(issues.length, 1);
});

test('rantai hash berubah bila isi diubah', () => {
  const e = { skpd_id: 1, tahun: 2026, no_urut: 1, tanggal: '2026-01-02', no_bukti: 'X', jenis: 'BELANJA', uraian: 'a', penerimaan: 0, pengeluaran: 1000, metode: 'bank', created_by: 1, created_at: '2026-01-02T00:00:00.000Z' };
  const h1 = chainHash(GENESIS, e);
  assert.notEqual(h1, chainHash(GENESIS, { ...e, pengeluaran: 1001 }));
  assert.equal(h1, chainHash(GENESIS, { ...e, pengeluaran: '1000.00' }));
});
