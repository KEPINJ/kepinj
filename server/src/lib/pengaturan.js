import { query } from '../db.js';

const DEFAULT = { batas_kas_tunai: 50_000_000, batas_transaksi_tunai: 10_000_000, ambang_pagu_persen: 90, ambang_gu_persen: 50, batas_hari_panjar: 14 };

export async function getPengaturan() {
  const { rows } = await query('SELECT kunci, nilai FROM pengaturan');
  return { ...DEFAULT, ...Object.fromEntries(rows.map((r) => [r.kunci, r.nilai])) };
}
