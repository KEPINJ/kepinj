import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, X, LogOut, Radio, KeyRound, ChevronDown, Search, Sun, Moon, Monitor, LayoutDashboard, BookOpen, Plus, Receipt } from 'lucide-react';
import { useApp, useLive } from '../lib/ctx.jsx';
import { cx, useToast, Select } from './ui.jsx';
import { ROLE, rp } from '../lib/format.js';
import { NAV } from '../lib/nav.js';
import GantiPassword from './GantiPassword.jsx';
import NotifBell from './NotifBell.jsx';
import CommandPalette from './CommandPalette.jsx';

const EVT_TEXT = {
  'bku.entry.created': (d) => (d.bulk ? `${d.count} transaksi diimpor oleh ${d.user}` : `${d.user} mencatat: ${d.uraian?.slice(0, 60)} (${rp(Number(d.penerimaan) || Number(d.pengeluaran))})`),
  'bku.verified': (d) => `${d.user} ${d.status === 'ditolak' ? 'menolak' : 'memverifikasi'} ${d.ids.length} transaksi`,
  'pajak.disetor': (d) => `Pajak ${rp(d.total)} disetor (NTPN ${d.ntpn})`,
  'periode.dikunci': (d) => `${d.user} menutup buku periode ${d.bulan}/${d.tahun}`,
  'periode.dibuka': (d) => `${d.user} membuka kunci periode ${d.bulan}/${d.tahun}`,
};

const THEMES = [
  { value: 'light', label: 'Mode terang', icon: Sun },
  { value: 'dark', label: 'Mode gelap', icon: Moon },
  { value: 'system', label: 'Ikuti sistem', icon: Monitor },
];

const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } },
};

