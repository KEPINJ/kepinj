import {
  LayoutDashboard, BookOpen, Calculator, FileSpreadsheet, Upload, Landmark, ShieldCheck, Users, Database, Receipt,
  Wallet, BarChart3, Printer, ScrollText, Lock, Plus, FileCheck2, BookCopy, ShieldAlert,
} from 'lucide-react';

// Struktur menu tunggal: dipakai sidebar, pencarian cepat (Ctrl+K) dan navigasi bawah di ponsel.
export const NAV = [
  { group: 'Utama', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, keywords: 'beranda ringkasan' },
    { to: '/peringatan', label: 'Peringatan Anomali', icon: ShieldAlert, keywords: 'duplikat ganda kas tunai pagu anomali temuan' },
  ] },
  { group: 'Kas & BKU', items: [
    { to: '/bku', label: 'Buku Kas Umum', icon: BookOpen, keywords: 'transaksi kas umum belanja penerimaan sp2d' },
    { to: '/penutupan-kas', label: 'Penutupan Kas', icon: Wallet, keywords: 'hitung fisik uang brankas' },
    { to: '/rekonsiliasi', label: 'Rekonsiliasi Bank', icon: Landmark, keywords: 'rekening koran mutasi bank cocokkan' },
    { to: '/tutup-buku', label: 'Tutup Buku', icon: Lock, keywords: 'kunci bulan periode spj' },
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
];

export const allNavItems = (can) => NAV.flatMap((g) => g.items.filter((i) => !i.roles || can(...i.roles)).map((i) => ({ ...i, group: g.group })));
