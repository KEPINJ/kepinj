import { useEffect, useState } from 'react';
import { Mail, MessageCircle, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Button, Field, Input, Modal, useToast } from './ui.jsx';

/** Kontak pengingat milik pengguna: email & WhatsApp, saluran yang diinginkan, pratinjau pesan harian. */
export default function ProfilPengingat({ open, onClose }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState({ email: '', no_wa: '', pengingat: { email: true, wa: true } });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const muat = () => api.get('/api/pengingat/pratinjau').then((r) => { setD(r); setF({ email: r.profil.email || '', no_wa: r.profil.no_wa || '', pengingat: r.profil.pengingat || { email: true, wa: true } }); }).catch((e) => setErr(e.message));
  useEffect(() => { if (open) { setErr(''); setD(null); muat(); } }, [open]);
  const simpan = async (lanjutUji) => {
    setBusy(lanjutUji ? 'uji' : 'simpan'); setErr('');
    try {
      await api.put('/api/auth/profil', f);
      if (lanjutUji) {
        const r = await api.post('/api/pengingat/uji', {});
        const n = r.terkirim + r.simulasi + r.gagal;
        toast(r.gagal ? `${r.gagal} pesan uji gagal terkirim, cek pengaturan saluran` : r.terkirim ? `${r.terkirim} pesan uji terkirim` : `${n} pesan uji tercatat (mode simulasi: saluran belum dikonfigurasi admin)`, r.gagal ? 'error' : 'ok');
      } else { toast('Kontak pengingat disimpan'); onClose(); }
      muat();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const tog = (k) => setF((x) => ({ ...x, pengingat: { ...x.pengingat, [k]: !x.pengingat[k] } }));
  return (
    <Modal open={open} onClose={onClose} title="Pengingat WhatsApp & email" subtitle={d ? `Dikirim setiap hari pukul ${d.jam} bila ada tenggat atau tugas yang perlu ditindaklanjuti` : 'Memuat…'}
      footer={<><Button variant="secondary" onClick={onClose}>Tutup</Button><Button variant="secondary" icon={Send} loading={busy === 'uji'} onClick={() => simpan(true)}>Simpan & kirim uji</Button><Button loading={busy === 'simpan'} onClick={() => simpan(false)}>Simpan</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        {d && !d.aktif && <Alert tone="warn">Pengingat harian sedang dinonaktifkan oleh administrator.</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email" hint={d && !d.kanal.email ? 'Server email belum dikonfigurasi (mode simulasi)' : undefined}>
            <div className="flex items-center gap-2"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nama@instansi.go.id" />
              <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={f.pengingat.email !== false} onChange={() => tog('email')} /><Mail className="h-3.5 w-3.5" /></label></div>
          </Field>
          <Field label="Nomor WhatsApp" hint={d && !d.kanal.wa ? 'Gateway WhatsApp belum dikonfigurasi (mode simulasi)' : 'Format 08xx atau 628xx'}>
            <div className="flex items-center gap-2"><Input value={f.no_wa} onChange={(e) => setF({ ...f, no_wa: e.target.value })} placeholder="0812xxxxxxxx" />
              <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={f.pengingat.wa !== false} onChange={() => tog('wa')} /><MessageCircle className="h-3.5 w-3.5" /></label></div>
          </Field>
        </div>
        {d && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600">Pratinjau pesan hari ini ({d.jumlah} hal)</p>
            <div className="max-h-64 overflow-auto rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700"><TeksWa teks={d.pesan.wa || d.pesan.isi} /></p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Tampilkan *tebal* gaya WhatsApp. */
export function TeksWa({ teks }) {
  return String(teks || '').split(/(\*[^*\n]+\*)/).map((t, i) => (t.startsWith('*') && t.endsWith('*') && t.length > 2 ? <b key={i}>{t.slice(1, -1)}</b> : t));
}
