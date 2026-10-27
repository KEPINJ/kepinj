// Inti pencatatan BKU: penomoran berurutan + rantai hash (tamper-evident).
import { GENESIS, chainHash } from './hash.js';
import { emit } from '../db.js';
import { bad, isDate, money } from './http.js';
import { NAMA_BULAN } from './kalender.js';

export const JENIS_BKU = {
  SALDO_AWAL: 'Saldo awal', SP2D_UP: 'SP2D UP', SP2D_GU: 'SP2D GU', SP2D_TU: 'SP2D TU', SP2D_LS: 'SP2D LS',
  BELANJA: 'Belanja/SPJ', PAJAK_PUNGUT: 'Pungutan pajak', PAJAK_SETOR: 'Setoran pajak', PENERIMAAN: 'Penerimaan lain',
  PENYETORAN: 'Penyetoran ke kas daerah', PELIMPAHAN: 'Pelimpahan/tarik tunai', KOREKSI: 'Koreksi', LAINNYA: 'Lainnya',
};

const COLS = ['skpd_id', 'tahun', 'no_urut', 'tanggal', 'no_bukti', 'jenis', 'kode_rekening', 'uraian', 'penerimaan', 'pengeluaran',
  'metode', 'rekanan_id', 'koreksi_of', 'import_batch', 'created_by', 'created_at', 'prev_hash', 'hash'];

export function normalizeEntry(e, idx = 0) {
  const where = idx ? ` (baris ${idx})` : '';
  if (!isDate(e.tanggal)) throw bad(`Tanggal tidak valid${where}: ${e.tanggal ?? '(kosong)'}`);
  if (!e.uraian || !String(e.uraian).trim()) throw bad(`Uraian wajib diisi${where}`);
  const penerimaan = money(e.penerimaan);
  const pengeluaran = money(e.pengeluaran);
  if (penerimaan < 0 || pengeluaran < 0) throw bad(`Nilai tidak boleh negatif${where}`);
  if (penerimaan > 0 && pengeluaran > 0) throw bad(`Isi penerimaan ATAU pengeluaran, tidak keduanya${where}`);
  if (penerimaan === 0 && pengeluaran === 0 && e.jenis !== 'SALDO_AWAL') throw bad(`Nilai transaksi tidak boleh nol${where}`);
  const jenis = e.jenis || (penerimaan > 0 ? 'PENERIMAAN' : 'BELANJA');
  if (!JENIS_BKU[jenis]) throw bad(`Jenis transaksi tidak dikenal${where}: ${jenis}`);
  return {
    tanggal: e.tanggal,
    no_bukti: String(e.no_bukti || '-').trim().slice(0, 100),
    jenis,
    kode_rekening: e.kode_rekening ? String(e.kode_rekening).trim() : null,
    uraian: String(e.uraian).trim().slice(0, 1000),
    penerimaan,
    pengeluaran,
    metode: e.metode === 'tunai' ? 'tunai' : 'bank',
    rekanan_id: e.rekanan_id ? Number(e.rekanan_id) : null,
    koreksi_of: e.koreksi_of ? Number(e.koreksi_of) : null,
    import_batch: e.import_batch || null,
  };
}

/**
 * Menyimpan satu atau banyak entri BKU dalam transaksi `client` yang sudah terbuka.
 * Mengunci kepala rantai per (SKPD, tahun) sehingga penomoran & hash selalu konsisten
 * walaupun banyak pengguna menulis bersamaan.
 */
