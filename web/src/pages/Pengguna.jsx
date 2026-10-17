import { useState } from 'react';
import { Users, Plus, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Select, useLoad, useToast } from '../components/ui.jsx';
import { ROLE, waktu } from '../lib/format.js';

export default function Pengguna() {
  const { skpdList } = useApp();
  const toast = useToast();
  const { data, loading, reload } = useLoad(() => api.get('/api/users'), []);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.post('/api/users', edit); toast('Pengguna tersimpan'); setEdit(null); reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <PageHeader icon={Users} title="Pengguna" subtitle="Hak akses berbasis peran: Admin, Bendahara, Verifikator, Pimpinan" actions={<Button icon={Plus} onClick={() => setEdit({ role: 'bendahara', active: true })}>Tambah pengguna</Button>} />
      <Card bodyClass="overflow-x-auto">
        {loading ? <Loading /> : (
          <table className="w-full min-w-[700px] text-sm">
            <thead><tr><th className="th">Username</th><th className="th">Nama</th><th className="th">Peran</th><th className="th">SKPD</th><th className="th">Login terakhir</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>{data.rows.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="td font-mono text-xs">{u.username}</td><td className="td">{u.full_name}</td><td className="td"><Badge color="blue">{ROLE[u.role]}</Badge></td>
                <td className="td text-xs">{u.skpd_kode || '-'}</td><td className="td text-xs">{waktu(u.last_login_at)}</td>
                <td className="td">{u.active ? <Badge color="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}</td>
                <td className="td"><button type="button" className="p-1 text-slate-400 hover:text-brand-700" onClick={() => setEdit({ ...u, password: '' })} aria-label="Ubah"><Pencil className="h-4 w-4" /></button></td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Ubah pengguna' : 'Tambah pengguna'} size="sm" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Batal</Button><Button loading={busy} onClick={save}>Simpan</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Username"><Input value={edit.username || ''} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
            <Field label="Nama lengkap"><Input value={edit.full_name || ''} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label="Peran"><Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} options={Object.entries(ROLE).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="SKPD"><Select value={edit.skpd_id || ''} onChange={(e) => setEdit({ ...edit, skpd_id: e.target.value })} placeholder="—" options={skpdList.map((s) => ({ value: s.id, label: s.nama }))} /></Field>
            <Field label={edit.id ? 'Password baru (kosongkan bila tidak diganti)' : 'Password'} hint="Minimal 8 karakter"><Input type="password" value={edit.password || ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
            {edit.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Akun aktif</label>}
          </div>
        )}
      </Modal>
    </div>
  );
}
