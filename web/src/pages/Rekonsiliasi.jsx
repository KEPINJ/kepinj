import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Landmark, Upload, Play, CheckCircle2, AlertTriangle, Link2, PlusCircle, Save, History, Lock, Download, Copy, XCircle, Scale, Search } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Progress, Select, Stat, Tabs, Textarea, cx, useLoad, useToast } from '../components/ui.jsx';
import { money, rp, tgl, waktu } from '../lib/format.js';

export const KATEGORI_REKON = {
  cocok: ['green', 'Cocok'], selisih: ['amber', 'Selisih'], periksa: ['violet', 'Perlu diperiksa'],
  belum_bku: ['red', 'Belum tercatat di BKU'], belum_bank: ['blue', 'Belum ada di bank'], duplikat: ['slate', 'Duplikat'],
};
const KOLOM = [['tanggal', 'Tanggal'], ['keterangan', 'Keterangan'], ['debet', 'Debet (uang keluar)'], ['kredit', 'Kredit (uang masuk)'], ['nilai', 'atau satu kolom nilai (+/−)'], ['saldo', 'Saldo (opsional)']];
const nilaiMt = (m) => (m ? m.masuk || m.keluar : 0);
const nilaiE = (e, masuk) => (masuk ? e.masuk : e.netto ?? e.keluar);

