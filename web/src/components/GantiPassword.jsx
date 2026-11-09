import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Field, Input, Modal, useToast, Alert, cx } from './ui.jsx';

/** Ganti password. wajib=true: tampil tanpa tombol batal (password sementara dari admin atau sudah kedaluwarsa). */
export default function GantiPassword({ open, onClose, wajib, onDone }) {
  const [f, setF] = useState({ lama: '', baru: '', ulang: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cek, setCek] = useState(null);
  const toast = useToast();
  useEffect(() => {
    if (!f.baru) { setCek(null); return undefined; }
    const t = setTimeout(() => api.post('/api/keamanan/cek-password', { password: f.baru }).then(setCek).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [f.baru]);
  const submit = async () => {
    if (f.baru !== f.ulang) return setErr('Konfirmasi password tidak sama');
    setBusy(true); setErr('');
    try {
      await api.post('/api/auth/password', f);
      toast('Password berhasil diganti. Sesi di perangkat lain telah diakhiri.');
      setF({ lama: '', baru: '', ulang: '' }); onDone?.(); onClose?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={wajib ? undefined : onClose} title={wajib ? 'Ganti password sebelum melanjutkan' : 'Ganti password'} size="sm"
      subtitle={wajib === 'kedaluwarsa' ? 'Masa berlaku password Anda sudah habis.' : wajib ? 'Anda masuk dengan password sementara dari administrator.' : undefined}
      footer={<>{!wajib && <Button variant="secondary" onClick={onClose}>Batal</Button>}<Button loading={busy} disabled={cek && !cek.ok} onClick={submit}>Simpan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label={wajib === 'wajib' ? 'Password sementara' : 'Password lama'}><Input type="password" autoComplete="current-password" value={f.lama} onChange={(e) => setF({ ...f, lama: e.target.value })} /></Field>
        <Field label="Password baru"><Input type="password" autoComplete="new-password" value={f.baru} onChange={(e) => setF({ ...f, baru: e.target.value })} /></Field>
        {cek && (
          <p className={cx('flex items-start gap-1.5 text-[11px]', cek.ok ? 'text-emerald-700' : 'text-amber-700')}>
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />{cek.ok ? 'Password memenuhi kebijakan keamanan' : `Password harus ${cek.salah.join(', ')}`}
          </p>
        )}
        <Field label="Ulangi password baru" hint="Tidak boleh sama dengan beberapa password terakhir."><Input type="password" autoComplete="new-password" value={f.ulang} onChange={(e) => setF({ ...f, ulang: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
