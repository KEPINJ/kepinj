import { useEffect, useRef, useState } from 'react';
import { Columns3, Bookmark, BookmarkPlus, X } from 'lucide-react';
import { Button, cx } from './ui.jsx';
import { BULAN } from '../lib/format.js';

// Pengaturan tabel BKU yang diingat per peramban: kolom tampil dan filter tersimpan
const KOLOM = [['no', 'No. urut'], ['tanggal', 'Tanggal'], ['bukti', 'No. bukti'], ['rekening', 'Kode rekening (kolom sendiri)'], ['kas', 'Kas (bank/tunai)'],
  ['penerimaan', 'Penerimaan'], ['pengeluaran', 'Pengeluaran'], ['saldo', 'Saldo']];
const AWAL = { no: true, tanggal: true, bukti: true, rekening: false, kas: false, penerimaan: true, pengeluaran: true, saldo: true };
const baca = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const tulis = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } };

export function useKolom() {
  const [kolom, setKolom] = useState(() => ({ ...AWAL, ...baca('bku.kolom', {}) }));
  return [kolom, (k) => { setKolom(k); tulis('bku.kolom', k); }];
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return { open, setOpen, ref };
}

export function PilihKolom({ kolom, onChange }) {
  const p = usePopover();
  return (
    <div className="relative" ref={p.ref}>
      <Button variant="secondary" icon={Columns3} onClick={() => p.setOpen(!p.open)} className="hidden md:inline-flex">Kolom</Button>
      {p.open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tampilkan kolom</p>
          {KOLOM.map(([k, l]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              <input type="checkbox" checked={!!kolom[k]} onChange={(e) => onChange({ ...kolom, [k]: e.target.checked })} />{l}
            </label>
          ))}
          <button type="button" className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-brand-700 hover:bg-brand-50" onClick={() => onChange(AWAL)}>Kembalikan bawaan</button>
        </div>
      )}
    </div>
  );
}

const ringkas = (f) => [f.bulan && BULAN[f.bulan - 1], f.jenis, f.metode, f.verif && { belum: 'belum verifikasi', diverifikasi: 'terverifikasi', ditolak: 'ditolak' }[f.verif], f.q && `"${f.q}"`].filter(Boolean).join(' · ') || 'Semua transaksi';

export function PresetFilter({ filter, onPilih }) {
  const [preset, setPreset] = useState(() => baca('bku.preset', []));
  const [nama, setNama] = useState(null);
  const simpan = (list) => { setPreset(list); tulis('bku.preset', list); };
  const aktif = JSON.stringify(filter);
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2">
      <Bookmark className="h-3.5 w-3.5 text-slate-400" />
      {preset.map((p, i) => (
        <span key={p.nama} className={cx('inline-flex items-center rounded-full text-xs ring-1 ring-inset', JSON.stringify(p.filter) === aktif ? 'bg-brand-600 text-white ring-brand-600' : 'bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100')}>
          <button type="button" className="py-1 pl-2.5 pr-1" title={ringkas(p.filter)} onClick={() => onPilih(p.filter)}>{p.nama}</button>
          <button type="button" className="rounded-full p-1 opacity-60 hover:opacity-100" aria-label={`Hapus ${p.nama}`} onClick={() => simpan(preset.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
        </span>
      ))}
      {nama === null ? (
        <button type="button" className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-brand-700 hover:bg-brand-50" onClick={() => setNama('')}><BookmarkPlus className="h-3.5 w-3.5" />Simpan filter ini</button>
      ) : (
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (nama.trim()) { simpan([...preset.filter((p) => p.nama !== nama.trim()), { nama: nama.trim(), filter }]); setNama(null); } }}>
          <input autoFocus className="input !h-7 !w-44 !py-0 text-xs" placeholder={ringkas(filter)} value={nama} onChange={(e) => setNama(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNama(null)} />
          <Button size="sm" type="submit">Simpan</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setNama(null)}>Batal</Button>
        </form>
      )}
      {!preset.length && nama === null && <span className="hidden text-[11px] text-slate-400 sm:inline">Simpan kombinasi filter yang sering dipakai, mis. "Belum verifikasi bulan ini".</span>}
    </div>
  );
}
