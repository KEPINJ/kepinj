// Aturan jurnal otomatis dari transaksi BKU bendahara pengeluaran SKPD.
//
// Dasar kebijakan (ruang lingkup penelitian):
//  - PP 71/2010 tentang SAP berbasis akrual: entitas menyusun laporan berbasis akrual (LO, Neraca, LPE)
//    dan laporan pelaksanaan anggaran berbasis kas (LRA). Karena itu setiap transaksi dijurnal pada dua basis:
//      LO  = jurnal finansial (akrual) -> Beban, Aset, Kewajiban, Ekuitas, Pendapatan-LO
//      LRA = jurnal anggaran (kas)     -> Belanja / Pendapatan-LRA berpasangan dengan Perubahan SAL
//  - Permendagri 64/2013 (penerapan SAP akrual pada pemda) dan Bagan Akun Standar (Permendagri 90/2019,
//    Kepmendagri 050-5889/2021) untuk struktur akun; kode rinci dapat disesuaikan admin dengan
//    Peraturan Kepala Daerah tentang Kebijakan Akuntansi setempat.
//  - Hanya transaksi yang telah DISETUJUI melalui persetujuan berjenjang yang dijurnal.
//  - Transaksi yang perlakuannya tidak dapat ditentukan dari data BKU saja TIDAK dipaksa dijurnal,
//    melainkan masuk daftar "perlu telaah" untuk dijurnal manual oleh PPK-SKPD.
//  - Penyesuaian akrual akhir periode (utang belanja, persediaan, penyusutan, beban dibayar dimuka)
//    tidak berasal dari BKU dan dicatat lewat jurnal penyesuaian.

export const AKUN = {
  KAS_BANK: '1.1.01.03.01.0001',
  KAS_TUNAI: '1.1.01.03.01.0002',
  KAS_ANTARA: '1.1.01.03.01.0003',
  RK_PPKD: '3.1.03.01.01.0001',
  PERUBAHAN_SAL: '3.1.02.03.01.0001',
  UTANG_PFK: { PPH21: '2.1.01.01.01.0001', PPH22: '2.1.01.01.01.0002', PPH23: '2.1.01.01.01.0003', PPH4A2: '2.1.01.01.01.0004', PPN: '2.1.01.01.01.0005', LAIN: '2.1.01.01.01.0099' },
};

