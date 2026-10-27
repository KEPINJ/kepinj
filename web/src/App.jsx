import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './lib/ctx.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Bku = lazy(() => import('./pages/Bku.jsx'));
const PenutupanKas = lazy(() => import('./pages/PenutupanKas.jsx'));
const Rekonsiliasi = lazy(() => import('./pages/Rekonsiliasi.jsx'));
const Kalkulator = lazy(() => import('./pages/Kalkulator.jsx'));
const RegisterPajak = lazy(() => import('./pages/RegisterPajak.jsx'));
const Coretax = lazy(() => import('./pages/Coretax.jsx'));
const OlahData = lazy(() => import('./pages/OlahData.jsx'));
const Realisasi = lazy(() => import('./pages/Realisasi.jsx'));
const Laporan = lazy(() => import('./pages/Laporan.jsx'));
const Master = lazy(() => import('./pages/Master.jsx'));
const Sistem = lazy(() => import('./pages/Sistem.jsx'));
const Audit = lazy(() => import('./pages/Audit.jsx'));
const Pengguna = lazy(() => import('./pages/Pengguna.jsx'));
const CetakBku = lazy(() => import('./pages/CetakBku.jsx'));
const Kuitansi = lazy(() => import('./pages/Kuitansi.jsx'));
const TutupBuku = lazy(() => import('./pages/TutupBuku.jsx'));
const Spj = lazy(() => import('./pages/Spj.jsx'));
const BukuPembantu = lazy(() => import('./pages/BukuPembantu.jsx'));
const Peringatan = lazy(() => import('./pages/Peringatan.jsx'));
const Spp = lazy(() => import('./pages/Spp.jsx'));
const Panjar = lazy(() => import('./pages/Panjar.jsx'));
const LaporanPimpinan = lazy(() => import('./pages/LaporanPimpinan.jsx'));
const VerifikasiDokumen = lazy(() => import('./pages/VerifikasiDokumen.jsx'));
const Penerimaan = lazy(() => import('./pages/Penerimaan.jsx'));
const CetakSts = lazy(() => import('./pages/CetakSts.jsx'));
const Pembantu = lazy(() => import('./pages/Pembantu.jsx'));
const CetakSpjPembantu = lazy(() => import('./pages/CetakSpjPembantu.jsx'));
const TutupTahun = lazy(() => import('./pages/TutupTahun.jsx'));
const Persetujuan = lazy(() => import('./pages/Persetujuan.jsx'));
const AnggaranKas = lazy(() => import('./pages/AnggaranKas.jsx'));
const TransferMassal = lazy(() => import('./pages/TransferMassal.jsx'));
const Pengingat = lazy(() => import('./pages/Pengingat.jsx'));
const Cadangan = lazy(() => import('./pages/Cadangan.jsx'));

export default function App() {
  const { user } = useApp();
  const loc = useLocation();
  // Halaman verifikasi dokumen (hasil pindai QR) terbuka untuk publik tanpa login
  if (loc.pathname.startsWith('/v/')) {
    return <Suspense fallback={<Loading />}><Routes><Route path="/v/:kode" element={<VerifikasiDokumen />} /></Routes></Suspense>;
  }
  if (user === undefined) return <Loading text="Menyiapkan aplikasi…" />;
  if (!user) return <Login />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/cetak/bku" element={<CetakBku />} />
        <Route path="/cetak/kuitansi/:id" element={<Kuitansi />} />
        <Route path="/cetak/sts/:id" element={<CetakSts />} />
        <Route path="/cetak/spj-pembantu/:id" element={<CetakSpjPembantu />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="bku" element={<Bku />} />
          <Route path="penutupan-kas" element={<PenutupanKas />} />
          <Route path="rekonsiliasi" element={<Rekonsiliasi />} />
          <Route path="tutup-buku" element={<TutupBuku />} />
          <Route path="spj" element={<Spj />} />
          <Route path="buku-pembantu" element={<BukuPembantu />} />
          <Route path="peringatan" element={<Peringatan />} />
          <Route path="spp" element={<Spp />} />
          <Route path="panjar" element={<Panjar />} />
          <Route path="penerimaan" element={<Penerimaan />} />
          <Route path="pembantu" element={<Pembantu />} />
          <Route path="tutup-tahun" element={<TutupTahun />} />
          <Route path="persetujuan" element={<Persetujuan />} />
          <Route path="anggaran-kas" element={<AnggaranKas />} />
          <Route path="transfer" element={<TransferMassal />} />
          <Route path="pengingat" element={<Pengingat />} />
          <Route path="cadangan" element={<Cadangan />} />
          <Route path="laporan-pimpinan" element={<LaporanPimpinan />} />
          <Route path="pajak/kalkulator" element={<Kalkulator />} />
          <Route path="pajak/register" element={<RegisterPajak />} />
          <Route path="pajak/coretax" element={<Coretax />} />
          <Route path="olah-data" element={<OlahData />} />
          <Route path="realisasi" element={<Realisasi />} />
          <Route path="laporan" element={<Laporan />} />
          <Route path="master" element={<Master />} />
          <Route path="sistem" element={<Sistem />} />
          <Route path="audit" element={<Audit />} />
          <Route path="pengguna" element={<Pengguna />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
