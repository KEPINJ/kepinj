import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileStack, Plus, Stamp, Banknote, XCircle, Check, Clock, Wallet, RefreshCw, Ban } from 'lucide-react';
import { terbilang } from '@shared/terbilang.js';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Combo, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, SkeletonRows, Stat, Tabs, Textarea, cx, useLoad, useToast } from '../components/ui.jsx';
import { rp, tgl, today } from '../lib/format.js';

const JENIS_WARNA = { UP: 'blue', GU: 'green', TU: 'amber', LS_GAJI: 'violet', LS_BARANG: 'slate' };
const STATUS = { spp: ['amber', 'Diajukan'], spm: ['blue', 'SPM terbit'], sp2d: ['green', 'SP2D cair'], ditolak: ['red', 'Ditolak'] };

/** Alur tiga langkah SPP -> SPM -> SP2D. */
function Stepper({ s }) {
  const langkah = [['SPP', s.tanggal_spp, s.nomor_spp], ['SPM', s.tanggal_spm, s.nomor_spm], ['SP2D', s.tanggal_sp2d, s.nomor_sp2d]];
  const aktif = { spp: 1, spm: 2, sp2d: 3, ditolak: s.tanggal_spm ? 2 : 1 }[s.status];
  return (
    <ol className="flex items-center gap-1">
      {langkah.map(([l, t, n], i) => {
        const selesai = i < aktif && !(s.status === 'ditolak' && i === aktif - 1);
        const tolak = s.status === 'ditolak' && i === aktif - 1;
        return (
          <li key={l} className="flex items-center gap-1">
            {i > 0 && <span className={cx('h-0.5 w-4 rounded sm:w-6', i < aktif && !(s.status === 'ditolak' && i === aktif - 1) ? 'bg-emerald-400' : 'bg-slate-200')} />}
            <span title={n ? `${n} · ${tgl(t)}` : 'Belum'} className={cx('flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
              tolak ? 'bg-rose-50 text-rose-700 ring-rose-200' : selesai ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : i === aktif && s.status !== 'ditolak' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-slate-50 text-slate-400 ring-slate-200')}>
              {tolak ? <Ban className="h-3 w-3" /> : selesai ? <Check className="h-3 w-3" /> : i === aktif && s.status !== 'ditolak' ? <Clock className="h-3 w-3" /> : null}{l}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function Spp() {
  const { skpdId, tahun, can } = useApp();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState('semua');
  const [baru, setBaru] = useState(null);
  const [aksi, setAksi] = useState(null);
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/spp', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  useLive((e) => (e.type === 'spp.updated' || e.type.startsWith('bku')) && reload(), 800);

  useEffect(() => {
    if (sp.get('baru') && data) { setBaru(sp.get('baru')); setSp({}, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, data]);

  const rows = useMemo(() => (data?.rows || []).filter((r) => tab === 'semua' || (tab === 'proses' ? ['spp', 'spm'].includes(r.status) : r.status === tab)), [data, tab]);
  const up = data?.up; const rg = data?.ringkasan || {};
  const n = (k) => rg[k]?.jumlah || 0;

  return (
    <div className="space-y-5">
      <PageHeader icon={FileStack} title="SPP · SPM · SP2D" subtitle="Pengajuan dana dari bendahara sampai pencairan; SP2D yang cair langsung tercatat di BKU"
        actions={can('admin', 'bendahara') && <Button icon={Plus} onClick={() => setBaru('GU')}>Ajukan SPP</Button>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Posisi Uang Persediaan (UP)" subtitle="Belanja dari UP yang belum diganti menjadi dasar pengajuan GU">
          {!up ? <SkeletonRows rows={3} cols={3} /> : !up.up ? (
            <Empty icon={Wallet} title="UP tahun ini belum diterima" text="Ajukan SPP-UP sekali di awal tahun anggaran. Setelah SP2D UP cair, sisa UP dan kebutuhan GU dipantau di sini."
              action={can('admin', 'bendahara') && <Button icon={Plus} onClick={() => setBaru('UP')}>Ajukan SPP-UP</Button>} />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[['UP diterima', up.up], ['GU sudah cair', up.gu], ['Belum diganti', up.belum_diganti], ['Sisa UP di kas', up.sisa_up]].map(([l, v]) => (
                  <div key={l}><p className="text-[11px] font-medium text-slate-500">{l}</p><p className="num text-[15px] font-semibold text-slate-800">{rp(v)}</p></div>
                ))}
              </div>
              <div>
                <div className="mb-1.5 flex justify-between text-xs"><span className="text-slate-600">UP terpakai</span><span className="num font-semibold text-slate-800">{up.persen_terpakai.toFixed(1)}%</span></div>
                <div className="relative h-3 overflow-hidden rounded-full bg-slate-100">
                  <div className={cx('h-full rounded-full transition-all', up.persen_terpakai >= 80 ? 'bg-rose-500' : up.persen_terpakai >= up.ambang_persen ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, up.persen_terpakai)}%` }} />
                  <span className="absolute inset-y-0 w-0.5 bg-slate-500" style={{ left: `${up.ambang_persen}%` }} title={`Ambang pengajuan GU ${up.ambang_persen}%`} />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Garis menandai ambang pengajuan GU ({up.ambang_persen}%).{up.gu_dalam_proses > 0 && ` GU sedang diproses ${rp(up.gu_dalam_proses)}.`}</p>
              </div>
              {up.siap_gu ? (
                <Alert tone="warn" title={`Saatnya mengajukan GU sebesar ${rp(up.usulan_gu)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><span>Kas UP menipis; ganti belanja yang sudah di-SPJ-kan agar kegiatan tetap berjalan.</span>
                    {can('admin', 'bendahara') && <Button size="sm" variant="gold" icon={RefreshCw} onClick={() => setBaru('GU')}>Ajukan GU</Button>}</div>
                </Alert>
              ) : <Alert tone="ok">UP masih mencukupi. Pengajuan GU disarankan setelah pemakaian mencapai {up.ambang_persen}%.</Alert>}
            </div>
          )}
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1 lg:gap-4">
          <Stat label="Sedang diproses" value={n('spp') + n('spm')} sub={rp((rg.spp?.nilai || 0) + (rg.spm?.nilai || 0))} icon={Clock} tone="amber" />
          <Stat label="SP2D cair tahun ini" value={n('sp2d')} sub={rp(rg.sp2d?.nilai || 0)} icon={Banknote} tone="green" />
        </div>
      </div>

      <Card bodyClass="" title="Daftar pengajuan" actions={<Tabs value={tab} onChange={setTab} tabs={[
        { value: 'semua', label: 'Semua', count: data?.rows.length }, { value: 'proses', label: 'Diproses', count: n('spp') + n('spm') },
        { value: 'sp2d', label: 'Cair', count: n('sp2d') }, { value: 'ditolak', label: 'Ditolak', count: n('ditolak') }]} />}>
        {loading && !data ? <SkeletonRows /> : !rows.length ? <Empty title="Belum ada pengajuan" text="Pengajuan SPP yang dibuat akan tampil di sini beserta tahapannya." /> : (
          <div className="divide-y divide-slate-100">
            {rows.map((s) => (
              <div key={s.id} className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge color={JENIS_WARNA[s.jenis]}>{s.jenis.replace('_', ' ')}</Badge>
                    <span className="font-mono text-xs text-slate-600">{s.nomor_spp}</span>
                    <Badge color={STATUS[s.status][0]}>{STATUS[s.status][1]}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-800">{s.uraian}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {tgl(s.tanggal_spp)}{s.kode_rekening && ` · ${s.kode_rekening} ${s.rekening_nama || ''}`}{s.rekanan_nama && ` · ${s.rekanan_nama}`}
                    {s.nomor_sp2d && ` · SP2D ${s.nomor_sp2d} (${tgl(s.tanggal_sp2d)})`}
                  </p>
                  {s.status === 'ditolak' && s.catatan && <p className="mt-1 text-[11px] text-rose-700">Alasan ditolak: {s.catatan}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-3 lg:justify-end">
                  <Stepper s={s} />
                  <p className="num w-36 text-right text-sm font-semibold text-slate-900">{rp(s.nilai)}</p>
                  <div className="flex gap-1.5 lg:w-48 lg:justify-end">
                    {s.status === 'spp' && can('admin', 'verifikator', 'pimpinan') && <Button size="sm" icon={Stamp} onClick={() => setAksi({ tipe: 'spm', s })}>Terbitkan SPM</Button>}
                    {s.status === 'spm' && can('admin', 'bendahara') && <Button size="sm" variant="success" icon={Banknote} onClick={() => setAksi({ tipe: 'sp2d', s })}>Catat SP2D</Button>}
                    {['spp', 'spm'].includes(s.status) && can('admin', 'verifikator', 'pimpinan') && <Button size="sm" variant="ghost" icon={XCircle} onClick={() => setAksi({ tipe: 'tolak', s })} aria-label="Tolak" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <FormSpp jenisAwal={baru} up={up} jenisList={data?.jenis || {}} onClose={() => setBaru(null)} onSaved={(r) => { toast(`${r.nomor_spp} diajukan. Menunggu penerbitan SPM.`); reload(); }} />
      <AksiSpp aksi={aksi} onClose={() => setAksi(null)} onDone={(msg) => { toast(msg); setAksi(null); reload(); }} />
    </div>
  );
}

function FormSpp({ jenisAwal, up, jenisList, onClose, onSaved }) {
  const { skpdId, tahun } = useApp();
  const [f, setF] = useState({});
  const [ref, setRef] = useState({ rekening: [], rekanan: [] });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!jenisAwal) return;
    setErr('');
    const nilai = jenisAwal === 'GU' ? Math.round(up?.usulan_gu || 0) : 0;
    setF({ jenis: jenisAwal, tanggal_spp: today().slice(0, 4) === String(tahun) ? today() : `${tahun}-12-01`, nilai,
      uraian: jenisAwal === 'GU' ? 'Penggantian uang persediaan atas belanja yang telah dipertanggungjawabkan' : jenisAwal === 'UP' ? `Uang persediaan tahun anggaran ${tahun}` : '', kode_rekening: '', rekanan_id: '' });
    Promise.all([api.get('/api/master/rekening', { jenis: 'belanja' }), api.get('/api/master/rekanan')]).then(([r, k]) => setRef({ rekening: r.rows, rekanan: k.rows })).catch(() => {});
  }, [jenisAwal, up, tahun]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const ls = String(f.jenis || '').startsWith('LS');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post('/api/spp', { ...f, skpd_id: skpdId, kode_rekening: f.kode_rekening || null, rekanan_id: f.rekanan_id || null });
      onSaved(r.row); onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!jenisAwal} onClose={onClose} title="Ajukan SPP" subtitle="Nomor SPP dibuat otomatis. Setelah SPM terbit dan SP2D cair, penerimaan dibukukan di BKU."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={submit}>Ajukan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        {f.jenis === 'GU' && up?.up > 0 && <Alert tone="info">Belanja UP yang belum diganti {rp(up.belum_diganti)}{up.gu_dalam_proses ? `, sedang diproses ${rp(up.gu_dalam_proses)}` : ''}. Usulan GU: <b>{rp(up.usulan_gu)}</b>.</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Jenis SPP"><Select value={f.jenis || ''} onChange={set('jenis')} options={Object.entries(jenisList).map(([value, label]) => ({ value, label: `${value.replace('_', ' ')} · ${label}` }))} /></Field>
          <Field label="Tanggal SPP"><Input type="date" value={f.tanggal_spp || ''} onChange={set('tanggal_spp')} /></Field>
        </div>
        <Field label="Uraian / keperluan"><Textarea value={f.uraian || ''} onChange={set('uraian')} /></Field>
        {ls && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kode rekening belanja" hint={f.jenis === 'LS_GAJI' ? 'Belanja pegawai (5.1.01…)' : undefined}>
              <Combo value={f.kode_rekening} onChange={set('kode_rekening')} placeholder="Pilih rekening"
                options={ref.rekening.filter((r) => f.jenis !== 'LS_GAJI' || r.kode.startsWith('5.1.01')).map((r) => ({ value: r.kode, label: `${r.kode} — ${r.nama}` }))} />
            </Field>
            {f.jenis === 'LS_BARANG' && <Field label="Rekanan"><Combo value={f.rekanan_id} onChange={set('rekanan_id')} placeholder="Pilih rekanan" options={ref.rekanan.map((r) => ({ value: r.id, label: r.nama }))} /></Field>}
          </div>
        )}
        <Field label="Nilai" hint={f.nilai ? terbilang(f.nilai) : undefined}><MoneyInput value={f.nilai} onChange={set('nilai')} /></Field>
      </div>
    </Modal>
  );
}

function AksiSpp({ aksi, onClose, onDone }) {
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (aksi) { setErr(''); setF({ tanggal: today(), nomor: '', catatan: '' }); } }, [aksi]);
  if (!aksi) return null;
  const { tipe, s } = aksi;
  const judul = { spm: 'Terbitkan SPM', sp2d: 'Catat SP2D cair', tolak: 'Tolak pengajuan' }[tipe];
  const jalankan = async () => {
    setBusy(true); setErr('');
    try {
      if (tipe === 'spm') { await api.post(`/api/spp/${s.id}/spm`, { tanggal_spm: f.tanggal, nomor_spm: f.nomor }); onDone(`SPM untuk ${s.nomor_spp} terbit`); }
      if (tipe === 'sp2d') { await api.post(`/api/spp/${s.id}/sp2d`, { tanggal_sp2d: f.tanggal, nomor_sp2d: f.nomor }); onDone(`SP2D ${f.nomor} dicatat dan dibukukan di BKU`); }
      if (tipe === 'tolak') { await api.post(`/api/spp/${s.id}/tolak`, { catatan: f.catatan }); onDone(`${s.nomor_spp} ditolak`); }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open size="sm" onClose={onClose} title={judul} subtitle={`${s.nomor_spp} · ${rp(s.nilai)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button variant={tipe === 'tolak' ? 'danger' : tipe === 'sp2d' ? 'success' : 'primary'} loading={busy} disabled={(tipe === 'tolak' && !f.catatan.trim()) || (tipe === 'sp2d' && !f.nomor.trim())} onClick={jalankan}>{judul}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        {tipe === 'tolak' ? <Field label="Alasan penolakan"><Textarea value={f.catatan} onChange={(e) => setF({ ...f, catatan: e.target.value })} /></Field> : (<>
          <Field label={`Tanggal ${tipe.toUpperCase()}`}><Input type="date" value={f.tanggal} onChange={(e) => setF({ ...f, tanggal: e.target.value })} /></Field>
          <Field label={`Nomor ${tipe.toUpperCase()}`} hint={tipe === 'spm' ? `Kosongkan untuk memakai ${s.nomor_spp.replace('SPP', 'SPM')}` : 'Sesuai SP2D yang diterbitkan BUD'}>
            <Input value={f.nomor} onChange={(e) => setF({ ...f, nomor: e.target.value })} placeholder={tipe === 'sp2d' ? 'mis. 01234/SP2D/2026' : ''} />
          </Field>
          {tipe === 'sp2d' && <Alert tone="info">{s.jenis.startsWith('LS') ? 'Dua baris akan dibukukan di BKU: penerimaan SP2D LS dan pembayaran belanja ke penerima.' : `Penerimaan SP2D ${s.jenis} ${rp(s.nilai)} akan dibukukan di BKU.`}</Alert>}
        </>)}
      </div>
    </Modal>
  );
}
