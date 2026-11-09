import { useState } from 'react';
import { Gauge, Download, Wallet, TrendingUp, PiggyBank, AlertTriangle } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, Cell } from 'recharts';
import { api, download } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Field, PageHeader, Progress, Select, SkeletonRows, Stat, Tabs, cx, useLoad, useToast } from '../components/ui.jsx';
import { SERIES } from '../lib/palette.js';
import { BULAN, compact, money, rp } from '../lib/format.js';

export const INDIKATOR = {
  melampaui: ['red', 'Melampaui pagu'], mendekati: ['amber', 'Mendekati pagu'], rendah: ['violet', 'Penyerapan rendah'],
  normal: ['green', 'Dalam batas'], tanpa_pagu: ['red', 'Tanpa pagu'], kosong: ['slate', 'Belum ada data'],
};
const PREFIKS = [
  { value: '5', label: '5 · Seluruh belanja' }, { value: '5.1', label: '5.1 · Belanja operasi' }, { value: '5.1.01', label: '5.1.01 · Belanja pegawai' },
  { value: '5.1.02', label: '5.1.02 · Belanja barang & jasa' }, { value: '5.2', label: '5.2 · Belanja modal' }, { value: '5.3', label: '5.3 · Belanja tidak terduga' },
];
const pct = (v) => (v == null ? '-' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`);

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-800">{label}</p>
      {payload.map((p) => <p key={p.dataKey} className="flex items-center gap-1.5 text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: <b className="num">{String(p.dataKey).startsWith('persen') ? pct(p.value) : rp(p.value)}</b></p>)}
    </div>
  );
}

/** Monitoring pagu & realisasi: Realisasi / Pagu × 100%, per bulan, per rekening, dan antar-SKPD. */
export default function MonitoringAnggaran() {
  const { skpdId, tahun, can } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ prefiks: '5', basis: 'semua', bulan: '', semua: false, tahun });
  const [tab, setTab] = useState('bulanan');
  const [ind, setInd] = useState('');
  const th = f.tahun || tahun;
  const params = { skpd_id: skpdId, tahun: th, prefiks: f.prefiks, basis: f.basis, bulan: f.bulan, semua: f.semua ? 1 : '' };
  const { data, loading, error, reload } = useLoad(() => (skpdId || f.semua) && api.get('/api/monitoring-anggaran', params), [skpdId, th, f.prefiks, f.basis, f.bulan, f.semua]);
  useLive((e) => e.type?.startsWith('bku.') && reload(), 2000);
  const s = data?.ringkasan;
  const rek = (data?.per_rekening || []).filter((r) => !ind || r.indikator === ind);
  const tahunOpsi = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i);

  return (
    <div className="space-y-4">
      <PageHeader icon={Gauge} title="Monitoring Pagu & Realisasi" subtitle={`Realisasi ÷ Pagu × 100% · TA ${th}${data ? ` s.d. ${BULAN[data.bulan_sd - 1]}` : ''}`}
        actions={<Button variant="secondary" icon={Download} onClick={() => download('/api/monitoring-anggaran/xlsx', { params }).catch((e) => toast(e.message, 'error'))}>Excel</Button>} />
      <Card bodyClass="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Tahun anggaran"><Select value={th} onChange={(e) => setF({ ...f, tahun: Number(e.target.value) })} options={tahunOpsi.map((t) => ({ value: t, label: t }))} /></Field>
        <Field label="Kode rekening"><Select value={f.prefiks} onChange={(e) => setF({ ...f, prefiks: e.target.value })} options={PREFIKS} /></Field>
        <Field label="Sampai bulan"><Select value={f.bulan} onChange={(e) => setF({ ...f, bulan: e.target.value })} options={[{ value: '', label: 'Bulan berjalan' }, ...BULAN.map((b, i) => ({ value: i + 1, label: b }))]} /></Field>
        <Field label="Basis realisasi" hint="Transaksi ditolak tidak pernah dihitung"><Select value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} options={[{ value: 'semua', label: 'Semua transaksi tercatat' }, { value: 'disetujui', label: 'Hanya yang sudah disetujui' }]} /></Field>
        {can('admin', 'pimpinan') && <Field label="Cakupan"><Select value={f.semua ? '1' : ''} onChange={(e) => setF({ ...f, semua: e.target.value === '1' })} options={[{ value: '', label: 'SKPD terpilih' }, { value: '1', label: 'Seluruh SKPD (konsolidasi)' }]} /></Field>}
      </Card>
      {error && <Alert tone="error">{error.message}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pagu anggaran" value={s ? rp(s.pagu) : '…'} sub={s && s.pagu !== s.pagu_murni ? `Murni ${rp(s.pagu_murni)}` : 'Pagu DPA'} icon={Wallet} />
        <Stat label="Realisasi" value={s ? rp(s.realisasi) : '…'} sub={s && `Rencana kas s.d. bulan ini ${compact(s.rencana_sd)}`} icon={TrendingUp} tone="green" />
        <Stat label="Sisa anggaran" value={s ? rp(s.sisa) : '…'} sub={s && `${pct(100 - s.persen)} belum terserap`} icon={PiggyBank} tone={s?.sisa < 0 ? 'red' : 'violet'} />
        <Stat label="Persentase realisasi" value={s ? pct(s.persen) : '…'} tone={s?.status === 'melampaui' ? 'red' : s?.status === 'mendekati' ? 'amber' : 'brand'} icon={Gauge}
          sub={s && <>Target waktu {pct(s.target)} · deviasi <b className={s.deviasi < 0 ? 'text-violet-700' : 'text-emerald-700'}>{s.deviasi > 0 ? '+' : ''}{pct(s.deviasi)}</b></>}
          trend={s && <Progress value={s.persen} className="mt-2" />} />
      </div>
      {s && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(INDIKATOR).filter(([k]) => s.indikator[k]).map(([k, [c, l]]) => (
            <button key={k} type="button" onClick={() => { setInd(ind === k ? '' : k); setTab('rekening'); }} className={cx('rounded-full transition', ind === k && 'ring-2 ring-brand-500 ring-offset-1')}>
              <Badge color={c}>{l}: {s.indikator[k]} rekening</Badge>
            </button>
          ))}
          <span className="text-[11px] text-slate-500">Ambang: mendekati ≥ {data.ambang.ambangPagu}% pagu · rendah bila tertinggal &gt; {data.ambang.ambangRendah} poin dari porsi waktu ({pct(data.porsi_waktu)})</span>
        </div>
      )}
      {(s?.indikator.melampaui > 0 || s?.indikator.tanpa_pagu > 0) && <Alert tone="error" title="Ada rekening melampaui pagu atau belanja tanpa pagu">Periksa tab Per rekening. Transaksi yang melampaui pagu perlu pergeseran anggaran atau koreksi sebelum disetujui.</Alert>}

      <Card bodyClass="p-4" actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'bulanan', label: 'Antar bulan' }, { value: 'rekening', label: 'Per rekening', count: rek.length }, { value: 'kelompok', label: 'Per kelompok' }, { value: 'skpd', label: 'Antar SKPD' }]} />}
        title={{ bulanan: 'Perbandingan antar bulan', rekening: 'Pagu & realisasi per kode rekening', kelompok: 'Per kelompok belanja', skpd: 'Perbandingan antar SKPD' }[tab]}>
        {loading && !data ? <SkeletonRows rows={6} /> : !data ? null : tab === 'bulanan' ? (<>
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={data.bulanan.map((b) => ({ ...b, nama: b.nama.slice(0, 3) }))} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--slate-100))" />
                <XAxis dataKey="nama" tickLine={false} axisLine={{ stroke: 'rgb(var(--slate-300))' }} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} />
                <YAxis yAxisId="n" tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} width={56} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} width={40} />
                <Tooltip content={<Tip />} cursor={{ fill: 'rgb(var(--slate-100))' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: 'rgb(var(--slate-600))' }}>{v}</span>} />
                <Bar yAxisId="n" dataKey="rencana" name="Rencana kas" fill={SERIES[0]} fillOpacity={0.35} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar yAxisId="n" dataKey="realisasi" name="Realisasi bulan" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Line yAxisId="p" type="monotone" dataKey="persen_kumulatif" name="% realisasi kumulatif" stroke={SERIES[2]} strokeWidth={2} dot={{ r: 3, fill: SERIES[2], strokeWidth: 2, stroke: 'rgb(var(--surface))' }} />
                <ReferenceLine yAxisId="p" y={data.ambang.ambangPagu} stroke="rgb(var(--slate-400))" strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead><tr><th className="th">Bulan</th><th className="th text-right">Rencana kas</th><th className="th text-right">Realisasi</th><th className="th text-right">Kumulatif</th><th className="th text-right">% kumulatif</th><th className="th text-right">Transaksi</th></tr></thead>
              <tbody>{data.bulanan.map((b) => (
                <tr key={b.bulan} className={cx(b.bulan > data.bulan_sd && 'text-slate-400')}>
                  <td className="td">{b.nama}{b.perubahan && <Badge color="violet" className="ml-1">APBD-P</Badge>}</td>
                  <td className="td num text-right">{money(b.rencana)}</td><td className="td num text-right">{money(b.realisasi)}</td>
                  <td className="td num text-right">{money(b.kumulatif)}</td><td className="td num text-right">{pct(b.persen_kumulatif)}</td><td className="td num text-right">{b.transaksi}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </>) : tab === 'rekening' ? (
          <div className="overflow-x-auto">
            {ind && <p className="mb-2 text-xs text-slate-600">Menampilkan indikator <b>{INDIKATOR[ind][1]}</b> · <button type="button" className="text-brand-700 underline" onClick={() => setInd('')}>tampilkan semua</button></p>}
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr><th className="th">Kode rekening</th><th className="th">Uraian</th><th className="th text-right">Pagu</th><th className="th text-right">Realisasi</th><th className="th text-right">Sisa</th><th className="th w-44">% Realisasi</th><th className="th">Indikator</th></tr></thead>
              <tbody>{rek.map((r) => (
                <tr key={r.kode_rekening} className={cx('hover:bg-slate-50', r.indikator === 'melampaui' && 'bg-rose-50/60')}>
                  <td className="td whitespace-nowrap font-mono text-xs">{r.kode_rekening}</td>
                  <td className="td">{r.nama}<p className="text-[11px] text-slate-500">{r.kelompok}</p></td>
                  <td className="td num text-right">{money(r.pagu)}</td><td className="td num text-right">{money(r.realisasi)}</td>
                  <td className={cx('td num text-right', r.sisa < 0 && 'font-semibold text-rose-700')}>{money(r.sisa)}</td>
                  <td className="td"><div className="flex items-center gap-2"><Progress value={r.persen ?? 0} /><span className="num w-14 text-right text-xs">{pct(r.persen)}</span></div><p className="text-[10px] text-slate-400">target {pct(r.target)}</p></td>
                  <td className="td"><Badge color={INDIKATOR[r.indikator]?.[0]}>{INDIKATOR[r.indikator]?.[1]}</Badge></td>
                </tr>))}</tbody>
              <tfoot><tr className="bg-slate-50 font-semibold"><td className="td" colSpan={2}>Jumlah</td><td className="td num text-right">{money(s.pagu)}</td><td className="td num text-right">{money(s.realisasi)}</td><td className="td num text-right">{money(s.sisa)}</td><td className="td num">{pct(s.persen)}</td><td className="td" /></tr></tfoot>
            </table>
          </div>
        ) : tab === 'kelompok' ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={data.per_kelompok} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="rgb(var(--slate-100))" />
                  <XAxis type="number" tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--slate-500))' }} />
                  <YAxis type="category" dataKey="nama" width={130} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--slate-600))' }} />
                  <Tooltip content={<Tip />} cursor={{ fill: 'rgb(var(--slate-100))' }} />
                  <Bar dataKey="pagu" name="Pagu" fill={SERIES[0]} fillOpacity={0.3} radius={[0, 4, 4, 0]} maxBarSize={18} />
                  <Bar dataKey="realisasi" name="Realisasi" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3">{data.per_kelompok.map((k) => (
              <div key={k.nama} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-baseline justify-between text-sm"><b className="text-slate-800">{k.nama}</b><span className="num font-semibold">{pct(k.persen)}</span></div>
                <Progress value={k.persen} className="my-2" />
                <p className="num text-[11px] text-slate-500">Pagu {rp(k.pagu)} · realisasi {rp(k.realisasi)} · sisa {rp(k.sisa)}</p>
              </div>))}</div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={data.per_skpd.map((x) => ({ ...x, singkat: x.nama.replace(/^(Badan|Dinas|Sekretariat)\s+/, '').slice(0, 22) }))} margin={{ left: 4, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--slate-100))" />
                  <XAxis dataKey="singkat" tickLine={false} axisLine={{ stroke: 'rgb(var(--slate-300))' }} tick={{ fontSize: 11, fill: 'rgb(var(--slate-500))' }} interval={0} />
                  <YAxis domain={[0, (m) => Math.max(100, Math.ceil(m / 10) * 10)]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} width={44} />
                  <Tooltip content={<Tip />} cursor={{ fill: 'rgb(var(--slate-100))' }} />
                  <ReferenceLine y={data.porsi_waktu} stroke="rgb(var(--slate-400))" strokeDasharray="4 4" label={{ value: 'porsi waktu', fontSize: 10, fill: 'rgb(var(--slate-500))', position: 'insideTopRight' }} />
                  <Bar dataKey="persen" name="% realisasi" radius={[4, 4, 0, 0]} maxBarSize={40}>
                    {data.per_skpd.map((x) => <Cell key={x.id} fill={x.id === skpdId ? SERIES[0] : SERIES[1]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-sm">
              <thead><tr><th className="th">SKPD</th><th className="th text-right">Pagu</th><th className="th text-right">Realisasi</th><th className="th text-right">Sisa</th><th className="th text-right">% realisasi</th><th className="th">Indikator</th></tr></thead>
              <tbody>{[...data.per_skpd].sort((a, b) => b.persen - a.persen).map((x) => (
                <tr key={x.id} className={cx(x.id === skpdId && 'bg-brand-50/50')}>
                  <td className="td">{x.nama}<p className="font-mono text-[10px] text-slate-400">{x.kode}</p></td>
                  <td className="td num text-right">{compact(x.pagu)}</td><td className="td num text-right">{compact(x.realisasi)}</td><td className="td num text-right">{compact(x.sisa)}</td>
                  <td className="td num text-right font-semibold">{pct(x.persen)}</td><td className="td"><Badge color={INDIKATOR[x.indikator]?.[0]}>{INDIKATOR[x.indikator]?.[1]}</Badge></td>
                </tr>))}</tbody>
            </table>
            {!can('admin', 'pimpinan') && <p className="flex items-center gap-1 text-[11px] text-slate-500"><AlertTriangle className="h-3 w-3" />Perbandingan antar-SKPD hanya menampilkan persentase agregat.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
