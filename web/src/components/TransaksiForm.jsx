import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Calculator, Info, Check, ChevronLeft, ChevronRight, Copy, AlertTriangle } from 'lucide-react';
import { potonganBelanja, JENIS_BELANJA, pph21HonorASN, pph21BukanPegawai } from '@shared/tax.js';
import { terbilang } from '@shared/terbilang.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Button, Combo, Field, Input, Modal, MoneyInput, Select, Textarea, useToast, cx } from './ui.jsx';
import { rp, tgl, today, JENIS_PAJAK } from '../lib/format.js';

const LANGKAH = ['Data transaksi', 'Nilai & pajak', 'Pratinjau'];

const MASUK = ['SALDO_AWAL', 'SP2D_UP', 'SP2D_GU', 'SP2D_TU', 'SP2D_LS', 'PENERIMAAN'];
const KELUAR = ['BELANJA', 'PAJAK_SETOR', 'PENYETORAN'];
const empty = () => ({ tanggal: today(), jenis: 'BELANJA', no_bukti: '', uraian: '', kode_rekening: '', rekanan_id: '', nilai: 0, arah: 'pengeluaran', metode: 'bank', no_sp2d: '' });

export default function TransaksiForm({ open, onClose, onSaved }) {
  const { skpdId, tahun } = useApp();
  const toast = useToast();
  const [f, setF] = useState(empty());
  const [ref, setRef] = useState({ jenis: {}, rekening: [], rekanan: [], realisasi: [], objek: [], kunci: [], cfg: {} });
  const [step, setStep] = useState(0);
  const [mirip, setMirip] = useState([]);
  const [pajak, setPajak] = useState([]);
  const [auto, setAuto] = useState({ aktif: true, jenis: 'barang', termasukPPN: true, pkp: true, punyaNpwp: true, honor: 'asn', golongan: 'III' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(empty()); setPajak([]); setErr(''); setStep(0); setMirip([]);
    Promise.all([
      api.get('/api/bku/meta'), api.get('/api/master/rekening'), api.get('/api/master/rekanan'),
      api.get('/api/laporan/realisasi', { skpd_id: skpdId, tahun }), api.get('/api/pajak/referensi'),
      api.get('/api/tutup-buku', { skpd_id: skpdId, tahun }).catch(() => ({ bulan: [] })), api.get('/api/pengaturan').catch(() => ({})),
    ]).then(([m, r, k, real, pr, tb, cfg]) => setRef({ jenis: m.jenis, rekening: r.rows, rekanan: k.rows, realisasi: real.rows, objek: pr.objek, cfg, kunci: tb.bulan.filter((b) => b.dikunci).map((b) => `${tahun}-${String(b.bulan).padStart(2, '0')}`) })).catch((e) => setErr(e.message));
  }, [open, skpdId, tahun]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const arah = MASUK.includes(f.jenis) ? 'penerimaan' : KELUAR.includes(f.jenis) ? 'pengeluaran' : f.arah;
  const isBelanja = f.jenis === 'BELANJA';
  const terkunci = ref.kunci.includes(String(f.tanggal).slice(0, 7));
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

  const nilaiKas = arah === 'pengeluaran' ? bruto : f.nilai;
  const syarat = [
    [() => f.tanggal && f.uraian.trim(), 'Lengkapi tanggal dan uraian transaksi'],
    [() => !isBelanja || f.kode_rekening, 'Belanja wajib memilih kode rekening'],
    [() => !terkunci, 'Tanggal berada pada bulan yang sudah ditutup buku'],
  ];
  const lanjut = async () => {
    setErr('');
    if (step === 0) {
      const gagal = syarat.find(([ok]) => !ok());
      if (gagal) { setErr(gagal[1]); return; }
    }
    if (step === 1) {
      if (!(f.nilai > 0)) { setErr('Nilai transaksi harus lebih dari nol'); return; }
      api.post('/api/bku/cek-duplikat', { skpd_id: skpdId, tanggal: f.tanggal, nilai: nilaiKas, rekanan_id: f.rekanan_id || null, no_bukti: f.no_bukti })
        .then((r) => setMirip(r.rows)).catch(() => setMirip([]));
    }
    setStep((x) => x + 1);
  };
  const peringatan = [
    real && arah === 'pengeluaran' && nilaiKas > Number(real.sisa) && `Melebihi sisa pagu ${f.kode_rekening}: sisa ${rp(real.sisa)}, transaksi ${rp(nilaiKas)}.`,
    !real && isBelanja && f.kode_rekening && `Rekening ${f.kode_rekening} belum memiliki pagu anggaran.`,
    f.metode === 'tunai' && arah === 'pengeluaran' && ref.cfg.batas_transaksi_tunai && nilaiKas > Number(ref.cfg.batas_transaksi_tunai) && `Pembayaran tunai di atas ${rp(ref.cfg.batas_transaksi_tunai)}; sebaiknya melalui transfer bank (CMS).`,
    isBelanja && f.rekanan_id && !rekanan?.npwp && 'Rekanan tanpa NPWP: tarif PPh 22/23 lebih tinggi (100%).',
  ].filter(Boolean);

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
      footer={<>
        {step > 0 ? <Button variant="secondary" icon={ChevronLeft} onClick={() => { setErr(''); setStep(step - 1); }}>Kembali</Button> : <Button variant="secondary" onClick={onClose}>Batal</Button>}
        {step < 2 ? <Button onClick={lanjut}>Lanjut <ChevronRight className="h-4 w-4" /></Button> : <Button loading={busy} icon={Check} onClick={submit}>{mirip.length ? 'Tetap simpan' : 'Simpan transaksi'}</Button>}
      </>}>
      <div className="space-y-4">
        <ol className="flex items-center gap-2">
          {LANGKAH.map((l, i) => (
            <li key={l} className="flex flex-1 items-center gap-2">
              <button type="button" disabled={i > step} onClick={() => { setErr(''); setStep(i); }} className="flex items-center gap-2 text-left disabled:cursor-default">
                <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold transition', i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-primary text-white ring-4 ring-brand-500/20' : 'bg-slate-100 text-slate-400')}>{i < step ? <Check className="h-4 w-4" /> : i + 1}</span>
                <span className={cx('hidden text-xs font-semibold sm:block', i === step ? 'text-slate-900' : 'text-slate-500')}>{l}</span>
              </button>
              {i < LANGKAH.length - 1 && <span className={cx('h-0.5 flex-1 rounded', i < step ? 'bg-emerald-400' : 'bg-slate-200')} />}
            </li>
          ))}
        </ol>
        {err && <Alert tone="error">{err}</Alert>}
        {step === 0 && (<>
        {terkunci && <Alert tone="warn" title="Bulan ini sudah ditutup buku">Transaksi bertanggal {f.tanggal} akan ditolak. Pilih tanggal pada bulan yang masih terbuka.</Alert>}
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
        <div className="grid gap-3 sm:grid-cols-2">
          {!MASUK.includes(f.jenis) && !KELUAR.includes(f.jenis) && (
            <Field label="Arah kas"><Select value={f.arah} onChange={set('arah')} options={[{ value: 'penerimaan', label: 'Penerimaan (masuk)' }, { value: 'pengeluaran', label: 'Pengeluaran (keluar)' }]} /></Field>
          )}
          <Field label="Kas"><Select value={f.metode} onChange={set('metode')} options={[{ value: 'bank', label: 'Bank' }, { value: 'tunai', label: 'Tunai' }]} /></Field>
        </div>
        </>)}

        {step === 1 && (<>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={isBelanja ? 'Nilai tagihan / kontrak' : `Nilai ${arah}`} hint={f.nilai ? terbilang(f.nilai) : undefined}><MoneyInput autoFocus value={f.nilai} onChange={set('nilai')} /></Field>
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
        </>)}

        {step === 2 && (
          <div className="space-y-3">
            {mirip.length > 0 && (
              <Alert tone="warn" title={`Mirip dengan ${mirip.length} transaksi yang sudah tercatat`}>
                <p>Periksa agar tidak terjadi pembayaran ganda. Bila memang berbeda, lanjutkan simpan.</p>
                <ul className="mt-2 space-y-1">
                  {mirip.map((m) => (
                    <li key={m.id} className="flex items-start gap-1.5 text-xs"><Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>No. {m.no_urut} · {tgl(m.tanggal)} · {m.no_bukti} · <b>{rp(Number(m.pengeluaran) || Number(m.penerimaan))}</b> · {m.uraian.slice(0, 70)}</span></li>
                  ))}
                </ul>
              </Alert>
            )}
            {peringatan.map((p) => <Alert key={p} tone="warn">{p}</Alert>)}
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                <div className="min-w-0"><p className="text-xs text-slate-500">{tgl(f.tanggal, { long: true })} · {ref.jenis[f.jenis] || f.jenis} · {f.no_bukti}</p><p className="mt-0.5 text-sm font-medium text-slate-800">{f.uraian}</p></div>
                <p className={cx('num whitespace-nowrap text-xl font-bold', arah === 'penerimaan' ? 'text-brand-700' : 'text-slate-900')}>{arah === 'penerimaan' ? '+' : '−'}{rp(nilaiKas)}</p>
              </div>
              <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
                {[['Kode rekening', f.kode_rekening ? `${f.kode_rekening} — ${ref.rekening.find((r) => r.kode === f.kode_rekening)?.nama || ''}` : '-'], ['Rekanan', rekanan?.nama || '-'], ['Kas', f.metode === 'bank' ? 'Bank' : 'Tunai'],
                  ['Sisa pagu setelah transaksi', real ? rp(Number(real.sisa) - (arah === 'pengeluaran' ? nilaiKas : 0)) : '-']].map(([k, v]) => (
                  <div key={k}><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></div>
                ))}
              </dl>
              {isBelanja && pajak.length > 0 && (
                <div className="border-t border-slate-100 px-4 py-3">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Baris BKU yang akan dibuat</p>
                  <table className="w-full text-xs"><tbody>
                    <tr><td className="py-0.5">Belanja (bruto)</td><td className="num py-0.5 text-right">−{rp(bruto)}</td></tr>
                    {pajak.map((p, i) => <tr key={i}><td className="py-0.5">Pungutan {JENIS_PAJAK[p.jenis_pajak]} ({Number(p.tarif)}%)</td><td className="num py-0.5 text-right text-brand-700">+{rp(p.nominal)}</td></tr>)}
                    <tr className="border-t border-slate-200 font-semibold"><td className="pt-1">Kas berkurang bersih (netto ke rekanan)</td><td className="num pt-1 text-right">−{rp(bruto - totalPajak)}</td></tr>
                  </tbody></table>
                </div>
              )}
            </div>
            {!mirip.length && !peringatan.length && <p className="flex items-center gap-1.5 text-xs text-emerald-700"><Check className="h-4 w-4" />Tidak ditemukan transaksi serupa maupun pelanggaran batas. Siap disimpan.</p>}
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><AlertTriangle className="h-3.5 w-3.5" />Setelah disimpan, entri tidak dapat diubah atau dihapus; perbaikan memakai jurnal koreksi.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
