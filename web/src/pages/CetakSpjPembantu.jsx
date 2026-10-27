import { useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { terbilang } from '@shared/terbilang.js';
import { api } from '../lib/api.js';
import { Button, Loading, useLoad } from '../components/ui.jsx';
import { JENIS_PAJAK, money, tgl } from '../lib/format.js';
import DocQr from '../components/DocQr.jsx';

export default function CetakSpjPembantu() {
  const { id } = useParams();
  const { data, loading } = useLoad(() => api.get(`/api/pembantu/spj/${id}`), [id]);
  if (loading || !data) return <Loading />;
  const { spj: s, unit, skpd, rincian, per_rekening: perRek } = data;
  const cell = 'border border-black px-1.5 py-1';
  const pajak = (r) => (r.pajak || []).reduce((a, p) => a + Number(p.nominal || 0), 0);
  return (
    <div className="theme-light min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4 portrait; margin: 12mm; } }'}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[860px] justify-end px-4"><Button icon={Printer} onClick={() => window.print()}>Cetak SPJ</Button></div>
      <div className="print-area mx-auto max-w-[860px] bg-white p-10 text-[11px] text-black shadow-lg">
        <div className="text-center">
          <p className="text-sm font-bold uppercase">{skpd.nama}</p>
          <p className="mt-1 text-base font-bold">LAPORAN PERTANGGUNGJAWABAN BENDAHARA PENGELUARAN PEMBANTU</p>
          <p>{unit.nama} · Nomor {s.nomor}</p>
          <p>Belanja sampai dengan {tgl(s.sampai, { long: true })}</p>
          {s.status !== 'disahkan' && <p className="mt-1 inline-block border border-black px-2 font-bold uppercase">{s.status === 'diajukan' ? 'Draf: menunggu pengesahan' : 'Ditolak'}</p>}
        </div>
        <p className="mt-4 font-semibold">A. Rekapitulasi per kode rekening</p>
        <table className="mt-1 w-full border-collapse">
          <thead><tr><th className={cell}>No</th><th className={cell}>Kode Rekening</th><th className={cell}>Uraian</th><th className={cell}>Bukti</th><th className={cell}>Jumlah (Rp)</th></tr></thead>
          <tbody>
            {perRek.map((r, i) => <tr key={r.kode_rekening}><td className={`${cell} text-center`}>{i + 1}</td><td className={`${cell} font-mono`}>{r.kode_rekening}</td><td className={cell}>{r.nama}</td><td className={`${cell} text-center`}>{r.jumlah}</td><td className={`${cell} text-right`}>{money(r.nilai)}</td></tr>)}
            <tr className="font-bold"><td className={cell} colSpan={4}>Jumlah belanja</td><td className={`${cell} text-right`}>{money(s.total_belanja)}</td></tr>
          </tbody>
        </table>
        <p className="mt-1 italic">Terbilang: {terbilang(Number(s.total_belanja))}</p>
        <p className="mt-4 font-semibold">B. Rincian bukti belanja</p>
        <table className="mt-1 w-full border-collapse">
          <thead><tr><th className={cell}>Tanggal</th><th className={cell}>No. Bukti</th><th className={cell}>Uraian</th><th className={cell}>Rekanan</th><th className={cell}>Belanja</th><th className={cell}>Pajak dipungut</th></tr></thead>
          <tbody>
            {rincian.map((r) => (
              <tr key={r.id}><td className={`${cell} whitespace-nowrap`}>{tgl(r.tanggal)}</td><td className={cell}>{r.no_bukti}</td><td className={cell}>{r.uraian}<br /><span className="font-mono text-[9.5px]">{r.kode_rekening}</span></td>
                <td className={cell}>{r.rekanan_nama || '-'}</td><td className={`${cell} text-right`}>{money(r.pengeluaran)}</td>
                <td className={`${cell} text-right`}>{pajak(r) ? (r.pajak || []).map((p) => <div key={p.jenis_pajak}>{JENIS_PAJAK[p.jenis_pajak]} {money(p.nominal)}</div>) : '-'}</td></tr>
            ))}
            <tr className="font-bold"><td className={cell} colSpan={4}>Jumlah</td><td className={`${cell} text-right`}>{money(s.total_belanja)}</td><td className={`${cell} text-right`}>{money(s.total_pajak)}</td></tr>
          </tbody>
        </table>
        {s.catatan && <p className="mt-3">Catatan: {s.catatan}</p>}
        <div className="mt-8 grid grid-cols-2 gap-8 text-center text-[11.5px]">
          <div><p>{s.status === 'disahkan' ? `Disahkan ${tgl(String(s.diproses_at).slice(0, 10), { long: true })}` : 'Mengesahkan,'}</p><p>Bendahara Pengeluaran</p><div className="h-16" /><p className="font-semibold underline">{skpd.bendahara_nama}</p><p>NIP. {skpd.bendahara_nip}</p></div>
          <div><p>{tgl(s.tanggal, { long: true })}</p><p>Bendahara Pengeluaran Pembantu</p><div className="h-16" /><p className="font-semibold underline">{unit.bendahara_nama || s.diajukan_nama}</p><p>NIP. {unit.bendahara_nip || '-'}</p></div>
        </div>
        <div className="mt-6 flex justify-end"><DocQr jenis="spj_pembantu" skpdId={s.skpd_id} parameter={{ spj_id: s.id }} /></div>
      </div>
    </div>
  );
}
