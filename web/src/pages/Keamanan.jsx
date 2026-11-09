import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, Save, Unlock, KeyRound, LogOut, Activity, Database, Users, MonitorSmartphone, CheckCircle2, XCircle, AlertTriangle, Copy } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Pagination, Progress, SearchInput, Select, SkeletonRows, Stat, Tabs, cx, useLoad, useToast } from '../components/ui.jsx';
import { SERIES } from '../lib/palette.js';
import { ROLE, waktu } from '../lib/format.js';

const LABEL = {
  login_maks_gagal: ['Maks. percobaan login gagal', 'kali'], login_kunci_menit: ['Lama akun dikunci', 'menit'], sesi_idle_menit: ['Session timeout (tidak aktif)', 'menit'],
  sesi_maks_jam: ['Umur maksimum sesi', 'jam'], password_min: ['Panjang minimum password', 'karakter'], password_kedaluwarsa_hari: ['Masa berlaku password (0 = tanpa batas)', 'hari'],
  password_riwayat: ['Tidak boleh mengulang N password terakhir', 'password'], lampiran_maks_mb: ['Ukuran maksimum dokumen bukti', 'MB'],
};
const AKSI_DATA = { INSERT: ['green', 'Tambah'], UPDATE: ['amber', 'Ubah'], DELETE: ['red', 'Hapus'] };
const browser = (ua = '') => (/Mobile|Android|iPhone/i.test(ua) ? 'Ponsel' : /Edg/i.test(ua) ? 'Edge' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : ua.slice(0, 20) || '-');

/** Keamanan aplikasi: kebijakan login/sesi/password, akun terkunci, sesi aktif, monitoring aktivitas, dan audit perubahan data. */
export default function Keamanan() {
  const { can } = useApp();
  const [sp, setSp] = useSearchParams();
  const admin = can('admin');
  const tab = sp.get('tab') || (admin ? 'kebijakan' : 'aktivitas');
  const tabs = [
    ...(admin ? [{ value: 'kebijakan', label: 'Kebijakan', icon: ShieldCheck }, { value: 'pengguna', label: 'Akun pengguna', icon: Users }, { value: 'sesi', label: 'Sesi aktif', icon: MonitorSmartphone }] : []),
    { value: 'aktivitas', label: 'Monitoring aktivitas', icon: Activity }, { value: 'audit', label: 'Audit perubahan data', icon: Database },
  ];
  if (!can('admin', 'pimpinan')) return <Alert tone="error">Halaman ini khusus administrator dan pimpinan.</Alert>;
  return (
    <div className="space-y-4">
      <PageHeader icon={ShieldCheck} title="Keamanan & Aktivitas" subtitle="Pembatasan login, session timeout, manajemen password, sesi, monitoring aktivitas, dan audit perubahan data" />
      <Tabs value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} tabs={tabs} />
      {tab === 'kebijakan' && admin && <Kebijakan />}
      {tab === 'pengguna' && admin && <Pengguna />}
      {tab === 'sesi' && admin && <Sesi />}
      {tab === 'aktivitas' && <Aktivitas />}
      {tab === 'audit' && <AuditData />}
    </div>
  );
}

