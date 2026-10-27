import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Button, Loading, useLoad } from '../components/ui.jsx';
import { BULAN, money, tgl } from '../lib/format.js';
import { Ttd } from './PenutupanKas.jsx';
import DocQr from '../components/DocQr.jsx';

export default function CetakBku() {
  const { skpdId, tahun } = useApp();
  const [sp] = useSearchParams();
  const bulan = Number(sp.get('bulan')) || '';
  const { data, loading } = useLoad(() => skpdId && api.get('/api/laporan/bku', { skpd_id: skpdId, tahun, bulan }), [skpdId, tahun, bulan]);
  useEffect(() => { document.title = `BKU ${bulan ? BULAN[bulan - 1] : ''} ${tahun}`; }, [bulan, tahun]);
  if (loading || !data) return <Loading />;
  const s = data.skpd; const r = data.ringkasan;
  return (
    <div className="theme-light min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[1100px] justify-end px-4"><Button icon={Printer} onClick={() => window.print()}>Cetak / simpan PDF</Button></div>
      <div className="print-area mx-auto max-w-[1100px] bg-white p-10 text-[11px] text-black shadow-lg">
        <div className="text-center">
          <p className="text-sm font-bold">PEMERINTAH DAERAH</p>
          <p className="text-sm font-bold uppercase">{s.nama}</p>
          <p className="mt-2 text-base font-bold">BUKU KAS UMUM PENGELUARAN</p>
          <p>Periode {bulan ? `${BULAN[bulan - 1]} ` : ''}{tahun}</p>
        </div>
        <table className="mt-3"><tbody>
          <tr><td className="pr-3">SKPD</td><td>: {s.kode} {s.nama}</td></tr>
          <tr><td className="pr-3">Pengguna Anggaran</td><td>: {s.kepala_nama}</td></tr>
          <tr><td className="pr-3">Bendahara Pengeluaran</td><td>: {s.bendahara_nama}</td></tr>
        </tbody></table>
        <table className="mt-3 w-full border-collapse">
          <thead><tr className="bg-slate-100">{['No', 'Tanggal', 'No. Bukti', 'Uraian', 'Kode Rekening', 'Penerimaan', 'Pengeluaran', 'Saldo'].map((h) => <th key={h} className="border border-black px-1.5 py-1">{h}</th>)}</tr>
            <tr>{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <th key={n} className="border border-black text-[9px] font-normal">{n}</th>)}</tr></thead>
          <tbody>
            <tr><td className="border border-black px-1.5" colSpan={5}>Saldo awal periode</td><td className="border border-black" /><td className="border border-black" /><td className="border border-black px-1.5 text-right">{money(r.saldo_awal)}</td></tr>
            {data.rows.map((e) => (
              <tr key={e.id} style={{ breakInside: 'avoid' }}>
                <td className="border border-black px-1.5 text-center">{e.no_urut}</td><td className="whitespace-nowrap border border-black px-1.5">{tgl(e.tanggal)}</td>
                <td className="border border-black px-1.5">{e.no_bukti}</td><td className="border border-black px-1.5">{e.uraian}</td>
                <td className="whitespace-nowrap border border-black px-1.5">{e.kode_rekening}</td>
                <td className="whitespace-nowrap border border-black px-1.5 text-right">{Number(e.penerimaan) ? money(e.penerimaan) : ''}</td>
                <td className="whitespace-nowrap border border-black px-1.5 text-right">{Number(e.pengeluaran) ? money(e.pengeluaran) : ''}</td>
                <td className="whitespace-nowrap border border-black px-1.5 text-right">{money(e.saldo)}</td>
              </tr>
            ))}
            <tr className="font-bold"><td className="border border-black px-1.5" colSpan={5}>Jumlah periode ini</td><td className="border border-black px-1.5 text-right">{money(r.penerimaan)}</td><td className="border border-black px-1.5 text-right">{money(r.pengeluaran)}</td><td className="border border-black px-1.5 text-right">{money(r.saldo_akhir)}</td></tr>
          </tbody>
        </table>
        <p className="mt-3">Pada hari ini, tanggal {tgl(data.sampai, { long: true })}, oleh kami didapat dalam kas Rp {money(r.saldo_akhir)} ({data.terbilang_saldo}), terdiri dari saldo bank Rp {money(r.saldo_bank)} dan kas tunai Rp {money(r.saldo_tunai)}.</p>
        <Ttd skpd={s} tanggal={data.sampai} />
        <DocQr className="mt-6" jenis="bku" skpdId={skpdId} parameter={{ tahun, bulan: bulan || null }} />
      </div>
    </div>
  );
}
