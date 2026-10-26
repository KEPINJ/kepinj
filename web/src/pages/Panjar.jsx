import { useEffect, useState } from 'react';
import { HandCoins, Plus, Printer, CheckCircle2, AlarmClock, Undo2, Wallet } from 'lucide-react';
import { terbilang } from '@shared/terbilang.js';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Combo, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, SkeletonRows, Stat, Tabs, Textarea, cx, useLoad, useToast } from '../components/ui.jsx';
import { money, rp, tgl, today } from '../lib/format.js';
import { Ttd } from './PenutupanKas.jsx';

function SisaHari({ r }) {
  if (r.status !== 'berjalan') return <Badge color="green"><CheckCircle2 className="h-3 w-3" />Selesai {tgl(r.tanggal_selesai)}</Badge>;
  if (r.sisa_hari < 0) return <Badge color="red"><AlarmClock className="h-3 w-3" />Lewat {-r.sisa_hari} hari</Badge>;
  if (r.sisa_hari <= 3) return <Badge color="amber"><AlarmClock className="h-3 w-3" />{r.sisa_hari === 0 ? 'Hari ini' : `${r.sisa_hari} hari lagi`}</Badge>;
  return <Badge color="blue">{r.sisa_hari} hari lagi</Badge>;
}

export default function Panjar() {
  const { skpdId, tahun, can, skpd } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('berjalan');
  const [baru, setBaru] = useState(false);
  const [selesai, setSelesai] = useState(null);
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/panjar', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  useLive((e) => e.type === 'panjar.updated' && reload(), 600);
  const rg = data?.ringkasan;
  const rows = (data?.rows || []).filter((r) => tab === 'semua' || r.status === tab);
  const semua = data?.rows || [];

  return (
    <div className="space-y-5">
      <PageHeader icon={HandCoins} title="Panjar Kegiatan" subtitle="Uang muka kepada PPTK/pelaksana dan pertanggungjawabannya (Buku Pembantu Panjar)"
        actions={<>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Cetak buku pembantu</Button>
          {can('admin', 'bendahara') && <Button icon={Plus} onClick={() => setBaru(true)}>Beri panjar</Button>}
        </>} />

      <div className="no-print grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Panjar berjalan" value={rg ? rp(rg.nilai_berjalan) : '…'} sub={rg && `${rg.berjalan} panjar belum dipertanggungjawabkan`} icon={Wallet} tone="brand" />
        <Stat label="Melewati batas" value={rg?.lewat ?? '…'} sub={`Batas ${data?.batas_hari ?? 14} hari sejak diberikan`} icon={AlarmClock} tone={rg?.lewat ? 'red' : 'green'} />
        <Stat label="Realisasi dibukukan" value={rg ? rp(rg.realisasi) : '…'} sub={rg && `${rg.selesai} panjar selesai`} icon={CheckCircle2} tone="green" />
        <Stat label="Sisa dikembalikan" value={rg ? rp(rg.dikembalikan) : '…'} icon={Undo2} tone="amber" />
      </div>
      {rg?.lewat > 0 && <Alert className="no-print" tone="error" title={`${rg.lewat} panjar melewati batas pertanggungjawaban`}>Segera minta bukti belanja dan sisa uang dari penerima panjar agar kas bendahara dapat dipertanggungjawabkan.</Alert>}

      <Card className="no-print" bodyClass="" actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'berjalan', label: 'Berjalan', count: rg?.berjalan }, { value: 'selesai', label: 'Selesai', count: rg?.selesai }, { value: 'semua', label: 'Semua' }]} />} title="Daftar panjar">
        {loading && !data ? <SkeletonRows /> : !rows.length ? <Empty icon={HandCoins} title="Tidak ada panjar" text="Panjar yang diberikan kepada PPTK atau pelaksana kegiatan tampil di sini." /> : (
          <div className="divide-y divide-slate-100">
            {rows.map((r) => (
              <div key={r.id} className={cx('flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center', r.sisa_hari < 0 && 'bg-rose-50/40')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-xs text-slate-600">{r.nomor}</span><SisaHari r={r} /><Badge>{r.metode === 'bank' ? 'Bank' : 'Tunai'}</Badge></div>
                  <p className="mt-1 text-sm font-medium text-slate-800">{r.penerima_nama}{r.jabatan && <span className="font-normal text-slate-500"> · {r.jabatan}</span>}</p>
                  <p className="line-clamp-1 text-sm text-slate-600">{r.kegiatan}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Diberikan {tgl(r.tanggal)} · batas {tgl(r.batas_tanggal)}{r.kode_rekening && ` · ${r.kode_rekening}`}</p>
                </div>
                <div className="text-right">
                  <p className="num text-sm font-semibold text-slate-900">{rp(r.nilai)}</p>
                  {r.status === 'selesai' && <p className="num text-[11px] text-slate-500">realisasi {rp(r.realisasi)} · kembali {rp(r.sisa_kembali)}</p>}
                </div>
                {r.status === 'berjalan' && can('admin', 'bendahara') && <Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => setSelesai(r)}>Pertanggungjawaban</Button>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Versi cetak: Buku Pembantu Panjar */}
      <div className="theme-light print-area hidden bg-white p-8 text-[11px] text-black print:block">
        <div className="text-center">
          <p className="text-sm font-bold uppercase">{skpd?.nama}</p>
          <p className="mt-1 text-base font-bold">BUKU PEMBANTU PANJAR</p>
          <p>Tahun Anggaran {tahun}</p>
        </div>
        <table className="mt-4 w-full border-collapse">
          <thead><tr>{['No', 'Tanggal', 'Nomor', 'Penerima', 'Kegiatan', 'Panjar', 'Realisasi', 'Sisa kembali', 'Status'].map((h) => <th key={h} className="border border-black px-1.5 py-1">{h}</th>)}</tr></thead>
          <tbody>
            {[...semua].reverse().map((r, i) => (
              <tr key={r.id}>
                <td className="border border-black px-1.5 text-center">{i + 1}</td><td className="whitespace-nowrap border border-black px-1.5">{tgl(r.tanggal)}</td>
                <td className="border border-black px-1.5">{r.nomor}</td><td className="border border-black px-1.5">{r.penerima_nama}</td><td className="border border-black px-1.5">{r.kegiatan}</td>
                <td className="border border-black px-1.5 text-right">{money(r.nilai)}</td><td className="border border-black px-1.5 text-right">{r.status === 'selesai' ? money(r.realisasi) : ''}</td>
                <td className="border border-black px-1.5 text-right">{r.status === 'selesai' ? money(r.sisa_kembali) : ''}</td>
                <td className="border border-black px-1.5">{r.status === 'selesai' ? `Selesai ${tgl(r.tanggal_selesai)}` : `Berjalan (batas ${tgl(r.batas_tanggal)})`}</td>
              </tr>
            ))}
            <tr className="font-bold"><td className="border border-black px-1.5" colSpan={5}>Jumlah</td>
              <td className="border border-black px-1.5 text-right">{money(semua.reduce((s, r) => s + Number(r.nilai), 0))}</td>
              <td className="border border-black px-1.5 text-right">{money(rg?.realisasi)}</td><td className="border border-black px-1.5 text-right">{money(rg?.dikembalikan)}</td><td className="border border-black" /></tr>
          </tbody>
        </table>
        {skpd && <Ttd skpd={skpd} tanggal={today()} />}
      </div>

      <FormPanjar open={baru} onClose={() => setBaru(false)} batas={data?.batas_hari} onSaved={(r) => { toast(`Panjar ${r.nomor} untuk ${r.penerima_nama} dicatat`); reload(); }} />
      <FormSelesai p={selesai} onClose={() => setSelesai(null)} onSaved={(r) => { toast(`Panjar ${r.nomor} selesai. Realisasi dibukukan di BKU${Number(r.sisa_kembali) ? `, sisa ${rp(r.sisa_kembali)} kembali ke kas` : ''}.`); reload(); }} />
    </div>
  );
}

function useReferensi() {
  const [ref, setRef] = useState({ pegawai: [], rekening: [] });
  useEffect(() => { Promise.all([api.get('/api/master/pegawai'), api.get('/api/master/rekening', { jenis: 'belanja' })]).then(([p, r]) => setRef({ pegawai: p.rows, rekening: r.rows })).catch(() => {}); }, []);
  return ref;
}

function FormPanjar({ open, onClose, batas, onSaved }) {
  const { skpdId } = useApp();
  const ref = useReferensi();
  const [f, setF] = useState({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setErr(''); setF({ tanggal: today(), pegawai_id: '', penerima_nama: '', kegiatan: '', kode_rekening: '', nilai: 0, metode: 'tunai', batas_tanggal: '' }); } }, [open]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post('/api/panjar', { ...f, skpd_id: skpdId, pegawai_id: f.pegawai_id || null, kode_rekening: f.kode_rekening || null, batas_tanggal: f.batas_tanggal || null }); onSaved(r.row); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Beri panjar kegiatan" subtitle={`Wajib dipertanggungjawabkan paling lambat ${batas ?? 14} hari setelah diberikan (dapat diubah).`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={submit}>Simpan panjar</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Penerima (PPTK / pelaksana)"><Combo value={f.pegawai_id} onChange={set('pegawai_id')} placeholder="Pilih pegawai" options={ref.pegawai.map((p) => ({ value: p.id, label: p.nama, hint: [p.nip, p.jabatan].filter(Boolean).join(' · ') }))} /></Field>
          {!f.pegawai_id && <Field label="atau nama penerima"><Input value={f.penerima_nama || ''} onChange={set('penerima_nama')} /></Field>}
        </div>
        <Field label="Kegiatan"><Textarea value={f.kegiatan || ''} onChange={set('kegiatan')} placeholder="mis. Rapat koordinasi penyusunan RKA di kecamatan" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tanggal"><Input type="date" value={f.tanggal || ''} onChange={set('tanggal')} /></Field>
          <Field label="Batas pertanggungjawaban" hint="Kosongkan untuk otomatis"><Input type="date" value={f.batas_tanggal || ''} onChange={set('batas_tanggal')} /></Field>
          <Field label="Kas"><Select value={f.metode} onChange={set('metode')} options={[{ value: 'tunai', label: 'Tunai' }, { value: 'bank', label: 'Bank (transfer)' }]} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rencana kode rekening"><Combo value={f.kode_rekening} onChange={set('kode_rekening')} placeholder="Opsional" options={ref.rekening.map((r) => ({ value: r.kode, label: `${r.kode} — ${r.nama}` }))} /></Field>
          <Field label="Nilai panjar" hint={f.nilai ? terbilang(f.nilai) : undefined}><MoneyInput value={f.nilai} onChange={set('nilai')} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function FormSelesai({ p, onClose, onSaved }) {
  const ref = useReferensi();
  const [f, setF] = useState({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (p) { setErr(''); setF({ tanggal: today() < p.tanggal ? p.tanggal : today(), realisasi: Number(p.nilai), kode_rekening: p.kode_rekening || '', no_bukti: '' }); } }, [p]);
  if (!p) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const sisa = Number(p.nilai) - Number(f.realisasi || 0);
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/api/panjar/${p.id}/selesai`, f); onSaved(r.row); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Pertanggungjawaban ${p.nomor}`} subtitle={`${p.penerima_nama} · panjar ${rp(p.nilai)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={submit}>Selesaikan & bukukan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tanggal pertanggungjawaban"><Input type="date" value={f.tanggal} onChange={set('tanggal')} /></Field>
          <Field label="No. bukti belanja" hint={`Kosongkan untuk memakai ${p.nomor}`}><Input value={f.no_bukti} onChange={set('no_bukti')} /></Field>
        </div>
        <Field label="Kode rekening belanja"><Combo value={f.kode_rekening} onChange={set('kode_rekening')} placeholder="Pilih rekening" options={ref.rekening.map((r) => ({ value: r.kode, label: `${r.kode} — ${r.nama}` }))} /></Field>
        <Field label="Realisasi belanja (sesuai bukti)"><MoneyInput value={f.realisasi} onChange={set('realisasi')} /></Field>
        <div className={cx('grid grid-cols-3 gap-2 rounded-xl p-3 text-sm', sisa < 0 ? 'bg-rose-50' : 'bg-slate-50')}>
          <div><p className="text-xs text-slate-500">Panjar</p><p className="num font-semibold">{rp(p.nilai)}</p></div>
          <div><p className="text-xs text-slate-500">Realisasi</p><p className="num font-semibold">{rp(f.realisasi)}</p></div>
          <div><p className="text-xs text-slate-500">{sisa < 0 ? 'Kurang bayar' : 'Sisa dikembalikan'}</p><p className={cx('num font-semibold', sisa < 0 ? 'text-rose-700' : 'text-emerald-700')}>{rp(Math.abs(sisa))}</p></div>
        </div>
        <p className="text-[11px] text-slate-500">Realisasi dibukukan sebagai belanja di BKU (kas {p.metode}). Sisa panjar dianggap kembali ke kas bendahara.</p>
      </div>
    </Modal>
  );
}
