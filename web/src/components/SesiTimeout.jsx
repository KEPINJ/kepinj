import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Button, Modal } from './ui.jsx';

const PERINGATAN_DETIK = 120;

/**
 * Batas waktu sesi: server mencabut sesi yang tidak aktif selama N menit. Komponen ini membaca sisa waktu
 * (tanpa dihitung sebagai aktivitas) dan menampilkan peringatan 2 menit sebelum sesi berakhir.
 */
export default function SesiTimeout() {
  const { logout } = useApp();
  const [sisa, setSisa] = useState(null);
  const batas = useRef(null);
  const aktif = useRef(Date.now());

  useEffect(() => {
    const tandai = () => { aktif.current = Date.now(); };
    ['keydown', 'mousedown', 'touchstart'].forEach((e) => window.addEventListener(e, tandai, { passive: true }));
    const cek = async () => {
      try {
        const r = await api.latar('/api/auth/sesi');
        if (!r.aktif) { logout(r.pesan || 'Sesi berakhir. Silakan login kembali.'); return; }
        // Pengguna aktif di halaman tetapi belum ada permintaan ke server: perpanjang sesi
        if (r.sisa_idle_detik < PERINGATAN_DETIK * 2 && Date.now() - aktif.current < 60_000) { await api.post('/api/auth/sesi/perpanjang'); batas.current = Date.now() + r.idle_menit * 60_000; return; }
        batas.current = Date.now() + r.sisa_idle_detik * 1000;
      } catch { /* jaringan putus: coba lagi */ }
    };
    cek();
    const t1 = setInterval(cek, 30_000);
    const t2 = setInterval(() => {
      if (!batas.current) return;
      const s = Math.round((batas.current - Date.now()) / 1000);
      setSisa(s <= PERINGATAN_DETIK ? Math.max(0, s) : null);
      if (s <= 0) cek();
    }, 1000);
    return () => { clearInterval(t1); clearInterval(t2); ['keydown', 'mousedown', 'touchstart'].forEach((e) => window.removeEventListener(e, tandai)); };
  }, [logout]);

  if (sisa == null) return null;
  const mm = `${Math.floor(sisa / 60)}:${String(sisa % 60).padStart(2, '0')}`;
  return (
    <Modal open size="sm" title="Sesi akan berakhir" onClose={() => {}}
      footer={<><Button variant="secondary" onClick={() => logout('Anda telah keluar.')}>Keluar</Button>
        <Button onClick={async () => { const r = await api.post('/api/auth/sesi/perpanjang').catch(() => null); if (r) { batas.current = Date.now() + r.sisa_idle_detik * 1000; setSisa(null); } }}>Tetap masuk</Button></>}>
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-amber-50 p-3 text-amber-700"><Clock className="h-6 w-6" /></div>
        <p className="text-sm text-slate-700">Tidak ada aktivitas untuk beberapa saat. Demi keamanan data, Anda akan keluar otomatis dalam <b className="num">{mm}</b>.</p>
      </div>
    </Modal>
  );
}
