// Jatuh tempo penyetoran & pelaporan pajak oleh bendahara (PMK 81/2024):
// setor paling lambat tanggal 15 dan lapor tanggal 20 bulan berikutnya.
// Bila jatuh pada Sabtu/Minggu, bergeser ke hari kerja berikutnya
// (hari libur nasional belum diperhitungkan).
export const TANGGAL_SETOR = 15;
export const TANGGAL_LAPOR = 20;

const ymd = (d) => d.toISOString().slice(0, 10);

export function hariKerja(tahun, bulan, tanggal) {
  const d = new Date(Date.UTC(tahun, bulan - 1, tanggal));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
}

export function jatuhTempo(tahun, masa) {
  const t = masa === 12 ? tahun + 1 : tahun;
  const b = masa === 12 ? 1 : masa + 1;
  return { setor: hariKerja(t, b, TANGGAL_SETOR), lapor: hariKerja(t, b, TANGGAL_LAPOR) };
}

export function hariIni() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const selisihHari = (dari, ke) => Math.round((Date.parse(ke) - Date.parse(dari)) / 86400000);

export const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/** Hari kerja sebelum `today` (Sabtu/Minggu dilewati): penerimaan sebelum tanggal ini yang belum disetor dianggap terlambat. */
export function batasSetor(today) {
  const d = new Date(`${today}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
