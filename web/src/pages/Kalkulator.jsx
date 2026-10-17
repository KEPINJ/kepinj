import { useMemo, useState } from 'react';
import { Calculator, Save } from 'lucide-react';
import * as tax from '@shared/tax.js';
import { terbilang } from '@shared/terbilang.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Field, Input, MoneyInput, PageHeader, Select, Tabs, useToast, cx } from '../components/ui.jsx';
import { rp, num, BULAN } from '../lib/format.js';

const PTKP_OPTS = tax.STATUS_PTKP.map((s) => ({ value: s, label: `${s} · PTKP ${num(tax.ptkpSetahun(s))}` }));

function Row({ label, value, strong, muted, sub }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4 py-1.5 text-sm', strong && 'border-t border-slate-200 pt-2.5 font-semibold', muted && 'text-slate-500')}>
      <span>{label}{sub && <span className="block text-[11px] font-normal text-slate-500">{sub}</span>}</span><span className="num whitespace-nowrap">{value}</span>
    </div>
  );
}

function Hasil({ title, pajak, children }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-brand-800 to-brand-950 p-5 text-white">
      <p className="text-xs uppercase tracking-wider text-brand-200">{title}</p>
      <p className="num mt-1 text-3xl font-semibold">{rp(pajak)}</p>
      <p className="mt-1 text-xs italic text-brand-200">{terbilang(pajak)}</p>
      {children && <div className="mt-4 rounded-lg bg-white/95 px-4 py-2 text-slate-800">{children}</div>}
    </div>
  );
}

function SimpanRegister({ build }) {
  const { skpdId, tahun, can } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ nama: '', npwp: '', masa: new Date().getMonth() + 1 });
  const [busy, setBusy] = useState(false);
  if (!can('admin', 'bendahara')) return null;
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/api/pajak', { skpd_id: skpdId, items: [{ ...build(), tahun, masa: f.masa, penerima_nama: f.nama, penerima_npwp: f.npwp }] });
      toast('Tersimpan di register pajak'); setF({ ...f, nama: '', npwp: '' });
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-3">
      <p className="mb-2 text-xs font-semibold text-slate-700">Simpan sebagai bukti potong di register pajak</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="Nama penerima" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        <Input placeholder="NPWP / NIK 16 digit" value={f.npwp} onChange={(e) => setF({ ...f, npwp: e.target.value })} />
        <Select value={f.masa} onChange={(e) => setF({ ...f, masa: Number(e.target.value) })} options={BULAN.map((b, i) => ({ value: i + 1, label: `Masa ${b}` }))} />
        <Button icon={Save} loading={busy} disabled={!f.nama} onClick={save}>Simpan</Button>
      </div>
    </div>
  );
}

function Pph21Bulanan() {
  const [f, setF] = useState({ gaji: 6500000, keluarga: 650000, jabatan: 1250000, lain: 0, beras: 289680, status: 'K/1' });
  const bruto = f.gaji + f.keluarga + f.jabatan + f.lain + f.beras;
  const h = tax.pph21Bulanan({ bruto, status: f.status });
  const table = tax.TER[h.kategori];
  const idx = table.findIndex(([b]) => bruto <= b);
  const set = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Penghasilan bruto bulanan" subtitle="Masa Januari–November menggunakan Tarif Efektif Rata-rata (PP 58/2023)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gaji pokok"><MoneyInput value={f.gaji} onChange={set('gaji')} /></Field>
          <Field label="Tunjangan keluarga"><MoneyInput value={f.keluarga} onChange={set('keluarga')} /></Field>
          <Field label="Tunjangan jabatan/fungsional"><MoneyInput value={f.jabatan} onChange={set('jabatan')} /></Field>
          <Field label="Tunjangan beras"><MoneyInput value={f.beras} onChange={set('beras')} /></Field>
          <Field label="TPP / tunjangan lain"><MoneyInput value={f.lain} onChange={set('lain')} /></Field>
          <Field label="Status PTKP"><Select value={f.status} onChange={set('status')} options={PTKP_OPTS} /></Field>
        </div>
      </Card>
      <div>
        <Hasil title="PPh 21 masa ini" pajak={h.pph}>
          <Row label="Penghasilan bruto" value={rp(bruto)} />
          <Row label={`Kategori TER ${h.kategori}`} value={`${h.tarif.toLocaleString('id-ID')}%`} sub={`Status ${f.status}`} />
          <Row label="PPh 21 = bruto × tarif" value={rp(h.pph)} strong />
        </Hasil>
        <Card className="mt-4" title={`Potongan tabel TER kategori ${h.kategori}`} bodyClass="p-0">
          <table className="w-full text-xs"><tbody>
            {table.slice(Math.max(0, idx - 2), idx + 3).map(([b, t], i, arr) => {
              const prev = table[table.indexOf(arr[i]) - 1]?.[0] ?? 0;
              return <tr key={b} className={cx(table.indexOf(arr[i]) === idx && 'bg-gold-400/20 font-semibold')}><td className="td num">{rp(prev + 1)} – {b === Infinity ? '…' : rp(b)}</td><td className="td num text-right">{t.toLocaleString('id-ID')}%</td></tr>;
            })}
          </tbody></table>
        </Card>
        <SimpanRegister build={() => ({ jenis_pajak: 'PPH21', kode_objek: '21-100-01', status_ptkp: f.status, dpp: bruto, tarif: h.tarif, nominal: h.pph, detail: { bruto, metode: 'TER', kategori: h.kategori } })} />
      </div>
    </div>
  );
}

