import { BarChart3, Download } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Button, Card, Loading, PageHeader, Progress, useLoad, useToast, cx } from '../components/ui.jsx';
import { rp, money } from '../lib/format.js';

export default function Realisasi() {
  const { skpdId, tahun } = useApp();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => skpdId && api.get('/api/laporan/realisasi', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  useLive((e) => e.type === 'bku.entry.created' && reload());
  const rows = data?.rows || [];
  const tot = rows.reduce((a, r) => ({ pagu: a.pagu + r.pagu, realisasi: a.realisasi + r.realisasi }), { pagu: 0, realisasi: 0 });
  const p = tot.pagu ? (tot.realisasi / tot.pagu) * 100 : 0;
  return (
    <div className="space-y-4">
      <PageHeader icon={BarChart3} title="Realisasi Anggaran" subtitle={`Pagu DPA dibandingkan realisasi belanja dari BKU · TA ${tahun}`}
        actions={<Button variant="secondary" icon={Download} onClick={() => download('/api/laporan/realisasi', { params: { skpd_id: skpdId, tahun, format: 'xlsx' } }).catch((e) => toast(e.message, 'error'))}>Excel</Button>} />
      {loading && !data ? <Loading /> : error ? <Alert tone="error">{error.message}</Alert> : <>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="card p-4"><p className="text-xs text-slate-500">Total pagu</p><p className="num mt-1 text-lg font-semibold">{rp(tot.pagu)}</p></div>
          <div className="card p-4"><p className="text-xs text-slate-500">Realisasi</p><p className="num mt-1 text-lg font-semibold">{rp(tot.realisasi)}</p></div>
          <div className="card p-4"><p className="text-xs text-slate-500">Sisa anggaran</p><p className="num mt-1 text-lg font-semibold">{rp(tot.pagu - tot.realisasi)}</p></div>
          <div className="card p-4"><p className="text-xs text-slate-500">Penyerapan</p><p className="num mt-1 text-lg font-semibold">{p.toFixed(2)}%</p><Progress value={p} className="mt-2" /></div>
        </div>
        {rows.some((r) => r.persen > 100) && <Alert tone="error">Ada rekening yang realisasinya melebihi pagu. Periksa baris berwarna merah.</Alert>}
        <Card bodyClass="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead><tr><th className="th">Kode rekening</th><th className="th">Uraian</th><th className="th text-right">Pagu</th><th className="th text-right">Realisasi</th><th className="th text-right">Sisa</th><th className="th w-48">Penyerapan</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.kode_rekening} className={cx('hover:bg-slate-50', r.persen > 100 && 'bg-rose-50/60')}>
                  <td className="td whitespace-nowrap font-mono text-xs">{r.kode_rekening}</td>
                  <td className="td">{r.nama}{!r.pagu && <span className="ml-1 text-[11px] text-rose-600">(tanpa pagu)</span>}</td>
                  <td className="td num text-right">{money(r.pagu)}</td><td className="td num text-right">{money(r.realisasi)}</td>
                  <td className={cx('td num text-right', r.sisa < 0 && 'font-semibold text-rose-700')}>{money(r.sisa)}</td>
                  <td className="td"><div className="flex items-center gap-2"><Progress value={r.persen ?? 0} /><span className="num w-12 text-right text-xs">{r.persen == null ? '-' : `${r.persen.toFixed(1)}%`}</span></div></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-slate-50 font-semibold"><td className="td" colSpan={2}>Jumlah</td><td className="td num text-right">{money(tot.pagu)}</td><td className="td num text-right">{money(tot.realisasi)}</td><td className="td num text-right">{money(tot.pagu - tot.realisasi)}</td><td className="td num">{p.toFixed(2)}%</td></tr></tfoot>
          </table>
        </Card>
      </>}
    </div>
  );
}
