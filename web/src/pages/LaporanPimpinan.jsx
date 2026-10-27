import { Crown, Download, Printer, TrendingUp, Wallet, Receipt, Target, AlertTriangle, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, download } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, PageHeader, Progress, Skeleton, Stat, cx, useLoad, useToast } from '../components/ui.jsx';
import { BULAN, compact, num, rp } from '../lib/format.js';
import { SERIES } from '../lib/palette.js';

const STATUS = { lambat: ['red', 'Serapan lambat', AlertTriangle], melebihi: ['amber', 'Melebihi pagu', ArrowUpRight], wajar: ['green', 'Wajar', CheckCircle2] };

export default function LaporanPimpinan() {
  const { tahun, setSkpdId } = useApp();
  const toast = useToast();
  const { data: d, error, reload } = useLoad(() => api.get('/api/laporan/pimpinan', { tahun }), [tahun]);
  useLive((e) => e.type.startsWith('bku') && reload(), 3000);
  const chart = (d?.rows || []).map((r) => ({ nama: r.nama.replace(/^(Dinas|Badan|Sekretariat)\s+/i, ''), persen: Math.round(r.persen * 10) / 10, realisasi: r.realisasi, pagu: r.pagu }));

  return (
    <div className="space-y-5">
      <PageHeader icon={Crown} title="Laporan Pimpinan" subtitle={`Perbandingan kinerja penatausahaan kas seluruh SKPD · TA ${tahun}${d?.bulan_selesai ? ` · s.d. ${BULAN[d.bulan_selesai - 1]}` : ''}`}
        actions={<>
          <Button variant="secondary" icon={Download} onClick={() => download('/api/laporan/pimpinan', { params: { tahun, format: 'xlsx' } }).catch((e) => toast(e.message, 'error'))}>Excel</Button>
          <Button icon={Printer} onClick={() => window.print()}>Cetak / PDF</Button>
        </>} />
      {error && <Alert tone="error">{error.message}</Alert>}

      <div className="print-area theme-light hidden text-center text-black print:block">
        <p className="text-base font-bold">LAPORAN PIMPINAN: KINERJA PENATAUSAHAAN KAS SELURUH SKPD</p>
        <p className="text-xs">Tahun Anggaran {tahun}{d?.bulan_selesai ? ` · s.d. ${BULAN[d.bulan_selesai - 1]}` : ''}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!d ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />) : (<>
          <Stat label="Serapan seluruh SKPD" value={`${d.total.persen.toFixed(1)}%`} sub={`${compact(d.total.realisasi)} dari pagu ${compact(d.total.pagu)}`} icon={TrendingUp} tone="brand"
            trend={<Progress className="mt-2" value={d.total.persen} />} />
          <Stat label="Target serapan linear" value={`${d.target_serapan.toFixed(1)}%`} sub={`${d.rows.filter((r) => r.status === 'lambat').length} SKPD tertinggal lebih dari 15 poin`} icon={Target} tone="violet" />
          <Stat label="Saldo kas seluruh bendahara" value={compact(d.total.saldo)} sub={rp(d.total.saldo)} icon={Wallet} tone="green" />
          <Stat label="Pajak belum disetor" value={compact(d.total.pajak_belum_setor)} sub={`${d.rows.filter((r) => r.pajak_belum_setor > 0).length} SKPD`} icon={Receipt} tone={d.total.pajak_belum_setor ? 'amber' : 'green'} />
        </>)}
      </div>

      <Card title="Serapan anggaran per SKPD" subtitle="Garis putus-putus menandai target serapan linear sampai bulan terakhir yang selesai">
        {!d ? <Skeleton className="h-64" /> : (
          <div style={{ height: Math.max(220, chart.length * 44) }}>
            <ResponsiveContainer>
              <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 40, top: 22, bottom: 4 }} barCategoryGap={10}>
                <CartesianGrid horizontal={false} stroke="rgb(var(--slate-100))" />
                <XAxis type="number" domain={[0, (max) => Math.max(100, Math.ceil(max / 10) * 10)]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: 'rgb(var(--slate-500))' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="nama" width={170} tick={{ fontSize: 11, fill: 'rgb(var(--slate-600))' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgb(var(--slate-100) / .6)' }} contentStyle={{ borderRadius: 12, border: '1px solid rgb(var(--slate-200))', background: 'rgb(var(--surface))', fontSize: 12 }}
                  formatter={(v, _n, p) => [`${v}% (${rp(p.payload.realisasi)} dari ${rp(p.payload.pagu)})`, 'Serapan']} />
                <ReferenceLine x={Math.round(d.target_serapan * 10) / 10} stroke="rgb(var(--slate-500))" strokeDasharray="4 4" label={{ value: `Target ${d.target_serapan.toFixed(0)}%`, position: 'top', fontSize: 10, fill: 'rgb(var(--slate-500))' }} />
                <Bar dataKey="persen" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: 'right', fontSize: 11, fill: 'rgb(var(--slate-700))', formatter: (v) => `${v}%` }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="Peringkat dan kepatuhan penatausahaan" bodyClass="">
        {!d ? <Skeleton className="m-4 h-40" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px]">
              <thead><tr>
                <th className="th w-12 text-center">#</th><th className="th min-w-[220px]">SKPD</th><th className="th text-right">Pagu</th><th className="th text-right">Realisasi</th><th className="th min-w-[150px]">Serapan</th>
                <th className="th text-right">Saldo kas</th><th className="th text-right">Pajak belum setor</th><th className="th text-center">Belum verifikasi</th><th className="th text-center">Tutup buku s.d.</th><th className="th text-center">Anomali</th><th className="th">Status</th>
              </tr></thead>
              <tbody>
                {d.rows.map((r) => {
                  const [c, l, I] = STATUS[r.status];
                  return (
                    <tr key={r.id} className="hover:bg-brand-50/40">
                      <td className="td text-center"><span className={cx('inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold', r.peringkat <= 3 ? 'bg-gold-400 text-brand-950' : 'bg-slate-100 text-slate-600')}>{r.peringkat}</span></td>
                      <td className="td"><button type="button" className="text-left hover:underline" onClick={() => { setSkpdId(r.id); toast(`SKPD aktif: ${r.nama}`, 'info'); }} title="Jadikan SKPD aktif"><p className="font-medium text-slate-800">{r.nama}</p></button><p className="text-[11px] text-slate-500">{r.kode} · {r.bendahara_nama || '-'}</p></td>
                      <td className="td num whitespace-nowrap text-right">{compact(r.pagu)}</td>
                      <td className="td num whitespace-nowrap text-right">{compact(r.realisasi)}</td>
                      <td className="td"><div className="flex items-center gap-2"><div className="w-20 shrink-0"><Progress value={r.persen} /></div><span className="num w-12 text-right text-xs font-semibold">{r.persen.toFixed(1)}%</span></div></td>
                      <td className={cx('td num whitespace-nowrap text-right', r.saldo < 0 && 'text-rose-700')}>{compact(r.saldo)}</td>
                      <td className={cx('td num whitespace-nowrap text-right', r.pajak_belum_setor > 0 && 'text-amber-700')}>{r.pajak_belum_setor ? compact(r.pajak_belum_setor) : '-'}</td>
                      <td className="td num text-center">{r.belum_verifikasi ? num(r.belum_verifikasi) : <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" />}</td>
                      <td className="td text-center text-xs">{r.tutup_buku_sd ? BULAN[r.tutup_buku_sd - 1] : '-'}{r.tertunda_tutup_buku > 0 && <p className="text-[10px] text-amber-700">tertunda {r.tertunda_tutup_buku} bln</p>}</td>
                      <td className="td text-center">{r.anomali_kritis ? <Badge color="red">{r.anomali_kritis} kritis</Badge> : r.anomali_peringatan ? <Badge color="amber">{r.anomali_peringatan}</Badge> : <span className="text-xs text-slate-400">-</span>}</td>
                      <td className="td"><Badge color={c}><I className="h-3 w-3" />{l}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr className="whitespace-nowrap font-semibold">
                <td className="td" /><td className="td">Jumlah</td><td className="td num text-right">{compact(d.total.pagu)}</td><td className="td num text-right">{compact(d.total.realisasi)}</td>
                <td className="td num text-xs">{d.total.persen.toFixed(1)}%</td><td className="td num text-right">{compact(d.total.saldo)}</td><td className="td num text-right">{compact(d.total.pajak_belum_setor)}</td><td className="td" colSpan={4} />
              </tr></tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
