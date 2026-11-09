import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Plus, QrCode, ScanLine, Download, Printer, ClipboardCheck, Flag, Pencil, MapPin, History, Wallet, AlertTriangle, CalendarClock } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Combo, Empty, Field, Input, Modal, MoneyInput, PageHeader, Pagination, Progress, SearchInput, Select, SkeletonRows, Stat, Textarea, cx, useLoad, useToast } from '../components/ui.jsx';
import { money, rp, tgl, waktu } from '../lib/format.js';

export const KONDISI_WARNA = { B: 'green', RR: 'amber', RB: 'red' };
const STATUS_WARNA = { aktif: 'blue', dipindahkan: 'violet', diusulkan_hapus: 'amber', dihapus: 'slate' };

/** Daftar aset (KIB) dengan QR Code unik per aset, cetak label, dan inventarisasi fisik. */
export default function Aset() {
  const { skpdId, can } = useApp();
  const toast = useToast();
  const tulis = can('admin', 'bendahara');
  const [f, setF] = useState({ q: '', kondisi: '', lokasi: '', kode: '', diperiksa: '' });
  const [page, setPage] = useState(1);
  const [pilih, setPilih] = useState(new Set());
  const [buka, setBuka] = useState(null);
  const [form, setForm] = useState(null);
  const [mulai, setMulai] = useState(false);
  const meta = useLoad(() => api.get('/api/aset/meta'), []);
  const { data, loading, reload } = useLoad(() => skpdId && api.get('/api/aset', { skpd_id: skpdId, ...f, page, limit: 25 }), [skpdId, f.q, f.kondisi, f.lokasi, f.kode, f.diperiksa, page]);
  const inv = useLoad(() => skpdId && api.get('/api/inventarisasi', { skpd_id: skpdId }), [skpdId]);
  const set = (k, v) => { setF({ ...f, [k]: v }); setPage(1); };
  const r = data?.ringkasan;
  const berjalan = inv.data?.berjalan;
  const muat = () => { reload(); inv.reload(); };

  const cetakLabel = async (ids) => {
    try {
      const { rows } = await api.post('/api/aset/label', { ids: [...ids], origin: window.location.origin });
      const w = window.open('', '_blank');
      if (!w) { toast('Izinkan pop-up untuk mencetak label', 'error'); return; }
      const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Label aset</title><style>
        body{font-family:Arial,sans-serif;margin:8mm}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
        .l{border:1px solid #333;border-radius:2mm;padding:2.5mm;display:flex;gap:2.5mm;align-items:center;break-inside:avoid;height:28mm}
        .q{width:24mm;height:24mm;flex:none}.q svg{width:100%;height:100%}.t{font-size:7.5pt;line-height:1.25;min-width:0}
        .k{font-family:monospace;font-size:8pt;font-weight:bold}.n{font-weight:bold;font-size:8.5pt}.s{color:#555;font-size:6.5pt}
        @media print{body{margin:6mm}}</style></head><body><div class="g">${rows.map((x) => `<div class="l"><div class="q">${x.svg}</div><div class="t">
        <div class="s">${esc(x.skpd_nama)}</div><div class="k">${esc(x.kode_barang)} / ${String(x.nup).padStart(4, '0')}</div><div class="n">${esc(x.nama)}</div>
        <div>Th. ${esc(x.tahun_perolehan)} · ${esc(x.lokasi || '-')}</div><div class="s">Pindai untuk cek fisik · ${esc(x.kode_qr)}</div></div></div>`).join('')}</div>
        <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
      w.document.close();
    } catch (e) { toast(e.message, 'error'); }
  };
  const selesai = async () => {
    if (!window.confirm(`Selesaikan inventarisasi? ${berjalan.progres.belum} aset belum diperiksa akan tercatat sebagai tidak ditemukan saat inventarisasi.`)) return;
    try { await api.post(`/api/inventarisasi/${berjalan.id}/selesai`, {}); toast('Inventarisasi diselesaikan'); muat(); } catch (e) { toast(e.message, 'error'); }
  };
  const semuaHalaman = data?.rows.every((a) => pilih.has(a.id));

  return (
    <div className="space-y-4">
      <PageHeader icon={Boxes} title="Aset & QR Code" subtitle="Setiap aset memiliki QR Code unik; pindai dengan kamera ponsel untuk melihat identitas dan mencatat pemeriksaan fisik"
        actions={<>
          <Link to="/aset/pindai"><Button icon={ScanLine}>Pindai QR</Button></Link>
          <Button variant="secondary" icon={Download} onClick={() => download('/api/aset', { params: { skpd_id: skpdId, ...f, format: 'xlsx' } }).catch((e) => toast(e.message, 'error'))}>KIB Excel</Button>
          {tulis && <Button variant="secondary" icon={Plus} onClick={() => setForm({ kondisi: 'B', jumlah: 1, cara_perolehan: 'pembelian', sumber_dana: 'APBD', tahun_perolehan: new Date().getFullYear() })}>Tambah aset</Button>}
        </>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Jumlah aset" value={r ? r.jumlah.toLocaleString('id-ID') : '…'} sub={r && `${r.lokasi} lokasi`} icon={Boxes} />
        <Stat label="Nilai perolehan" value={r ? rp(r.nilai) : '…'} icon={Wallet} tone="violet" />
        <Stat label="Kondisi" value={r ? `${r.baik} baik` : '…'} sub={r && <><span className="text-amber-700">{r.rusak_ringan} rusak ringan</span> · <span className="text-rose-700">{r.rusak_berat} rusak berat</span></>} icon={AlertTriangle} tone={r?.rusak_berat ? 'amber' : 'green'} />
        <Stat label="Belum diperiksa > 1 tahun" value={r ? r.belum_diperiksa_setahun : '…'} sub="Perlu pemeriksaan fisik" icon={CalendarClock} tone={r?.belum_diperiksa_setahun ? 'red' : 'green'} />
      </div>

      <Card title={berjalan ? berjalan.nama : 'Inventarisasi fisik'} subtitle={berjalan ? `Dimulai ${tgl(berjalan.tanggal_mulai)} oleh ${berjalan.dibuat_nama}` : 'Tidak ada inventarisasi yang berjalan'}
        actions={tulis && (berjalan ? <Button size="sm" variant="secondary" icon={Flag} onClick={selesai}>Selesaikan</Button> : <Button size="sm" icon={ClipboardCheck} onClick={() => setMulai(true)}>Mulai inventarisasi</Button>)}>
        {berjalan ? (
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="flex items-baseline justify-between text-sm"><span>{berjalan.progres.diperiksa} dari {berjalan.progres.total} aset sudah dipindai/diperiksa</span><b className="num">{berjalan.progres.persen}%</b></div>
              <Progress value={berjalan.progres.persen} className="my-2 h-3" />
              <div className="flex flex-wrap gap-2 text-xs"><Badge color="slate">Belum: {berjalan.progres.belum}</Badge><Badge color="amber">Beda lokasi: {berjalan.progres.beda_lokasi}</Badge><Badge color="red">Rusak: {berjalan.progres.rusak}</Badge>
                <button type="button" className="text-brand-700 underline" onClick={() => set('diperiksa', '')}>Lihat daftar di bawah</button></div>
            </div>
            <Link to="/aset/pindai"><Button icon={ScanLine}>Lanjut pindai</Button></Link>
          </div>
        ) : <p className="text-sm text-slate-500">Mulai inventarisasi untuk merekam hasil pemindaian QR per aset (kondisi dan kesesuaian lokasi) sebagai satu kegiatan pemeriksaan fisik.</p>}
      </Card>

      <Card bodyClass="p-0">
        <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <SearchInput value={f.q} onChange={(v) => set('q', v)} placeholder="Cari nama, merk, no. seri, lokasi" />
          <Select value={f.kode} onChange={(e) => set('kode', e.target.value)} options={[{ value: '', label: 'Semua jenis barang' }, ...(meta.data?.kode_barang || []).map(([value, label]) => ({ value, label: `${value} · ${label}` }))]} />
          <Select value={f.kondisi} onChange={(e) => set('kondisi', e.target.value)} options={[{ value: '', label: 'Semua kondisi' }, ...Object.entries(meta.data?.kondisi || {}).map(([value, label]) => ({ value, label }))]} />
          <Select value={f.lokasi} onChange={(e) => set('lokasi', e.target.value)} options={[{ value: '', label: 'Semua lokasi' }, ...(data?.lokasi || []).map((l) => ({ value: l.lokasi, label: `${l.lokasi} (${l.n})` }))]} />
          <Select value={f.diperiksa} onChange={(e) => set('diperiksa', e.target.value)} options={[{ value: '', label: 'Semua status pemeriksaan' }, { value: 'belum', label: 'Belum diperiksa > 1 tahun' }]} />
        </div>
        {pilih.size > 0 && <div className="flex items-center gap-2 border-b border-slate-100 bg-brand-50/60 px-4 py-2 text-xs"><b>{pilih.size} aset dipilih</b><Button size="sm" icon={Printer} onClick={() => cetakLabel(pilih)}>Cetak label QR</Button><button type="button" className="text-slate-500 underline" onClick={() => setPilih(new Set())}>Batal</button></div>}
        {loading && !data ? <SkeletonRows rows={8} cols={6} /> : !data?.rows.length ? <Empty icon={Boxes} title="Belum ada aset" text="Tambahkan aset manual atau dari transaksi belanja modal (5.2) di BKU." /> : <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr>
                <th className="th w-8"><input type="checkbox" checked={semuaHalaman} onChange={() => setPilih((s) => { const n = new Set(s); data.rows.forEach((a) => (semuaHalaman ? n.delete(a.id) : n.add(a.id))); return n; })} aria-label="Pilih semua" /></th>
                <th className="th">Kode / NUP</th><th className="th">Nama barang</th><th className="th">Tahun</th><th className="th text-right">Harga perolehan</th><th className="th">Lokasi</th><th className="th">Kondisi</th><th className="th">Diperiksa</th>
              </tr></thead>
              <tbody>{data.rows.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setBuka(a.id)}>
                  <td className="td" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={pilih.has(a.id)} onChange={() => setPilih((s) => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} aria-label={`Pilih ${a.nama}`} /></td>
                  <td className="td whitespace-nowrap font-mono text-xs">{a.kode_barang}<p className="text-[10px] text-slate-500">NUP {String(a.nup).padStart(4, '0')}</p></td>
                  <td className="td"><p className="font-medium text-slate-800">{a.nama}</p><p className="text-[11px] text-slate-500">{a.merk_tipe}{a.bku_no_urut ? ` · BKU No. ${a.bku_no_urut}` : ''}</p></td>
                  <td className="td text-xs">{a.tahun_perolehan}</td><td className="td num text-right text-xs">{money(a.harga_perolehan)}</td>
                  <td className="td text-xs">{a.lokasi || '-'}{a.pemeriksaan_terakhir?.sesuai_lokasi === false && <p className="text-[10px] text-amber-700">Ditemukan di {a.pemeriksaan_terakhir.lokasi}</p>}</td>
                  <td className="td"><Badge color={KONDISI_WARNA[a.kondisi]}>{meta.data?.kondisi[a.kondisi]}</Badge>{a.status !== 'aktif' && <Badge color={STATUS_WARNA[a.status]} className="ml-1">{meta.data?.status[a.status]}</Badge>}</td>
                  <td className="td text-xs">{a.terakhir_diperiksa ? tgl(a.terakhir_diperiksa) : <span className="text-rose-600">Belum</span>}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} />
        </>}
      </Card>
      <DetailAset id={buka} meta={meta.data} tulis={tulis} onClose={() => setBuka(null)} onEdit={(a) => { setBuka(null); setForm({ ...a, harga_perolehan: Number(a.harga_perolehan) }); }} onLabel={(id) => cetakLabel([id])} onChanged={muat} />
      <FormAset data={form} meta={meta.data} onClose={() => setForm(null)} onDone={(n) => { toast(n > 1 ? `${n} aset terdaftar dengan QR masing-masing` : 'Aset tersimpan'); muat(); }} />
      <MulaiInventarisasi open={mulai} onClose={() => setMulai(false)} onDone={() => { toast('Inventarisasi dimulai'); muat(); }} />
    </div>
  );
}

export function KartuAset({ a, meta, umur }) {
  const baris = [['Kode barang', <span className="font-mono">{a.kode_barang} / NUP {String(a.nup).padStart(4, '0')}</span>], ['Merk / tipe', a.merk_tipe], ['No. seri', a.nomor_seri],
    ['Tahun perolehan', `${a.tahun_perolehan}${umur != null ? ` (umur ${umur} th)` : ''}`], ['Tanggal perolehan', a.tanggal_perolehan && tgl(a.tanggal_perolehan)], ['Harga perolehan', <b className="num">{rp(a.harga_perolehan)}</b>],
    ['Cara / sumber dana', [a.cara_perolehan, a.sumber_dana].filter(Boolean).join(' · ')], ['Lokasi', a.lokasi], ['Penanggung jawab', a.penanggung_jawab],
    ['Kondisi', <Badge color={KONDISI_WARNA[a.kondisi]}>{meta?.kondisi[a.kondisi] || a.kondisi}</Badge>], ['Status', meta?.status[a.status] || a.status],
    ['Asal transaksi', a.bku_no_urut ? `BKU No. ${a.bku_no_urut} · ${a.bku_no_bukti} · ${tgl(a.bku_tanggal)}` : null], ['Keterangan', a.keterangan]];
  return <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-sm">{baris.filter(([, v]) => v).map(([k, v]) => [<dt key={`${k}t`} className="text-xs text-slate-500">{k}</dt>, <dd key={`${k}d`} className="text-slate-800">{v}</dd>])}</dl>;
}

export function RiwayatPeriksa({ rows, meta }) {
  if (!rows?.length) return <p className="text-xs text-slate-500">Belum pernah diperiksa.</p>;
  return (
    <ul className="space-y-1.5">{rows.map((p) => (
      <li key={p.id} className="rounded-lg border border-slate-100 px-3 py-2 text-xs">
        <p><Badge color={KONDISI_WARNA[p.kondisi]}>{meta?.kondisi[p.kondisi]}</Badge> <span className="ml-1">{p.lokasi}</span>{p.sesuai_lokasi === false && <Badge color="amber" className="ml-1">Beda lokasi</Badge>}{p.cara === 'qr' && <Badge color="blue" className="ml-1">QR</Badge>}</p>
        <p className="mt-0.5 text-slate-500">{p.oleh_nama} · {waktu(p.waktu)}{p.inventarisasi_nama ? ` · ${p.inventarisasi_nama}` : ''}{p.catatan ? ` — “${p.catatan}”` : ''}</p>
      </li>))}</ul>
  );
}

function DetailAset({ id, meta, tulis, onClose, onEdit, onLabel, onChanged }) {
  const { data, reload } = useLoad(() => id && api.get(`/api/aset/${id}`), [id]);
  const [periksa, setPeriksa] = useState(false);
  if (!id) return null;
  const a = data?.aset;
  return (
    <Modal open size="lg" onClose={onClose} title={a ? a.nama : 'Memuat…'} subtitle={a && `${a.skpd_nama}`}
      footer={a && <>{tulis && <Button variant="secondary" icon={Pencil} onClick={() => onEdit(a)}>Ubah</Button>}<Button variant="secondary" icon={Printer} onClick={() => onLabel(a.id)}>Cetak label</Button><Button icon={ClipboardCheck} onClick={() => setPeriksa(true)}>Catat pemeriksaan</Button></>}>
      {!a ? <SkeletonRows rows={6} cols={2} /> : (
        <div className="grid gap-5 md:grid-cols-[1fr_200px]">
          <div className="space-y-4"><KartuAset a={a} meta={meta} umur={new Date().getFullYear() - a.tahun_perolehan} />
            <div><p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-700"><History className="h-3.5 w-3.5" />Riwayat pemeriksaan fisik</p><RiwayatPeriksa rows={data.riwayat} meta={meta} /></div></div>
          <div className="text-center">
            <img src={`/api/aset/${a.id}/qr`} alt={`QR ${a.kode_qr}`} className="mx-auto w-full max-w-[200px] rounded-lg border border-slate-200 bg-white p-2" />
            <p className="mt-1 flex items-center justify-center gap-1 font-mono text-[11px] text-slate-500"><QrCode className="h-3 w-3" />{a.kode_qr}</p>
            <p className="mt-1 text-[10px] text-slate-400">QR berisi tautan {window.location.host}/a/{a.kode_qr}</p>
          </div>
        </div>
      )}
      <PeriksaModal open={periksa} aset={a} meta={meta} cara="manual" onClose={() => setPeriksa(false)} onDone={() => { reload(); onChanged(); }} />
    </Modal>
  );
}

export function PeriksaModal({ open, aset, meta, cara = 'qr', onClose, onDone, inline = false }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!open || !aset) return null;
  const v = f || { kondisi: aset.kondisi, lokasi: aset.lokasi || '', catatan: '', perbarui_lokasi: false };
  const beda = (aset.lokasi || '').trim().toLowerCase() !== v.lokasi.trim().toLowerCase();
  const kirim = async () => {
    setBusy(true);
    try { await api.post(`/api/aset/${aset.id}/periksa`, { ...v, cara }); toast('Hasil pemeriksaan tercatat'); setF(null); onDone?.(); onClose?.(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const isi = (
    <div className="space-y-3">
      <Field label="Kondisi saat diperiksa">
        <div className="grid grid-cols-3 gap-2">{Object.entries(meta?.kondisi || {}).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setF({ ...v, kondisi: k })} className={cx('rounded-xl border-2 px-2 py-2.5 text-sm font-medium transition', v.kondisi === k ? { B: 'border-emerald-500 bg-emerald-50 text-emerald-800', RR: 'border-amber-500 bg-amber-50 text-amber-800', RB: 'border-rose-500 bg-rose-50 text-rose-800' }[k] : 'border-slate-200 text-slate-600')}>{l}</button>))}</div>
      </Field>
      <Field label="Lokasi ditemukan"><div className="relative"><MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="pl-9" value={v.lokasi} onChange={(e) => setF({ ...v, lokasi: e.target.value })} /></div></Field>
      {beda && <label className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"><input type="checkbox" checked={v.perbarui_lokasi} onChange={(e) => setF({ ...v, perbarui_lokasi: e.target.checked })} />Lokasi berbeda dari kartu aset ({aset.lokasi || '-'}). Perbarui lokasi di kartu aset?</label>}
      <Field label="Catatan"><Textarea value={v.catatan} onChange={(e) => setF({ ...v, catatan: e.target.value })} placeholder="mis. layar retak, label pudar" /></Field>
    </div>
  );
  if (inline) return <div>{isi}<Button className="mt-3 w-full" icon={ClipboardCheck} loading={busy} onClick={kirim}>Simpan hasil pemeriksaan</Button></div>;
  return <Modal open size="sm" onClose={onClose} title="Catat pemeriksaan fisik" subtitle={aset.nama} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={kirim}>Simpan</Button></>}>{isi}</Modal>;
}

function FormAset({ data, meta, onClose, onDone }) {
  const { skpdId } = useApp();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const kandidat = useLoad(() => data && !data.id && skpdId && api.get('/api/aset/kandidat-bku', { skpd_id: skpdId }), [Boolean(data), skpdId]);
  if (!data) return null;
  const v = f || data;
  const s = (k, x) => setF({ ...v, [k]: x });
  const tutup = () => { setF(null); onClose(); };
  const dariBku = (id) => {
    const e = kandidat.data?.rows.find((x) => String(x.id) === String(id));
    if (!e) { setF({ ...v, bku_entry_id: '' }); return; }
    setF({ ...v, bku_entry_id: e.id, nama: v.nama || e.uraian.replace(/^Belanja Modal\s*/i, ''), harga_perolehan: Number(e.pengeluaran) / (Number(v.jumlah) || 1), tanggal_perolehan: e.tanggal, tahun_perolehan: Number(e.tanggal.slice(0, 4)), sumber_dana: 'APBD', cara_perolehan: 'pembelian' });
  };
  const simpan = async () => {
    setBusy(true);
    try {
      if (v.id) { await api.put(`/api/aset/${v.id}`, v); onDone(1); } else { const r = await api.post('/api/aset', { ...v, skpd_id: skpdId }); onDone(r.rows.length); }
      tutup();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open size="lg" onClose={tutup} title={v.id ? 'Ubah aset' : 'Tambah aset'} subtitle={v.id ? `${v.kode_barang} / NUP ${v.nup}` : 'QR Code unik dibuat otomatis untuk setiap unit'}
      footer={<><Button variant="secondary" onClick={tutup}>Batal</Button><Button loading={busy} onClick={simpan}>Simpan</Button></>}>
      {!v.id && kandidat.data?.rows.length > 0 && (
        <Field label="Dari transaksi belanja modal di BKU (opsional)" hint="Menautkan aset ke bukti perolehannya" className="mb-3">
          <Select value={v.bku_entry_id || ''} onChange={(e) => dariBku(e.target.value)} options={[{ value: '', label: '— tanpa tautan BKU —' }, ...kandidat.data.rows.map((e) => ({ value: e.id, label: `No. ${e.no_urut} · ${tgl(e.tanggal)} · ${e.uraian} · ${rp(e.pengeluaran)}` }))]} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jenis barang (kode 1.3)"><Combo value={v.kode_barang || ''} onChange={(x) => s('kode_barang', x)} options={(meta?.kode_barang || []).map(([value, label]) => ({ value, label: `${value} · ${label}` }))} /></Field>
        <Field label="Nama barang"><Input value={v.nama || ''} onChange={(e) => s('nama', e.target.value)} /></Field>
        <Field label="Merk / tipe"><Input value={v.merk_tipe || ''} onChange={(e) => s('merk_tipe', e.target.value)} /></Field>
        <Field label="Nomor seri"><Input value={v.nomor_seri || ''} onChange={(e) => s('nomor_seri', e.target.value)} /></Field>
        <Field label="Tahun perolehan"><Input type="number" value={v.tahun_perolehan || ''} onChange={(e) => s('tahun_perolehan', e.target.value)} /></Field>
        <Field label="Tanggal perolehan"><Input type="date" value={v.tanggal_perolehan || ''} onChange={(e) => s('tanggal_perolehan', e.target.value)} /></Field>
        <Field label="Harga perolehan per unit"><MoneyInput value={v.harga_perolehan || 0} onChange={(x) => s('harga_perolehan', x)} /></Field>
        <Field label="Sumber dana"><Input value={v.sumber_dana || ''} onChange={(e) => s('sumber_dana', e.target.value)} /></Field>
        <Field label="Lokasi"><Input value={v.lokasi || ''} onChange={(e) => s('lokasi', e.target.value)} placeholder="mis. Gedung A Lt.2 - Bidang Perbendaharaan" /></Field>
        <Field label="Penanggung jawab"><Input value={v.penanggung_jawab || ''} onChange={(e) => s('penanggung_jawab', e.target.value)} /></Field>
        <Field label="Kondisi"><Select value={v.kondisi} onChange={(e) => s('kondisi', e.target.value)} options={Object.entries(meta?.kondisi || {}).map(([value, label]) => ({ value, label }))} /></Field>
        {v.id ? <Field label="Status"><Select value={v.status} onChange={(e) => s('status', e.target.value)} options={Object.entries(meta?.status || {}).map(([value, label]) => ({ value, label }))} /></Field>
          : <Field label="Jumlah unit" hint="Barang sejenis didaftarkan per unit dengan NUP dan QR sendiri"><Input type="number" min={1} max={100} value={v.jumlah || 1} onChange={(e) => s('jumlah', e.target.value)} /></Field>}
      </div>
      {v.id && v.status !== data.status && <Field label="Alasan perubahan status" className="mt-3"><Input value={v.alasan || ''} onChange={(e) => s('alasan', e.target.value)} placeholder="mis. nomor SK penghapusan" /></Field>}
      <Field label="Keterangan" className="mt-3"><Textarea value={v.keterangan || ''} onChange={(e) => s('keterangan', e.target.value)} /></Field>
      {!v.id && Number(v.jumlah) > 1 && <Alert className="mt-3">Akan dibuat {v.jumlah} kartu aset dengan total nilai {rp((Number(v.harga_perolehan) || 0) * Number(v.jumlah))}.</Alert>}
    </Modal>
  );
}

function MulaiInventarisasi({ open, onClose, onDone }) {
  const { skpdId } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ nama: `Inventarisasi fisik ${new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`, catatan: '' });
  if (!open) return null;
  const kirim = async () => { try { await api.post('/api/inventarisasi', { ...f, skpd_id: skpdId }); onDone(); onClose(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Modal open size="sm" onClose={onClose} title="Mulai inventarisasi" footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button onClick={kirim}>Mulai</Button></>}>
      <Field label="Nama kegiatan"><Input value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} /></Field>
      <Field label="Catatan" className="mt-3"><Textarea value={f.catatan} onChange={(e) => setF({ ...f, catatan: e.target.value })} placeholder="mis. per ruangan, tim pemeriksa" /></Field>
    </Modal>
  );
}