export default function Layout() {
  const { user, logout, skpdList, skpdId, setSkpdId, tahun, setTahun, live, can, theme, setTheme } = useApp();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(() => store.get('bku.nav.collapsed', {}));
  const loc = useLocation();
  const toast = useToast();
  useEffect(() => setOpen(false), [loc.pathname]);
  useLive((evt) => {
    const f = EVT_TEXT[evt.type];
    if (f && evt.data?.user !== user.full_name) toast(f(evt.data), 'info');
  }, 50);
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const toggleGroup = (g) => setCollapsed((c) => { const n = { ...c, [g]: !c[g] }; store.set('bku.nav.collapsed', n); return n; });

  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i);
  const ThemeIcon = THEMES.find((t) => t.value === theme)?.icon || Sun;
  const nextTheme = THEMES[(THEMES.findIndex((t) => t.value === theme) + 1) % THEMES.length];
  const initials = user.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('');

  const sidebar = (
    <nav className="relative flex h-full flex-col">
      <div className="pointer-events-none absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '18px 18px' }} />
      <div className="relative flex items-center gap-3 px-5 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-500 text-sm font-black text-brand-950 shadow-lg shadow-black/20">BKU</div>
        <div className="leading-tight">
          <p className="text-sm font-bold text-white">Buku Kas Umum</p>
          <p className="text-[11px] text-white/60">Badan Keuangan & Aset Daerah</p>
        </div>
      </div>
      <div className="relative px-3 pb-3">
        <button type="button" onClick={() => setPalette(true)} className="flex w-full items-center gap-2 rounded-lg bg-white/[.07] px-3 py-2 text-left text-xs text-white/60 ring-1 ring-inset ring-white/10 transition hover:bg-white/10 hover:text-white">
          <Search className="h-3.5 w-3.5" /><span className="flex-1">Cari menu / transaksi</span>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans text-[10px]">Ctrl K</kbd>
        </button>
      </div>
      <div className="relative flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.roles || can(...i.roles));
          if (!items.length) return null;
          const active = items.some((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)));
          const isCollapsed = collapsed[g.group] && !active;
          return (
            <div key={g.group} className="pt-2">
              <button type="button" onClick={() => toggleGroup(g.group)} className="flex w-full items-center justify-between px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45 hover:text-white/70">
                {g.group}<ChevronDown className={cx('h-3 w-3 transition', isCollapsed && '-rotate-90')} />
              </button>
              {!isCollapsed && items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end}
                  className={({ isActive }) => cx('group relative mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition',
                    isActive ? 'bg-white/[.12] font-semibold text-white' : 'text-white/70 hover:bg-white/[.06] hover:text-white')}>
                  {({ isActive }) => (<>
                    {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-gold-400" />}
                    <i.icon className={cx('h-4 w-4', isActive ? 'text-gold-400' : 'text-white/55 group-hover:text-white/80')} />{i.label}
                  </>)}
                </NavLink>
              ))}
            </div>
          );
        })}
      </div>
      <div className="relative border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-white/[.05] px-2 py-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-semibold text-white">{initials}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-semibold text-white">{user.full_name}</p>
            <p className="text-[11px] text-white/55">{ROLE[user.role]}</p>
          </div>
          <button type="button" title="Ganti password" onClick={() => setPw(true)} className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"><KeyRound className="h-4 w-4" /></button>
          <button type="button" title="Keluar" onClick={logout} className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </nav>
  );

  const sideBg = 'bg-gradient-to-b from-brand-900 via-brand-950 to-[#04101b]';
  return (
    <div className="min-h-screen">
      <aside className={cx('no-print fixed inset-y-0 left-0 z-30 hidden w-64 lg:block', sideBg)}>{sidebar}</aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className={cx('absolute inset-y-0 left-0 w-72 animate-fade-in', sideBg)}>
            <button type="button" className="absolute right-3 top-5 z-10 text-white/70" onClick={() => setOpen(false)} aria-label="Tutup menu"><X className="h-5 w-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white/90 px-4 py-2.5 backdrop-blur-md sm:px-6">
          <button type="button" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Buka menu"><Menu className="h-5 w-5" /></button>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {can('admin', 'pimpinan') ? (
              <Select className="!w-auto max-w-[min(420px,100%)] !py-1.5" value={skpdId || ''} onChange={(e) => setSkpdId(e.target.value)}
                options={skpdList.map((s) => ({ value: s.id, label: `${s.nama}` }))} />
            ) : (
              <span className="truncate text-sm font-semibold text-slate-700">{skpdList.find((s) => s.id === skpdId)?.nama}</span>
            )}
            <Select className="!w-auto !py-1.5" value={tahun} onChange={(e) => setTahun(e.target.value)} options={years.map((y) => ({ value: y, label: `TA ${y}` }))} />
          </div>
          <button type="button" onClick={() => setPalette(true)} className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500 transition hover:border-slate-300 hover:text-slate-700 md:flex">
            <Search className="h-3.5 w-3.5" />Cari…<kbd className="rounded border border-slate-200 bg-surface px-1 font-sans text-[10px]">Ctrl K</kbd>
          </button>
          <div title={live.connected ? `Terhubung ke event stream (${live.mode === 'kafka' ? 'Apache Kafka' : 'bus internal'})` : 'Realtime terputus, mencoba menyambung ulang…'}
            className={cx('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:flex', live.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
            <Radio className={cx('h-3.5 w-3.5', live.connected && 'animate-pulse')} />
            {live.connected ? `Realtime${live.mode === 'kafka' ? ' · Kafka' : ''}` : 'Offline'}
          </div>
          <button type="button" onClick={() => setTheme(nextTheme.value)} title={`${THEMES.find((t) => t.value === theme)?.label} · klik: ${nextTheme.label}`} aria-label="Ganti tema"
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"><ThemeIcon className="h-[18px] w-[18px]" /></button>
          <NotifBell />
        </header>
        <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-6 sm:px-6 lg:pb-8"><Outlet /></main>
      </div>
      <MobileNav onMenu={() => setOpen(true)} canWrite={can('admin', 'bendahara')} />
      <GantiPassword open={pw} onClose={() => setPw(false)} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

/** Navigasi bawah untuk layar ponsel. */
function MobileNav({ onMenu, canWrite }) {
  const item = 'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium';
  const cls = ({ isActive }) => cx(item, isActive ? 'text-brand-700' : 'text-slate-500');
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex items-end border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <NavLink to="/" end className={cls}><LayoutDashboard className="h-5 w-5" />Beranda</NavLink>
      <NavLink to="/bku" className={cls}><BookOpen className="h-5 w-5" />BKU</NavLink>
      {canWrite ? (
        <Link to="/bku?baru=1" className={cx(item, 'text-slate-600')} aria-label="Catat transaksi">
          <span className="-mt-6 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-lift ring-4 ring-page"><Plus className="h-6 w-6" /></span>Catat
        </Link>
      ) : null}
      <NavLink to="/pajak/register" className={cls}><Receipt className="h-5 w-5" />Pajak</NavLink>
      <button type="button" onClick={onMenu} className={cx(item, 'text-slate-500')}><Menu className="h-5 w-5" />Menu</button>
    </nav>
  );
}
