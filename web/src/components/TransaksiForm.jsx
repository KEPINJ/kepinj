import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Calculator, Info } from 'lucide-react';
import { potonganBelanja, JENIS_BELANJA, pph21HonorASN, pph21BukanPegawai } from '@shared/tax.js';
import { terbilang } from '@shared/terbilang.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Button, Combo, Field, Input, Modal, MoneyInput, Select, Textarea, useToast, cx } from './ui.jsx';
import { rp, today, JENIS_PAJAK } from '../lib/format.js';

const MASUK = ['SALDO_AWAL', 'SP2D_UP', 'SP2D_GU', 'SP2D_TU', 'SP2D_LS', 'PENERIMAAN'];
const KELUAR = ['BELANJA', 'PAJAK_SETOR', 'PENYETORAN'];
const empty = () => ({ tanggal: today(), jenis: 'BELANJA', no_bukti: '', uraian: '', kode_rekening: '', rekanan_id: '', nilai: 0, arah: 'pengeluaran', metode: 'bank', no_sp2d: '' });

export default function TransaksiForm({ open, onClose, onSaved }) {
  const { skpdId, tahun } = useApp();
  const toast = useToast();
  const [f, setF] = useState(empty());
  const [ref, setRef] = useState({ jenis: {}, rekening: [], rekanan: [], realisasi: [], objek: [] });
  const [pajak, setPajak] = useState([]);
  const [auto, setAuto] = useState({ aktif: true, jenis: 'barang', termasukPPN: true, pkp: true, punyaNpwp: true, honor: 'asn', golongan: 'III' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(empty()); setPajak([]); setErr('');
    Promise.all([
      api.get('/api/bku/meta'), api.get('/api/master/rekening'), api.get('/api/master/rekanan'),
      api.get('/api/laporan/realisasi', { skpd_id: skpdId, tahun }), api.get('/api/pajak/referensi'),
    ]).then(([m, r, k, real, pr]) => setRef({ jenis: m.jenis, rekening: r.rows, rekanan: k.rows, realisasi: real.rows, objek: pr.objek })).catch((e) => setErr(e.message));
  }, [open, skpdId, tahun]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const arah = MASUK.includes(f.jenis) ? 'penerimaan' : KELUAR.includes(f.jenis) ? 'pengeluaran' : f.arah;
  const isBelanja = f.jenis === 'BELANJA';
  const rekanan = ref.rekanan.find((r) => String(r.id) === String(f.rekanan_id));
  const real = ref.realisasi.find((r) => r.kode_rekening === f.kode_rekening);
  const isHonor = /honor/i.test(ref.rekening.find((r) => r.kode === f.kode_rekening)?.nama || '');

  // Hitung otomatis potongan pajak belanja
  useEffect(() => {
    if (!isBelanja || !auto.aktif || !(f.nilai > 0)) { if (auto.aktif) setPajak([]); return; }
    if (isHonor) {
      const h = auto.honor === 'asn' ? pph21HonorASN({ bruto: f.nilai, golongan: auto.golongan }) : pph21BukanPegawai({ bruto: f.nilai });
      setPajak(h.pph > 0 ? [{ jenis_pajak: 'PPH21', kode_objek: auto.honor === 'asn' ? '21-402-01' : '21-100-08', dpp: h.dpp, tarif: h.tarif, nominal: h.pph, bruto: f.nilai }] : []);
      return;
    }
    const p = potonganBelanja({ nilai: f.nilai, termasukPPN: auto.termasukPPN, jenis: auto.jenis, pkp: auto.pkp, punyaNpwp: auto.punyaNpwp });
    setPajak(p.potongan);
  }, [isBelanja, auto, f.nilai, isHonor]);

  const calc = useMemo(() => (isBelanja && f.nilai > 0 && !isHonor ? potonganBelanja({ nilai: f.nilai, termasukPPN: auto.termasukPPN, jenis: auto.jenis, pkp: auto.pkp, punyaNpwp: auto.punyaNpwp }) : null), [isBelanja, f.nilai, auto, isHonor]);
  const totalPajak = pajak.reduce((s, p) => s + Number(p.nominal || 0), 0);
  const bruto = calc && !auto.termasukPPN ? calc.bruto : f.nilai;

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const body = {
        skpd_id: skpdId, tanggal: f.tanggal, jenis: f.jenis, no_bukti: f.no_bukti, uraian: f.uraian, kode_rekening: f.kode_rekening || null,
        rekanan_id: f.rekanan_id || null, metode: f.metode, no_sp2d: f.no_sp2d || null,
        penerimaan: arah === 'penerimaan' ? f.nilai : 0, pengeluaran: arah === 'pengeluaran' ? bruto : 0,
        pajak: isBelanja ? pajak.map((p) => ({ ...p, penerima_nama: p.penerima_nama || rekanan?.nama })) : [],
      };
      const res = await api.post('/api/bku', body);
      toast(`Transaksi No. ${res.entry.no_urut} tersimpan${res.pajak.length ? ` beserta ${res.pajak.length} pungutan pajak` : ''}`);
      res.warnings?.forEach((w) => toast(w, 'error', 8000));
      onSaved?.(res);
      onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Catat transaksi BKU" subtitle="Entri tersimpan permanen dan dikunci rantai hash. Kesalahan diperbaiki dengan jurnal koreksi."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button loading={busy} onClick={submit}>Simpan transaksi</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tanggal"><Input type="date" value={f.tanggal} onChange={set('tanggal')} /></Field>
          <Field label="Jenis transaksi"><Select value={f.jenis} onChange={set('jenis')} options={Object.entries(ref.jenis).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="No. bukti"><Input value={f.no_bukti} onChange={set('no_bukti')} placeholder="mis. BKT-10-0001" /></Field>
        </div>
        <Field label="Uraian"><Textarea value={f.uraian} onChange={set('uraian')} placeholder="Uraian transaksi sesuai bukti" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kode rekening" hint={real ? `Pagu ${rp(real.pagu)} · realisasi ${rp(real.realisasi)} · sisa ${rp(real.sisa)}` : f.kode_rekening ? 'Belum ada pagu untuk rekening ini' : undefined}>
            <Combo value={f.kode_rekening} onChange={set('kode_rekening')} placeholder="Pilih kode rekening"
              options={ref.rekening.map((r) => ({ value: r.kode, label: `${r.kode} — ${r.nama}` }))} />
          </Field>
          <Field label="Rekanan / penerima">
            <Combo value={f.rekanan_id} onChange={set('rekanan_id')} placeholder="Opsional"
              options={ref.rekanan.map((r) => ({ value: r.id, label: r.nama, hint: r.npwp ? `NPWP ${r.npwp}` : 'Tanpa NPWP' }))} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {!MASUK.includes(f.jenis) && !KELUAR.includes(f.jenis) && (
            <Field label="Arah kas"><Select value={f.arah} onChange={set('arah')} options={[{ value: 'penerimaan', label: 'Penerimaan (masuk)' }, { value: 'pengeluaran', label: 'Pengeluaran (keluar)' }]} /></Field>
          )}
          <Field label={isBelanja ? 'Nilai tagihan / kontrak' : `Nilai ${arah}`} hint={f.nilai ? terbilang(f.nilai) : undefined}><MoneyInput value={f.nilai} onChange={set('nilai')} /></Field>
          <Field label="Kas"><Select value={f.metode} onChange={set('metode')} options={[{ value: 'bank', label: 'Bank' }, { value: 'tunai', label: 'Tunai' }]} /></Field>
          {f.jenis.startsWith('SP2D') || isBelanja ? <Field label="No. SP2D (opsional)"><Input value={f.no_sp2d} onChange={set('no_sp2d')} /></Field> : null}
        </div>

        {isBelanja && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Calculator className="h-4 w-4 text-brand-700" />Potongan pajak</p>
              <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={auto.aktif} onChange={(e) => setAuto({ ...auto, aktif: e.target.checked })} />Hitung otomatis</label>
            </div>
            {auto.aktif && (isHonor ? (
              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                <Field label="Penerima honor"><Select value={auto.honor} onChange={(e) => setAuto({ ...auto, honor: e.target.value })} options={[{ value: 'asn', label: 'ASN / pejabat (PPh 21 final)' }, { value: 'non', label: 'Bukan pegawai (50% × Pasal 17)' }]} /></Field>
                {auto.honor === 'asn' && <Field label="Golongan"><Select value={auto.golongan} onChange={(e) => setAuto({ ...auto, golongan: e.target.value })} options={[{ value: 'I', label: 'Gol. I (0%)' }, { value: 'II', label: 'Gol. II (0%)' }, { value: 'III', label: 'Gol. III (5%)' }, { value: 'IV', label: 'Gol. IV / pejabat (15%)' }]} /></Field>}
              </div>
            ) : (
              <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Jenis belanja"><Select value={auto.jenis} onChange={(e) => setAuto({ ...auto, jenis: e.target.value })} options={Object.entries(JENIS_BELANJA).map(([value, v]) => ({ value, label: v.label }))} /></Field>
                <label className="flex items-center gap-2 pt-5 text-xs text-slate-700"><input type="checkbox" checked={auto.termasukPPN} onChange={(e) => setAuto({ ...auto, termasukPPN: e.target.checked })} />Nilai sudah termasuk PPN</label>
                <label className="flex items-center gap-2 pt-5 text-xs text-slate-700"><input type="checkbox" checked={auto.pkp} onChange={(e) => setAuto({ ...auto, pkp: e.target.checked })} />Rekanan PKP</label>
                <label className="flex items-center gap-2 pt-5 text-xs text-slate-700"><input type="checkbox" checked={auto.punyaNpwp} onChange={(e) => setAuto({ ...auto, punyaNpwp: e.target.checked })} />Rekanan ber-NPWP</label>
              </div>
            ))}
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full min-w-[560px]">
                <thead><tr><th className="th">Pajak</th><th className="th">Kode objek</th><th className="th text-right">DPP</th><th className="th text-right">Tarif %</th><th className="th text-right">Nominal</th><th className="th" /></tr></thead>
                <tbody>
                  {pajak.map((p, i) => {
                    const upd = (k) => (v) => { setAuto((a) => ({ ...a, aktif: false })); setPajak((x) => x.map((y, j) => (j === i ? { ...y, [k]: v?.target ? v.target.value : v } : y))); };
                    return (
                      <tr key={i}>
                        <td className="td"><Select value={p.jenis_pajak} onChange={upd('jenis_pajak')} options={Object.entries(JENIS_PAJAK).map(([value, label]) => ({ value, label }))} /></td>
                        <td className="td"><Select value={p.kode_objek} onChange={upd('kode_objek')} placeholder="-" options={[...(p.jenis_pajak === 'PPN' ? [{ value: 'PPN-BENDAHARA', label: 'PPN dipungut bendahara' }] : []), ...ref.objek.filter((o) => o.jenis_pajak === p.jenis_pajak).map((o) => ({ value: o.kode, label: `${o.kode} ${o.nama.slice(0, 30)}` }))]} /></td>
                        <td className="td w-40"><MoneyInput value={p.dpp} onChange={upd('dpp')} /></td>
                        <td className="td w-20"><Input className="text-right" value={p.tarif} onChange={upd('tarif')} /></td>
                        <td className="td w-40"><MoneyInput value={p.nominal} onChange={upd('nominal')} /></td>
                        <td className="td"><button type="button" onClick={() => { setAuto((a) => ({ ...a, aktif: false })); setPajak((x) => x.filter((_, j) => j !== i)); }} className="p-1 text-slate-400 hover:text-rose-600" aria-label="Hapus"><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    );
                  })}
                  {!pajak.length && <tr><td colSpan={6} className="td text-center text-xs text-slate-500">Tidak ada potongan pajak</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => { setAuto((a) => ({ ...a, aktif: false })); setPajak((x) => [...x, { jenis_pajak: 'PPH23', kode_objek: '24-104-14', dpp: 0, tarif: 2, nominal: 0 }]); }}>Tambah baris pajak</Button>
              <div className="num text-right text-xs text-slate-600">
                Bruto dibukukan <b className="text-slate-800">{rp(bruto)}</b> · Total pajak <b className="text-slate-800">{rp(totalPajak)}</b> · Netto ke rekanan <b className="text-brand-800">{rp(bruto - totalPajak)}</b>
              </div>
            </div>
            {calc?.catatan?.map((c) => <p key={c} className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700"><Info className="h-3.5 w-3.5" />{c}</p>)}
            <p className={cx('mt-2 text-[11px] text-slate-500')}>Setiap pajak dibukukan sebagai penerimaan "pungutan pajak" di BKU dan masuk Register Pajak untuk disetor serta diekspor ke Coretax.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
