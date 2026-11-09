import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Stamp, FileStack, FileCheck2, CheckCircle2, XCircle, Clock, Inbox, ArrowRight, Settings2, BookOpen, Paperclip, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Pagination, SearchInput, Select, SkeletonRows, Stat, Tabs, Textarea, useLoad, useToast, cx } from '../components/ui.jsx';
import { StatusBku } from '../components/PersetujuanBku.jsx';
import { KELENGKAPAN } from '../components/LampiranBukti.jsx';
import { AlurTahap, KeputusanModal } from '../components/Persetujuan.jsx';
import { ROLE, rp, tgl, waktu } from '../lib/format.js';

const ST = { proses: ['amber', 'Dalam proses'], disetujui: ['green', 'Disetujui'], ditolak: ['red', 'Ditolak'], tanpa: ['slate', 'Dibatalkan'] };

export default function Persetujuan() {
  const { can } = useApp();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const objek = sp.get('tab') === 'dokumen' ? 'dokumen' : 'bku';
  const [alurOpen, setAlurOpen] = useState(false);
  const { data: cfg, reload } = useLoad(() => api.get('/api/persetujuan', { skpd_id: 0 }).catch(() => null), []);
  return (
    <div className="space-y-5">
      <PageHeader icon={Stamp} title="Verifikasi & Persetujuan Berjenjang" subtitle="Bendahara mencatat dan mengunggah bukti → Verifikator (PPK-SKPD) memeriksa → Pimpinan (PA/KPA) menyetujui sesuai kewenangan → transaksi tervalidasi masuk rekap & laporan"
        actions={can('admin') && <Button variant="secondary" icon={Settings2} onClick={() => setAlurOpen(true)}>Alur & kewenangan</Button>} />
      <Tabs value={objek} onChange={(v) => setSp(v === 'bku' ? {} : { tab: v })} tabs={[{ value: 'bku', label: 'Transaksi BKU', icon: BookOpen }, { value: 'dokumen', label: 'SPP & SPJ', icon: FileStack }]} />
      {objek === 'bku' ? <PersetujuanTransaksi /> : <PersetujuanDokumen />}
      <AlurModal open={alurOpen} data={cfg} onClose={() => setAlurOpen(false)} onSaved={() => { toast('Alur persetujuan disimpan. Berlaku untuk pengajuan berikutnya.'); reload(); }} />
    </div>
  );
}

const FILTER_BKU = [{ value: 'saya', label: 'Perlu tindakan saya' }, { value: 'menunggu', label: 'Semua menunggu' }, { value: 'disetujui', label: 'Disetujui' }, { value: 'ditolak', label: 'Ditolak' }, { value: 'dikoreksi', label: 'Dikoreksi' }];

