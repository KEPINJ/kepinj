import { useEffect, useState } from 'react';
import { Landmark, Upload, Play, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Tabs, useLoad, useToast, Empty, cx } from '../components/ui.jsx';
import { rp, money, tgl, num } from '../lib/format.js';

const guess = (cols, ...k) => cols.find((c) => k.some((x) => c.toLowerCase().includes(x))) || '';

export default function Rekonsiliasi() {
  const { skpdId } = useApp();
  const toast = useToast();
  const datasets = useLoad(() => api.get('/api/data/datasets'), []);
  const [dsId, setDsId] = useState('');
  const [m, setM] = useState({});
  const [tol, setTol] = useState(3);
  const [res, setRes] = useState(null);
  const [tab, setTab] = useState('hanya_bank');
  const [busy, setBusy] = useState(false);
  const ds = datasets.data?.rows.find((d) => String(d.id) === String(dsId));
  useEffect(() => {
    if (!ds) return;
    const c = ds.columns;
    setM({ tanggal: guess(c, 'tanggal', 'tgl', 'date'), keterangan: guess(c, 'keterangan', 'uraian', 'deskripsi', 'remark'), debet: guess(c, 'debet', 'debit', 'keluar'), kredit: guess(c, 'kredit', 'credit', 'masuk'), nilai: '' });
    setRes(null);
  }, [dsId, ds?.id]);
  const upload = async (file) => {
    if (!file) return;
    try { const r = await api.upload('/api/data/upload', file); await datasets.reload(); setDsId(String(r.datasets[0].id)); toast('Mutasi bank terbaca'); } catch (e) { toast(e.message, 'error'); }
  };
  const run = async () => {
    setBusy(true);
    try { const r = await api.post('/api/rekonsiliasi', { dataset_id: dsId, skpd_id: skpdId, mapping: m, toleransi_hari: tol }); setRes(r); setTab(r.hanya_bank.length ? 'hanya_bank' : r.hanya_bku.length ? 'hanya_bku' : 'cocok'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const cols = ds?.columns || [];
  const s = res?.ringkasan;
  return (
    <div className="space-y-4">
      <PageHeader icon={Landmark} title="Rekonsiliasi Bank" subtitle="Cocokkan rekening koran dengan BKU kas bank secara otomatis (nilai, arah, tanggal ± toleransi, dan no. bukti)" />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card title="1. Mutasi rekening">
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-slate-600 hover:border-brand-400">
              <Upload className="h-4 w-4" />Unggah rekening koran (.csv/.xlsx)
              <input type="file" accept=".csv,.xlsx,.txt" className="hidden" onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
            </label>
            <Field label="atau pilih dataset"><Select value={dsId} onChange={(e) => setDsId(e.target.value)} placeholder="— pilih —" options={(datasets.data?.rows || []).map((d) => ({ value: d.id, label: d.nama }))} /></Field>
            {ds && <>
              <p className="pt-1 text-xs font-semibold text-slate-700">2. Pemetaan kolom</p>
              {[['tanggal', 'Tanggal'], ['keterangan', 'Keterangan'], ['debet', 'Debet (uang keluar)'], ['kredit', 'Kredit (uang masuk)'], ['nilai', 'atau satu kolom nilai (+/−)']].map(([k, l]) => (
                <Field key={k} label={l}><Select value={m[k] || ''} onChange={(e) => setM({ ...m, [k]: e.target.value })} placeholder="— tidak dipakai —" options={cols} /></Field>
              ))}
              <Field label="Toleransi selisih tanggal (hari)"><Input type="number" min={0} max={31} value={tol} onChange={(e) => setTol(e.target.value)} /></Field>
              <Button className="w-full" icon={Play} loading={busy} onClick={run}>Jalankan rekonsiliasi</Button>
            </>}
          </div>
        </Card>
        <div className="space-y-4">
          {!res ? <Card><Empty icon={Landmark} title="Belum ada hasil" text="Unggah mutasi rekening bendahara, lalu jalankan. Contoh: samples/contoh_mutasi_bank_september.csv" /></Card> : <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="card p-4"><p className="text-xs text-slate-500">Tingkat kecocokan</p><p className="num mt-1 text-2xl font-semibold text-emerald-700">{s.persen_cocok}%</p><p className="text-xs text-slate-500">{s.cocok} dari {s.mutasi} mutasi</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500">Hanya di bank</p><p className="num mt-1 text-2xl font-semibold text-amber-700">{s.hanya_bank}</p><p className="text-xs text-slate-500">belum dibukukan di BKU</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500">Hanya di BKU</p><p className="num mt-1 text-2xl font-semibold text-rose-700">{s.hanya_bku}</p><p className="text-xs text-slate-500">belum muncul di bank</p></div>
              <div className="card p-4"><p className="text-xs text-slate-500">Periode</p><p className="mt-1 text-sm font-semibold">{tgl(res.periode.dari)} – {tgl(res.periode.sampai)}</p><p className="text-xs text-slate-500">toleransi ±{res.periode.toleransi_hari} hari</p></div>
            </div>
            <Card bodyClass="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr><th className="th" /><th className="th text-right">Masuk</th><th className="th text-right">Keluar</th><th className="th text-right">Neto</th></tr></thead>
                <tbody>
                  <tr><td className="td font-medium">Rekening koran</td><td className="td num text-right">{money(s.bank_masuk)}</td><td className="td num text-right">{money(s.bank_keluar)}</td><td className="td num text-right">{money(s.bank_masuk - s.bank_keluar)}</td></tr>
                  <tr><td className="td font-medium">BKU kas bank (tanpa pungutan pajak)</td><td className="td num text-right">{money(s.bku_masuk)}</td><td className="td num text-right">{money(s.bku_keluar)}</td><td className="td num text-right">{money(s.bku_masuk - s.bku_keluar)}</td></tr>
                </tbody></table>
            </Card>
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'hanya_bank', label: 'Hanya di bank', count: s.hanya_bank }, { value: 'hanya_bku', label: 'Hanya di BKU', count: s.hanya_bku }, { value: 'cocok', label: 'Cocok', count: s.cocok }]} />
            <Card bodyClass="max-h-[55vh] overflow-auto">
              <table className="w-full min-w-[700px] text-sm">
                {tab === 'cocok' ? <>
                  <thead className="sticky top-0"><tr><th className="th" /><th className="th">Bank</th><th className="th">BKU</th><th className="th text-right">Nilai</th><th className="th">Selisih hari</th></tr></thead>
                  <tbody>{res.cocok.map((c, i) => <tr key={i}><td className="td"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></td><td className="td"><p>{c.mutasi.keterangan}</p><p className="text-[11px] text-slate-500">{tgl(c.mutasi.tanggal)}</p></td><td className="td"><p className="line-clamp-1">{c.bku.uraian}</p><p className="text-[11px] text-slate-500">No. {c.bku.no_urut} · {tgl(c.bku.tanggal)} · {c.bku.no_bukti}</p></td><td className="td num text-right">{money(c.mutasi.masuk || c.mutasi.keluar)}</td><td className="td num">{c.selisih_hari}</td></tr>)}</tbody>
                </> : tab === 'hanya_bank' ? <>
                  <thead className="sticky top-0"><tr><th className="th" /><th className="th">Tanggal</th><th className="th">Keterangan</th><th className="th text-right">Masuk</th><th className="th text-right">Keluar</th></tr></thead>
                  <tbody>{res.hanya_bank.map((x, i) => <tr key={i}><td className="td"><AlertTriangle className="h-4 w-4 text-amber-600" /></td><td className="td">{tgl(x.tanggal)}</td><td className="td">{x.keterangan}</td><td className="td num text-right">{x.masuk ? money(x.masuk) : ''}</td><td className="td num text-right">{x.keluar ? money(x.keluar) : ''}</td></tr>)}</tbody>
                </> : <>
                  <thead className="sticky top-0"><tr><th className="th" /><th className="th">No</th><th className="th">Tanggal</th><th className="th">Uraian</th><th className="th text-right">Masuk</th><th className="th text-right">Keluar</th></tr></thead>
                  <tbody>{res.hanya_bku.map((x) => <tr key={x.id}><td className="td"><AlertTriangle className="h-4 w-4 text-rose-600" /></td><td className="td num">{x.no_urut}</td><td className="td">{tgl(x.tanggal)}</td><td className="td">{x.uraian}<p className="text-[11px] text-slate-500">{x.no_bukti}</p></td><td className="td num text-right">{x.masuk ? money(x.masuk) : ''}</td><td className="td num text-right">{x.keluar ? money(x.netto ?? x.keluar) : ''}</td></tr>)}</tbody>
                </>}
              </table>
              {!res[tab].length && <p className="py-8 text-center text-sm text-slate-500">Tidak ada data.</p>}
            </Card>
          </>}
        </div>
      </div>
    </div>
  );
}
