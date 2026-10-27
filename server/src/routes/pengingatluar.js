// Pengingat terjadwal lewat email (SMTP) dan WhatsApp (gateway HTTP, mis. Fonnte). Isi pesan sama dengan
// lonceng notifikasi. Bila kanal belum dikonfigurasi, pesan dicatat sebagai "simulasi" tanpa dikirim.
import nodemailer from 'nodemailer';
import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad } from '../lib/http.js';
import { getPengaturan, pengaturanPublik, simpanPengaturan } from '../lib/pengaturan.js';
import { hariIni } from '../lib/kalender.js';
import { kumpulkanNotifikasi } from './pengingat.js';

const TINGKAT = { bahaya: ['bahaya'], peringatan: ['bahaya', 'peringatan'], info: ['bahaya', 'peringatan', 'info'] };
const KUNCI = ['pengingat_aktif', 'pengingat_jam', 'pengingat_tingkat', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from', 'wa_penyedia', 'wa_url', 'wa_token'];

export const normalisasiWa = (no) => {
  const d = String(no || '').replace(/\D/g, '');
  return d.startsWith('0') ? `62${d.slice(1)}` : d.startsWith('8') ? `62${d}` : d;
};
const kanalSiap = (cfg) => ({ email: Boolean(cfg.smtp_host && cfg.smtp_from), wa: Boolean(cfg.wa_url && cfg.wa_token) });

export function susunPesan(user, items, { uji = false } = {}) {
  const judul = uji ? 'Uji pengingat BKU' : `Pengingat BKU: ${items.length} hal perlu ditindaklanjuti`;
  const baris = items.map((i, n) => `${n + 1}. ${i.judul}${i.pesan ? `\n   ${i.pesan}` : ''}`);
  const sapa = `Yth. ${user.full_name},`;
  const isi = uji && !items.length ? `${sapa}\n\nIni pesan uji dari aplikasi Buku Kas Umum. Kanal pengingat Anda sudah berfungsi.`
    : `${sapa}\n\nBerikut hal yang perlu ditindaklanjuti hari ini (${hariIni().split('-').reverse().join('/')}):\n\n${baris.join('\n')}\n\nBuka aplikasi BKU untuk detailnya.`;
  const wa = uji && !items.length ? `*Uji pengingat BKU*\n${sapa}\nKanal WhatsApp Anda sudah berfungsi.`
    : `*Pengingat BKU* (${items.length})\n${sapa}\n\n${items.map((i, n) => `${n + 1}. *${i.judul}*${i.pesan ? `\n${i.pesan}` : ''}`).join('\n\n')}`;
  return { judul, isi, wa };
}

async function kirimEmail(cfg, to, subject, text) {
  const t = nodemailer.createTransport({ host: cfg.smtp_host, port: Number(cfg.smtp_port) || 587, secure: Boolean(cfg.smtp_secure),
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined, connectionTimeout: 15000 });
  await t.sendMail({ from: cfg.smtp_from, to, subject, text });
}

async function kirimWa(cfg, to, text) {
  const ctl = AbortSignal.timeout(15000);
  const res = cfg.wa_penyedia === 'fonnte'
    ? await fetch(cfg.wa_url, { method: 'POST', headers: { Authorization: cfg.wa_token }, body: new URLSearchParams({ target: to, message: text }), signal: ctl })
    : await fetch(cfg.wa_url, { method: 'POST', headers: { Authorization: `Bearer ${cfg.wa_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ to, message: text }), signal: ctl });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gateway WA ${res.status}: ${body.slice(0, 160)}`);
  try { const j = JSON.parse(body); if (j.status === false) throw new Error(j.reason || j.detail || 'ditolak gateway'); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
}

/** Kirim pengingat ke pengguna aktif yang punya email/nomor WA. */
export async function jalankanPengingat({ pemicu = 'jadwal', userIds = null, uji = false } = {}) {
  const cfg = await getPengaturan();
  const siap = kanalSiap(cfg);
  const { rows: users } = await query(`SELECT id, username, full_name, role, skpd_id, unit_id, email, no_wa, pengingat FROM users
    WHERE active AND (COALESCE(email,'') <> '' OR COALESCE(no_wa,'') <> '') ${userIds ? 'AND id = ANY($1)' : ''} ORDER BY id`, userIds ? [userIds] : []);
  const tahun = new Date().getFullYear();
  const hasil = { pengguna: 0, terkirim: 0, simulasi: 0, gagal: 0 };
  for (const u of users) {
    if (!u.skpd_id) continue;
    const items = (await kumpulkanNotifikasi(u, u.skpd_id, tahun)).filter((i) => TINGKAT[cfg.pengingat_tingkat || 'peringatan'].includes(i.tingkat));
    if (!items.length && !uji) continue;
    hasil.pengguna++;
    const m = susunPesan(u, items, { uji });
    const kanal = [];
    if (u.email && u.pengingat?.email !== false) kanal.push(['email', u.email]);
    if (u.no_wa && u.pengingat?.wa !== false) kanal.push(['wa', normalisasiWa(u.no_wa)]);
    for (const [k, tujuan] of kanal) {
      let status = 'simulasi'; let galat = null;
      if (siap[k]) {
        try { if (k === 'email') await kirimEmail(cfg, tujuan, m.judul, m.isi); else await kirimWa(cfg, tujuan, m.wa); status = 'terkirim'; } catch (e) { status = 'gagal'; galat = String(e.message).slice(0, 300); }
      }
      hasil[status]++;
      await query('INSERT INTO pengingat_log (user_id, kanal, tujuan, judul, isi, status, galat, pemicu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [u.id, k, tujuan, m.judul, k === 'wa' ? m.wa : m.isi, status, galat, uji ? 'uji' : pemicu]);
    }
  }
  return hasil;
}

/** Penjadwal sederhana per menit: pengingat harian dan tugas lain yang didaftarkan. */
const tugas = [];
export const daftarTugasHarian = (kunciTerakhir, jamKey, aktifKey, fn) => tugas.push({ kunciTerakhir, jamKey, aktifKey, fn });
daftarTugasHarian('pengingat_terakhir', 'pengingat_jam', 'pengingat_aktif', () => jalankanPengingat({ pemicu: 'jadwal' }));

export function mulaiPenjadwal(log) {
  const cek = async () => {
    try {
      const cfg = await getPengaturan();
      const now = new Date();
      const jam = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      for (const t of tugas) {
        if (!cfg[t.aktifKey] || jam < String(cfg[t.jamKey] || '99:99') || cfg[t.kunciTerakhir] === hariIni()) continue;
        await tx((c) => simpanPengaturan(c, { [t.kunciTerakhir]: hariIni() }));
        const r = await t.fn();
        log.info({ tugas: t.kunciTerakhir, hasil: r }, 'tugas terjadwal selesai');
      }
    } catch (e) { log.error(e, 'penjadwal gagal'); }
  };
  const id = setInterval(cek, 60_000);
  setTimeout(cek, 5_000);
  return () => clearInterval(id);
}

export default async function pengingatLuarRoutes(app) {
  app.get('/api/pengingat', { preHandler: requireRole('admin') }, async () => {
    const cfg = await pengaturanPublik();
    const raw = await getPengaturan();
    const [{ rows: log }, { rows: penerima }, { rows: [rk] }] = await Promise.all([
      query('SELECT l.*, u.full_name FROM pengingat_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 100'),
      query(`SELECT u.id, u.full_name, u.role, u.email, u.no_wa, u.pengingat, s.kode AS skpd_kode FROM users u LEFT JOIN skpd s ON s.id = u.skpd_id WHERE u.active ORDER BY u.full_name`),
      query(`SELECT COUNT(*) FILTER (WHERE status = 'terkirim')::int AS terkirim, COUNT(*) FILTER (WHERE status = 'gagal')::int AS gagal, COUNT(*) FILTER (WHERE status = 'simulasi')::int AS simulasi
        FROM pengingat_log WHERE created_at > now() - interval '30 days'`),
    ]);
    return { pengaturan: Object.fromEntries(KUNCI.map((k) => [k, cfg[k]])), terakhir: raw.pengingat_terakhir || null, kanal: kanalSiap(raw), log, penerima, rekap: rk };
  });

  app.put('/api/pengingat/pengaturan', { preHandler: requireRole('admin') }, async (req) => {
    const b = req.body || {};
    const nilai = Object.fromEntries(Object.entries(b).filter(([k]) => KUNCI.includes(k)));
    if (nilai.pengingat_jam && !/^\d{2}:\d{2}$/.test(nilai.pengingat_jam)) throw bad('Jam pengingat format HH:MM');
    if (nilai.pengingat_tingkat && !TINGKAT[nilai.pengingat_tingkat]) throw bad('Tingkat pengingat tidak dikenal');
    if ('smtp_port' in nilai) nilai.smtp_port = Number(nilai.smtp_port) || 587;
    return tx(async (c) => {
      await simpanPengaturan(c, nilai);
      await audit(c, req.user, 'pengingat_pengaturan', 'pengaturan', null, Object.fromEntries(Object.entries(nilai).map(([k, v]) => [k, ['smtp_pass', 'wa_token'].includes(k) ? '(diubah)' : v])), req.ip);
      return { ok: true };
    });
  });

  app.post('/api/pengingat/jalankan', { preHandler: requireRole('admin') }, async (req) => {
    const r = await jalankanPengingat({ pemicu: 'manual' });
    await tx((c) => audit(c, req.user, 'pengingat_jalankan', 'pengingat', null, r, req.ip));
    return r;
  });

  app.post('/api/pengingat/uji', { preHandler: requireAuth }, async (req) => {
    const { rows: [u] } = await query('SELECT email, no_wa, skpd_id FROM users WHERE id = $1', [req.user.id]);
    if (!u.email && !u.no_wa) throw bad('Isi email atau nomor WhatsApp di profil Anda terlebih dahulu');
    if (!u.skpd_id) throw bad('Akun tanpa SKPD tidak menerima pengingat');
    return jalankanPengingat({ userIds: [req.user.id], uji: true });
  });

  app.get('/api/pengingat/pratinjau', { preHandler: requireAuth }, async (req) => {
    const cfg = await getPengaturan();
    const { rows: [u] } = await query('SELECT id, full_name, role, skpd_id, unit_id, email, no_wa, pengingat FROM users WHERE id = $1', [req.user.id]);
    const items = u.skpd_id ? (await kumpulkanNotifikasi({ ...req.user, ...u }, u.skpd_id, new Date().getFullYear())).filter((i) => TINGKAT[cfg.pengingat_tingkat || 'peringatan'].includes(i.tingkat)) : [];
    return { profil: { email: u.email, no_wa: u.no_wa, pengingat: u.pengingat }, jam: cfg.pengingat_jam, aktif: cfg.pengingat_aktif, kanal: kanalSiap(cfg), pesan: susunPesan(u, items), jumlah: items.length };
  });

  app.put('/api/auth/profil', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    const email = String(b.email || '').trim() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Format email tidak valid');
    const wa = String(b.no_wa || '').trim() || null;
    if (wa && normalisasiWa(wa).length < 10) throw bad('Nomor WhatsApp tidak valid');
    return tx(async (c) => {
      const { rows: [r] } = await c.query('UPDATE users SET email = $2, no_wa = $3, pengingat = $4 WHERE id = $1 RETURNING email, no_wa, pengingat',
        [req.user.id, email, wa, { email: b.pengingat?.email !== false, wa: b.pengingat?.wa !== false }]);
      await audit(c, req.user, 'profil_ubah', 'user', req.user.id, { email, no_wa: wa }, req.ip);
      return { profil: r };
    });
  });
}