function Pph21Tahunan() {
  const [f, setF] = useState({ bruto: 120000000, pensiun: 3420000, zakat: 0, status: 'K/1', dipotong: 4200000, bulan: 12 });
  const h = tax.pph21Tahunan({ brutoSetahun: f.bruto, iuranPensiunSetahun: f.pensiun, zakatSetahun: f.zakat, status: f.status, pphTelahDipotong: f.dipotong, jumlahBulan: Number(f.bulan) });
  const set = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Perhitungan masa pajak terakhir (Desember)" subtitle="PPh setahun dengan tarif Pasal 17 dikurangi PPh yang sudah dipotong Januari–November">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Penghasilan bruto setahun"><MoneyInput value={f.bruto} onChange={set('bruto')} /></Field>
          <Field label="Iuran pensiun/THT setahun" hint="PNS: 4,75% gaji pokok + tunjangan keluarga"><MoneyInput value={f.pensiun} onChange={set('pensiun')} /></Field>
          <Field label="Zakat melalui lembaga resmi"><MoneyInput value={f.zakat} onChange={set('zakat')} /></Field>
          <Field label="Status PTKP"><Select value={f.status} onChange={set('status')} options={PTKP_OPTS} /></Field>
          <Field label="PPh 21 dipotong Jan–Nov"><MoneyInput value={f.dipotong} onChange={set('dipotong')} /></Field>
          <Field label="Jumlah bulan bekerja"><Input type="number" min={1} max={12} value={f.bulan} onChange={set('bulan')} /></Field>
        </div>
      </Card>
      <Hasil title={h.pphMasaTerakhir >= 0 ? 'PPh 21 masa Desember' : 'Lebih potong (dikembalikan)'} pajak={Math.abs(h.pphMasaTerakhir)}>
        <Row label="Penghasilan bruto" value={rp(h.bruto)} />
        <Row label="Biaya jabatan (5%, maks. 6 jt/th)" value={`− ${rp(h.biayaJabatan)}`} muted />
        <Row label="Iuran pensiun & zakat" value={`− ${rp(h.iuranPensiun + h.zakat)}`} muted />
        <Row label="Penghasilan neto" value={rp(h.neto)} />
        <Row label={`PTKP (${f.status})`} value={`− ${rp(h.ptkp)}`} muted />
        <Row label="PKP (dibulatkan ribuan)" value={rp(h.pkp)} />
        {h.rincian.map((r) => <Row key={r.tarif} label={`${r.tarif}% × ${rp(r.lapisan)}`} value={rp(r.pajak)} muted />)}
        <Row label="PPh 21 setahun" value={rp(h.pphSetahun)} />
        <Row label="Telah dipotong" value={`− ${rp(h.pphTelahDipotong)}`} muted />
        <Row label="PPh 21 masa terakhir" value={rp(h.pphMasaTerakhir)} strong />
      </Hasil>
    </div>
  );
}

