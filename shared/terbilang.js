const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function eja(n) {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${eja(n - 10)} belas`;
  if (n < 100) return `${eja(Math.floor(n / 10))} puluh ${eja(n % 10)}`;
  if (n < 200) return `seratus ${eja(n - 100)}`;
  if (n < 1000) return `${eja(Math.floor(n / 100))} ratus ${eja(n % 100)}`;
  if (n < 2000) return `seribu ${eja(n - 1000)}`;
  if (n < 1e6) return `${eja(Math.floor(n / 1000))} ribu ${eja(n % 1000)}`;
  if (n < 1e9) return `${eja(Math.floor(n / 1e6))} juta ${eja(n % 1e6)}`;
  if (n < 1e12) return `${eja(Math.floor(n / 1e9))} miliar ${eja(n % 1e9)}`;
  return `${eja(Math.floor(n / 1e12))} triliun ${eja(n % 1e12)}`;
}

/** terbilang(1250000) -> "Satu juta dua ratus lima puluh ribu rupiah" */
export function terbilang(value, suffix = 'rupiah') {
  const n = Math.round(Math.abs(Number(value) || 0));
  const words = n === 0 ? 'nol' : eja(n);
  const text = `${Number(value) < 0 ? 'minus ' : ''}${words} ${suffix}`.replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
