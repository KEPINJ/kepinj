import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, LockOpen, CheckCircle2, AlertTriangle, CircleDashed, ShieldCheck, Hash } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Skeleton, Textarea, cx, useLoad, useToast } from '../components/ui.jsx';
import { compact, rp, waktu } from '../lib/format.js';

function statusBulan(b) {
  if (b.dikunci) return { label: 'Ditutup', color: 'green', icon: Lock, ring: 'ring-emerald-200 bg-emerald-50/60' };
  if (b.bisa_kunci) return b.siap ? { label: 'Siap ditutup', color: 'blue', icon: CheckCircle2, ring: 'ring-brand-300 bg-brand-50/60' } : { label: 'Perlu dicek', color: 'amber', icon: AlertTriangle, ring: 'ring-amber-200 bg-amber-50/50' };
  if (b.pemeriksaan.transaksi) return { label: 'Terbuka', color: 'slate', icon: CircleDashed, ring: 'ring-slate-200' };
  return { label: 'Belum ada transaksi', color: 'slate', icon: CircleDashed, ring: 'ring-slate-200 opacity-70' };
}

export default function TutupBuku() {
  const { skpdId, tahun, can, skpd } = useApp();
  const toast = useToast();
  const { data, reload } = useLoad(() => skpdId && api.get('/api/tutup-buku', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  useLive((e) => (e.type.startsWith('periode') || e.type.startsWith('bku')) && reload(), 800);
  const [aksi, setAksi] = useState(null);
  const [catatan, setCatatan] = useState('');
  const [busy, setBusy] = useState(false);
  const ditutup = data?.bulan.filter((b) => b.dikunci).length || 0;

  const jalankan = async () => {
    setBusy(true);
    try {
      if (aksi.tipe === 'kunci') {
        await api.post('/api/tutup-buku', { skpd_id: skpdId, tahun, bulan: aksi.bulan.bulan, catatan });
        toast(`Buku ${aksi.bulan.nama} ${tahun} ditutup. Transaksi pada bulan ini sekarang terkunci.`);
      } else {
        await api.post('/api/tutup-buku/buka', { skpd_id: skpdId, tahun, bulan: aksi.bulan.bulan, alasan: catatan });
        toast(`Kunci ${aksi.bulan.nama} ${tahun} dibuka`);
      }
      setAksi(null); setCatatan(''); reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={Lock} title="Tutup Buku Bulanan" subtitle={`${skpd?.nama || ''} · Tahun Anggaran ${tahun}`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative grid h-20 w-20 place-items-center">
              <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgb(var(--slate-100))" strokeWidth="3.5" />
                {ditutup > 0 && <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgb(var(--emerald-500))" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(ditutup / 12) * 97.4} 97.4`} />}
              </svg>
              <span className="num text-lg font-bold text-slate-900">{ditutup}/12</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-800">Periode yang sudah ditutup buku</p>
              <p className="mt-1 text-sm text-slate-500">Setelah ditutup, database menolak transaksi baru pada bulan tersebut sehingga BKU, SPJ dan laporan yang sudah disahkan tidak berubah. Penutupan dilakukan berurutan setelah bulan berakhir; kesalahan dibetulkan lewat jurnal koreksi di bulan yang masih terbuka.</p>
            </div>
          </div>
        </Card>
        <Card title="Syarat siap ditutup">
          <ul className="space-y-2 text-sm text-slate-600">
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Semua transaksi sudah diverifikasi dan tidak ada yang ditolak</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Register penutupan kas akhir bulan sudah dibuat</li>
            <li className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />Pajak masa tersebut sebaiknya sudah disetor</li>
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!data ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />) : data.bulan.map((b) => {
          const st = statusBulan(b);
          const p = b.pemeriksaan;
          return (
            <div key={b.bulan} className={cx('card flex flex-col p-4 ring-1 ring-inset', st.ring)}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">{tahun}</p>
                  <p className="text-lg font-bold text-slate-900">{b.nama}</p>
                </div>
                <Badge color={st.color}><st.icon className="h-3 w-3" />{st.label}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-slate-500">Penerimaan</p><p className="num font-semibold text-slate-800">{compact(b.ringkasan.penerimaan)}</p></div>
                <div><p className="text-slate-500">Pengeluaran</p><p className="num font-semibold text-slate-800">{compact(b.ringkasan.pengeluaran)}</p></div>
              </div>
              {!b.dikunci && p.transaksi > 0 && (
                <ul className="mt-3 space-y-1 text-[11px]">
                  <Check ok={p.belum_verifikasi === 0} text={p.belum_verifikasi ? <Link className="underline" to="/bku?verif=belum">{p.belum_verifikasi} belum diverifikasi</Link> : 'Semua terverifikasi'} />
                  <Check ok={p.ditolak === 0} text={p.ditolak ? <Link className="underline" to="/bku?verif=ditolak">{p.ditolak} ditolak verifikator</Link> : 'Tidak ada yang ditolak'} />
                  <Check ok={p.penutupan_kas > 0} text={p.penutupan_kas ? 'Penutupan kas tercatat' : <Link className="underline" to="/penutupan-kas">Penutupan kas belum dibuat</Link>} />
                  <Check ok={p.pajak_belum_setor === 0} warn text={p.pajak_belum_setor ? `Pajak belum setor ${compact(p.pajak_belum_setor)}` : 'Pajak masa ini disetor'} />
                </ul>
              )}
              {b.dikunci && (
                <div className="mt-3 space-y-0.5 text-[11px] text-slate-500">
                  <p>Ditutup {waktu(b.dikunci_at)}</p>
                  <p>oleh {b.oleh} · {b.ringkasan.transaksi} transaksi</p>
                  {b.ringkasan.hash_terakhir && <p className="flex items-center gap-1 truncate font-mono" title={b.ringkasan.hash_terakhir}><Hash className="h-3 w-3" />{b.ringkasan.hash_terakhir.slice(0, 20)}…</p>}
                </div>
              )}
              <div className="mt-auto pt-3">
                {b.bisa_kunci && can('admin', 'bendahara') && <Button size="sm" className="w-full" icon={Lock} onClick={() => { setAksi({ tipe: 'kunci', bulan: b }); setCatatan(''); }}>Tutup buku {b.nama}</Button>}
                {b.bisa_buka && can('admin') && <Button size="sm" variant="secondary" className="w-full" icon={LockOpen} onClick={() => { setAksi({ tipe: 'buka', bulan: b }); setCatatan(''); }}>Buka kunci</Button>}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={!!aksi} onClose={() => setAksi(null)} size="sm"
        title={aksi?.tipe === 'kunci' ? `Tutup buku ${aksi?.bulan.nama} ${tahun}?` : `Buka kunci ${aksi?.bulan.nama} ${tahun}?`}
        footer={<><Button variant="secondary" onClick={() => setAksi(null)}>Batal</Button>
          <Button variant={aksi?.tipe === 'kunci' ? 'primary' : 'danger'} loading={busy} disabled={aksi?.tipe === 'buka' && !catatan.trim()} onClick={jalankan}>
            {aksi?.tipe === 'kunci' ? 'Ya, tutup buku' : 'Buka kunci'}</Button></>}>
        {aksi && (
          <div className="space-y-3">
            {aksi.tipe === 'kunci' ? (<>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                <div><p className="text-xs text-slate-500">Penerimaan</p><p className="num font-semibold">{rp(aksi.bulan.ringkasan.penerimaan)}</p></div>
                <div><p className="text-xs text-slate-500">Pengeluaran</p><p className="num font-semibold">{rp(aksi.bulan.ringkasan.pengeluaran)}</p></div>
              </div>
              {!aksi.bulan.siap && <Alert tone="warn" title="Pemeriksaan belum lengkap">Masih ada transaksi belum diverifikasi/ditolak atau penutupan kas belum dibuat. Anda tetap dapat menutup buku bila sudah yakin.</Alert>}
              <p className="text-sm text-slate-600">Setelah ditutup, transaksi bertanggal {aksi.bulan.nama} {tahun} tidak dapat ditambahkan. Hanya administrator yang dapat membuka kunci.</p>
              <Field label="Catatan (opsional)"><Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. SPJ fungsional disahkan PPKD tgl …" /></Field>
            </>) : (<>
              <Alert tone="warn">Membuka kunci memungkinkan transaksi baru pada bulan ini. Tindakan tercatat di jejak audit.</Alert>
              <Field label="Alasan membuka kunci (wajib)"><Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} /></Field>
            </>)}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Check({ ok, warn, text }) {
  return (
    <li className={cx('flex items-center gap-1.5', ok ? 'text-emerald-700' : warn ? 'text-amber-700' : 'text-rose-600')}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{text}
    </li>
  );
}
