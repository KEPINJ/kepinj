// Buku pembantu append-only dengan rantai hash sendiri: BKU penerimaan (per SKPD) dan BKU bendahara pembantu (per unit kerja).
import { createHash } from 'node:crypto';
import { GENESIS } from './hash.js';
import { bad, isDate, money } from './http.js';

const BUKU = {
  bkp: { table: 'bkp_entries', jenis: ['SALDO_AWAL', 'TERIMA', 'SETOR'],
    cols: ['skpd_id', 'tahun', 'no_urut', 'tanggal', 'no_bukti', 'jenis', 'kode_rekening', 'uraian', 'penerimaan', 'pengeluaran', 'metode', 'penyetor', 'dasar', 'sts_id', 'created_by', 'created_at', 'prev_hash', 'hash'] },
  bpp: { table: 'bpp_entries', jenis: ['PELIMPAHAN', 'BELANJA', 'PAJAK_PUNGUT', 'SERAH_PAJAK', 'PENGEMBALIAN'],
    cols: ['skpd_id', 'unit_id', 'tahun', 'no_urut', 'tanggal', 'no_bukti', 'jenis', 'kode_rekening', 'rekanan_id', 'uraian', 'penerimaan', 'pengeluaran', 'metode', 'pajak', 'induk_id', 'bku_ref', 'created_by', 'created_at', 'prev_hash', 'hash'] },
};
const HASHED = ['tahun', 'no_urut', 'tanggal', 'no_bukti', 'jenis', 'kode_rekening', 'uraian', 'penerimaan', 'pengeluaran', 'metode', 'created_by', 'created_at'];

function rowHash(prev, scope, r) {
  const canon = [scope, ...HASHED.map((k) => (k === 'penerimaan' || k === 'pengeluaran' ? Number(r[k] || 0).toFixed(2) : k === 'created_at' ? new Date(r[k]).toISOString() : r[k] ?? ''))].join('|');
  return createHash('sha256').update(prev).update('|').update(canon).digest('hex');
}

/**
 * Simpan entri ke buku pembantu `buku` ('bkp' | 'bpp') dalam transaksi `c`.
 * `lingkup` = skpd_id untuk bkp, unit_id untuk bpp; `base` berisi kolom tetap (skpd_id, unit_id).
 */
export async function insertSub(c, buku, lingkup, base, user, entries) {
  const cfg = BUKU[buku];
  const saved = [];
  for (const e of entries) {
    if (!isDate(e.tanggal)) throw bad(`Tanggal tidak valid: ${e.tanggal ?? '(kosong)'}`);
    if (!String(e.uraian || '').trim()) throw bad('Uraian wajib diisi');
    if (!cfg.jenis.includes(e.jenis)) throw bad(`Jenis tidak dikenal: ${e.jenis}`);
    const penerimaan = money(e.penerimaan); const pengeluaran = money(e.pengeluaran);
    if (penerimaan < 0 || pengeluaran < 0 || (penerimaan > 0 && pengeluaran > 0)) throw bad('Isi penerimaan ATAU pengeluaran dengan nilai positif');
    if (!penerimaan && !pengeluaran && e.jenis !== 'SALDO_AWAL') throw bad('Nilai transaksi tidak boleh nol');
    const tahun = Number(e.tanggal.slice(0, 4));
    const { rows: kunci } = await c.query('SELECT 1 FROM periode_kunci WHERE skpd_id = $1 AND tahun = $2 AND bulan = $3', [base.skpd_id, tahun, Number(e.tanggal.slice(5, 7))]);
    if (kunci.length) throw bad(`Periode ${e.tanggal.slice(5, 7)}/${tahun} sudah ditutup buku`);
    await c.query('INSERT INTO subledger_head (buku, lingkup, tahun, last_no, last_hash) VALUES ($1,$2,$3,0,$4) ON CONFLICT DO NOTHING', [buku, lingkup, tahun, GENESIS]);
    const { rows: [head] } = await c.query('SELECT last_no, last_hash FROM subledger_head WHERE buku = $1 AND lingkup = $2 AND tahun = $3 FOR UPDATE', [buku, lingkup, tahun]);
    const row = {
      ...base, tahun, no_urut: head.last_no + 1, tanggal: e.tanggal, no_bukti: String(e.no_bukti || '-').trim().slice(0, 100), jenis: e.jenis,
      kode_rekening: e.kode_rekening || null, rekanan_id: e.rekanan_id ? Number(e.rekanan_id) : null, uraian: String(e.uraian).trim().slice(0, 1000),
      penerimaan, pengeluaran, metode: e.metode === 'bank' ? 'bank' : 'tunai', penyetor: e.penyetor || null, dasar: e.dasar || null, sts_id: e.sts_id || null,
      pajak: JSON.stringify(e.pajak || []), induk_id: e.induk_id || null, bku_ref: e.bku_ref || null,
      created_by: user.id, created_at: new Date().toISOString(), prev_hash: head.last_hash,
    };
    row.hash = rowHash(head.last_hash, lingkup, row);
    const cols = cfg.cols;
    const { rows: [ins] } = await c.query(`INSERT INTO ${cfg.table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((k) => row[k]));
    await c.query('UPDATE subledger_head SET last_no = $4, last_hash = $5 WHERE buku = $1 AND lingkup = $2 AND tahun = $3', [buku, lingkup, tahun, row.no_urut, row.hash]);
    saved.push(ins);
  }
  return saved;
}

/** Periksa keutuhan rantai hash satu buku pembantu. */
export async function verifySub(c, buku, lingkup, tahun) {
  const cfg = BUKU[buku];
  const kolom = buku === 'bkp' ? 'skpd_id' : 'unit_id';
  const { rows } = await c.query(`SELECT * FROM ${cfg.table} WHERE ${kolom} = $1 AND tahun = $2 ORDER BY no_urut`, [lingkup, tahun]);
  let prev = GENESIS; let valid = true;
  for (const [i, r] of rows.entries()) {
    if (r.no_urut !== i + 1 || r.prev_hash !== prev || rowHash(prev, lingkup, { ...r, tanggal: r.tanggal }) !== r.hash) { valid = false; break; }
    prev = r.hash;
  }
  return { valid, jumlah: rows.length };
}
