import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Wand2, Target, TrendingUp, AlertTriangle, Scale, Plus, Trash2, Stamp, ArrowRight, Pencil } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Combo, Empty, Field, Input, Modal, MoneyInput, PageHeader, Progress, Select, SkeletonRows, Stat, Tabs, Textarea, cx, useLoad, useToast } from '../components/ui.jsx';
import { BULAN, BULAN_SINGKAT, compact, money, rp, tgl, today, waktu } from '../lib/format.js';
import { SERIES } from '../lib/palette.js';

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-700">{label}</p>
      {payload.filter((p) => p.value != null).map((p) => <p key={p.dataKey} className="flex items-center gap-2 text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: <span className="num font-medium text-slate-800">{rp(p.value)}</span></p>)}
    </div>
  );
}

export default function AnggaranKas() {
  const { skpdId, tahun, can } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('grafik');
  const [edit, setEdit] = useState(null);
  const [cari, setCari] = useState('');
  const [baru, setBaru] = useState(false);
  const admin = can('admin');
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/anggaran-kas', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  const { data: pa, reload: reloadPa } = useLoad(() => skpdId && api.get('/api/perubahan-anggaran', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  useLive((e) => e.type.startsWith('bku') && reload(), 1500);
  const muat = () => { reload(); reloadPa(); };

  const t = data?.total;
  const bb = data?.bulan_berjalan || 0;
  const rows = useMemo(() => (data?.rows || []).filter((r) => !cari || `${r.kode_rekening} ${r.nama}`.toLowerCase().includes(cari.toLowerCase())), [data, cari]);
  const persenKas = t?.rencana_sd ? (t.realisasi_sd / t.rencana_sd) * 100 : 0;
  const draf = (pa?.rows || []).filter((p) => p.status === 'draft').length;

  const otomatis = async (timpa) => {
    try {
      const r = await api.post('/api/anggaran-kas/otomatis', { skpd_id: skpdId, tahun, pola: 'triwulan', timpa });
      toast(`${r.jumlah} rekening diisi otomatis (belanja pegawai rata per bulan, lainnya mengikuti pola triwulan)`); reload();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={CalendarRange} title="Anggaran Kas & Perubahan Anggaran" subtitle="Rencana penarikan dana per bulan (dasar SPD), pergeseran antar-rekening, dan APBD Perubahan"
        actions={admin && <>
          {data?.belum_diisi > 0 ? <Button variant="gold" icon={Wand2} onClick={() => otomatis(false)}>Isi {data.belum_diisi} rekening otomatis</Button>
            : <Button variant="secondary" icon={Wand2} onClick={() => { if (window.confirm('Timpa seluruh anggaran kas dengan pola otomatis?')) otomatis(true); }}>Susun ulang otomatis</Button>}
          <Button icon={Plus} onClick={() => setBaru(true)}>Pergeseran / APBD-P</Button>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pagu anggaran" value={t ? compact(t.pagu) : '…'} sub={t && (t.pagu !== t.pagu_murni ? `Murni ${compact(t.pagu_murni)} · ${t.pagu > t.pagu_murni ? '+' : ''}${compact(t.pagu - t.pagu_murni)}` : 'Belum ada perubahan total')} icon={Scale} tone="brand" />
        <Stat label={`Rencana kas s.d. ${BULAN[Math.max(0, bb - 1)] || '-'}`} value={t ? compact(t.rencana_sd) : '…'} sub={t && `${t.pagu ? ((t.rencana_sd / t.pagu) * 100).toFixed(1) : 0}% dari pagu`} icon={Target} tone="violet" />
        <Stat label="Realisasi s.d. bulan ini" value={t ? compact(t.realisasi_sd) : '…'} sub={t && `${persenKas.toFixed(1)}% dari rencana kas`} icon={TrendingUp} tone={persenKas > 100 ? 'red' : 'green'}
          trend={t ? <Progress className="mt-2" value={Math.min(100, persenKas)} /> : null} />
        <Stat label="Melampaui anggaran kas" value={data ? data.melampaui.length : '…'} sub={data && (data.melampaui.length ? 'rekening perlu disesuaikan' : 'Semua dalam rencana')} icon={AlertTriangle} tone={data?.melampaui.length ? 'red' : 'green'} />
      </div>
      {data?.belum_diisi > 0 && <Alert tone="warn" title={`${data.belum_diisi} rekening belum memiliki anggaran kas`}>Isi rencana penarikan per bulan agar SPP dapat dicek terhadap anggaran kas dan SPD.</Alert>}
      {data?.melampaui.length > 0 && (
        <Alert tone="error" title="Realisasi melampaui anggaran kas">
          {data.melampaui.slice(0, 3).map((m) => `${m.nama} (lebih ${rp(m.lebih)})`).join('; ')}{data.melampaui.length > 3 ? '; …' : ''}. Geser anggaran kas bulan berikutnya atau tunda belanja.
        </Alert>
      )}

      <Card bodyClass="" title={{ grafik: 'Rencana vs realisasi kumulatif', matriks: 'Anggaran kas per rekening', perubahan: 'Pergeseran & APBD Perubahan' }[tab]}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'grafik', label: 'Grafik' }, { value: 'matriks', label: 'Per rekening' }, { value: 'perubahan', label: 'Perubahan', count: pa?.rows.length || undefined }]} />}>
        {tab === 'grafik' && (
          <div className="p-4">
            {!data ? <SkeletonRows rows={6} /> : (<>
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={data.kumulatif} margin={{ left: 4, right: 16, top: 8 }}>
                    <CartesianGrid vertical={false} stroke="rgb(var(--slate-100))" />
                    <XAxis dataKey="nama" tickLine={false} axisLine={{ stroke: 'rgb(var(--slate-300))' }} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} />
                    <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'rgb(var(--slate-500))' }} width={60} />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: 'rgb(var(--slate-300))', strokeDasharray: '3 3' }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: 'rgb(var(--slate-600))' }}>{v}</span>} />
                    <Line type="monotone" dataKey="rencana_kum" name="Rencana kas kumulatif" stroke={SERIES[0]} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'rgb(var(--surface))' }} />
                    <Line type="monotone" dataKey="realisasi_kum" name="Realisasi kumulatif" stroke={SERIES[2]} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: 'rgb(var(--surface))', fill: SERIES[2] }} activeDot={{ r: 5, strokeWidth: 2, stroke: 'rgb(var(--surface))' }} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[900px] text-xs">
                  <thead><tr><th className="th">Bulan</th>{BULAN_SINGKAT.map((b, i) => <th key={b} className={cx('th text-right', i + 1 === bb && 'text-brand-700')}>{b}</th>)}</tr></thead>
                  <tbody>
                    <tr><td className="td font-medium">Rencana</td>{data.kumulatif.map((k) => <td key={k.bulan} className="td num text-right">{compact(k.rencana)}</td>)}</tr>
                    <tr><td className="td font-medium">Realisasi</td>{data.kumulatif.map((k) => <td key={k.bulan} className={cx('td num text-right', k.realisasi != null && k.realisasi > k.rencana && 'text-rose-600')}>{k.realisasi != null ? compact(k.realisasi) : '-'}</td>)}</tr>
                    <tr className="bg-slate-50/60"><td className="td font-medium">Deviasi kumulatif</td>{data.kumulatif.map((k) => {
                      const dv = k.realisasi_kum != null ? k.realisasi_kum - k.rencana_kum : null;
                      return <td key={k.bulan} className={cx('td num text-right', dv > 0 ? 'text-rose-600' : 'text-slate-600')}>{dv != null ? `${dv > 0 ? '+' : ''}${compact(dv)}` : '-'}</td>;
                    })}</tr>
                  </tbody>
                </table>
              </div>
            </>)}
          </div>
        )}

        {tab === 'matriks' && (<>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Input className="w-64" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari kode / nama rekening" />
            <p className="text-xs text-slate-500">Angka atas: rencana. Angka bawah (s.d. {BULAN_SINGKAT[Math.max(0, bb - 1)]}): realisasi; merah bila melebihi rencana bulan itu.</p>
          </div>
          {loading && !data ? <SkeletonRows /> : !rows.length ? <Empty icon={CalendarRange} title="Belum ada pagu anggaran" text="Isi pagu anggaran di Data Master terlebih dahulu." /> : (
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full min-w-[1280px] text-xs">
                <thead className="sticky top-0 z-10"><tr><th className="th sticky left-0 z-20 min-w-[240px] bg-slate-50">Rekening</th><th className="th text-right">Pagu</th>
                  {BULAN_SINGKAT.map((b, i) => <th key={b} className={cx('th text-right', i + 1 === bb && 'text-brand-700')}>{b}</th>)}<th className="th text-right">Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.kode_rekening} className={cx('group hover:bg-brand-50/40', admin && 'cursor-pointer')} onClick={() => admin && setEdit(r)}>
                      <td className="td sticky left-0 z-[1] bg-surface group-hover:bg-brand-50">
                        <p className="line-clamp-1 text-[13px] text-slate-800">{r.nama}</p>
                        <p className="font-mono text-[11px] text-slate-500">{r.kode_rekening}{r.pagu !== r.pagu_murni && <span className="ml-1 text-violet-600">· diubah</span>}</p>
                      </td>
                      <td className="td num whitespace-nowrap text-right font-medium">{compact(r.pagu)}</td>
                      {r.rencana.map((v, i) => {
                        const real = r.realisasi[i];
                        return (
                          <td key={i} className={cx('td num whitespace-nowrap text-right', i + 1 === bb && 'bg-brand-50/50')}>
                            <p className="text-slate-700">{v ? compact(v) : '-'}</p>
                            {i < bb && <p className={cx('text-[10px]', real > v + 0.5 ? 'font-semibold text-rose-600' : 'text-slate-400')}>{real ? compact(real) : '0'}</p>}
                          </td>
                        );
                      })}
                      <td className="td text-right">
                        {!r.terisi ? <Badge color="amber">Kosong</Badge> : Math.abs(r.selisih_pagu) > 0.5 ? <Badge color="red">Selisih {compact(r.selisih_pagu)}</Badge>
                          : r.realisasi_sd > r.rencana_sd + 0.5 ? <Badge color="red">Melampaui</Badge> : <Badge color="green">Sesuai</Badge>}
                        {admin && <Pencil className="ml-1 inline h-3.5 w-3.5 text-slate-300 group-hover:text-brand-600" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>)}

        {tab === 'perubahan' && (
          <div className="p-4">
            {draf > 0 && <Alert className="mb-3" tone="info">{draf} dokumen masih draf. Pagu dan anggaran kas baru berubah setelah ditetapkan.</Alert>}
            {!pa?.rows.length ? <Empty icon={Scale} title="Belum ada pergeseran atau perubahan" text="Pergeseran memindahkan pagu antar-rekening dengan total tetap. APBD Perubahan menambah atau mengurangi total pagu."
              action={admin && <Button icon={Plus} onClick={() => setBaru(true)}>Buat dokumen</Button>} /> : (
              <div className="space-y-3">
                {pa.rows.map((p) => <DokPerubahan key={p.id} p={p} rekening={data?.rows || []} admin={admin} onChanged={muat} />)}
              </div>
            )}
          </div>
        )}
      </Card>

      <EditKas r={edit} onClose={() => setEdit(null)} onSaved={() => { toast('Anggaran kas disimpan'); reload(); }} />
      <FormPerubahan open={baru} rekening={data?.rows || []} onClose={() => setBaru(false)} onSaved={(p) => { toast(p.status === 'ditetapkan' ? `${p.nomor} ditetapkan. Pagu dan anggaran kas diperbarui.` : `${p.nomor} disimpan sebagai draf`); setTab('perubahan'); muat(); }} />
    </div>
  );
}

