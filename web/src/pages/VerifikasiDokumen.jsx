import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, ShieldX, Landmark, Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Loading, useLoad } from '../components/ui.jsx';
import { rp, waktu, tgl } from '../lib/format.js';

const fmt = (k, v) => (typeof v === 'number' && /nilai|penerimaan|pengeluaran|jumlah spj|saldo/i.test(k) ? rp(v) : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? tgl(v, { long: true }) : String(v));

// Halaman publik hasil pindai QR (tanpa login)
export default function VerifikasiDokumen() {
  const { kode } = useParams();
  const nav = useNavigate();
  const [input, setInput] = useState('');
  const { data, loading, error } = useLoad(() => kode && api.get(`/api/publik/dokumen/${kode}`), [kode]);

  const status = !kode ? null : error ? 'tidak' : data?.cocok ? 'cocok' : 'berubah';
  const S = {
    cocok: [ShieldCheck, 'Dokumen asli dan sesuai', 'bg-emerald-600', 'text-emerald-700'],
    berubah: [ShieldAlert, 'Dokumen asli, data sudah berubah', 'bg-amber-500', 'text-amber-800'],
    tidak: [ShieldX, 'Dokumen tidak terdaftar', 'bg-rose-600', 'text-rose-700'],
  }[status] || [];
  const Icon = S[0];

  return (
    <div className="min-h-screen bg-page px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center justify-center gap-2 text-slate-700">
          <div className="rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 p-2 text-gold-400"><Landmark className="h-5 w-5" /></div>
          <div><p className="text-sm font-bold text-slate-900">BKU BKAD</p><p className="text-[11px] text-slate-500">Verifikasi keaslian dokumen</p></div>
        </div>
        {!kode ? null : loading ? <Loading text="Memeriksa dokumen…" /> : (
          <div className="card overflow-hidden">
            <div className={`${S[2]} px-5 py-6 text-center text-white`}>
              <Icon className="mx-auto h-12 w-12" />
              <p className="mt-2 text-lg font-bold">{S[1]}</p>
              <p className="mt-1 font-mono text-sm tracking-widest opacity-90">{String(kode).toUpperCase()}</p>
            </div>
            <div className="space-y-4 p-5">
              {error ? <p className="text-sm text-slate-700">{error.message}</p> : (<>
                <p className={`text-sm font-medium ${S[3]}`}>{data.pesan}</p>
                <dl className="space-y-2 text-sm">
                  {[['Dokumen', data.judul], ['SKPD', data.skpd], ['Dicetak', `${waktu(data.dicetak_pada)}${data.dicetak_oleh ? ` oleh ${data.dicetak_oleh}` : ''}`],
                    ...Object.entries(data.ringkasan || {}).map(([k, v]) => [k, fmt(k, v)])].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
                      <dt className="text-slate-500">{k}</dt><dd className="num text-right font-medium text-slate-800">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="break-all rounded-lg bg-slate-50 p-2 font-mono text-[10px] text-slate-500">Sidik SHA-256: {data.sidik}</p>
              </>)}
            </div>
          </div>
        )}
        <form className="card mt-4 flex gap-2 p-3" onSubmit={(e) => { e.preventDefault(); if (input.trim()) nav(`/v/${input.trim().toUpperCase()}`); }}>
          <input className="input font-mono uppercase" placeholder="Masukkan kode dokumen" value={input} onChange={(e) => setInput(e.target.value)} />
          <Button icon={Search} type="submit">Periksa</Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500"><Link to="/" className="underline">Masuk ke aplikasi</Link></p>
      </div>
    </div>
  );
}
