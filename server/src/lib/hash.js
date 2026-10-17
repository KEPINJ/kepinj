import { createHash } from 'node:crypto';

export const GENESIS = '0'.repeat(64);

const money = (v) => Number(v || 0).toFixed(2);

/** Representasi kanonik satu baris BKU; urutan & format field tidak boleh berubah. */
export function canonical(e) {
  return [
    e.skpd_id, e.tahun, e.no_urut, e.tanggal, e.no_bukti, e.jenis, e.kode_rekening ?? '',
    e.uraian, money(e.penerimaan), money(e.pengeluaran), e.metode, e.rekanan_id ?? '',
    e.koreksi_of ?? '', e.created_by, new Date(e.created_at).toISOString(),
  ].join('|');
}

export function chainHash(prevHash, entry) {
  return createHash('sha256').update(prevHash).update('|').update(canonical(entry)).digest('hex');
}
