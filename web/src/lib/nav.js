import {
  LayoutDashboard, BookOpen, Calculator, FileSpreadsheet, Upload, Landmark, ShieldCheck, Users, Database, Receipt,
  Wallet, BarChart3, Printer, ScrollText, Lock, Plus, FileCheck2, BookCopy, ShieldAlert, FileStack, HandCoins, Crown, PiggyBank, Network, CalendarCheck2,
} from 'lucide-react';

// Struktur menu tunggal: dipakai sidebar, pencarian cepat (Ctrl+K) dan navigasi bawah di ponsel.
export const NAV = [
  { group: 'Utama', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, keywords: 'beranda ringkasan' },
    { to: '/peringatan', label: 'Peringatan Anomali', icon: ShieldAlert, keywords: 'duplikat ganda kas tunai pagu anomali temuan' },
    { to: '/laporan-pimpinan', label: 'Laporan Pimpinan', icon: Crown, roles: ['admin', 'pimpinan'], keywords: 'peringkat kinerja seluruh skpd serapan kepala daerah' },
  ] },
  { group: 'Kas & BKU', items: [
    { to: '/bku', label: 'Buku Kas Umum', icon: BookOpen, keywords: 'transaksi kas umum belanja penerimaan sp2d' },
    { to: '/spp', label: 'SPP · SPM · SP2D', icon: FileStack, keywords: 'pengajuan up gu tu ls gaji barang pencairan' },
    { to: '/penerimaan', label: 'Bendahara Penerimaan', icon: PiggyBank, keywords: 'retribusi pendapatan sts setoran kas daerah target' },
    { to: '/pembantu', label: 'Bendahara Pembantu', icon: Network, keywords: 'pelimpahan up unit kerja upt bidang spj pembantu' },
    { to: '/panjar', label: 'Panjar Kegiatan', icon: HandCoins, keywords: 'uang muka pptk pelaksana pertanggungjawaban' },
    { to: '/penutupan-kas', label: 'Penutupan Kas', icon: Wallet, keywords: 'hitung fisik uang brankas' },
    { to: '/rekonsiliasi', label: 'Rekonsiliasi Bank', icon: Landmark, keywords: 'rekening koran mutasi bank cocokkan' },
    { to: '/tutup-buku', label: 'Tutup Buku', icon: Lock, keywords: 'kunci bulan periode spj' },
    { to: '/tutup-tahun', label: 'Tutup Tahun Anggaran', icon: CalendarCheck2, keywords: 'akhir tahun lpj sisa up saldo awal desember' },
  ] },
  { group: 'Perpajakan', items: [
    { to: '/pajak/kalkulator', label: 'Kalkulator Pajak', icon: Calculator, keywords: 'pph21 ter ppn pph22 pph23 hitung' },
    { to: '/pajak/register', label: 'Register Pajak', icon: Receipt, keywords: 'setor ntpn billing lapor jatuh tempo' },
    { to: '/pajak/coretax', label: 'Ekspor Coretax', icon: FileSpreadsheet, keywords: 'xml bukti potong djp bppu bp21 bpmp' },
  ] },
  { group: 'Anggaran & Laporan', items: [
    { to: '/spj', label: 'SPJ Bendahara', icon: FileCheck2, keywords: 'pertanggungjawaban fungsional administratif laporan bulanan' },
    { to: '/buku-pembantu', label: 'Buku Pembantu', icon: BookCopy, keywords: 'kas tunai bank rincian objek up gu tu' },
    { to: '/realisasi', label: 'Realisasi Anggaran', icon: BarChart3, keywords: 'pagu dpa serapan' },
    { to: '/laporan', label: 'Cetak Laporan', icon: Printer, keywords: 'print pdf excel' },
  ] },
  { group: 'Data', items: [
    { to: '/olah-data', label: 'Upload & Olah Data', icon: Upload, keywords: 'excel csv impor rumus' },
    { to: '/master', label: 'Data Master', icon: Database, keywords: 'rekanan pegawai rekening anggaran skpd objek pajak' },
  ] },
  { group: 'Sistem', items: [
    { to: '/sistem', label: 'Integritas & Sistem', icon: ShieldCheck, keywords: 'hash kafka verifikasi rantai' },
    { to: '/audit', label: 'Jejak Audit', icon: ScrollText, roles: ['admin', 'pimpinan', 'verifikator'], keywords: 'log aktivitas' },
    { to: '/pengguna', label: 'Pengguna', icon: Users, roles: ['admin'], keywords: 'akun user peran password' },
  ] },
];

export const ACTIONS = [
  { to: '/bku?baru=1', label: 'Catat transaksi baru', icon: Plus, roles: ['admin', 'bendahara'], keywords: 'tambah input belanja' },
  { to: '/pajak/kalkulator', label: 'Hitung PPh 21 / PPN', icon: Calculator, keywords: 'kalkulator' },
  { to: '/laporan', label: 'Cetak BKU bulanan', icon: Printer, keywords: 'laporan print' },
  { to: '/spj', label: 'Cetak SPJ fungsional bulan ini', icon: FileCheck2, keywords: 'laporan pertanggungjawaban' },
  { to: '/spp?baru=GU', label: 'Ajukan SPP-GU', icon: FileStack, roles: ['admin', 'bendahara'], keywords: 'ganti uang pengajuan' },
  { to: '/penerimaan?baru=1', label: 'Catat penerimaan / retribusi', icon: PiggyBank, roles: ['admin', 'bendahara_penerimaan'], keywords: 'pendapatan tbp' },
  { to: '/penerimaan?tab=sts', label: 'Buat STS setoran ke kas daerah', icon: PiggyBank, roles: ['admin', 'bendahara_penerimaan'], keywords: 'surat tanda setoran' },
  { to: '/pembantu?tab=spj', label: 'Sahkan SPJ bendahara pembantu', icon: Network, roles: ['admin', 'bendahara'], keywords: 'pengesahan unit' },
  { to: '/panjar', label: 'Beri / pertanggungjawabkan panjar', icon: HandCoins, roles: ['admin', 'bendahara'], keywords: 'uang muka' },
];

export const allNavItems = (can) => NAV.flatMap((g) => g.items.filter((i) => !i.roles || can(...i.roles)).map((i) => ({ ...i, group: g.group })));
