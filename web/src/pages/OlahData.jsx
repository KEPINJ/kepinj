import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Trash2, Plus, Play, Download, Save, BookOpen, Receipt, ArrowUp, ArrowDown, X, Sparkles, HelpCircle, Table2, Loader2 } from 'lucide-react';
import { runPipeline, STEP_TYPES, AGG_LABELS } from '@shared/pipeline.js';
import { FUNCTION_NAMES, toNum } from '@shared/expr.js';
import { api, download, DEMO } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, useLoad, useToast, Empty, cx, Loading } from '../components/ui.jsx';
import { BULAN, rp, num, waktu, today } from '../lib/format.js';

const PRESETS = [
  { nama: 'PPh 21 dari daftar gaji (TER)', deskripsi: 'Kolom: Nama Pegawai, Status PTKP, Gaji Pokok, Tunjangan…', config: { steps: [
    { type: 'compute', name: 'Bruto', expr: '[Gaji Pokok] + [Tunjangan Keluarga] + [Tunjangan Jabatan] + [Tunjangan Beras]' },
    { type: 'compute', name: 'Tarif TER (%)', expr: 'TARIF_TER([Bruto], [Status PTKP])' },
    { type: 'compute', name: 'PPh 21', expr: 'PPH21([Bruto], [Status PTKP])' },
    { type: 'compute', name: 'Diterima Bersih', expr: '[Bruto] - [PPh 21]' },
    { type: 'sort', column: 'PPh 21', dir: 'desc' }] } },
  { nama: 'Honor narasumber: PPh & netto', deskripsi: 'Kolom: Nama, Status (ASN/Non ASN), Golongan, Jam, Tarif per Jam', config: { steps: [
    { type: 'compute', name: 'Honor Bruto', expr: '[Jam] * [Tarif per Jam]' },
    { type: 'compute', name: 'PPh 21', expr: 'IF([Status] = "ASN", HONOR_ASN([Honor Bruto], [Golongan]), PPH21_BP([Honor Bruto]))' },
    { type: 'compute', name: 'Netto', expr: '[Honor Bruto] - [PPh 21]' }] } },
  { nama: 'Rekap belanja per kode rekening', deskripsi: 'Kolom: Kode Rekening, Nilai', config: { steps: [
    { type: 'group', by: ['Kode Rekening'], aggs: [{ column: 'Nilai', fn: 'sum', as: 'Total Nilai' }, { column: 'Nilai', fn: 'count', as: 'Jumlah Transaksi' }] },
    { type: 'sort', column: 'Total Nilai', dir: 'desc' }] } },
];

const newStep = (type, cols) => ({
  filter: { type, expr: '' }, compute: { type, name: 'Kolom Baru', expr: '' }, rename: { type, from: cols[0], to: '' },
  select: { type, columns: [...cols] }, group: { type, by: [cols[0]].filter(Boolean), aggs: [] }, sort: { type, column: cols[0], dir: 'asc' },
  dedupe: { type, columns: [] }, limit: { type, n: 100 },
}[type]);

function ColumnChecks({ cols, value = [], onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {cols.map((c) => {
        const on = value.includes(c);
        return <button type="button" key={c} onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])} className={cx('rounded-md border px-2 py-0.5 text-xs', on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>{c}</button>;
      })}
    </div>
  );
}

