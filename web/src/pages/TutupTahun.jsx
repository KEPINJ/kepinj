import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck2, CheckCircle2, XCircle, AlertTriangle, Printer, Landmark, Lock, ArrowRight, Wallet, Receipt, TrendingUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Progress, Skeleton, Stat, Textarea, cx, useLoad, useToast } from '../components/ui.jsx';
import { compact, money, rp, tgl, waktu } from '../lib/format.js';
import DocQr from '../components/DocQr.jsx';

const IKON = { ok: [CheckCircle2, 'text-emerald-600', 'bg-emerald-50'], gagal: [XCircle, 'text-rose-600', 'bg-rose-50'], peringatan: [AlertTriangle, 'text-amber-600', 'bg-amber-50'] };

export default function TutupTahun() {
  const { skpdId, skpd, tahun, can } = useApp();
  const toast = useToast();
  const { data: d, reload } = useLoad(() => skpdId && api.get('/api/tutup-tahun', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  useLive((e) => (e.type.startsWith('bku') || e.type.startsWith('pajak') || e.type.startsWith('periode')) && reload(), 900);
  const [modal, setModal] = useState(null);
  const [f, setF] = useState({ tanggal: `${tahun}-12-31`, catatan: '' });
  const [busy, setBusy] = useState(false);
  const tulis = can('admin', 'bendahara');
  const berjalan = tahun >= new Date().getFullYear();
  const wajib = d?.daftar.filter((x) => x.wajib) || [];
  const okWajib = wajib.filter((x) => x.status === 'ok').length;

  const jalankan = async () => {
    setBusy(true);
    try {
      if (modal === 'setor') {
        const r = await api.post('/api/tutup-tahun/setor-sisa', { skpd_id: skpdId, tahun, tanggal: f.tanggal });
        toast(`Sisa UP ${rp(r.total)} disetor ke kas daerah dan dibukukan`);
      } else {
        const r = await api.post('/api/tutup-tahun', { skpd_id: skpdId, tahun, catatan: f.catatan });
        const sa = r.tutup.ringkasan.saldo_awal;
        toast(`TA ${tahun} ditutup.${sa.status === 'dibuat' ? ` Saldo awal ${rp(sa.nilai)} dibukukan di TA ${tahun + 1}.` : ''}`);
      }
      setModal(null); reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const l = d?.lpj;
  return (
    <div className="space-y-5">
      <PageHeader icon={CalendarCheck2} title="Tutup Tahun Anggaran" subtitle={`${skpd?.nama || ''} · Tahun Anggaran ${tahun}`}
        actions={<>
          <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Cetak LPJ</Button>
          {tulis && !d?.tutup && <Button icon={Lock} disabled={!d?.siap || berjalan} onClick={() => setModal('tutup')}>Tutup TA {tahun}</Button>}
        </>} />

      {d?.tutup ? (
        <Alert className="no-print" tone="ok" title={`Tahun anggaran ${tahun} sudah ditutup`}>
          Ditutup {waktu(d.tutup.ditutup_at)} oleh {d.tutup.oleh}. Seluruh bulan terkunci; saldo akhir {rp(d.tutup.ringkasan.saldo_akhir.total)}.
          {d.tutup.ringkasan.saldo_awal.status === 'dibuat' && ` Saldo awal TA ${tahun + 1} sebesar ${rp(d.tutup.ringkasan.saldo_awal.nilai)} sudah dibukukan.`}
          {d.tutup.ringkasan.saldo_awal.pesan && ` ${d.tutup.ringkasan.saldo_awal.pesan}.`}
        </Alert>
      ) : berjalan ? (
        <Alert className="no-print" tone="info" title={`TA ${tahun} masih berjalan`}>Daftar periksa ini dapat dipakai sebagai persiapan akhir tahun. Penutupan tahun anggaran baru dapat dilakukan setelah 31 Desember {tahun}.</Alert>
      ) : null}

      <div className="no-print grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!d ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />) : (<>
          <Stat label="Syarat wajib terpenuhi" value={`${okWajib}/${wajib.length}`} sub={d.siap ? 'Siap ditutup' : 'Selesaikan butir merah'} icon={CheckCircle2} tone={d.siap ? 'green' : 'red'} trend={<Progress className="mt-2" value={(okWajib / Math.max(1, wajib.length)) * 100} />} />
          <Stat label="Saldo kas bendahara" value={compact(d.saldo.total)} sub={`bank ${compact(d.saldo.bank)} · tunai ${compact(d.saldo.tunai)}`} icon={Wallet} tone={Math.abs(d.saldo.total) < 0.01 ? 'green' : 'amber'} />
          <Stat label="Realisasi anggaran" value={`${l.anggaran.persen.toFixed(1)}%`} sub={`${compact(l.anggaran.realisasi)} dari ${compact(l.anggaran.pagu)}`} icon={TrendingUp} tone="brand" />
          <Stat label="Pajak dipungut / disetor" value={compact(l.pajak.pungut)} sub={l.pajak.pungut - l.pajak.setor > 0.5 ? `${rp(l.pajak.pungut - l.pajak.setor)} belum disetor` : 'Seluruhnya sudah disetor'} icon={Receipt} tone={l.pajak.pungut - l.pajak.setor > 0.5 ? 'red' : 'green'} />
        </>)}
      </div>

      <Card className="no-print" title="Daftar periksa akhir tahun" subtitle="Butir bertanda wajib harus hijau sebelum tahun anggaran ditutup. Butir kuning adalah peringatan." bodyClass="">
        {!d ? <Skeleton className="m-4 h-64" /> : (
          <ol className="divide-y divide-slate-100">
            {d.daftar.map((x, i) => {
              const [I, warna, bg] = IKON[x.status];
              return (
                <li key={x.kode} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full', bg)}><I className={cx('h-4.5 w-4.5', warna)} /></span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800"><span className="num mr-1 text-slate-400">{i + 1}.</span>{x.judul} {x.wajib ? <Badge>wajib</Badge> : <Badge color="amber">peringatan</Badge>}</p>
                      <p className={cx('text-xs', x.status === 'gagal' ? 'text-rose-700' : x.status === 'peringatan' ? 'text-amber-800' : 'text-slate-500')}>{x.detail}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pl-11 sm:pl-0">
                    {x.aksi === 'setor_sisa' && tulis && !d.tutup && <Button size="sm" icon={Landmark} onClick={() => { setF((v) => ({ ...v, tanggal: `${tahun}-12-31` })); setModal('setor'); }}>Setor sisa UP</Button>}
                    {x.link && x.status !== 'ok' && <Link to={x.link}><Button size="sm" variant="secondary" icon={ArrowRight}>Buka</Button></Link>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {l && (
        <div className="print-area theme-light rounded-2xl border border-slate-200 bg-white p-6 text-[12px] text-black print:border-0 print:p-0">
          <div className="text-center">
            <p className="text-sm font-bold uppercase">{l.skpd.nama}</p>
            <p className="mt-1 text-base font-bold">LAPORAN PERTANGGUNGJAWABAN BENDAHARA PENGELUARAN</p>
            <p>Tahun Anggaran {tahun}{d.tutup ? ' · telah ditutup' : ''}</p>
          </div>
          <p className="mt-4 font-semibold">A. Mutasi kas setahun</p>
          <table className="mt-1 w-full border-collapse">
            <thead><tr><th className="border border-black px-2 py-1 text-left">Uraian</th><th className="border border-black px-2 py-1">Transaksi</th><th className="border border-black px-2 py-1 text-right">Penerimaan</th><th className="border border-black px-2 py-1 text-right">Pengeluaran</th></tr></thead>
            <tbody>
              {l.mutasi.map((m) => <tr key={m.jenis}><td className="border border-black px-2 py-0.5">{m.label}</td><td className="border border-black px-2 py-0.5 text-center">{m.jumlah}</td><td className="border border-black px-2 py-0.5 text-right">{m.penerimaan ? money(m.penerimaan) : '-'}</td><td className="border border-black px-2 py-0.5 text-right">{m.pengeluaran ? money(m.pengeluaran) : '-'}</td></tr>)}
              <tr className="font-bold"><td className="border border-black px-2 py-1" colSpan={2}>Jumlah</td><td className="border border-black px-2 py-1 text-right">{money(l.total.penerimaan)}</td><td className="border border-black px-2 py-1 text-right">{money(l.total.pengeluaran)}</td></tr>
              <tr className="font-bold"><td className="border border-black px-2 py-1" colSpan={3}>Saldo akhir kas (bank {money(d.saldo.bank)}; tunai {money(d.saldo.tunai)})</td><td className="border border-black px-2 py-1 text-right">{money(d.saldo.total)}</td></tr>
            </tbody>
          </table>
          <p className="mt-4 font-semibold">B. Realisasi belanja per kode rekening</p>
          <div className="overflow-x-auto">
            <table className="mt-1 w-full min-w-[620px] border-collapse">
              <thead><tr><th className="border border-black px-2 py-1 text-left">Kode / uraian</th><th className="border border-black px-2 py-1 text-right">Pagu</th><th className="border border-black px-2 py-1 text-right">Realisasi</th><th className="border border-black px-2 py-1 text-right">Sisa</th><th className="border border-black px-2 py-1">%</th></tr></thead>
              <tbody>
                {l.rekening.map((r) => <tr key={r.kode}><td className="border border-black px-2 py-0.5"><span className="font-mono text-[10.5px]">{r.kode}</span> {r.nama}</td><td className="border border-black px-2 py-0.5 text-right">{money(r.pagu)}</td><td className="border border-black px-2 py-0.5 text-right">{money(r.realisasi)}</td><td className="border border-black px-2 py-0.5 text-right">{money(r.sisa)}</td><td className="border border-black px-2 py-0.5 text-center">{r.persen != null ? r.persen.toFixed(1) : '-'}</td></tr>)}
                <tr className="font-bold"><td className="border border-black px-2 py-1">Jumlah</td><td className="border border-black px-2 py-1 text-right">{money(l.anggaran.pagu)}</td><td className="border border-black px-2 py-1 text-right">{money(l.anggaran.realisasi)}</td><td className="border border-black px-2 py-1 text-right">{money(l.anggaran.sisa)}</td><td className="border border-black px-2 py-1 text-center">{l.anggaran.persen.toFixed(1)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 font-semibold">C. Pajak</p>
          <p>Dipungut {rp(l.pajak.pungut)}; disetor {rp(l.pajak.setor)}; belum disetor {rp(l.pajak.pungut - l.pajak.setor)}.</p>
          <div className="mt-8 grid grid-cols-2 gap-8 text-center">
            <div><p>Mengetahui,</p><p>Pengguna Anggaran</p><div className="h-16" /><p className="font-semibold underline">{l.skpd.kepala_nama}</p><p>NIP. {l.skpd.kepala_nip}</p></div>
            <div><p>{tgl(d.tutup ? String(d.tutup.ditutup_at).slice(0, 10) : `${tahun}-12-31`, { long: true })}</p><p>Bendahara Pengeluaran</p><div className="h-16" /><p className="font-semibold underline">{l.skpd.bendahara_nama}</p><p>NIP. {l.skpd.bendahara_nip}</p></div>
          </div>
          <div className="mt-6 flex justify-end"><DocQr jenis="lpj" skpdId={skpdId} parameter={{ tahun }} /></div>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} size="sm" title={modal === 'setor' ? 'Setor sisa UP ke kas daerah' : `Tutup Tahun Anggaran ${tahun}`}
        subtitle={modal === 'setor' ? `Saldo ${rp(d?.saldo.total)} dibukukan sebagai penyetoran (per kas bank/tunai)` : 'Desember dikunci, ringkasan setahun disegel, dan saldo awal tahun berikutnya dibuat bila masih ada sisa kas.'}
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Batal</Button><Button loading={busy} icon={modal === 'setor' ? Landmark : Lock} onClick={jalankan}>{modal === 'setor' ? 'Setor & bukukan' : 'Tutup tahun anggaran'}</Button></>}>
        {modal === 'setor' ? <Field label="Tanggal penyetoran"><Input type="date" value={f.tanggal} onChange={(e) => setF({ ...f, tanggal: e.target.value })} /></Field> : (
          <div className="space-y-3">
            {d?.daftar.some((x) => x.status === 'peringatan') && <Alert tone="warn" title="Masih ada peringatan">{d.daftar.filter((x) => x.status === 'peringatan').map((x) => x.judul).join('; ')}.</Alert>}
            <Field label="Catatan"><Textarea value={f.catatan} onChange={(e) => setF({ ...f, catatan: e.target.value })} placeholder="mis. LPJ telah diperiksa PPK-SKPD" /></Field>
            <p className="text-[11px] text-slate-500">Tindakan ini tidak dapat dibatalkan dari aplikasi; pembukaan kembali Desember hanya oleh admin melalui Tutup Buku.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
