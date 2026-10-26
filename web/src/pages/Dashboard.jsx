import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Wallet, ArrowDownLeft, ArrowUpRight, Receipt, ClipboardCheck, Building2, Landmark, Coins } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Card, Stat, Loading, Alert, Badge, Progress, PageHeader, Tabs, Empty, cx } from '../components/ui.jsx';
import { rp, compact, BULAN_SINGKAT, tgl, JENIS_PAJAK } from '../lib/format.js';
import { SERIES, PAJAK_COLOR } from '../lib/palette.js';
import { useLoad } from '../components/ui.jsx';

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-700">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: <span className="num font-medium text-slate-800">{rp(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { skpdId, tahun, can, skpd } = useApp();
  const [scope, setScope] = useState('skpd');
  const semua = scope === 'semua';
  const { data, loading, error, reload } = useLoad(() => skpdId && api.get('/api/dashboard', { skpd_id: skpdId, tahun, semua: semua ? 1 : '' }), [skpdId, tahun, semua]);
  const [flash, setFlash] = useState(null);
  useLive((evt) => { if (evt.type.startsWith('bku') || evt.type.startsWith('pajak')) { reload(); setFlash(evt.data?.id); setTimeout(() => setFlash(null), 3000); } }, 600);

  if (loading && !data) return <Loading />;
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (!data) return null;
  const k = data.kpi;
  const pajakBelum = data.pajak.filter((p) => p.status === 'dipungut').reduce((s, p) => s + p.nominal, 0);
  const pajakPerJenis = Object.keys(JENIS_PAJAK).map((j) => ({ jenis: j, total: data.pajak.filter((p) => p.jenis_pajak === j).reduce((s, p) => s + p.nominal, 0), belum: data.pajak.filter((p) => p.jenis_pajak === j && p.status === 'dipungut').reduce((s, p) => s + p.nominal, 0) })).filter((x) => x.total > 0);
  const maxPajak = Math.max(1, ...pajakPerJenis.map((p) => p.total));
  const persenReal = Number(data.realisasi.pagu) ? (Number(data.realisasi.realisasi) / Number(data.realisasi.pagu)) * 100 : 0;
  const chart = data.bulanan.map((b) => ({ ...b, nama: BULAN_SINGKAT[b.bulan - 1] }));

  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard" subtitle={`${semua ? 'Seluruh SKPD' : skpd?.nama || ''} · Tahun Anggaran ${tahun}`}
        actions={can('admin', 'pimpinan') && <Tabs value={scope} onChange={setScope} tabs={[{ value: 'skpd', label: 'SKPD terpilih' }, { value: 'semua', label: 'Konsolidasi semua SKPD' }]} />} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Saldo kas" value={rp(k.saldo_bank + k.saldo_tunai)} sub={<span>Bank {compact(k.saldo_bank)} · Tunai {compact(k.saldo_tunai)}</span>} icon={Wallet} />
        <Stat label="Total penerimaan" value={rp(k.penerimaan)} sub={`Bulan ini ${compact(k.penerimaan_bulan_ini)}`} icon={ArrowDownLeft} tone="green" />
        <Stat label="Total pengeluaran" value={rp(k.pengeluaran)} sub={`Bulan ini ${compact(k.pengeluaran_bulan_ini)}`} icon={ArrowUpRight} tone="red" />
        <Stat label="Pajak belum disetor" value={rp(pajakBelum)} sub={<Link to="/pajak/register" className="text-brand-700 hover:underline">Buka register pajak →</Link>} icon={Receipt} tone="amber" />
      </div>

      {(data.belum_verifikasi > 0 || pajakBelum > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.belum_verifikasi > 0 && <Alert tone="warn" title={`${data.belum_verifikasi.toLocaleString('id-ID')} transaksi belum diverifikasi`}>Verifikator dapat memeriksa di menu <Link className="font-medium underline" to="/bku?verif=belum">Buku Kas Umum</Link>.</Alert>}
          {pajakBelum > 0 && <Alert tone="info" title="Pengingat setor pajak">PPh dan PPN yang dipungut wajib disetor paling lambat tanggal 15 bulan berikutnya, lalu dilaporkan melalui Coretax.</Alert>}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Arus kas bulanan" subtitle="Penerimaan dan pengeluaran per bulan (dari proyeksi event stream)">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={chart} barGap={2} margin={{ left: 8, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--slate-100))" />
                <XAxis dataKey="nama" tickLine={false} axisLine={{ stroke: 'rgb(var(--slate-300))' }} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} />
                <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} width={56} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(15,61,94,.05)' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'rgb(var(--slate-600))' }} />
                <Bar dataKey="penerimaan" name="Penerimaan" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="pengeluaran" name="Pengeluaran" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Realisasi anggaran belanja" subtitle={`Pagu ${rp(data.realisasi.pagu)}`}>
          <div className="mb-4">
            <div className="flex items-end justify-between"><span className="num text-3xl font-semibold text-slate-900">{persenReal.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</span><span className="num text-xs text-slate-500">{rp(data.realisasi.realisasi)}</span></div>
            <Progress value={persenReal} className="mt-2 h-2.5" />
          </div>
          {data.realisasi.rekening ? (
            <div className="space-y-3">
              {data.realisasi.rekening.map((r) => {
                const p = Number(r.pagu) ? (Number(r.realisasi) / Number(r.pagu)) * 100 : 0;
                return (
                  <div key={r.kode_rekening}>
                    <div className="flex justify-between gap-2 text-xs"><span className="truncate text-slate-600" title={r.nama}>{r.nama}</span><span className="num shrink-0 font-medium text-slate-700">{p.toFixed(0)}%</span></div>
                    <Progress value={p} className="mt-1 h-1.5" />
                  </div>
                );
              })}
              <Link to="/realisasi" className="block pt-1 text-xs font-medium text-brand-700 hover:underline">Lihat semua rekening →</Link>
            </div>
          ) : <p className="text-xs text-slate-500">Rincian per rekening tersedia saat memilih satu SKPD.</p>}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Pajak dipungut per jenis" subtitle="Bagian muda = belum disetor">
          {pajakPerJenis.length ? (
            <div className="space-y-3.5">
              {pajakPerJenis.map((p) => (
                <div key={p.jenis}>
                  <div className="flex justify-between text-xs"><span className="font-medium text-slate-700">{JENIS_PAJAK[p.jenis]}</span><span className="num text-slate-600">{rp(p.total)}</span></div>
                  <div className="mt-1 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-slate-100" title={`Disetor ${rp(p.total - p.belum)} · Belum ${rp(p.belum)}`}>
                    <div className="h-full rounded-l-full" style={{ width: `${((p.total - p.belum) / maxPajak) * 100}%`, background: PAJAK_COLOR[p.jenis] }} />
                    {p.belum > 0 && <div className="h-full rounded-r-full opacity-40" style={{ width: `${(p.belum / maxPajak) * 100}%`, background: PAJAK_COLOR[p.jenis] }} />}
                  </div>
                  {p.belum > 0 && <p className="mt-0.5 text-[11px] text-amber-700">Belum disetor {rp(p.belum)}</p>}
                </div>
              ))}
            </div>
          ) : <Empty title="Belum ada pajak" />}
        </Card>

        <Card className="xl:col-span-2" title="Transaksi terbaru" subtitle="Diperbarui otomatis saat ada transaksi baru"
          actions={<Link to="/bku" className="text-xs font-medium text-brand-700 hover:underline">Buka BKU →</Link>} bodyClass="">
          <ul className="divide-y divide-slate-100">
            {data.terbaru.map((t) => {
              const masuk = Number(t.penerimaan) > 0;
              return (
                <li key={t.id} className={cx('flex items-center gap-3 px-4 py-2.5 transition-colors', flash === t.id && 'bg-emerald-50')}>
                  <div className={cx('rounded-lg p-1.5', masuk ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700')}>{masuk ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">{t.uraian}</p>
                    <p className="text-[11px] text-slate-500">{tgl(t.tanggal)} · No. {t.no_urut} · {t.no_bukti}{semua && ` · ${t.skpd_kode}`}</p>
                  </div>
                  <span className={cx('num shrink-0 text-sm font-medium', masuk ? 'text-brand-700' : 'text-slate-700')}>{masuk ? '+' : '−'}{rp(Number(t.penerimaan) || Number(t.pengeluaran))}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {semua && (
        <Card title="Posisi kas per SKPD" bodyClass="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">SKPD</th><th className="th text-right">Penerimaan</th><th className="th text-right">Pengeluaran</th><th className="th text-right">Saldo</th><th className="th text-right">Transaksi</th></tr></thead>
            <tbody>
              {data.per_skpd.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="td"><div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-slate-400" /><div><p className="font-medium">{s.nama}</p><p className="text-[11px] text-slate-500">{s.kode}</p></div></div></td>
                  <td className="td num text-right">{rp(s.penerimaan)}</td><td className="td num text-right">{rp(s.pengeluaran)}</td>
                  <td className="td num text-right font-semibold">{rp(s.saldo)}</td><td className="td num text-right">{s.transaksi.toLocaleString('id-ID')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <QuickLink to="/bku?baru=1" icon={Coins} title="Catat transaksi" text="Belanja, SP2D, penerimaan, dengan hitung pajak otomatis" />
        <QuickLink to="/olah-data" icon={ClipboardCheck} title="Upload & olah data" text="Unggah Excel/CSV, hitung otomatis, ekspor atau simpan" />
        <QuickLink to="/pajak/coretax" icon={Landmark} title="Ekspor ke Coretax" text="Buat XML bukti potong siap unggah" />
      </div>
    </div>
  );
}

function QuickLink({ to, icon: Icon, title, text }) {
  return (
    <Link to={to} className="card group flex items-center gap-3 p-4 transition hover:border-brand-300 hover:shadow-md">
      <div className="rounded-xl bg-brand-800 p-2.5 text-gold-400 transition group-hover:scale-105"><Icon className="h-5 w-5" /></div>
      <div><p className="text-sm font-semibold text-slate-800">{title}</p><p className="text-xs text-slate-500">{text}</p></div>
    </Link>
  );
}
