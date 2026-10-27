import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, BookOpen, Download, Receipt, BarChart3, Wallet, FileCheck2, BookCopy } from 'lucide-react';
import { download } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Button, Card, Field, PageHeader, Select, useToast } from '../components/ui.jsx';
import { BULAN } from '../lib/format.js';

export default function Laporan() {
  const { skpdId, tahun } = useApp();
  const toast = useToast();
  const [bulan, setBulan] = useState(new Date().getMonth() + 1);
  const err = (e) => toast(e.message, 'error');
  const items = [
    { icon: BookOpen, title: 'Buku Kas Umum bulanan', text: 'Format Permendagri 77/2020 lengkap dengan saldo, terbilang dan kolom tanda tangan.',
      actions: <><Link to={`/cetak/bku?bulan=${bulan}`} target="_blank"><Button size="sm" icon={Printer}>Cetak / PDF</Button></Link><Button size="sm" variant="secondary" icon={Download} onClick={() => download('/api/bku/export.xlsx', { params: { skpd_id: skpdId, tahun, bulan } }).catch(err)}>Excel</Button></> },
    { icon: BookOpen, title: 'Buku Kas Umum setahun', text: 'Seluruh transaksi tahun anggaran berjalan.',
      actions: <><Link to="/cetak/bku" target="_blank"><Button size="sm" icon={Printer}>Cetak / PDF</Button></Link><Button size="sm" variant="secondary" icon={Download} onClick={() => download('/api/bku/export.xlsx', { params: { skpd_id: skpdId, tahun } }).catch(err)}>Excel</Button></> },
    { icon: FileCheck2, title: 'SPJ bendahara pengeluaran', text: 'Laporan pertanggungjawaban fungsional & administratif per bulan, terisi otomatis dari BKU.',
      actions: <Link to="/spj"><Button size="sm" icon={Printer}>Buka SPJ</Button></Link> },
    { icon: BookCopy, title: 'Buku pembantu', text: 'Kas tunai, simpanan/bank, rincian objek belanja dan UP/GU/TU.',
      actions: <Link to="/buku-pembantu"><Button size="sm" variant="secondary">Buka</Button></Link> },
    { icon: Receipt, title: 'Buku pembantu pajak', text: 'Register pajak pungut/setor per masa, dengan NTPN.',
      actions: <Button size="sm" variant="secondary" icon={Download} onClick={() => download('/api/pajak/coretax/export', { params: { skpd_id: skpdId, tahun, masa: bulan, form: 'ALL', format: 'xlsx' } }).catch(err)}>Excel masa {BULAN[bulan - 1]}</Button> },
    { icon: BarChart3, title: 'Laporan realisasi anggaran', text: 'Pagu, realisasi, sisa dan persentase per kode rekening.',
      actions: <Button size="sm" variant="secondary" icon={Download} onClick={() => download('/api/laporan/realisasi', { params: { skpd_id: skpdId, tahun, format: 'xlsx' } }).catch(err)}>Excel</Button> },
    { icon: Wallet, title: 'Register penutupan kas', text: 'Dicetak dari menu Penutupan Kas setelah hitung fisik.', actions: <Link to="/penutupan-kas"><Button size="sm" variant="secondary">Buka</Button></Link> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader icon={Printer} title="Cetak Laporan" subtitle="Laporan siap cetak dan unduh" actions={<Field><Select value={bulan} onChange={(e) => setBulan(Number(e.target.value))} options={BULAN.map((b, i) => ({ value: i + 1, label: `${b} ${tahun}` }))} /></Field>} />
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((i) => (
          <Card key={i.title}>
            <div className="flex gap-3">
              <div className="h-fit rounded-xl bg-brand-50 p-2.5 text-brand-700"><i.icon className="h-5 w-5" /></div>
              <div className="flex-1"><p className="font-semibold text-slate-800">{i.title}</p><p className="mt-0.5 text-sm text-slate-500">{i.text}</p><div className="mt-3 flex flex-wrap gap-2">{i.actions}</div></div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
