import { useEffect, useState } from 'react';
import { Wallet, Save, Printer } from 'lucide-react';
import { terbilang } from '@shared/terbilang.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Button, Card, Field, Input, MoneyInput, PageHeader, useLoad, useToast, Badge, cx } from '../components/ui.jsx';
import { rp, money, tgl, today, waktu } from '../lib/format.js';

export default function PenutupanKas() {
  const { skpdId, skpd, can } = useApp();
  const toast = useToast();
  const list = useLoad(() => skpdId && api.get('/api/penutupan-kas', { skpd_id: skpdId }), [skpdId]);
  const [tanggal, setTanggal] = useState(today());
  const [saldo, setSaldo] = useState(null);
  const [bank, setBank] = useState(0);
  const [denom, setDenom] = useState({});
  const [ket, setKet] = useState('');
  const [busy, setBusy] = useState(false);
  const [print, setPrint] = useState(null);
  useEffect(() => { if (skpdId) api.get('/api/penutupan-kas/saldo', { skpd_id: skpdId, tanggal }).then((s) => { setSaldo(s); setBank(s.saldo_bank_bku); }); }, [skpdId, tanggal]);
  const D = list.data?.denominasi || [];
  const tunai = D.reduce((s, d) => s + d * (Number(denom[d]) || 0), 0);
  const selisih = saldo ? bank + tunai - saldo.saldo_bku : 0;
  const save = async () => {
    setBusy(true);
    try { const { row } = await api.post('/api/penutupan-kas', { skpd_id: skpdId, tanggal, saldo_bank: bank, denominasi: denom, keterangan: ket }); toast('Register penutupan kas tersimpan'); list.reload(); setPrint(row); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  useEffect(() => { if (print) setTimeout(() => window.print(), 300); }, [print]);

  return (
    <div className="space-y-4">
      <PageHeader icon={Wallet} title="Penutupan Kas" subtitle="Register penutupan kas: bandingkan saldo BKU dengan saldo bank dan hasil hitung fisik uang tunai" />
      <div className="no-print grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card title="Hitung kas">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <Field label="Tanggal penutupan"><Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} /></Field>
              <Field label="Saldo rekening bank (rekening koran)" hint={saldo ? `Menurut BKU: ${rp(saldo.saldo_bank_bku)}` : ''}><MoneyInput value={bank} onChange={setBank} /></Field>
              <Field label="Keterangan"><Input value={ket} onChange={(e) => setKet(e.target.value)} placeholder="opsional" /></Field>
              {saldo && (
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between py-0.5"><span>Saldo BKU</span><span className="num font-medium">{rp(saldo.saldo_bku)}</span></div>
                  <div className="flex justify-between py-0.5 text-slate-500"><span>• kas bank / kas tunai (BKU)</span><span className="num">{money(saldo.saldo_bank_bku)} / {money(saldo.saldo_tunai_bku)}</span></div>
                  <div className="flex justify-between py-0.5"><span>Saldo bank + tunai fisik</span><span className="num font-medium">{rp(bank + tunai)}</span></div>
                  <div className={cx('mt-1 flex justify-between border-t border-slate-200 pt-1.5 font-semibold', Math.abs(selisih) < 0.01 ? 'text-emerald-700' : 'text-rose-700')}><span>Selisih</span><span className="num">{rp(selisih)}</span></div>
                </div>
              )}
            </div>
            <div>
              <p className="label">Uang tunai fisik (lembar / keping)</p>
              <div className="space-y-1.5">
                {D.map((d) => (
                  <div key={d} className="grid grid-cols-[100px_1fr_120px] items-center gap-2 text-sm">
                    <span className="num text-slate-600">{d.toLocaleString('id-ID')}</span>
                    <Input type="number" min={0} className="!py-1 text-right" value={denom[d] || ''} onChange={(e) => setDenom({ ...denom, [d]: e.target.value })} />
                    <span className="num text-right text-slate-700">{money(d * (Number(denom[d]) || 0))}</span>
                  </div>
                ))}
                <div className="grid grid-cols-[100px_1fr_120px] border-t border-slate-200 pt-1.5 text-sm font-semibold"><span>Jumlah</span><span /><span className="num text-right">{money(tunai)}</span></div>
              </div>
            </div>
          </div>
          {saldo && Math.abs(selisih) >= 0.01 && <Alert tone="warn" className="mt-4">Terdapat selisih {rp(selisih)}. Pastikan semua transaksi sudah dibukukan dan cocokkan dengan rekonsiliasi bank.</Alert>}
          {can('admin', 'bendahara') && <div className="mt-4 flex justify-end"><Button icon={Save} loading={busy} onClick={save}>Simpan & cetak register</Button></div>}
        </Card>
        <Card title="Riwayat penutupan" bodyClass="max-h-[70vh] overflow-y-auto p-0">
          <ul className="divide-y divide-slate-100">
            {(list.data?.rows || []).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div><p className="font-medium">{tgl(r.tanggal, { long: true })}</p><p className="num text-[11px] text-slate-500">Saldo {rp(r.saldo_bku)} · {r.dibuat_oleh}</p></div>
                <div className="flex items-center gap-1">{Math.abs(Number(r.selisih)) < 0.01 ? <Badge color="green">Sesuai</Badge> : <Badge color="red">Selisih {money(r.selisih)}</Badge>}
                  <button type="button" className="p-1 text-slate-400 hover:text-brand-700" onClick={() => setPrint(r)} aria-label="Cetak"><Printer className="h-4 w-4" /></button></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {print && <RegisterCetak r={print} skpd={skpd} D={D} />}
    </div>
  );
}

function RegisterCetak({ r, skpd, D }) {
  const tunai = Number(r.kas_tunai);
  return (
    <div className="hidden print:block">
      <div className="mx-auto max-w-3xl text-[12px] text-black">
        <h2 className="text-center text-base font-bold">REGISTER PENUTUPAN KAS</h2>
        <p className="text-center">{skpd?.nama}</p>
        <table className="mt-4 w-full"><tbody>
          <tr><td className="w-56 py-0.5">Tanggal penutupan kas</td><td>: {tgl(r.tanggal, { long: true })}</td></tr>
          <tr><td className="py-0.5">Nama bendahara</td><td>: {skpd?.bendahara_nama}</td></tr>
          <tr><td className="py-0.5">Jumlah penerimaan/pengeluaran (saldo BKU)</td><td>: {rp(r.saldo_bku, { decimals: true })}</td></tr>
        </tbody></table>
        <p className="mt-3 font-semibold">Saldo kas terdiri dari:</p>
        <table className="mt-1 w-full border border-black"><tbody>
          {D.filter((d) => r.denominasi?.[d]).map((d) => <tr key={d}><td className="border border-black px-2">Uang {d >= 1000 ? 'kertas' : 'logam'} Rp {d.toLocaleString('id-ID')}</td><td className="border border-black px-2 text-right">{r.denominasi[d]} lembar</td><td className="border border-black px-2 text-right">{money(d * r.denominasi[d])}</td></tr>)}
          <tr><td className="border border-black px-2 font-semibold" colSpan={2}>Jumlah kas tunai</td><td className="border border-black px-2 text-right font-semibold">{money(tunai)}</td></tr>
          <tr><td className="border border-black px-2" colSpan={2}>Saldo bank</td><td className="border border-black px-2 text-right">{money(r.saldo_bank)}</td></tr>
          <tr><td className="border border-black px-2 font-semibold" colSpan={2}>Jumlah</td><td className="border border-black px-2 text-right font-semibold">{money(tunai + Number(r.saldo_bank))}</td></tr>
          <tr><td className="border border-black px-2" colSpan={2}>Perbedaan</td><td className="border border-black px-2 text-right">{money(r.selisih)}</td></tr>
        </tbody></table>
        <p className="mt-1 italic">Terbilang: {terbilang(tunai + Number(r.saldo_bank))}</p>
        <Ttd skpd={skpd} tanggal={r.tanggal} />
      </div>
    </div>
  );
}

export function Ttd({ skpd, tanggal }) {
  return (
    <div className="mt-10 grid grid-cols-2 gap-8 text-center text-[12px]">
      <div><p>Mengetahui,</p><p>Pengguna Anggaran</p><div className="h-16" /><p className="font-semibold underline">{skpd?.kepala_nama}</p><p>NIP. {skpd?.kepala_nip}</p></div>
      <div><p>{tanggal ? tgl(tanggal, { long: true }) : ''}</p><p>Bendahara Pengeluaran</p><div className="h-16" /><p className="font-semibold underline">{skpd?.bendahara_nama}</p><p>NIP. {skpd?.bendahara_nip}</p></div>
    </div>
  );
}
