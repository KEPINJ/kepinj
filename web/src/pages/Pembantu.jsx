import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Network, Plus, Send, Undo2, ArrowRightLeft, CheckCircle2, XCircle, Clock, FileText, Wallet, Receipt, Building2, ChevronRight, Printer } from 'lucide-react';
import { terbilang } from '@shared/terbilang.js';
import { JENIS_BELANJA, potonganBelanja } from '@shared/tax.js';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Combo, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, SkeletonRows, Stat, Tabs, Textarea, cx, useLoad, useToast } from '../components/ui.jsx';
import { JENIS_PAJAK, compact, money, rp, tgl, today } from '../lib/format.js';

const STATUS = { diajukan: ['amber', 'Menunggu pengesahan', Clock], disahkan: ['green', 'Disahkan', CheckCircle2], ditolak: ['red', 'Ditolak', XCircle] };
const JENIS = { PELIMPAHAN: ['blue', 'Pelimpahan UP'], BELANJA: ['slate', 'Belanja'], PAJAK_PUNGUT: ['violet', 'Pungutan pajak'], SERAH_PAJAK: ['violet', 'Serah pajak ke induk'], PENGEMBALIAN: ['amber', 'Pengembalian sisa'] };

export default function Pembantu() {
  const { skpdId, tahun, can, user } = useApp();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const pembantu = user.role === 'bendahara_pembantu';
  const [tab, setTab] = useState(sp.get('tab') || 'unit');
  const [unitId, setUnitId] = useState(null);
  const [form, setForm] = useState(null);
  const [proses, setProses] = useState(null);
  const induk = can('admin', 'bendahara');
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/pembantu', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  const { data: det, reload: reloadDet } = useLoad(() => unitId && api.get(`/api/pembantu/unit/${unitId}`, { tahun }), [unitId, tahun]);
  const muat = () => { reload(); if (unitId) reloadDet(); };
  useLive((e) => (e.type === 'pembantu.updated' || e.type.startsWith('bku')) && muat(), 700);
  useEffect(() => { if (sp.toString()) setSp({}, { replace: true }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (data && !unitId && (pembantu || data.units.length === 1) && data.units[0]) setUnitId(data.units[0].id); }, [data, unitId, pembantu]);

  const rg = data?.ringkasan;
  const unit = data?.units.find((u) => u.id === unitId);
  const tulisUnit = unit && (can('admin') || (pembantu && user.unit_id === unit.id));
  const selesai = (msg) => { toast(msg); muat(); };

  return (
    <div className="space-y-5">
      <PageHeader icon={Network} title="Bendahara Pembantu" subtitle="Pelimpahan UP ke unit kerja, BKU bendahara pengeluaran pembantu, dan pengesahan SPJ pembantu"
        actions={induk && <Button variant="secondary" icon={Plus} onClick={() => setForm({ jenis: 'unit' })}>Tambah unit kerja</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Dilimpahkan ke unit" value={rg ? compact(rg.dilimpahkan) : '…'} sub={rg && `${rg.unit} unit kerja aktif`} icon={ArrowRightLeft} tone="brand" />
        <Stat label="Belanja oleh pembantu" value={rg ? compact(rg.belanja) : '…'} sub={rg && `${rp(rg.belum_spj)} belum di-SPJ-kan`} icon={Receipt} tone="violet" />
        <Stat label="Kas di bendahara pembantu" value={rg ? compact(rg.saldo) : '…'} sub={rg && `termasuk pajak ditahan ${rp(rg.pajak_ditahan)}`} icon={Wallet} tone="green" />
        <Stat label="SPJ menunggu pengesahan" value={rg?.spj_diajukan ?? '…'} sub="Disahkan oleh bendahara pengeluaran" icon={Clock} tone={rg?.spj_diajukan ? 'amber' : 'green'} />
      </div>

      <Card bodyClass="" title={tab === 'unit' ? 'Unit kerja' : 'SPJ bendahara pembantu'}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'unit', label: 'Unit kerja', count: data?.units.length }, { value: 'spj', label: 'SPJ pembantu', count: rg?.spj_diajukan || undefined }]} />}>
        {loading && !data ? <SkeletonRows rows={4} /> : tab === 'unit' ? (
          !data?.units.length ? <Empty icon={Building2} title="Belum ada unit kerja" text={pembantu ? 'Akun Anda belum ditautkan ke unit kerja. Hubungi admin.' : 'Tambahkan UPT atau bidang yang dikelola bendahara pengeluaran pembantu.'} /> : (
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {data.units.map((u) => (
                <div key={u.id} className={cx('rounded-2xl border p-4 transition', u.id === unitId ? 'border-brand-400 bg-brand-50/40 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-brand-300', !u.aktif && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-mono text-[11px] text-slate-500">{u.kode}</p><p className="font-semibold text-slate-800">{u.nama}</p>
                      <p className="text-xs text-slate-500">{u.bendahara_nama || 'Bendahara belum ditetapkan'}{u.pengguna ? '' : ' · belum ada akun'}</p></div>
                    {u.spj_diajukan > 0 && <Badge color="amber"><Clock className="h-3 w-3" />SPJ</Badge>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Saldo kas</p><p className="num text-sm font-semibold text-slate-900">{rp(u.saldo)}</p></div>
                    <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Belum SPJ</p><p className={cx('num text-sm font-semibold', u.belum_spj ? 'text-amber-700' : 'text-slate-900')}>{rp(u.belum_spj)}</p></div>
                    <div className="px-2"><p className="text-slate-500">Dilimpahkan</p><p className="num font-medium">{compact(u.dilimpahkan)}</p></div>
                    <div className="px-2"><p className="text-slate-500">Belanja</p><p className="num font-medium">{compact(u.belanja)}</p></div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant={u.id === unitId ? 'primary' : 'secondary'} icon={ChevronRight} onClick={() => setUnitId(u.id)}>BKU pembantu</Button>
                    {induk && u.aktif && <Button size="sm" variant="secondary" icon={ArrowRightLeft} onClick={() => setForm({ jenis: 'limpah', unit: u })}>Limpahkan UP</Button>}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          !data?.spj.length ? <Empty icon={FileText} title="Belum ada SPJ pembantu" /> : (
            <div className="divide-y divide-slate-100">
              {data.spj.map((s) => {
                const [c, l, I] = STATUS[s.status];
                return (
                  <div key={s.id} className={cx('flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center', s.status === 'diajukan' && 'bg-amber-50/40')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-xs text-slate-600">{s.nomor}</span><Badge color={c}><I className="h-3 w-3" />{l}</Badge></div>
                      <p className="mt-1 text-sm font-medium text-slate-800">{s.unit_nama}</p>
                      <p className="text-[11px] text-slate-500">Diajukan {tgl(s.tanggal)} oleh {s.diajukan_nama} · {s.jumlah || 0} bukti belanja s.d. {tgl(s.sampai)}{s.diproses_nama && ` · diproses ${s.diproses_nama}`}</p>
                      {s.catatan && <p className={cx('mt-0.5 text-xs', s.status === 'ditolak' ? 'text-rose-700' : 'text-slate-600')}>Catatan: {s.catatan}</p>}
                    </div>
                    <div className="text-right"><p className="num text-sm font-semibold text-slate-900">{rp(s.total_belanja)}</p><p className="num text-[11px] text-slate-500">pajak {rp(s.total_pajak)}</p></div>
                    <div className="flex gap-2">
                      <Link to={`/cetak/spj-pembantu/${s.id}`} target="_blank"><Button size="sm" variant="ghost" icon={Printer}>Cetak</Button></Link>
                      {induk && s.status === 'diajukan' && <>
                        <Button size="sm" variant="success" icon={CheckCircle2} onClick={() => setProses({ s, aksi: 'sahkan' })}>Sahkan</Button>
                        <Button size="sm" variant="secondary" icon={XCircle} onClick={() => setProses({ s, aksi: 'tolak' })}>Tolak</Button>
                      </>}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </Card>

      {unit && (
        <Card bodyClass="" title={`BKU Pembantu · ${unit.nama}`} subtitle={`${unit.kode} · bendahara ${unit.bendahara_nama || '-'} · saldo ${rp(unit.saldo)}`}
          actions={tulisUnit && unit.aktif && <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={Plus} onClick={() => setForm({ jenis: 'belanja', unit })}>Catat belanja</Button>
            <Button size="sm" variant="secondary" icon={Send} disabled={!unit.belum_spj} onClick={() => setForm({ jenis: 'spj', unit })}>Ajukan SPJ</Button>
            <Button size="sm" variant="secondary" icon={Undo2} disabled={unit.saldo <= 0} onClick={() => setForm({ jenis: 'kembali', unit })}>Kembalikan sisa UP</Button>
          </div>}>
          {!det ? <SkeletonRows rows={5} /> : !det.rows.length ? <Empty icon={Wallet} title="Belum ada transaksi" text="Transaksi dimulai dari pelimpahan UP oleh bendahara pengeluaran." /> : (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[920px]">
                <thead className="sticky top-0 z-10"><tr><th className="th w-12">No</th><th className="th">Tanggal</th><th className="th">Jenis</th><th className="th">Uraian</th><th className="th text-right">Penerimaan</th><th className="th text-right">Pengeluaran</th><th className="th text-right">Saldo</th><th className="th">SPJ</th></tr></thead>
                <tbody>
                  {det.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-brand-50/40">
                      <td className="td num text-xs text-slate-500">{r.no_urut}</td>
                      <td className="td whitespace-nowrap text-xs">{tgl(r.tanggal)}</td>
                      <td className="td"><Badge color={JENIS[r.jenis][0]}>{JENIS[r.jenis][1]}</Badge></td>
                      <td className="td"><p className="line-clamp-2 text-sm text-slate-800">{r.uraian}</p><p className="text-[11px] text-slate-500">{[r.no_bukti, r.kode_rekening, r.rekanan_nama].filter((x) => x && x !== '-').join(' · ')}</p></td>
                      <td className="td num whitespace-nowrap text-right">{Number(r.penerimaan) ? money(r.penerimaan) : ''}</td>
                      <td className="td num whitespace-nowrap text-right">{Number(r.pengeluaran) ? money(r.pengeluaran) : ''}</td>
                      <td className="td num whitespace-nowrap text-right font-medium">{money(r.saldo)}</td>
                      <td className="td">{r.jenis === 'BELANJA' && (r.spj_nomor ? <Badge color={STATUS[r.spj_status][0]}>{r.spj_status === 'disahkan' ? 'Disahkan' : 'Diajukan'}</Badge> : <Badge color="amber">Belum SPJ</Badge>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <FormUnit open={form?.jenis === 'unit'} onClose={() => setForm(null)} onSaved={(u) => selesai(`Unit kerja ${u.nama} ditambahkan`)} />
      <FormLimpah f={form?.jenis === 'limpah' ? form : null} onClose={() => setForm(null)} onSaved={(n, u) => { selesai(`UP ${rp(n)} dilimpahkan ke ${u.nama} dan tercatat di BKU induk`); setUnitId(u.id); }} />
      <FormBelanja f={form?.jenis === 'belanja' ? form : null} onClose={() => setForm(null)} onSaved={(e) => selesai(`Belanja ${rp(e.pengeluaran)} dicatat di BKU pembantu`)} />
      <FormSpj f={form?.jenis === 'spj' ? form : null} onClose={() => setForm(null)} onSaved={(s) => { selesai(`${s.nomor} diajukan ke bendahara pengeluaran`); setTab('spj'); }} />
      <FormKembali f={form?.jenis === 'kembali' ? form : null} onClose={() => setForm(null)} onSaved={(n) => selesai(`Sisa UP ${rp(n)} dikembalikan ke bendahara pengeluaran`)} />
      <FormProses p={proses} onClose={() => setProses(null)} onSaved={(s) => selesai(s.status === 'disahkan' ? `${s.nomor} disahkan: belanja dan pajaknya dibukukan di BKU induk` : `${s.nomor} ditolak dan dikembalikan ke unit`)} />
    </div>
  );
}

function useForm(open, init) {
  const [f, setF] = useState({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setErr(''); setF(init()); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return { f, setF, set, err, busy, run };
}

function FormUnit({ open, onClose, onSaved }) {
  const { skpdId } = useApp();
  const { f, set, err, busy, run } = useForm(open, () => ({ kode: '', nama: '', bendahara_nama: '', bendahara_nip: '' }));
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Tambah unit kerja" footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={() => run(async () => { const r = await api.post('/api/pembantu/unit', { ...f, skpd_id: skpdId }); onSaved(r.unit); onClose(); })}>Simpan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid grid-cols-3 gap-3"><Field label="Kode"><Input value={f.kode || ''} onChange={set('kode')} placeholder="UPT-01" /></Field><Field className="col-span-2" label="Nama unit"><Input value={f.nama || ''} onChange={set('nama')} /></Field></div>
        <Field label="Nama bendahara pembantu"><Input value={f.bendahara_nama || ''} onChange={set('bendahara_nama')} /></Field>
        <Field label="NIP"><Input value={f.bendahara_nip || ''} onChange={set('bendahara_nip')} /></Field>
        <p className="text-[11px] text-slate-500">Setelah unit dibuat, admin menautkan akun berperan Bendahara Pembantu ke unit ini di menu Pengguna.</p>
      </div>
    </Modal>
  );
}

function FormLimpah({ f: ctx, onClose, onSaved }) {
  const { f, set, err, busy, run } = useForm(!!ctx, () => ({ tanggal: today(), nilai: 0, metode: 'bank', no_bukti: '' }));
  if (!ctx) return null;
  return (
    <Modal open onClose={onClose} title={`Limpahkan UP ke ${ctx.unit.nama}`} subtitle="Dicatat sebagai pengeluaran pelimpahan di BKU induk dan penerimaan di BKU pembantu"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} icon={ArrowRightLeft} onClick={() => run(async () => { await api.post(`/api/pembantu/unit/${ctx.unit.id}/limpah`, f); onSaved(f.nilai, ctx.unit); onClose(); })}>Limpahkan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tanggal"><Input type="date" value={f.tanggal || ''} onChange={set('tanggal')} /></Field>
          <Field label="No. bukti" hint="Kosongkan untuk otomatis"><Input value={f.no_bukti || ''} onChange={set('no_bukti')} /></Field>
          <Field label="Melalui"><Select value={f.metode} onChange={set('metode')} options={[{ value: 'bank', label: 'Transfer bank' }, { value: 'tunai', label: 'Tunai' }]} /></Field>
        </div>
        <Field label="Nilai pelimpahan" hint={f.nilai ? terbilang(f.nilai) : undefined}><MoneyInput value={f.nilai} onChange={set('nilai')} /></Field>
      </div>
    </Modal>
  );
}

function FormBelanja({ f: ctx, onClose, onSaved }) {
  const [ref, setRef] = useState({ rekening: [], rekanan: [] });
  const { f, set, err, busy, run } = useForm(!!ctx, () => ({ tanggal: today(), no_bukti: '', kode_rekening: '', rekanan_id: '', uraian: '', nilai: 0, metode: 'tunai', jenis: '' }));
  useEffect(() => { if (ctx) Promise.all([api.get('/api/master/rekening', { jenis: 'belanja' }), api.get('/api/master/rekanan')]).then(([a, b]) => setRef({ rekening: a.rows, rekanan: b.rows })).catch(() => {}); }, [ctx]);
  const pot = useMemo(() => (f.jenis && Number(f.nilai) > 0 ? potonganBelanja({ nilai: Number(f.nilai), termasukPPN: true, jenis: f.jenis }) : null), [f.jenis, f.nilai]);
  if (!ctx) return null;
  return (
    <Modal open onClose={onClose} size="lg" title="Catat belanja bendahara pembantu" subtitle={`${ctx.unit.nama} · saldo ${rp(ctx.unit.saldo)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={() => run(async () => { const r = await api.post(`/api/pembantu/unit/${ctx.unit.id}/belanja`, { ...f, rekanan_id: f.rekanan_id || null, pajak: pot?.potongan || [] }); onSaved(r.entry); onClose(); })}>Simpan belanja</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tanggal"><Input type="date" value={f.tanggal || ''} onChange={set('tanggal')} /></Field>
          <Field label="No. bukti"><Input value={f.no_bukti || ''} onChange={set('no_bukti')} /></Field>
          <Field label="Dibayar"><Select value={f.metode} onChange={set('metode')} options={[{ value: 'tunai', label: 'Tunai' }, { value: 'bank', label: 'Transfer bank' }]} /></Field>
        </div>
        <Field label="Kode rekening belanja"><Combo value={f.kode_rekening} onChange={set('kode_rekening')} placeholder="Pilih rekening" options={ref.rekening.map((r) => ({ value: r.kode, label: r.nama, hint: r.kode }))} /></Field>
        <Field label="Uraian"><Textarea value={f.uraian || ''} onChange={set('uraian')} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rekanan / penerima"><Combo value={f.rekanan_id} onChange={set('rekanan_id')} placeholder="Opsional" options={ref.rekanan.map((r) => ({ value: r.id, label: r.nama, hint: r.npwp }))} /></Field>
          <Field label="Nilai belanja (termasuk PPN)" hint={f.nilai ? terbilang(f.nilai) : undefined}><MoneyInput value={f.nilai} onChange={set('nilai')} /></Field>
        </div>
        <Field label="Potongan pajak"><Select value={f.jenis} onChange={set('jenis')} options={[{ value: '', label: 'Tanpa potongan pajak' }, ...Object.entries(JENIS_BELANJA).map(([value, j]) => ({ value, label: j.label }))]} /></Field>
        {pot && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            {pot.potongan.map((p) => <p key={p.jenis_pajak} className="flex justify-between"><span>{JENIS_PAJAK[p.jenis_pajak]} ({p.tarif}%)</span><span className="num">({money(p.nominal)})</span></p>)}
            {pot.catatan.map((c) => <p key={c} className="text-[11px] text-slate-500">{c}</p>)}
            <p className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Dibayarkan ke rekanan</span><span className="num">{rp(pot.netto)}</span></p>
            <p className="mt-1 text-[11px] text-slate-500">Pajak ditahan bendahara pembantu dan diserahkan ke bendahara pengeluaran saat SPJ disahkan.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function FormSpj({ f: ctx, onClose, onSaved }) {
  const { f, set, err, busy, run } = useForm(!!ctx, () => ({ tanggal: today(), sampai: today(), catatan: '' }));
  if (!ctx) return null;
  return (
    <Modal open onClose={onClose} size="sm" title="Ajukan SPJ pembantu" subtitle={`Belanja yang belum di-SPJ-kan: ${rp(ctx.unit.belum_spj)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} icon={Send} onClick={() => run(async () => { const r = await api.post(`/api/pembantu/unit/${ctx.unit.id}/spj`, f); onSaved(r.spj); onClose(); })}>Ajukan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid grid-cols-2 gap-3"><Field label="Tanggal SPJ"><Input type="date" value={f.tanggal} onChange={set('tanggal')} /></Field><Field label="Belanja s.d."><Input type="date" value={f.sampai} onChange={set('sampai')} /></Field></div>
        <Field label="Catatan"><Textarea value={f.catatan} onChange={set('catatan')} placeholder="Opsional" /></Field>
      </div>
    </Modal>
  );
}

function FormKembali({ f: ctx, onClose, onSaved }) {
  const { f, set, err, busy, run } = useForm(!!ctx, () => ({ tanggal: today(), nilai: Math.max(0, ctx?.unit.saldo || 0) }));
  if (!ctx) return null;
  return (
    <Modal open onClose={onClose} size="sm" title="Kembalikan sisa UP" subtitle="Dicatat di BKU pembantu dan diterima kembali di BKU induk"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} icon={Undo2} onClick={() => run(async () => { await api.post(`/api/pembantu/unit/${ctx.unit.id}/kembali`, f); onSaved(f.nilai); onClose(); })}>Kembalikan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        {ctx.unit.pajak_ditahan > 0 && <Alert tone="warn">Saldo memuat pajak ditahan {rp(ctx.unit.pajak_ditahan)} yang akan diserahkan saat SPJ disahkan.</Alert>}
        <Field label="Tanggal"><Input type="date" value={f.tanggal} onChange={set('tanggal')} /></Field>
        <Field label="Nilai"><MoneyInput value={f.nilai} onChange={set('nilai')} /></Field>
      </div>
    </Modal>
  );
}

function FormProses({ p, onClose, onSaved }) {
  const { f, set, err, busy, run } = useForm(!!p, () => ({ tanggal: today(), catatan: '' }));
  if (!p) return null;
  const sahkan = p.aksi === 'sahkan';
  return (
    <Modal open onClose={onClose} size="sm" title={`${sahkan ? 'Sahkan' : 'Tolak'} ${p.s.nomor}`} subtitle={`${p.s.unit_nama} · ${rp(p.s.total_belanja)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant={sahkan ? 'success' : 'danger'} loading={busy} onClick={() => run(async () => { const r = await api.post(`/api/pembantu/spj/${p.s.id}/${p.aksi}`, f); onSaved(r.spj); onClose(); })}>{sahkan ? 'Sahkan & bukukan' : 'Tolak SPJ'}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        {sahkan ? (<>
          <Field label="Tanggal pengesahan"><Input type="date" value={f.tanggal} onChange={set('tanggal')} /></Field>
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <p>Saat disahkan, di BKU induk:</p>
            <ul className="mt-1 list-disc pl-4"><li>setiap belanja dibukukan beserta pungutan pajaknya (masuk register pajak),</li><li>pelimpahan UP {rp(p.s.total_belanja)} dipertanggungjawabkan,</li><li>pajak {rp(p.s.total_pajak)} diserahkan dari bendahara pembantu.</li></ul>
          </div>
        </>) : <Field label="Alasan penolakan"><Textarea value={f.catatan} onChange={set('catatan')} placeholder="mis. Nota belum ditandatangani penerima" /></Field>}
      </div>
    </Modal>
  );
}
