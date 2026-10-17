import { useState } from 'react';
import { FileSpreadsheet, FileCode2, Download, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Field, Loading, PageHeader, Select, useLoad, useToast, cx } from '../components/ui.jsx';
import { BULAN, JENIS_PAJAK, rp, money } from '../lib/format.js';

const FORMS = [
  { value: 'BPMP', label: 'BPMP', desc: 'Bukti potong bulanan pegawai tetap (PPh 21 gaji, TER)' },
  { value: 'BP21', label: 'BP21', desc: 'Bukti potong PPh 21 selain pegawai tetap (honor, tenaga ahli)' },
  { value: 'BPPU', label: 'BPPU', desc: 'Bukti potong unifikasi PPh 22, 23, 4(2)' },
  { value: 'PPN', label: 'PPN', desc: 'Daftar PPN dipungut bendahara (Excel rekap)' },
];

export default function Coretax() {
  const { skpdId, tahun, skpd } = useApp();
  const toast = useToast();
  const [masa, setMasa] = useState(new Date().getMonth() || 12);
  const [form, setForm] = useState('BPPU');
  const { data, loading, error } = useLoad(() => skpdId && api.get('/api/pajak/coretax/preview', { skpd_id: skpdId, tahun, masa, form }), [skpdId, tahun, masa, form]);
  const exp = (format, paksa) => download('/api/pajak/coretax/export', { params: { skpd_id: skpdId, tahun, masa, form, format, paksa: paksa ? 1 : '' } })
    .then(() => toast(`File ${format.toUpperCase()} diunduh`)).catch((e) => toast(e.message, 'error'));
  const issues = data?.masalah || [];

  return (
    <div className="space-y-5">
      <PageHeader icon={FileSpreadsheet} title="Ekspor ke Coretax" subtitle="Bukti potong dibentuk otomatis dari register pajak dalam format impor massal (XML) Coretax DJP" />
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card title="Pilih masa & jenis bukti potong">
            <div className="space-y-3">
              <Field label="Masa pajak"><Select value={masa} onChange={(e) => setMasa(Number(e.target.value))} options={BULAN.map((b, i) => ({ value: i + 1, label: `${b} ${tahun}` }))} /></Field>
              <div className="space-y-2">
                {FORMS.map((f) => (
                  <button key={f.value} type="button" onClick={() => setForm(f.value)} className={cx('w-full rounded-xl border p-3 text-left transition', form === f.value ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                    <p className="text-sm font-semibold text-slate-800">{f.label}</p><p className="text-xs text-slate-500">{f.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </Card>
          <Card title="Pemotong">
            <p className="text-sm font-medium">{skpd?.nama}</p>
            <p className="num mt-1 text-xs text-slate-500">NPWP {skpd?.npwp || <span className="text-rose-600">belum diisi di data master</span>}</p>
            <p className="num text-xs text-slate-500">NITKU {skpd?.nitku || `${skpd?.npwp || ''}000000`}</p>
          </Card>
          <Alert tone="info" title="Langkah unggah di Coretax">
            <ol className="ml-4 list-decimal space-y-0.5">
              <li>Unduh XML di halaman ini.</li>
              <li>Login Coretax, buka menu eBupot sesuai jenis (BPMP/BP21/BPPU).</li>
              <li>Pilih <i>Impor Data</i>, unggah file XML, lalu periksa status impor.</li>
              <li>Tandatangani bukti potong dan catat NTPN di Register Pajak.</li>
            </ol>
          </Alert>
        </div>
        <div className="space-y-4">
          {loading && !data ? <Loading /> : error ? <Alert tone="error">{error.message}</Alert> : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="card p-4"><p className="text-xs text-slate-500">Jumlah bukti potong</p><p className="num mt-1 text-2xl font-semibold">{data.jumlah}</p></div>
                <div className="card p-4"><p className="text-xs text-slate-500">Total DPP / bruto</p><p className="num mt-1 text-lg font-semibold">{rp(data.total_dpp)}</p></div>
                <div className="card p-4"><p className="text-xs text-slate-500">Total pajak</p><p className="num mt-1 text-lg font-semibold">{rp(data.total_pajak)}</p></div>
              </div>
              {data.jumlah > 0 && (issues.length ? (
                <Alert tone="warn" title={`${issues.length} data perlu diperbaiki sebelum diunggah`}>
                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs">{issues.map((i, k) => <li key={k}>• {i.nama}: {i.pesan}</li>)}</ul>
                  <p className="mt-1 text-xs">Perbaiki di Register Pajak (ikon pensil), atau tetap ekspor jika akan dilengkapi manual.</p>
                </Alert>
              ) : <Alert tone="ok">Semua data lolos validasi format Coretax (NPWP/NIK 16 digit, kode objek, DPP, PTKP).</Alert>)}
              <div className="flex flex-wrap gap-2">
                {form !== 'PPN' && <Button icon={FileCode2} disabled={!data.jumlah} onClick={() => exp('xml', issues.length > 0)}>Unduh XML Coretax</Button>}
                <Button variant="secondary" icon={Download} disabled={!data.jumlah} onClick={() => exp('xlsx')}>Unduh Excel</Button>
              </div>
              <Card title="Pratinjau isi file" bodyClass="max-h-[50vh] overflow-auto">
                {data.rows.length ? (
                  <table className="w-full min-w-[760px]">
                    <thead className="sticky top-0"><tr><th className="th" /><th className="th">Penerima</th><th className="th">NPWP/NIK</th><th className="th">Kode objek</th><th className="th text-right">DPP</th><th className="th text-right">Tarif</th><th className="th text-right">Pajak</th><th className="th">Status</th></tr></thead>
                    <tbody>
                      {data.rows.map((r) => {
                        const bad = issues.some((i) => i.id === r.id);
                        return (
                          <tr key={r.id} className={cx(bad && 'bg-amber-50/60')}>
                            <td className="td">{bad ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}</td>
                            <td className="td min-w-[200px]">{r.penerima_nama}<p className="text-[11px] text-slate-500">{JENIS_PAJAK[r.jenis_pajak]}{r.status_ptkp ? ` · ${r.status_ptkp}` : ''}</p></td>
                            <td className="td num text-xs">{r.penerima_npwp || r.penerima_nik || '-'}</td>
                            <td className="td text-xs">{r.kode_objek || '-'}</td>
                            <td className="td num text-right">{money(r.dpp)}</td>
                            <td className="td num text-right">{Number(r.tarif).toLocaleString('id-ID')}%</td>
                            <td className="td num text-right font-medium">{money(r.nominal)}</td>
                            <td className="td"><Badge color={r.status === 'dipungut' ? 'amber' : 'green'}>{r.status}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : <p className="py-10 text-center text-sm text-slate-500">Tidak ada data {form} pada masa {BULAN[masa - 1]} {tahun}.</p>}
              </Card>
              <p className="flex items-center gap-1 text-[11px] text-slate-500"><ExternalLink className="h-3 w-3" />Struktur XML mengikuti template impor Coretax; nama elemen terpusat di <code>server/src/lib/coretax.js</code> agar mudah disesuaikan bila DJP memperbarui template.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
