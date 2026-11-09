import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ScanLine, Camera, CameraOff, Keyboard, ArrowLeft, RotateCcw, History, CheckCircle2, ClipboardList } from 'lucide-react';
import jsQR from 'jsqr';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Input, PageHeader, Progress, Spinner, useLoad } from '../components/ui.jsx';
import { KartuAset, PeriksaModal, RiwayatPeriksa } from './Aset.jsx';

/** Ambil kode QR aset dari isi QR (URL …/a/<kode>) atau teks kode langsung. */
export const kodeDariQr = (isi) => {
  const s = String(isi || '').trim();
  const m = s.match(/\/a\/([A-Za-z0-9_-]{6,32})(?:[/?#]|$)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{6,32}$/.test(s) ? s : null;
};

/** Pindai QR aset dengan kamera ponsel (BarcodeDetector bila tersedia, jsQR sebagai cadangan). */
export default function PindaiAset() {
  const { skpdId } = useApp();
  const [sp, setSp] = useSearchParams();
  const video = useRef(null);
  const kanvas = useRef(null);
  const stream = useRef(null);
  const loop = useRef(0);
  const [aktif, setAktif] = useState(false);
  const [galat, setGalat] = useState('');
  const [manual, setManual] = useState('');
  const [hasil, setHasil] = useState(null);
  const [memuat, setMemuat] = useState(false);
  const [selesai, setSelesai] = useState([]);
  const meta = useLoad(() => api.get('/api/aset/meta'), []);
  const inv = useLoad(() => skpdId && api.get('/api/inventarisasi', { skpd_id: skpdId }), [skpdId]);
  const mesin = typeof window !== 'undefined' && 'BarcodeDetector' in window ? 'BarcodeDetector' : 'jsQR';

  const berhenti = () => {
    cancelAnimationFrame(loop.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setAktif(false);
  };
  useEffect(() => berhenti, []);

  const cari = async (kode) => {
    setMemuat(true); setGalat('');
    try { setHasil(await api.get(`/api/aset/qr/${encodeURIComponent(kode)}`)); } catch (e) { setGalat(e.message); setHasil(null); } finally { setMemuat(false); }
  };
  useEffect(() => { const k = kodeDariQr(sp.get('kode')); if (k) cari(k); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const temukan = (isi) => {
    const kode = kodeDariQr(isi);
    if (!kode) { setGalat(`QR bukan label aset aplikasi ini: ${String(isi).slice(0, 60)}`); return false; }
    if (navigator.vibrate) navigator.vibrate(80);
    berhenti(); cari(kode);
    return true;
  };

  const mulai = async () => {
    setGalat(''); setHasil(null);
    if (!navigator.mediaDevices?.getUserMedia) { setGalat('Browser tidak mendukung kamera. Gunakan HTTPS dan browser terbaru, atau ketik kode QR secara manual.'); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      video.current.srcObject = stream.current;
      await video.current.play();
      setAktif(true);
      const detektor = mesin === 'BarcodeDetector' ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
      const ctx = kanvas.current.getContext('2d', { willReadFrequently: true });
      let sibuk = false;
      const langkah = async () => {
        const v = video.current;
        if (!stream.current || !v) return;
        if (!sibuk && v.readyState >= 2) {
          sibuk = true;
          try {
            if (detektor) {
              const kode = await detektor.detect(v);
              if (kode[0] && temukan(kode[0].rawValue)) return;
            } else {
              const w = 480; const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
              kanvas.current.width = w; kanvas.current.height = h;
              ctx.drawImage(v, 0, 0, w, h);
              const q = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
              if (q?.data && temukan(q.data)) return;
            }
          } catch { /* bingkai berikutnya */ }
          sibuk = false;
        }
        loop.current = requestAnimationFrame(langkah);
      };
      loop.current = requestAnimationFrame(langkah);
    } catch (e) {
      setGalat(e.name === 'NotAllowedError' ? 'Izin kamera ditolak. Izinkan akses kamera di pengaturan browser.' : `Kamera tidak dapat dibuka: ${e.message}`);
      berhenti();
    }
  };
  const ulang = () => { setHasil(null); setSp({}, { replace: true }); mulai(); };
  const a = hasil?.aset;
  const progres = inv.data?.berjalan?.progres;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader icon={ScanLine} title="Pindai QR Aset" subtitle="Arahkan kamera ke label QR untuk melihat identitas aset dan mencatat pemeriksaan fisik"
        actions={<Link to="/aset"><Button variant="ghost" icon={ArrowLeft}>Daftar aset</Button></Link>} />
      {inv.data?.berjalan && (
        <div className="card flex items-center gap-3 p-3">
          <ClipboardList className="h-5 w-5 shrink-0 text-brand-700" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{inv.data.berjalan.nama}</p><Progress value={progres?.persen} className="mt-1" /></div>
          <span className="num text-sm font-semibold">{progres?.diperiksa + selesai.length}/{progres?.total}</span>
        </div>
      )}
      {!a && (
        <Card bodyClass="p-3">
          <div className="relative overflow-hidden rounded-xl bg-slate-900" style={{ aspectRatio: '4 / 3' }}>
            <video ref={video} playsInline muted className="h-full w-full object-cover" />
            <canvas ref={kanvas} className="hidden" />
            {aktif ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="relative h-3/5 w-3/5 max-w-[280px] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
                  <div className="absolute inset-x-3 top-1/2 h-0.5 animate-pulse bg-emerald-400" />
                </div>
                <p className="absolute bottom-3 rounded-full bg-black/50 px-3 py-1 text-xs text-white">Memindai dengan {mesin}…</p>
              </div>
            ) : (
              <div className="absolute inset-0 grid place-items-center text-center text-white/80">
                {memuat ? <Spinner className="h-8 w-8 text-white" /> : <div><Camera className="mx-auto h-10 w-10" /><p className="mt-2 text-sm">Kamera belum aktif</p></div>}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {aktif ? <Button variant="secondary" icon={CameraOff} onClick={berhenti}>Matikan kamera</Button> : <Button icon={Camera} onClick={mulai} className="flex-1">Nyalakan kamera</Button>}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const k = kodeDariQr(manual); if (k) { berhenti(); cari(k); } else setGalat('Kode tidak valid'); }}>
            <div className="relative flex-1"><Keyboard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="pl-9" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="atau ketik kode QR / tempel tautan label" /></div>
            <Button type="submit" variant="secondary">Cari</Button>
          </form>
          {galat && <Alert tone="error" className="mt-3">{galat}</Alert>}
        </Card>
      )}
      {a && (
        <>
          <Card title={a.nama} subtitle={`${a.skpd_nama}`} actions={<Badge color={a.status === 'aktif' ? 'green' : 'amber'}>{meta.data?.status[a.status]}</Badge>}>
            <KartuAset a={a} meta={meta.data} umur={hasil.umur_tahun} />
          </Card>
          <Card title={hasil.inventarisasi ? `Catat pemeriksaan · ${hasil.inventarisasi.nama}` : 'Catat pemeriksaan fisik'}>
            {selesai.includes(a.id) ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center"><CheckCircle2 className="h-10 w-10 text-emerald-500" /><p className="text-sm font-medium">Pemeriksaan tercatat</p>
                <Button icon={RotateCcw} onClick={ulang}>Pindai aset berikutnya</Button></div>
            ) : <PeriksaModal open inline aset={a} meta={meta.data} cara="qr" onDone={() => { setSelesai((s) => [...s, a.id]); cari(a.kode_qr); inv.reload(); }} />}
          </Card>
          <Card title="Riwayat pemeriksaan" actions={<History className="h-4 w-4 text-slate-400" />}><RiwayatPeriksa rows={hasil.riwayat} meta={meta.data} /></Card>
          {!selesai.includes(a.id) && <Button variant="ghost" icon={RotateCcw} onClick={ulang} className="w-full">Pindai aset lain</Button>}
        </>
      )}
    </div>
  );
}
