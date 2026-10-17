// Alur transaksi bendahara yang dipakai API dan seeder.
import { emit } from '../db.js';
import { insertEntries } from './ledger.js';
import { bad, money, isDate } from './http.js';

export const LABEL_PAJAK = { PPH21: 'PPh 21', PPH22: 'PPh 22', PPH23: 'PPh 23', PPH4A2: 'PPh 4 ayat (2)', PPN: 'PPN' };

/**
 * Mencatat transaksi BKU. Jika ada potongan pajak pada pengeluaran, setiap pajak
 * dibukukan sebagai penerimaan "pungutan pajak" dan dicatat di register pajak.
 */
export async function catatTransaksi(c, user, skpd, b) {
  const pajakList = Array.isArray(b.pajak) ? b.pajak.filter((p) => Number(p.nominal) > 0) : [];
  if (pajakList.length && !(Number(b.pengeluaran) > 0)) throw bad('Potongan pajak hanya untuk transaksi pengeluaran');
  const tahun = Number(String(b.tanggal).slice(0, 4));
  const [entry] = await insertEntries(c, user, skpd, [b]);
  let rekanan = null;
  if (b.rekanan_id) ({ rows: [rekanan] } = await c.query('SELECT * FROM rekanan WHERE id = $1', [b.rekanan_id]));
  const pajak = [];
  if (pajakList.length) {
    const pungut = await insertEntries(c, user, skpd, pajakList.map((p) => ({
      tanggal: b.tanggal, no_bukti: b.no_bukti, jenis: 'PAJAK_PUNGUT', metode: b.metode,
      uraian: `Diterima ${LABEL_PAJAK[p.jenis_pajak] || p.jenis_pajak} atas ${b.uraian}`.slice(0, 1000), penerimaan: p.nominal,
    })));
    for (const [i, p] of pajakList.entries()) {
      const { rows: [rec] } = await c.query(`
        INSERT INTO pajak (skpd_id, bku_entry_id, tahun, masa, jenis_pajak, kode_objek, penerima_nama, penerima_npwp, penerima_nik, penerima_nitku,
                           status_ptkp, dokumen_jenis, dokumen_nomor, dokumen_tanggal, dpp, tarif, nominal, detail, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [
        skpd, pungut[i].id, tahun, Number(String(b.tanggal).slice(5, 7)), p.jenis_pajak, p.kode_objek === 'PPN-BENDAHARA' ? null : (p.kode_objek || null),
        p.penerima_nama || rekanan?.nama || String(b.uraian).slice(0, 100), p.penerima_npwp || rekanan?.npwp || null, p.penerima_nik || rekanan?.nik || null,
        rekanan?.nitku || null, p.status_ptkp || null, p.dokumen_jenis || (p.jenis_pajak === 'PPH21' ? 'Other' : 'CommercialInvoice'), b.no_bukti, b.tanggal,
        money(p.dpp), Number(p.tarif) || 0, money(p.nominal), { belanja_entry_id: entry.id, sp2d: b.no_sp2d || null, bruto: p.bruto ?? undefined }, user.id]);
      pajak.push(rec);
    }
    await emit(c, 'pajak.created', String(skpd), { skpd_id: skpd, count: pajak.length, nominal: pajak.reduce((s, r) => s + Number(r.nominal), 0) });
  }
  return { entry, pajak, tahun };
}

/** Menyetor pajak (NTPN) dan membukukan pengeluaran setoran untuk pungutan yang melalui BKU. */
export async function setorPajak(c, user, ids, { ntpn, id_billing: billing, tanggal_setor: tgl, metode = 'bank' }) {
  if (!/^[A-Z0-9]{16}$/i.test(String(ntpn).trim())) throw bad('NTPN harus 16 karakter alfanumerik');
  if (!isDate(tgl)) throw bad('Tanggal setor tidak valid');
  const { rows } = await c.query('SELECT * FROM pajak WHERE id = ANY($1) ORDER BY id FOR UPDATE', [ids.map(Number)]);
  if (!rows.length) throw bad('Data pajak tidak ditemukan');
  const skpd = rows[0].skpd_id;
  if (rows.some((r) => r.skpd_id !== skpd)) throw bad('Penyetoran harus untuk satu SKPD');
  if (rows.some((r) => r.status !== 'dipungut')) throw bad('Sebagian data sudah disetor/dilaporkan');
  const viaBku = rows.filter((r) => r.bku_entry_id);
  const groups = {};
  for (const r of viaBku) groups[r.jenis_pajak] = (groups[r.jenis_pajak] || 0) + Number(r.nominal);
  const entries = Object.entries(groups).map(([j, nominal]) => ({
    tanggal: tgl, no_bukti: `NTPN ${String(ntpn).toUpperCase()}`, jenis: 'PAJAK_SETOR', metode,
    uraian: `Disetor ${LABEL_PAJAK[j]} (${viaBku.filter((r) => r.jenis_pajak === j).length} bukti) - billing ${billing || '-'}`, pengeluaran: nominal,
  }));
  const saved = entries.length ? await insertEntries(c, user, skpd, entries) : [];
  await c.query(`UPDATE pajak SET status = 'disetor', ntpn = $2, id_billing = $3, tanggal_setor = $4, updated_at = now() WHERE id = ANY($1)`,
    [rows.map((r) => r.id), String(ntpn).toUpperCase(), billing || null, tgl]);
  await emit(c, 'pajak.disetor', String(skpd), { skpd_id: skpd, ids: rows.map((r) => r.id), ntpn, total: rows.reduce((s, r) => s + Number(r.nominal), 0) });
  return { skpd, rows, saved };
}
