import { useRef, useState } from 'react';
import { Paperclip, Upload, FileText, Trash2, Download, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Button, Spinner, useLoad, useToast } from './ui.jsx';
import { waktu } from '../lib/format.js';

const ukuran = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

/** Lampiran bukti digital (foto nota/kuitansi, faktur PDF) untuk satu transaksi BKU. */
export default function LampiranBukti({ entryId, onChanged }) {
  const { can } = useApp();
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [lihat, setLihat] = useState(null);
  const { data, reload } = useLoad(() => api.get(`/api/bku/${entryId}/lampiran`), [entryId]);
  const boleh = can('admin', 'bendahara');

  const unggah = async (files) => {
    setBusy(true);
    try {
      for (const f of files) {
        if (f.size > 5 * 1024 * 1024) { toast(`${f.name} melebihi 5 MB`, 'error'); continue; }
        await api.upload(`/api/bku/${entryId}/lampiran`, f);
      }
      toast('Lampiran bukti tersimpan'); reload(); onChanged?.();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const hapus = async (l) => {
    if (!window.confirm(`Hapus lampiran ${l.nama_file}?`)) return;
    try { await api.del(`/api/lampiran/${l.id}`); toast('Lampiran dihapus'); reload(); onChanged?.(); } catch (e) { toast(e.message, 'error'); }
  };
  const rows = data?.rows || [];

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Paperclip className="h-4 w-4 text-brand-700" />Lampiran bukti {rows.length > 0 && `(${rows.length})`}</p>
        {boleh && <>
          <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => e.target.files.length && unggah([...e.target.files])} />
          <Button size="sm" variant="secondary" icon={Upload} loading={busy} onClick={() => input.current?.click()}>Unggah</Button>
        </>}
      </div>
      {!data ? <Spinner className="h-4 w-4" /> : !rows.length ? (
        <p className="text-xs text-slate-500">Belum ada lampiran. {boleh && 'Foto nota, kuitansi bermeterai atau faktur pajak (JPG, PNG, PDF, maks. 5 MB) agar pemeriksa dapat melihat bukti langsung dari BKU.'}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((l) => (
            <li key={l.id} className="group flex items-center gap-2.5 rounded-lg border border-slate-100 p-2 hover:border-brand-200">
              <button type="button" onClick={() => setLihat(l)} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-slate-100">
                {l.mime.startsWith('image/') ? <img src={`/api/lampiran/${l.id}`} alt="" className="h-full w-full object-cover" /> : <FileText className="h-6 w-6 text-rose-600" />}
              </button>
              <button type="button" onClick={() => setLihat(l)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-medium text-slate-800">{l.nama_file}</p>
                <p className="text-[10px] text-slate-500">{ukuran(l.ukuran)} · {l.diunggah_oleh} · {waktu(l.created_at)}</p>
              </button>
              {boleh && <button type="button" onClick={() => hapus(l)} className="p-1 text-slate-400 hover:text-rose-600" aria-label="Hapus lampiran"><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {lihat && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/80 p-4" onMouseDown={(e) => e.target === e.currentTarget && setLihat(null)}>
          <div className="mb-2 flex items-center justify-between gap-2 text-white">
            <p className="truncate text-sm">{lihat.nama_file}</p>
            <div className="flex gap-1">
              <a href={`/api/lampiran/${lihat.id}?unduh=1`} className="rounded-lg p-2 hover:bg-white/10" aria-label="Unduh"><Download className="h-5 w-5" /></a>
              <button type="button" onClick={() => setLihat(null)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Tutup"><X className="h-5 w-5" /></button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center" onMouseDown={(e) => e.target === e.currentTarget && setLihat(null)}>
            {lihat.mime.startsWith('image/') ? <img src={`/api/lampiran/${lihat.id}`} alt={lihat.nama_file} className="max-h-full max-w-full rounded-lg object-contain" />
              : <iframe title={lihat.nama_file} src={`/api/lampiran/${lihat.id}`} className="h-full w-full max-w-4xl rounded-lg bg-white" />}
          </div>
        </div>
      )}
    </div>
  );
}
