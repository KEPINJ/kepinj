import { query } from '../db.js';

import { ATURAN_DOKUMEN } from '../../../shared/dokumen.js';

const ALUR = {
  alur_bku: [{ peran: 'verifikator', label: 'Verifikasi PPK-SKPD' }, { peran: 'pimpinan', label: 'Persetujuan PA/KPA' }],
  alur_spp: [{ peran: 'verifikator', label: 'Verifikasi PPK-SKPD' }, { peran: 'pimpinan', label: 'Persetujuan PA/KPA' }],
  alur_spj: [{ peran: 'verifikator', label: 'Verifikasi PPK-SKPD' }, { peran: 'pimpinan', label: 'Pengesahan PA/KPA' }],
};
const DEFAULT = {
  batas_kas_tunai: 50_000_000, batas_transaksi_tunai: 10_000_000, ambang_pagu_persen: 90, ambang_gu_persen: 50, batas_hari_panjar: 14,
  ...ALUR, spj_wajib_disahkan: true,
  pengingat_aktif: true, pengingat_jam: '07:00', pengingat_tingkat: 'peringatan',
  smtp_host: '', smtp_port: 587, smtp_secure: false, smtp_user: '', smtp_pass: '', smtp_from: '',
  wa_penyedia: 'fonnte', wa_url: 'https://api.fonnte.com/send', wa_token: '',
  cadangan_aktif: true, cadangan_jam: '23:30', cadangan_simpan: 14,
  // Persetujuan berjenjang transaksi BKU & dokumen bukti
  alur_bku_aktif: true, bku_ambang_pimpinan: 10_000_000, persetujuan_wajib_dokumen: true,
  aturan_dokumen: ATURAN_DOKUMEN, lampiran_maks_mb: 5,
  // Rekonsiliasi & monitoring anggaran
  rekon_toleransi_hari: 3, rekon_toleransi_selisih_persen: 5, ambang_serapan_rendah: 20,
  // Keamanan
  login_maks_gagal: 5, login_kunci_menit: 15, sesi_idle_menit: 30, sesi_maks_jam: 12,
  password_min: 8, password_kedaluwarsa_hari: 90, password_riwayat: 3,
  uji_pulih_aktif: true, uji_pulih_hari: 7,
};
export const RAHASIA = ['smtp_pass', 'wa_token'];

export async function getPengaturan() {
  const { rows } = await query('SELECT kunci, nilai FROM pengaturan');
  return { ...DEFAULT, ...Object.fromEntries(rows.map((r) => [r.kunci, r.nilai])) };
}

/** Pengaturan untuk dikirim ke browser: kata sandi/token tidak pernah ikut, hanya penanda sudah diisi. */
export async function pengaturanPublik() {
  const p = await getPengaturan();
  for (const k of RAHASIA) p[k] = p[k] ? '••••••' : '';
  return p;
}

export async function simpanPengaturan(c, nilai) {
  for (const [k, v] of Object.entries(nilai)) {
    if (RAHASIA.includes(k) && v === '••••••') continue;
    await c.query('INSERT INTO pengaturan (kunci, nilai, updated_at) VALUES ($1, $2, now()) ON CONFLICT (kunci) DO UPDATE SET nilai = EXCLUDED.nilai, updated_at = now()', [k, JSON.stringify(v)]);
  }
}