function Kebijakan() {
  const toast = useToast();
  const { data, reload } = useLoad(() => api.get('/api/keamanan'), []);
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ ...data.pengaturan }); }, [data]);
  const simpan = async () => {
    try { await api.put('/api/keamanan/pengaturan', f); toast('Kebijakan keamanan disimpan dan langsung berlaku'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  if (!data || !f) return <SkeletonRows rows={8} cols={3} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Skor pengendalian" value={`${data.skor}%`} sub={`${data.periksa.filter((p) => p.ok).length} dari ${data.periksa.length} kontrol terpenuhi`} icon={ShieldCheck} tone={data.skor >= 90 ? 'green' : 'amber'} trend={<Progress value={data.skor} className="mt-2" />} />
        <Stat label="Pengguna aktif" value={data.pengguna.aktif} sub={`${data.pengguna.admin} admin · ${data.pengguna.wajib_ganti} wajib ganti password`} icon={Users} />
        <Stat label="Akun terkunci" value={data.pengguna.terkunci} sub={`${data.login_gagal_24j} login gagal 24 jam terakhir`} icon={AlertTriangle} tone={data.pengguna.terkunci ? 'red' : 'green'} />
        <Stat label="Sesi aktif" value={data.sesi_aktif} sub={`${data.pengguna.kedaluwarsa} password kedaluwarsa`} icon={MonitorSmartphone} tone="violet" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Daftar periksa pengendalian keamanan">
          <ul className="space-y-2">{data.periksa.map((p) => (
            <li key={p.kunci} className="flex gap-2.5 rounded-lg border border-slate-100 p-2.5">
              {p.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
              <div><p className="text-sm font-medium text-slate-800">{p.judul}</p><p className="text-xs text-slate-500">{p.rinci}</p></div>
            </li>))}</ul>
        </Card>
        <Card title="Kebijakan login, sesi & password" actions={<Button size="sm" icon={Save} onClick={simpan}>Simpan</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(LABEL).map(([k, [l, satuan]]) => (
              <Field key={k} label={l} hint={`${data.batas[k][0]}–${data.batas[k][1]} ${satuan}`}>
                <Input type="number" min={data.batas[k][0]} max={data.batas[k][1]} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              </Field>))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">Password wajib berisi huruf dan angka serta tidak boleh memuat username. Perubahan session timeout berlaku seketika untuk semua sesi.</p>
        </Card>
      </div>
    </div>
  );
}

function Pengguna() {
  const toast = useToast();
  const { data, reload } = useLoad(() => api.get('/api/users'), []);
  const [reset, setReset] = useState(null);
  const buka = async (u) => { try { await api.post(`/api/users/${u.id}/buka-kunci`, {}); toast(`Akun ${u.username} dibuka`); reload(); } catch (e) { toast(e.message, 'error'); } };
  const resetPw = async (u) => {
    if (!window.confirm(`Reset password ${u.username}? Semua sesinya akan diakhiri.`)) return;
    try { const r = await api.post(`/api/users/${u.id}/reset-password`, {}); setReset(r); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const cabut = async (u) => { try { const r = await api.post('/api/keamanan/sesi/cabut', { user_id: u.id }); toast(`${r.dicabut} sesi ${u.username} diakhiri`); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Card bodyClass="overflow-x-auto p-0">
      {!data ? <SkeletonRows rows={8} cols={6} /> : (
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr><th className="th">Pengguna</th><th className="th">Peran</th><th className="th">Status akun</th><th className="th">Password diubah</th><th className="th">Login terakhir</th><th className="th">Sesi</th><th className="th">Tindakan</th></tr></thead>
          <tbody>{data.rows.map((u) => {
            const kunci = u.terkunci_sampai && new Date(u.terkunci_sampai) > new Date();
            return (
              <tr key={u.id} className={cx('hover:bg-slate-50', kunci && 'bg-rose-50/50')}>
                <td className="td"><p className="font-medium">{u.full_name}</p><p className="font-mono text-[11px] text-slate-500">{u.username}</p></td>
                <td className="td"><Badge color="blue">{ROLE[u.role]}</Badge></td>
                <td className="td text-xs">
                  {!u.active ? <Badge>Nonaktif</Badge> : kunci ? <Badge color="red">Terkunci s.d. {new Date(u.terkunci_sampai).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</Badge> : <Badge color="green">Aktif</Badge>}
                  {u.gagal_login > 0 && <p className="mt-0.5 text-[11px] text-rose-700">{u.gagal_login}× gagal login</p>}
                  {u.wajib_ganti_password && <p className="mt-0.5 text-[11px] text-amber-700">Wajib ganti password</p>}
                </td>
                <td className="td text-xs">{waktu(u.password_diubah_at)}</td><td className="td text-xs">{waktu(u.last_login_at)}</td>
                <td className="td text-xs">{u.sesi_aktif || 0}</td>
                <td className="td"><div className="flex flex-wrap gap-1">
                  {kunci && <Button size="sm" variant="secondary" icon={Unlock} onClick={() => buka(u)}>Buka kunci</Button>}
                  <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => resetPw(u)}>Reset</Button>
                  {u.sesi_aktif > 0 && <Button size="sm" variant="ghost" icon={LogOut} onClick={() => cabut(u)}>Akhiri sesi</Button>}
                </div></td>
              </tr>);
          })}</tbody>
        </table>
      )}
      <Modal open={!!reset} size="sm" onClose={() => setReset(null)} title="Password sementara" subtitle={reset && `Untuk ${reset.username}; wajib diganti saat login berikutnya`}
        footer={<Button onClick={() => setReset(null)}>Selesai</Button>}>
        {reset && <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-3"><code className="flex-1 text-lg font-semibold tracking-wider">{reset.password_sementara}</code>
          <Button size="sm" variant="secondary" icon={Copy} onClick={() => navigator.clipboard?.writeText(reset.password_sementara)}>Salin</Button></div>}
        <p className="mt-2 text-xs text-slate-500">Sampaikan secara langsung kepada pengguna. Password ini tidak ditampilkan lagi.</p>
      </Modal>
    </Card>
  );
}

function Sesi() {
  const toast = useToast();
  const { data, reload } = useLoad(() => api.get('/api/keamanan/sesi'), []);
  const cabut = async (s) => { try { await api.post('/api/keamanan/sesi/cabut', { ref: s.ref }); toast('Sesi diakhiri'); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Card bodyClass="overflow-x-auto p-0" title="Sesi login 30 hari terakhir" subtitle="Sesi disimpan di server; setiap permintaan diperiksa sehingga sesi yang dicabut langsung tidak berlaku">
      {!data ? <SkeletonRows rows={8} cols={6} /> : (
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr><th className="th">Pengguna</th><th className="th">Perangkat</th><th className="th">Mulai</th><th className="th">Aktif terakhir</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody>{data.rows.map((s) => (
            <tr key={`${s.ref}${s.dibuat_at}`} className={cx(!s.aktif && 'text-slate-400')}>
              <td className="td"><p className="font-medium">{s.full_name}</p><p className="text-[11px]">{s.username} · {ROLE[s.role]}</p></td>
              <td className="td text-xs">{browser(s.user_agent)}<p className="font-mono text-[11px]">{s.ip}</p></td>
              <td className="td text-xs">{waktu(s.dibuat_at)}</td><td className="td text-xs">{waktu(s.terakhir_aktif)}</td>
              <td className="td">{s.ini ? <Badge color="blue">Sesi ini</Badge> : s.aktif ? <Badge color="green">Aktif</Badge> : <Badge>{s.dicabut_at ? (s.alasan_cabut || 'Dicabut').replaceAll('_', ' ') : 'Kedaluwarsa'}</Badge>}</td>
              <td className="td">{s.aktif && !s.ini && <Button size="sm" variant="ghost" icon={LogOut} onClick={() => cabut(s)}>Akhiri</Button>}</td>
            </tr>))}</tbody>
        </table>
      )}
    </Card>
  );
}

function Aktivitas() {
  const [hari, setHari] = useState(7);
  const { data } = useLoad(() => api.get('/api/monitoring-aktivitas', { hari }), [hari]);
  if (!data) return <SkeletonRows rows={8} cols={4} />;
  const r = data.ringkasan;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Select value={hari} onChange={(e) => setHari(Number(e.target.value))} options={[7, 14, 30, 90].map((h) => ({ value: h, label: `${h} hari terakhir` }))} className="!w-44" /></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Login berhasil" value={r.login} icon={Users} tone="green" />
        <Stat label="Login gagal" value={r.gagal} icon={AlertTriangle} tone={r.gagal ? 'red' : 'green'} />
        <Stat label="Aktivitas tercatat" value={r.aktivitas} icon={Activity} />
        <Stat label="Sesi aktif" value={r.sesi_aktif} icon={MonitorSmartphone} tone="violet" />
        <Stat label="Akun terkunci" value={r.akun_terkunci} icon={ShieldCheck} tone={r.akun_terkunci ? 'red' : 'green'} />
      </div>
      <Card title="Aktivitas harian">
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={data.harian.map((h) => ({ ...h, label: h.tanggal.slice(5).split('-').reverse().join('/') }))} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="rgb(var(--slate-100))" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'rgb(var(--slate-300))' }} tick={{ fontSize: 11, fill: 'rgb(var(--slate-500))' }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--slate-500))' }} width={32} />
              <Tooltip cursor={{ fill: 'rgb(var(--slate-100))' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="aktivitas" name="Aktivitas" stackId="a" fill={SERIES[0]} maxBarSize={28} />
              <Bar dataKey="login" name="Login" stackId="a" fill={SERIES[1]} maxBarSize={28} />
              <Bar dataKey="gagal" name="Login gagal" stackId="a" fill={SERIES[3]} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Percobaan login gagal" bodyClass="p-0">
          {!data.login_gagal.length ? <Empty icon={CheckCircle2} title="Tidak ada login gagal" /> : <table className="w-full text-xs"><thead><tr><th className="th">Username</th><th className="th">IP</th><th className="th text-right">Jumlah</th><th className="th">Terakhir</th></tr></thead>
            <tbody>{data.login_gagal.map((g, i) => <tr key={i} className={cx(g.jumlah >= 5 && 'bg-rose-50/60')}><td className="td font-mono">{g.username || '?'}</td><td className="td font-mono">{g.ip}</td><td className="td num text-right font-semibold">{g.jumlah}</td><td className="td">{waktu(g.terakhir)}</td></tr>)}</tbody></table>}
        </Card>
        <Card title="Aktivitas per pengguna" bodyClass="p-0">
          <table className="w-full text-xs"><thead><tr><th className="th">Pengguna</th><th className="th text-right">Aktivitas</th><th className="th">Terakhir</th></tr></thead>
            <tbody>{data.per_pengguna.map((p) => <tr key={p.username}><td className="td font-mono">{p.username}</td><td className="td num text-right">{p.jumlah}</td><td className="td">{waktu(p.terakhir)}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Jenis aktivitas terbanyak" bodyClass="p-0">
          <table className="w-full text-xs"><tbody>{data.per_aksi.map((a) => <tr key={a.action}><td className="td font-mono">{a.action}</td><td className="td num text-right">{a.jumlah}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Perubahan data terbaru" bodyClass="p-0">
          <table className="w-full text-xs"><tbody>{data.perubahan_data.map((d) => <tr key={d.id}><td className="td">{waktu(d.waktu)}</td><td className="td"><Badge color={AKSI_DATA[d.aksi]?.[0]}>{AKSI_DATA[d.aksi]?.[1]}</Badge></td><td className="td font-mono">{d.tabel} #{d.kunci}</td><td className="td">{d.username || 'sistem'}</td></tr>)}</tbody></table>
        </Card>
      </div>
    </div>
  );
}

function AuditData() {
  const [f, setF] = useState({ tabel: '', aksi: '', q: '' });
  const [page, setPage] = useState(1);
  const [buka, setBuka] = useState(null);
  const { data } = useLoad(() => api.get('/api/audit-data', { ...f, page, limit: 30 }), [f.tabel, f.aksi, f.q, page]);
  const set = (k, v) => { setF({ ...f, [k]: v }); setPage(1); };
  const tampil = (v) => (v == null ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <Card bodyClass="p-0" title="Audit perubahan data" subtitle="Dicatat otomatis oleh trigger basis data: siapa, kapan, nilai sebelum dan sesudah (tidak dapat diubah)">
      <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-3">
        <Select value={f.tabel} onChange={(e) => set('tabel', e.target.value)} options={[{ value: '', label: 'Semua tabel' }, ...(data?.tabel || []).map((t) => ({ value: t.tabel, label: `${t.tabel} (${t.n})` }))]} />
        <Select value={f.aksi} onChange={(e) => set('aksi', e.target.value)} options={[{ value: '', label: 'Semua aksi' }, ...Object.entries(AKSI_DATA).map(([value, [, label]]) => ({ value, label }))]} />
        <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Cari kunci / pengguna / isi" />
      </div>
      {!data ? <SkeletonRows rows={10} cols={5} /> : !data.rows.length ? <Empty title="Belum ada perubahan data" /> : <>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Waktu</th><th className="th">Tabel</th><th className="th">Aksi</th><th className="th">Pengguna</th><th className="th">Kolom berubah</th></tr></thead>
          <tbody>{data.rows.map((d) => [
            <tr key={d.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setBuka(buka === d.id ? null : d.id)}>
              <td className="td whitespace-nowrap text-xs">{waktu(d.waktu)}</td><td className="td font-mono text-xs">{d.tabel} #{d.kunci}</td>
              <td className="td"><Badge color={AKSI_DATA[d.aksi]?.[0]}>{AKSI_DATA[d.aksi]?.[1]}</Badge></td><td className="td text-xs">{d.username || 'sistem'}</td>
              <td className="td text-xs text-slate-600">{d.berubah ? d.berubah.map((b) => b.kolom).join(', ') : d.aksi === 'INSERT' ? 'data baru' : 'data dihapus'}</td>
            </tr>,
            buka === d.id && <tr key={`${d.id}-d`}><td colSpan={5} className="bg-slate-50 px-4 py-2">
              {d.berubah ? <table className="w-full text-xs"><thead><tr><th className="th">Kolom</th><th className="th">Sebelum</th><th className="th">Sesudah</th></tr></thead>
                <tbody>{d.berubah.map((b) => <tr key={b.kolom}><td className="td font-mono">{b.kolom}</td><td className="td break-all text-rose-700">{tampil(b.sebelum)}</td><td className="td break-all text-emerald-700">{tampil(b.sesudah)}</td></tr>)}</tbody></table>
                : <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(d.sesudah || d.sebelum, null, 2)}</pre>}
            </td></tr>,
          ])}</tbody>
        </table>
        <Pagination page={page} pageSize={30} total={data.total} onChange={setPage} />
      </>}
    </Card>
  );
}
