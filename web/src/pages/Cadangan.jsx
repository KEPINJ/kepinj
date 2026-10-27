import { useEffect, useRef, useState } from 'react';
import { DatabaseBackup, Plus, Download, ShieldCheck, Upload, RotateCcw, Trash2, Clock, HardDrive, CheckCircle2, AlertTriangle, Save } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, SkeletonRows, Stat, cx, useLoad, useToast } from '../components/ui.jsx';
import { num, tgl, waktu } from '../lib/format.js';

const PEMICU = { manual: ['blue', 'Manual'], otomatis: ['green', 'Otomatis'], 'pra-pulih': ['amber', 'Sebelum pemulihan'], unggahan: ['violet', 'Unggahan'] };
const ukuran = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB` : `${Math.round((b || 0) / 1024)} KB`);

export default function Cadangan() {
  const { can } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [cek, setCek] = useState({});
  const [pulih, setPulih] = useState(null);
  const [f, setF] = useState(null);
  const file = useRef(null);
  const { data, loading, reload } = useLoad(() => api.get('/api/cadangan'), []);
  useEffect(() => { if (data) setF({ ...data.pengaturan }); }, [data]);
  if (!can('admin')) return <Alert tone="error">Halaman ini khusus administrator.</Alert>;

  const daftar = data?.daftar || [];
  const otomatis = daftar.filter((d) => d.pemicu === 'otomatis');
  const buat = async () => {
    setBusy('buat');
    try { const m = await api.post('/api/cadangan', {}); toast(`Cadangan ${m.nama} dibuat (${num(m.baris)} baris, ${ukuran(m.ukuran)})`); reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const verifikasi = async (d) => {
    setCek((c) => ({ ...c, [d.nama]: { proses: true } }));
    try { const r = await api.post(`/api/cadangan/${d.nama}/verifikasi`, {}); setCek((c) => ({ ...c, [d.nama]: r })); toast(r.utuh ? `${d.nama} utuh (${num(r.baris_berkas)} baris, sidik cocok)` : `${d.nama} bermasalah: ${r.galat || 'sidik tidak cocok'}`, r.utuh ? 'ok' : 'error'); } catch (e) { setCek((c) => ({ ...c, [d.nama]: null })); toast(e.message, 'error'); }
  };
  const unggah = async (e) => {
    const fl = e.target.files?.[0]; e.target.value = '';
    if (!fl) return;
    setBusy('unggah');
    try { const m = await api.upload('/api/cadangan/unggah', fl); toast(`${fl.name} diterima sebagai ${m.nama}`); reload(); } catch (er) { toast(er.message, 'error'); } finally { setBusy(''); }
  };
  const hapus = async (d) => {
    if (!window.confirm(`Hapus berkas cadangan ${d.nama}?`)) return;
    try { await api.del(`/api/cadangan/${d.nama}`); toast('Berkas cadangan dihapus'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const simpan = async () => {
    try { await api.put('/api/cadangan/pengaturan', f); toast('Jadwal pencadangan disimpan'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={DatabaseBackup} title="Pencadangan Data" subtitle="Salinan lengkap basis data (BKU, pajak, SPJ, master, pengguna, jejak audit) dalam satu berkas terkompresi bersidik SHA-256"
        actions={<>
          <input ref={file} type="file" accept=".gz,application/gzip" className="hidden" onChange={unggah} />
          <Button variant="secondary" icon={Upload} loading={busy === 'unggah'} onClick={() => file.current?.click()}>Unggah cadangan</Button>
          <Button icon={Plus} loading={busy === 'buat'} onClick={buat}>Cadangkan sekarang</Button>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cadangan terakhir" value={daftar[0] ? tgl(daftar[0].dibuat.slice(0, 10)) : data ? 'Belum ada' : '…'} sub={daftar[0] && `${waktu(daftar[0].dibuat)} · ${PEMICU[daftar[0].pemicu]?.[1] || daftar[0].pemicu}`} icon={CheckCircle2} tone={daftar[0] ? 'green' : 'amber'} />
        <Stat label="Jadwal otomatis" value={data ? (data.pengaturan.cadangan_aktif ? `Pukul ${data.pengaturan.cadangan_jam}` : 'Nonaktif') : '…'} sub={data && `Menyimpan ${data.pengaturan.cadangan_simpan} cadangan otomatis terbaru`} icon={Clock} tone={data?.pengaturan.cadangan_aktif ? 'brand' : 'amber'} />
        <Stat label="Jumlah berkas" value={data ? daftar.length : '…'} sub={data && `${otomatis.length} otomatis · ${daftar.length - otomatis.length} lainnya`} icon={DatabaseBackup} tone="violet" />
        <Stat label="Ruang terpakai" value={data ? ukuran(data.total_ukuran) : '…'} sub={data && <span className="break-all font-mono text-[10px]">{data.folder}</span>} icon={HardDrive} tone="brand" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Jadwal & retensi" actions={<Button size="sm" icon={Save} onClick={simpan} disabled={!f}>Simpan</Button>}>
          {!f ? <SkeletonRows rows={3} cols={1} /> : (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!f.cadangan_aktif} onChange={(e) => setF({ ...f, cadangan_aktif: e.target.checked })} />Cadangkan otomatis setiap hari</label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Jam"><Input type="time" value={f.cadangan_jam || ''} onChange={(e) => setF({ ...f, cadangan_jam: e.target.value })} /></Field>
                <Field label="Simpan (berkas)"><Input type="number" min={1} max={90} value={f.cadangan_simpan || ''} onChange={(e) => setF({ ...f, cadangan_simpan: e.target.value })} /></Field>
              </div>
              <p className="text-[11px] text-slate-500">Cadangan otomatis yang lebih lama dihapus bergilir. Cadangan manual, unggahan, dan pra-pemulihan tidak ikut dihapus.</p>
              <Alert tone="warn" title="Simpan juga di luar server">Unduh cadangan secara berkala ke penyimpanan lain (NAS, cloud instansi) agar data aman bila server rusak.</Alert>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2" bodyClass="" title="Berkas cadangan">
          {loading && !data ? <SkeletonRows /> : !daftar.length ? <Empty icon={DatabaseBackup} title="Belum ada cadangan" text="Buat cadangan pertama sekarang. Selanjutnya cadangan dibuat otomatis sesuai jadwal." action={<Button icon={Plus} onClick={buat}>Cadangkan sekarang</Button>} /> : (
            <div className="divide-y divide-slate-100">
              {daftar.map((d) => {
                const c = cek[d.nama];
                return (
                  <div key={d.nama} className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-medium text-slate-800">{d.nama}</span>
                        <Badge color={PEMICU[d.pemicu]?.[0] || 'slate'}>{PEMICU[d.pemicu]?.[1] || d.pemicu}</Badge>
                        {c && !c.proses && (c.utuh ? <Badge color="green"><ShieldCheck className="h-3 w-3" />Utuh</Badge> : <Badge color="red"><AlertTriangle className="h-3 w-3" />{c.galat || 'Sidik tidak cocok'}</Badge>)}
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {waktu(d.dibuat)} · {ukuran(d.ukuran)}{d.baris != null && ` · ${num(d.baris)} baris dari ${d.tabel} tabel`}{d.bku != null && ` · ${num(d.bku)} entri BKU`}{d.oleh && ` · oleh ${d.oleh}`}{d.asal && ` · asal ${d.asal}`}
                      </p>
                      {d.sha256 && <p className="truncate font-mono text-[10px] text-slate-400" title={d.sha256}>SHA-256 {d.sha256}</p>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ghost" icon={ShieldCheck} loading={c?.proses} onClick={() => verifikasi(d)}>Verifikasi</Button>
                      <Button size="sm" variant="secondary" icon={Download} onClick={() => download(`/api/cadangan/${d.nama}/unduh`).catch((e) => toast(e.message, 'error'))}>Unduh</Button>
                      <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setPulih(d)}>Pulihkan</Button>
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label="Hapus" onClick={() => hapus(d)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Pulihkan d={pulih} onClose={() => setPulih(null)} onDone={(r) => { toast(`Data dipulihkan: ${num(r.baris)} baris. ${r.integritas_utuh ? 'Rantai hash BKU utuh.' : 'Periksa integritas BKU!'}`, r.integritas_utuh ? 'ok' : 'error'); reload(); }} />
    </div>
  );
}

function Pulihkan({ d, onClose, onDone }) {
  const [ketik, setKetik] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hasil, setHasil] = useState(null);
  useEffect(() => { setKetik(''); setErr(''); setHasil(null); }, [d?.nama]);
  if (!d) return null;
  const jalankan = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/api/cadangan/${d.nama}/pulihkan`, { konfirmasi: ketik }); setHasil(r); onDone(r); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Pulihkan dari cadangan" subtitle={`${d.nama} · ${waktu(d.dibuat)}`}
      footer={hasil ? <Button onClick={() => window.location.reload()}>Muat ulang aplikasi</Button> : <><Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button variant="danger" icon={RotateCcw} loading={busy} disabled={ketik !== 'PULIHKAN'} onClick={jalankan}>Pulihkan sekarang</Button></>}>
      {hasil ? (
        <div className="space-y-3">
          <Alert tone={hasil.integritas_utuh ? 'ok' : 'error'} title={hasil.integritas_utuh ? 'Pemulihan selesai' : 'Pemulihan selesai, tetapi rantai hash bermasalah'}>
            {num(hasil.baris)} baris dari {hasil.tabel} tabel dipulihkan. Kondisi sebelum pemulihan disimpan sebagai <span className="font-mono">{hasil.cadangan_pra_pulih}</span>.
          </Alert>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {hasil.integritas.map((i) => (
              <div key={`${i.skpd_id}-${i.tahun}`} className={cx('rounded-lg px-3 py-2 text-xs ring-1 ring-inset', i.valid ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200')}>
                SKPD #{i.skpd_id} · {i.tahun}<br /><b>{i.valid ? 'Rantai hash valid' : 'Rantai rusak'}</b>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {err && <Alert tone="error">{err}</Alert>}
          <Alert tone="error" title="Seluruh data saat ini akan diganti">Transaksi, pajak, SPJ, pengguna, dan jejak audit kembali ke kondisi saat cadangan dibuat. Sistem otomatis membuat cadangan kondisi sekarang lebih dulu, lalu memverifikasi rantai hash BKU setelah pemulihan.</Alert>
          <ul className="space-y-1 text-xs text-slate-600">
            <li>• Isi berkas diperiksa utuh (gzip dan sidik SHA-256) sebelum data diganti.</li>
            <li>• Pemulihan berjalan dalam satu transaksi; bila gagal di tengah, data saat ini tidak berubah.</li>
            <li>• Pengguna lain sebaiknya keluar dulu dari aplikasi.</li>
          </ul>
          <Field label="Ketik PULIHKAN untuk melanjutkan"><Input value={ketik} onChange={(e) => setKetik(e.target.value.toUpperCase())} placeholder="PULIHKAN" /></Field>
        </div>
      )}
    </Modal>
  );
}
