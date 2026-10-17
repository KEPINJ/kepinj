import { useState } from 'react';
import { ShieldCheck, Zap, FileSpreadsheet, Lock, User } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Button } from '../components/ui.jsx';

const DEMO = [['admin', 'Administrator'], ['bendahara', 'Bendahara'], ['verifikator', 'Verifikator'], ['pimpinan', 'Pimpinan']];

export default function Login() {
  const { setUser } = useApp();
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { const { user } = await api.post('/api/auth/login', f); setUser(user); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-800 via-brand-900 to-brand-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-gold-400/10" />
        <div className="absolute -bottom-32 -left-20 h-[28rem] w-[28rem] rounded-full bg-brand-500/20" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gold-400 text-base font-black text-brand-950">BKU</div>
          <div><p className="font-semibold">Badan Keuangan dan Aset Daerah</p><p className="text-sm text-brand-200">Sistem Penatausahaan Kas</p></div>
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Buku Kas Umum yang tercatat rapi, terhitung otomatis, dan siap lapor.</h1>
          <div className="mt-10 space-y-5">
            {[[Zap, 'Realtime', 'Setiap transaksi langsung tampil di semua layar melalui event stream Apache Kafka.'],
              [ShieldCheck, 'Integritas terjamin', 'Setiap baris BKU dikunci rantai hash SHA-256; perubahan diam-diam langsung terdeteksi.'],
              [FileSpreadsheet, 'Siap Coretax', 'PPh 21 TER, PPh 22/23/4(2) dan PPN dihitung otomatis lalu diekspor ke XML Coretax.']].map(([I, t, d]) => (
              <div key={t} className="flex gap-4"><div className="rounded-xl bg-white/10 p-2.5"><I className="h-5 w-5 text-gold-400" /></div><div><p className="font-medium">{t}</p><p className="text-sm text-brand-200">{d}</p></div></div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-brand-300">© {new Date().getFullYear()} BKAD · Sesuai Permendagri 77/2020</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-800 text-base font-black text-gold-400">BKU</div></div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Masuk</h2>
          <p className="mt-1 text-sm text-slate-500">Gunakan akun yang diberikan administrator BKAD.</p>
          <div className="mt-7 space-y-4">
            {err && <Alert tone="error">{err}</Alert>}
            <div className="relative"><User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input py-2.5 pl-9" placeholder="Username" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus /></div>
            <div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input py-2.5 pl-9" type="password" placeholder="Password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
            <Button type="submit" size="lg" className="w-full" loading={busy}>Masuk</Button>
          </div>
          <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-3">
            <p className="text-xs font-medium text-slate-600">Akun demo (password: <code className="rounded bg-slate-100 px-1">bku12345</code>)</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DEMO.map(([u, l]) => <button type="button" key={u} onClick={() => setF({ username: u, password: 'bku12345' })} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-brand-50 hover:text-brand-800">{l}</button>)}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
