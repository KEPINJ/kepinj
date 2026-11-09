import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderCheck, FileWarning, Files, HardDrive, History, Paperclip, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Badge, Card, Empty, Modal, PageHeader, Pagination, Progress, SearchInput, Select, SkeletonRows, Stat, Tabs, cx, useLoad } from '../components/ui.jsx';
import LampiranBukti, { KELENGKAPAN } from '../components/LampiranBukti.jsx';
import { StatusBku } from '../components/PersetujuanBku.jsx';
import { BULAN, money, tgl, waktu } from '../lib/format.js';

const AKSI = { unggah: ['green', 'Unggah'], hapus: ['red', 'Hapus'], unduh: ['blue', 'Unduh'] };
const ukuran = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil((b || 0) / 1024)} KB`);

/** Manajemen dokumen bukti: kelengkapan per transaksi BKU, unggah/pratinjau, dan riwayat dokumen. */
export default function Bukti() {
  const { skpdId, tahun } = useApp();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('tab') || 'kelengkapan');
  const [f, setF] = useState({ kelengkapan: sp.get('kelengkapan') || '', status: sp.get('status') || '', bulan: '', jenis: '', kurang: '', q: '' });
  const [page, setPage] = useState(1);
  const [buka, setBuka] = useState(null);
  const meta = useLoad(() => api.get('/api/bukti/meta'), []);
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/bukti', { skpd_id: skpdId, tahun, ...f, page, pageSize: 25 }), [skpdId, tahun, f.kelengkapan, f.status, f.bulan, f.jenis, f.kurang, f.q, page]);
  const riw = useLoad(() => tab === 'riwayat' && skpdId && api.get('/api/bukti/riwayat', { skpd_id: skpdId, limit: 100 }), [tab, skpdId]);
  const set = (k, v) => { setF({ ...f, [k]: v }); setPage(1); if (sp.toString()) setSp({}, { replace: true }); };
  const r = data?.ringkasan;
  const jenisDok = meta.data?.jenis || {};

  return (
    <div className="space-y-4">
      <PageHeader icon={FolderCheck} title="Dokumen Bukti" subtitle="Nota/kuitansi, bukti transfer, SP2D, dokumen pajak, dan pertanggungjawaban yang ditautkan ke nomor BKU" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Kelengkapan dokumen" value={r ? `${r.persen_lengkap}%` : '…'} sub={r && `${r.lengkap} dari ${r.transaksi - r.tidak_wajib} transaksi wajib berdokumen`} icon={CheckCircle2} tone={r?.persen_lengkap >= 95 ? 'green' : 'amber'} trend={r && <Progress value={r.persen_lengkap} className="mt-2" />} />
        <Stat label="Belum lengkap" value={r ? r.belum + r.sebagian : '…'} sub={r && `${r.belum} belum ada · ${r.sebagian} sebagian`} icon={FileWarning} tone={r?.belum ? 'red' : 'green'} />
        <Stat label="Berkas tersimpan" value={r ? r.berkas.toLocaleString('id-ID') : '…'} sub="PDF / JPG / PNG, sidik SHA-256" icon={Files} tone="violet" />
        <Stat label="Ukuran total" value={r ? ukuran(r.ukuran) : '…'} sub={`Maks. ${meta.data?.maks_mb || 5} MB per berkas`} icon={HardDrive} />
      </div>
      {data?.kurang_per_jenis?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500">Dokumen yang paling sering kurang:</span>
          {data.kurang_per_jenis.map((k) => <button key={k.jenis} type="button" onClick={() => set('kurang', f.kurang === k.jenis ? '' : k.jenis)} className={cx('rounded-full', f.kurang === k.jenis && 'ring-2 ring-brand-500')}><Badge color="red">{jenisDok[k.jenis] || k.jenis}: {k.jumlah}</Badge></button>)}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'kelengkapan', label: 'Kelengkapan per transaksi', icon: Paperclip }, { value: 'riwayat', label: 'Riwayat dokumen', icon: History }]} />
      {tab === 'kelengkapan' ? (
        <Card bodyClass="p-0">
          <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Cari uraian / no. bukti" />
            <Select value={f.kelengkapan} onChange={(e) => set('kelengkapan', e.target.value)} options={[{ value: '', label: 'Semua kelengkapan' }, { value: 'kurang', label: 'Belum lengkap' }, ...Object.entries(KELENGKAPAN).map(([value, [, label]]) => ({ value, label }))]} />
            <Select value={f.status} onChange={(e) => set('status', e.target.value)} options={[{ value: '', label: 'Semua status persetujuan' }, { value: 'menunggu', label: 'Menunggu' }, { value: 'disetujui', label: 'Disetujui' }, { value: 'ditolak', label: 'Ditolak' }]} />
            <Select value={f.bulan} onChange={(e) => set('bulan', e.target.value)} options={[{ value: '', label: 'Semua bulan' }, ...BULAN.map((b, i) => ({ value: i + 1, label: b }))]} />
            <Select value={f.jenis} onChange={(e) => set('jenis', e.target.value)} options={[{ value: '', label: 'Semua jenis transaksi' }, ...Object.entries(meta.data?.jenis_bku || {}).map(([value, label]) => ({ value, label }))]} />
          </div>
          {loading && !data ? <SkeletonRows rows={8} cols={6} /> : !data?.rows.length ? <Empty title="Tidak ada transaksi" text="Ubah filter untuk melihat transaksi lain." /> : <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr><th className="th">No.</th><th className="th">Tanggal</th><th className="th">Uraian</th><th className="th text-right">Nilai</th><th className="th">Persetujuan</th><th className="th">Dokumen</th><th className="th">Kekurangan</th></tr></thead>
                <tbody>{data.rows.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setBuka(e)}>
                    <td className="td text-xs">{e.no_urut}</td><td className="td whitespace-nowrap text-xs">{tgl(e.tanggal)}</td>
                    <td className="td text-xs">{e.uraian}<p className="font-mono text-[10px] text-slate-400">{e.no_bukti} · {meta.data?.jenis_bku?.[e.jenis] || e.jenis}</p></td>
                    <td className="td num text-right text-xs">{money(Number(e.penerimaan) || Number(e.pengeluaran))}</td>
                    <td className="td"><StatusBku status={e.status} /></td>
                    <td className="td"><Badge color={KELENGKAPAN[e.dokumen_status]?.[0]}>{KELENGKAPAN[e.dokumen_status]?.[1]}</Badge><p className="mt-0.5 text-[10px] text-slate-400">{e.dokumen?.length || 0} berkas</p></td>
                    <td className="td text-[11px] text-rose-700">{(e.dokumen_kurang || []).map((j) => jenisDok[j] || j).join(', ')}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} />
          </>}
        </Card>
      ) : (
        <Card bodyClass="p-0" title="Riwayat dokumen" subtitle="Setiap unggahan, penghapusan, dan unduhan dicatat permanen (tidak dapat diubah)">
          {!riw.data ? <SkeletonRows rows={8} cols={5} /> : !riw.data.rows.length ? <Empty title="Belum ada riwayat" /> : (
            <table className="w-full text-sm">
              <thead><tr><th className="th">Waktu</th><th className="th">Aksi</th><th className="th">Berkas</th><th className="th">Transaksi</th><th className="th">Oleh</th></tr></thead>
              <tbody>{riw.data.rows.map((x) => (
                <tr key={x.id}><td className="td whitespace-nowrap text-xs">{waktu(x.waktu)}</td><td className="td"><Badge color={AKSI[x.aksi]?.[0]}>{AKSI[x.aksi]?.[1]}</Badge></td>
                  <td className="td text-xs"><span className="font-mono">{x.nama_file}</span><p className="text-[10px] text-slate-500">{jenisDok[x.jenis_dokumen] || x.jenis_dokumen}{x.catatan ? ` · “${x.catatan}”` : ''}</p></td>
                  <td className="td text-xs">No. {x.no_urut}<p className="text-[10px] text-slate-500">{x.uraian}</p></td><td className="td text-xs">{x.oleh_nama || 'Sistem'}</td></tr>))}</tbody>
            </table>
          )}
        </Card>
      )}
      <Modal open={!!buka} size="lg" onClose={() => setBuka(null)} title={buka && `BKU No. ${buka.no_urut} · ${buka.no_bukti}`} subtitle={buka?.uraian}>
        {buka && <LampiranBukti entryId={buka.id} onChanged={reload} />}
      </Modal>
    </div>
  );
}
