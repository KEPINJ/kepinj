import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

const AppCtx = createContext(null);
export const EVENT_TYPES = ['bku.entry.created', 'bku.verified', 'pajak.created', 'pajak.disetor', 'periode.dikunci', 'periode.dibuka',
  'spp.updated', 'panjar.updated', 'lampiran.updated', 'penerimaan.updated', 'pembantu.updated'];
export const useApp = () => useContext(AppCtx);

const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } },
};

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [skpdList, setSkpdList] = useState([]);
  const [skpdId, setSkpdIdState] = useState(store.get('bku.skpd', null));
  const [tahun, setTahunState] = useState(store.get('bku.tahun', new Date().getFullYear()));
  const [live, setLive] = useState({ connected: false, mode: null, last: null });
  const [theme, setThemeState] = useState(store.get('bku.theme', 'light'));
  const listeners = useRef(new Set());

  const loadMe = useCallback(async () => {
    try { const { user: u } = await api.get('/api/auth/me'); setUser(u || null); } catch { setUser(null); }
  }, []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener('bku:unauthorized', h);
    return () => window.removeEventListener('bku:unauthorized', h);
  }, []);

  useEffect(() => {
    if (!user) return;
    api.get('/api/master/skpd').then(({ rows }) => {
      setSkpdList(rows);
      const ok = rows.some((r) => r.id === skpdId) && ['admin', 'pimpinan'].includes(user.role);
      if (!ok) setSkpdIdState(user.skpd_id ?? rows[0]?.id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Tema terang / gelap / ikuti sistem
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches));
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // Realtime: Server-Sent Events dari pipeline Kafka
  useEffect(() => {
    if (!user) return undefined;
    let es; let retry;
    const connect = () => {
      es = new EventSource('/api/stream', { withCredentials: true });
      es.addEventListener('hello', (e) => setLive((l) => ({ ...l, connected: true, mode: JSON.parse(e.data).mode })));
      const onEvt = (e) => {
        const evt = JSON.parse(e.data);
        setLive((l) => ({ ...l, last: evt }));
        listeners.current.forEach((fn) => fn(evt));
      };
      EVENT_TYPES.forEach((t) => es.addEventListener(t, onEvt));
      es.onerror = () => { setLive((l) => ({ ...l, connected: false })); es.close(); retry = setTimeout(connect, 4000); };
    };
    connect();
    return () => { clearTimeout(retry); es?.close(); };
  }, [user]);

  const value = useMemo(() => ({
    user, setUser, reloadMe: loadMe, skpdList, tahun, live, theme,
    setTheme: (t) => { setThemeState(t); store.set('bku.theme', t); },
    skpdId,
    skpd: skpdList.find((s) => s.id === skpdId),
    setSkpdId: (v) => { setSkpdIdState(Number(v)); store.set('bku.skpd', Number(v)); },
    setTahun: (v) => { setTahunState(Number(v)); store.set('bku.tahun', Number(v)); },
    can: (...roles) => user && roles.includes(user.role),
    subscribe: (fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn); },
    logout: async () => { await api.post('/api/auth/logout').catch(() => {}); setUser(null); },
  }), [user, skpdList, skpdId, tahun, live, loadMe, theme]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Jalankan callback setiap ada event realtime (dengan debounce agar impor besar tidak memicu ratusan reload). */
export function useLive(fn, delay = 400) {
  const { subscribe } = useApp();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let t;
    const off = subscribe((evt) => { clearTimeout(t); t = setTimeout(() => ref.current(evt), delay); });
    return () => { clearTimeout(t); off(); };
  }, [subscribe, delay]);
}
