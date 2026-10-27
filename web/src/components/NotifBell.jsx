import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertOctagon, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { cx } from './ui.jsx';

const TINGKAT = {
  bahaya: [AlertOctagon, 'text-rose-600 bg-rose-50'],
  peringatan: [AlertTriangle, 'text-amber-700 bg-amber-50'],
  info: [Info, 'text-brand-700 bg-brand-50'],
};
const SEEN_KEY = 'bku.notif.seen';
const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []); } catch { return new Set(); } };

/** Lonceng notifikasi: jatuh tempo pajak, tutup buku, verifikasi, panjar, anomali. */
export default function NotifBell() {
  const { skpdId, tahun } = useApp();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const ref = useRef(null);

  const load = () => skpdId && api.get('/api/notifikasi', { skpd_id: skpdId, tahun }).then((r) => setItems(r.items)).catch(() => {});
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

  const unseen = items.filter((i) => !seen.has(i.id)).length;
  const toggle = () => {
    setOpen((o) => !o);
    if (!open && items.length) {
      const s = new Set([...seen, ...items.map((i) => i.id)]);
      setSeen(s);
      try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200))); } catch { /* abaikan */ }
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggle} aria-label={`Notifikasi (${items.length})`} className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
        <Bell className="h-[18px] w-[18px]" />
        {unseen > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-surface">{unseen > 9 ? '9+' : unseen}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(380px,calc(100vw-2rem))] animate-fade-in overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">Notifikasi & pengingat</p>
            <span className="text-[11px] text-slate-500">{items.length} item</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length ? items.map((n) => {
              const [Icon, tone] = TINGKAT[n.tingkat] || TINGKAT.info;
              return (
                <button key={n.id} type="button" onClick={() => { setOpen(false); n.link && nav(n.link); }}
                  className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-0 hover:bg-slate-50">
                  <span className={cx('mt-0.5 rounded-lg p-1.5', tone)}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold leading-snug text-slate-800">{n.judul}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{n.pesan}</span>
                  </span>
                </button>
              );
            }) : (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <p className="text-sm font-medium text-slate-700">Semua beres</p>
                <p className="text-xs text-slate-500">Tidak ada pajak jatuh tempo atau tugas yang tertunda.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
