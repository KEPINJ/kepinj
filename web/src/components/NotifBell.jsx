import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, AlertOctagon, AlertTriangle, Info, CheckCircle2, CheckCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { cx } from './ui.jsx';

export const TINGKAT = {
  bahaya: [AlertOctagon, 'text-rose-600 bg-rose-50'],
  peringatan: [AlertTriangle, 'text-amber-700 bg-amber-50'],
  info: [Info, 'text-brand-700 bg-brand-50'],
};

/** Lonceng notifikasi: status baca disimpan di server per pengguna, dikelompokkan per kategori. */
export default function NotifBell() {
  const { skpdId, tahun } = useApp();
  const nav = useNavigate();
  const [data, setData] = useState({ items: [], belum_dibaca: 0, per_kategori: {}, kategori: {} });
  const [open, setOpen] = useState(false);
  const [kat, setKat] = useState('');
  const ref = useRef(null);

  const load = () => skpdId && api.latar('/api/notifikasi', { skpd_id: skpdId, tahun }).then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skpdId, tahun]);
  useLive(() => load(), 1500);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const baca = async (kunci) => {
    setData((d) => ({ ...d, items: d.items.map((i) => (kunci.includes(i.kunci) ? { ...i, dibaca: true } : i)), belum_dibaca: Math.max(0, d.belum_dibaca - d.items.filter((i) => kunci.includes(i.kunci) && !i.dibaca).length) }));
    await api.post('/api/notifikasi/baca', { kunci }).catch(() => {});
  };
  const bacaSemua = async () => { await api.post('/api/notifikasi/baca-semua', { skpd_id: skpdId, tahun }).catch(() => {}); load(); };
  const items = data.items.filter((i) => !kat || i.kategori === kat);
  const kategoriAda = Object.entries(data.per_kategori || {}).filter(([, n]) => n > 0);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Notifikasi (${data.belum_dibaca} belum dibaca)`} className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
        <Bell className="h-[18px] w-[18px]" />
        {data.belum_dibaca > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-surface">{data.belum_dibaca > 9 ? '9+' : data.belum_dibaca}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(400px,calc(100vw-2rem))] animate-fade-in overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">Notifikasi <span className="ml-1 text-[11px] font-normal text-slate-500">{data.belum_dibaca} belum dibaca</span></p>
            {data.belum_dibaca > 0 && <button type="button" onClick={bacaSemua} className="flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline"><CheckCheck className="h-3.5 w-3.5" />Tandai semua dibaca</button>}
          </div>
          {kategoriAda.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2">
              <button type="button" onClick={() => setKat('')} className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[11px]', !kat ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600')}>Semua</button>
              {kategoriAda.map(([k, n]) => <button key={k} type="button" onClick={() => setKat(k)} className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[11px]', kat === k ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600')}>{data.kategori[k] || k} · {n}</button>)}
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length ? items.slice(0, 30).map((n) => {
              const [Icon, tone] = TINGKAT[n.tingkat] || TINGKAT.info;
              return (
                <button key={n.kunci} type="button" onClick={() => { baca([n.kunci]); setOpen(false); n.link && nav(n.link); }}
                  className={cx('flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-0 hover:bg-slate-50', !n.dibaca && 'bg-brand-50/40')}>
                  <span className={cx('mt-0.5 rounded-lg p-1.5', tone)}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">{data.kategori[n.kategori] || n.kategori}{!n.dibaca && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}</span>
                    <span className={cx('block text-[13px] leading-snug text-slate-800', !n.dibaca && 'font-semibold')}>{n.judul}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{n.pesan}</span>
                  </span>
                </button>
              );
            }) : (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <p className="text-sm font-medium text-slate-700">Semua beres</p>
                <p className="text-xs text-slate-500">Tidak ada tugas atau peringatan yang tertunda.</p>
              </div>
            )}
          </div>
          <Link to="/notifikasi" onClick={() => setOpen(false)} className="block border-t border-slate-100 py-2.5 text-center text-xs font-medium text-brand-700 hover:bg-slate-50">Lihat semua notifikasi</Link>
        </div>
      )}
    </div>
  );
}
