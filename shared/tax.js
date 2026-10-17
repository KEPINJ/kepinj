// =====================================================================
//  Mesin perhitungan pajak bendahara pemerintah daerah.
//  Modul ini isomorfik: dipakai backend dan frontend (kalkulator realtime).
//  Dasar: UU HPP, PP 58/2023 & PMK 168/2023 (PPh 21 TER),
//         PMK 59/2022 (pemungutan bendahara), PMK 131/2024 (PPN 12% DPP 11/12).
// =====================================================================

export const PTKP_DASAR = 54_000_000;
export const PTKP_KAWIN = 4_500_000;
export const PTKP_TANGGUNGAN = 4_500_000;

export const STATUS_PTKP = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'];

const floor = (n) => Math.floor(Number(n) + 1e-9);

export function parseStatus(status = 'TK/0') {
  const m = String(status).toUpperCase().replace(/\s/g, '').match(/^(TK|K)\/?([0-3])$/);
  if (!m) throw new Error(`Status PTKP tidak valid: ${status}`);
  return { kawin: m[1] === 'K', tanggungan: Number(m[2]) };
}

export function ptkpSetahun(status) {
  const { kawin, tanggungan } = parseStatus(status);
  return PTKP_DASAR + (kawin ? PTKP_KAWIN : 0) + Math.min(tanggungan, 3) * PTKP_TANGGUNGAN;
}

export function kategoriTER(status) {
  const s = `${parseStatus(status).kawin ? 'K' : 'TK'}/${parseStatus(status).tanggungan}`;
  if (['TK/0', 'TK/1', 'K/0'].includes(s)) return 'A';
  if (['TK/2', 'TK/3', 'K/1', 'K/2'].includes(s)) return 'B';
  return 'C';
}

// [batas atas penghasilan bruto bulanan, tarif %]; Infinity = lapisan terakhir
export const TER = {
  A: [[5400000,0],[5650000,0.25],[5950000,0.5],[6300000,0.75],[6750000,1],[7500000,1.25],[8550000,1.5],[9650000,1.75],[10050000,2],[10350000,2.25],[10700000,2.5],[11050000,3],[11600000,3.5],[12500000,4],[13750000,5],[15100000,6],[16950000,7],[19750000,8],[24150000,9],[26450000,10],[28000000,11],[30050000,12],[32400000,13],[35400000,14],[39100000,15],[43850000,16],[47800000,17],[51400000,18],[56300000,19],[62200000,20],[68600000,21],[77500000,22],[89000000,23],[103000000,24],[125000000,25],[157000000,26],[206000000,27],[337000000,28],[454000000,29],[550000000,30],[695000000,31],[910000000,32],[1400000000,33],[Infinity,34]],
  B: [[6200000,0],[6500000,0.25],[6850000,0.5],[7300000,0.75],[9200000,1],[10750000,1.5],[11250000,2],[11600000,2.5],[12600000,3],[13600000,4],[14950000,5],[16400000,6],[18450000,7],[21850000,8],[26000000,9],[27700000,10],[29350000,11],[31450000,12],[33950000,13],[37100000,14],[41100000,15],[45800000,16],[49500000,17],[53800000,18],[58500000,19],[64000000,20],[71000000,21],[80000000,22],[93000000,23],[109000000,24],[129000000,25],[163000000,26],[211000000,27],[374000000,28],[459000000,29],[555000000,30],[704000000,31],[957000000,32],[1405000000,33],[Infinity,34]],
  C: [[6600000,0],[6950000,0.25],[7350000,0.5],[7800000,0.75],[8850000,1],[9800000,1.25],[10950000,1.5],[11200000,1.75],[12050000,2],[12950000,3],[14150000,4],[15550000,5],[17050000,6],[19500000,7],[22700000,8],[26600000,9],[28100000,10],[30100000,11],[32600000,12],[35400000,13],[38900000,14],[43000000,15],[47400000,16],[51200000,17],[55800000,18],[60400000,19],[66700000,20],[74500000,21],[83200000,22],[95600000,23],[110000000,24],[134000000,25],[169000000,26],[221000000,27],[390000000,28],[463000000,29],[561000000,30],[709000000,31],[965000000,32],[1419000000,33],[Infinity,34]],
};

export function tarifTER(status, brutoBulanan) {
  const kategori = kategoriTER(status);
  const row = TER[kategori].find(([batas]) => Number(brutoBulanan) <= batas);
  return { kategori, tarif: row[1] };
}