/** Akun dasar yang tidak berasal dari kode rekening anggaran. */
export const AKUN_DASAR = [
  ['1', 'Aset', 'aset', 'D', 'LO', 1, null],
  ['1.1', 'Aset Lancar', 'aset', 'D', 'LO', 2, '1'],
  ['1.1.01', 'Kas dan Setara Kas', 'aset', 'D', 'LO', 3, '1.1'],
  ['1.1.01.03', 'Kas di Bendahara Pengeluaran', 'aset', 'D', 'LO', 4, '1.1.01'],
  [AKUN.KAS_BANK, 'Kas di Bendahara Pengeluaran - Rekening Bank', 'aset', 'D', 'LO', 6, '1.1.01.03'],
  [AKUN.KAS_TUNAI, 'Kas di Bendahara Pengeluaran - Tunai', 'aset', 'D', 'LO', 6, '1.1.01.03'],
  [AKUN.KAS_ANTARA, 'Kas dalam Pelimpahan (akun antara)', 'aset', 'D', 'LO', 6, '1.1.01.03'],
  ['1.1.12.01.01.0001', 'Persediaan Alat Tulis Kantor', 'aset', 'D', 'LO', 6, '1.1'],
  ['1.3', 'Aset Tetap', 'aset', 'D', 'LO', 2, '1'],
  ['2', 'Kewajiban', 'kewajiban', 'K', 'LO', 1, null],
  ['2.1', 'Kewajiban Jangka Pendek', 'kewajiban', 'K', 'LO', 2, '2'],
  ['2.1.01', 'Utang Perhitungan Pihak Ketiga (PFK)', 'kewajiban', 'K', 'LO', 3, '2.1'],
  [AKUN.UTANG_PFK.PPH21, 'Utang PPh Pasal 21', 'kewajiban', 'K', 'LO', 6, '2.1.01'],
  [AKUN.UTANG_PFK.PPH22, 'Utang PPh Pasal 22', 'kewajiban', 'K', 'LO', 6, '2.1.01'],
  [AKUN.UTANG_PFK.PPH23, 'Utang PPh Pasal 23', 'kewajiban', 'K', 'LO', 6, '2.1.01'],
  [AKUN.UTANG_PFK.PPH4A2, 'Utang PPh Pasal 4 ayat (2)', 'kewajiban', 'K', 'LO', 6, '2.1.01'],
  [AKUN.UTANG_PFK.PPN, 'Utang PPN', 'kewajiban', 'K', 'LO', 6, '2.1.01'],
  [AKUN.UTANG_PFK.LAIN, 'Utang PFK Lainnya', 'kewajiban', 'K', 'LO', 6, '2.1.01'],
  ['2.1.06.01.01.0001', 'Utang Belanja Barang dan Jasa', 'kewajiban', 'K', 'LO', 6, '2.1'],
  ['3', 'Ekuitas', 'ekuitas', 'K', 'LO', 1, null],
  ['3.1.01.01.01.0001', 'Ekuitas', 'ekuitas', 'K', 'LO', 6, '3'],
  [AKUN.RK_PPKD, 'RK PPKD (Ekuitas untuk Dikonsolidasikan)', 'ekuitas', 'K', 'LO', 6, '3'],
  [AKUN.PERUBAHAN_SAL, 'Perubahan SAL', 'ekuitas', 'K', 'LRA', 6, '3'],
  ['4', 'Pendapatan Daerah - LRA', 'pendapatan_lra', 'K', 'LRA', 1, null],
  ['5', 'Belanja Daerah', 'belanja', 'D', 'LRA', 1, null],
  ['7', 'Pendapatan Daerah - LO', 'pendapatan_lo', 'K', 'LO', 1, null],
  ['8', 'Beban Daerah', 'beban', 'D', 'LO', 1, null],
];

export const LABEL_PAJAK_JENIS = { 'PPh 21': 'PPH21', 'PPh 22': 'PPH22', 'PPh 23': 'PPH23', 'PPh 4 ayat (2)': 'PPH4A2', 'PPh 4(2)': 'PPH4A2', PPN: 'PPN' };

/** Pemetaan struktural BAS: Belanja operasi 5.1.x -> Beban 8.1.x, Belanja modal 5.2.x -> Aset tetap 1.3.x, Pendapatan-LRA 4.x -> Pendapatan-LO 7.x. */
export function akunCermin(kodeRekening) {
  const k = String(kodeRekening || '');
  if (/^5\.1\./.test(k)) return { kode: `8${k.slice(1)}`, perlakuan: 'beban' };
  if (/^5\.2\./.test(k)) return { kode: `1.3${k.slice(3)}`, perlakuan: 'aset' };
  if (/^4\./.test(k)) return { kode: `7${k.slice(1)}`, perlakuan: 'pendapatan' };
  return null;
}

/** Nama akun cerminan dari nama rekening anggaran. */
export function namaCermin(namaRekening, kodeAkun) {
  const n = String(namaRekening || '').trim();
  if (kodeAkun.startsWith('8')) return n.replace(/^Belanja\s+/i, 'Beban ');
  if (kodeAkun.startsWith('1.3')) return n.replace(/^Belanja\s+Modal\s+/i, '') || n;
  if (kodeAkun.startsWith('7')) return `${n} - LO`;
  return n;
}

