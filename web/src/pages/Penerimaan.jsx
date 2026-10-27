import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PiggyBank, Plus, Printer, Download, Landmark, AlarmClock, Target, CheckCircle2, Send, FileText, Pencil } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { terbilang } from '@shared/terbilang.js';
import { api, download } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Combo, Empty, Field, Input, Modal, MoneyInput, PageHeader, Progress, Select, SkeletonRows, Stat, Tabs, Textarea, cx, useLoad, useToast } from '../components/ui.jsx';
import { BULAN, compact, money, rp, tgl, today } from '../lib/format.js';
import { SERIES } from '../lib/palette.js';

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-700">{label}</p>
      {payload.map((p) => <p key={p.dataKey} className="flex items-center gap-2 text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: <span className="num font-medium text-slate-800">{rp(p.value)}</span></p>)}
    </div>
  );
}

export default function Penerimaan() {
  const { skpdId, skpd, tahun, can } = useApp();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'bku');
  const [bulan, setBulan] = useState(() => (tahun === new Date().getFullYear() ? new Date().getMonth() + 1 : 0));
  const [baru, setBaru] = useState(false);
  const [pilih, setPilih] = useState([]);
  const [stsOpen, setStsOpen] = useState(false);
  const [target, setTarget] = useState(null);
  const tulis = can('admin', 'bendahara_penerimaan');
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/penerimaan', { skpd_id: skpdId, tahun, bulan: bulan || undefined }), [skpdId, tahun, bulan]);
  const { data: sts, reload: reloadSts } = useLoad(() => skpdId && api.get('/api/sts', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  const muat = () => { reload(); reloadSts(); };
  useLive((e) => e.type === 'penerimaan.updated' && muat(), 600);

  useEffect(() => {
    if (sp.get('baru') && tulis) setBaru(true);
    if (sp.get('tab')) setTab(sp.get('tab'));
    if (sp.toString()) setSp({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  useEffect(() => setPilih((sts?.belum || []).filter((b) => b.tanggal < sts.batas).map((b) => b.id)), [sts]);

  const rg = data?.ringkasan;
  const setahun = useMemo(() => (data?.bulanan || []).reduce((t, b) => ({ terima: t.terima + b.terima, setor: t.setor + b.setor }), { terima: 0, setor: 0 }), [data]);
  const real = data?.realisasi || [];
  const totTarget = real.reduce((s, r) => s + r.target, 0); const totReal = real.reduce((s, r) => s + r.realisasi, 0);
  const belum = sts?.belum || [];
  const nilaiPilih = belum.filter((b) => pilih.includes(b.id)).reduce((s, b) => s + Number(b.penerimaan), 0);

  return (
    <div className="space-y-5">
      <PageHeader icon={PiggyBank} title="Bendahara Penerimaan" subtitle="BKU penerimaan, Surat Tanda Setoran (STS) ke kas daerah, dan realisasi target pendapatan"
        actions={<>
          <Button variant="secondary" icon={Download} onClick={() => download('/api/penerimaan', { params: { skpd_id: skpdId, tahun, bulan: bulan || undefined, format: 'xlsx' } }).catch((e) => toast(e.message, 'error'))}>Excel</Button>
          <Button variant="secondary" icon={Printer} onClick={() => { setTab('bku'); setTimeout(() => window.print(), 50); }}>Cetak BKU</Button>
          {tulis && <Button icon={Plus} onClick={() => setBaru(true)}>Catat penerimaan</Button>}
        </>} />

      <div className="no-print grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Penerimaan TA ${tahun}`} value={data ? compact(setahun.terima) : '…'} sub={data && rp(setahun.terima)} icon={PiggyBank} tone="brand" />
        <Stat label="Disetor ke kas daerah" value={data ? compact(setahun.setor) : '…'} sub={sts && `${sts.rows.length} STS diterbitkan`} icon={Landmark} tone="green" />
        <Stat label="Belum disetor" value={rg ? compact(rg.belum_setor.nilai) : '…'} sub={rg && (rg.belum_setor.jumlah ? `${rp(rg.belum_setor.nilai)} · ${rg.belum_setor.jumlah} penerimaan, ${rg.belum_setor.terlambat} terlambat` : 'Saldo kas nihil')} icon={AlarmClock} tone={rg?.belum_setor.terlambat ? 'red' : rg?.belum_setor.jumlah ? 'amber' : 'green'} />
        <Stat label="Realisasi target" value={totTarget ? `${((totReal / totTarget) * 100).toFixed(1)}%` : '-'} sub={totTarget ? `${compact(totReal)} dari ${compact(totTarget)}` : 'Target belum ditetapkan'} icon={Target} tone="violet"
          trend={totTarget ? <Progress className="mt-2" value={(totReal / totTarget) * 100} /> : null} />
      </div>
      {rg?.belum_setor.terlambat > 0 && (
        <Alert className="no-print" tone="error" title={`${rg.belum_setor.terlambat} penerimaan terlambat disetor`}>
          Penerimaan wajib disetor ke rekening kas umum daerah paling lambat 1 hari kerja. Penerimaan tertua bertanggal {tgl(rg.belum_setor.tertua)}.
          {tulis && <button type="button" className="ml-1 font-semibold underline" onClick={() => setTab('sts')}>Buat STS sekarang</button>}
        </Alert>
      )}

      <Card className="no-print" bodyClass="" title={{ bku: 'Buku Kas Umum Penerimaan', sts: 'Surat Tanda Setoran', target: 'Target dan realisasi pendapatan' }[tab]}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'bku', label: 'BKU Penerimaan' }, { value: 'sts', label: 'STS', count: belum.length || undefined }, { value: 'target', label: 'Target & realisasi' }]} />}>
        {tab === 'bku' && (<>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Select className="w-44" value={bulan} onChange={(e) => setBulan(Number(e.target.value))} options={[{ value: 0, label: 'Setahun' }, ...BULAN.map((b, i) => ({ value: i + 1, label: b }))]} />
            {rg && <p className="text-xs text-slate-500">Saldo awal <b className="num text-slate-700">{rp(rg.saldo_awal)}</b> · diterima <b className="num text-slate-700">{rp(rg.terima)}</b> · disetor <b className="num text-slate-700">{rp(rg.setor)}</b> · saldo akhir <b className="num text-slate-700">{rp(rg.saldo_akhir)}</b></p>}
          </div>
          {loading && !data ? <SkeletonRows /> : !data?.rows.length ? <Empty icon={PiggyBank} title="Belum ada penerimaan" text="Penerimaan retribusi dan pendapatan lain yang diterima bendahara tampil di sini." /> : (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[960px]">
                <thead className="sticky top-0 z-10"><tr><th className="th w-12">No</th><th className="th">Tanggal</th><th className="th">No. bukti</th><th className="th">Uraian</th><th className="th text-right">Penerimaan</th><th className="th text-right">Penyetoran</th><th className="th text-right">Saldo</th><th className="th">STS</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className={cx('hover:bg-brand-50/40', r.jenis === 'SETOR' && 'bg-emerald-50/30')}>
                      <td className="td num text-xs text-slate-500">{r.no_urut}</td>
                      <td className="td whitespace-nowrap text-xs">{tgl(r.tanggal)}</td>
                      <td className="td font-mono text-[11px] text-slate-600">{r.no_bukti}</td>
                      <td className="td"><p className="line-clamp-2 text-sm text-slate-800">{r.uraian}</p>{r.kode_rekening && <p className="font-mono text-[11px] text-slate-500">{r.kode_rekening}{r.metode === 'tunai' ? ' · tunai' : ' · bank'}</p>}</td>
                      <td className="td num whitespace-nowrap text-right">{Number(r.penerimaan) ? money(r.penerimaan) : ''}</td>
                      <td className="td num whitespace-nowrap text-right">{Number(r.pengeluaran) ? money(r.pengeluaran) : ''}</td>
                      <td className="td num whitespace-nowrap text-right font-medium">{money(r.saldo)}</td>
                      <td className="td">
                        {r.jenis === 'TERIMA' && (r.sts_nomor ? <Badge color="green"><CheckCircle2 className="h-3 w-3" />{tgl(r.sts_tanggal)}</Badge> : <Badge color={r.tanggal < (sts?.batas || '') ? 'red' : 'amber'}>Belum disetor</Badge>)}
                        {r.jenis === 'SETOR' && <span className="font-mono text-[11px] text-slate-500">{r.sts_nomor}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>)}

        {tab === 'sts' && (
          <div className="grid gap-0 lg:grid-cols-5">
            <div className="border-b border-slate-100 p-4 lg:col-span-2 lg:border-b-0 lg:border-r">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div><p className="text-sm font-semibold text-slate-800">Penerimaan belum disetor</p><p className="text-xs text-slate-500">Batas setor: penerimaan sebelum {tgl(sts?.batas)} sudah terlambat</p></div>
              </div>
              {!belum.length ? <Empty icon={CheckCircle2} title="Semua sudah disetor" text="Tidak ada kas penerimaan yang mengendap di bendahara." /> : (<>
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {belum.map((b) => {
                    const telat = b.tanggal < sts.batas;
                    return (
                      <label key={b.id} className={cx('flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-slate-50', telat && 'bg-rose-50/50')}>
                        <input type="checkbox" className="mt-1" checked={pilih.includes(b.id)} disabled={!tulis} onChange={(e) => setPilih((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))} />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-1 text-sm text-slate-800">{b.uraian}</p>
                          <p className="text-[11px] text-slate-500">{tgl(b.tanggal)} · {b.no_bukti} · {b.metode === 'bank' ? 'Bank' : 'Tunai'}</p>
                        </div>
                        <div className="text-right"><p className="num text-sm font-semibold">{money(b.penerimaan)}</p>{telat && <Badge color="red">Terlambat</Badge>}</div>
                      </label>
                    );
                  })}
                </div>
                {tulis && <Button className="mt-3 w-full" icon={Send} disabled={!pilih.length} onClick={() => setStsOpen(true)}>Buat STS · {pilih.length} penerimaan · {rp(nilaiPilih)}</Button>}
              </>)}
            </div>
            <div className="lg:col-span-3">
              <p className="px-4 pt-4 text-sm font-semibold text-slate-800">Register STS</p>
              {!sts?.rows.length ? <Empty icon={Landmark} title="Belum ada STS" /> : (
                <div className="max-h-[480px] overflow-auto">
                  <table className="w-full min-w-[560px]">
                    <thead className="sticky top-0"><tr><th className="th">Nomor</th><th className="th">Tanggal</th><th className="th text-center">Item</th><th className="th text-right">Total</th><th className="th" /></tr></thead>
                    <tbody>{sts.rows.map((s) => (
                      <tr key={s.id} className="hover:bg-brand-50/40">
                        <td className="td font-mono text-xs">{s.nomor}</td><td className="td whitespace-nowrap text-xs">{tgl(s.tanggal)}</td>
                        <td className="td num text-center text-xs">{s.jumlah}</td><td className="td num whitespace-nowrap text-right">{money(s.total)}</td>
                        <td className="td text-right"><Link to={`/cetak/sts/${s.id}`} target="_blank"><Button size="sm" variant="ghost" icon={FileText}>Cetak</Button></Link></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'target' && (
          <div className="space-y-4 p-4">
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={data?.bulanan || []} barGap={2} margin={{ left: 4, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--slate-100))" />
                  <XAxis dataKey="nama" tickLine={false} axisLine={{ stroke: 'rgb(var(--slate-300))' }} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} />
                  <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} width={56} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgb(var(--slate-100) / .6)' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'rgb(var(--slate-600))' }} />
                  <Bar dataKey="terima" name="Diterima" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="setor" name="Disetor" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead><tr><th className="th">Rekening pendapatan</th><th className="th text-right">Target</th><th className="th text-right">Realisasi</th><th className="th min-w-[180px]">Capaian</th>{can('admin') && <th className="th" />}</tr></thead>
                <tbody>
                  {real.map((r) => (
                    <tr key={r.kode_rekening}>
                      <td className="td"><p className="text-sm text-slate-800">{r.nama}</p><p className="font-mono text-[11px] text-slate-500">{r.kode_rekening}</p></td>
                      <td className="td num whitespace-nowrap text-right">{r.target ? money(r.target) : '-'}</td>
                      <td className="td num whitespace-nowrap text-right">{money(r.realisasi)}</td>
                      <td className="td">{r.persen != null ? <div className="flex items-center gap-2"><div className="w-24 shrink-0"><Progress value={r.persen} /></div><span className="num text-xs font-semibold">{r.persen.toFixed(1)}%</span></div> : <span className="text-xs text-slate-400">tanpa target</span>}</td>
                      {can('admin') && <td className="td text-right"><button type="button" className="p-1 text-slate-400 hover:text-brand-700" aria-label="Ubah target" onClick={() => setTarget({ ...r })}><Pencil className="h-4 w-4" /></button></td>}
                    </tr>
                  ))}
                </tbody>
                {real.length > 0 && <tfoot><tr className="font-semibold"><td className="td">Jumlah</td><td className="td num text-right">{money(totTarget)}</td><td className="td num text-right">{money(totReal)}</td><td className="td num text-xs">{totTarget ? `${((totReal / totTarget) * 100).toFixed(1)}%` : ''}</td>{can('admin') && <td />}</tr></tfoot>}
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* Versi cetak: BKU Penerimaan */}
      <div className="theme-light print-area hidden bg-white p-8 text-[11px] text-black print:block">
        <div className="text-center">
          <p className="text-sm font-bold uppercase">{skpd?.nama}</p>
          <p className="mt-1 text-base font-bold">BUKU KAS UMUM BENDAHARA PENERIMAAN</p>
          <p>{bulan ? `Bulan ${BULAN[bulan - 1]} ` : ''}Tahun Anggaran {tahun}</p>
        </div>
        <table className="mt-4 w-full border-collapse">
          <thead><tr>{['No', 'Tanggal', 'No. Bukti', 'Kode Rekening', 'Uraian', 'Penerimaan', 'Penyetoran', 'Saldo'].map((h) => <th key={h} className="border border-black px-1.5 py-1">{h}</th>)}</tr></thead>
          <tbody>
            {(data?.rows || []).map((r) => (
              <tr key={r.id}><td className="border border-black px-1.5 text-center">{r.no_urut}</td><td className="whitespace-nowrap border border-black px-1.5">{tgl(r.tanggal)}</td><td className="border border-black px-1.5">{r.no_bukti}</td>
                <td className="border border-black px-1.5">{r.kode_rekening}</td><td className="border border-black px-1.5">{r.uraian}</td>
                <td className="border border-black px-1.5 text-right">{Number(r.penerimaan) ? money(r.penerimaan) : ''}</td><td className="border border-black px-1.5 text-right">{Number(r.pengeluaran) ? money(r.pengeluaran) : ''}</td><td className="border border-black px-1.5 text-right">{money(r.saldo)}</td></tr>
            ))}
            <tr className="font-bold"><td className="border border-black px-1.5" colSpan={5}>Jumlah</td><td className="border border-black px-1.5 text-right">{money(rg?.terima)}</td><td className="border border-black px-1.5 text-right">{money(rg?.setor)}</td><td className="border border-black px-1.5 text-right">{money(rg?.saldo_akhir)}</td></tr>
          </tbody>
        </table>
        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-[12px]">
          <div><p>Mengetahui,</p><p>Pengguna Anggaran</p><div className="h-16" /><p className="font-semibold underline">{skpd?.kepala_nama}</p><p>NIP. {skpd?.kepala_nip}</p></div>
          <div><p>{tgl(today(), { long: true })}</p><p>Bendahara Penerimaan</p><div className="h-16" /><p className="font-semibold underline">{data?.rows.find((r) => r.jenis === 'TERIMA')?.dibuat_oleh || '……………………'}</p></div>
        </div>
      </div>

      <FormPenerimaan open={baru} onClose={() => setBaru(false)} onSaved={(e) => { toast(`Penerimaan ${rp(e.penerimaan)} dicatat di BKU penerimaan`); muat(); }} />
      <FormSts open={stsOpen} onClose={() => setStsOpen(false)} items={belum.filter((b) => pilih.includes(b.id))} onSaved={(s) => { toast(`${s.nomor} diterbitkan, ${rp(s.total)} disetor ke kas daerah`); setPilih([]); muat(); window.open(`/cetak/sts/${s.id}`, '_blank'); }} />
      <FormTarget r={target} onClose={() => setTarget(null)} onSaved={() => { toast('Target pendapatan disimpan'); reload(); }} />
    </div>
  );
}

function FormPenerimaan({ open, onClose, onSaved }) {
  const { skpdId } = useApp();
  const [rek, setRek] = useState([]);
  const [f, setF] = useState({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setErr(''); setF({ tanggal: today(), kode_rekening: '', nilai: 0, metode: 'tunai', no_bukti: '', penyetor: '', uraian: '' }); api.get('/api/master/rekening', { jenis: 'pendapatan' }).then((r) => setRek(r.rows)).catch(() => {}); } }, [open]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const nama = rek.find((r) => r.kode === f.kode_rekening)?.nama;
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post('/api/penerimaan', { ...f, skpd_id: skpdId, uraian: f.uraian || [nama, f.penyetor].filter(Boolean).join(' - ') }); onSaved(r.entry); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Catat penerimaan" subtitle="Tanda Bukti Penerimaan (TBP) dari wajib retribusi/penyetor. Wajib disetor ke kas daerah paling lambat 1 hari kerja."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={submit}>Simpan penerimaan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="Rekening pendapatan"><Combo value={f.kode_rekening} onChange={set('kode_rekening')} placeholder="Pilih rekening 4.x" options={rek.map((r) => ({ value: r.kode, label: r.nama, hint: r.kode }))} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tanggal"><Input type="date" value={f.tanggal || ''} onChange={set('tanggal')} /></Field>
          <Field label="No. TBP"><Input value={f.no_bukti || ''} onChange={set('no_bukti')} placeholder="TBP-0001/2026" /></Field>
          <Field label="Diterima"><Select value={f.metode} onChange={set('metode')} options={[{ value: 'tunai', label: 'Tunai' }, { value: 'bank', label: 'Transfer ke rekening' }]} /></Field>
        </div>
        <Field label="Penyetor / wajib retribusi"><Input value={f.penyetor || ''} onChange={set('penyetor')} placeholder="mis. CV Mitra Usaha Bersama" /></Field>
        <Field label="Uraian" hint="Kosongkan untuk otomatis: nama rekening - penyetor"><Textarea value={f.uraian || ''} onChange={set('uraian')} /></Field>
        <Field label="Nilai" hint={f.nilai ? terbilang(f.nilai) : undefined}><MoneyInput value={f.nilai} onChange={set('nilai')} /></Field>
      </div>
    </Modal>
  );
}

function FormSts({ open, onClose, items, onSaved }) {
  const { skpdId } = useApp();
  const [f, setF] = useState({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setErr(''); setF({ tanggal: today(), bank: 'Bank Daerah (RKUD)', no_bukti_bank: '' }); } }, [open]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const total = items.reduce((s, b) => s + Number(b.penerimaan), 0);
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post('/api/sts', { ...f, skpd_id: skpdId, entry_ids: items.map((b) => b.id) }); onSaved(r.sts); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Buat Surat Tanda Setoran" subtitle={`${items.length} penerimaan · ${rp(total)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} icon={Send} onClick={submit}>Terbitkan STS & bukukan setoran</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tanggal setor"><Input type="date" value={f.tanggal || ''} onChange={set('tanggal')} /></Field>
          <Field label="No. bukti / referensi bank"><Input value={f.no_bukti_bank || ''} onChange={set('no_bukti_bank')} placeholder="Opsional" /></Field>
        </div>
        <Field label="Disetor ke"><Input value={f.bank || ''} onChange={set('bank')} /></Field>
        <div className="rounded-xl bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-500">Terbilang</p><p className="italic text-slate-700">{terbilang(total)}</p></div>
        <p className="text-[11px] text-slate-500">Penyetoran dibukukan otomatis sebagai pengeluaran di BKU penerimaan, dipisah per kas (tunai/bank).</p>
      </div>
    </Modal>
  );
}

function FormTarget({ r, onClose, onSaved }) {
  const { skpdId, tahun } = useApp();
  const [v, setV] = useState(0); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (r) { setV(r.target); setErr(''); } }, [r]);
  if (!r) return null;
  const submit = async () => {
    setBusy(true);
    try { await api.put('/api/penerimaan/target', { skpd_id: skpdId, tahun, kode_rekening: r.kode_rekening, target: v }); onSaved(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Target pendapatan" subtitle={`${r.nama} · TA ${tahun}`} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={submit}>Simpan</Button></>}>
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="Target setahun"><MoneyInput value={v} onChange={setV} /></Field>
    </Modal>
  );
}
