import { useState } from 'react';
import { Database, Plus, Pencil, Trash2, Upload } from 'lucide-react';
import { STATUS_PTKP } from '@shared/tax.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Field, Input, Loading, Modal, MoneyInput, PageHeader, SearchInput, Select, Tabs, useLoad, useToast, Empty } from '../components/ui.jsx';
import { money } from '../lib/format.js';

const ENT = {
  rekanan: { label: 'Rekanan', key: 'id', cols: [['nama', 'Nama'], ['jenis', 'Jenis'], ['npwp', 'NPWP'], ['bank', 'Bank'], ['no_rekening', 'No. rekening']],
    fields: [['nama', 'Nama rekanan', 'text', true], ['jenis', 'Jenis', ['badan', 'orang_pribadi']], ['npwp', 'NPWP (16 digit)'], ['nik', 'NIK'], ['nitku', 'NITKU (22 digit)'], ['alamat', 'Alamat'], ['bank', 'Bank'], ['no_rekening', 'No. rekening']], roles: ['admin', 'bendahara'] },
  pegawai: { label: 'Pegawai', key: 'id', cols: [['nip', 'NIP'], ['nama', 'Nama'], ['golongan', 'Gol.'], ['status_ptkp', 'PTKP'], ['npwp', 'NPWP'], ['jabatan', 'Jabatan']],
    fields: [['nama', 'Nama', 'text', true], ['nip', 'NIP'], ['nik', 'NIK'], ['npwp', 'NPWP'], ['status_ptkp', 'Status PTKP', STATUS_PTKP], ['golongan', 'Golongan'], ['jabatan', 'Jabatan'], ['jenis', 'Jenis', ['pns', 'pppk', 'non_asn']]], roles: ['admin', 'bendahara'], scoped: true },
  rekening: { label: 'Kode rekening', key: 'kode', cols: [['kode', 'Kode'], ['nama', 'Uraian'], ['jenis', 'Jenis']],
    fields: [['kode', 'Kode rekening', 'text', true], ['nama', 'Uraian', 'text', true], ['jenis', 'Jenis', ['belanja', 'pendapatan', 'pembiayaan', 'non_anggaran']], ['level', 'Level', 'number']], roles: ['admin'] },
  anggaran: { label: 'Anggaran (DPA)', key: 'id', cols: [['tahun', 'Tahun'], ['skpd_kode', 'SKPD'], ['kode_rekening', 'Kode rekening'], ['rekening_nama', 'Uraian'], ['pagu', 'Pagu', 'money']],
    fields: [['tahun', 'Tahun', 'number', true], ['kode_rekening', 'Kode rekening', 'text', true], ['pagu', 'Pagu', 'money', true]], roles: ['admin'], scoped: true },
  'objek-pajak': { label: 'Kode objek pajak', key: 'kode', cols: [['kode', 'Kode'], ['jenis_pajak', 'Jenis'], ['nama', 'Uraian'], ['tarif', 'Tarif %'], ['coretax_form', 'Form Coretax']],
    fields: [['kode', 'Kode objek pajak', 'text', true], ['jenis_pajak', 'Jenis pajak', ['PPH21', 'PPH22', 'PPH23', 'PPH4A2', 'PPN']], ['nama', 'Uraian', 'text', true], ['tarif', 'Tarif (%)', 'number'], ['dpp_persen', 'DPP (%)', 'number'], ['coretax_form', 'Form Coretax', ['BPPU', 'BP21', 'BPMP', 'PPN']], ['keterangan', 'Keterangan']], roles: ['admin'] },
  skpd: { label: 'SKPD', key: 'id', cols: [['kode', 'Kode'], ['nama', 'Nama'], ['npwp', 'NPWP'], ['bendahara_nama', 'Bendahara']],
    fields: [['kode', 'Kode SKPD', 'text', true], ['nama', 'Nama SKPD', 'text', true], ['alamat', 'Alamat'], ['npwp', 'NPWP (16 digit)'], ['nitku', 'NITKU (22 digit)'], ['kepala_nama', 'Pengguna Anggaran'], ['kepala_nip', 'NIP Pengguna Anggaran'], ['bendahara_nama', 'Bendahara pengeluaran'], ['bendahara_nip', 'NIP Bendahara']], roles: ['admin'] },
};

