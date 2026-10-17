import { useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Field, Input, Modal, useToast, Alert } from './ui.jsx';

export default function GantiPassword({ open, onClose }) {
  const [f, setF] = useState({ lama: '', baru: '', ulang: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    if (f.baru !== f.ulang) return setErr('Konfirmasi password tidak sama');
    setBusy(true); setErr('');
    try { await api.post('/api/auth/password', f); toast('Password berhasil diganti'); onClose(); setF({ lama: '', baru: '', ulang: '' }); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Ganti password" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={submit}>Simpan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Password lama"><Input type="password" value={f.lama} onChange={(e) => setF({ ...f, lama: e.target.value })} /></Field>
        <Field label="Password baru" hint="Minimal 8 karakter"><Input type="password" value={f.baru} onChange={(e) => setF({ ...f, baru: e.target.value })} /></Field>
        <Field label="Ulangi password baru"><Input type="password" value={f.ulang} onChange={(e) => setF({ ...f, ulang: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
