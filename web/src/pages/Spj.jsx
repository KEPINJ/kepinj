import { useState } from 'react';
import { FileCheck2, Printer, Download } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Button, Card, PageHeader, Select, Skeleton, Tabs, useLoad, useToast } from '../components/ui.jsx';
import { BULAN, money as money2, num, tgl } from '../lib/format.js';
import { Ttd } from './PenutupanKas.jsx';

const KELAS = [['ls_gaji', 'LS Gaji'], ['ls_barang', 'LS Barang & Jasa'], ['upgu', 'UP/GU/TU']];
const PAJAK = ['PPN', 'PPh 21', 'PPh 22', 'PPh 23', 'PPh 4 ayat (2)'];
const PENERIMAAN = [['sp2d_ls_gaji', 'SP2D LS Gaji'], ['sp2d_ls_barang', 'SP2D LS Barang & Jasa'], ['sp2d_upgutu', 'SP2D UP/GU/TU'],
  ...PAJAK.map((j) => [`pungut_${j}`, `Potongan ${j}`]), ['terima_lain', 'Lain-lain']];
const PENGELUARAN = [['spj_ls_gaji', 'SPJ LS Gaji'], ['spj_ls_barang', 'SPJ LS Barang & Jasa'], ['spj_upgutu', 'SPJ UP/GU/TU'],
  ...PAJAK.map((j) => [`setor_${j}`, `Penyetoran ${j}`]), ['keluar_lain', 'Lain-lain']];

const money = (v) => num(v);
const m = (v) => (v ? num(v) : '-');
const c = 'border border-black px-1 py-0.5 [&.text-right]:whitespace-nowrap';