export const ATURAN = [
  { kode: 'SP2D', jenis: ['SP2D_UP', 'SP2D_GU', 'SP2D_TU', 'SP2D_LS'], nama: 'Penerimaan SP2D di rekening bendahara',
    lo: 'D Kas di Bendahara Pengeluaran / K RK PPKD', lra: '-',
    dasar: 'Dana dari RKUD menambah kas bendahara dan RK PPKD (ekuitas untuk dikonsolidasikan). Realisasi belanja (LRA) tidak diakui di sini, tetapi saat belanja dibayarkan, agar tidak terjadi pengakuan ganda.' },
  { kode: 'BELANJA_OPERASI', jenis: ['BELANJA'], nama: 'Belanja operasi (5.1) melalui bendahara',
    lo: 'D Beban (8.1, cerminan kode belanja) / K Kas di Bendahara Pengeluaran', lra: 'D Belanja (5.1) / K Perubahan SAL',
    dasar: 'Beban diakui saat terjadi penurunan manfaat ekonomi (pembayaran barang/jasa habis pakai); belanja LRA diakui saat kas keluar dari kas bendahara. Nilai bruto, potongan pajak dicatat terpisah sebagai utang PFK.' },
  { kode: 'BELANJA_MODAL', jenis: ['BELANJA'], nama: 'Belanja modal (5.2)',
    lo: 'D Aset Tetap (1.3, cerminan kode belanja modal) / K Kas di Bendahara Pengeluaran', lra: 'D Belanja Modal (5.2) / K Perubahan SAL',
    dasar: 'Belanja modal menghasilkan aset tetap (kapitalisasi), bukan beban. Batas nilai kapitalisasi dan biaya atribusi mengikuti kebijakan akuntansi daerah; selisihnya disesuaikan lewat jurnal penyesuaian.' },
  { kode: 'PERSEDIAAN', jenis: ['BELANJA'], nama: 'Belanja yang dipetakan sebagai persediaan',
    lo: 'D Persediaan / K Kas', lra: 'D Belanja / K Perubahan SAL',
    dasar: 'Hanya bila admin memetakan kode rekening ke perlakuan "persediaan" (pendekatan aset). Bawaan sistem memakai pendekatan beban dengan penyesuaian persediaan akhir periode berdasarkan stock opname.' },
  { kode: 'PUNGUT_PAJAK', jenis: ['PAJAK_PUNGUT'], nama: 'Pungutan/potongan pajak',
    lo: 'D Kas di Bendahara Pengeluaran / K Utang PFK (per jenis pajak)', lra: '-',
    dasar: 'Potongan pajak adalah titipan pihak ketiga (non-anggaran), diakui sebagai kewajiban sampai disetor.' },
  { kode: 'SETOR_PAJAK', jenis: ['PAJAK_SETOR'], nama: 'Penyetoran pajak (NTPN)',
    lo: 'D Utang PFK (per jenis pajak) / K Kas di Bendahara Pengeluaran', lra: '-', dasar: 'Penyetoran menghapus kewajiban PFK.' },
  { kode: 'PENDAPATAN', jenis: ['PENERIMAAN'], nama: 'Penerimaan berkode pendapatan (4.x)',
    lo: 'D Kas / K Pendapatan-LO (7.x)', lra: 'D Perubahan SAL / K Pendapatan-LRA (4.x)',
    dasar: 'Pendapatan-LO diakui saat timbul hak; karena BKU hanya mencatat kas, pengakuan terjadi saat kas diterima. Penerimaan tanpa kode pendapatan (mis. jasa giro) masuk daftar telaah karena perlakuannya bergantung pada kebijakan penyetoran ke RKUD.' },
  { kode: 'SETOR_KASDA', jenis: ['PENYETORAN'], nama: 'Penyetoran ke kas daerah (sisa UP/TU dsb.)',
    lo: 'D RK PPKD / K Kas di Bendahara Pengeluaran', lra: '-', dasar: 'Pengembalian dana ke RKUD mengurangi kas bendahara dan RK PPKD.' },
  { kode: 'PELIMPAHAN', jenis: ['PELIMPAHAN'], nama: 'Pelimpahan / penarikan tunai',
    lo: 'D Kas tujuan / K Kas dalam Pelimpahan, atau D Kas dalam Pelimpahan / K Kas asal', lra: '-',
    dasar: 'Mutasi antar-kas bendahara (bank ke tunai atau ke bendahara pembantu) tidak memengaruhi beban/pendapatan. Akun antara harus bersaldo nol bila pasangan pelimpahan lengkap; saldo sisa menandakan pelimpahan yang belum dipertanggungjawabkan.' },
  { kode: 'KOREKSI', jenis: ['KOREKSI'], nama: 'Jurnal koreksi BKU',
    lo: 'Kebalikan jurnal entri asal', lra: 'Kebalikan jurnal entri asal',
    dasar: 'Koreksi BKU (jurnal balik) membalik jurnal entri yang dikoreksi pada tanggal koreksi. Bila entri asal belum pernah dijurnal, koreksi tidak menimbulkan jurnal.' },
  { kode: 'TELAAH', jenis: ['SALDO_AWAL', 'LAINNYA'], nama: 'Perlu telaah PPK-SKPD',
    lo: '-', lra: '-', dasar: 'Saldo awal (neraca awal), transaksi "lainnya", belanja tanpa/di luar kode belanja, dan penerimaan tanpa kode pendapatan dijurnal manual karena perlakuannya tidak dapat ditentukan dari BKU.' },
];

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const kasDari = (e) => (e.metode === 'tunai' ? AKUN.KAS_TUNAI : AKUN.KAS_BANK);
const baris = (basis, akun, debit, kredit, keterangan) => ({ basis, akun_kode: akun, debit: r2(debit), kredit: r2(kredit), keterangan });
const telaah = (alasan) => ({ status: 'telaah', aturan: 'TELAAH', alasan, baris: [] });