export default function Master() {
  const { can, skpdId, tahun } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('rekanan');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [imp, setImp] = useState(false);
  const cfg = ENT[tab];
  const { data, loading, error, reload } = useLoad(() => api.get(`/api/master/${tab}`, { q, skpd_id: cfg.scoped ? skpdId : undefined, tahun: tab === 'anggaran' ? tahun : undefined }), [tab, q, skpdId, tahun]);
  const writable = can(...cfg.roles);
  const del = async (r) => {
    if (!window.confirm('Hapus data ini?')) return;
    try { await api.del(`/api/master/${tab}/${encodeURIComponent(r[cfg.key])}`); toast('Data dihapus'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="space-y-4">
      <PageHeader icon={Database} title="Data Master" subtitle="Referensi yang dipakai di seluruh aplikasi"
        actions={writable && <><Button variant="secondary" icon={Upload} onClick={() => setImp(true)}>Impor Excel</Button><Button icon={Plus} onClick={() => setEdit({})}>Tambah</Button></>} />
      <Tabs value={tab} onChange={(v) => { setTab(v); setQ(''); }} tabs={Object.entries(ENT).map(([value, c]) => ({ value, label: c.label }))} />
      {tab === 'objek-pajak' && <Alert tone="info">Kode objek pajak dipakai saat ekspor Coretax. Cocokkan dengan daftar kode objek pajak Coretax terbaru dari DJP, lalu ubah di sini bila ada pembaruan.</Alert>}
      <Card bodyClass="">
        <div className="border-b border-slate-100 p-3"><SearchInput value={q} onChange={setQ} className="max-w-md" /></div>
        {error ? <div className="p-4"><Alert tone="error">{error.message}</Alert></div> : loading && !data ? <Loading /> : !data?.rows.length ? <Empty /> : (
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full min-w-[720px]">
              <thead className="sticky top-0"><tr>{cfg.cols.map(([k, l, t]) => <th key={k} className={`th ${t === 'money' ? 'text-right' : ''}`}>{l}</th>)}<th className="th w-20" /></tr></thead>
              <tbody>{data.rows.map((r) => (
                <tr key={r[cfg.key]} className="hover:bg-slate-50">
                  {cfg.cols.map(([k, , t]) => <td key={k} className={`td ${t === 'money' ? 'num text-right' : ''}`}>{t === 'money' ? money(r[k]) : k === 'jenis' || k === 'jenis_pajak' || k === 'coretax_form' ? <Badge>{r[k]}</Badge> : String(r[k] ?? '')}</td>)}
                  <td className="td whitespace-nowrap text-right">{writable && <>
                    <button type="button" className="p-1 text-slate-400 hover:text-brand-700" onClick={() => setEdit(r)} aria-label="Ubah"><Pencil className="h-4 w-4" /></button>
                    <button type="button" className="p-1 text-slate-400 hover:text-rose-600" onClick={() => del(r)} aria-label="Hapus"><Trash2 className="h-4 w-4" /></button></>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <EditModal tab={tab} cfg={cfg} row={edit} onClose={() => setEdit(null)} onDone={reload} />
      <ImportModal open={imp} tab={tab} cfg={cfg} onClose={() => setImp(false)} onDone={reload} />
    </div>
  );
}

function EditModal({ tab, cfg, row, onClose, onDone }) {
  const { skpdId } = useApp();
  const toast = useToast();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  if (!row) return null;
  const isNew = row[cfg.key] === undefined;
  const cur = { ...row, ...f };
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, ...(cfg.scoped && isNew ? { skpd_id: skpdId } : {}) };
      if (isNew) await api.post(`/api/master/${tab}`, body); else await api.put(`/api/master/${tab}/${encodeURIComponent(row[cfg.key])}`, body);
      toast('Data tersimpan'); setF({}); onDone(); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={() => { setF({}); onClose(); }} title={`${isNew ? 'Tambah' : 'Ubah'} ${cfg.label.toLowerCase()}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={save}>Simpan</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {cfg.fields.map(([k, l, t, req]) => (
          <Field key={k} label={`${l}${req ? ' *' : ''}`}>
            {Array.isArray(t) ? <Select value={cur[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder="—" options={t} />
              : t === 'money' ? <MoneyInput value={Number(cur[k] || 0)} onChange={(v) => setF({ ...f, [k]: v })} />
                : <Input type={t === 'number' ? 'number' : 'text'} value={cur[k] ?? ''} disabled={!isNew && k === cfg.key && cfg.key !== 'id'} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
          </Field>
        ))}
      </div>
    </Modal>
  );
}

/** Impor master dari Excel: unggah -> petakan kolom -> simpan massal (upsert untuk kode). */
function ImportModal({ open, tab, cfg, onClose, onDone }) {
  const { skpdId } = useApp();
  const toast = useToast();
  const [ds, setDs] = useState(null);
  const [rows, setRows] = useState([]);
  const [map, setMap] = useState({});
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    try {
      const r = await api.upload('/api/data/upload', file);
      const d = r.datasets[0];
      const full = await api.get(`/api/data/datasets/${d.id}`, { limit: 100000 });
      setDs(d); setRows(full.rows);
      setMap(Object.fromEntries(cfg.fields.map(([k, l]) => [k, d.columns.find((c) => c.toLowerCase().replace(/[^a-z]/g, '').includes(k.replace(/_/g, '')) || c.toLowerCase() === l.toLowerCase()) || ''])));
    } catch (e) { toast(e.message, 'error'); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const items = rows.map((r) => Object.fromEntries(Object.entries(map).filter(([, c]) => c).map(([k, c]) => [k, k === 'pagu' ? Number(String(r[c]).replace(/[^\d,-]/g, '').replace(',', '.')) : r[c]])))
        .map((x) => (cfg.scoped ? { ...x, skpd_id: skpdId } : x));
      const res = await api.post(`/api/master/${tab}`, { items });
      toast(`${res.rows.length} data diimpor`); onDone(); onClose(); setDs(null);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Impor ${cfg.label.toLowerCase()} dari Excel`} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button disabled={!ds} loading={busy} onClick={save}>Impor {rows.length || ''} baris</Button></>}>
      {!ds ? (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-8 text-sm text-slate-600 hover:border-brand-400">
          <Upload className="h-6 w-6 text-brand-600" />Pilih file .xlsx/.csv
          <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="text-sm text-slate-600 sm:col-span-2">{ds.nama}: {rows.length} baris. Petakan kolom:</p>
          {cfg.fields.map(([k, l, , req]) => <Field key={k} label={`${l}${req ? ' *' : ''}`}><Select value={map[k] || ''} onChange={(e) => setMap({ ...map, [k]: e.target.value })} placeholder="— tidak diimpor —" options={ds.columns} /></Field>)}
        </div>
      )}
    </Modal>
  );
}
