import { Link, useParams } from 'react-router-dom';
import { Boxes, Landmark, ScanLine, ShieldX } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Badge, Button, Loading, useLoad } from '../components/ui.jsx';

const WARNA = { B: 'green', RR: 'amber', RB: 'red' };

/** Halaman yang terbuka saat label QR aset dipindai dengan kamera biasa. Tanpa login hanya identitas minimal (tanpa harga). */
export default function AsetPublik() {
  const { kode } = useParams();
  const { user } = useApp();
  const { data, loading, error } = useLoad(() => api.get(`/api/publik/aset/${encodeURIComponent(kode)}`), [kode]);
  const a = data?.aset;
  return (
    <div className="min-h-screen bg-page px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-slate-700">
          <div className="rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 p-2 text-gold-400"><Landmark className="h-5 w-5" /></div>
          <div><p className="text-sm font-bold text-slate-900">BKU BKAD</p><p className="text-[11px] text-slate-500">Label aset barang milik daerah</p></div>
        </div>
        {loading ? <Loading text="Membaca label…" /> : error ? (
          <div className="card p-6 text-center"><ShieldX className="mx-auto h-10 w-10 text-rose-600" /><p className="mt-2 font-semibold text-slate-800">Label tidak dikenal</p><p className="mt-1 text-sm text-slate-500">{error.message}</p></div>
        ) : (
          <div className="card overflow-hidden">
            <div className="bg-brand-800 px-5 py-5 text-white">
              <Boxes className="h-8 w-8 text-gold-400" />
              <p className="mt-2 text-lg font-bold">{a.nama}</p>
              <p className="font-mono text-sm opacity-90">{a.kode_barang} / NUP {String(a.nup).padStart(4, '0')}</p>
            </div>
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 p-5 text-sm">
              <dt className="text-slate-500">Pemilik</dt><dd>{a.skpd_nama}</dd>
              {a.merk_tipe && <><dt className="text-slate-500">Merk / tipe</dt><dd>{a.merk_tipe}</dd></>}
              <dt className="text-slate-500">Tahun perolehan</dt><dd>{a.tahun_perolehan}</dd>
              <dt className="text-slate-500">Lokasi tercatat</dt><dd>{a.lokasi || '-'}</dd>
              <dt className="text-slate-500">Kondisi</dt><dd><Badge color={WARNA[a.kondisi]}>{a.kondisi_label}</Badge></dd>
              <dt className="text-slate-500">Status</dt><dd>{a.status_label}</dd>
            </dl>
            <div className="border-t border-slate-100 p-4">
              {user ? <Link to={`/aset/pindai?kode=${encodeURIComponent(kode)}`}><Button icon={ScanLine} className="w-full">Lihat detail & catat pemeriksaan</Button></Link>
                : <p className="text-center text-xs text-slate-500">Harga perolehan dan riwayat pemeriksaan hanya tampil bagi petugas yang masuk ke aplikasi. <Link to="/" className="text-brand-700 underline">Masuk</Link></p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