function Honor() {
  const [f, setF] = useState({ tipe: 'asn', bruto: 3000000, golongan: 'III', kumulatif: 0 });
  const set = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  const h = f.tipe === 'asn' ? tax.pph21HonorASN({ bruto: f.bruto, golongan: f.golongan }) : tax.pph21BukanPegawai({ bruto: f.bruto, kumulatifSebelumnya: f.kumulatif });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Honorarium kegiatan" subtitle="Narasumber, moderator, panitia, tenaga ahli">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Penerima" className="sm:col-span-2"><Select value={f.tipe} onChange={set('tipe')} options={[{ value: 'asn', label: 'ASN / pejabat negara (PPh 21 final PP 80/2010)' }, { value: 'non', label: 'Bukan pegawai (50% bruto × tarif Pasal 17)' }]} /></Field>
          <Field label="Honor bruto"><MoneyInput value={f.bruto} onChange={set('bruto')} /></Field>
          {f.tipe === 'asn'
            ? <Field label="Golongan"><Select value={f.golongan} onChange={set('golongan')} options={[{ value: 'I', label: 'Golongan I — 0%' }, { value: 'II', label: 'Golongan II — 0%' }, { value: 'III', label: 'Golongan III — 5%' }, { value: 'IV', label: 'Golongan IV — 15%' }, { value: 'PEJABAT', label: 'Pejabat negara — 15%' }]} /></Field>
            : <Field label="DPP kumulatif sebelumnya (tahun ini)" hint="Untuk bukan pegawai yang menerima berkesinambungan"><MoneyInput value={f.kumulatif} onChange={set('kumulatif')} /></Field>}
        </div>
      </Card>
      <div>
        <Hasil title="PPh 21 dipotong" pajak={h.pph}>
          <Row label="Honor bruto" value={rp(f.bruto)} />
          <Row label="Dasar pengenaan" value={rp(h.dpp)} sub={f.tipe === 'asn' ? '100% bruto' : '50% × bruto'} />
          <Row label="Tarif" value={`${num(h.tarif)}%`} />
          <Row label="Diterima bersih" value={rp(f.bruto - h.pph)} strong />
        </Hasil>
        <SimpanRegister build={() => ({ jenis_pajak: 'PPH21', kode_objek: f.tipe === 'asn' ? '21-402-01' : '21-100-08', status_ptkp: 'TK/0', dpp: f.tipe === 'asn' ? f.bruto : h.dpp, tarif: h.tarif, nominal: h.pph, detail: { bruto: f.bruto, deemed: f.tipe === 'asn' ? 100 : 50 } })} />
      </div>
    </div>
  );
}

function Belanja() {
  const [f, setF] = useState({ nilai: 55500000, termasukPPN: true, jenis: 'barang', pkp: true, punyaNpwp: true });
  const set = (k) => (v) => setF({ ...f, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v });
  const h = useMemo(() => tax.potonganBelanja(f), [f]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Potongan pajak atas belanja" subtitle="PPN dipungut bendahara (12% × DPP 11/12) dan PPh 22/23/4(2)">
        <div className="grid gap-3">
          <Field label="Nilai tagihan / kontrak"><MoneyInput value={f.nilai} onChange={set('nilai')} /></Field>
          <Field label="Jenis belanja"><Select value={f.jenis} onChange={set('jenis')} options={Object.entries(tax.JENIS_BELANJA).map(([value, v]) => ({ value, label: `${v.label} — ${v.pph.replace('PPH4A2', 'PPh 4(2)').replace('PPH', 'PPh ')} ${num(v.tarif)}%` }))} /></Field>
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.termasukPPN} onChange={set('termasukPPN')} />Nilai termasuk PPN</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.pkp} onChange={set('pkp')} />Rekanan PKP</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.punyaNpwp} onChange={set('punyaNpwp')} />Rekanan ber-NPWP</label>
          </div>
          {h.catatan.map((c) => <Alert key={c} tone="warn">{c}</Alert>)}
        </div>
      </Card>
      <Hasil title="Total pajak dipotong/dipungut" pajak={h.totalPotongan}>
        <Row label="Nilai bruto (dibukukan)" value={rp(h.bruto)} />
        <Row label="DPP (harga tanpa PPN)" value={rp(h.dpp)} muted />
        {h.potongan.map((p) => <Row key={p.jenis_pajak} label={`${p.jenis_pajak === 'PPN' ? 'PPN' : p.jenis_pajak.replace('PPH4A2', 'PPh 4(2)').replace('PPH', 'PPh ')} ${num(p.tarif)}%`} sub={`DPP ${rp(p.dpp)}${p.kode_objek !== 'PPN-BENDAHARA' ? ` · ${p.kode_objek}` : ' · DPP nilai lain 11/12'}`} value={`− ${rp(p.nominal)}`} />)}
        <Row label="Dibayarkan ke rekanan (netto)" value={rp(h.netto)} strong />
      </Hasil>
    </div>
  );
}

export default function Kalkulator() {
  const [tab, setTab] = useState('bulanan');
  return (
    <div className="space-y-5">
      <PageHeader icon={Calculator} title="Kalkulator Pajak" subtitle="Hitung cepat dengan aturan terbaru, lalu simpan langsung ke register pajak" actions={<Badge color="blue">PP 58/2023 · PMK 168/2023 · PMK 131/2024</Badge>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'bulanan', label: 'PPh 21 pegawai (TER)' }, { value: 'tahunan', label: 'PPh 21 Desember' }, { value: 'honor', label: 'Honorarium' }, { value: 'belanja', label: 'PPN & PPh belanja' }]} />
      {tab === 'bulanan' && <Pph21Bulanan />}
      {tab === 'tahunan' && <Pph21Tahunan />}
      {tab === 'honor' && <Honor />}
      {tab === 'belanja' && <Belanja />}
    </div>
  );
}
