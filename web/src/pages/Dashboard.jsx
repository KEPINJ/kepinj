import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area } from 'recharts';
import {
  Wallet, ArrowDownLeft, ArrowUpRight, Receipt, Building2, Landmark, Plus, Upload, FileCheck2, Target,
  ListTodo, AlertOctagon, AlertTriangle, Info, CheckCircle2, ArrowRight,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Card, Stat, Alert, Progress, PageHeader, Tabs, Empty, Skeleton, cx, useLoad } from '../components/ui.jsx';
import { rp, compact, BULAN_SINGKAT, tgl, JENIS_PAJAK } from '../lib/format.js';
import { SERIES, PAJAK_COLOR } from '../lib/palette.js';
import JatuhTempoPajak from '../components/JatuhTempoPajak.jsx';

const JENIS_LABEL = {
  BELANJA: 'Belanja (SPJ)', PAJAK_SETOR: 'Setoran pajak', PENYETORAN: 'Penyetoran ke kas daerah', SP2D_LS: 'LS langsung', KOREKSI: 'Koreksi', LAINNYA: 'Lainnya',
  SP2D_UP: 'SP2D UP', SP2D_GU: 'SP2D GU', SP2D_TU: 'SP2D TU', PENERIMAAN: 'Penerimaan lain', PAJAK_PUNGUT: 'Pungutan pajak',
};
const TUGAS = { bahaya: [AlertOctagon, 'text-rose-600 bg-rose-50'], peringatan: [AlertTriangle, 'text-amber-700 bg-amber-50'], info: [Info, 'text-brand-700 bg-brand-50'] };

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-700">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: <span className="num font-medium text-slate-800">{rp(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function Spark({ data, dataKey, color, name }) {
  return (
    <div className="-mx-1 mt-2 h-10">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
          <defs><linearGradient id={`sp-${dataKey}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.25} /><stop offset="1" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <Tooltip content={<ChartTip />} cursor={{ stroke: 'rgb(var(--slate-300))' }} />
          <Area type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} fill={`url(#sp-${dataKey})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--surface))' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function sapaan() {
  const h = new Date().getHours();
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
}

export default function Dashboard() {
  const { skpdId, tahun, can, skpd, user } = useApp();
  const [scope, setScope] = useState('skpd');
  const semua = scope === 'semua';
  const { data, loading, error, reload } = useLoad(() => skpdId && api.get('/api/dashboard', { skpd_id: skpdId, tahun, semua: semua ? 1 : '' }), [skpdId, tahun, semua]);
  const tugas = useLoad(() => skpdId && api.get('/api/notifikasi', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  const [flash, setFlash] = useState(null);
  useLive((evt) => {
    if (evt.type.startsWith('bku') || evt.type.startsWith('pajak')) { reload(); tugas.reload(); setFlash(evt.data?.id); setTimeout(() => setFlash(null), 3000); }
  }, 600);

  if (loading && !data) return <DashboardSkeleton />;
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (!data) return null;
  const k = data.kpi;
  const pajakBelum = data.pajak.filter((p) => p.status === 'dipungut').reduce((s, p) => s + p.nominal, 0);
  const pajakPerJenis = Object.keys(JENIS_PAJAK).map((j) => ({ jenis: j, total: data.pajak.filter((p) => p.jenis_pajak === j).reduce((s, p) => s + p.nominal, 0), belum: data.pajak.filter((p) => p.jenis_pajak === j && p.status === 'dipungut').reduce((s, p) => s + p.nominal, 0) })).filter((x) => x.total > 0);
  const maxPajak = Math.max(1, ...pajakPerJenis.map((p) => p.total));
  const persenReal = Number(data.realisasi.pagu) ? (Number(data.realisasi.realisasi) / Number(data.realisasi.pagu)) * 100 : 0;
  const bulanIni = tahun === new Date().getFullYear() ? new Date().getMonth() + 1 : 12;
  let kum = 0;
  const chart = data.bulanan.map((b) => { kum += b.penerimaan - b.pengeluaran; return { ...b, nama: BULAN_SINGKAT[b.bulan - 1], saldo: b.bulan <= bulanIni ? kum : null }; });
  const aktif = chart.filter((c) => c.bulan <= bulanIni);
  const komposisi = (data.komposisi || []).slice(0, 6);
  const maxKomp = Math.max(1, ...komposisi.map((x) => x.nilai));
  const totalKomp = komposisi.reduce((s, x) => s + x.nilai, 0);
  const items = tugas.data?.items || [];

  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard" subtitle={`${semua ? 'Seluruh SKPD' : skpd?.nama || ''} · Tahun Anggaran ${tahun}`}
        actions={can('admin', 'pimpinan') && <Tabs value={scope} onChange={setScope} tabs={[{ value: 'skpd', label: 'SKPD terpilih' }, { value: 'semua', label: 'Konsolidasi semua SKPD' }]} />} />

      {/* Hero: posisi kas */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0f3d5e] via-[#0b2c44] to-[#071c2c] p-5 text-white shadow-lift sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-gold-400/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_minmax(0,1.1fr)] lg:items-center">
          <div>
            <p className="text-sm text-white/70">{sapaan()}, <span className="font-semibold text-white">{user.full_name.split(',')[0]}</span></p>
            <p className="mt-3 text-xs font-medium uppercase tracking-wider text-white/60">Saldo kas bendahara</p>
            <p className="num mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{rp(k.saldo_bank + k.saldo_tunai)}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 ring-1 ring-inset ring-white/15"><Landmark className="h-3.5 w-3.5 text-gold-300" />Bank {rp(k.saldo_bank)}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 ring-1 ring-inset ring-white/15"><Wallet className="h-3.5 w-3.5 text-gold-300" />Tunai {rp(k.saldo_tunai)}</span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {can('admin', 'bendahara') && <Link to="/bku?baru=1" className="inline-flex items-center gap-1.5 rounded-lg bg-gold-400 px-3.5 py-2 text-sm font-semibold text-[#071c2c] shadow-sm transition hover:bg-gold-300"><Plus className="h-4 w-4" />Catat transaksi</Link>}
              <Link to="/spj" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-2 text-sm font-medium ring-1 ring-inset ring-white/20 transition hover:bg-white/15"><FileCheck2 className="h-4 w-4" />SPJ bulan ini</Link>
              <Link to="/olah-data" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-2 text-sm font-medium ring-1 ring-inset ring-white/20 transition hover:bg-white/15"><Upload className="h-4 w-4" />Olah data</Link>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-white/60">Saldo kas akhir bulan · {tahun}</p>
            <div className="h-36">
              <ResponsiveContainer>
                <AreaChart data={aktif} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="hero" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f2c14e" stopOpacity={0.45} /><stop offset="1" stopColor="#f2c14e" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="nama" interval={0} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "rgba(255,255,255,.55)" }} />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip content={<ChartTip />} cursor={{ stroke: 'rgba(255,255,255,.3)' }} />
                  <Area type="monotone" dataKey="saldo" name="Saldo kas" stroke="#f2c14e" strokeWidth={2} fill="url(#hero)" dot={false} activeDot={{ r: 4, stroke: '#0b2c44', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total penerimaan" value={rp(k.penerimaan)} sub={`Bulan ini ${compact(k.penerimaan_bulan_ini)}`} icon={ArrowDownLeft} tone="brand"
          trend={<Spark data={aktif} dataKey="penerimaan" name="Penerimaan" color={SERIES[0]} />} />
        <Stat label="Total pengeluaran" value={rp(k.pengeluaran)} sub={`Bulan ini ${compact(k.pengeluaran_bulan_ini)}`} icon={ArrowUpRight} tone="amber"
          trend={<Spark data={aktif} dataKey="pengeluaran" name="Pengeluaran" color={SERIES[1]} />} />
        <Stat label="Serapan anggaran belanja" value={`${persenReal.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`} sub={`${compact(data.realisasi.realisasi)} dari pagu ${compact(data.realisasi.pagu)}`} icon={Target} tone="green"
          trend={<Progress value={persenReal} className="mt-4 h-2" />} />
        <Stat label="Pajak belum disetor" value={rp(pajakBelum)} sub={<Link to="/pajak/register" className="font-medium text-brand-700 hover:underline">Buka register pajak →</Link>} icon={Receipt} tone="red"
          trend={<p className="mt-3 text-[11px] text-slate-500">{data.belum_verifikasi.toLocaleString('id-ID')} transaksi menunggu verifikasi</p>} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Arus kas bulanan" subtitle="Penerimaan dan pengeluaran per bulan (dari proyeksi event stream)">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={chart} barGap={2} margin={{ left: 8, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--slate-100))" />
                <XAxis dataKey="nama" tickLine={false} axisLine={{ stroke: 'rgb(var(--slate-300))' }} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} />
                <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} width={56} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgb(var(--slate-100) / .6)' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'rgb(var(--slate-600))' }} />
                <Bar dataKey="penerimaan" name="Penerimaan" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="pengeluaran" name="Pengeluaran" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Tugas hari ini" subtitle="Pengingat yang perlu ditindaklanjuti" bodyClass=""
          actions={items.length > 0 && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">{items.length}</span>}>
          {!tugas.data ? <div className="space-y-3 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : items.length ? (
            <ul className="divide-y divide-slate-100">
              {items.slice(0, 6).map((n) => {
                const [Icon, tone] = TUGAS[n.tingkat] || TUGAS.info;
                return (
                  <li key={n.id}>
                    <Link to={n.link || '/'} className="group flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50">
                      <span className={cx('mt-0.5 rounded-lg p-1.5', tone)}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold leading-snug text-slate-800">{n.judul}</span><span className="mt-0.5 block truncate text-[11px] text-slate-500">{n.pesan}</span></span>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 group-hover:text-brand-600" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center"><CheckCircle2 className="h-9 w-9 text-emerald-500" /><p className="text-sm font-medium text-slate-700">Tidak ada tugas tertunda</p></div>
          )}
          <div className="border-t border-slate-100 px-4 py-2.5"><Link to="/peringatan" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><ListTodo className="h-3.5 w-3.5" />Lihat peringatan anomali</Link></div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {!semua && <JatuhTempoPajak compact />}
        <Card title="Komposisi pengeluaran" subtitle={`Total ${rp(totalKomp)}`} className={semua ? 'xl:col-span-2' : ''}>
          {komposisi.length ? (
            <div className="space-y-3">
              {komposisi.map((x, i) => (
                <div key={x.jenis}>
                  <div className="flex justify-between gap-2 text-xs"><span className="font-medium text-slate-700">{JENIS_LABEL[x.jenis] || x.jenis}</span><span className="num text-slate-600">{rp(x.nilai)} · {((x.nilai / totalKomp) * 100).toFixed(0)}%</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${(x.nilai / maxKomp) * 100}%`, background: SERIES[i % SERIES.length] }} /></div>
                </div>
              ))}
            </div>
          ) : <Empty title="Belum ada pengeluaran" />}
        </Card>
        <Card title="Realisasi per rekening" subtitle={`Pagu ${rp(data.realisasi.pagu)}`}>
          {data.realisasi.rekening ? (
            <div className="space-y-3">
              {data.realisasi.rekening.slice(0, 6).map((r) => {
                const p = Number(r.pagu) ? (Number(r.realisasi) / Number(r.pagu)) * 100 : 0;
                return (
                  <div key={r.kode_rekening}>
                    <div className="flex justify-between gap-2 text-xs"><span className="truncate text-slate-600" title={r.nama}>{r.nama}</span><span className="num shrink-0 font-semibold text-slate-700">{p.toFixed(0)}%</span></div>
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
                  <div className={cx('rounded-xl p-2', masuk ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700')}>{masuk ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">{t.uraian}</p>
                    <p className="text-[11px] text-slate-500">{tgl(t.tanggal)} · No. {t.no_urut} · {t.no_bukti}{semua && ` · ${t.skpd_kode}`}</p>
                  </div>
                  <span className={cx('num shrink-0 text-sm font-semibold', masuk ? 'text-brand-700' : 'text-slate-700')}>{masuk ? '+' : '−'}{rp(Number(t.penerimaan) || Number(t.pengeluaran))}</span>
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
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-52 rounded-3xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
      <div className="grid gap-5 xl:grid-cols-3"><Skeleton className="h-80 rounded-2xl xl:col-span-2" /><Skeleton className="h-80 rounded-2xl" /></div>
    </div>
  );
}
