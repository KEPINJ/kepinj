import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Activity, Database, Radio, Server, Play } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Loading, PageHeader, useLoad, cx } from '../components/ui.jsx';
import { num, waktu } from '../lib/format.js';

export default function Sistem() {
  const { skpdId, tahun, skpd, live } = useApp();
  const status = useLoad(() => api.get('/api/system/status'), []);
  useLive(() => status.reload(), 1500);
  const [chain, setChain] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); try { setChain(await api.get('/api/bku/integritas', { skpd_id: skpdId, tahun })); } finally { setBusy(false); } };
  const s = status.data;
  return (
    <div className="space-y-4">
      <PageHeader icon={ShieldCheck} title="Integritas & Sistem" subtitle="Verifikasi rantai hash BKU dan pantau pipeline data realtime" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Verifikasi integritas BKU" subtitle={`${skpd?.nama} · TA ${tahun}`} actions={<Button icon={Play} loading={busy} onClick={check}>Periksa sekarang</Button>}>
          <p className="text-sm text-slate-600">Setiap entri BKU menyimpan hash SHA-256 dari isinya dan hash entri sebelumnya. Bila satu baris diubah langsung di database, rantai putus dan terdeteksi di sini. Tabel juga dikunci trigger append-only.</p>
          {chain && (chain.valid ? (
            <Alert tone="ok" className="mt-4" title={`Rantai utuh: ${num(chain.jumlah_entri)} entri terverifikasi`}><span className="break-all font-mono text-[11px]">hash terakhir {chain.hash_terakhir}</span></Alert>
          ) : (
            <Alert tone="error" className="mt-4" title={`Ditemukan ${chain.masalah.length} kejanggalan`}>
              <ul className="mt-1 space-y-0.5 text-xs">{chain.masalah.map((m, i) => <li key={i}>{m.no_urut ? `No. ${m.no_urut}: ` : ''}{m.masalah}</li>)}</ul>
            </Alert>
          ))}
        </Card>
        <Card title="Pipeline event realtime" actions={<Badge color={live.connected ? 'green' : 'slate'}><Radio className="h-3 w-3" />{live.connected ? 'terhubung' : 'terputus'}</Badge>}>
          {!s ? <Loading /> : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                <Server className="h-5 w-5 text-brand-700" />
                <div className="flex-1"><p className="font-medium">{s.event.mode === 'kafka' ? 'Apache Kafka' : s.event.mode === 'demo' ? 'Bus di browser (mode demo)' : 'Bus internal (tanpa Kafka)'}</p><p className="text-xs text-slate-500">{s.event.topic ? `topic ${s.event.topic}` : s.event.mode === 'demo' ? 'versi server memakai Apache Kafka' : 'set KAFKA_BROKERS untuk mengaktifkan Kafka'}</p></div>
                <Badge color={s.event.connected ? 'green' : 'red'}>{s.event.connected ? 'aktif' : 'mati'}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[['Diterbitkan', s.event.published], ['Diproses consumer', s.event.consumed], ['Antrean outbox', s.outbox.antre]].map(([l, v]) => <div key={l} className="rounded-lg border border-slate-200 p-2"><p className="num text-lg font-semibold">{num(v)}</p><p className="text-[11px] text-slate-500">{l}</p></div>)}
              </div>
              <p className="text-xs text-slate-500">Event terakhir: {waktu(s.event.lastEventAt)} · klien realtime: {s.event.sseClients}</p>
              {s.event.lastError && <Alert tone="warn">{s.event.lastError}</Alert>}
              <div className="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-600">
                <p className="mb-1 font-semibold text-slate-700">Alur data</p>
                <p>Transaksi → PostgreSQL (ACID, satu transaksi dengan tabel outbox) → relay → Kafka topic <code>bku.events</code> → consumer proyeksi (ringkasan harian) & consumer realtime → browser (Server-Sent Events).</p>
              </div>
            </div>
          )}
        </Card>
      </div>
      {s && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Basis data" subtitle={s.database.versi.split(' on ')[0]} actions={<Badge><Database className="h-3 w-3" />{s.database.ukuran}</Badge>}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Entri BKU', s.jumlah.bku], ['Data pajak', s.jumlah.pajak], ['Dataset', s.jumlah.dataset], ['Jejak audit', s.jumlah.audit]].map(([l, v]) => <div key={l} className="rounded-lg bg-slate-50 p-3"><p className="num text-lg font-semibold">{num(v)}</p><p className="text-[11px] text-slate-500">{l}</p></div>)}
            </div>
          </Card>
          <Card title="Partisi tabel BKU per tahun" subtitle="Data besar tetap cepat: kueri hanya membaca partisi tahun terkait" bodyClass="max-h-64 overflow-y-auto p-0">
            <table className="w-full text-sm"><thead><tr><th className="th">Partisi</th><th className="th text-right">Perkiraan baris</th><th className="th text-right">Ukuran</th></tr></thead>
              <tbody>{s.partisi.map((p) => <tr key={p.partisi}><td className="td font-mono text-xs">{p.partisi}</td><td className="td num text-right">{num(Math.max(0, p.perkiraan_baris))}</td><td className="td text-right">{p.ukuran}</td></tr>)}</tbody></table>
          </Card>
        </div>
      )}
    </div>
  );
}
