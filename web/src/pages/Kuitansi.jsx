import { useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Loading, useLoad } from '../components/ui.jsx';
import { money, tgl, JENIS_PAJAK } from '../lib/format.js';

export default function Kuitansi() {
  const { id } = useParams();
  const { data, loading } = useLoad(() => api.get(`/api/bku/${id}`), [id]);
  if (loading || !data) return <Loading />;
  const { entry: e, skpd: s, pajak } = data;
  const nilai = Number(e.pengeluaran) || Number(e.penerimaan);
  const potongan = pajak.reduce((a, p) => a + Number(p.nominal), 0);
  return (
    <div className="theme-light min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4 portrait; margin: 15mm; } }'}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[800px] justify-end px-4"><Button icon={Printer} onClick={() => window.print()}>Cetak kuitansi</Button></div>
      <div className="print-area mx-auto max-w-[800px] bg-white p-10 text-[13px] text-black shadow-lg">
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div><p className="font-bold uppercase">{s.nama}</p><p className="text-xs">{s.alamat}</p></div>
          <div className="text-right text-xs"><p>No. BKU: {e.no_urut}</p><p>No. Bukti: {e.no_bukti}</p><p>Kode Rek.: {e.kode_rekening || '-'}</p></div>
        </div>
        <h1 className="my-5 text-center text-xl font-bold tracking-[0.3em]">KUITANSI</h1>
        <table className="w-full"><tbody>
          <tr><td className="w-44 py-1.5 align-top">Sudah terima dari</td><td className="py-1.5">: Bendahara Pengeluaran {s.nama}</td></tr>
          <tr><td className="py-1.5 align-top">Uang sebesar</td><td className="py-1.5 font-semibold italic">: {data.terbilang}</td></tr>
          <tr><td className="py-1.5 align-top">Untuk pembayaran</td><td className="py-1.5">: {e.uraian}</td></tr>
          {e.rekanan_nama && <tr><td className="py-1.5 align-top">Penerima</td><td className="py-1.5">: {e.rekanan_nama}{e.rekanan_npwp && ` (NPWP ${e.rekanan_npwp})`}{e.rekanan_bank && ` · ${e.rekanan_bank} ${e.rekanan_no_rekening}`}</td></tr>}
        </tbody></table>
        {pajak.length > 0 && (
          <table className="ml-auto mt-4 w-80 text-xs"><tbody>
            <tr><td>Nilai bruto</td><td className="text-right">{money(nilai)}</td></tr>
            {pajak.map((p) => <tr key={p.id}><td>{JENIS_PAJAK[p.jenis_pajak]} ({Number(p.tarif)}%)</td><td className="text-right">({money(p.nominal)})</td></tr>)}
            <tr className="border-t border-black font-semibold"><td>Diterima bersih</td><td className="text-right">{money(nilai - potongan)}</td></tr>
          </tbody></table>
        )}
        <div className="mt-6 inline-block border-2 border-black px-4 py-2 text-lg font-bold">Rp {money(nilai)}</div>
        <div className="mt-8 grid grid-cols-3 gap-6 text-center text-xs">
          <div><p>Mengetahui,</p><p>Pengguna Anggaran</p><div className="h-16" /><p className="font-semibold underline">{s.kepala_nama}</p><p>NIP. {s.kepala_nip}</p></div>
          <div><p>Lunas dibayar,</p><p>Bendahara Pengeluaran</p><div className="h-16" /><p className="font-semibold underline">{s.bendahara_nama}</p><p>NIP. {s.bendahara_nip}</p></div>
          <div><p>{tgl(e.tanggal, { long: true })}</p><p>Yang menerima,</p><div className="h-16" /><p className="font-semibold underline">{e.rekanan_nama || '……………………'}</p></div>
        </div>
        <p className="mt-8 break-all text-[9px] text-slate-500">Segel integritas BKU: {e.hash}</p>
      </div>
    </div>
  );
}