/**
 * Susun jurnal untuk satu entri BKU.
 * @param e  entri BKU { jenis, metode, kode_rekening, penerimaan, pengeluaran, uraian, pajak_jenis? }
 * @param pemetaan  baris pemetaan_akun untuk kode rekening entri (opsional)
 * @returns { status: 'jurnal'|'telaah'|'balik', aturan, dasar, baris[] , alasan? }
 */
export function susunJurnal(e, pemetaan = null) {
  const masuk = r2(e.penerimaan); const keluar = r2(e.pengeluaran);
  const nilai = masuk || keluar;
  const kas = kasDari(e);
  const aturan = (k) => ATURAN.find((a) => a.kode === k);
  const jadi = (kode, rows) => ({ status: 'jurnal', aturan: kode, dasar: aturan(kode).dasar, baris: rows });
  switch (e.jenis) {
    case 'SP2D_UP': case 'SP2D_GU': case 'SP2D_TU': case 'SP2D_LS':
      if (!masuk) return telaah('SP2D tercatat sebagai pengeluaran, periksa pencatatan BKU');
      return jadi('SP2D', [baris('LO', kas, nilai, 0), baris('LO', AKUN.RK_PPKD, 0, nilai)]);
    case 'BELANJA': {
      if (!keluar) return telaah('Belanja tercatat sebagai penerimaan; gunakan jurnal koreksi atau telaah manual');
      if (!e.kode_rekening) return telaah('Belanja tanpa kode rekening tidak dapat dipetakan ke akun beban/aset');
      if (!/^5\./.test(e.kode_rekening)) return telaah(`Kode ${e.kode_rekening} bukan kode belanja (5.x)`);
      if (pemetaan?.perlakuan === 'telaah') return telaah(pemetaan.catatan || 'Kode rekening ditandai perlu telaah oleh admin');
      const cermin = akunCermin(e.kode_rekening);
      const akunLo = pemetaan?.akun_lo || (pemetaan?.perlakuan === 'persediaan' ? '1.1.12.01.01.0001' : cermin.kode);
      const akunLra = pemetaan?.akun_lra || e.kode_rekening;
      const kode = pemetaan?.perlakuan === 'persediaan' ? 'PERSEDIAAN' : cermin.perlakuan === 'aset' ? 'BELANJA_MODAL' : 'BELANJA_OPERASI';
      return jadi(kode, [baris('LO', akunLo, nilai, 0), baris('LO', kas, 0, nilai), baris('LRA', akunLra, nilai, 0), baris('LRA', AKUN.PERUBAHAN_SAL, 0, nilai)]);
    }
    case 'PAJAK_PUNGUT':
      if (!masuk) return telaah('Pungutan pajak tercatat sebagai pengeluaran');
      return jadi('PUNGUT_PAJAK', [baris('LO', kas, nilai, 0), baris('LO', AKUN.UTANG_PFK[e.pajak_jenis] || AKUN.UTANG_PFK.LAIN, 0, nilai)]);
    case 'PAJAK_SETOR':
      if (!keluar) return telaah('Setoran pajak tercatat sebagai penerimaan');
      return jadi('SETOR_PAJAK', [baris('LO', AKUN.UTANG_PFK[e.pajak_jenis] || AKUN.UTANG_PFK.LAIN, nilai, 0), baris('LO', kas, 0, nilai)]);
    case 'PENERIMAAN': {
      if (!masuk) return telaah('Penerimaan bernilai keluar');
      if (!e.kode_rekening || !/^4\./.test(e.kode_rekening)) return telaah('Penerimaan tanpa kode pendapatan (mis. jasa giro, pengembalian belanja): perlakuan bergantung kebijakan penyetoran ke RKUD');
      const lo = pemetaan?.akun_lo || akunCermin(e.kode_rekening).kode;
      return jadi('PENDAPATAN', [baris('LO', kas, nilai, 0), baris('LO', lo, 0, nilai), baris('LRA', AKUN.PERUBAHAN_SAL, nilai, 0), baris('LRA', pemetaan?.akun_lra || e.kode_rekening, 0, nilai)]);
    }
    case 'PENYETORAN':
      if (!keluar) return telaah('Penyetoran bernilai masuk');
      return jadi('SETOR_KASDA', [baris('LO', AKUN.RK_PPKD, nilai, 0), baris('LO', kas, 0, nilai)]);
    case 'PELIMPAHAN':
      return jadi('PELIMPAHAN', masuk ? [baris('LO', kas, nilai, 0), baris('LO', AKUN.KAS_ANTARA, 0, nilai)] : [baris('LO', AKUN.KAS_ANTARA, nilai, 0), baris('LO', kas, 0, nilai)]);
    case 'KOREKSI':
      return { status: 'balik', aturan: 'KOREKSI', dasar: aturan('KOREKSI').dasar, baris: [] };
    case 'SALDO_AWAL':
      return telaah('Saldo awal kas dibukukan melalui jurnal saldo awal (neraca awal) oleh PPK-SKPD');
    default:
      return telaah('Jenis transaksi "lainnya" memerlukan penentuan akun secara manual');
  }
}

/** Periksa keseimbangan baris jurnal per basis. */
export function cekSeimbang(rows) {
  const per = {};
  for (const r of rows) {
    const p = (per[r.basis] ||= { debit: 0, kredit: 0 });
    p.debit = r2(p.debit + Number(r.debit || 0)); p.kredit = r2(p.kredit + Number(r.kredit || 0));
  }
  const tidak = Object.entries(per).filter(([, v]) => Math.abs(v.debit - v.kredit) >= 0.005).map(([b, v]) => `${b}: debit ${v.debit.toLocaleString('id-ID')} ≠ kredit ${v.kredit.toLocaleString('id-ID')}`);
  return { seimbang: !tidak.length && rows.length > 0, per_basis: per, masalah: tidak };
}

/** Balik baris jurnal (debit <-> kredit). */
export const balikBaris = (rows) => rows.map((r) => ({ ...r, debit: r.kredit, kredit: r.debit }));
