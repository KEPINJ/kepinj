import { useRef, useState } from 'react';
import { Paperclip, Upload, FileText, Trash2, Download, X, Lock, History, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Badge, Button, Field, Input, Modal, Select, Spinner, useLoad, useToast, cx } from './ui.jsx';
import { tgl, waktu } from '../lib/format.js';

const ukuran = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);
export const KELENGKAPAN = { lengkap: ['green', 'Lengkap'], sebagian: ['amber', 'Sebagian'], belum: ['red', 'Belum ada'], tidak_wajib: ['slate', 'Tidak wajib'] };
const AKSI = { unggah: 'mengunggah', hapus: 'menghapus', unduh: 'mengunduh' };

/** Dokumen bukti (nota/kuitansi, bukti transfer, SP2D, dokumen pajak, pertanggungjawaban) untuk satu transaksi BKU. */
export default function LampiranBukti({ entryId, onChanged }) {
  const { can } = useApp();
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [lihat, setLihat] = useState(null);
  const [riwayat, setRiwayat] = useState(false);
  const [meta, setMeta] = useState({ jenis_dokumen: '', nomor_dokumen: '', tanggal_dokumen: '' });
  const [hapus, setHapus] = useState(null);
  const { data, reload } = useLoad(() => api.get(`/api/bku/${entryId}/lampiran`), [entryId]);
  const { data: info } = useLoad(() => api.get('/api/bukti/meta'), []);
  const boleh = can('admin', 'bendahara') && !data?.terkunci;
  const maks = data?.maks_mb || 5;
  const jenis = info?.jenis || {};
  const kurang = data?.kelengkapan?.kurang || [];
  const jenisAktif = meta.jenis_dokumen || kurang[0] || data?.kelengkapan?.wajib?.[0] || 'bukti_transaksi';

  const unggah = async (files) => {
    setBusy(true);
    try {
      for (const f of files) {
        if (f.size > maks * 1024 * 1024) { toast(`${f.name} melebihi ${maks} MB`, 'error'); continue; }
        if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) { toast(`${f.name}: hanya PDF, JPG, atau PNG`, 'error'); continue; }
        const fd = new FormData();   // isian dikirim sebelum berkas agar terbaca server
        fd.append('jenis_dokumen', jenisAktif);
        if (meta.nomor_dokumen) fd.append('nomor_dokumen', meta.nomor_dokumen);
        if (meta.tanggal_dokumen) fd.append('tanggal_dokumen', meta.tanggal_dokumen);
        fd.append('file', f);
        const res = await fetch(`/api/bku/${entryId}/lampiran`, { method: 'POST', body: fd, credentials: 'include' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Gagal mengunggah');
      }
      toast('Dokumen bukti tersimpan'); setMeta({ jenis_dokumen: '', nomor_dokumen: '', tanggal_dokumen: '' }); reload(); onChanged?.();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const rows = data?.rows || [];
  const k = data?.kelengkapan;

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Paperclip className="h-4 w-4 text-brand-700" />Dokumen bukti {rows.length > 0 && `(${rows.length})`}
          {k && <Badge color={KELENGKAPAN[k.status]?.[0]}>{KELENGKAPAN[k.status]?.[1]}</Badge>}
          {data?.terkunci && <Badge color="blue"><Lock className="h-3 w-3" />Terkunci (sudah disetujui)</Badge>}
        </p>
        <Button size="sm" variant="ghost" icon={History} onClick={() => setRiwayat(true)}>Riwayat</Button>
      </div>
      {k?.wajib?.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {k.wajib.map((j) => <span key={j} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset', kurang.includes(j) ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200')}>
            {kurang.includes(j) ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{jenis[j] || j}</span>)}
        </div>
      )}
      {boleh && (
        <div className="mb-3 grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
          <Select value={jenisAktif} onChange={(e) => setMeta((m) => ({ ...m, jenis_dokumen: e.target.value }))} options={Object.entries(jenis).map(([value, label]) => ({ value, label: kurang.includes(value) ? `${label} (wajib, belum ada)` : label }))} />
          <Input placeholder="Nomor dokumen" value={meta.nomor_dokumen} onChange={(e) => setMeta((m) => ({ ...m, nomor_dokumen: e.target.value }))} />
          <Input type="date" value={meta.tanggal_dokumen} onChange={(e) => setMeta((m) => ({ ...m, tanggal_dokumen: e.target.value }))} />
          <input ref={input} type="file" multiple accept="image/jpeg,image/png,application/pdf,.pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => e.target.files.length && unggah([...e.target.files])} />
          <Button size="sm" icon={Upload} loading={busy} onClick={() => input.current?.click()}>Unggah</Button>
        </div>
      )}
      {!data ? <Spinner className="h-4 w-4" /> : !rows.length ? (
        <p className="text-xs text-slate-500">Belum ada dokumen. {boleh && `Format PDF, JPG, atau PNG, maks. ${maks} MB. Isi berkas diperiksa (bukan hanya ekstensinya) dan disimpan dengan sidik SHA-256.`}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((l) => (
            <li key={l.id} className="group flex items-center gap-2.5 rounded-lg border border-slate-100 p-2 hover:border-brand-200">
              <button type="button" onClick={() => setLihat(l)} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-slate-100">
                {l.mime.startsWith('image/') ? <img src={`/api/lampiran/${l.id}`} alt="" className="h-full w-full object-cover" /> : <FileText className="h-6 w-6 text-rose-600" />}
              </button>
              <button type="button" onClick={() => setLihat(l)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-medium text-slate-800">{l.nama_file}</p>
                <p className="text-[10px] font-medium text-brand-700">{jenis[l.jenis_dokumen] || l.jenis_dokumen}{l.nomor_dokumen ? ` · ${l.nomor_dokumen}` : ''}{l.tanggal_dokumen ? ` · ${tgl(l.tanggal_dokumen)}` : ''}</p>
                <p className="text-[10px] text-slate-500">{ukuran(l.ukuran)} · {l.diunggah_oleh} · {waktu(l.created_at)}</p>
              </button>
              <a href={`/api/lampiran/${l.id}?unduh=1`} className="p-1 text-slate-400 hover:text-brand-700" aria-label="Unduh"><Download className="h-4 w-4" /></a>
              {boleh && <button type="button" onClick={() => setHapus(l)} className="p-1 text-slate-400 hover:text-rose-600" aria-label="Hapus dokumen"><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {lihat && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/80 p-4" onMouseDown={(e) => e.target === e.currentTarget && setLihat(null)}>
          <div className="mb-2 flex items-center justify-between gap-2 text-white">
            <p className="truncate text-sm">{lihat.nama_file} <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" />SHA-256 {lihat.sha256?.slice(0, 12)}…</span></p>
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
      <Modal open={riwayat} onClose={() => setRiwayat(false)} size="sm" title="Riwayat dokumen" subtitle="Setiap unggahan, penghapusan, dan unduhan tercatat dan tidak dapat diubah">
        <ul className="space-y-2">
          {(data?.riwayat || []).map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-100 px-3 py-2 text-xs">
              <p className="text-slate-800"><b>{r.oleh_nama || 'Sistem'}</b> {AKSI[r.aksi]} <span className="font-mono">{r.nama_file}</span></p>
              <p className="text-[11px] text-slate-500">{waktu(r.waktu)}{r.jenis_dokumen ? ` · ${jenis[r.jenis_dokumen] || r.jenis_dokumen}` : ''}{r.catatan ? ` · “${r.catatan}”` : ''}</p>
            </li>
          ))}
          {!data?.riwayat?.length && <p className="text-xs text-slate-500">Belum ada riwayat.</p>}
        </ul>
        {data?.dihapus?.length > 0 && <p className="mt-3 text-[11px] text-slate-500">{data.dihapus.length} dokumen ditandai dihapus; berkasnya tetap tersimpan untuk pemeriksaan.</p>}
      </Modal>
      <HapusModal l={hapus} onClose={() => setHapus(null)} onDone={() => { toast('Dokumen ditandai dihapus'); reload(); onChanged?.(); }} />
    </div>
  );
}

function HapusModal({ l, onClose, onDone }) {
  const [alasan, setAlasan] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!l) return null;
  const kirim = async () => {
    setBusy(true);
    try { await api.del(`/api/lampiran/${l.id}?alasan=${encodeURIComponent(alasan)}`); onDone(); onClose(); setAlasan(''); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open size="sm" onClose={onClose} title="Hapus dokumen bukti" subtitle={l.nama_file}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant="danger" loading={busy} disabled={alasan.trim().length < 5} onClick={kirim}>Hapus</Button></>}>
      <Field label="Alasan penghapusan" hint="Berkas tidak dihapus permanen; ditandai dihapus beserta alasannya di riwayat dokumen.">
        <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah unggah, diganti scan yang lebih jelas" />
      </Field>
    </Modal>
  );
}
