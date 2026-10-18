import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, BookOpen, Calculator, FileSpreadsheet, Upload, Landmark, ShieldCheck, Users, Database, Receipt,
  Menu, X, LogOut, Wallet, BarChart3, Printer, ScrollText, Radio, KeyRound, FlaskConical,
} from 'lucide-react';
import { useApp, useLive } from '../lib/ctx.jsx';
import { cx, useToast, Select } from './ui.jsx';
import { ROLE, rp } from '../lib/format.js';
import GantiPassword from './GantiPassword.jsx';
import { DEMO, resetDemo } from '../lib/api.js';

const NAV = [
  { group: 'Utama', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  { group: 'Penatausahaan', items: [
    { to: '/bku', label: 'Buku Kas Umum', icon: BookOpen },
    { to: '/penutupan-kas', label: 'Penutupan Kas', icon: Wallet },
    { to: '/rekonsiliasi', label: 'Rekonsiliasi Bank', icon: Landmark },
  ] },
  { group: 'Perpajakan', items: [
    { to: '/pajak/kalkulator', label: 'Kalkulator Pajak', icon: Calculator },
    { to: '/pajak/register', label: 'Register Pajak', icon: Receipt },
    { to: '/pajak/coretax', label: 'Ekspor Coretax', icon: FileSpreadsheet },
  ] },
  { group: 'Olah Data', items: [{ to: '/olah-data', label: 'Upload & Olah Data', icon: Upload }] },
  { group: 'Anggaran & Laporan', items: [
    { to: '/realisasi', label: 'Realisasi Anggaran', icon: BarChart3 },
    { to: '/laporan', label: 'Cetak Laporan', icon: Printer },
  ] },
  { group: 'Pengaturan', items: [
    { to: '/master', label: 'Data Master', icon: Database },
    { to: '/sistem', label: 'Integritas & Sistem', icon: ShieldCheck },
    { to: '/audit', label: 'Jejak Audit', icon: ScrollText, roles: ['admin', 'pimpinan', 'verifikator'] },
    { to: '/pengguna', label: 'Pengguna', icon: Users, roles: ['admin'] },
  ] },
];

const EVT_TEXT = {
  'bku.entry.created': (d) => (d.bulk ? `${d.count} transaksi diimpor oleh ${d.user}` : `${d.user} mencatat: ${d.uraian?.slice(0, 60)} (${rp(Number(d.penerimaan) || Number(d.pengeluaran))})`),
  'bku.verified': (d) => `${d.user} ${d.status === 'ditolak' ? 'menolak' : 'memverifikasi'} ${d.ids.length} transaksi`,
  'pajak.disetor': (d) => `Pajak ${rp(d.total)} disetor (NTPN ${d.ntpn})`,
};

export default function Layout() {
  const { user, logout, skpdList, skpdId, setSkpdId, tahun, setTahun, live, can } = useApp();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const loc = useLocation();
  const toast = useToast();
  useEffect(() => setOpen(false), [loc.pathname]);
  useLive((evt) => {
    const f = EVT_TEXT[evt.type];
    if (f && evt.data?.user !== user.full_name) toast(f(evt.data), 'info');
  }, 50);

  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i);
  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gold-400 text-sm font-black text-brand-950">BKU</div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">Buku Kas Umum</p>
          <p className="text-[11px] text-brand-200">Badan Keuangan & Aset Daerah</p>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.roles || can(...i.roles));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-300/80">{g.group}</p>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end}
                  className={({ isActive }) => cx('mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
                    isActive ? 'bg-white/10 font-medium text-white shadow-inner' : 'text-brand-100/80 hover:bg-white/5 hover:text-white')}>
                  <i.icon className="h-4 w-4" />{i.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{user.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium text-white">{user.full_name}</p>
            <p className="text-[11px] text-brand-200">{ROLE[user.role]}</p>
          </div>
          <button type="button" title="Ganti password" onClick={() => setPw(true)} className="rounded-md p-1.5 text-brand-200 hover:bg-white/10 hover:text-white"><KeyRound className="h-4 w-4" /></button>
          <button type="button" title="Keluar" onClick={logout} className="rounded-md p-1.5 text-brand-200 hover:bg-white/10 hover:text-white"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 bg-gradient-to-b from-brand-900 to-brand-950 lg:block">{sidebar}</aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-gradient-to-b from-brand-900 to-brand-950">
            <button type="button" className="absolute right-3 top-5 text-brand-200" onClick={() => setOpen(false)} aria-label="Tutup menu"><X className="h-5 w-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        {DEMO && (
          <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-6">
            <FlaskConical className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">Mode demo: aplikasi dan database berjalan di browser ini dengan data contoh. Perubahan hanya tersimpan di perangkat Anda.</span>
            <button type="button" className="font-medium underline underline-offset-2 hover:text-amber-700"
              onClick={() => { if (window.confirm('Kembalikan semua data demo ke kondisi awal?')) resetDemo(); }}>Reset data demo</button>
          </div>
        )}
        <header className="no-print sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <button type="button" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Buka menu"><Menu className="h-5 w-5" /></button>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {can('admin', 'pimpinan') ? (
              <Select className="!w-auto max-w-[min(420px,100%)] !py-1.5" value={skpdId || ''} onChange={(e) => setSkpdId(e.target.value)}
                options={skpdList.map((s) => ({ value: s.id, label: `${s.nama}` }))} />
            ) : (
              <span className="truncate text-sm font-medium text-slate-700">{skpdList.find((s) => s.id === skpdId)?.nama}</span>
            )}
            <Select className="!w-auto !py-1.5" value={tahun} onChange={(e) => setTahun(e.target.value)} options={years.map((y) => ({ value: y, label: `TA ${y}` }))} />
          </div>
          <div title={live.connected ? `Terhubung ke event stream (${live.mode === 'kafka' ? 'Apache Kafka' : live.mode === 'demo' ? 'bus di browser' : 'bus internal'})` : 'Realtime terputus, mencoba menyambung ulang…'}
            className={cx('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', live.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
            <Radio className={cx('h-3.5 w-3.5', live.connected && 'animate-pulse')} />
            {live.connected ? `Realtime${live.mode === 'kafka' ? ' · Kafka' : ''}` : 'Offline'}
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6"><Outlet /></main>
      </div>
      <GantiPassword open={pw} onClose={() => setPw(false)} />
    </div>
  );
}