function DokPerubahan({ p, rekening, admin, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const nama = (k) => rekening.find((r) => r.kode_rekening === k)?.nama || k;
  const delta = p.rincian.reduce((s, r) => s + (Number(r.pagu_baru) - Number(r.pagu_lama)), 0);
  const jalankan = async (aksi) => {
    setBusy(true);
    try {
      if (aksi === 'tetapkan') { await api.post(`/api/perubahan-anggaran/${p.id}/tetapkan`); toast(`${p.nomor} ditetapkan`); } else { await api.del(`/api/perubahan-anggaran/${p.id}`); toast('Draf dihapus'); }
      onChanged();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className={cx('rounded-xl border p-4', p.status === 'draft' ? 'border-dashed border-slate-300' : 'border-slate-200')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge color={p.jenis === 'pergeseran' ? 'blue' : 'violet'}>{p.jenis === 'pergeseran' ? 'Pergeseran' : 'APBD Perubahan'}</Badge>
            <span className="font-mono text-xs text-slate-700">{p.nomor}</span>
            <Badge color={p.status === 'ditetapkan' ? 'green' : 'amber'}>{p.status === 'ditetapkan' ? 'Ditetapkan' : 'Draf'}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-800">{p.uraian || '-'}</p>
          <p className="text-[11px] text-slate-500">{tgl(p.tanggal)}{p.dasar && ` · ${p.dasar}`} · dibuat {p.dibuat_oleh}{p.ditetapkan_at && ` · ditetapkan ${waktu(p.ditetapkan_at)}`}</p>
        </div>
        <div className="flex items-center gap-2">
          <p className={cx('num text-sm font-semibold', delta > 0 ? 'text-emerald-700' : delta < 0 ? 'text-rose-600' : 'text-slate-600')}>{delta === 0 ? 'Total tetap' : `${delta > 0 ? '+' : ''}${rp(delta)}`}</p>
          {admin && p.status === 'draft' && (<>
            <Button size="sm" icon={Stamp} loading={busy} onClick={() => jalankan('tetapkan')}>Tetapkan</Button>
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => jalankan('hapus')} aria-label="Hapus draf" />
          </>)}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] text-xs">
          <thead><tr><th className="th">Rekening</th><th className="th text-right">Pagu semula</th><th className="th" /><th className="th text-right">Pagu menjadi</th><th className="th text-right">Bertambah/(berkurang)</th></tr></thead>
          <tbody>{p.rincian.map((r) => {
            const d = Number(r.pagu_baru) - Number(r.pagu_lama);
            return (
              <tr key={r.kode_rekening}>
                <td className="td"><p className="text-slate-800">{nama(r.kode_rekening)}</p><p className="font-mono text-[10px] text-slate-500">{r.kode_rekening}{r.alasan && ` · ${r.alasan}`}</p></td>
                <td className="td num text-right">{money(r.pagu_lama)}</td><td className="td text-center text-slate-300"><ArrowRight className="inline h-3.5 w-3.5" /></td>
                <td className="td num text-right font-medium">{money(r.pagu_baru)}</td>
                <td className={cx('td num text-right', d > 0 ? 'text-emerald-700' : d < 0 ? 'text-rose-600' : '')}>{d < 0 ? `(${money(-d)})` : money(d)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

function EditKas({ r, onClose, onSaved }) {
  const { skpdId, tahun } = useApp();
  const [v, setV] = useState([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (r) { setV([...r.rencana]); setErr(''); } }, [r]);
  if (!r) return null;
  const total = v.reduce((s, x) => s + Number(x || 0), 0);
  const selisih = r.pagu - total;
  const pola = (bobot) => {
    const out = bobot.map((b) => Math.floor((r.pagu * b) / 1000) * 1000);
    out[11] = Math.round((r.pagu - out.slice(0, 11).reduce((s, x) => s + x, 0)) * 100) / 100;
    setV(out);
  };
  const simpan = async () => {
    setBusy(true); setErr('');
    try { await api.put('/api/anggaran-kas', { skpd_id: skpdId, tahun, kode_rekening: r.kode_rekening, rencana: v }); onSaved(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open size="lg" onClose={onClose} title="Ubah anggaran kas" subtitle={`${r.kode_rekening} · ${r.nama} · pagu ${rp(r.pagu)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} disabled={Math.abs(selisih) > 0.5} onClick={simpan}>Simpan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => pola(Array(12).fill(1 / 12))}>Bagi rata 12 bulan</Button>
          <Button size="sm" variant="secondary" onClick={() => pola([4, 5, 6, 7, 8, 9, 9, 10, 10, 10, 11, 11].map((x) => x / 100))}>Pola triwulan (naik di akhir tahun)</Button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {v.map((x, i) => (
            <Field key={i} label={BULAN[i]} hint={r.realisasi[i] ? `Realisasi ${compact(r.realisasi[i])}` : undefined}>
              <MoneyInput value={x} onChange={(n) => setV((a) => a.map((y, j) => (j === i ? n : y)))} />
            </Field>
          ))}
        </div>
        <div className={cx('flex items-center justify-between rounded-xl p-3 text-sm', Math.abs(selisih) > 0.5 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>
          <span>Jumlah {rp(total)}</span><span className="font-semibold">{Math.abs(selisih) > 0.5 ? `Selisih dengan pagu ${rp(selisih)}` : 'Sama dengan pagu'}</span>
        </div>
      </div>
    </Modal>
  );
}

function FormPerubahan({ open, rekening, onClose, onSaved }) {
  const { skpdId, tahun } = useApp();
  const [f, setF] = useState({});
  const [rinci, setRinci] = useState([]);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { if (open) { setErr(''); setF({ jenis: 'pergeseran', tanggal: today(), nomor: '', dasar: '', uraian: '' }); setRinci([{ kode_rekening: '', pagu_baru: 0, alasan: '' }, { kode_rekening: '', pagu_baru: 0, alasan: '' }]); } }, [open]);
  const pagu = (k) => rekening.find((r) => r.kode_rekening === k)?.pagu || 0;
  const real = (k) => rekening.find((r) => r.kode_rekening === k)?.total_realisasi || 0;
  const delta = rinci.filter((r) => r.kode_rekening).reduce((s, r) => s + (Number(r.pagu_baru) - pagu(r.kode_rekening)), 0);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const ubah = (i, k, v) => setRinci((a) => a.map((r, j) => (j === i ? { ...r, [k]: v, ...(k === 'kode_rekening' ? { pagu_baru: pagu(v) } : {}) } : r)));
  const simpan = async (tetapkan) => {
    setBusy(tetapkan ? 'tetap' : 'draf'); setErr('');
    try {
      const r = await api.post('/api/perubahan-anggaran', { ...f, skpd_id: skpdId, tahun, tetapkan, rincian: rinci.filter((x) => x.kode_rekening) });
      onSaved(r.row); onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  if (!open) return null;
  return (
    <Modal open size="lg" onClose={onClose} title="Pergeseran / APBD Perubahan" subtitle="Bulan yang sudah lewat tidak berubah; sisa anggaran kas disesuaikan otomatis secara proporsional saat ditetapkan."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant="secondary" loading={busy === 'draf'} onClick={() => simpan(false)}>Simpan draf</Button>
        <Button icon={Stamp} loading={busy === 'tetap'} disabled={f.jenis === 'pergeseran' && Math.abs(delta) > 0.5} onClick={() => simpan(true)}>Simpan & tetapkan</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Jenis"><Select value={f.jenis} onChange={set('jenis')} options={[{ value: 'pergeseran', label: 'Pergeseran (total tetap)' }, { value: 'perubahan', label: 'APBD Perubahan' }]} /></Field>
          <Field label="Tanggal"><Input type="date" value={f.tanggal || ''} onChange={set('tanggal')} /></Field>
          <Field label="Nomor" hint="Kosongkan untuk otomatis"><Input value={f.nomor || ''} onChange={set('nomor')} /></Field>
        </div>
        <Field label="Dasar hukum"><Input value={f.dasar || ''} onChange={set('dasar')} placeholder="mis. Perkada No. … tentang Perubahan Penjabaran APBD" /></Field>
        <Field label="Uraian"><Textarea value={f.uraian || ''} onChange={set('uraian')} /></Field>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800">Rincian rekening</p>
          {rinci.map((r, i) => (
            <div key={i} className="grid items-end gap-2 rounded-xl bg-slate-50 p-2 sm:grid-cols-[1fr_170px_auto]">
              <Field label={`Rekening ${i + 1}`} hint={r.kode_rekening ? `Pagu ${rp(pagu(r.kode_rekening))} · realisasi ${rp(real(r.kode_rekening))}` : undefined}>
                <Combo value={r.kode_rekening} onChange={(v) => ubah(i, 'kode_rekening', v)} placeholder="Pilih rekening" options={rekening.map((x) => ({ value: x.kode_rekening, label: x.nama, hint: x.kode_rekening }))} />
              </Field>
              <Field label="Pagu menjadi" hint={r.kode_rekening ? `${Number(r.pagu_baru) - pagu(r.kode_rekening) >= 0 ? '+' : ''}${compact(Number(r.pagu_baru) - pagu(r.kode_rekening))}` : undefined}>
                <MoneyInput value={r.pagu_baru} onChange={(v) => ubah(i, 'pagu_baru', v)} />
              </Field>
              <button type="button" className="mb-2 p-1 text-slate-400 hover:text-rose-600" aria-label="Hapus baris" onClick={() => setRinci((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRinci((a) => [...a, { kode_rekening: '', pagu_baru: 0, alasan: '' }])}>Tambah rekening</Button>
        </div>
        <div className={cx('flex items-center justify-between rounded-xl p-3 text-sm', f.jenis === 'pergeseran' && Math.abs(delta) > 0.5 ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-700')}>
          <span>Perubahan total pagu</span>
          <span className="num font-semibold">{delta > 0 ? '+' : ''}{rp(delta)}{f.jenis === 'pergeseran' && Math.abs(delta) > 0.5 && ' (pergeseran harus nol)'}</span>
        </div>
      </div>
    </Modal>
  );
}