export async function insertEntries(client, user, skpdId, rawEntries) {
  const entries = rawEntries.map((e, i) => normalizeEntry(e, rawEntries.length > 1 ? i + 1 : 0));
  const byYear = new Map();
  for (const e of entries) {
    const y = Number(e.tanggal.slice(0, 4));
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(e);
  }
  const kode = [...new Set(entries.map((e) => e.kode_rekening).filter(Boolean))];
  if (kode.length) {
    const { rows } = await client.query('SELECT kode FROM rekening WHERE kode = ANY($1)', [kode]);
    const known = new Set(rows.map((r) => r.kode));
    const unknown = kode.filter((k) => !known.has(k));
    if (unknown.length) throw bad(`Kode rekening tidak terdaftar: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ', …' : ''}`);
  }

  // Tutup buku: tolak lebih awal dengan pesan yang jelas (trigger database tetap menjadi pengaman akhir)
  const periode = [...new Set(entries.map((e) => Number(e.tanggal.slice(0, 4)) * 100 + Number(e.tanggal.slice(5, 7))))];
  const { rows: kunci } = await client.query('SELECT tahun, bulan FROM periode_kunci WHERE skpd_id = $1 AND tahun * 100 + bulan = ANY($2) ORDER BY 1, 2', [skpdId, periode]);
  if (kunci.length) {
    const label = kunci.map((k) => `${NAMA_BULAN[k.bulan - 1]} ${k.tahun}`).join(', ');
    throw bad(`Periode ${label} sudah ditutup buku. Gunakan tanggal pada bulan yang masih terbuka (mis. untuk jurnal koreksi), atau minta administrator membuka kunci.`);
  }

  const saved = [];
  for (const [tahun, list] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    await client.query('INSERT INTO bku_chain_head (skpd_id, tahun, last_no, last_hash) VALUES ($1,$2,0,$3) ON CONFLICT DO NOTHING', [skpdId, tahun, GENESIS]);
    const { rows: [head] } = await client.query('SELECT last_no, last_hash FROM bku_chain_head WHERE skpd_id = $1 AND tahun = $2 FOR UPDATE', [skpdId, tahun]);
    let no = head.last_no;
    let prev = head.last_hash;
    const now = Date.now();
    const rows = list.map((e, i) => {
      const row = { ...e, skpd_id: skpdId, tahun, no_urut: ++no, created_by: user.id, created_at: new Date(now + i).toISOString(), prev_hash: prev };
      row.hash = chainHash(prev, row);
      prev = row.hash;
      return row;
    });
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const { rows: ins } = await client.query(
        `INSERT INTO bku_entries (${COLS.join(',')})
         SELECT ${COLS.join(',')} FROM json_populate_recordset(NULL::bku_entries, $1::json)
         RETURNING id, ${COLS.join(',')}`,
        [JSON.stringify(chunk)],
      );
      saved.push(...ins);
    }
    await client.query('UPDATE bku_chain_head SET last_no = $3, last_hash = $4 WHERE skpd_id = $1 AND tahun = $2', [skpdId, tahun, no, prev]);
  }

  // satu event per hari-SKPD untuk impor besar, per entri untuk input biasa
  if (saved.length <= 50) {
    for (const s of saved) await emit(client, 'bku.entry.created', String(skpdId), { ...s, user: user.full_name });
  } else {
    const days = [...new Set(saved.map((s) => s.tanggal))];
    for (const d of days) await emit(client, 'bku.entry.created', String(skpdId), { skpd_id: skpdId, tanggal: d, bulk: true, count: saved.filter((s) => s.tanggal === d).length, user: user.full_name });
  }
  return saved;
}

/** Verifikasi seluruh rantai hash untuk satu SKPD & tahun. */
export async function verifyChain(client, skpdId, tahun) {
  const { rows: headRows } = await client.query('SELECT last_no, last_hash FROM bku_chain_head WHERE skpd_id = $1 AND tahun = $2', [skpdId, tahun]);
  const { rows } = await client.query(`SELECT ${['id', ...COLS].join(',')} FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 ORDER BY no_urut`, [skpdId, tahun]);
  let prev = GENESIS;
  const problems = [];
  rows.forEach((r, i) => {
    if (r.no_urut !== i + 1) problems.push({ no_urut: r.no_urut, id: r.id, masalah: `Nomor urut melompat (diharapkan ${i + 1})` });
    if (r.prev_hash !== prev) problems.push({ no_urut: r.no_urut, id: r.id, masalah: 'Tautan ke entri sebelumnya terputus' });
    const h = chainHash(r.prev_hash, r);
    if (h !== r.hash) problems.push({ no_urut: r.no_urut, id: r.id, masalah: 'Isi entri berubah setelah dicatat (hash tidak cocok)' });
    prev = r.hash;
  });
  const head = headRows[0];
  if (head && (head.last_no !== rows.length || head.last_hash !== prev)) problems.push({ masalah: 'Kepala rantai tidak cocok dengan entri terakhir (ada entri hilang)' });
  return { skpd_id: skpdId, tahun, jumlah_entri: rows.length, valid: problems.length === 0, hash_terakhir: prev, masalah: problems.slice(0, 100), diperiksa_pada: new Date().toISOString() };
}
