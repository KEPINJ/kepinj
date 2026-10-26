import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookCopy, Printer, Download, ChevronLeft, Wallet, Landmark, Layers, Coins, Receipt } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Button, Card, PageHeader, Progress, Select, Skeleton, Tabs, useLoad, useToast } from '../components/ui.jsx';
import { BULAN, money, tgl } from '../lib/format.js';
import { Ttd } from './PenutupanKas.jsx';

const JENIS = [
  { value: 'tunai', label: 'Kas Tunai', icon: Wallet, judul: 'BUKU PEMBANTU KAS TUNAI' },
  { value: 'bank', label: 'Simpanan/Bank', icon: Landmark, judul: 'BUKU PEMBANTU SIMPANAN/BANK' },
  { value: 'rincian', label: 'Rincian Objek Belanja', icon: Layers, judul: 'BUKU PEMBANTU RINCIAN OBJEK BELANJA' },
  { value: 'upgu', label: 'UP/GU/TU', icon: Coins, judul: 'BUKU PEMBANTU UP/GU/TU' },
];
const c = 'border border-black px-1.5 py-0.5';

export default function BukuPembantu() {
  const { skpdId, tahun } = useApp();
  const toast = useToast();
  const [jenis, setJenis] = useState('tunai');
  const [bulan, setBulan] = useState(tahun === new Date().getFullYear() ? new Date().getMonth() + 1 : '');
  const [kode, setKode] = useState('');
  const params = { skpd_id: skpdId, tahun, jenis, bulan, kode_rekening: jenis === 'rincian' ? kode : '' };
  const { data: d, loading, error, reload } = useLoad(() => skpdId && api.get('/api/buku-pembantu', params), [skpdId, tahun, jenis, bulan, kode]);
  useLive((e) => e.type.startsWith('bku') && reload(), 1500);
  const info = JENIS.find((j) => j.value === jenis);
  const periode = bulan ? `Bulan ${BULAN[bulan - 1]} ${tahun}` : `Tahun Anggaran ${tahun}`;

  return (
    <div className="space-y-4">
      <PageHeader icon={BookCopy} title="Buku Pembantu" subtitle="Buku pembantu bendahara pengeluaran yang terisi otomatis dari BKU"
        actions={<>
          <Select className="!w-auto" value={bulan} onChange={(e) => setBulan(e.target.value ? Number(e.target.value) : '')} placeholder="Setahun" options={BULAN.map((b, i) => ({ value: i + 1, label: b }))} />
          <Button variant="secondary" icon={Download} onClick={() => download('/api/buku-pembantu', { params: { ...params, format: 'xlsx' } }).catch((e) => toast(e.message, 'error'))}>Excel</Button>
          <Button icon={Printer} disabled={jenis === 'rincian' && !kode} onClick={() => window.print()}>Cetak</Button>
        </>} />
      <div className="no-print flex flex-wrap items-center gap-2">
        <Tabs value={jenis} onChange={(v) => { setJenis(v); setKode(''); }} tabs={JENIS} />
        <Link to="/pajak/register" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"><Receipt className="h-4 w-4" />Pajak</Link>
      </div>
      {error && <Alert tone="error">{error.message}</Alert>}
      {loading && !d ? <Card><div className="space-y-2">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div></Card>
        : d?.daftar ? <DaftarRincian rows={d.daftar} onPick={setKode} />
          : d && (
            <div className="theme-light print-area overflow-x-auto rounded-2xl bg-white p-6 text-[11px] text-black shadow-card ring-1 ring-slate-200">
              {jenis === 'rincian' && <button type="button" className="no-print mb-3 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" onClick={() => setKode('')}><ChevronLeft className="h-3.5 w-3.5" />Semua rekening</button>}
              <div className="min-w-[900px]">
                <div className="text-center">
                  <p className="text-[12px] font-bold uppercase">{d.skpd.nama}</p>
                  <p className="mt-1 text-[13px] font-bold">{info.judul}</p>
                  <p>{periode}</p>
                </div>
                {jenis === 'rincian' && (
                  <table className="mt-3"><tbody>
                    <tr><td className="pr-3">Kode rekening</td><td>: {d.kode_rekening} {d.nama}</td></tr>
                    <tr><td className="pr-3">Pagu anggaran</td><td>: Rp {money(d.pagu)}</td></tr>
                    <tr><td className="pr-3">Realisasi s.d. periode lalu</td><td>: Rp {money(d.realisasi_awal)}</td></tr>
                  </tbody></table>
                )}
                <table className="mt-3 w-full border-collapse">
                  <thead className="bg-slate-100"><tr>
                    {['No BKU', 'Tanggal', 'No. Bukti', 'Uraian', ...(jenis === 'rincian' ? ['Realisasi', 'Jumlah s.d.', 'Sisa Pagu'] : ['Penerimaan', 'Pengeluaran', 'Saldo'])].map((h) => <th key={h} className={c}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {jenis !== 'rincian' && <tr><td className={c} colSpan={6}>Saldo awal</td><td className={`${c} text-right`}>{money(d.saldo_awal)}</td></tr>}
                    {d.rows.map((r) => (
                      <tr key={r.id} style={{ breakInside: 'avoid' }}>
                        <td className={`${c} text-center`}>{r.no_urut}</td><td className={`${c} whitespace-nowrap`}>{tgl(r.tanggal)}</td><td className={c}>{r.no_bukti}</td><td className={c}>{r.uraian}</td>
                        {jenis === 'rincian' ? (<>
                          <td className={`${c} text-right`}>{money(r.nilai)}</td><td className={`${c} text-right`}>{money(r.kumulatif)}</td><td className={`${c} text-right`}>{money(r.sisa_pagu)}</td>
                        </>) : (<>
                          <td className={`${c} text-right`}>{r.masuk ? money(r.masuk) : ''}</td><td className={`${c} text-right`}>{r.keluar ? money(r.keluar) : ''}</td><td className={`${c} text-right`}>{money(r.saldo)}</td>
                        </>)}
                      </tr>
                    ))}
                    {!d.rows.length && <tr><td className={`${c} text-center italic`} colSpan={7}>Tidak ada transaksi pada periode ini</td></tr>}
                    <tr className="font-bold">
                      {jenis === 'rincian' ? (<><td className={c} colSpan={4}>Realisasi s.d. akhir periode</td><td className={c} /><td className={`${c} text-right`}>{money(d.realisasi_akhir)}</td><td className={`${c} text-right`}>{money(d.pagu - d.realisasi_akhir)}</td></>)
                        : (<><td className={c} colSpan={4}>Jumlah / saldo akhir</td><td className={`${c} text-right`}>{money(d.penerimaan)}</td><td className={`${c} text-right`}>{money(d.pengeluaran)}</td><td className={`${c} text-right`}>{money(d.saldo_akhir)}</td></>)}
                    </tr>
                  </tbody>
                </table>
                <div style={{ breakInside: 'avoid' }}><Ttd skpd={d.skpd} tanggal={d.sampai} /></div>
              </div>
            </div>
          )}
    </div>
  );
}

function DaftarRincian({ rows, onPick }) {
  return (
    <Card title="Pilih kode rekening belanja" subtitle="Klik rekening untuk membuka buku pembantu rincian objeknya" bodyClass="overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead><tr><th className="th">Kode rekening</th><th className="th">Uraian</th><th className="th text-right">Pagu</th><th className="th text-right">Realisasi</th><th className="th w-40">Serapan</th><th className="th text-right">Sisa</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const p = r.pagu ? (r.realisasi / r.pagu) * 100 : 0;
            return (
              <tr key={r.kode_rekening} onClick={() => onPick(r.kode_rekening)} className="cursor-pointer hover:bg-brand-50/50">
                <td className="td whitespace-nowrap font-mono text-xs">{r.kode_rekening}</td><td className="td">{r.nama}</td>
                <td className="td num text-right">{money(r.pagu)}</td><td className="td num text-right">{money(r.realisasi)}</td>
                <td className="td"><div className="flex items-center gap-2"><Progress value={p} className="h-1.5" /><span className="num w-10 text-right text-xs text-slate-600">{p.toFixed(0)}%</span></div></td>
                <td className="td num text-right">{money(r.sisa)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
