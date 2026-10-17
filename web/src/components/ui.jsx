import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle, Info, Inbox, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { money, parseRp } from '../lib/format.js';

export const cx = (...a) => a.filter(Boolean).join(' ');

const BTN = {
  primary: 'bg-brand-800 text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
  gold: 'bg-gold-400 text-brand-950 hover:bg-gold-500 shadow-sm',
};
export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, className, children, ...p }) {
  const sz = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : size === 'lg' ? 'px-5 py-2.5 text-sm' : 'px-3.5 py-2 text-sm';
  return (
    <button className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50', BTN[variant], sz, className)} disabled={loading || p.disabled} {...p}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
      {children}
    </button>
  );
}

export function Card({ title, subtitle, actions, children, className, bodyClass = 'p-4' }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-rose-600">{error}</span>}
    </label>
  );
}

export const Input = ({ className, ...p }) => <input className={cx('input', className)} {...p} />;
export const Textarea = ({ className, ...p }) => <textarea className={cx('input min-h-[72px]', className)} {...p} />;
export function Select({ options = [], placeholder, className, ...p }) {
  return (
    <select className={cx('input pr-8', className)} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'object' ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o} value={o}>{o}</option>))}
    </select>
  );
}

/** Input rupiah: tampil berformat ribuan, nilai number. */
export function MoneyInput({ value, onChange, className, ...p }) {
  const [text, setText] = useState(value ? money(value).replace(/,00$/, '') : '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value ? money(value).replace(/,00$/, '') : ''); }, [value]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Rp</span>
      <input
        inputMode="decimal" className={cx('input num pl-9 text-right', className)} value={text} {...p}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(value ? money(value).replace(/,00$/, '') : ''); }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d,]/g, '');
          const [i, d] = raw.split(',');
          const formatted = (i ? Number(i).toLocaleString('id-ID') : '') + (d !== undefined ? `,${d.slice(0, 2)}` : '');
          setText(formatted);
          onChange(parseRp(formatted));
        }}
      />
    </div>
  );
}

const BADGE = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-200', violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};
export const Badge = ({ color = 'slate', children, className }) => (
  <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', BADGE[color], className)}>{children}</span>
);

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size];
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('w-full rounded-2xl bg-white shadow-2xl', w)}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Tutup"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone = 'brand', trend }) {
  const tones = { brand: 'bg-brand-50 text-brand-700', green: 'bg-emerald-50 text-emerald-700', red: 'bg-rose-50 text-rose-700', amber: 'bg-amber-50 text-amber-700', violet: 'bg-violet-50 text-violet-700' };
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="num mt-1 truncate text-xl font-semibold text-slate-900">{value}</p>
          {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
        </div>
        {Icon && <div className={cx('rounded-xl p-2.5', tones[tone])}><Icon className="h-5 w-5" /></div>}
      </div>
      {trend}
    </div>
  );
}

export const Spinner = ({ className }) => <Loader2 className={cx('h-5 w-5 animate-spin text-brand-600', className)} />;
export const Loading = ({ text = 'Memuat data…' }) => <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Spinner />{text}</div>;

export function Empty({ title = 'Belum ada data', text, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="rounded-2xl bg-slate-100 p-3 text-slate-400"><Icon className="h-6 w-6" /></div>
      <p className="mt-3 text-sm font-medium text-slate-700">{title}</p>
      {text && <p className="mt-1 max-w-md text-xs text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className }) {
  const t = { info: ['border-brand-200 bg-brand-50 text-brand-900', Info], warn: ['border-amber-200 bg-amber-50 text-amber-900', AlertTriangle], error: ['border-rose-200 bg-rose-50 text-rose-900', AlertTriangle], ok: ['border-emerald-200 bg-emerald-50 text-emerald-900', CheckCircle2] }[tone];
  const Icon = t[1];
  return (
    <div className={cx('flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm', t[0], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{title && <p className="font-semibold">{title}</p>}<div className={title ? 'mt-0.5 text-[13px] opacity-90' : ''}>{children}</div></div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1', className)}>
      {tabs.map((t) => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)}
          className={cx('flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition', value === t.value ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
          {t.icon && <t.icon className="h-4 w-4" />}{t.label}
          {t.count != null && <span className="rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-700">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Cari…', className }) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input className="input pl-9" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-500">
      <span>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} dari ${total.toLocaleString('id-ID')}` : '0 data'}</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onChange(page - 1)} />
        <span>Hal. {page} / {pages}</span>
        <Button variant="ghost" size="sm" icon={ChevronRight} disabled={page >= pages} onClick={() => onChange(page + 1)} />
      </div>
    </div>
  );
}

/** Pilihan dengan pencarian (untuk kode rekening, rekanan, dsb). */
export function Combo({ value, onChange, options, placeholder = 'Pilih…', render, className }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const sel = options.find((o) => String(o.value) === String(value));
  const filtered = useMemo(() => options.filter((o) => `${o.label} ${o.value} ${o.hint || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 100), [options, q]);
  return (
    <div className={cx('relative', className)} ref={ref}>
      <button type="button" className="input flex items-center justify-between text-left" onClick={(e) => { e.preventDefault(); setOpen(!open); }}>
        <span className={cx('truncate', !sel && 'text-slate-400')}>{sel ? (render ? render(sel) : sel.label) : placeholder}</span>
        {sel && <X className="ml-2 h-3.5 w-3.5 shrink-0 text-slate-400 hover:text-slate-600" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(''); }} />}
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[280px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <input autoFocus className="input mb-1" placeholder="Ketik untuk mencari…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 overflow-y-auto">
            {filtered.map((o) => (
              <button type="button" key={o.value} onClick={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); setQ(''); }}
                className={cx('block w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-brand-50', String(o.value) === String(value) && 'bg-brand-50')}>
                {render ? render(o) : o.label}
                {o.hint && <span className="block text-[11px] text-slate-500">{o.hint}</span>}
              </button>
            ))}
            {!filtered.length && <p className="px-2.5 py-3 text-xs text-slate-500">Tidak ditemukan</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Toast ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, tone = 'ok', ms = 4500) => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x.slice(-4), { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-xl border bg-white px-3.5 py-3 text-sm shadow-lg',
            t.tone === 'error' ? 'border-rose-200' : t.tone === 'info' ? 'border-brand-200' : 'border-emerald-200')}>
            {t.tone === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /> : t.tone === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
            <span className="text-slate-700">{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {Icon && <div className="hidden rounded-xl bg-brand-800 p-2.5 text-gold-400 sm:block"><Icon className="h-5 w-5" /></div>}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Progress({ value, className }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const color = value > 100 ? 'bg-rose-500' : value > 85 ? 'bg-amber-500' : 'bg-emerald-500';
  return <div className={cx('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)}><div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${v}%` }} /></div>;
}

/** Hook pemuat data sederhana dengan reload. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1), setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}
