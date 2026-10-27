import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Stamp, FileStack, FileCheck2, CheckCircle2, XCircle, Clock, Inbox, ArrowRight, Settings2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Empty, Input, Modal, PageHeader, Select, SkeletonRows, Stat, Tabs, useLoad, useToast } from '../components/ui.jsx';
import { AlurTahap, KeputusanModal } from '../components/Persetujuan.jsx';
import { ROLE, rp, tgl, waktu } from '../lib/format.js';

const ST = { proses: ['amber', 'Dalam proses'], disetujui: ['green', 'Disetujui'], ditolak: ['red', 'Ditolak'], tanpa: ['slate', 'Dibatalkan'] };

export default function Persetujuan() {
  const { skpdId, tahun, user, can } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('saya');
  const [putus, setPutus] = useState(null);
  const [alurOpen, setAlurOpen] = useState(false);
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
      <PageHeader icon={Stamp} title="Persetujuan Berjenjang" subtitle="SPP dan SPJ fungsional melewati verifikasi PPK-SKPD lalu persetujuan PA/KPA sebelum diproses lebih lanjut"
        actions={can('admin') && <Button variant="secondary" icon={Settings2} onClick={() => setAlurOpen(true)}>Alur persetujuan</Button>} />

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
      <AlurModal open={alurOpen} alur={data?.alur} onClose={() => setAlurOpen(false)} onSaved={() => { toast('Alur persetujuan disimpan. Berlaku untuk pengajuan berikutnya.'); reload(); }} />
    </div>
  );
}

const PERAN = [{ value: 'verifikator', label: 'Verifikator (PPK-SKPD)' }, { value: 'pimpinan', label: 'Pimpinan (PA/KPA)' }, { value: 'admin', label: 'Administrator' }];

function AlurModal({ open, alur, onClose, onSaved }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open && alur) { setF(JSON.parse(JSON.stringify(alur))); setErr(''); } }, [open, alur]);
  if (!open || !f) return null;
  const ubah = (objek, i, k, v) => setF((x) => ({ ...x, [objek]: x[objek].map((t, j) => (j === i ? { ...t, [k]: v } : t)) }));
  const simpan = async () => {
    setBusy(true); setErr('');
    try { await api.put('/api/persetujuan/alur', { alur_spp: f.spp, alur_spj: f.spj }); onSaved(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Alur persetujuan" subtitle="Urutan tahap untuk pengajuan baru. Dokumen yang sedang berjalan memakai alur saat diajukan."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={simpan}>Simpan</Button></>}>
      <div className="space-y-5">
        {err && <Alert tone="error">{err}</Alert>}
        {[['spp', 'SPP (sebelum SPM diterbitkan)'], ['spj', 'SPJ fungsional (sebelum tutup buku)']].map(([k, l]) => (
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
