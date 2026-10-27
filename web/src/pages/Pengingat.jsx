import { useEffect, useState } from 'react';
import { BellRing, Mail, MessageCircle, Play, Save, Clock, CheckCircle2, AlertTriangle, FlaskConical } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, SkeletonRows, Stat, Tabs, cx, useLoad, useToast } from '../components/ui.jsx';
import { TeksWa } from '../components/ProfilPengingat.jsx';
import { ROLE, waktu, tgl } from '../lib/format.js';

const STATUS = { terkirim: ['green', 'Terkirim'], gagal: ['red', 'Gagal'], simulasi: ['slate', 'Simulasi'] };

export default function Pengingat() {
  const { can } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('penerima');
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  const [lihat, setLihat] = useState(null);
  const { data, loading, reload } = useLoad(() => api.get('/api/pengingat'), []);
  useEffect(() => { if (data) setF({ ...data.pengaturan }); }, [data]);
  if (!can('admin')) return <Alert tone="error">Halaman ini khusus administrator.</Alert>;

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const simpan = async () => {
    setBusy('simpan');
    try { await api.put('/api/pengingat/pengaturan', f); toast('Pengaturan pengingat disimpan'); reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const jalankan = async () => {
    setBusy('jalan');
    try {
      const r = await api.post('/api/pengingat/jalankan', {});
      toast(`Pengingat diproses untuk ${r.pengguna} pengguna: ${r.terkirim} terkirim, ${r.simulasi} simulasi, ${r.gagal} gagal`, r.gagal ? 'error' : 'ok');
      setTab('log'); reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const penerima = data?.penerima || [];
  const punyaKontak = penerima.filter((p) => p.email || p.no_wa).length;

  return (
    <div className="space-y-5">
      <PageHeader icon={BellRing} title="Pengingat WhatsApp & Email" subtitle="Ringkasan harian tenggat pajak, setoran, SPJ, tutup buku, dan dokumen yang menunggu persetujuan dikirim ke tiap pengguna"
        actions={<Button icon={Play} loading={busy === 'jalan'} onClick={jalankan}>Kirim sekarang</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Jadwal harian" value={data ? (data.pengaturan.pengingat_aktif ? `Pukul ${data.pengaturan.pengingat_jam}` : 'Nonaktif') : '…'} sub={data && (data.terakhir ? `Terakhir dijalankan ${tgl(data.terakhir)}` : 'Belum pernah dijalankan')} icon={Clock} tone={data?.pengaturan.pengingat_aktif ? 'brand' : 'amber'} />
        <Stat label="Saluran email" value={data ? (data.kanal.email ? 'Siap' : 'Simulasi') : '…'} sub={data?.kanal.email ? data.pengaturan.smtp_host : 'Isi server SMTP untuk mengirim sungguhan'} icon={Mail} tone={data?.kanal.email ? 'green' : 'amber'} />
        <Stat label="Saluran WhatsApp" value={data ? (data.kanal.wa ? 'Siap' : 'Simulasi') : '…'} sub={data?.kanal.wa ? `Gateway ${data.pengaturan.wa_penyedia}` : 'Isi token gateway WhatsApp'} icon={MessageCircle} tone={data?.kanal.wa ? 'green' : 'amber'} />
        <Stat label="Pesan tercatat" value={data ? data.rekap.terkirim + data.rekap.simulasi + data.rekap.gagal : '…'} sub={data && `${data.rekap.terkirim} terkirim · ${data.rekap.simulasi} simulasi · ${data.rekap.gagal} gagal`} icon={data?.rekap.gagal ? AlertTriangle : CheckCircle2} tone={data?.rekap.gagal ? 'red' : 'green'} />
      </div>
      {data && (!data.kanal.email || !data.kanal.wa) && (
        <Alert tone="info" title="Mode simulasi">Saluran yang belum dikonfigurasi tidak mengirim pesan keluar; isi pesannya tetap dicatat di log sehingga dapat diperiksa. Setelah SMTP atau token WhatsApp diisi, pesan dikirim sungguhan.</Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1" title="Pengaturan" actions={<Button size="sm" icon={Save} loading={busy === 'simpan'} onClick={simpan} disabled={!f}>Simpan</Button>}>
          {!f ? <SkeletonRows rows={6} cols={1} /> : (
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!f.pengingat_aktif} onChange={set('pengingat_aktif')} />Kirim pengingat otomatis setiap hari</label>
              <div className="grid grid-cols-[120px_1fr] gap-3">
                <Field label="Jam kirim"><Input type="time" value={f.pengingat_jam || ''} onChange={set('pengingat_jam')} /></Field>
                <Field label="Isi pesan"><Select value={f.pengingat_tingkat} onChange={set('pengingat_tingkat')} options={[{ value: 'bahaya', label: 'Mendesak saja' }, { value: 'peringatan', label: '+ peringatan' }, { value: 'info', label: 'Semua' }]} /></Field>
              </div>
              <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Mail className="h-4 w-4" />Email (SMTP)</p>
                <div className="grid grid-cols-3 gap-2">
                  <Field className="col-span-2" label="Server"><Input value={f.smtp_host || ''} onChange={set('smtp_host')} placeholder="smtp.instansi.go.id" /></Field>
                  <Field label="Port"><Input value={f.smtp_port || ''} onChange={set('smtp_port')} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Pengguna"><Input value={f.smtp_user || ''} onChange={set('smtp_user')} /></Field>
                  <Field label="Sandi"><Input type="password" value={f.smtp_pass || ''} onChange={set('smtp_pass')} placeholder={data?.pengaturan.smtp_pass ? 'tersimpan' : ''} /></Field>
                </div>
                <Field label="Alamat pengirim"><Input value={f.smtp_from || ''} onChange={set('smtp_from')} placeholder="BKU BKAD <bku@instansi.go.id>" /></Field>
                <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={!!f.smtp_secure} onChange={set('smtp_secure')} />Koneksi SSL/TLS langsung (port 465)</label>
              </div>
              <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><MessageCircle className="h-4 w-4" />WhatsApp gateway</p>
                <Field label="Penyedia"><Select value={f.wa_penyedia} onChange={(e) => setF((x) => ({ ...x, wa_penyedia: e.target.value, wa_url: e.target.value === 'fonnte' ? 'https://api.fonnte.com/send' : x.wa_url }))}
                  options={[{ value: 'fonnte', label: 'Fonnte' }, { value: 'webhook', label: 'Webhook/HTTP umum (JSON)' }]} /></Field>
                <Field label="URL API"><Input value={f.wa_url || ''} onChange={set('wa_url')} /></Field>
                <Field label="Token" hint="Disimpan di server dan tidak ditampilkan kembali"><Input type="password" value={f.wa_token || ''} onChange={set('wa_token')} placeholder={data?.pengaturan.wa_token ? 'tersimpan' : ''} /></Field>
              </div>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2" bodyClass="" title={tab === 'penerima' ? `Penerima (${punyaKontak} dari ${penerima.length} pengguna punya kontak)` : 'Log pengiriman'}
          actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'penerima', label: 'Penerima' }, { value: 'log', label: 'Log', count: data?.log.length || undefined }]} />}>
          {loading && !data ? <SkeletonRows /> : tab === 'penerima' ? (
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full min-w-[640px]">
                <thead className="sticky top-0"><tr><th className="th">Pengguna</th><th className="th">Email</th><th className="th">WhatsApp</th></tr></thead>
                <tbody>{penerima.map((p) => (
                  <tr key={p.id} className={cx(!p.email && !p.no_wa && 'opacity-60')}>
                    <td className="td"><p className="text-sm font-medium text-slate-800">{p.full_name}</p><p className="text-[11px] text-slate-500">{ROLE[p.role]}{p.skpd_kode && ` · ${p.skpd_kode}`}</p></td>
                    <td className="td text-xs">{p.email ? <span className={cx(p.pengingat?.email === false && 'line-through text-slate-400')}>{p.email}</span> : <span className="text-slate-400">-</span>}</td>
                    <td className="td font-mono text-xs">{p.no_wa ? <span className={cx(p.pengingat?.wa === false && 'line-through text-slate-400')}>{p.no_wa}</span> : <span className="font-sans text-slate-400">-</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="px-4 py-3 text-[11px] text-slate-500">Setiap pengguna mengisi kontaknya sendiri lewat ikon lonceng di bawah menu samping. Administrator juga dapat mengisinya di halaman Pengguna.</p>
            </div>
          ) : !data.log.length ? <Empty icon={BellRing} title="Belum ada pesan" text="Klik Kirim sekarang untuk menjalankan pengingat dan melihat isi pesannya." /> : (
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full min-w-[720px]">
                <thead className="sticky top-0"><tr><th className="th">Waktu</th><th className="th">Penerima</th><th className="th">Pesan</th><th className="th">Status</th></tr></thead>
                <tbody>{data.log.map((l) => (
                  <tr key={l.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => setLihat(l)}>
                    <td className="td whitespace-nowrap text-xs">{waktu(l.created_at)}<p className="text-[10px] text-slate-500">{l.pemicu}</p></td>
                    <td className="td text-xs"><p className="font-medium text-slate-800">{l.full_name || '-'}</p><p className="flex items-center gap-1 font-mono text-[11px] text-slate-500">{l.kanal === 'wa' ? <MessageCircle className="h-3 w-3" /> : <Mail className="h-3 w-3" />}{l.tujuan}</p></td>
                    <td className="td text-xs text-slate-700"><p className="line-clamp-1">{l.judul}</p>{l.galat && <p className="text-[11px] text-rose-600">{l.galat}</p>}</td>
                    <td className="td"><Badge color={STATUS[l.status][0]}>{STATUS[l.status][1]}</Badge></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Modal open={!!lihat} onClose={() => setLihat(null)} size="sm" title={lihat?.judul} subtitle={lihat && `${lihat.kanal === 'wa' ? 'WhatsApp' : 'Email'} ke ${lihat.tujuan} · ${waktu(lihat.created_at)}`}>
        {lihat && (<>
          {lihat.status === 'simulasi' && <Alert className="mb-3" tone="info" title="Simulasi"><span className="flex items-center gap-1"><FlaskConical className="h-3.5 w-3.5" />Saluran belum dikonfigurasi; pesan tidak dikirim keluar.</span></Alert>}
          <div className={cx('rounded-xl p-3 text-xs leading-relaxed text-slate-700', lihat.kanal === 'wa' ? 'border border-emerald-200 bg-emerald-50/50' : 'border border-slate-200 bg-slate-50')}>
            <p className="whitespace-pre-wrap">{lihat.kanal === 'wa' ? <TeksWa teks={lihat.isi} /> : lihat.isi}</p>
          </div>
        </>)}
      </Modal>
    </div>
  );
}
