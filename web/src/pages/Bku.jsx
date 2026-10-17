import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { BookOpen, Plus, Download, Printer, CheckCheck, XCircle, Undo2, ShieldCheck, FileText, Hash } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Pagination, SearchInput, Select, Textarea, useLoad, useToast, Empty, cx } from '../components/ui.jsx';
import TransaksiForm from '../components/TransaksiForm.jsx';
import { BULAN, rp, money, tgl, waktu, JENIS_PAJAK } from '../lib/format.js';

const VERIF = { diverifikasi: ['green', 'Terverifikasi'], ditolak: ['red', 'Ditolak'] };

export default function Bku() {
  const { skpdId, tahun, can } = useApp();
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const [filter, setFilter] = useState({ bulan: tahun === new Date().getFullYear() ? new Date().getMonth() + 1 : '', q: '', jenis: '', metode: '', verif: sp.get('verif') || '' });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(sp.get('baru') === '1');
  const [detail, setDetail] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [meta, setMeta] = useState({});
  useEffect(() => { api.get('/api/bku/meta').then((m) => setMeta(m.jenis)); }, []);
  useEffect(() => { const t = setTimeout(() => { setFilter((f) => ({ ...f, q })); setPage(1); }, 350); return () => clearTimeout(t); }, [q]);
  const params = { skpd_id: skpdId, tahun, page, pageSize: 50, ...filter };
  const { data, loading, error, reload } = useLoad(() => skpdId && api.get('/api/bku', params), [skpdId, tahun, page, JSON.stringify(filter)]);
  useLive((e) => e.type.startsWith('bku') && reload());
  const upd = (k) => (e) => { setFilter({ ...filter, [k]: e.target.value }); setPage(1); };

  const verify = async (status, ids, catatan) => {
    try {
      const r = await api.post(`/api/bku/${ids[0]}/verifikasi`, { status, ids, catatan });
      toast(`${r.updated} transaksi ${status === 'ditolak' ? 'ditolak' : 'terverifikasi'}`);
      setSel(new Set()); reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const r = data?.ringkasan;
  const periodLabel = filter.bulan ? `${BULAN[filter.bulan - 1]} ${tahun}` : `Tahun ${tahun}`;

  return (
    <div className="space-y-4">
      <PageHeader icon={BookOpen} title="Buku Kas Umum" subtitle={`Pencatatan penerimaan dan pengeluaran kas bendahara · ${periodLabel}`}
        actions={<>
          <Button variant="secondary" icon={Download} onClick={() => download('/api/bku/export.xlsx', { params: { ...params, page: undefined } }).catch((e) => toast(e.message, 'error'))}>Excel</Button>
          <Link to={`/cetak/bku?bulan=${filter.bulan}`} target="_blank"><Button variant="secondary" icon={Printer}>Cetak</Button></Link>
          {can('admin', 'bendahara') && <Button icon={Plus} onClick={() => setForm(true)}>Catat transaksi</Button>}
        </>} />

      {r && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[['Saldo awal periode', r.saldo_awal], ['Penerimaan', r.penerimaan, 'text-brand-700'], ['Pengeluaran', r.pengeluaran, 'text-amber-700'], ['Saldo akhir', r.saldo_akhir, 'text-slate-900'], ['Saldo bank', r.saldo_bank], ['Saldo tunai', r.saldo_tunai]].map(([l, v, c]) => (
            <div key={l} className="card px-3.5 py-3"><p className="text-[11px] font-medium text-slate-500">{l}</p><p className={cx('num mt-0.5 text-[15px] font-semibold', c || 'text-slate-700')}>{rp(v)}</p></div>
          ))}
        </div>
      )}

      <Card bodyClass="">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
          <SearchInput className="min-w-[220px] flex-1" value={q} onChange={setQ} placeholder="Cari uraian, no. bukti, kode rekening…" />
          <Select className="!w-auto" value={filter.bulan} onChange={upd('bulan')} placeholder="Semua bulan" options={BULAN.map((b, i) => ({ value: i + 1, label: b }))} />
          <Select className="!w-auto" value={filter.jenis} onChange={upd('jenis')} placeholder="Semua jenis" options={Object.entries(meta).map(([value, label]) => ({ value, label }))} />
          <Select className="!w-auto" value={filter.metode} onChange={upd('metode')} placeholder="Bank & tunai" options={[{ value: 'bank', label: 'Bank' }, { value: 'tunai', label: 'Tunai' }]} />
          <Select className="!w-auto" value={filter.verif} onChange={upd('verif')} placeholder="Semua status" options={[{ value: 'belum', label: 'Belum diverifikasi' }, { value: 'diverifikasi', label: 'Terverifikasi' }, { value: 'ditolak', label: 'Ditolak' }]} />
        </div>
        {sel.size > 0 && can('admin', 'verifikator') && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm">
            <span className="font-medium text-brand-800">{sel.size} dipilih</span>
            <Button size="sm" variant="success" icon={CheckCheck} onClick={() => verify('diverifikasi', [...sel])}>Verifikasi</Button>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Batal pilih</Button>
          </div>
        )}
        {error ? <div className="p-4"><Alert tone="error">{error.message}</Alert></div> : loading && !data ? <Loading /> : !data?.rows.length ? <Empty title="Tidak ada transaksi" text="Ubah filter atau catat transaksi baru." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  {can('admin', 'verifikator') && <th className="th w-8"><input type="checkbox" checked={data.rows.length > 0 && data.rows.every((x) => sel.has(x.id))} onChange={(e) => setSel(e.target.checked ? new Set(data.rows.map((x) => x.id)) : new Set())} aria-label="Pilih semua" /></th>}
                  <th className="th w-14">No</th><th className="th w-24">Tanggal</th><th className="th">No. bukti</th><th className="th">Uraian</th>
                  <th className="th text-right">Penerimaan</th><th className="th text-right">Pengeluaran</th><th className="th text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className={cx(loading && 'opacity-60')}>
                {data.rows.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => setDetail(e.id)}>
                    {can('admin', 'verifikator') && <td className="td" onClick={(x) => x.stopPropagation()}><input type="checkbox" checked={sel.has(e.id)} onChange={(x) => { const s = new Set(sel); x.target.checked ? s.add(e.id) : s.delete(e.id); setSel(s); }} aria-label={`Pilih ${e.no_urut}`} /></td>}
                    <td className="td num text-slate-500">{e.no_urut}</td>
                    <td className="td num whitespace-nowrap">{tgl(e.tanggal)}</td>
                    <td className="td whitespace-nowrap text-xs text-slate-600">{e.no_bukti}</td>
                    <td className="td">
                      <p className="line-clamp-2 text-slate-800">{e.uraian}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge color={e.jenis === 'KOREKSI' ? 'violet' : e.jenis.startsWith('PAJAK') ? 'amber' : e.jenis.startsWith('SP2D') ? 'blue' : 'slate'}>{meta[e.jenis] || e.jenis}</Badge>
                        {e.kode_rekening && <span className="text-[11px] text-slate-500">{e.kode_rekening}</span>}
                        {e.metode === 'tunai' && <Badge>Tunai</Badge>}
                        {e.verif_status && <Badge color={VERIF[e.verif_status][0]}>{VERIF[e.verif_status][1]}</Badge>}
                        {e.dikoreksi && <Badge color="violet">Sudah dikoreksi</Badge>}
                      </div>
                    </td>
                    <td className="td num whitespace-nowrap text-right text-brand-700">{Number(e.penerimaan) ? money(e.penerimaan) : ''}</td>
                    <td className="td num whitespace-nowrap text-right">{Number(e.pengeluaran) ? money(e.pengeluaran) : ''}</td>
                    <td className="td num whitespace-nowrap text-right font-medium">{money(e.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={page} pageSize={50} total={data.total} onChange={setPage} />}
      </Card>

      <TransaksiForm open={form} onClose={() => { setForm(false); if (sp.get('baru')) setSp({}); }} onSaved={() => reload()} />
      <DetailModal id={detail} onClose={() => setDetail(null)} onChanged={reload} onVerify={verify} />
    </div>
  );
}

function DetailModal({ id, onClose, onChanged, onVerify }) {
  const { can } = useApp();
  const toast = useToast();
  const { data, loading, reload } = useLoad(() => id && api.get(`/api/bku/${id}`), [id]);
  const [mode, setMode] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMode(null); setText(''); }, [id]);
  if (!id) return null;
  const e = data?.entry;
  const koreksi = async () => {
    setBusy(true);
    try { const r = await api.post(`/api/bku/${id}/koreksi`, { alasan: text }); toast(`Jurnal koreksi No. ${r.entry.no_urut} dibuat`); onChanged(); reload(); setMode(null); } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={e ? `Transaksi No. ${e.no_urut}` : 'Detail transaksi'} subtitle={e ? `${tgl(e.tanggal, { long: true })} · ${e.no_bukti}` : ''}
      footer={e && <>
        <Link to={`/cetak/kuitansi/${e.id}`} target="_blank"><Button variant="secondary" icon={FileText}>Cetak kuitansi</Button></Link>
        {can('admin', 'bendahara') && e.jenis !== 'KOREKSI' && !data.koreksi.length && <Button variant="secondary" icon={Undo2} onClick={() => setMode('koreksi')}>Koreksi</Button>}
        {can('admin', 'verifikator') && <>
          <Button variant="secondary" icon={XCircle} onClick={() => setMode('tolak')}>Tolak</Button>
          <Button variant="success" icon={CheckCheck} onClick={async () => { await onVerify('diverifikasi', [e.id]); reload(); }}>Verifikasi</Button>
        </>}
      </>}>
      {loading || !e ? <Loading /> : (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-800">{e.uraian}</p>
            <p className={cx('num mt-2 text-2xl font-semibold', Number(e.penerimaan) ? 'text-brand-700' : 'text-slate-900')}>{Number(e.penerimaan) ? '+' : '−'}{rp(Number(e.penerimaan) || Number(e.pengeluaran), { decimals: true })}</p>
            <p className="mt-0.5 text-xs italic text-slate-500">{data.terbilang}</p>
          </div>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[['Jenis', e.jenis], ['Kas', e.metode === 'bank' ? 'Bank' : 'Tunai'], ['Kode rekening', e.kode_rekening ? `${e.kode_rekening} — ${e.rekening_nama}` : '-'], ['Rekanan', e.rekanan_nama || '-'],
              ['Dicatat oleh', `${e.dibuat_oleh} · ${waktu(e.created_at)}`], ['Batch impor', e.import_batch || '-']].map(([k, v]) => (
              <div key={k}><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></div>
            ))}
          </dl>
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700"><ShieldCheck className="h-4 w-4 text-emerald-600" />Segel integritas (SHA-256)</p>
            <p className="flex items-start gap-1.5 break-all font-mono text-[11px] text-slate-600"><Hash className="mt-0.5 h-3 w-3 shrink-0" />{e.hash}</p>
            <p className="mt-1 break-all font-mono text-[11px] text-slate-400">sebelumnya: {e.prev_hash}</p>
          </div>
          {data.pajak.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-700">Pajak terkait</p>
              <table className="w-full"><tbody>
                {data.pajak.map((p) => (
                  <tr key={p.id}><td className="td">{JENIS_PAJAK[p.jenis_pajak]} <span className="text-xs text-slate-500">{p.kode_objek}</span></td><td className="td num text-right">{rp(p.nominal)}</td>
                    <td className="td text-right"><Badge color={p.status === 'dipungut' ? 'amber' : 'green'}>{p.status}</Badge>{p.ntpn && <span className="ml-1 text-[11px] text-slate-500">NTPN {p.ntpn}</span>}</td></tr>
                ))}
              </tbody></table>
            </div>
          )}
          {data.koreksi.length > 0 && <Alert tone="info">Transaksi ini telah dikoreksi oleh entri No. {data.koreksi.map((k) => k.no_urut).join(', ')}.</Alert>}
          {data.verifikasi.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-700">Riwayat verifikasi</p>
              <ul className="space-y-1 text-xs text-slate-600">{data.verifikasi.map((v) => <li key={v.id}><Badge color={VERIF[v.status][0]}>{VERIF[v.status][1]}</Badge> oleh {v.full_name} · {waktu(v.verified_at)}{v.catatan && ` — "${v.catatan}"`}</li>)}</ul>
            </div>
          )}
          {mode && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <Field label={mode === 'koreksi' ? 'Alasan koreksi (entri pembalik akan dibuat)' : 'Catatan penolakan'}><Textarea value={text} onChange={(x) => setText(x.target.value)} /></Field>
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Batal</Button>
                <Button size="sm" variant={mode === 'koreksi' ? 'primary' : 'danger'} loading={busy} disabled={!text.trim()}
                  onClick={mode === 'koreksi' ? koreksi : async () => { await onVerify('ditolak', [e.id], text); setMode(null); reload(); }}>{mode === 'koreksi' ? 'Buat jurnal koreksi' : 'Tolak transaksi'}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