/** PPh 21 pegawai tetap masa Januari-November (tarif efektif bulanan). */
export function pph21Bulanan({ bruto, status = 'TK/0' }) {
  const { kategori, tarif } = tarifTER(status, bruto);
  return { metode: 'TER', kategori, tarif, dpp: Number(bruto), pph: floor((Number(bruto) * tarif) / 100) };
}

export const LAPISAN_PASAL17 = [
  [60_000_000, 5], [250_000_000, 15], [500_000_000, 25], [5_000_000_000, 30], [Infinity, 35],
];

export function pasal17(pkp) {
  let sisa = Math.max(0, Number(pkp));
  let bawah = 0;
  let pajak = 0;
  const rincian = [];
  for (const [atas, tarif] of LAPISAN_PASAL17) {
    if (sisa <= 0) break;
    const lebar = Math.min(sisa, atas - bawah);
    const p = (lebar * tarif) / 100;
    rincian.push({ lapisan: lebar, tarif, pajak: p });
    pajak += p;
    sisa -= lebar;
    bawah = atas;
  }
  return { pajak: floor(pajak), rincian };
}

/**
 * PPh 21 pegawai tetap masa pajak terakhir (Desember / bulan berhenti):
 * dihitung setahun dengan tarif Pasal 17 lalu dikurangi PPh yang telah dipotong.
 */
export function pph21Tahunan({
  brutoSetahun, iuranPensiunSetahun = 0, zakatSetahun = 0, status = 'TK/0',
  pphTelahDipotong = 0, jumlahBulan = 12,
}) {
  const bruto = Number(brutoSetahun);
  const biayaJabatan = Math.min(bruto * 0.05, 500_000 * jumlahBulan);
  const neto = bruto - biayaJabatan - Number(iuranPensiunSetahun) - Number(zakatSetahun);
  const ptkp = ptkpSetahun(status);
  const pkp = Math.floor(Math.max(0, neto - ptkp) / 1000) * 1000;
  const { pajak, rincian } = pasal17(pkp);
  return {
    metode: 'PASAL17_SETAHUN', bruto, biayaJabatan, iuranPensiun: Number(iuranPensiunSetahun), zakat: Number(zakatSetahun),
    neto, ptkp, pkp, pphSetahun: pajak, rincian, pphTelahDipotong: Number(pphTelahDipotong),
    pphMasaTerakhir: pajak - Number(pphTelahDipotong),
  };
}

/** PPh 21 bukan pegawai (tenaga ahli, narasumber non-ASN, dsb): 50% bruto x tarif Pasal 17 kumulatif. */
export function pph21BukanPegawai({ bruto, kumulatifSebelumnya = 0 }) {
  const dpp = floor(Number(bruto) * 0.5);
  const sebelum = pasal17(Number(kumulatifSebelumnya)).pajak;
  const sesudah = pasal17(Number(kumulatifSebelumnya) + dpp).pajak;
  const pph = sesudah - sebelum;
  const total = Number(kumulatifSebelumnya) + dpp;
  const tarif = (LAPISAN_PASAL17.find(([atas]) => total <= atas) || [0, 35])[1];
  return { metode: 'BUKAN_PEGAWAI', dpp, pph, tarif, tarifEfektif: Number(bruto) ? (pph / Number(bruto)) * 100 : 0 };
}

/** PPh 21 final atas honorarium ASN/pejabat yang dibebankan APBD (PP 80/2010). */
export function pph21HonorASN({ bruto, golongan = 'III' }) {
  const g = String(golongan).toUpperCase().trim();
  const roman = g.match(/^(IV|III|II|I)/)?.[1] || (g === 'PEJABAT' ? 'PEJABAT' : 'III');
  const tarif = { I: 0, II: 0, III: 5, IV: 15, PEJABAT: 15 }[roman];
  return { metode: 'FINAL_HONOR_APBD', golongan: roman, tarif, dpp: Number(bruto), pph: floor((Number(bruto) * tarif) / 100) };
}

export const PPN_TARIF = 12;
export const BATAS_PUNGUT_BENDAHARA = 2_000_000;

/**
 * PPN dipungut bendahara. Mulai 2025 tarif 12% x DPP nilai lain 11/12 (non-mewah),
 * sehingga beban efektif 11% dari harga jual.
 */
