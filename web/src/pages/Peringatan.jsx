import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, AlertOctagon, AlertTriangle, Info, CheckCircle2, ArrowRight, Settings2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Button, Card, Field, Input, Modal, PageHeader, Skeleton, Tabs, cx, useLoad, useToast } from '../components/ui.jsx';
import { rp } from '../lib/format.js';

const TINGKAT = {
  bahaya: { label: 'Kritis', icon: AlertOctagon, tone: 'bg-rose-50 text-rose-700 ring-rose-200', bar: 'bg-rose-500' },
  peringatan: { label: 'Peringatan', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-800 ring-amber-200', bar: 'bg-amber-500' },
  info: { label: 'Informasi', icon: Info, tone: 'bg-brand-50 text-brand-700 ring-brand-200', bar: 'bg-brand-500' },
};

const PENGATURAN = [
  ['batas_kas_tunai', 'Batas saldo kas tunai (Rp)'],
  ['batas_transaksi_tunai', 'Batas pembayaran tunai per transaksi (Rp)'],
  ['ambang_pagu_persen', 'Peringatan realisasi rekening (% pagu)'],
  ['ambang_gu_persen', 'Sarankan pengajuan GU saat UP terpakai (%)'],
  ['batas_hari_panjar', 'Batas pertanggungjawaban panjar (hari)'],
];

export default function Peringatan() {
  const { skpdId, tahun, skpd, can } = useApp();
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/anomali', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  useLive((e) => (e.type.startsWith('bku') || e.type.startsWith('pajak')) && reload(), 1500);
  const [filter, setFilter] = useState('semua');
  const [atur, setAtur] = useState(false);
  const items = useMemo(() => (data?.items || []).filter((i) => filter === 'semua' || i.tingkat === filter), [data, filter]);
  const kategori = useMemo(() => {
    const m = {};
    (data?.items || []).forEach((i) => { m[i.kategori] = (m[i.kategori] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [data]);
  const r = data?.ringkasan || { bahaya: 0, peringatan: 0, info: 0 };
  const total = r.bahaya + r.peringatan + r.info;

  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldAlert} title="Peringatan Anomali" subtitle={`Pemeriksaan otomatis data BKU ${skpd?.nama || ''} TA ${tahun}`}
        actions={can('admin') && <Button variant="secondary" icon={Settings2} onClick={() => setAtur(true)}>Atur ambang</Button>} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card flex items-center gap-4 p-4">
          <div className={cx('grid h-12 w-12 place-items-center rounded-2xl', total ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600')}>
            {total ? <ShieldAlert className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
          </div>
          <div><p className="text-xs text-slate-500">Total temuan</p><p className="num text-2xl font-bold text-slate-900">{data ? total : '…'}</p></div>
        </div>
        {Object.entries(TINGKAT).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setFilter(filter === k ? 'semua' : k)}
            className={cx('card flex items-center gap-4 p-4 text-left transition hover:shadow-md', filter === k && 'ring-2 ring-brand-500')}>
            <div className={cx('grid h-12 w-12 place-items-center rounded-2xl ring-1 ring-inset', t.tone)}><t.icon className="h-6 w-6" /></div>
            <div><p className="text-xs text-slate-500">{t.label}</p><p className="num text-2xl font-bold text-slate-900">{data ? r[k] : '…'}</p></div>
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <Card bodyClass="" title="Daftar temuan" subtitle="Klik temuan untuk membuka transaksi atau halaman terkait"
          actions={<Tabs value={filter} onChange={setFilter} tabs={[{ value: 'semua', label: 'Semua' }, ...Object.entries(TINGKAT).map(([value, t]) => ({ value, label: t.label, count: r[value] }))]} />}>
          {loading && !data ? <div className="space-y-3 p-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div> : !items.length ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="font-semibold text-slate-800">Tidak ada anomali</p>
              <p className="max-w-sm text-sm text-slate-500">Tidak ditemukan transaksi ganda, kas tunai berlebih, pagu terlampaui, atau pajak terlambat.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((i, n) => {
                const t = TINGKAT[i.tingkat];
                return (
                  <li key={n} className="relative">
                    <span className={cx('absolute inset-y-0 left-0 w-1', t.bar)} />
                    <Link to={i.link || '#'} className="group flex items-start gap-3 py-3.5 pl-5 pr-4 transition hover:bg-slate-50">
                      <span className={cx('mt-0.5 rounded-lg p-1.5 ring-1 ring-inset', t.tone)}><t.icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{i.kategori}</span>
                        <span className="block text-sm font-semibold text-slate-800">{i.judul}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{i.pesan}</span>
                      </span>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Per kategori">
            {kategori.length ? (
              <ul className="space-y-2.5">
                {kategori.map(([k, n]) => (
                  <li key={k}>
                    <div className="flex justify-between text-xs"><span className="text-slate-600">{k}</span><span className="num font-semibold text-slate-800">{n}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(n / Math.max(...kategori.map((x) => x[1]))) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">Tidak ada temuan.</p>}
          </Card>
          {data && (
            <Card title="Yang diperiksa">
              <ul className="space-y-1.5 text-xs text-slate-600">
                <li>• Belanja bernilai, rekening & rekanan sama dalam 3 hari</li>
                <li>• Nomor bukti belanja dipakai lebih dari sekali</li>
                <li>• Saldo kas tunai &gt; {rp(data.pengaturan.batas_kas_tunai)}</li>
                <li>• Belanja tunai &gt; {rp(data.pengaturan.batas_transaksi_tunai)}</li>
                <li>• Realisasi rekening ≥ {data.pengaturan.ambang_pagu_persen}% pagu</li>
                <li>• Belanja tanpa kode rekening, saldo kas negatif</li>
                <li>• Pajak lewat jatuh tempo setor/lapor</li>
              </ul>
            </Card>
          )}
        </div>
      </div>
      {atur && data && <AturAmbang awal={data.pengaturan} onClose={() => setAtur(false)} onSaved={() => { setAtur(false); reload(); }} />}
    </div>
  );
}

function AturAmbang({ awal, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries(PENGATURAN.map(([k]) => [k, awal[k]])));
  const [busy, setBusy] = useState(false);
  const simpan = async () => {
    setBusy(true);
    try { await api.put('/api/pengaturan', f); toast('Pengaturan disimpan'); onSaved(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Atur ambang peringatan" subtitle="Berlaku untuk semua SKPD"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={simpan}>Simpan</Button></>}>
      <div className="space-y-3">
        {PENGATURAN.map(([k, l]) => <Field key={k} label={l}><Input type="number" min="0" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
      </div>
    </Modal>
  );
}
