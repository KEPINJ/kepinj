import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Bot, User, Wrench, RotateCcw, Info } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/ctx.jsx';
import { Badge, Button, Card, PageHeader, Spinner, cx, useLoad, useToast } from '../components/ui.jsx';
import Markdown from '../components/Markdown.jsx';

const NAMA_ALAT = {
  ringkasan_kas: 'Ringkasan kas', serapan_anggaran: 'Serapan anggaran', cari_transaksi: 'Cari transaksi', rekap_belanja: 'Rekap belanja', status_persetujuan: 'Status persetujuan',
  kewajiban_pajak: 'Kewajiban pajak', rekonsiliasi_bank: 'Rekonsiliasi bank', neraca_saldo: 'Neraca saldo', ringkasan_aset: 'Ringkasan aset', peringatan: 'Peringatan',
};

/** Asisten analisis perbendaharaan, akuntansi & pelaporan: tanya dengan bahasa sehari-hari, jawaban dihitung dari data aplikasi. */
export default function Asisten() {
  const { skpdId, tahun, skpd } = useApp();
  const toast = useToast();
  const info = useLoad(() => api.get('/api/asisten'), []);
  const [pesan, setPesan] = useState([]);
  const [teks, setTeks] = useState('');
  const [busy, setBusy] = useState(false);
  const akhir = useRef(null);
  useEffect(() => {
    if (info.data && !pesan.length) setPesan(info.data.riwayat.slice(-4).flatMap((r) => [{ peran: 'pengguna', teks: r.pertanyaan, lama: true }, { peran: 'asisten', teks: r.jawaban, alat: (r.alat || []).map((n) => ({ nama: n })), mode: r.mode, lama: true }]));
  }, [info.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { akhir.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [pesan, busy]);

  const tanya = async (q) => {
    const pertanyaan = (q ?? teks).trim();
    if (pertanyaan.length < 3 || busy) return;
    setTeks(''); setBusy(true);
    const riwayat = pesan.filter((p) => !p.lama).slice(-8).map(({ peran, teks: t }) => ({ peran, teks: t }));
    setPesan((p) => [...p, { peran: 'pengguna', teks: pertanyaan }]);
    try {
      const r = await api.post('/api/asisten', { pertanyaan, riwayat, skpd_id: skpdId, tahun });
      setPesan((p) => [...p, { peran: 'asisten', teks: r.jawaban, alat: r.alat, mode: r.mode, durasi: r.durasi_ms, catatan: r.catatan }]);
    } catch (e) { toast(e.message, 'error'); setPesan((p) => p.slice(0, -1)); setTeks(pertanyaan); } finally { setBusy(false); }
  };
  const mode = info.data?.mode;

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[520px] flex-col gap-3">
      <PageHeader icon={Sparkles} title="Asisten Analisis Keuangan" subtitle={`Tanya dengan bahasa sehari-hari tentang kas, anggaran, pajak, akuntansi, dan aset · ${skpd?.nama || ''} · TA ${tahun}`}
        actions={<>{mode && <Badge color={mode === 'claude' ? 'violet' : 'blue'}>{mode === 'claude' ? `AI generatif (${info.data.model})` : 'Mode lokal (tanpa internet)'}</Badge>}
          {pesan.length > 0 && <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setPesan([])}>Percakapan baru</Button>}</>} />
      <Card className="flex min-h-0 flex-1 flex-col" bodyClass="flex min-h-0 flex-1 flex-col p-0">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {!pesan.length && (
            <div className="mx-auto max-w-2xl py-6 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 text-gold-400"><Sparkles className="h-6 w-6" /></div>
              <p className="text-base font-semibold text-slate-800">Apa yang ingin Anda ketahui?</p>
              <p className="mt-1 text-xs text-slate-500">Jawaban dihitung langsung dari data BKU, anggaran, pajak, jurnal, rekonsiliasi, dan aset sesuai hak akses Anda. Asisten tidak mengubah data.</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {(info.data?.contoh || []).slice(0, 8).map((c) => <button key={c} type="button" onClick={() => tanya(c)} className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">{c}</button>)}
              </div>
            </div>
          )}
          {pesan.map((p, i) => (
            <div key={i} className={cx('flex gap-2.5', p.peran === 'pengguna' && 'flex-row-reverse', p.lama && 'opacity-75')}>
              <div className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full', p.peran === 'pengguna' ? 'bg-slate-200 text-slate-600' : 'bg-brand-700 text-gold-400')}>{p.peran === 'pengguna' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}</div>
              <div className={cx('min-w-0 max-w-[85%] rounded-2xl px-3.5 py-2.5', p.peran === 'pengguna' ? 'bg-brand-700 text-sm text-white' : 'border border-slate-200 bg-surface')}>
                {p.peran === 'pengguna' ? p.teks : <>
                  <Markdown text={p.teks} />
                  {(p.alat?.length > 0 || p.durasi) && <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-1.5 text-[10px] text-slate-400">
                    {p.alat?.length > 0 && <><Wrench className="h-3 w-3" />Data: {p.alat.map((a) => NAMA_ALAT[a.nama] || a.nama).join(', ')}</>}
                    {p.durasi && <span className="ml-auto">{p.mode === 'claude' ? 'AI' : 'lokal'} · {(p.durasi / 1000).toFixed(1)} dtk</span>}
                  </div>}
                  {p.catatan && <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700"><Info className="h-3 w-3" />{p.catatan}</p>}
                </>}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><Spinner className="h-4 w-4" />Menghitung dari data…</div>}
          <div ref={akhir} />
        </div>
        <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={(e) => { e.preventDefault(); tanya(); }}>
          <input className="input flex-1" value={teks} onChange={(e) => setTeks(e.target.value)} placeholder="mis. Berapa sisa anggaran belanja barang dan jasa bulan ini?" maxLength={1000} disabled={!skpdId} />
          <Button type="submit" icon={Send} loading={busy} disabled={teks.trim().length < 3}>Tanya</Button>
        </form>
      </Card>
      <p className="text-center text-[11px] text-slate-400">Jawaban asisten adalah alat bantu analisis. Angka resmi tetap mengacu pada laporan BKU, SPJ, dan laporan keuangan yang disahkan.</p>
    </div>
  );
}
