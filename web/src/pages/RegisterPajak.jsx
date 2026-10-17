import { useState } from 'react';
import { Receipt, Send, FileCheck2, Pencil, Trash2, Download } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, SearchInput, Select, useLoad, useToast, Empty, cx } from '../components/ui.jsx';
import { BULAN, JENIS_PAJAK, rp, money, tgl, today } from '../lib/format.js';
import { STATUS_PTKP } from '@shared/tax.js';

const STATUS = { dipungut: ['amber', 'Dipungut'], disetor: ['blue', 'Disetor'], dilaporkan: ['green', 'Dilaporkan'] };

export default function RegisterPajak() {
  const { skpdId, tahun, can } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ masa: '', jenis_pajak: '', status: '', q: '' });
  const [sel, setSel] = useState(new Set());
  const [setor, setSetor] = useState(false);
  const [edit, setEdit] = useState(null);
  const { data, loading, error, reload } = useLoad(() => skpdId && api.get('/api/pajak', { skpd_id: skpdId, tahun, ...f }), [skpdId, tahun, JSON.stringify(f)]);
  useLive((e) => e.type.startsWith('pajak') && reload());
  const rows = data?.rows || [];
  const selected = rows.filter((r) => sel.has(r.id));
  const totalSel = selected.reduce((s, r) => s + Number(r.nominal), 0);
  const upd = (k) => (e) => { setF({ ...f, [k]: e?.target ? e.target.value : e }); setSel(new Set()); };

  const lapor = async () => {
    try { const r = await api.post('/api/pajak/lapor', { ids: [...sel] }); toast(`${r.updated} bukti potong ditandai dilaporkan`); setSel(new Set()); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const hapus = async (id) => {
    if (!window.confirm('Hapus data pajak ini?')) return;
    try { await api.del(`/api/pajak/${id}`); toast('Data dihapus'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={Receipt} title="Register Pajak" subtitle="Daftar pajak yang dipotong/dipungut bendahara, penyetoran (NTPN) dan pelaporan"
        actions={<Button variant="secondary" icon={Download} onClick={() => download('/api/pajak/coretax/export', { params: { skpd_id: skpdId, tahun, masa: f.masa, form: 'ALL', format: 'xlsx', jenis_pajak: f.jenis_pajak, status: f.status } }).catch((e) => toast(e.message, 'error'))}>Excel</Button>} />
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.entries(STATUS).map(([k, [c, l]]) => (
            <button key={k} type="button" onClick={() => upd('status')(f.status === k ? '' : k)} className={cx('card px-4 py-3 text-left transition hover:border-brand-300', f.status === k && 'ring-2 ring-brand-500')}>
              <p className="text-xs text-slate-500"><Badge color={c}>{l}</Badge></p>
              <p className="num mt-1 text-lg font-semibold text-slate-900">{rp(data.ringkasan[k] || 0)}</p>
            </button>
          ))}
        </div>
      )}
      <Card bodyClass="">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <SearchInput className="min-w-[200px] flex-1" value={f.q} onChange={upd('q')} placeholder="Cari nama, NPWP, no. dokumen…" />
          <Select className="!w-auto" value={f.masa} onChange={upd('masa')} placeholder="Semua masa" options={BULAN.map((b, i) => ({ value: i + 1, label: b }))} />
          <Select className="!w-auto" value={f.jenis_pajak} onChange={upd('jenis_pajak')} placeholder="Semua jenis" options={Object.entries(JENIS_PAJAK).map(([value, label]) => ({ value, label }))} />
          <Select className="!w-auto" value={f.status} onChange={upd('status')} placeholder="Semua status" options={Object.entries(STATUS).map(([value, [, label]]) => ({ value, label }))} />
        </div>
        {sel.size > 0 && can('admin', 'bendahara') && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm">
            <span className="font-medium text-brand-800">{sel.size} dipilih · {rp(totalSel)}</span>
            {selected.every((r) => r.status === 'dipungut') && <Button size="sm" icon={Send} onClick={() => setSetor(true)}>Catat setoran (NTPN)</Button>}
            {selected.every((r) => r.status === 'disetor') && <Button size="sm" variant="success" icon={FileCheck2} onClick={lapor}>Tandai dilaporkan</Button>}
            {!selected.every((r) => r.status === selected[0].status) && <span className="text-xs text-brand-700">Pilih data dengan status yang sama</span>}
          </div>
        )}
        {error ? <div className="p-4"><Alert tone="error">{error.message}</Alert></div> : loading && !data ? <Loading /> : !rows.length ? <Empty title="Tidak ada data pajak" /> : (
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="sticky top-0 z-10"><tr>
                <th className="th w-8"><input type="checkbox" checked={rows.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Pilih semua" /></th>
                <th className="th">Masa</th><th className="th">Jenis</th><th className="th">Penerima</th><th className="th">Dokumen</th><th className="th text-right">DPP</th><th className="th text-right">Tarif</th><th className="th text-right">Pajak</th><th className="th">Status</th><th className="th" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="td"><input type="checkbox" checked={sel.has(r.id)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(r.id) : s.delete(r.id); setSel(s); }} aria-label={`Pilih ${r.penerima_nama}`} /></td>
                    <td className="td whitespace-nowrap">{BULAN[r.masa - 1].slice(0, 3)}</td>
                    <td className="td"><p className="font-medium">{JENIS_PAJAK[r.jenis_pajak]}</p><p className="text-[11px] text-slate-500">{r.kode_objek || 'PPN'} · {r.form}</p></td>
                    <td className="td"><p>{r.penerima_nama}</p><p className="num text-[11px] text-slate-500">{r.penerima_npwp || r.penerima_nik || <span className="text-rose-600">NPWP/NIK kosong</span>}{r.status_ptkp && ` · ${r.status_ptkp}`}</p></td>
                    <td className="td text-xs text-slate-600">{r.dokumen_nomor || '-'}<br />{tgl(r.dokumen_tanggal)}</td>
                    <td className="td num text-right">{money(r.dpp)}</td>
                    <td className="td num text-right">{Number(r.tarif).toLocaleString('id-ID')}%</td>
                    <td className="td num text-right font-medium">{money(r.nominal)}</td>
                    <td className="td"><Badge color={STATUS[r.status][0]}>{STATUS[r.status][1]}</Badge>{r.ntpn && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{r.ntpn}</p>}{r.ditanggung_pemerintah && <p className="text-[10px] text-violet-600">DTP</p>}</td>
                    <td className="td whitespace-nowrap">
                      {can('admin', 'bendahara') && r.status !== 'dilaporkan' && <button type="button" className="p-1 text-slate-400 hover:text-brand-700" onClick={() => setEdit(r)} aria-label="Ubah"><Pencil className="h-4 w-4" /></button>}
                      {can('admin', 'bendahara') && !r.bku_entry_id && r.status === 'dipungut' && <button type="button" className="p-1 text-slate-400 hover:text-rose-600" onClick={() => hapus(r.id)} aria-label="Hapus"><Trash2 className="h-4 w-4" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <SetorModal open={setor} onClose={() => setSetor(false)} rows={selected} onDone={() => { setSel(new Set()); reload(); }} />
      <EditModal row={edit} onClose={() => setEdit(null)} onDone={reload} />
    </div>
  );
}

function SetorModal({ open, onClose, rows, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ ntpn: '', id_billing: '', tanggal_setor: today(), metode: 'bank' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const total = rows.reduce((s, r) => s + Number(r.nominal), 0);
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post('/api/pajak/setor', { ids: rows.map((x) => x.id), ...f }); toast(`${r.updated} pajak disetor${r.bku.length ? `, ${r.bku.length} entri setoran dicatat di BKU` : ''}`); onDone(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Catat setoran pajak" subtitle={`${rows.length} bukti · total ${rp(total)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={submit}>Simpan setoran</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="NTPN" hint="16 karakter dari bukti penerimaan negara"><Input className="font-mono uppercase" maxLength={16} value={f.ntpn} onChange={(e) => setF({ ...f, ntpn: e.target.value.toUpperCase() })} /></Field>
        <Field label="Kode billing"><Input className="font-mono" value={f.id_billing} onChange={(e) => setF({ ...f, id_billing: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal setor"><Input type="date" value={f.tanggal_setor} onChange={(e) => setF({ ...f, tanggal_setor: e.target.value })} /></Field>
          <Field label="Dari kas"><Select value={f.metode} onChange={(e) => setF({ ...f, metode: e.target.value })} options={[{ value: 'bank', label: 'Bank' }, { value: 'tunai', label: 'Tunai' }]} /></Field>
        </div>
        <p className="text-xs text-slate-500">Pajak yang dipungut melalui BKU otomatis dibukukan sebagai pengeluaran "setoran pajak".</p>
      </div>
    </Modal>
  );
}

function EditModal({ row, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const cur = { ...row, ...f };
  if (!row) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try { await api.patch(`/api/pajak/${row.id}`, f); toast('Data pajak diperbarui'); setF({}); onDone(); onClose(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!row} onClose={() => { setF({}); onClose(); }} title="Ubah data bukti potong" subtitle={`${JENIS_PAJAK[row.jenis_pajak]} · ${rp(row.nominal)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={save}>Simpan</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama penerima" className="sm:col-span-2"><Input value={cur.penerima_nama || ''} onChange={set('penerima_nama')} /></Field>
        <Field label="NPWP (16 digit)"><Input value={cur.penerima_npwp || ''} onChange={set('penerima_npwp')} /></Field>
        <Field label="NIK"><Input value={cur.penerima_nik || ''} onChange={set('penerima_nik')} /></Field>
        <Field label="NITKU penerima"><Input value={cur.penerima_nitku || ''} onChange={set('penerima_nitku')} /></Field>
        {row.jenis_pajak === 'PPH21' && <Field label="Status PTKP"><Select value={cur.status_ptkp || 'TK/0'} onChange={set('status_ptkp')} options={STATUS_PTKP} /></Field>}
        <Field label="Kode objek pajak"><Input value={cur.kode_objek || ''} onChange={set('kode_objek')} /></Field>
        <Field label="Jenis dokumen"><Select value={cur.dokumen_jenis || ''} onChange={set('dokumen_jenis')} placeholder="-" options={['CommercialInvoice', 'Contract', 'PaymentProof', 'Other']} /></Field>
        <Field label="Nomor dokumen"><Input value={cur.dokumen_nomor || ''} onChange={set('dokumen_nomor')} /></Field>
        <Field label="Tanggal dokumen"><Input type="date" value={cur.dokumen_tanggal || ''} onChange={set('dokumen_tanggal')} /></Field>
        <Field label="Keterangan" className="sm:col-span-2"><Input value={cur.keterangan || ''} onChange={set('keterangan')} /></Field>
      </div>
    </Modal>
  );
}