export function ppn({ nilai, termasukPPN = false, mewah = false }) {
  const efektif = mewah ? 12 : 11;
  const harga = termasukPPN ? (Number(nilai) * 100) / (100 + efektif) : Number(nilai);
  const dpp = floor(harga);
  const dppNilaiLain = mewah ? dpp : floor((dpp * 11) / 12);
  const pajak = floor((dppNilaiLain * PPN_TARIF) / 100);
  return { dpp, dppNilaiLain, tarif: PPN_TARIF, ppn: pajak, total: dpp + pajak };
}

export function pph22Bendahara({ dpp, tarif = 1.5 }) {
  return { dpp: Number(dpp), tarif, pph: floor((Number(dpp) * tarif) / 100) };
}

export function pph23({ dpp, tarif = 2, punyaNpwp = true }) {
  const t = punyaNpwp ? tarif : tarif * 2;
  return { dpp: Number(dpp), tarif: t, pph: floor((Number(dpp) * t) / 100) };
}

export function pph4a2({ dpp, tarif }) {
  return { dpp: Number(dpp), tarif: Number(tarif), pph: floor((Number(dpp) * Number(tarif)) / 100) };
}

export const JENIS_BELANJA = {
  barang:     { label: 'Pengadaan barang',           pph: 'PPH22',  tarif: 1.5,  kode: '22-100-01' },
  jasa:       { label: 'Jasa (konsultan, sewa alat, dll)', pph: 'PPH23', tarif: 2, kode: '24-104-14' },
  konstruksi: { label: 'Jasa konstruksi (kualifikasi kecil)', pph: 'PPH4A2', tarif: 1.75, kode: '28-409-07' },
  konstruksi_menengah: { label: 'Jasa konstruksi (menengah/besar)', pph: 'PPH4A2', tarif: 2.65, kode: '28-409-08' },
  konsultan_konstruksi: { label: 'Konsultansi konstruksi', pph: 'PPH4A2', tarif: 3.5, kode: '28-409-11' },
  sewa_tanah_bangunan: { label: 'Sewa tanah dan/atau bangunan', pph: 'PPH4A2', tarif: 10, kode: '28-403-02' },
};

/**
 * Potongan pajak atas satu transaksi belanja LS/GU oleh bendahara.
 * Mengembalikan rincian PPN, PPh, dan nilai netto yang dibayarkan ke rekanan.
 */
export function potonganBelanja({ nilai, termasukPPN = true, jenis = 'barang', pkp = true, punyaNpwp = true }) {
  const cfg = JENIS_BELANJA[jenis];
  if (!cfg) throw new Error(`Jenis belanja tidak dikenal: ${jenis}`);
  const nilaiNum = Number(nilai);
  const dibawahBatas = nilaiNum <= BATAS_PUNGUT_BENDAHARA;
  const p = pkp ? ppn({ nilai: nilaiNum, termasukPPN }) : { dpp: floor(nilaiNum), dppNilaiLain: 0, tarif: 0, ppn: 0, total: floor(nilaiNum) };
  const potongan = [];
  const catatan = [];
  if (pkp && !dibawahBatas) {
    potongan.push({ jenis_pajak: 'PPN', kode_objek: 'PPN-BENDAHARA', dpp: p.dppNilaiLain, tarif: p.tarif, nominal: p.ppn });
  } else if (pkp) {
    catatan.push('Nilai transaksi ≤ Rp2.000.000: PPN tidak dipungut bendahara (disetor sendiri oleh PKP).');
  }
  let pph;
  if (cfg.pph === 'PPH22') {
    pph = dibawahBatas ? null : pph22Bendahara({ dpp: p.dpp, tarif: cfg.tarif });
    if (dibawahBatas) catatan.push('Nilai transaksi ≤ Rp2.000.000: PPh 22 tidak dipungut.');
  } else if (cfg.pph === 'PPH23') {
    pph = pph23({ dpp: p.dpp, tarif: cfg.tarif, punyaNpwp });
  } else {
    pph = pph4a2({ dpp: p.dpp, tarif: cfg.tarif });
  }
  if (pph) potongan.push({ jenis_pajak: cfg.pph, kode_objek: cfg.kode, dpp: pph.dpp, tarif: pph.tarif, nominal: pph.pph });
  const bruto = termasukPPN ? floor(nilaiNum) : p.total;
  const totalPotongan = potongan.reduce((s, x) => s + x.nominal, 0);
  return { jenis, label: cfg.label, bruto, dpp: p.dpp, potongan, totalPotongan, netto: bruto - totalPotongan, catatan };
}
