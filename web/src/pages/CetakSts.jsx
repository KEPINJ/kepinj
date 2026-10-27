import { useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { terbilang } from '@shared/terbilang.js';
import { api } from '../lib/api.js';
import { Button, Loading, useLoad } from '../components/ui.jsx';
import { money, tgl } from '../lib/format.js';
import DocQr from '../components/DocQr.jsx';

export default function CetakSts() {
  const { id } = useParams();
  const { data, loading } = useLoad(() => api.get(`/api/sts/${id}`), [id]);
  if (loading || !data) return <Loading />;
  const { sts: s, skpd, rincian, per_rekening: perRek } = data;
  const cell = 'border border-black px-2 py-1';
  return (
    <div className="theme-light min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4 portrait; margin: 15mm; } }'}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[800px] justify-end px-4"><Button icon={Printer} onClick={() => window.print()}>Cetak STS</Button></div>
      <div className="print-area mx-auto max-w-[800px] bg-white p-10 text-[12px] text-black shadow-lg">
        <div className="border-b-2 border-black pb-3 text-center">
          <p className="font-bold uppercase">Pemerintah Daerah</p>
          <p className="font-bold uppercase">{skpd.nama}</p>
          <p className="text-[11px]">{skpd.alamat}</p>
        </div>
        <h1 className="mt-4 text-center text-lg font-bold tracking-wide">SURAT TANDA SETORAN</h1>
        <p className="text-center">(STS)</p>
        <table className="mt-4 w-full"><tbody>
          <tr><td className="w-44 py-1">STS No.</td><td className="py-1">: <b>{s.nomor}</b></td></tr>
          <tr><td className="py-1">Harap diterima uang sebesar</td><td className="py-1">: <b>Rp {money(s.total)}</b></td></tr>
          <tr><td className="py-1 align-top">Dengan huruf</td><td className="py-1 font-semibold italic">: {terbilang(Number(s.total))}</td></tr>
          <tr><td className="py-1">Disetor ke</td><td className="py-1">: {s.bank}{s.no_bukti_bank && ` · ref. ${s.no_bukti_bank}`}</td></tr>
          <tr><td className="py-1 align-top">Keterangan</td><td className="py-1">: {s.uraian}</td></tr>
        </tbody></table>
        <p className="mt-4 font-semibold">Dengan rincian penerimaan sebagai berikut:</p>
        <table className="mt-1 w-full border-collapse">
          <thead><tr><th className={cell}>No</th><th className={cell}>Kode Rekening</th><th className={cell}>Uraian Rincian Objek</th><th className={cell}>Jumlah (Rp)</th></tr></thead>
          <tbody>
            {perRek.map((r, i) => <tr key={r.kode_rekening}><td className={`${cell} text-center`}>{i + 1}</td><td className={`${cell} font-mono`}>{r.kode_rekening}</td><td className={cell}>{r.nama}</td><td className={`${cell} text-right`}>{money(r.nilai)}</td></tr>)}
            <tr className="font-bold"><td className={cell} colSpan={3}>Jumlah</td><td className={`${cell} text-right`}>{money(s.total)}</td></tr>
          </tbody>
        </table>
        <p className="mt-4">Uang tersebut di atas telah kami terima pada tanggal {tgl(s.tanggal, { long: true })}.</p>
        <div className="mt-6 grid grid-cols-3 gap-6 text-center text-[11px]">
          <div><p>Mengetahui,</p><p>Pengguna Anggaran</p><div className="h-16" /><p className="font-semibold underline">{skpd.kepala_nama}</p><p>NIP. {skpd.kepala_nip}</p></div>
          <div><p>Diterima oleh,</p><p>Petugas Tempat Pembayaran</p><div className="h-16" /><p className="font-semibold underline">……………………</p></div>
          <div><p>{tgl(s.tanggal, { long: true })}</p><p>Bendahara Penerimaan</p><div className="h-16" /><p className="font-semibold underline">{s.dibuat_oleh}</p></div>
        </div>
        <p className="mt-8 text-[11px] font-semibold">Lampiran: daftar Tanda Bukti Penerimaan yang disetor</p>
        <table className="mt-1 w-full border-collapse text-[10.5px]">
          <thead><tr><th className={cell}>Tanggal</th><th className={cell}>No. TBP</th><th className={cell}>Uraian</th><th className={cell}>Penyetor</th><th className={cell}>Jumlah</th></tr></thead>
          <tbody>{rincian.map((r, i) => <tr key={i}><td className={`${cell} whitespace-nowrap`}>{tgl(r.tanggal)}</td><td className={cell}>{r.no_bukti}</td><td className={cell}>{r.uraian}</td><td className={cell}>{r.penyetor || '-'}</td><td className={`${cell} text-right`}>{money(r.nilai)}</td></tr>)}</tbody>
        </table>
        <div className="mt-6 flex justify-end"><DocQr jenis="sts" skpdId={s.skpd_id} parameter={{ sts_id: s.id }} /></div>
      </div>
    </div>
  );
}
