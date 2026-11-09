import { useState } from 'react';
import { CheckCircle2, XCircle, RotateCcw, Stamp, BookCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Field, Modal, Textarea, Spinner, useLoad, useToast, cx } from './ui.jsx';
import { AlurTahap, KeputusanModal } from './Persetujuan.jsx';
import { rp, waktu } from '../lib/format.js';

export const STATUS_BKU = { menunggu: ['amber', 'Menunggu'], disetujui: ['green', 'Disetujui'], ditolak: ['red', 'Ditolak'], dikoreksi: ['violet', 'Dikoreksi'] };

/** Lencana status persetujuan transaksi BKU (menunggu tahap X / disetujui / ditolak). */
export function StatusBku({ status, tahap, className }) {
  if (!status) return null;
  const [c, l] = STATUS_BKU[status] || ['slate', status];
  return <Badge color={c} className={className}>{status === 'menunggu' && tahap ? `Menunggu ${tahap.replace(/^(Verifikasi|Persetujuan) /, '')}` : l}</Badge>;
}

/** Bagian persetujuan berjenjang di detail transaksi: alur per putaran, setujui/tolak, ajukan ulang. */
export function PersetujuanBku({ entryId, onChanged }) {
  const { can } = useApp();
  const toast = useToast();
  const { data, reload } = useLoad(() => api.get(`/api/bku/${entryId}/persetujuan`), [entryId]);
  const [putus, setPutus] = useState(null);
  const [ulang, setUlang] = useState(false);
  if (!data) return <Spinner className="h-4 w-4" />;
  const s = data.status;
  const ubah = () => { reload(); onChanged?.(); };
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Stamp className="h-4 w-4 text-brand-700" />Verifikasi & persetujuan <StatusBku status={s.status} tahap={s.tahap} /></p>
        <div className="flex gap-1.5">
          {data.giliran_saya && <>
            <Button size="sm" variant="success" icon={CheckCircle2} onClick={() => setPutus({ tahap: data.menunggu, setuju: true, judul: `BKU No. ${entryId}` })}>Setujui</Button>
            <Button size="sm" variant="secondary" icon={XCircle} onClick={() => setPutus({ tahap: data.menunggu, setuju: false, judul: `BKU No. ${entryId}` })}>Tolak</Button>
          </>}
          {s.status === 'ditolak' && !s.induk_id && can('admin', 'bendahara') && <Button size="sm" icon={RotateCcw} onClick={() => setUlang(true)}>Ajukan ulang</Button>}
        </div>
      </div>
      {s.induk_id ? <p className="text-xs text-slate-500">Pungutan pajak ini mengikuti status transaksi belanja induknya.</p> : !data.putaran.length ? (
        <p className="text-xs text-slate-500">{s.catatan || 'Transaksi ini tidak memerlukan persetujuan.'}</p>
      ) : (
        <div className="space-y-2">
          {data.putaran.map((p, i) => (
            <div key={p.putaran} className={cx(i > 0 && 'opacity-70')}>
              <p className="mb-1 text-[11px] font-medium text-slate-500">{data.putaran.length > 1 ? `Pengajuan ke-${p.putaran}${i === 0 ? ' (terkini)' : ''}` : 'Alur persetujuan'}</p>
              <AlurTahap tahap={p.tahap} />
              <ul className="mt-1 space-y-0.5">
                {p.tahap.filter((t) => t.waktu).map((t) => (
                  <li key={t.id} className="text-[11px] text-slate-600">{t.label}: <b className={t.status === 'tolak' ? 'text-rose-700' : 'text-emerald-700'}>{t.status === 'tolak' ? 'ditolak' : 'disetujui'}</b> oleh {t.oleh_nama} · {waktu(t.waktu)}{t.catatan ? ` — “${t.catatan}”` : ''}</li>
                ))}
              </ul>
            </div>
          ))}
          {s.status === 'disetujui' && <p className="text-[11px] text-emerald-700">Transaksi tervalidasi: masuk rekap & laporan, dokumen bukti terkunci, dan siap dijurnal. Perubahan hanya melalui jurnal koreksi.</p>}
          {s.status === 'ditolak' && s.catatan && <Alert tone="error" className="!py-2 text-xs">Alasan penolakan: {s.catatan}</Alert>}
        </div>
      )}
      <KeputusanModal aksi={putus} onClose={() => setPutus(null)} onDone={(r, ok) => { toast(ok ? (r.status === 'disetujui' ? 'Transaksi disetujui' : 'Disetujui, diteruskan ke tahap berikutnya') : 'Transaksi ditolak; bendahara menerima notifikasi'); ubah(); }} />
      <AjukanUlang open={ulang} id={entryId} onClose={() => setUlang(false)} onDone={() => { toast('Transaksi diajukan ulang'); ubah(); }} />
    </div>
  );
}

function AjukanUlang({ open, id, onClose, onDone }) {
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!open) return null;
  const kirim = async () => {
    setBusy(true); setErr('');
    try { await api.post(`/api/bku/${id}/ajukan-ulang`, { catatan }); onDone(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open size="sm" onClose={onClose} title="Ajukan ulang transaksi" subtitle="Alur persetujuan dimulai lagi dari tahap pertama"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={kirim}>Ajukan ulang</Button></>}>
      {err && <Alert tone="error" className="mb-2">{err}</Alert>}
      <Field label="Perbaikan yang dilakukan"><Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. Kuitansi bermeterai dan bukti transfer sudah diunggah" /></Field>
    </Modal>
  );
}

/** Pratinjau jurnal akuntansi (LO & LRA) untuk satu transaksi. */
export function PratinjauJurnal({ entryId }) {
  const { data } = useLoad(() => api.get(`/api/akuntansi/pratinjau/${entryId}`), [entryId]);
  if (!data) return null;
  const jurnal = data.jurnal[0];
  const baris = jurnal ? jurnal.rinci : data.usulan.baris;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-700"><BookCheck className="h-4 w-4 text-brand-700" />Jurnal akuntansi
        {jurnal ? <Badge color="green">Sudah dijurnal · {jurnal.nomor}</Badge> : data.usulan.status === 'jurnal' ? <Badge color="blue">Usulan (dibuat saat posting)</Badge> : data.usulan.status === 'balik' ? <Badge color="violet">Jurnal balik saat posting</Badge> : <Badge color="amber">Perlu telaah manual</Badge>}
      </p>
      {baris?.length ? (
        <table className="w-full text-xs"><thead><tr><th className="th">Basis</th><th className="th">Akun</th><th className="th text-right">Debit</th><th className="th text-right">Kredit</th></tr></thead>
          <tbody>{baris.map((b, i) => <tr key={i}><td className="td">{b.basis}</td><td className={cx('td', Number(b.kredit) > 0 && 'pl-6')}><span className="font-mono text-[11px] text-slate-500">{b.akun_kode}</span> {b.akun_nama}</td>
            <td className="td num text-right">{Number(b.debit) ? rp(b.debit) : ''}</td><td className="td num text-right">{Number(b.kredit) ? rp(b.kredit) : ''}</td></tr>)}</tbody></table>
      ) : <p className="text-xs text-slate-500">{data.usulan.alasan || 'Tidak ada jurnal otomatis untuk transaksi ini.'}</p>}
      {(jurnal?.dasar || data.usulan.dasar) && <p className="mt-2 text-[11px] text-slate-500">Dasar: {jurnal?.dasar || data.usulan.dasar}</p>}
    </div>
  );
}
