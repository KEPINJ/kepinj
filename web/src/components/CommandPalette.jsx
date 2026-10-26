import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, FileText, Zap } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { allNavItems, ACTIONS } from '../lib/nav.js';
import { rp, tgl } from '../lib/format.js';
import { cx } from './ui.jsx';

const norm = (s) => String(s || '').toLowerCase();

/** Pencarian cepat (Ctrl+K): pindah halaman, jalankan aksi, atau temukan transaksi BKU. */
export default function CommandPalette({ open, onClose }) {
  const { can, skpdId, tahun } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [trx, setTrx] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => { if (open) { setQ(''); setIdx(0); setTrx([]); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);

  // Cari transaksi BKU (minimal 3 huruf)
  useEffect(() => {
    if (!open || q.trim().length < 3 || !skpdId) { setTrx([]); return undefined; }
    const t = setTimeout(() => {
      api.get('/api/bku', { skpd_id: skpdId, tahun, q: q.trim(), pageSize: 6 }).then((r) => setTrx(r.rows)).catch(() => setTrx([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, skpdId, tahun]);

  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const match = (i) => words.every((w) => norm(`${i.label} ${i.group || ''} ${i.keywords || ''}`).includes(w));
    const pages = allNavItems(can).filter(match).map((i) => ({ ...i, kind: 'Halaman' }));
    const actions = ACTIONS.filter((a) => !a.roles || can(...a.roles)).filter(match).map((a) => ({ ...a, kind: 'Aksi' }));
    const tx = trx.map((t) => ({
      kind: 'Transaksi', to: `/bku?cari=${encodeURIComponent(t.no_bukti)}&id=${t.id}&bulan=${Number(t.tanggal.slice(5, 7))}`, icon: FileText,
      label: t.uraian, sub: `No. ${t.no_urut} · ${tgl(t.tanggal)} · ${t.no_bukti} · ${rp(Number(t.penerimaan) || Number(t.pengeluaran))}`,
    }));
    return [...actions, ...pages, ...tx];
  }, [q, trx, can]);

  useEffect(() => { setIdx(0); }, [q]);
  if (!open) return null;

  const go = (r) => { if (!r) return; onClose(); nav(r.to); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); go(results[idx]); }
    if (e.key === 'Escape') onClose();
  };

  let lastKind = null;
  return (
    <div className="no-print fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl animate-fade-in overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-2xl" role="dialog" aria-label="Pencarian cepat">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Search className="h-5 w-5 text-slate-400" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Cari menu, aksi, atau transaksi (no. bukti / uraian)…" className="h-14 flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400" />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">Esc</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {results.map((r, i) => {
            const header = r.kind !== lastKind ? r.kind : null;
            lastKind = r.kind;
            const Icon = r.icon || Zap;
            return (
              <div key={`${r.kind}-${r.to}-${i}`}>
                {header && <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{header}</p>}
                <button type="button" onMouseEnter={() => setIdx(i)} onClick={() => go(r)}
                  className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', i === idx ? 'bg-brand-50 text-brand-800' : 'text-slate-700')}>
                  <span className={cx('rounded-lg p-1.5', i === idx ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.label}</span>
                    {(r.sub || r.group) && <span className="block truncate text-[11px] text-slate-500">{r.sub || r.group}</span>}
                  </span>
                  {i === idx && <CornerDownLeft className="h-4 w-4 text-slate-400" />}
                </button>
              </div>
            );
          })}
          {!results.length && <p className="px-3 py-8 text-center text-sm text-slate-500">Tidak ada yang cocok dengan “{q}”.</p>}
        </div>
        <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
          <span>↑↓ pilih</span><span>Enter buka</span><span>Ketik ≥3 huruf untuk mencari transaksi</span>
        </div>
      </div>
    </div>
  );
}