export default function Spj() {
  const { skpdId, tahun } = useApp();
  const toast = useToast();
  const now = new Date();
  const [bulan, setBulan] = useState(tahun === now.getFullYear() ? Math.max(1, now.getMonth()) : 12);
  const [versi, setVersi] = useState('fungsional');
  const { data: d, loading, error, reload } = useLoad(() => skpdId && api.get('/api/spj', { skpd_id: skpdId, tahun, bulan }), [skpdId, tahun, bulan]);
  useLive((e) => e.type.startsWith('bku') && reload(), 1500);

  return (
    <div className="space-y-4">
      <PageHeader icon={FileCheck2} title="SPJ Bendahara Pengeluaran" subtitle="Laporan pertanggungjawaban fungsional & administratif otomatis dari BKU (Permendagri 77/2020)"
        actions={<>
          <Select className="!w-auto" value={bulan} onChange={(e) => setBulan(Number(e.target.value))} options={BULAN.map((b, i) => ({ value: i + 1, label: `${b} ${tahun}` }))} />
          <Button variant="secondary" icon={Download} onClick={() => download('/api/spj', { params: { skpd_id: skpdId, tahun, bulan, versi, format: 'xlsx' } }).catch((e) => toast(e.message, 'error'))}>Excel</Button>
          <Button icon={Printer} onClick={() => window.print()}>Cetak / PDF</Button>
        </>} />
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Tabs value={versi} onChange={setVersi} tabs={[{ value: 'fungsional', label: 'SPJ Fungsional (ke PPKD)' }, { value: 'administratif', label: 'SPJ Administratif (ke PA)' }]} />
        {d && <p className="text-xs text-slate-500">Realisasi s.d. {tgl(d.akhir, { long: true })}: <b className="num text-slate-700">Rp {money2(d.total.jumlah_sd)}</b> dari pagu Rp {money2(d.total.pagu)}</p>}
      </div>
      {error && <Alert tone="error">{error.message}</Alert>}
      {loading && !d ? <Card><div className="space-y-2">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div></Card> : d && (
        <div className="theme-light print-area overflow-x-auto rounded-2xl bg-white p-6 text-[10px] text-black shadow-card ring-1 ring-slate-200">
          <div className="min-w-[1100px]">
            <div className="text-center">
              <p className="text-[12px] font-bold">PEMERINTAH DAERAH</p>
              <p className="text-[12px] font-bold uppercase">{d.skpd.nama}</p>
              <p className="mt-1 text-[13px] font-bold">LAPORAN PERTANGGUNGJAWABAN BENDAHARA PENGELUARAN</p>
              <p className="text-[12px] font-bold">(SPJ BELANJA - {versi.toUpperCase()})</p>
              <p className="mt-0.5">Bulan {d.nama_bulan} Tahun Anggaran {tahun}</p>
            </div>
            <table className="mt-3 text-[10px]"><tbody>
              <tr><td className="pr-3">SKPD</td><td>: {d.skpd.kode} {d.skpd.nama}</td></tr>
              <tr><td className="pr-3">Pengguna Anggaran</td><td>: {d.skpd.kepala_nama}</td></tr>
              <tr><td className="pr-3">Bendahara Pengeluaran</td><td>: {d.skpd.bendahara_nama}</td></tr>
            </tbody></table>

            <table className="mt-3 w-full border-collapse">
              <thead className="bg-slate-100 text-center">
                <tr>
                  <th rowSpan={2} className={c}>Kode Rekening</th><th rowSpan={2} className={c}>Uraian</th><th rowSpan={2} className={c}>Jumlah Anggaran</th>
                  {KELAS.map(([k, l]) => <th key={k} colSpan={3} className={c}>SPJ {l}</th>)}
                  <th rowSpan={2} className={c}>Jumlah SPJ s.d. Bulan Ini</th><th rowSpan={2} className={c}>Sisa Pagu Anggaran</th>
                </tr>
                <tr>{KELAS.map(([k]) => ['s.d. Bulan Lalu', 'Bulan Ini', 's.d. Bulan Ini'].map((h) => <th key={k + h} className={`${c} font-normal`}>{h}</th>))}</tr>
                <tr>{Array.from({ length: 14 }, (_, i) => <th key={i} className={`${c} text-[8px] font-normal`}>{i + 1}</th>)}</tr>
              </thead>
              <tbody>
                {d.rekening.map((r) => (
                  <tr key={r.kode_rekening} style={{ breakInside: 'avoid' }}>
                    <td className={`${c} whitespace-nowrap`}>{r.kode_rekening}</td><td className={`${c} min-w-[190px]`}>{r.nama}</td>
                    <td className={`${c} text-right`}>{m(r.pagu)}</td>
                    {KELAS.map(([k]) => ['lalu', 'ini', 'sd'].map((p) => <td key={k + p} className={`${c} text-right`}>{m(r[k][p])}</td>))}
                    <td className={`${c} text-right font-semibold`}>{m(r.jumlah_sd)}</td><td className={`${c} text-right`}>{money(r.sisa)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className={c} colSpan={2}>JUMLAH</td><td className={`${c} text-right`}>{money(d.total.pagu)}</td>
                  {KELAS.map(([k]) => ['lalu', 'ini', 'sd'].map((p) => <td key={k + p} className={`${c} text-right`}>{m(d.total[k][p])}</td>))}
                  <td className={`${c} text-right`}>{money(d.total.jumlah_sd)}</td><td className={`${c} text-right`}>{money(d.total.sisa)}</td>
                </tr>
              </tbody>
            </table>

            <div className="mt-4 grid grid-cols-2 gap-6" style={{ breakInside: 'avoid' }}>
              <Arus title="PENERIMAAN" rows={PENERIMAAN} arus={d.arus} jumlah={d.jumlah_penerimaan} />
              <Arus title="PENGELUARAN" rows={PENGELUARAN} arus={d.arus} jumlah={d.jumlah_pengeluaran} />
            </div>
            <table className="mt-3 w-[60%] border-collapse" style={{ breakInside: 'avoid' }}><tbody>
              <tr><td className={c}>Saldo kas s.d. akhir bulan</td><td className={`${c} text-right font-bold`}>{money(d.saldo_kas.saldo)}</td></tr>
              <tr><td className={c}>&nbsp;&nbsp;terdiri dari: Saldo bank</td><td className={`${c} text-right`}>{money(d.saldo_kas.bank)}</td></tr>
              <tr><td className={c}>&nbsp;&nbsp;Kas tunai</td><td className={`${c} text-right`}>{money(d.saldo_kas.tunai)}</td></tr>
            </tbody></table>
            <p className="mt-1 italic">Terbilang: {d.terbilang_saldo}</p>
            <div style={{ breakInside: 'avoid' }}><Ttd skpd={d.skpd} tanggal={d.akhir} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Arus({ title, rows, arus, jumlah }) {
  return (
    <table className="w-full border-collapse">
      <thead className="bg-slate-100"><tr><th className={`${c} text-left`}>{title}</th><th className={c}>s.d. Bulan Lalu</th><th className={c}>Bulan Ini</th><th className={c}>s.d. Bulan Ini</th></tr></thead>
      <tbody>
        {rows.map(([k, l]) => (
          <tr key={k}><td className={c}>{l}</td>{['lalu', 'ini', 'sd'].map((p) => <td key={p} className={`${c} text-right`}>{m(arus[k][p])}</td>)}</tr>
        ))}
        <tr className="font-bold"><td className={c}>Jumlah {title.toLowerCase()}</td>{['lalu', 'ini', 'sd'].map((p) => <td key={p} className={`${c} text-right`}>{money(jumlah[p])}</td>)}</tr>
      </tbody>
    </table>
  );
}
