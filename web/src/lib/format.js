export const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const nf = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const rp = (v, { decimals = false } = {}) => `Rp ${(decimals ? nf2 : nf).format(Number(v || 0))}`;
export const num = (v) => nf.format(Number(v || 0));
export const money = (v) => nf2.format(Number(v || 0));

export function compact(v) {
  const n = Number(v || 0); const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toLocaleString('id-ID', { maximumFractionDigits: 2 })} T`;
  if (a >= 1e9) return `${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (a >= 1e3) return `${(n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return nf.format(n);
}

export function tgl(s, { long = false } = {}) {
  if (!s) return '-';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return long ? `${d} ${BULAN[m - 1]} ${y}` : `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export const waktu = (s) => (s ? new Date(s).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const JENIS_PAJAK = { PPH21: 'PPh 21', PPH22: 'PPh 22', PPH23: 'PPh 23', PPH4A2: 'PPh 4(2)', PPN: 'PPN' };
export const ROLE = { admin: 'Administrator', bendahara: 'Bendahara', verifikator: 'Verifikator', pimpinan: 'Pimpinan', bendahara_penerimaan: 'Bendahara Penerimaan', bendahara_pembantu: 'Bendahara Pembantu' };

/** Parse input rupiah "1.250.000,50" -> 1250000.5 */
export function parseRp(s) {
  if (typeof s === 'number') return s;
  const t = String(s || '').replace(/[^\d,-]/g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}