/** Rekonsiliasi bank otomatis: unggah rekening koran -> cocokkan -> tinjau manual -> laporan rekonsiliasi (draf/final). */
export default function Rekonsiliasi() {
  const { skpdId, can } = useApp();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [ds, setDs] = useState(null);           // { id, nama, kolom, mapping, contoh, terbaca, baris }
  const [m, setM] = useState({});
  const [opsi, setOpsi] = useState({ toleransi_hari: 3, toleransi_persen: 5, dari: '', sampai: '' });
  const [res, setRes] = useState(null);
  const [saldoBank, setSaldoBank] = useState(null);
  const [tab, setTab] = useState('ringkasan');
  const [busy, setBusy] = useState('');
  const [pasang, setPasang] = useState(null);
  const [final, setFinal] = useState(false);
  const [lihat, setLihat] = useState(null);
  const tulis = can('admin', 'bendahara');
  const riwayat = useLoad(() => skpdId && api.get('/api/rekonsiliasi/riwayat', { skpd_id: skpdId }), [skpdId]);
  useEffect(() => { const id = sp.get('id'); if (id) api.get(`/api/rekonsiliasi/${id}`).then((r) => setLihat(r.row)).catch((e) => toast(e.message, 'error')); }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  const unggah = async (file) => {
    if (!file) return;
    setBusy('unggah');
    try {
      const r = await api.upload('/api/data/upload', file);
      const d = r.datasets[0];
      const k = await api.get(`/api/rekonsiliasi/kolom/${d.id}`);
      setDs({ id: d.id, nama: file.name, ...k }); setM(k.mapping); setRes(null);
      toast(`${file.name}: ${k.terbaca} dari ${k.baris} baris terbaca sebagai mutasi`);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const jalankan = async () => {
    setBusy('jalan');
    try {
      const r = await api.post('/api/rekonsiliasi', { dataset_id: ds.id, skpd_id: skpdId, mapping: m, ...opsi });
      setRes(r); setSaldoBank(r.saldo.saldo_bank); setTab(r.ringkasan.periksa ? 'periksa' : 'ringkasan');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  // Hitung ulang indikator & laporan saldo di server setiap kali hasil ditinjau
  const terapkan = async (items, sb = saldoBank) => {
    setRes((r) => ({ ...r, items }));
    try {
      const h = await api.post('/api/rekonsiliasi/ringkas', { items, dari: res.periode.dari, sampai: res.periode.sampai, duplikat_bku: res.duplikat_bku.length, saldo_bku: res.saldo.saldo_bku, saldo_bank: sb });
      setRes((r) => ({ ...r, items, ringkasan: h.ringkasan, saldo: h.saldo || { saldo_bku: r.saldo.saldo_bku, saldo_bank: null } }));
    } catch (e) { toast(e.message, 'error'); }
  };
  const ubahItem = (i, ganti) => terapkan(res.items.map((x, j) => (j === i ? { ...x, ...ganti } : x)));
  const terima = (i) => ubahItem(i, { konfirmasi: 'diterima' });
  const tolak = (i) => ubahItem(i, { kategori: 'belum_bku', bku: [], konfirmasi: 'ditolak', alasan: 'Pasangan otomatis ditolak bendahara' });
  const pilihKandidat = (i, e) => {
    const it = res.items[i];
    const masuk = it.mutasi.masuk > 0;
    const beda = Math.round((nilaiMt(it.mutasi) - nilaiE(e, masuk)) * 100) / 100;
    const sisa = res.items.filter((x, j) => j !== i && !(x.kategori === 'belum_bank' && x.bku[0]?.id === e.id));
    const baru = { ...it, kategori: beda ? 'selisih' : 'cocok', bku: [e], kandidat: undefined, selisih: beda || undefined, manual: true, konfirmasi: 'manual', alasan: 'Dipasangkan manual oleh bendahara' };
    terapkan([...sisa.slice(0, i), baru, ...sisa.slice(i)]);
  };
  const catat = async (i) => {
    const it = res.items[i]; const sr = it.saran; const mt = it.mutasi;
    try {
      const { entry } = await api.post('/api/bku', { skpd_id: skpdId, tanggal: mt.tanggal, jenis: sr.jenis, metode: 'bank', no_bukti: `REK-${mt.tanggal.replaceAll('-', '')}`,
        uraian: sr.uraian, penerimaan: sr.arah === 'penerimaan' ? mt.masuk : 0, pengeluaran: sr.arah === 'pengeluaran' ? mt.keluar : 0 });
      const e = { ...entry, masuk: Number(entry.penerimaan), keluar: Number(entry.pengeluaran), netto: Number(entry.pengeluaran) };
      ubahItem(i, { kategori: 'cocok', bku: [e], manual: true, konfirmasi: 'manual', alasan: `Dicatat ke BKU No. ${entry.no_urut} dari rekonsiliasi`, saran: undefined });
      toast(`Dicatat di BKU No. ${entry.no_urut} (menunggu verifikasi)`);
    } catch (er) { toast(er.message, 'error'); }
  };
  const simpan = async (status, catatan) => {
    setBusy(status);
    try {
      const { row } = await api.post('/api/rekonsiliasi/simpan', { skpd_id: skpdId, status, catatan, dari: res.periode.dari, sampai: res.periode.sampai, ringkasan: res.ringkasan,
        items: res.items, saldo: res.saldo, periode: res.periode, nama_file: res.nama_file, duplikat_bku: res.duplikat_bku });
      toast(status === 'final' ? 'Rekonsiliasi difinalkan sebagai laporan resmi' : 'Draf rekonsiliasi disimpan'); riwayat.reload(); setFinal(false);
      if (status === 'final') setSp({ id: row.id });
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  const s = res?.ringkasan;
  const daftar = (k) => (res?.items || []).map((x, i) => ({ ...x, i })).filter((x) => x.kategori === k);
  const belumKonfirmasi = daftar('periksa').filter((x) => !x.konfirmasi).length;

  return (
    <div className="space-y-4">
      <PageHeader icon={Landmark} title="Rekonsiliasi Bank" subtitle="Unggah rekening koran (CSV/Excel), cocokkan otomatis dengan BKU kas bank, tinjau, lalu finalkan laporan rekonsiliasi" />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card title="1. Rekening koran">
            <div className="space-y-3">
              <label className={cx('flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm text-slate-600 hover:border-brand-400', busy === 'unggah' && 'opacity-60')}>
                <Upload className="h-4 w-4" />{busy === 'unggah' ? 'Membaca berkas…' : 'Unggah mutasi (.csv / .xlsx)'}
                <input type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden" onChange={(e) => { unggah(e.target.files[0]); e.target.value = ''; }} />
              </label>
              {ds && <>
                <p className="text-xs text-slate-600"><b>{ds.nama}</b> · {ds.terbaca} mutasi terbaca dari {ds.baris} baris</p>
                <p className="pt-1 text-xs font-semibold text-slate-700">2. Pemetaan kolom (ditebak otomatis)</p>
                {KOLOM.map(([k, l]) => <Field key={k} label={l}><Select value={m[k] || ''} onChange={(e) => setM({ ...m, [k]: e.target.value })} placeholder="— tidak dipakai —" options={ds.kolom} /></Field>)}
                <p className="pt-1 text-xs font-semibold text-slate-700">3. Toleransi</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Selisih tanggal (hari)"><Input type="number" min={0} max={31} value={opsi.toleransi_hari} onChange={(e) => setOpsi({ ...opsi, toleransi_hari: e.target.value })} /></Field>
                  <Field label="Selisih nilai (%)"><Input type="number" min={0} max={50} step="0.5" value={opsi.toleransi_persen} onChange={(e) => setOpsi({ ...opsi, toleransi_persen: e.target.value })} /></Field>
                  <Field label="Dari"><Input type="date" value={opsi.dari} onChange={(e) => setOpsi({ ...opsi, dari: e.target.value })} /></Field>
                  <Field label="Sampai"><Input type="date" value={opsi.sampai} onChange={(e) => setOpsi({ ...opsi, sampai: e.target.value })} /></Field>
                </div>
                <Button className="w-full" icon={Play} loading={busy === 'jalan'} onClick={jalankan}>Jalankan pencocokan</Button>
              </>}
            </div>
          </Card>
          <Card title="Riwayat rekonsiliasi" bodyClass="divide-y divide-slate-100 p-0">
            {!riwayat.data?.rows.length ? <p className="px-4 py-6 text-center text-xs text-slate-500">Belum ada rekonsiliasi tersimpan.</p> : riwayat.data.rows.slice(0, 10).map((r) => (
              <button key={r.id} type="button" onClick={() => setSp({ id: r.id })} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-xs hover:bg-slate-50">
                {r.status === 'final' ? <Lock className="mt-0.5 h-3.5 w-3.5 text-emerald-600" /> : <History className="mt-0.5 h-3.5 w-3.5 text-slate-400" />}
                <div className="min-w-0 flex-1"><p className="font-medium text-slate-700">{tgl(r.dari)} – {tgl(r.sampai)} <Badge color={r.status === 'final' ? 'green' : 'slate'}>{r.status === 'final' ? 'Final' : 'Draf'}</Badge></p>
                  <p className="text-slate-500">{r.ringkasan.persen_cocok}% cocok · selisih {rp(r.ringkasan.total_selisih || 0)} · {r.dibuat_oleh} · {waktu(r.created_at)}</p></div>
              </button>))}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {!res ? <Card><Empty icon={Landmark} title="Belum ada hasil" text="Unggah mutasi rekening bendahara (contoh: samples/contoh_mutasi_bank_september.csv), periksa pemetaan kolom, lalu jalankan pencocokan." /></Card> : <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="Persentase cocok" value={`${s.persen_cocok}%`} sub={`${s.cocok} dari ${s.mutasi - s.duplikat} mutasi`} icon={CheckCircle2} tone="green" trend={<Progress value={s.persen_cocok} className="mt-2" />} />
              <Stat label="Belum cocok" value={s.belum_cocok} sub={`${s.belum_bku} belum di BKU · ${s.belum_bank} belum di bank`} icon={AlertTriangle} tone={s.belum_cocok ? 'amber' : 'green'} />
              <Stat label="Total selisih" value={rp(s.total_selisih)} sub={`${s.selisih} pasangan berbeda nilai`} icon={Scale} tone={s.total_selisih ? 'red' : 'green'} />
              <Stat label="Duplikat" value={s.duplikat + s.duplikat_bku} sub={`${s.duplikat} di rekening koran · ${s.duplikat_bku} di BKU`} icon={Copy} tone={s.duplikat + s.duplikat_bku ? 'red' : 'green'} />
              <Stat label="Perlu review manual" value={s.periksa} sub={belumKonfirmasi ? `${belumKonfirmasi} belum dikonfirmasi` : 'Semua sudah ditinjau'} icon={Search} tone={belumKonfirmasi ? 'violet' : 'green'} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tabs value={tab} onChange={setTab} tabs={[{ value: 'ringkasan', label: 'Laporan saldo' }, ...Object.entries(KATEGORI_REKON).map(([k, [, l]]) => ({ value: k, label: l, count: s[k] }))]} />
              {tulis && <div className="flex gap-2">
                <Button variant="secondary" icon={Save} loading={busy === 'draf'} onClick={() => simpan('draf')}>Simpan draf</Button>
                <Button icon={Lock} disabled={belumKonfirmasi > 0} onClick={() => setFinal(true)} title={belumKonfirmasi ? 'Konfirmasi semua baris “perlu diperiksa” dahulu' : ''}>Finalkan</Button>
              </div>}
            </div>
            {tab === 'ringkasan' ? <LaporanSaldo res={res} saldoBank={saldoBank} onSaldo={(v) => { setSaldoBank(v); terapkan(res.items, v); }} /> : (
              <Card bodyClass="max-h-[60vh] overflow-auto p-0">
                <DaftarKategori k={tab} rows={daftar(tab)} tulis={tulis} res={res} aksi={{ terima, tolak, pilihKandidat, catat, pasang: (x) => setPasang(x) }} />
              </Card>
            )}
          </>}
        </div>
      </div>
      <PasangManual x={pasang} res={res} onClose={() => setPasang(null)} onPilih={(e) => { pilihKandidat(pasang.i, e); setPasang(null); }} />
      <FinalModal open={final} s={s} saldo={res?.saldo} busy={busy === 'final'} onClose={() => setFinal(false)} onOk={(c) => simpan('final', c)} />
      <LihatTersimpan row={lihat} onClose={() => { setLihat(null); setSp({}, { replace: true }); }} />
    </div>
  );
}

function LaporanSaldo({ res, saldoBank, onSaldo }) {
  const s = res.ringkasan; const sl = res.saldo;
  const baris = (l, v, tebal) => <tr className={cx(tebal && 'bg-slate-50 font-semibold')}><td className="td">{l}</td><td className="td num text-right">{v == null ? '-' : money(v)}</td></tr>;
  return (
    <Card title="Laporan rekonsiliasi saldo" subtitle={`Periode ${tgl(res.periode.dari)} – ${tgl(res.periode.sampai)} · toleransi ±${res.periode.toleransi_hari} hari, ${res.periode.toleransi_persen}%`}>
      <Field label="Saldo akhir menurut rekening koran" hint={res.mapping?.saldo ? 'Diambil dari kolom saldo baris terakhir; ubah bila perlu' : 'Isi dari rekening koran untuk menghitung selisih saldo'} className="mb-4 max-w-sm">
        <MoneyInput value={saldoBank ?? ''} onChange={onSaldo} />
      </Field>
      <div className="grid gap-4 lg:grid-cols-2">
        <table className="w-full text-sm"><tbody>
          {baris('Saldo kas bank menurut BKU', sl.saldo_bku, true)}
          {baris('+ Penerimaan bank belum dicatat di BKU', s.belum_bku_masuk)}
          {baris('− Pengeluaran bank belum dicatat di BKU', s.belum_bku_keluar)}
          {baris('± Selisih nilai pasangan', s.selisih_bersih)}
          {baris('Saldo BKU setelah penyesuaian', sl.saldo_bku_disesuaikan, true)}
        </tbody></table>
        <table className="w-full text-sm"><tbody>
          {baris('Saldo menurut rekening koran', sl.saldo_bank, true)}
          {baris('− Penerimaan BKU belum dikredit bank', s.belum_bank_masuk)}
          {baris('+ Pengeluaran BKU belum didebet bank', s.belum_bank_keluar)}
          {baris('', null)}
          {baris('Saldo bank setelah penyesuaian', sl.saldo_bank_disesuaikan, true)}
        </tbody></table>
      </div>
      {sl.saldo_bank != null && (Math.abs(sl.tak_terjelaskan) < 1
        ? <Alert tone="ok" className="mt-4">Saldo BKU dan rekening koran sama setelah penyesuaian.</Alert>
        : <Alert tone="error" className="mt-4" title={`Selisih tak terjelaskan ${rp(sl.tak_terjelaskan, { decimals: true })}`}>Periksa transaksi di luar periode, mutasi yang belum diunggah, atau pencatatan BKU yang keliru.</Alert>)}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="th" /><th className="th text-right">Masuk</th><th className="th text-right">Keluar</th></tr></thead><tbody>
        <tr><td className="td">Rekening koran (periode)</td><td className="td num text-right">{money(s.bank_masuk)}</td><td className="td num text-right">{money(s.bank_keluar)}</td></tr>
        <tr><td className="td">BKU kas bank (belanja netto setelah pajak)</td><td className="td num text-right">{money(s.bku_masuk)}</td><td className="td num text-right">{money(s.bku_keluar)}</td></tr>
      </tbody></table></div>
      {res.duplikat_bku.length > 0 && <Alert tone="warn" className="mt-3" title="Kemungkinan pencatatan ganda di BKU">{res.duplikat_bku.map((d) => `No. ${d.a.no_urut} & No. ${d.b.no_urut} (${tgl(d.a.tanggal)}, ${money(d.a.masuk || d.a.keluar)})`).join('; ')}</Alert>}
    </Card>
  );
}

function DaftarKategori({ k, rows, tulis, aksi }) {
  if (!rows.length) return <p className="py-10 text-center text-sm text-slate-500">Tidak ada baris pada kategori ini.</p>;
  const sisiBank = (mt) => mt ? <><p className="text-slate-800">{mt.keterangan}</p><p className="text-[11px] text-slate-500">Baris {mt.baris} · {tgl(mt.tanggal)}</p></> : <span className="text-slate-400">—</span>;
  const sisiBku = (b) => b?.length ? b.map((e) => <div key={e.id}><p className="line-clamp-1 text-slate-800">{e.uraian}</p><p className="text-[11px] text-slate-500">No. {e.no_urut} · {tgl(e.tanggal)} · {e.no_bukti} · {money(e.masuk || e.netto || e.keluar)}</p></div>) : <span className="text-slate-400">—</span>;
  return (
    <table className="w-full min-w-[820px] text-xs">
      <thead className="sticky top-0 z-10 bg-surface"><tr><th className="th">Rekening koran</th><th className="th">BKU</th><th className="th text-right">Nilai bank</th><th className="th">Keterangan</th>{tulis && <th className="th">Tindakan</th>}</tr></thead>
      <tbody>{rows.map((x) => (
        <tr key={x.i} className="align-top hover:bg-slate-50">
          <td className="td">{sisiBank(x.mutasi)}</td>
          <td className="td">{sisiBku(x.bku)}
            {x.kandidat?.length > 0 && !x.bku.length && <div className="mt-1 space-y-1">{x.kandidat.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/50 px-2 py-1"><span className="flex-1">No. {e.no_urut} · {tgl(e.tanggal)} · {money(e.masuk || e.netto)}</span>{tulis && <Button size="sm" variant="secondary" icon={Link2} onClick={() => aksi.pilihKandidat(x.i, e)}>Pilih</Button>}</div>))}</div>}
          </td>
          <td className="td num text-right">{x.mutasi ? (x.mutasi.masuk ? <span className="text-emerald-700">+{money(x.mutasi.masuk)}</span> : <span className="text-rose-700">−{money(x.mutasi.keluar)}</span>) : ''}</td>
          <td className="td"><p className="text-slate-600">{x.alasan}</p>
            {x.selisih ? <Badge color="amber">Selisih {money(x.selisih)}</Badge> : null}
            {x.konfirmasi && <Badge color={x.konfirmasi === 'ditolak' ? 'red' : 'green'} className="ml-1">{x.konfirmasi === 'diterima' ? 'Dikonfirmasi' : x.konfirmasi === 'manual' ? 'Manual' : 'Ditolak'}</Badge>}
            {x.saran && <p className="mt-1 text-[11px] text-amber-800">Saran: {x.saran.uraian}</p>}
          </td>
          {tulis && <td className="td whitespace-nowrap">
            {(k === 'periksa' && x.bku.length > 0 && !x.konfirmasi) && <div className="flex gap-1"><Button size="sm" variant="success" icon={CheckCircle2} onClick={() => aksi.terima(x.i)}>Terima</Button><Button size="sm" variant="secondary" icon={XCircle} onClick={() => aksi.tolak(x.i)}>Tolak</Button></div>}
            {(k === 'selisih' && !x.konfirmasi) && <Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => aksi.terima(x.i)}>Akui selisih</Button>}
            {k === 'belum_bku' && <div className="flex flex-col gap-1">
              {x.saran && <Button size="sm" icon={PlusCircle} onClick={() => aksi.catat(x.i)}>Catat ke BKU</Button>}
              <Button size="sm" variant="secondary" icon={Link2} onClick={() => aksi.pasang(x)}>Pasangkan manual</Button>
            </div>}
          </td>}
        </tr>
      ))}</tbody>
    </table>
  );
}

function PasangManual({ x, res, onClose, onPilih }) {
  if (!x) return null;
  const masuk = x.mutasi.masuk > 0;
  const calon = res.items.filter((it) => it.kategori === 'belum_bank' && (masuk ? it.bku[0].masuk > 0 : it.bku[0].keluar > 0)).map((it) => it.bku[0])
    .sort((a, b) => Math.abs(nilaiE(a, masuk) - nilaiMt(x.mutasi)) - Math.abs(nilaiE(b, masuk) - nilaiMt(x.mutasi)));
  return (
    <Modal open size="md" onClose={onClose} title="Pasangkan manual" subtitle={`${x.mutasi.keterangan} · ${tgl(x.mutasi.tanggal)} · ${money(nilaiMt(x.mutasi))}`}>
      {!calon.length ? <p className="text-sm text-slate-500">Tidak ada transaksi BKU searah yang belum berpasangan.</p> : (
        <ul className="space-y-1.5">{calon.slice(0, 40).map((e) => {
          const beda = nilaiMt(x.mutasi) - nilaiE(e, masuk);
          return (
            <li key={e.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1"><p className="truncate text-slate-800">{e.uraian}</p><p className="text-slate-500">No. {e.no_urut} · {tgl(e.tanggal)} · {money(nilaiE(e, masuk))}{Math.abs(beda) >= 0.01 && <b className="ml-1 text-amber-700">selisih {money(beda)}</b>}</p></div>
              <Button size="sm" icon={Link2} onClick={() => onPilih(e)}>Pasangkan</Button>
            </li>);
        })}</ul>
      )}
    </Modal>
  );
}

function FinalModal({ open, s, saldo, busy, onClose, onOk }) {
  const [c, setC] = useState('');
  if (!open) return null;
  return (
    <Modal open size="sm" onClose={onClose} title="Finalkan rekonsiliasi" subtitle="Hasil final menjadi laporan rekonsiliasi resmi dan tidak dapat diubah"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button icon={Lock} loading={busy} onClick={() => onOk(c)}>Finalkan</Button></>}>
      <ul className="mb-3 space-y-1 text-sm">
        <li>Kecocokan: <b>{s.persen_cocok}%</b></li>
        <li>Selisih nilai: <b>{s.selisih}</b> pasangan ({rp(s.total_selisih)})</li>
        <li>Belum tercatat di BKU: <b>{s.belum_bku}</b> · belum di bank: <b>{s.belum_bank}</b></li>
        {saldo?.saldo_bank != null && <li>Selisih saldo tak terjelaskan: <b>{rp(saldo.tak_terjelaskan, { decimals: true })}</b></li>}
      </ul>
      {(s.selisih > 0 || s.belum_bku > 0) && <Alert tone="warn" className="mb-3">Bendahara, verifikator, dan admin akan menerima notifikasi selisih.</Alert>}
      <Field label="Catatan / penjelasan selisih"><Textarea value={c} onChange={(e) => setC(e.target.value)} /></Field>
    </Modal>
  );
}

function LihatTersimpan({ row, onClose }) {
  const toast = useToast();
  const [k, setK] = useState('selisih');
  if (!row) return null;
  const items = row.hasil?.items || [];
  const s = row.ringkasan;
  return (
    <Modal open size="xl" onClose={onClose} title={`Rekonsiliasi ${tgl(row.dari)} – ${tgl(row.sampai)}`} subtitle={`${row.skpd_nama} · ${row.status === 'final' ? `final oleh ${row.difinalkan_oleh_nama} ${waktu(row.difinalkan_at)}` : `draf oleh ${row.dibuat_oleh}`} · ${row.nama_file || ''}`}
      footer={<Button variant="secondary" icon={Download} onClick={() => download(`/api/rekonsiliasi/${row.id}/xlsx`).catch((e) => toast(e.message, 'error'))}>Unduh Excel</Button>}>
      <div className="mb-3 flex flex-wrap gap-2">{Object.entries(KATEGORI_REKON).map(([key, [c, l]]) => <button key={key} type="button" onClick={() => setK(key)} className={cx('rounded-full', k === key && 'ring-2 ring-brand-500')}><Badge color={c}>{l}: {s[key] ?? 0}</Badge></button>)}
        <Badge color="green">{s.persen_cocok}% cocok</Badge>{row.saldo_bank != null && <Badge color="blue">Saldo bank {rp(row.saldo_bank)} · BKU {rp(row.saldo_bku)}</Badge>}</div>
      {row.catatan && <Alert className="mb-3">{row.catatan}</Alert>}
      <div className="max-h-[55vh] overflow-auto"><DaftarKategori k={k} rows={items.map((x, i) => ({ ...x, i })).filter((x) => x.kategori === k)} tulis={false} aksi={{}} /></div>
    </Modal>
  );
}