function StepEditor({ step, cols, onChange }) {
  const set = (k) => (e) => onChange({ ...step, [k]: e?.target ? e.target.value : e });
  const colOpts = cols.map((c) => ({ value: c, label: c }));
  switch (step.type) {
    case 'filter': return <Field label="Kondisi (baris yang memenuhi dipertahankan)" hint='Contoh: [Nilai] > 2000000 AND [Status] = "ASN"'><Input className="font-mono text-xs" value={step.expr} onChange={set('expr')} /></Field>;
    case 'compute': return (
      <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
        <Field label="Nama kolom hasil"><Input value={step.name} onChange={set('name')} /></Field>
        <Field label="Rumus" hint="Klik nama kolom di bawah untuk menyisipkan"><Input className="font-mono text-xs" value={step.expr} onChange={set('expr')} /></Field>
        <div className="flex flex-wrap gap-1 sm:col-span-2">{cols.map((c) => <button type="button" key={c} onClick={() => onChange({ ...step, expr: `${step.expr}[${c}]` })} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-brand-100">[{c}]</button>)}</div>
      </div>
    );
    case 'rename': return <div className="grid gap-2 sm:grid-cols-2"><Field label="Kolom"><Select value={step.from} onChange={set('from')} options={colOpts} /></Field><Field label="Nama baru"><Input value={step.to} onChange={set('to')} /></Field></div>;
    case 'select': return <Field label="Kolom yang ditampilkan"><ColumnChecks cols={cols} value={step.columns} onChange={set('columns')} /></Field>;
    case 'dedupe': return <Field label="Kunci duplikat (kosong = semua kolom)"><ColumnChecks cols={cols} value={step.columns} onChange={set('columns')} /></Field>;
    case 'sort': return <div className="grid gap-2 sm:grid-cols-2"><Field label="Kolom"><Select value={step.column} onChange={set('column')} options={colOpts} /></Field><Field label="Arah"><Select value={step.dir} onChange={set('dir')} options={[{ value: 'asc', label: 'Kecil → besar / A → Z' }, { value: 'desc', label: 'Besar → kecil / Z → A' }]} /></Field></div>;
    case 'limit': return <Field label="Jumlah baris"><Input type="number" value={step.n} onChange={set('n')} /></Field>;
    case 'group': return (
      <div className="space-y-2">
        <Field label="Kelompokkan berdasarkan"><ColumnChecks cols={cols} value={step.by} onChange={set('by')} /></Field>
        <p className="label">Rekap</p>
        {(step.aggs || []).map((a, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <Select value={a.fn} onChange={(e) => onChange({ ...step, aggs: step.aggs.map((x, j) => (j === i ? { ...x, fn: e.target.value } : x)) })} options={Object.entries(AGG_LABELS).map(([value, label]) => ({ value, label }))} />
            <Select value={a.column} onChange={(e) => onChange({ ...step, aggs: step.aggs.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })} options={colOpts} />
            <Input placeholder="Nama hasil" value={a.as || ''} onChange={(e) => onChange({ ...step, aggs: step.aggs.map((x, j) => (j === i ? { ...x, as: e.target.value } : x)) })} />
            <button type="button" className="p-1 text-slate-400 hover:text-rose-600" onClick={() => onChange({ ...step, aggs: step.aggs.filter((_, j) => j !== i) })} aria-label="Hapus"><X className="h-4 w-4" /></button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange({ ...step, aggs: [...(step.aggs || []), { fn: 'sum', column: cols.find((c) => !step.by.includes(c)) || cols[0], as: '' }] })}>Tambah rekap</Button>
      </div>
    );
    default: return null;
  }
}

const SAMPLES = [
  ['contoh_daftar_gaji_oktober.xlsx', 'Daftar gaji pegawai (hitung PPh 21 TER)'],
  ['contoh_honor_narasumber.xlsx', 'Honor narasumber ASN/non ASN'],
  ['contoh_transaksi_belanja.xlsx', 'Transaksi belanja untuk diimpor ke BKU'],
  ['contoh_mutasi_bank_september.csv', 'Mutasi rekening koran (rekonsiliasi bank)'],
];

export default function OlahData() {
  const { skpdId, tahun, can } = useApp();
  const toast = useToast();
  const datasets = useLoad(() => api.get('/api/data/datasets'), []);
  const templates = useLoad(() => api.get('/api/data/pipelines'), []);
  const [dsId, setDsId] = useState(null);
  const [sample, setSample] = useState(null);
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [runErr, setRunErr] = useState('');
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [modal, setModal] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef();
  const ds = datasets.data?.rows.find((d) => d.id === dsId);

  useEffect(() => { if (!dsId && datasets.data?.rows.length) setDsId(datasets.data.rows[0].id); }, [datasets.data, dsId]);
  useEffect(() => { if (dsId) api.get(`/api/data/datasets/${dsId}`, { limit: 200 }).then((r) => setSample(r)); }, [dsId]);
  // kolom yang tersedia di awal tiap langkah (dihitung di browser dari sampel)
  const colsAt = useMemo(() => {
    if (!sample) return [];
    return steps.map((_, i) => { try { return runPipeline(sample.dataset.columns, sample.rows, steps.slice(0, i)).columns; } catch { return sample.dataset.columns; } });
  }, [sample, steps]);
  useEffect(() => {
    if (!dsId) return undefined;
    const t = setTimeout(async () => {
      setRunning(true);
      try { setResult(await api.post('/api/data/run', { dataset_id: dsId, steps, limit: 300 })); setRunErr(''); } catch (e) { setRunErr(e.message); } finally { setRunning(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [dsId, JSON.stringify(steps)]);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await api.upload('/api/data/upload', file);
      toast(`${r.datasets.length} sheet terbaca (${r.datasets.reduce((s, d) => s + d.row_count, 0).toLocaleString('id-ID')} baris)`);
      await datasets.reload(); setDsId(r.datasets[0].id); setSteps([]);
    } catch (e) { toast(e.message, 'error'); } finally { setUploading(false); }
  };
  const removeDs = async (id) => {
    if (!window.confirm('Hapus dataset ini?')) return;
    await api.del(`/api/data/datasets/${id}`); if (id === dsId) { setDsId(null); setSample(null); setResult(null); } datasets.reload();
  };
  const saveTemplate = async () => {
    const nama = window.prompt('Nama templat pengolahan:');
    if (!nama) return;
    try { await api.post('/api/data/pipelines', { nama, config: { steps } }); toast('Templat disimpan dan dapat dipakai semua pengguna'); templates.reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const updStep = (i, s) => setSteps((x) => x.map((y, j) => (j === i ? s : y)));
  const move = (i, d) => setSteps((x) => { const a = [...x]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a; });

  return (
    <div className="space-y-4">
      <PageHeader icon={Upload} title="Upload & Olah Data" subtitle="Unggah Excel/CSV, susun langkah pengolahan dan rumus, lalu ekspor atau simpan langsung ke BKU / register pajak"
        actions={<Button variant="secondary" icon={HelpCircle} onClick={() => setModal('help')}>Panduan rumus</Button>} />
      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current.click()} className={cx('card flex cursor-pointer flex-col items-center justify-center border-2 border-dashed p-6 text-center transition', drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400')}>
            {uploading ? <Loader2 className="h-8 w-8 animate-spin text-brand-600" /> : <Upload className="h-8 w-8 text-brand-600" />}
            <p className="mt-2 text-sm font-medium text-slate-700">{uploading ? 'Membaca file…' : 'Tarik file ke sini atau klik'}</p>
            <p className="text-xs text-slate-500">.xlsx atau .csv · baris judul terdeteksi otomatis</p>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
          </div>
          {DEMO && (
            <div className="card p-3 text-xs text-slate-600">
              <p className="font-medium text-slate-700">File contoh untuk dicoba</p>
              <ul className="mt-1.5 space-y-1">
                {SAMPLES.map(([f, label]) => (
                  <li key={f}><a className="inline-flex items-center gap-1.5 text-brand-700 hover:underline" href={`${import.meta.env.BASE_URL}demo/contoh/${f}`} download><Download className="h-3.5 w-3.5" />{label}</a></li>
                ))}
              </ul>
            </div>
          )}
          <Card title="Dataset" bodyClass="max-h-72 overflow-y-auto p-1.5">
            {!datasets.data?.rows.length ? <p className="p-3 text-xs text-slate-500">Belum ada file diunggah.</p> : datasets.data.rows.map((d) => (
              <div key={d.id} className={cx('group flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2', d.id === dsId ? 'bg-brand-50' : 'hover:bg-slate-50')} onClick={() => { setDsId(d.id); setSteps([]); }}>
                <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm text-slate-800">{d.nama}</p><p className="text-[11px] text-slate-500">{num(d.row_count)} baris · {d.columns.length} kolom · {waktu(d.created_at)}</p></div>
                <button type="button" className="hidden p-0.5 text-slate-400 hover:text-rose-600 group-hover:block" onClick={(e) => { e.stopPropagation(); removeDs(d.id); }} aria-label="Hapus"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </Card>
          <Card title="Templat pengolahan" bodyClass="p-1.5">
            {PRESETS.map((t) => (
              <button type="button" key={t.nama} onClick={() => setSteps(t.config.steps)} className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" /><span><span className="block text-sm text-slate-800">{t.nama}</span><span className="text-[11px] text-slate-500">{t.deskripsi}</span></span>
              </button>
            ))}
            {templates.data?.rows.map((t) => (
              <div key={t.id} className="group flex items-start gap-2 rounded-lg px-2.5 py-2 hover:bg-slate-50">
                <button type="button" className="flex flex-1 items-start gap-2 text-left" onClick={() => setSteps(t.config.steps || [])}>
                  <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><span><span className="block text-sm text-slate-800">{t.nama}</span><span className="text-[11px] text-slate-500">oleh {t.pembuat}</span></span>
                </button>
                <button type="button" className="hidden p-0.5 text-slate-400 hover:text-rose-600 group-hover:block" onClick={async () => { await api.del(`/api/data/pipelines/${t.id}`); templates.reload(); }} aria-label="Hapus templat"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {!ds ? <Card><Empty icon={Table2} title="Pilih atau unggah dataset" text="Contoh file tersedia di folder samples/: daftar gaji, honor narasumber, transaksi belanja, dan mutasi bank." /></Card> : (
            <>
              <Card title={ds.nama} subtitle={`${num(ds.row_count)} baris · kolom: ${ds.columns.join(', ')}`}
                actions={<>
                  <Button size="sm" variant="secondary" icon={Save} disabled={!steps.length} onClick={saveTemplate}>Simpan templat</Button>
                  <Button size="sm" variant="secondary" icon={Download} onClick={() => download('/api/data/export', { body: { dataset_id: dsId, steps } }).catch((e) => toast(e.message, 'error'))}>Ekspor Excel</Button>
                  {can('admin', 'bendahara') && <Button size="sm" variant="secondary" icon={BookOpen} onClick={() => setModal('bku')}>Simpan ke BKU</Button>}
                  {can('admin', 'bendahara') && <Button size="sm" icon={Receipt} onClick={() => setModal('pajak')}>Hitung pajak massal</Button>}
                </>}>
                <div className="space-y-2">
                  {steps.map((s, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-700"><span className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-brand-800 text-[10px] text-white">{i + 1}</span>{STEP_TYPES[s.type]}
                          {result?.log?.[i] && <span className="ml-2 font-normal text-slate-500">{num(result.log[i].rowsBefore)} → {num(result.log[i].rowsAfter)} baris</span>}</p>
                        <div className="flex items-center">
                          <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Naik"><ArrowUp className="h-3.5 w-3.5" /></button>
                          <button type="button" disabled={i === steps.length - 1} onClick={() => move(i, 1)} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Turun"><ArrowDown className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-rose-600" aria-label="Hapus langkah"><X className="h-4 w-4" /></button>
                        </div>
                      </div>
                      <StepEditor step={s} cols={colsAt[i] || ds.columns} onChange={(v) => updStep(i, v)} />
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-slate-500">Tambah langkah:</span>
                    {Object.entries(STEP_TYPES).map(([k, l]) => <Button key={k} size="sm" variant="secondary" icon={Plus} onClick={() => setSteps([...steps, newStep(k, result?.columns || ds.columns)])}>{l}</Button>)}
                  </div>
                </div>
              </Card>
              {runErr && <Alert tone="error">{runErr}</Alert>}
              <Card title="Hasil" subtitle={result ? `${num(result.total)} baris · diproses ${result.ms} ms${result.total > result.rows.length ? ` · menampilkan ${result.rows.length} baris pertama` : ''}` : ''}
                actions={running && <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />memproses</span>} bodyClass="">
                {!result ? <Loading /> : (
                  <div className="max-h-[60vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10"><tr><th className="th w-10">#</th>{result.columns.map((c) => <th key={c} className={cx('th', result.totals[c] != null && 'text-right')}>{c}</th>)}</tr></thead>
                      <tbody>
                        {result.rows.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="td num text-xs text-slate-400">{i + 1}</td>
                            {result.columns.map((c) => {
                              const v = r[c]; const isNum = result.totals[c] != null;
                              const err = typeof v === 'string' && v.startsWith('#ERROR');
                              return <td key={c} className={cx('td whitespace-nowrap', isNum && 'num text-right', err && 'text-rose-600')}>{isNum && v !== '' && v != null && !err ? toNum(v).toLocaleString('id-ID', { maximumFractionDigits: 2 }) : String(v ?? '')}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                      {Object.keys(result.totals).length > 0 && (
                        <tfoot className="sticky bottom-0"><tr className="bg-brand-50 font-semibold"><td className="td text-xs">Σ</td>{result.columns.map((c) => <td key={c} className="td num whitespace-nowrap text-right">{result.totals[c] != null ? result.totals[c].toLocaleString('id-ID', { maximumFractionDigits: 2 }) : ''}</td>)}</tr></tfoot>
                      )}
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
      <CommitBku open={modal === 'bku'} onClose={() => setModal(null)} dsId={dsId} steps={steps} cols={result?.columns || []} skpdId={skpdId} />
      <CommitPajak open={modal === 'pajak'} onClose={() => setModal(null)} dsId={dsId} steps={steps} cols={result?.columns || []} skpdId={skpdId} tahun={tahun} />
      <Help open={modal === 'help'} onClose={() => setModal(null)} />
    </div>
  );
}

const guess = (cols, ...keys) => cols.find((c) => keys.some((k) => c.toLowerCase().includes(k))) || '';

function MapSelect({ label, cols, value, onChange, optional }) {
  return <Field label={label}><Select value={value} onChange={(e) => onChange(e.target.value)} placeholder={optional ? '— tidak dipakai —' : '— pilih kolom —'} options={cols} /></Field>;
}

function CommitBku({ open, onClose, dsId, steps, cols, skpdId }) {
  const toast = useToast();
  const [m, setM] = useState({});
  const [d, setD] = useState({ jenis: 'BELANJA', metode: 'bank', arah: 'pengeluaran', kode_rekening: '' });
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCheck(null);
      setM({ tanggal: guess(cols, 'tanggal', 'tgl'), uraian: guess(cols, 'uraian', 'keterangan', 'deskripsi'), no_bukti: guess(cols, 'bukti', 'nomor'), kode_rekening: guess(cols, 'rekening', 'kode'), nilai: guess(cols, 'nilai', 'jumlah', 'total'), penerimaan: '', pengeluaran: '' });
    }
  }, [open]);
  const body = (dry) => ({ dataset_id: dsId, steps, skpd_id: skpdId, mapping: Object.fromEntries(Object.entries(m).filter(([, v]) => v)), defaults: d, dry_run: dry });
  const run = async (dry) => {
    setBusy(true);
    try {
      const r = await api.post('/api/data/commit/bku', body(dry));
      if (r.dry_run) setCheck(r); else { toast(`${num(r.saved)} transaksi disimpan ke BKU (No. ${r.no_urut_awal}–${r.no_urut_akhir}, batch ${r.batch})`); onClose(); }
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const set = (k) => (v) => { setM({ ...m, [k]: v }); setCheck(null); };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Simpan hasil olahan ke BKU" subtitle="Petakan kolom data ke field BKU. Periksa dulu sebelum menyimpan; semua baris disimpan dalam satu transaksi database."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant="secondary" loading={busy} onClick={() => run(true)}>Periksa</Button><Button loading={busy} disabled={!check || check.jumlah_error > 0} onClick={() => run(false)}>Simpan {check ? num(check.valid) : ''} transaksi</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <MapSelect label="Tanggal" cols={cols} value={m.tanggal} onChange={set('tanggal')} />
        <MapSelect label="Uraian" cols={cols} value={m.uraian} onChange={set('uraian')} />
        <MapSelect label="No. bukti" cols={cols} value={m.no_bukti} onChange={set('no_bukti')} optional />
        <MapSelect label="Kode rekening" cols={cols} value={m.kode_rekening} onChange={set('kode_rekening')} optional />
        <MapSelect label="Nilai (satu kolom)" cols={cols} value={m.nilai} onChange={set('nilai')} optional />
        <Field label="Arah nilai"><Select value={d.arah} onChange={(e) => setD({ ...d, arah: e.target.value })} options={[{ value: 'pengeluaran', label: 'Pengeluaran' }, { value: 'penerimaan', label: 'Penerimaan' }]} /></Field>
        <MapSelect label="…atau kolom Penerimaan" cols={cols} value={m.penerimaan} onChange={set('penerimaan')} optional />
        <MapSelect label="…dan kolom Pengeluaran" cols={cols} value={m.pengeluaran} onChange={set('pengeluaran')} optional />
        <Field label="Jenis transaksi"><Select value={d.jenis} onChange={(e) => setD({ ...d, jenis: e.target.value })} options={['BELANJA', 'PENERIMAAN', 'SP2D_LS', 'SP2D_GU', 'PENYETORAN', 'LAINNYA']} /></Field>
        <Field label="Kas"><Select value={d.metode} onChange={(e) => setD({ ...d, metode: e.target.value })} options={[{ value: 'bank', label: 'Bank' }, { value: 'tunai', label: 'Tunai' }]} /></Field>
      </div>
      {check && (
        <div className="mt-4 space-y-2">
          <Alert tone={check.jumlah_error ? 'warn' : 'ok'} title={`${num(check.valid)} baris valid${check.jumlah_error ? `, ${num(check.jumlah_error)} bermasalah` : ''}`}>
            Total penerimaan {rp(check.total_penerimaan)} · pengeluaran {rp(check.total_pengeluaran)}
          </Alert>
          {check.errors.length > 0 && <ul className="max-h-40 overflow-y-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{check.errors.map((e, i) => <li key={i}>Baris {e.baris}: {e.pesan}</li>)}</ul>}
        </div>
      )}
    </Modal>
  );
}

function CommitPajak({ open, onClose, dsId, steps, cols, skpdId, tahun }) {
  const toast = useToast();
  const [m, setM] = useState({});
  const [o, setO] = useState({ metode: 'pph21_bulanan', masa: new Date().getMonth() + 1, kode_objek: '' });
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCheck(null);
      setM({ nama: guess(cols, 'nama'), bruto: guess(cols, 'bruto', 'honor bruto', 'gaji', 'nilai'), status_ptkp: guess(cols, 'ptkp'), npwp: guess(cols, 'npwp'), nik: guess(cols, 'nik'), golongan: guess(cols, 'golongan', 'gol'), jabatan: guess(cols, 'jabatan') });
    }
  }, [open]);
  const run = async (dry) => {
    setBusy(true);
    try {
      const r = await api.post('/api/data/commit/pajak', { dataset_id: dsId, steps, skpd_id: skpdId, tahun, ...o, mapping: Object.fromEntries(Object.entries(m).filter(([, v]) => v)), dry_run: dry });
      if (r.dry_run) setCheck(r); else { toast(`${num(r.saved)} bukti potong tersimpan, total pajak ${rp(r.total_pajak)}`); onClose(); }
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const set = (k) => (v) => { setM({ ...m, [k]: v }); setCheck(null); };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Hitung pajak massal" subtitle="Pajak setiap baris dihitung otomatis lalu disimpan sebagai bukti potong di register pajak (siap ekspor Coretax)."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant="secondary" loading={busy} onClick={() => run(true)}>Hitung & periksa</Button><Button loading={busy} disabled={!check || check.jumlah_error > 0} onClick={() => run(false)}>Simpan {check ? num(check.valid) : ''} bukti potong</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Metode perhitungan" className="sm:col-span-2"><Select value={o.metode} onChange={(e) => { setO({ ...o, metode: e.target.value }); setCheck(null); }} options={[
          { value: 'pph21_bulanan', label: 'PPh 21 pegawai tetap — TER bulanan' }, { value: 'pph21_honor_asn', label: 'PPh 21 honor ASN — final per golongan' },
          { value: 'pph21_bukan_pegawai', label: 'PPh 21 bukan pegawai — 50% × Pasal 17' }, { value: 'pph22', label: 'PPh 22 pembelian barang 1,5%' },
          { value: 'pph23', label: 'PPh 23 jasa 2%' }, { value: 'pph4a2', label: 'PPh 4(2) — tarif dari kolom' }]} /></Field>
        <Field label="Masa pajak"><Select value={o.masa} onChange={(e) => setO({ ...o, masa: Number(e.target.value) })} options={BULAN.map((b, i) => ({ value: i + 1, label: `${b} ${tahun}` }))} /></Field>
        <MapSelect label="Nama penerima" cols={cols} value={m.nama} onChange={set('nama')} />
        <MapSelect label="Penghasilan bruto / DPP" cols={cols} value={m.bruto} onChange={set('bruto')} />
        <MapSelect label="Status PTKP" cols={cols} value={m.status_ptkp} onChange={set('status_ptkp')} optional />
        <MapSelect label="NPWP" cols={cols} value={m.npwp} onChange={set('npwp')} optional />
        <MapSelect label="NIK" cols={cols} value={m.nik} onChange={set('nik')} optional />
        <MapSelect label="Golongan" cols={cols} value={m.golongan} onChange={set('golongan')} optional />
        <MapSelect label="Jabatan" cols={cols} value={m.jabatan} onChange={set('jabatan')} optional />
        {o.metode === 'pph4a2' && <MapSelect label="Tarif (%)" cols={cols} value={m.tarif} onChange={set('tarif')} />}
        <Field label="Kode objek pajak (opsional)" hint="Kosong = kode bawaan metode"><Input value={o.kode_objek} onChange={(e) => setO({ ...o, kode_objek: e.target.value })} placeholder="mis. 21-100-01" /></Field>
      </div>
      {check && (
        <div className="mt-4 space-y-2">
          <Alert tone={check.jumlah_error ? 'warn' : 'ok'} title={`${num(check.valid)} bukti potong · total pajak ${rp(check.total_pajak)}`}>{check.jumlah_error ? `${check.jumlah_error} baris bermasalah` : 'Siap disimpan.'}</Alert>
          {check.errors.length > 0 && <ul className="max-h-32 overflow-y-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{check.errors.map((e, i) => <li key={i}>Baris {e.baris}: {e.pesan}</li>)}</ul>}
          <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs"><thead className="sticky top-0"><tr><th className="th">Nama</th><th className="th">PTKP</th><th className="th text-right">Bruto</th><th className="th text-right">Tarif</th><th className="th text-right">Pajak</th></tr></thead>
              <tbody>{check.contoh.map((c, i) => <tr key={i}><td className="td">{c.penerima_nama}</td><td className="td">{c.status_ptkp || '-'}{c.detail?.kategori && <Badge className="ml-1">TER {c.detail.kategori}</Badge>}</td><td className="td num text-right">{num(c.detail.bruto)}</td><td className="td num text-right">{num(c.tarif)}%</td><td className="td num text-right font-medium">{num(c.nominal)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Help({ open, onClose }) {
  const rows = [
    ['[Nama Kolom]', 'Mengambil nilai kolom. Angka format Indonesia "1.250.000,50" atau "Rp 2.000" dibaca otomatis.'],
    ['+ − * / ( )', 'Operasi hitung. 15% dibaca 0,15.'],
    ['= <> < <= > >=  AND OR NOT', 'Perbandingan & logika, untuk Saring baris atau IF.'],
    ['IF(kondisi, jika_ya, jika_tidak)', 'Percabangan. Contoh: IF([Gol] = "IV", [Honor]*15%, [Honor]*5%)'],
    ['ROUND(x, d) FLOOR CEIL ABS MIN MAX', 'Pembulatan & fungsi angka.'],
    ['UPPER LOWER TRIM LEFT RIGHT LEN CONCAT CONTAINS', 'Fungsi teks. Operator & untuk menggabung teks.'],
    ['YEAR MONTH DAY', 'Bagian tanggal.'],
    ['PPH21(bruto, ptkp)', 'PPh 21 bulanan metode TER.'],
    ['TARIF_TER(bruto, ptkp)', 'Tarif TER (%) yang berlaku.'],
    ['HONOR_ASN(bruto, golongan)', 'PPh 21 final honor ASN (0/5/15%).'],
    ['PPH21_BP(bruto, kumulatif)', 'PPh 21 bukan pegawai (50% × Pasal 17).'],
    ['PPN(nilai, termasuk_ppn) DPP(…)', 'PPN 12% × DPP 11/12 dan DPP-nya.'],
    ['PPH22(dpp) PPH23(dpp, ada_npwp)', 'PPh 22 1,5%, PPh 23 2% (4% tanpa NPWP).'],
    ['TERBILANG(x)', 'Angka menjadi kalimat rupiah.'],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Panduan rumus Olah Data" size="lg">
      <table className="w-full text-sm"><tbody>{rows.map(([a, b]) => <tr key={a}><td className="td whitespace-nowrap font-mono text-xs text-brand-800">{a}</td><td className="td text-slate-600">{b}</td></tr>)}</tbody></table>
      <p className="mt-3 text-xs text-slate-500">Fungsi tersedia: {FUNCTION_NAMES.join(', ')}.</p>
    </Modal>
  );
}
