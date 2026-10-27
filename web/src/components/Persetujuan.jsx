import { useEffect, useState } from 'react';
import { Ban, Check, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Button, Field, Modal, Textarea, cx } from './ui.jsx';
import { waktu } from '../lib/format.js';

export const bolehPutuskan = (user, t) => Boolean(t && user && (user.role === 'admin' || user.role === t.peran));
export const tahapMenunggu = (alur) => alur?.tahap?.find((t) => t.status === 'menunggu') || null;

const GAYA = {
  setuju: ['bg-emerald-50 text-emerald-700 ring-emerald-200', Check],
  menunggu: ['bg-amber-50 text-amber-800 ring-amber-200', Clock],
  antre: ['bg-slate-50 text-slate-400 ring-slate-200', null],
  tolak: ['bg-rose-50 text-rose-700 ring-rose-200', Ban],
  batal: ['bg-slate-50 text-slate-400 ring-slate-200 line-through', null],
};
const KATA = { setuju: 'disetujui', menunggu: 'menunggu keputusan', antre: 'belum giliran', tolak: 'ditolak', batal: 'dibatalkan' };

/** Rangkaian tahap persetujuan berjenjang (mis. Verifikasi PPK-SKPD → Persetujuan PA/KPA). */
export function AlurTahap({ tahap = [], singkat = false, className }) {
  if (!tahap.length) return null;
  return (
    <ol className={cx('flex flex-wrap items-center gap-1', className)}>
      {tahap.map((t, i) => {
        const [g, Icon] = GAYA[t.status] || GAYA.antre;
        const info = [t.label, KATA[t.status], t.oleh_nama, t.waktu && waktu(t.waktu), t.catatan && `“${t.catatan}”`].filter(Boolean).join(' · ');
        return (
          <li key={t.id || i} className="flex items-center gap-1">
            {i > 0 && <span className={cx('h-0.5 w-3 rounded', tahap[i - 1].status === 'setuju' ? 'bg-emerald-400' : 'bg-slate-200')} />}
            <span title={info} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', g)}>
              {Icon && <Icon className="h-3 w-3" />}{singkat ? t.peran === 'verifikator' ? 'PPK' : t.peran === 'pimpinan' ? 'PA/KPA' : t.label : t.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Dialog setujui/tolak satu tahap persetujuan. */
export function KeputusanModal({ aksi, onClose, onDone }) {
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (aksi) { setCatatan(''); setErr(''); } }, [aksi]);
  if (!aksi) return null;
  const { tahap, setuju, judul, sub } = aksi;
  const kirim = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/api/persetujuan/${tahap.id}/${setuju ? 'setuju' : 'tolak'}`, { catatan: catatan.trim() || undefined });
      onDone?.(r, setuju);
      onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open size="sm" onClose={onClose} title={`${setuju ? 'Setujui' : 'Tolak'}: ${tahap.label}`} subtitle={[judul, sub].filter(Boolean).join(' · ')}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button variant={setuju ? 'success' : 'danger'} icon={setuju ? CheckCircle2 : XCircle} loading={busy} disabled={!setuju && !catatan.trim()} onClick={kirim}>{setuju ? 'Setujui' : 'Tolak'}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label={setuju ? 'Catatan (opsional)' : 'Alasan penolakan'} hint={setuju ? 'Tersimpan di jejak persetujuan dan jejak audit.' : 'Pengaju melihat alasan ini dan dapat mengajukan ulang setelah diperbaiki.'}>
          <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder={setuju ? 'mis. Dokumen lengkap' : 'mis. Kuitansi belum ditandatangani'} />
        </Field>
      </div>
    </Modal>
  );
}
