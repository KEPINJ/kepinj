import { useEffect, useMemo, useState } from 'react';
import { Send, Download, Landmark, CheckCircle2, AlertTriangle, FileSpreadsheet, ListChecks, Ban, Save, ChevronDown } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, SkeletonRows, Stat, Tabs, cx, useLoad, useToast } from '../components/ui.jsx';
import { compact, money, rp, tgl, today, waktu } from '../lib/format.js';

const ST = { draft: ['slate', 'Draf'], dikirim: ['amber', 'Diunggah ke CMS'], selesai: ['green', 'Selesai'], batal: ['red', 'Dibatalkan'] };
const awalBulan = () => `${today().slice(0, 8)}01`;

export default function TransferMassal() {
  const { skpdId, tahun, can } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('buat');
  const [dari, setDari] = useState(awalBulan());
  const [sampai, setSampai] = useState(today());
  const [pilih, setPilih] = useState([]);
  const [format, setFormat] = useState('mandiri_mcm');
  const [tanggal, setTanggal] = useState(today());
  const [busy, setBusy] = useState(false);
  const [hasil, setHasil] = useState(null);
  const [buka, setBuka] = useState(null);
  const [sumber, setSumber] = useState({ rekening_bendahara: '', bank_bendahara: '' });
  const tulis = can('admin', 'bendahara');
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/transfer', { skpd_id: skpdId, tahun, dari, sampai }), [skpdId, tahun, dari, sampai]);
  useLive((e) => e.type.startsWith('bku') && reload(), 1500);
  useEffect(() => { if (data?.sumber) setSumber({ rekening_bendahara: data.sumber.rekening_bendahara || '', bank_bendahara: data.sumber.bank_bendahara || '' }); }, [data?.sumber]);
  useEffect(() => setPilih([]), [dari, sampai, skpdId]);

  const kandidat = data?.kandidat || [];
  const valid = kandidat.filter((k) => !k.masalah.length && k.nilai > 0);
  const dipilih = kandidat.filter((k) => pilih.includes(k.id));
  const total = dipilih.reduce((s, k) => s + k.nilai, 0);
  const batch = data?.batch || [];
  const aktif = batch.filter((b) => b.status === 'dikirim');
  const ringkas = useMemo(() => ({ selesai: batch.filter((b) => b.status === 'selesai').reduce((s, b) => s + Number(b.total), 0), gagal: batch.reduce((s, b) => s + (b.gagal || 0), 0) }), [batch]);

  const buat = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/transfer', { skpd_id: skpdId, format, tanggal, entry_ids: pilih });
      await download(`/api/transfer/${r.batch.id}/berkas`);
      toast(`${r.batch.nomor} dibuat (${r.batch.jumlah} penerima, ${rp(r.batch.total)}). Unggah berkas ke CMS bank lalu catat hasilnya.`);
      setPilih([]); setTab('riwayat'); reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const simpanSumber = async () => {
    try { await api.put('/api/transfer/sumber', { skpd_id: skpdId, ...sumber }); toast('Rekening sumber disimpan'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const unduh = async (b) => { try { await download(`/api/transfer/${b.id}/berkas`); reload(); } catch (e) { toast(e.message, 'error'); } };

  return (
    <div className="space-y-5">
      <PageHeader icon={Send} title="Transfer Massal CMS Bank" subtitle="Kumpulkan pembayaran non-tunai ke rekanan menjadi satu berkas unggah Cash Management System. Nilai ditransfer sudah dikurangi potongan pajak." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1" title="Rekening sumber" subtitle="Rekening bendahara pengeluaran yang didebit">
          <div className="space-y-3">
            <Field label="Nomor rekening"><Input value={sumber.rekening_bendahara} disabled={!tulis} onChange={(e) => setSumber({ ...sumber, rekening_bendahara: e.target.value })} placeholder="mis. 1002003000001" /></Field>
            <Field label="Bank"><Input value={sumber.bank_bendahara} disabled={!tulis} onChange={(e) => setSumber({ ...sumber, bank_bendahara: e.target.value })} placeholder="mis. Bank Daerah" /></Field>
            {tulis && <Button size="sm" variant="secondary" icon={Save} onClick={simpanSumber}>Simpan</Button>}
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <Stat label="Siap ditransfer" value={data ? valid.length : '…'} sub={data && `${rp(valid.reduce((s, k) => s + k.nilai, 0))} pada rentang ini`} icon={ListChecks} tone="brand" />
          <Stat label="Perlu diperbaiki" value={data ? kandidat.length - valid.length : '…'} sub="Rekening/kode bank rekanan tidak valid" icon={AlertTriangle} tone={kandidat.length - valid.length ? 'amber' : 'green'} />
          <Stat label="Menunggu hasil bank" value={data ? aktif.length : '…'} sub="Berkas sudah diunduh, hasil belum dicatat" icon={Landmark} tone={aktif.length ? 'amber' : 'green'} />
          <Stat label={`Berhasil ditransfer TA ${tahun}`} value={data ? compact(ringkas.selesai) : '…'} sub={data && `${batch.filter((b) => b.status === 'selesai').length} berkas · ${ringkas.gagal} item gagal`} icon={CheckCircle2} tone="green" />
        </div>
      </div>

      <Card bodyClass="" title={tab === 'buat' ? 'Pilih pembayaran' : 'Riwayat berkas transfer'}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'buat', label: 'Buat berkas', count: valid.length || undefined }, { value: 'riwayat', label: 'Riwayat', count: batch.length || undefined }]} />}>
        {tab === 'buat' && (<>
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
            <Field label="Dari"><Input type="date" value={dari} onChange={(e) => setDari(e.target.value)} /></Field>
            <Field label="Sampai"><Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} /></Field>
            <p className="pb-2 text-xs text-slate-500">Belanja bank dengan rekanan yang belum masuk berkas. Item gagal dari berkas sebelumnya muncul kembali di sini.</p>
          </div>
          {loading && !data ? <SkeletonRows /> : !kandidat.length ? <Empty icon={CheckCircle2} title="Tidak ada pembayaran tertunda" text="Semua belanja non-tunai pada rentang ini sudah masuk berkas transfer." /> : (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[980px]">
                <thead className="sticky top-0 z-10"><tr>
                  <th className="th w-10"><input type="checkbox" disabled={!tulis} checked={valid.length > 0 && pilih.length === valid.length} onChange={(e) => setPilih(e.target.checked ? valid.map((k) => k.id) : [])} aria-label="Pilih semua" /></th>
                  <th className="th">Tanggal</th><th className="th">Penerima</th><th className="th">Uraian</th><th className="th text-right">Bruto</th><th className="th text-right">Potongan pajak</th><th className="th text-right">Ditransfer</th>
                </tr></thead>
                <tbody>
                  {kandidat.map((k) => {
                    const ok = !k.masalah.length && k.nilai > 0;
                    return (
                      <tr key={k.id} className={cx('hover:bg-brand-50/40', pilih.includes(k.id) && 'bg-brand-50/50', !ok && 'bg-amber-50/40')}>
                        <td className="td"><input type="checkbox" disabled={!ok || !tulis} checked={pilih.includes(k.id)} onChange={(e) => setPilih((p) => (e.target.checked ? [...p, k.id] : p.filter((x) => x !== k.id)))} aria-label={`Pilih ${k.no_bukti}`} /></td>
                        <td className="td whitespace-nowrap text-xs">{tgl(k.tanggal)}<p className="font-mono text-[10px] text-slate-500">{k.no_bukti}</p></td>
                        <td className="td"><p className="text-sm font-medium text-slate-800">{k.nama}</p>
                          <p className="font-mono text-[11px] text-slate-500">{k.bank}{k.kode_bank && ` (${k.kode_bank})`} · {k.no_rekening || '-'}</p>
                          {k.masalah.map((m) => <Badge key={m} color="amber" className="mt-0.5"><AlertTriangle className="h-3 w-3" />{m}</Badge>)}</td>
                        <td className="td"><p className="line-clamp-2 text-xs text-slate-700">{k.uraian}</p></td>
                        <td className="td num whitespace-nowrap text-right text-xs">{money(k.bruto)}</td>
                        <td className="td num whitespace-nowrap text-right text-xs text-rose-600">{k.potongan ? `(${money(k.potongan)})` : '-'}</td>
                        <td className="td num whitespace-nowrap text-right font-semibold">{money(k.nilai)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {tulis && kandidat.length > 0 && (
            <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
              <Field label="Format berkas"><Select className="w-60" value={format} onChange={(e) => setFormat(e.target.value)} options={Object.entries(data?.format || {}).map(([value, f]) => ({ value, label: f.label }))} /></Field>
              <Field label="Tanggal transfer"><Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} /></Field>
              <div className="ml-auto flex items-center gap-3">
                <p className="text-right text-xs text-slate-500">{pilih.length} penerima<br /><b className="num text-sm text-slate-800">{rp(total)}</b></p>
                <Button icon={FileSpreadsheet} loading={busy} disabled={!pilih.length || !sumber.rekening_bendahara} onClick={buat}>Buat & unduh berkas</Button>
              </div>
              {!sumber.rekening_bendahara && <p className="w-full text-xs text-amber-700">Isi rekening sumber terlebih dahulu.</p>}
            </div>
          )}
        </>)}

        {tab === 'riwayat' && (!batch.length ? <Empty icon={Send} title="Belum ada berkas transfer" /> : (
          <div className="divide-y divide-slate-100">
            {batch.map((b) => (
              <div key={b.id}>
                <div className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center">
                  <button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => setBuka(buka === b.id ? null : b.id)}>
                    <ChevronDown className={cx('mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition', buka === b.id && 'rotate-180')} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-sm font-semibold text-slate-800">{b.nomor}</span><Badge color={ST[b.status][0]}>{ST[b.status][1]}</Badge>
                        <Badge color="slate">{data?.format?.[b.format]?.label || b.format}</Badge></div>
                      <p className="mt-0.5 text-[11px] text-slate-500">Tanggal {tgl(b.tanggal)} · {b.jumlah} penerima · dibuat {b.dibuat_oleh} {waktu(b.created_at)}{b.diunduh_at && ` · diunduh ${waktu(b.diunduh_at)}`}
                        {b.status === 'selesai' && ` · ${b.berhasil} berhasil${b.gagal ? `, ${b.gagal} gagal` : ''}`}</p>
                    </div>
                  </button>
                  <p className="num text-sm font-semibold text-slate-900 lg:w-40 lg:text-right">{rp(b.total)}</p>
                  <div className="flex gap-1.5 lg:w-72 lg:justify-end">
                    {b.status !== 'batal' && <Button size="sm" variant="secondary" icon={Download} onClick={() => unduh(b)}>Unduh</Button>}
                    {b.status === 'dikirim' && tulis && <Button size="sm" variant="success" icon={CheckCircle2} onClick={() => setHasil(b)}>Catat hasil</Button>}
                    {['draft', 'dikirim'].includes(b.status) && tulis && <Button size="sm" variant="ghost" icon={Ban} aria-label="Batalkan berkas" onClick={async () => {
                      if (!window.confirm(`Batalkan ${b.nomor}? Pembayarannya akan kembali ke daftar siap transfer.`)) return;
                      try { await api.post(`/api/transfer/${b.id}/hasil`, { batal: true }); toast(`${b.nomor} dibatalkan`); reload(); } catch (e) { toast(e.message, 'error'); }
                    }} />}
                  </div>
                </div>
                {buka === b.id && <RincianBatch id={b.id} />}
              </div>
            ))}
          </div>
        ))}
      </Card>

      <CatatHasil b={hasil} onClose={() => setHasil(null)} onDone={(n) => { toast(n ? `Hasil dicatat; ${n} item gagal kembali ke daftar siap transfer` : 'Semua transfer berhasil'); reload(); }} />
    </div>
  );
}

function RincianBatch({ id }) {
  const { data } = useLoad(() => api.get(`/api/transfer/${id}`), [id]);
  if (!data) return <SkeletonRows rows={3} cols={4} />;
  return (
    <div className="overflow-x-auto bg-slate-50/50 px-4 pb-3">
      <table className="w-full min-w-[760px] text-xs">
        <thead><tr><th className="th">Penerima</th><th className="th">Rekening</th><th className="th">Berita</th><th className="th text-right">Ditransfer</th><th className="th">Status</th></tr></thead>
        <tbody>{data.items.map((i) => (
          <tr key={i.id}>
            <td className="td font-medium text-slate-800">{i.nama}</td><td className="td font-mono text-[11px]">{i.kode_bank} · {i.no_rekening}</td>
            <td className="td text-slate-600">{i.berita}</td><td className="td num text-right">{money(i.nilai)}</td>
            <td className="td">{i.status === 'berhasil' ? <Badge color="green">Berhasil</Badge> : i.status === 'gagal' ? <Badge color="red" className="whitespace-normal">Gagal: {i.keterangan}</Badge> : <Badge color="amber">Menunggu</Badge>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function CatatHasil({ b, onClose, onDone }) {
  const [gagal, setGagal] = useState([]);
  const [ket, setKet] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const { data } = useLoad(() => b && api.get(`/api/transfer/${b.id}`), [b?.id]);
  useEffect(() => { setGagal([]); setKet(''); setErr(''); }, [b?.id]);
  if (!b) return null;
  const simpan = async () => {
    setBusy(true); setErr('');
    try { await api.post(`/api/transfer/${b.id}/hasil`, { gagal, keterangan: ket || undefined }); onDone(gagal.length); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Catat hasil ${b.nomor}`} subtitle="Sesuaikan dengan laporan hasil eksekusi di CMS bank. Centang item yang gagal; sisanya dianggap berhasil."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant="success" icon={CheckCircle2} loading={busy} onClick={simpan}>{gagal.length ? `Simpan (${gagal.length} gagal)` : 'Semua berhasil'}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        {!data ? <SkeletonRows rows={4} cols={3} /> : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {data.items.map((i) => (
              <label key={i.id} className={cx('flex cursor-pointer items-center gap-3 px-3 py-2.5', gagal.includes(i.id) && 'bg-rose-50/60')}>
                <input type="checkbox" checked={gagal.includes(i.id)} onChange={(e) => setGagal((g) => (e.target.checked ? [...g, i.id] : g.filter((x) => x !== i.id)))} />
                <div className="min-w-0 flex-1"><p className="text-sm text-slate-800">{i.nama}</p><p className="font-mono text-[11px] text-slate-500">{i.kode_bank} · {i.no_rekening}</p></div>
                <p className="num text-sm font-semibold">{money(i.nilai)}</p>
              </label>
            ))}
          </div>
        )}
        {gagal.length > 0 && <Field label="Keterangan gagal"><Input value={ket} onChange={(e) => setKet(e.target.value)} placeholder="mis. Rekening tidak aktif / nama tidak sesuai" /></Field>}
      </div>
    </Modal>
  );
}
