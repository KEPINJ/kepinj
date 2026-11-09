import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, CheckCircle2, ChevronRight, History, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Badge, Button, Card, Empty, PageHeader, Pagination, SkeletonRows, Tabs, cx, useLoad, useToast } from '../components/ui.jsx';
import { TINGKAT } from '../components/NotifBell.jsx';
import { waktu } from '../lib/format.js';

const WARNA = { bahaya: 'red', peringatan: 'amber', info: 'blue' };

/** Pusat notifikasi: semua kondisi yang perlu ditindaklanjuti + riwayat peristiwa (penolakan, login mencurigakan, dll.). */
export default function Notifikasi() {
  const { skpdId, tahun, can } = useApp();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState('aktif');
  const [kat, setKat] = useState('');
  const [hanyaBelum, setHanyaBelum] = useState(false);
  const [page, setPage] = useState(1);
  const aktif = useLoad(() => skpdId && api.get('/api/notifikasi', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  const riwayat = useLoad(() => tab === 'riwayat' && skpdId && api.get('/api/notifikasi/riwayat', { skpd_id: skpdId, kategori: kat, page, limit: 25 }), [tab, skpdId, kat, page]);
  useLive(() => aktif.reload(), 1500);
  const d = aktif.data;
  const items = (d?.items || []).filter((i) => (!kat || i.kategori === kat) && (!hanyaBelum || !i.dibaca));

  const buka = async (n) => {
    if (!n.dibaca) await api.post('/api/notifikasi/baca', { kunci: [n.kunci] }).catch(() => {});
    if (n.link) nav(n.link); else aktif.reload();
  };
  const bacaSemua = async () => { const r = await api.post('/api/notifikasi/baca-semua', { skpd_id: skpdId, tahun }); toast(`${r.dibaca} notifikasi ditandai dibaca`); aktif.reload(); };
  const uji = async () => { await api.post('/api/notifikasi/uji', {}); toast('Notifikasi uji dikirim'); aktif.reload(); };

  return (
    <div className="space-y-4">
      <PageHeader icon={Bell} title="Pusat Notifikasi" subtitle="Transaksi menunggu verifikasi, dokumen belum lengkap, selisih rekonsiliasi, pagu, penutupan kas, penolakan, dan keamanan akun"
        actions={<>
          {can('admin') && <Button variant="secondary" icon={Send} onClick={uji}>Kirim uji</Button>}
          <Button variant="secondary" icon={CheckCheck} disabled={!d?.belum_dibaca} onClick={bacaSemua}>Tandai semua dibaca</Button>
        </>} />
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card p-4"><p className="text-xs text-slate-500">Belum dibaca</p><p className="mt-1 text-2xl font-semibold text-rose-700">{d?.belum_dibaca ?? '…'}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Total notifikasi aktif</p><p className="mt-1 text-2xl font-semibold">{d?.items.length ?? '…'}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Tingkat bahaya</p><p className="mt-1 text-2xl font-semibold text-rose-700">{d?.items.filter((i) => i.tingkat === 'bahaya').length ?? '…'}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Peringatan</p><p className="mt-1 text-2xl font-semibold text-amber-700">{d?.items.filter((i) => i.tingkat === 'peringatan').length ?? '…'}</p></div>
      </div>
      <Tabs value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={[{ value: 'aktif', label: 'Perlu tindakan', icon: Bell }, { value: 'riwayat', label: 'Riwayat peristiwa', icon: History }]} />
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setKat('')} className={cx('rounded-full px-3 py-1 text-xs', !kat ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>Semua kategori</button>
        {Object.entries(d?.kategori || {}).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setKat(k); setPage(1); }} className={cx('rounded-full px-3 py-1 text-xs', kat === k ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {label}{d?.per_kategori?.[k] ? ` · ${d.per_kategori[k]}` : ''}
          </button>
        ))}
        {tab === 'aktif' && <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={hanyaBelum} onChange={(e) => setHanyaBelum(e.target.checked)} />Hanya yang belum dibaca</label>}
      </div>

      {tab === 'aktif' ? (
        <Card bodyClass="p-0">
          {!d ? <SkeletonRows rows={6} cols={3} /> : !items.length ? <Empty icon={CheckCircle2} title="Tidak ada notifikasi" text="Semua tugas pada kategori ini sudah beres." /> : (
            <ul className="divide-y divide-slate-100">
              {items.map((n) => {
                const [Icon, tone] = TINGKAT[n.tingkat] || TINGKAT.info;
                return (
                  <li key={n.kunci}>
                    <button type="button" onClick={() => buka(n)} className={cx('flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50', !n.dibaca && 'bg-brand-50/40')}>
                      <span className={cx('mt-0.5 rounded-lg p-1.5', tone)}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge color={WARNA[n.tingkat]}>{d.kategori[n.kategori] || n.kategori}</Badge>
                          {n.sumber === 'peristiwa' && <span className="text-[11px] text-slate-400">{waktu(n.created_at || n.tanggal)}</span>}
                          {!n.dibaca && <span className="h-2 w-2 rounded-full bg-rose-500" title="Belum dibaca" />}
                        </span>
                        <span className={cx('mt-1 block text-sm text-slate-800', !n.dibaca && 'font-semibold')}>{n.judul}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{n.pesan}</span>
                      </span>
                      {n.link && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-300" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : (
        <Card bodyClass="p-0">
          {riwayat.loading && !riwayat.data ? <SkeletonRows rows={6} cols={3} /> : !riwayat.data?.rows.length ? <Empty title="Belum ada riwayat" text="Peristiwa seperti penolakan transaksi, selisih rekonsiliasi, dan login mencurigakan akan tercatat di sini." /> : <>
            <table className="w-full text-sm">
              <thead><tr><th className="th">Waktu</th><th className="th">Kategori</th><th className="th">Notifikasi</th><th className="th">Status</th></tr></thead>
              <tbody>{riwayat.data.rows.map((n) => (
                <tr key={n.id} className="cursor-pointer hover:bg-slate-50" onClick={() => buka({ ...n, kunci: `n:${n.id}` })}>
                  <td className="td whitespace-nowrap text-xs">{waktu(n.created_at)}</td>
                  <td className="td"><Badge color={WARNA[n.tingkat]}>{d?.kategori?.[n.kategori] || n.kategori}</Badge></td>
                  <td className="td"><p className="font-medium text-slate-800">{n.judul}</p><p className="text-xs text-slate-500">{n.pesan}</p></td>
                  <td className="td text-xs">{n.dibaca ? <span className="text-slate-400">Dibaca</span> : <b className="text-rose-700">Baru</b>}</td>
                </tr>
              ))}</tbody>
            </table>
            <div className="p-3"><Pagination page={page} pageSize={25} total={riwayat.data.total} onChange={setPage} /></div>
          </>}
        </Card>
      )}
    </div>
  );
}
