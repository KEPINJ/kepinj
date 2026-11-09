import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookCheck, Play, Plus, Download, Undo2, Scale, BookOpen, ListTree, AlertTriangle, CheckCircle2, Trash2, FileText, Info } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Combo, Empty, Field, Input, Modal, MoneyInput, PageHeader, Pagination, SearchInput, Select, SkeletonRows, Stat, Tabs, Textarea, cx, useLoad, useToast } from '../components/ui.jsx';
import { money, rp, tgl, today } from '../lib/format.js';

const JENIS_JURNAL = { otomatis: ['blue', 'Otomatis'], umum: ['violet', 'Umum'], penyesuaian: ['amber', 'Penyesuaian'], balik: ['red', 'Balik'], koreksi: ['red', 'Koreksi'] };
const PERLAKUAN = { beban: 'Beban (LO)', aset: 'Aset tetap', persediaan: 'Persediaan', telaah: 'Telaah manual' };

function TabelRinci({ rinci }) {
  return (
    <table className="w-full text-xs">
      <thead><tr><th className="th w-14">Basis</th><th className="th">Akun</th><th className="th text-right">Debit</th><th className="th text-right">Kredit</th></tr></thead>
      <tbody>{(rinci || []).map((b, i) => (
        <tr key={i}><td className="td"><Badge color={b.basis === 'LO' ? 'blue' : 'green'}>{b.basis}</Badge></td>
          <td className={cx('td', Number(b.kredit) > 0 && 'pl-8')}><span className="font-mono text-[11px] text-slate-500">{b.akun_kode}</span> {b.akun_nama}</td>
          <td className="td num text-right">{Number(b.debit) ? money(b.debit) : ''}</td><td className="td num text-right">{Number(b.kredit) ? money(b.kredit) : ''}</td></tr>))}</tbody>
    </table>
  );
}

/** Akuntansi SKPD berbasis akrual (PP 71/2010, Permendagri 77/2020): jurnal otomatis untuk transaksi disetujui, jurnal umum, buku besar, neraca saldo. */
export default function Akuntansi() {
  const { skpdId, tahun, can } = useApp();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'ringkasan';
  const setTab = (t) => setSp({ tab: t }, { replace: true });
  const [manual, setManual] = useState(null);
  const akuntan = can('admin', 'verifikator');
  const ring = useLoad(() => skpdId && api.get('/api/akuntansi/ringkasan', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  const r = ring.data;

  return (
    <div className="space-y-4">
      <PageHeader icon={BookCheck} title="Akuntansi & Jurnal" subtitle={`Basis akrual (LO) dan anggaran (LRA) sesuai PP 71/2010 · TA ${tahun}`}
        actions={akuntan && <Button icon={Plus} onClick={() => setManual({})}>Jurnal umum</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'ringkasan', label: 'Ringkasan & posting' }, { value: 'jurnal', label: 'Laporan jurnal' }, { value: 'telaah', label: 'Perlu telaah', count: r?.telaah || undefined },
        { value: 'buku-besar', label: 'Buku besar' }, { value: 'neraca', label: 'Neraca saldo' }, { value: 'akun', label: 'Bagan akun & pemetaan' }]} />
      {tab === 'ringkasan' && <Ringkasan r={r} reload={ring.reload} akuntan={akuntan} />}
      {tab === 'jurnal' && <LaporanJurnal akuntan={akuntan} />}
      {tab === 'telaah' && <Telaah akuntan={akuntan} onJurnal={(e) => setManual({ sumber: e })} />}
      {tab === 'buku-besar' && <BukuBesar />}
      {tab === 'neraca' && <NeracaSaldo />}
      {tab === 'akun' && <AkunPemetaan akuntan={akuntan} />}
      <JurnalManual data={manual} onClose={() => setManual(null)} onDone={(j) => { toast(`Jurnal ${j.nomor} tersimpan (debit = kredit)`); ring.reload(); }} />
    </div>
  );
}

