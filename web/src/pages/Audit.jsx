import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Card, Loading, PageHeader, SearchInput, useLoad } from '../components/ui.jsx';
import { waktu } from '../lib/format.js';

export default function Audit() {
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useLoad(() => api.get('/api/audit', { q, limit: 300 }), [q]);
  useLive(() => reload(), 1000);
  return (
    <div className="space-y-4">
      <PageHeader icon={ScrollText} title="Jejak Audit" subtitle="Setiap login, perubahan data, ekspor dan verifikasi tercatat permanen (tidak dapat diubah atau dihapus)" />
      <Card bodyClass="">
        <div className="border-b border-slate-100 p-3"><SearchInput className="max-w-md" value={q} onChange={setQ} placeholder="Cari aksi, pengguna, ID…" /></div>
        {error ? <div className="p-4"><Alert tone="error">{error.message}</Alert></div> : loading && !data ? <Loading /> : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="sticky top-0"><tr><th className="th">Waktu</th><th className="th">Pengguna</th><th className="th">Aksi</th><th className="th">Objek</th><th className="th">Detail</th><th className="th">IP</th></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="td whitespace-nowrap text-xs">{waktu(r.created_at)}</td><td className="td">{r.username || '-'}</td>
                  <td className="td"><Badge color={r.action.includes('gagal') || r.action.includes('hapus') ? 'red' : r.action.includes('login') ? 'slate' : 'blue'}>{r.action}</Badge></td>
                  <td className="td text-xs">{r.entity} {r.entity_id && <span className="text-slate-500">#{String(r.entity_id).slice(0, 40)}</span>}</td>
                  <td className="td max-w-xs truncate font-mono text-[11px] text-slate-500" title={JSON.stringify(r.detail)}>{r.detail ? JSON.stringify(r.detail) : ''}</td>
                  <td className="td text-xs text-slate-500">{r.ip}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