function PersetujuanTransaksi() {
  const { skpdId, tahun, user, can } = useApp();
  const toast = useToast();
  const [filter, setFilter] = useState(can('bendahara') ? 'menunggu' : 'saya');
  const [dokumen, setDokumen] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(new Set());
  const [massal, setMassal] = useState(null);
  const [putus, setPutus] = useState(null);
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/persetujuan/bku', { skpd_id: skpdId, tahun, filter, dokumen, q, page, pageSize: 25 }), [skpdId, tahun, filter, dokumen, q, page]);
  useLive((e) => ['persetujuan.updated', 'bku.entry.created', 'lampiran.updated'].includes(e.type) && reload(), 600);
  useEffect(() => { setSel(new Set()); }, [filter, dokumen, q, page, skpdId]);
  const h = data?.hitung || {};
  const items = data?.items || [];
  const bisaPilih = items.filter((i) => i.giliran_saya);
  return (<>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Menunggu keputusan Anda" value={data ? h.saya : '…'} sub={user && `Sebagai ${ROLE[user.role]}`} icon={Inbox} tone={h.saya ? 'amber' : 'green'} />
      <Stat label="Di verifikator (PPK)" value={data ? h.di_verifikator : '…'} sub="Pemeriksaan bukti" icon={Clock} tone="brand" />
      <Stat label="Di pimpinan (PA/KPA)" value={data ? h.di_pimpinan : '…'} sub="Nilai di atas ambang" icon={Stamp} tone="violet" />
      <Stat label="Disetujui" value={data ? h.disetujui : '…'} sub={`TA ${tahun}`} icon={CheckCircle2} tone="green" />
      <Stat label="Ditolak" value={data ? h.ditolak : '…'} sub={h.menunggu_dokumen_kurang ? `${h.menunggu_dokumen_kurang} menunggu, dokumen kurang` : 'Dikembalikan ke bendahara'} icon={XCircle} tone="red" />
    </div>
    <Card bodyClass="">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} tabs={FILTER_BKU.map((f) => ({ ...f, count: f.value === 'saya' ? h.saya || undefined : f.value === 'menunggu' ? h.menunggu || undefined : undefined }))} />
        <Select className="!w-auto" value={dokumen} onChange={(e) => { setDokumen(e.target.value); setPage(1); }} placeholder="Semua dokumen" options={[{ value: 'kurang', label: 'Dokumen belum lengkap' }, { value: 'lengkap', label: 'Dokumen lengkap' }]} />
        <SearchInput className="min-w-[200px] flex-1" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Cari uraian atau no. bukti" />
      </div>
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-800">{sel.size} transaksi dipilih</span>
          <Button size="sm" variant="success" icon={CheckCircle2} onClick={() => setMassal({ setuju: true })}>Setujui semua</Button>
          <Button size="sm" variant="secondary" icon={XCircle} onClick={() => setMassal({ setuju: false })}>Tolak semua</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Batal pilih</Button>
        </div>
      )}
      {loading && !data ? <SkeletonRows rows={6} cols={5} /> : !items.length ? (
        <Empty icon={filter === 'saya' ? CheckCircle2 : Inbox} title={filter === 'saya' ? 'Tidak ada transaksi yang menunggu Anda' : 'Tidak ada transaksi'} text="Transaksi baru dari bendahara otomatis masuk ke antrean verifikator, lalu ke pimpinan bila nilainya di atas ambang kewenangan." />
      ) : (
        <div className="divide-y divide-slate-100">
          {bisaPilih.length > 0 && (
            <label className="flex items-center gap-2 px-4 py-2 text-xs text-slate-600"><input type="checkbox" checked={bisaPilih.every((i) => sel.has(i.menunggu.id))} onChange={(e) => setSel(e.target.checked ? new Set(bisaPilih.map((i) => i.menunggu.id)) : new Set())} />Pilih semua yang dapat saya putuskan di halaman ini</label>
          )}
          {items.map((i) => {
            const nilai = Number(i.pengeluaran) || Number(i.penerimaan);
            const kurang = ['sebagian', 'belum'].includes(i.dokumen_status);
            return (
              <div key={i.id} className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 gap-3">
                  {i.giliran_saya ? <input type="checkbox" className="mt-1" checked={sel.has(i.menunggu.id)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(i.menunggu.id) : s.delete(i.menunggu.id); setSel(s); }} aria-label={`Pilih BKU ${i.no_urut}`} /> : <span className="w-[13px]" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs text-slate-500">No. {i.no_urut} · {tgl(i.tanggal)} · {i.no_bukti}</span>
                      <StatusBku status={i.status} tahap={i.tahap} />
                      <Badge color={KELENGKAPAN[i.dokumen_status]?.[0]}><Paperclip className="h-3 w-3" />{i.jumlah_lampiran} · {KELENGKAPAN[i.dokumen_status]?.[1]}</Badge>
                      {i.putaran > 1 && <Badge>Pengajuan ke-{i.putaran}</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-800">{i.uraian}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{data.jenis?.[i.jenis] || i.jenis}{i.kode_rekening ? ` · ${i.kode_rekening}` : ''}{i.rekanan_nama ? ` · ${i.rekanan_nama}` : ''} · dicatat {i.dibuat_oleh}</p>
                    <AlurTahap className="mt-1.5" tahap={i.tahap_alur} />
                    {kurang && i.status === 'menunggu' && <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="h-3 w-3" />Dokumen kurang: {(i.dokumen_kurang || []).map((d) => d.replace(/_/g, ' ')).join(', ')}. Persetujuan ditahan sampai lengkap.</p>}
                    {i.status === 'ditolak' && i.catatan && <p className="mt-1 text-[11px] text-rose-700">Alasan: “{i.catatan}”</p>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <p className="num w-36 text-right text-sm font-semibold text-slate-900">{rp(nilai)}</p>
                  {i.giliran_saya ? (<>
                    <Button size="sm" variant="success" icon={CheckCircle2} disabled={kurang} title={kurang ? 'Dokumen bukti belum lengkap' : undefined} onClick={() => setPutus({ tahap: i.menunggu, setuju: true, judul: `BKU No. ${i.no_urut}`, sub: rp(nilai) })}>Setujui</Button>
                    <Button size="sm" variant="secondary" icon={XCircle} onClick={() => setPutus({ tahap: i.menunggu, setuju: false, judul: `BKU No. ${i.no_urut}`, sub: rp(nilai) })}>Tolak</Button>
                  </>) : <Link to={`/bku?id=${i.id}`}><Button size="sm" variant="ghost" icon={ArrowRight}>Buka</Button></Link>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {data && <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} />}
    </Card>
    <KeputusanModal aksi={putus} onClose={() => setPutus(null)} onDone={(r, ok) => { toast(ok ? (r.status === 'disetujui' ? 'Transaksi disetujui dan tervalidasi' : 'Disetujui, diteruskan ke pimpinan') : 'Ditolak. Bendahara menerima notifikasi beserta alasannya.'); reload(); }} />
    <MassalModal aksi={massal} ids={[...sel]} onClose={() => setMassal(null)} onDone={(r) => { toast(`${r.berhasil.length} diputuskan${r.gagal.length ? `, ${r.gagal.length} gagal (${r.gagal[0].pesan})` : ''}`, r.gagal.length ? 'warn' : 'ok'); setSel(new Set()); reload(); }} />
  </>);
}

function MassalModal({ aksi, ids, onClose, onDone }) {
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setCatatan(''); setErr(''); }, [aksi]);
  if (!aksi) return null;
  const kirim = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post('/api/persetujuan/massal', { ids, setuju: aksi.setuju, catatan: catatan.trim() || undefined }); onDone(r); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open size="sm" onClose={onClose} title={`${aksi.setuju ? 'Setujui' : 'Tolak'} ${ids.length} transaksi`} subtitle="Setiap transaksi diputuskan terpisah; yang dokumennya belum lengkap akan dilewati"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant={aksi.setuju ? 'success' : 'danger'} loading={busy} disabled={!aksi.setuju && !catatan.trim()} onClick={kirim}>{aksi.setuju ? 'Setujui' : 'Tolak'}</Button></>}>
      {err && <Alert tone="error" className="mb-2">{err}</Alert>}
      <Field label={aksi.setuju ? 'Catatan (opsional)' : 'Alasan penolakan'}><Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} /></Field>
    </Modal>
  );
}

function PersetujuanDokumen() {
  const { skpdId, tahun, user } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('saya');
  const [putus, setPutus] = useState(null);
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/persetujuan', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  useLive((e) => (e.type === 'persetujuan.updated' || e.type === 'spp.updated') && reload(), 500);

  const items = data?.items || [];
  const hitung = useMemo(() => ({
    saya: items.filter((i) => i.giliran_saya).length,
    proses: items.filter((i) => i.status === 'proses').length,
    disetujui: items.filter((i) => i.status === 'disetujui').length,
    ditolak: items.filter((i) => i.status === 'ditolak').length,
  }), [items]);
  const rows = items.filter((i) => (tab === 'saya' ? i.giliran_saya : tab === 'proses' ? i.status === 'proses' : tab === 'selesai' ? ['disetujui', 'ditolak'].includes(i.status) : true));

  const judul = (i) => (i.objek === 'spp' ? i.detail?.nomor_spp : i.detail?.nama);

  return (
    <div className="space-y-5">

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Menunggu keputusan Anda" value={data ? hitung.saya : '…'} sub={user && `Sebagai ${ROLE[user.role]}`} icon={Inbox} tone={hitung.saya ? 'amber' : 'green'} />
        <Stat label="Dalam proses" value={data ? hitung.proses : '…'} sub="Semua tahap belum selesai" icon={Clock} tone="brand" />
        <Stat label="Disetujui" value={data ? hitung.disetujui : '…'} sub={`TA ${tahun}`} icon={CheckCircle2} tone="green" />
        <Stat label="Ditolak" value={data ? hitung.ditolak : '…'} sub="Dikembalikan ke bendahara" icon={XCircle} tone="red" />
      </div>

      <Card bodyClass="" title="Kotak persetujuan" actions={<Tabs value={tab} onChange={setTab} tabs={[
        { value: 'saya', label: 'Perlu tindakan', count: hitung.saya || undefined }, { value: 'proses', label: 'Dalam proses', count: hitung.proses || undefined },
        { value: 'selesai', label: 'Selesai' }, { value: 'semua', label: 'Semua' }]} />}>
        {loading && !data ? <SkeletonRows rows={5} cols={4} /> : !rows.length ? (
          <Empty icon={tab === 'saya' ? CheckCircle2 : Inbox} title={tab === 'saya' ? 'Tidak ada yang menunggu Anda' : 'Belum ada dokumen'}
            text={tab === 'saya' ? 'Dokumen yang perlu Anda verifikasi atau setujui akan muncul di sini, lengkap dengan notifikasi.' : 'SPP yang diajukan bendahara dan SPJ fungsional yang diajukan untuk pengesahan tampil di sini.'} />
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((i) => {
              const Icon = i.objek === 'spp' ? FileStack : FileCheck2;
              const nilai = i.objek === 'spp' ? Number(i.detail?.nilai) : i.detail?.belanja;
              const tolak = i.tahap.find((t) => t.status === 'tolak');
              return (
                <div key={`${i.objek}:${i.objek_id}`} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center">
                  <div className={`hidden h-10 w-10 shrink-0 place-items-center rounded-xl sm:grid ${i.objek === 'spp' ? 'bg-brand-50 text-brand-700' : 'bg-violet-50 text-violet-700'}`}><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge color={i.objek === 'spp' ? 'blue' : 'violet'}>{i.objek === 'spp' ? `SPP ${i.detail?.jenis?.replace('_', ' ') || ''}` : 'SPJ fungsional'}</Badge>
                      <span className="font-mono text-xs text-slate-700">{judul(i)}</span>
                      <Badge color={ST[i.status]?.[0]}>{ST[i.status]?.[1]}</Badge>
                      {i.putaran > 1 && <Badge color="slate">Pengajuan ke-{i.putaran}</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-800">
                      {i.objek === 'spp' ? i.detail?.uraian : `${i.detail?.transaksi || 0} transaksi, belanja ${rp(i.detail?.belanja)}`}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {i.objek === 'spp' ? `${tgl(i.detail?.tanggal_spp)} · diajukan ${i.detail?.dibuat_oleh || ''}${i.detail?.rekanan_nama ? ` · ${i.detail.rekanan_nama}` : ''}` : `Diajukan ${waktu(i.tahap[0]?.created_at)}`}
                      {' · '}aktivitas terakhir {waktu(i.terakhir)}
                    </p>
                    <AlurTahap className="mt-2" tahap={i.tahap} />
                    {tolak?.catatan && <p className="mt-1 text-[11px] text-rose-700">Alasan ditolak: “{tolak.catatan}”</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {nilai > 0 && <p className="num w-36 text-right text-sm font-semibold text-slate-900">{rp(nilai)}</p>}
                    {i.giliran_saya ? (<>
                      <Button size="sm" variant="success" icon={CheckCircle2} onClick={() => setPutus({ tahap: i.menunggu, setuju: true, judul: judul(i), sub: nilai ? rp(nilai) : '' })}>Setujui</Button>
                      <Button size="sm" variant="secondary" icon={XCircle} onClick={() => setPutus({ tahap: i.menunggu, setuju: false, judul: judul(i), sub: nilai ? rp(nilai) : '' })}>Tolak</Button>
                    </>) : <Link to={i.objek === 'spp' ? '/spp' : '/spj'}><Button size="sm" variant="ghost" icon={ArrowRight}>Buka</Button></Link>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <KeputusanModal aksi={putus} onClose={() => setPutus(null)} onDone={(r, ok) => {
        toast(ok ? (r.status === 'disetujui' ? 'Disetujui pada tahap terakhir. Dokumen siap diproses.' : 'Disetujui dan diteruskan ke tahap berikutnya') : 'Ditolak. Bendahara menerima alasan penolakan.');
        reload();
      }} />
    </div>
  );
}

const PERAN = [{ value: 'verifikator', label: 'Verifikator (PPK-SKPD)' }, { value: 'pimpinan', label: 'Pimpinan (PA/KPA)' }, { value: 'admin', label: 'Administrator' }];

function AlurModal({ open, data, onClose, onSaved }) {
  const alur = data?.alur;
  const [opsi, setOpsi] = useState({});
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open && alur) { setF(JSON.parse(JSON.stringify(alur))); setOpsi({ ambang: data.bku_ambang_pimpinan, aktif: data.alur_bku_aktif !== false, wajib: data.persetujuan_wajib_dokumen !== false }); setErr(''); } }, [open, alur, data]);
  if (!open || !f) return null;
  const ubah = (objek, i, k, v) => setF((x) => ({ ...x, [objek]: x[objek].map((t, j) => (j === i ? { ...t, [k]: v } : t)) }));
  const simpan = async () => {
    setBusy(true); setErr('');
    try { await api.put('/api/persetujuan/alur', { alur_spp: f.spp, alur_spj: f.spj, alur_bku: f.bku, bku_ambang_pimpinan: Number(opsi.ambang) || 0, alur_bku_aktif: opsi.aktif, persetujuan_wajib_dokumen: opsi.wajib }); onSaved(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Alur persetujuan" subtitle="Urutan tahap untuk pengajuan baru. Dokumen yang sedang berjalan memakai alur saat diajukan."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={simpan}>Simpan</Button></>}>
      <div className="space-y-5">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={opsi.aktif} onChange={(e) => setOpsi({ ...opsi, aktif: e.target.checked })} />Transaksi BKU wajib melalui persetujuan</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={opsi.wajib} onChange={(e) => setOpsi({ ...opsi, wajib: e.target.checked })} />Tahan persetujuan bila dokumen bukti belum lengkap</label>
          <Field className="sm:col-span-2" label="Ambang kewenangan pimpinan (PA/KPA)" hint="Transaksi di bawah nilai ini cukup disetujui verifikator; di atasnya wajib persetujuan pimpinan. Isi 0 agar semua transaksi sampai ke pimpinan.">
            <MoneyInput value={opsi.ambang} onChange={(v) => setOpsi({ ...opsi, ambang: v })} />
          </Field>
        </div>
        {[['bku', 'Transaksi BKU (setelah dicatat bendahara)'], ['spp', 'SPP (sebelum SPM diterbitkan)'], ['spj', 'SPJ fungsional (sebelum tutup buku)']].filter(([k]) => f[k]).map(([k, l]) => (
          <div key={k}>
            <p className="mb-2 text-sm font-semibold text-slate-800">{l}</p>
            <div className="space-y-2">
              {f[k].map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
                  <Input className="flex-1" value={t.label} onChange={(e) => ubah(k, i, 'label', e.target.value)} />
                  <Select className="!w-52" value={t.peran} onChange={(e) => ubah(k, i, 'peran', e.target.value)} options={PERAN} />
                  <button type="button" disabled={f[k].length < 2} className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30" aria-label="Hapus tahap" onClick={() => setF((x) => ({ ...x, [k]: x[k].filter((_, j) => j !== i) }))}><XCircle className="h-4 w-4" /></button>
                </div>
              ))}
              {f[k].length < 4 && <Button size="sm" variant="ghost" onClick={() => setF((x) => ({ ...x, [k]: [...x[k], { peran: 'pimpinan', label: 'Persetujuan' }] }))}>+ Tambah tahap</Button>}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