function Ringkasan({ r, reload, akuntan }) {
  const { skpdId, tahun } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const aturan = useLoad(() => api.get('/api/akuntansi/aturan'), []);
  const posting = async () => {
    setBusy(true);
    try { const h = await api.post('/api/akuntansi/posting', { skpd_id: skpdId, tahun }); toast(`${h.dibuat} jurnal dibuat${h.dibalik ? `, ${h.dibalik} jurnal balik` : ""}, ${h.telaah} transaksi perlu telaah`); reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const seimbang = (n) => n && <Badge color={n.seimbang ? 'green' : 'red'}>{n.seimbang ? 'Seimbang' : 'Tidak seimbang'}</Badge>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Jurnal tercatat" value={r ? r.jurnal.jurnal.toLocaleString('id-ID') : '…'} sub={r && `${r.jurnal.otomatis} otomatis · ${r.jurnal.manual} manual · ${r.jurnal.balik} balik`} icon={BookOpen} />
        <Stat label="Siap diposting" value={r ? r.siap_posting.toLocaleString('id-ID') : '…'} sub="Transaksi disetujui yang belum dijurnal" icon={Play} tone={r?.siap_posting ? 'amber' : 'green'} />
        <Stat label="Perlu telaah" value={r ? r.telaah : '…'} sub="Perlakuan akuntansi tidak dapat ditentukan otomatis" icon={AlertTriangle} tone={r?.telaah ? 'red' : 'green'} />
        <Stat label="Kas menurut jurnal" value={r ? rp(r.kas.kas_jurnal) : '…'} sub={r && `Saldo BKU ${rp(r.kas.kas_bku)} (termasuk transaksi belum disetujui)`} icon={Scale} tone="violet" />
      </div>
      <Alert tone="info" title="Tidak semua transaksi BKU dijurnal otomatis">
        Jurnal hanya dibuat untuk transaksi yang <b>sudah disetujui</b>. Setiap jenis transaksi dipetakan ke aturan yang mengacu pada PP 71/2010 dan Permendagri 77/2020 (basis akrual untuk LO/Neraca, basis kas untuk LRA).
        Transaksi yang perlakuannya bergantung pada pertimbangan (mis. belanja modal di bawah nilai kapitalisasi, koreksi, transaksi tanpa kode rekening) <b>tidak dijurnal otomatis</b> dan masuk daftar telaah untuk dijurnal manual oleh PPK-SKPD.
      </Alert>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Neraca saldo finansial (LO / akrual)" actions={seimbang(r?.neraca_lo)}>
          {r && <div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">Total debit</p><p className="num font-semibold">{rp(r.neraca_lo.total.debit)}</p></div><div><p className="text-xs text-slate-500">Total kredit</p><p className="num font-semibold">{rp(r.neraca_lo.total.kredit)}</p></div></div>}
        </Card>
        <Card title="Neraca saldo anggaran (LRA)" actions={seimbang(r?.neraca_lra)}>
          {r && <div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">Total debit</p><p className="num font-semibold">{rp(r.neraca_lra.total.debit)}</p></div><div><p className="text-xs text-slate-500">Total kredit</p><p className="num font-semibold">{rp(r.neraca_lra.total.kredit)}</p></div></div>}
        </Card>
      </div>
      {akuntan && (
        <Card title="Posting jurnal otomatis" subtitle="Menjurnal semua transaksi disetujui yang belum dijurnal; aman dijalankan berulang (tidak menggandakan)">
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={Play} loading={busy} disabled={!r?.siap_posting} onClick={posting}>Posting {r?.siap_posting || 0} transaksi</Button>
            {r && Object.entries(r.siap_per_aturan).map(([k, n]) => <Badge key={k} color="blue">{k}: {n}</Badge>)}
            {r && !r.siap_posting && <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" />Semua transaksi disetujui sudah dijurnal</span>}
          </div>
        </Card>
      )}
      <Card title="Aturan jurnal otomatis" subtitle="Dasar perlakuan setiap jenis transaksi BKU" bodyClass="overflow-x-auto">
        {!aturan.data ? <SkeletonRows rows={5} cols={4} /> : (
          <table className="w-full min-w-[900px] text-xs">
            <thead><tr><th className="th">Aturan</th><th className="th">Jenis BKU</th><th className="th">Jurnal LO (akrual)</th><th className="th">Jurnal LRA</th><th className="th">Dasar</th></tr></thead>
            <tbody>{aturan.data.aturan.map((a) => (
              <tr key={a.kode} className="align-top"><td className="td"><b>{a.kode}</b><p className="text-slate-500">{a.nama}</p></td><td className="td">{(a.jenis || []).map((j) => aturan.data.jenis[j] || j).join(', ')}</td>
                <td className="td font-mono text-[11px]">{a.lo}</td><td className="td font-mono text-[11px]">{a.lra}</td><td className="td text-slate-600">{a.dasar}</td></tr>))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function LaporanJurnal({ akuntan }) {
  const { skpdId, tahun } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ dari: `${tahun}-01-01`, sampai: `${tahun}-12-31`, jenis: '', q: '' });
  const [page, setPage] = useState(1);
  const [buka, setBuka] = useState(null);
  const [balik, setBalik] = useState(null);
  const p = { skpd_id: skpdId, tahun, ...f };
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/akuntansi/jurnal', { ...p, page, pageSize: 25 }), [skpdId, tahun, f.dari, f.sampai, f.jenis, f.q, page]);
  const t = data?.total_nilai;
  return (
    <Card bodyClass="p-0" title="Laporan jurnal" actions={<Button size="sm" variant="secondary" icon={Download} onClick={() => download('/api/akuntansi/jurnal', { params: { ...p, format: 'xlsx' } }).catch((e) => toast(e.message, 'error'))}>Excel</Button>}>
      <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-4">
        <Input type="date" value={f.dari} onChange={(e) => { setF({ ...f, dari: e.target.value }); setPage(1); }} />
        <Input type="date" value={f.sampai} onChange={(e) => { setF({ ...f, sampai: e.target.value }); setPage(1); }} />
        <Select value={f.jenis} onChange={(e) => { setF({ ...f, jenis: e.target.value }); setPage(1); }} options={[{ value: '', label: 'Semua jenis' }, ...Object.entries(JENIS_JURNAL).map(([value, [, label]]) => ({ value, label }))]} />
        <SearchInput value={f.q} onChange={(q) => { setF({ ...f, q }); setPage(1); }} placeholder="Cari nomor / uraian" />
      </div>
      {t && <div className="flex flex-wrap gap-4 border-b border-slate-100 px-4 py-2 text-xs">
        <span>LO: debit <b className="num">{money(t.debit_lo)}</b> · kredit <b className="num">{money(t.kredit_lo)}</b> {Math.abs(t.debit_lo - t.kredit_lo) < 0.01 ? <Badge color="green">D = K</Badge> : <Badge color="red">D ≠ K</Badge>}</span>
        <span>LRA: debit <b className="num">{money(t.debit_lra)}</b> · kredit <b className="num">{money(t.kredit_lra)}</b> {Math.abs(t.debit_lra - t.kredit_lra) < 0.01 ? <Badge color="green">D = K</Badge> : <Badge color="red">D ≠ K</Badge>}</span>
      </div>}
      {loading && !data ? <SkeletonRows rows={8} cols={5} /> : !data?.rows.length ? <Empty title="Belum ada jurnal" text="Jalankan posting jurnal otomatis atau buat jurnal umum." /> : <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr><th className="th">No. jurnal</th><th className="th">Tanggal</th><th className="th">Jenis</th><th className="th">Uraian</th><th className="th text-right">Nilai</th><th className="th" /></tr></thead>
            <tbody>{data.rows.map((j) => {
              const nilai = (j.rinci || []).filter((x) => x.basis === 'LO').reduce((s, x) => s + Number(x.debit), 0);
              return [
                <tr key={j.id} className={cx('cursor-pointer hover:bg-slate-50', j.dibalik && 'opacity-60')} onClick={() => setBuka(buka === j.id ? null : j.id)}>
                  <td className="td whitespace-nowrap font-mono text-xs">{j.nomor}</td><td className="td whitespace-nowrap text-xs">{tgl(j.tanggal)}</td>
                  <td className="td"><Badge color={JENIS_JURNAL[j.jenis]?.[0]}>{JENIS_JURNAL[j.jenis]?.[1]}</Badge>{j.dibalik && <Badge color="slate" className="ml-1">Dibalik</Badge>}</td>
                  <td className="td text-xs">{j.uraian}<p className="text-[10px] text-slate-400">{j.aturan} · {j.dibuat_oleh_nama}</p></td>
                  <td className="td num text-right text-xs">{money(nilai)}</td>
                  <td className="td">{akuntan && !j.dibalik && j.jenis !== 'balik' && <button type="button" onClick={(e) => { e.stopPropagation(); setBalik(j); }} className="p-1 text-slate-400 hover:text-rose-600" title="Jurnal balik" aria-label="Jurnal balik"><Undo2 className="h-4 w-4" /></button>}</td>
                </tr>,
                buka === j.id && <tr key={`${j.id}-r`}><td colSpan={6} className="bg-slate-50/70 px-4 py-2"><TabelRinci rinci={j.rinci} />{j.dasar && <p className="mt-1 text-[11px] text-slate-500">Dasar: {j.dasar}</p>}</td></tr>,
              ];
            })}</tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} />
      </>}
      <BalikModal j={balik} onClose={() => setBalik(null)} onDone={(b) => { toast(`Jurnal balik ${b.nomor} dibuat`); reload(); }} />
    </Card>
  );
}

function BalikModal({ j, onClose, onDone }) {
  const [alasan, setAlasan] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!j) return null;
  const kirim = async () => {
    setBusy(true);
    try { const { row } = await api.post(`/api/akuntansi/jurnal/${j.id}/balik`, { alasan }); onDone(row); onClose(); setAlasan(''); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open size="sm" onClose={onClose} title={`Jurnal balik ${j.nomor}`} subtitle="Jurnal tidak dihapus; dibuat jurnal pembalik dengan debit/kredit ditukar"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant="danger" loading={busy} disabled={alasan.trim().length < 5} onClick={kirim}>Buat jurnal balik</Button></>}>
      <TabelRinci rinci={j.rinci} />
      <Field label="Alasan" className="mt-3"><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah akun, diganti jurnal umum" /></Field>
    </Modal>
  );
}

function Telaah({ akuntan, onJurnal }) {
  const { skpdId, tahun } = useApp();
  const { data, loading } = useLoad(() => skpdId && api.get('/api/akuntansi/telaah', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  return (
    <Card bodyClass="p-0" title="Transaksi disetujui yang perlu telaah akuntansi" subtitle="Tidak dijurnal otomatis karena perlakuannya memerlukan pertimbangan profesional">
      {loading && !data ? <SkeletonRows rows={5} cols={4} /> : !data?.rows.length ? <Empty icon={CheckCircle2} title="Tidak ada transaksi yang perlu ditelaah" text="Semua transaksi disetujui dapat dijurnal dengan aturan yang ada." /> : (
        <table className="w-full text-sm">
          <thead><tr><th className="th">BKU</th><th className="th">Uraian</th><th className="th text-right">Nilai</th><th className="th">Alasan telaah</th><th className="th" /></tr></thead>
          <tbody>{data.rows.map((e) => (
            <tr key={e.id} className="align-top hover:bg-slate-50">
              <td className="td whitespace-nowrap text-xs">No. {e.no_urut}<p className="text-slate-500">{tgl(e.tanggal)}</p></td>
              <td className="td text-xs">{e.uraian}<p className="font-mono text-[10px] text-slate-400">{e.jenis} · {e.kode_rekening || 'tanpa rekening'}</p></td>
              <td className="td num text-right text-xs">{money(Number(e.penerimaan) || Number(e.pengeluaran))}</td>
              <td className="td text-xs text-amber-800">{e.alasan}</td>
              <td className="td">{akuntan && <Button size="sm" variant="secondary" icon={FileText} onClick={() => onJurnal(e)}>Jurnal</Button>}</td>
            </tr>))}</tbody>
        </table>
      )}
    </Card>
  );
}

function JurnalManual({ data, onClose, onDone }) {
  const { skpdId } = useApp();
  const toast = useToast();
  const akun = useLoad(() => data && api.get('/api/akuntansi/akun'), [Boolean(data)]);
  const kosong = (basis = 'LO') => ({ basis, akun_kode: '', debit: 0, kredit: 0 });
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  if (data && !f) {
    const e = data.sumber;
    const n = e ? Number(e.penerimaan) || Number(e.pengeluaran) : 0;
    setF({ tanggal: e?.tanggal || today(), jenis: 'umum', uraian: e ? `Jurnal atas BKU No. ${e.no_urut}: ${e.uraian}` : '', dasar: '', sumber_bku_id: e?.id || null, baris: [{ ...kosong(), debit: n }, { ...kosong(), kredit: n }] });
  }
  if (!data || !f) return null;
  const tutup = () => { setF(null); onClose(); };
  const ubah = (i, k, v) => setF({ ...f, baris: f.baris.map((b, j) => (j === i ? { ...b, [k]: v, ...(k === 'debit' && v ? { kredit: 0 } : {}), ...(k === 'kredit' && v ? { debit: 0 } : {}) } : b)) });
  const tot = (basis, k) => f.baris.filter((b) => b.basis === basis).reduce((s, b) => s + Number(b[k] || 0), 0);
  const imbang = ['LO', 'LRA'].every((b) => Math.abs(tot(b, 'debit') - tot(b, 'kredit')) < 0.005) && tot('LO', 'debit') + tot('LRA', 'debit') > 0;
  const opsi = (akun.data?.rows || []).filter((a) => a.aktif && a.level >= 4).map((a) => ({ value: a.kode, label: `${a.kode} · ${a.nama}`, basis: a.basis }));
  const simpan = async () => {
    setBusy(true);
    try { const { row } = await api.post('/api/akuntansi/jurnal', { ...f, skpd_id: skpdId }); onDone(row); tutup(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open size="lg" onClose={tutup} title={f.sumber_bku_id ? 'Jurnal atas transaksi telaah' : 'Jurnal umum / penyesuaian'} subtitle="Total debit harus sama dengan total kredit untuk setiap basis (LO dan LRA)"
      footer={<><span className="mr-auto text-xs">{imbang ? <span className="text-emerald-700">Seimbang: debit = kredit</span> : <span className="text-rose-700">Belum seimbang</span>}</span><Button variant="secondary" onClick={tutup}>Batal</Button><Button loading={busy} disabled={!imbang} onClick={simpan}>Simpan jurnal</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tanggal"><Input type="date" value={f.tanggal} onChange={(e) => setF({ ...f, tanggal: e.target.value })} /></Field>
        <Field label="Jenis"><Select value={f.jenis} onChange={(e) => setF({ ...f, jenis: e.target.value })} options={[{ value: 'umum', label: 'Jurnal umum' }, { value: 'penyesuaian', label: 'Jurnal penyesuaian' }]} /></Field>
        <Field label="Dasar / referensi"><Input value={f.dasar} onChange={(e) => setF({ ...f, dasar: e.target.value })} placeholder="mis. BA stock opname, kebijakan akuntansi" /></Field>
      </div>
      <Field label="Uraian" className="mt-3"><Textarea value={f.uraian} onChange={(e) => setF({ ...f, uraian: e.target.value })} /></Field>
      <div className="mt-3 space-y-2">
        {f.baris.map((b, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[70px_1fr_130px_130px_32px]">
            <Select value={b.basis} onChange={(e) => ubah(i, 'basis', e.target.value)} options={[{ value: 'LO', label: 'LO' }, { value: 'LRA', label: 'LRA' }]} />
            <Combo value={b.akun_kode} onChange={(v) => ubah(i, 'akun_kode', v)} options={opsi.filter((o) => o.basis === b.basis)} placeholder="Pilih akun" />
            <MoneyInput value={b.debit} onChange={(v) => ubah(i, 'debit', v)} placeholder="Debit" />
            <MoneyInput value={b.kredit} onChange={(v) => ubah(i, 'kredit', v)} placeholder="Kredit" />
            <button type="button" onClick={() => setF({ ...f, baris: f.baris.filter((_, j) => j !== i) })} className="p-1 text-slate-400 hover:text-rose-600" aria-label="Hapus baris"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setF({ ...f, baris: [...f.baris, kosong('LO')] })}>Baris LO</Button>
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setF({ ...f, baris: [...f.baris, kosong('LRA')] })}>Baris LRA</Button>
        </div>
        <div className="grid gap-2 rounded-lg bg-slate-50 p-2 text-xs sm:grid-cols-2">
          {['LO', 'LRA'].map((bs) => <p key={bs}>{bs}: debit <b className="num">{money(tot(bs, 'debit'))}</b> · kredit <b className="num">{money(tot(bs, 'kredit'))}</b></p>)}
        </div>
      </div>
    </Modal>
  );
}

function BukuBesar() {
  const { skpdId, tahun } = useApp();
  const [akun, setAkun] = useState('');
  const [f, setF] = useState({ dari: `${tahun}-01-01`, sampai: `${tahun}-12-31` });
  const daftar = useLoad(() => skpdId && api.get('/api/akuntansi/buku-besar', { skpd_id: skpdId, tahun, sampai: f.sampai }), [skpdId, tahun, f.sampai]);
  const det = useLoad(() => akun && api.get('/api/akuntansi/buku-besar', { skpd_id: skpdId, tahun, akun, ...f }), [akun, skpdId, tahun, f.dari, f.sampai]);
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <Card title="Akun bermutasi" bodyClass="max-h-[70vh] overflow-y-auto p-0">
        {!daftar.data ? <SkeletonRows rows={8} cols={2} /> : daftar.data.akun.map((a) => (
          <button key={a.kode} type="button" onClick={() => setAkun(a.kode)} className={cx('flex w-full items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs hover:bg-slate-50', akun === a.kode && 'bg-brand-50')}>
            <span className="min-w-0"><span className="font-mono text-[10px] text-slate-500">{a.kode} · {a.basis}</span><span className="block truncate text-slate-800">{a.nama}</span></span>
            <span className="num shrink-0 text-right">{money(Math.abs(a.bersih))}<span className="block text-[10px] text-slate-400">{a.mutasi} mutasi</span></span>
          </button>))}
      </Card>
      <Card title={det.data?.akun ? `${det.data.akun.kode} · ${det.data.akun.nama}` : 'Buku besar'} subtitle={det.data?.akun && `Saldo normal ${det.data.akun.saldo_normal === 'D' ? 'debit' : 'kredit'} · basis ${det.data.akun.basis}`} bodyClass="p-0">
        <div className="flex gap-2 border-b border-slate-100 p-3"><Input type="date" value={f.dari} onChange={(e) => setF({ ...f, dari: e.target.value })} /><Input type="date" value={f.sampai} onChange={(e) => setF({ ...f, sampai: e.target.value })} /></div>
        {!akun ? <Empty icon={ListTree} title="Pilih akun" text="Pilih akun di sebelah kiri untuk melihat mutasi dan saldo berjalan." /> : !det.data ? <SkeletonRows rows={8} cols={5} /> : (
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="sticky top-0 bg-surface"><tr><th className="th">Tanggal</th><th className="th">No. jurnal</th><th className="th">Uraian</th><th className="th text-right">Debit</th><th className="th text-right">Kredit</th><th className="th text-right">Saldo</th></tr></thead>
              <tbody>
                <tr className="bg-slate-50"><td className="td" colSpan={5}>Saldo awal</td><td className="td num text-right">{money(det.data.saldo_awal)}</td></tr>
                {det.data.rows.map((x, i) => <tr key={i}><td className="td whitespace-nowrap">{tgl(x.tanggal)}</td><td className="td font-mono">{x.nomor}</td><td className="td">{x.uraian}</td><td className="td num text-right">{x.debit ? money(x.debit) : ''}</td><td className="td num text-right">{x.kredit ? money(x.kredit) : ''}</td><td className="td num text-right">{money(x.saldo)}</td></tr>)}
              </tbody>
              <tfoot><tr className="bg-slate-50 font-semibold"><td className="td" colSpan={3}>Jumlah / saldo akhir</td><td className="td num text-right">{money(det.data.total.debit)}</td><td className="td num text-right">{money(det.data.total.kredit)}</td><td className="td num text-right">{money(det.data.saldo_akhir)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function NeracaSaldo() {
  const { skpdId, tahun } = useApp();
  const toast = useToast();
  const [basis, setBasis] = useState('LO');
  const [sampai, setSampai] = useState(`${tahun}-12-31`);
  const p = { skpd_id: skpdId, tahun, basis, sampai };
  const { data } = useLoad(() => skpdId && api.get('/api/akuntansi/neraca-saldo', p), [skpdId, tahun, basis, sampai]);
  return (
    <Card bodyClass="p-0" title={`Neraca saldo ${basis === 'LO' ? 'finansial (akrual)' : 'anggaran (LRA)'}`} subtitle={`Per ${tgl(sampai)}`}
      actions={<div className="flex flex-wrap items-center gap-2">{data && <Badge color={data.seimbang ? 'green' : 'red'}>{data.seimbang ? 'Debit = kredit' : 'Tidak seimbang'}</Badge>}
        <Tabs value={basis} onChange={setBasis} tabs={[{ value: 'LO', label: 'LO / Neraca' }, { value: 'LRA', label: 'LRA' }]} />
        <Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} className="!w-40" />
        <Button size="sm" variant="secondary" icon={Download} onClick={() => download('/api/akuntansi/neraca-saldo', { params: { ...p, format: 'xlsx' } }).catch((e) => toast(e.message, 'error'))}>Excel</Button></div>}>
      {!data ? <SkeletonRows rows={10} cols={5} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-xs">
            <thead><tr><th className="th">Kode akun</th><th className="th">Nama akun</th><th className="th text-right">Mutasi debit</th><th className="th text-right">Mutasi kredit</th><th className="th text-right">Saldo debit</th><th className="th text-right">Saldo kredit</th></tr></thead>
            <tbody>{data.rows.map((x) => <tr key={x.kode} className="hover:bg-slate-50"><td className="td font-mono">{x.kode}</td><td className="td">{x.nama}</td><td className="td num text-right">{money(x.debit + x.debit_awal)}</td><td className="td num text-right">{money(x.kredit + x.kredit_awal)}</td><td className="td num text-right">{x.saldo_debit ? money(x.saldo_debit) : ''}</td><td className="td num text-right">{x.saldo_kredit ? money(x.saldo_kredit) : ''}</td></tr>)}</tbody>
            <tfoot><tr className="bg-slate-50 font-semibold"><td className="td" colSpan={2}>Jumlah</td><td className="td num text-right">{money(data.total.debit)}</td><td className="td num text-right">{money(data.total.kredit)}</td><td className="td num text-right">{money(data.total.saldo_debit)}</td><td className="td num text-right">{money(data.total.saldo_kredit)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function AkunPemetaan({ akuntan }) {
  const toast = useToast();
  const [sub, setSub] = useState('pemetaan');
  const [q, setQ] = useState('');
  const akun = useLoad(() => api.get('/api/akuntansi/akun', { q }), [q]);
  const pem = useLoad(() => api.get('/api/akuntansi/pemetaan'), []);
  const [edit, setEdit] = useState(null);
  const simpan = async () => {
    try { await api.put(`/api/akuntansi/pemetaan/${edit.kode_rekening}`, edit); toast('Pemetaan tersimpan'); setEdit(null); pem.reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Card bodyClass="p-0" actions={<Tabs value={sub} onChange={setSub} tabs={[{ value: 'pemetaan', label: 'Pemetaan rekening → akun' }, { value: 'akun', label: 'Bagan akun (CoA)' }]} />}
      title={sub === 'akun' ? 'Bagan akun standar (Permendagri 90/2019)' : 'Pemetaan kode rekening belanja/pendapatan ke akun LO'}>
      {sub === 'akun' ? <>
        <div className="border-b border-slate-100 p-3"><SearchInput value={q} onChange={setQ} placeholder="Cari kode / nama akun" /></div>
        {!akun.data ? <SkeletonRows rows={10} cols={4} /> : (
          <div className="max-h-[65vh] overflow-auto"><table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface"><tr><th className="th">Kode</th><th className="th">Nama</th><th className="th">Kelompok</th><th className="th">Saldo normal</th><th className="th">Basis</th></tr></thead>
            <tbody>{akun.data.rows.map((a) => <tr key={a.kode} className={cx(a.level <= 2 && 'bg-slate-50 font-semibold')}><td className="td font-mono" style={{ paddingLeft: 8 + (a.level - 1) * 10 }}>{a.kode}</td><td className="td">{a.nama}</td><td className="td">{a.kelompok}</td><td className="td">{a.saldo_normal === 'D' ? 'Debit' : 'Kredit'}</td><td className="td"><Badge color={a.basis === 'LO' ? 'blue' : 'green'}>{a.basis}</Badge></td></tr>)}</tbody>
          </table></div>
        )}
      </> : <>
        <p className="flex gap-1.5 border-b border-slate-100 px-4 py-2 text-[11px] text-slate-500"><Info className="h-3.5 w-3.5 shrink-0" />Bila tidak diatur, akun cerminan dipakai (5.1 → 8.1 beban, 5.2 → 1.3 aset tetap, 4 → 7 pendapatan LO). Ubah perlakuan menjadi “Telaah manual” untuk rekening yang perlu pertimbangan (mis. persediaan, ekstrakomptabel).</p>
        {!pem.data ? <SkeletonRows rows={8} cols={4} /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-xs">
            <thead><tr><th className="th">Kode rekening</th><th className="th">Uraian</th><th className="th">Akun LO</th><th className="th">Perlakuan</th><th className="th" /></tr></thead>
            <tbody>{pem.data.rows.map((r) => (
              <tr key={r.kode_rekening} className="hover:bg-slate-50"><td className="td font-mono">{r.kode_rekening}</td><td className="td">{r.nama}</td>
                <td className="td font-mono">{r.akun_lo || <span className="text-slate-400">{r.cermin?.kode} (cerminan)</span>}</td>
                <td className="td">{r.perlakuan ? <Badge color={r.perlakuan === 'telaah' ? 'amber' : 'blue'}>{PERLAKUAN[r.perlakuan]}</Badge> : <span className="text-slate-400">{r.cermin?.perlakuan}</span>}</td>
                <td className="td">{akuntan && <Button size="sm" variant="ghost" onClick={() => setEdit({ ...r })}>Ubah</Button>}</td></tr>))}</tbody>
          </table></div>
        )}
      </>}
      <Modal open={!!edit} size="sm" onClose={() => setEdit(null)} title="Pemetaan akun" subtitle={edit && `${edit.kode_rekening} · ${edit.nama}`}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Batal</Button><Button onClick={simpan}>Simpan</Button></>}>
        {edit && <div className="space-y-3">
          <Field label="Akun LO" hint={`Kosongkan untuk memakai cerminan ${edit.cermin?.kode}`}><Input value={edit.akun_lo || ''} onChange={(e) => setEdit({ ...edit, akun_lo: e.target.value })} placeholder={edit.cermin?.kode} /></Field>
          <Field label="Perlakuan"><Select value={edit.perlakuan || ''} onChange={(e) => setEdit({ ...edit, perlakuan: e.target.value })} options={[{ value: '', label: 'Ikuti cerminan' }, ...Object.entries(PERLAKUAN).map(([value, label]) => ({ value, label }))]} /></Field>
          <Field label="Catatan / dasar"><Textarea value={edit.catatan || ''} onChange={(e) => setEdit({ ...edit, catatan: e.target.value })} /></Field>
        </div>}
      </Modal>
    </Card>
  );
}
