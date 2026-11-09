// Aturan kelengkapan dokumen bukti transaksi BKU.
// Dipakai server (menghitung status kelengkapan) dan browser (menampilkan daftar dokumen wajib).

export const JENIS_DOKUMEN = {
  bukti_transaksi: 'Bukti transaksi',
  nota_kuitansi: 'Nota / kuitansi',
  bukti_transfer: 'Bukti transfer',
  sp2d: 'SP2D',
  dokumen_pajak: 'Dokumen pajak (billing/NTPN/bukti potong)',
  pertanggungjawaban: 'Dokumen pertanggungjawaban',
  lainnya: 'Lainnya',
};

/**
 * Aturan bawaan (dapat diubah admin lewat pengaturan `aturan_dokumen`):
 * - per jenis transaksi: dokumen dasar yang wajib ada
 * - tambahan: bila belanja dibayar lewat bank wajib bukti transfer, bila ada potongan pajak wajib dokumen pajak
 * - prefiks rekening: perjalanan dinas & belanja modal wajib dokumen pertanggungjawaban (SPPD/laporan, BAST)
 */
export const ATURAN_DOKUMEN = {
  jenis: {
    BELANJA: ['nota_kuitansi'],
    SP2D_UP: ['sp2d'], SP2D_GU: ['sp2d'], SP2D_TU: ['sp2d'], SP2D_LS: ['sp2d'],
    PAJAK_SETOR: ['dokumen_pajak'],
    PENYETORAN: ['bukti_transfer'],
    PENERIMAAN: ['bukti_transaksi'],
    PELIMPAHAN: ['bukti_transaksi'],
    LAINNYA: ['bukti_transaksi'],
    KOREKSI: [], SALDO_AWAL: [], PAJAK_PUNGUT: [],
  },
  belanja_bank: 'bukti_transfer',
  belanja_pajak: 'dokumen_pajak',
  prefiks: [
    { prefiks: '5.1.02.04', dokumen: 'pertanggungjawaban', keterangan: 'Perjalanan dinas: SPT, SPPD dan laporan perjalanan' },
    { prefiks: '5.2', dokumen: 'pertanggungjawaban', keterangan: 'Belanja modal: berita acara serah terima (BAST)' },
  ],
};

/** Daftar jenis dokumen yang wajib untuk satu entri BKU. */
export function dokumenWajib(entry, { adaPajak = false } = {}, aturan = ATURAN_DOKUMEN) {
  const a = { ...ATURAN_DOKUMEN, ...(aturan || {}), jenis: { ...ATURAN_DOKUMEN.jenis, ...(aturan?.jenis || {}) } };
  const out = new Set(a.jenis[entry.jenis] || []);
  if (entry.jenis === 'BELANJA') {
    if (entry.metode === 'bank' && a.belanja_bank) out.add(a.belanja_bank);
    if (adaPajak && a.belanja_pajak) out.add(a.belanja_pajak);
    for (const p of a.prefiks || []) if (entry.kode_rekening && String(entry.kode_rekening).startsWith(p.prefiks)) out.add(p.dokumen);
  }
  return [...out].filter((j) => JENIS_DOKUMEN[j]);
}

/** Status kelengkapan dari dokumen wajib dan jenis dokumen yang sudah diunggah. */
export function statusKelengkapan(wajib, adaJenis) {
  const ada = new Set(adaJenis || []);
  if (!wajib.length) return { status: 'tidak_wajib', kurang: [] };
  const kurang = wajib.filter((j) => !ada.has(j));
  return { status: !kurang.length ? 'lengkap' : kurang.length === wajib.length ? 'belum' : 'sebagian', kurang };
}

/** Kenali jenis berkas dari isinya (magic bytes), bukan dari nama atau MIME kiriman browser. */
export function kenaliBerkas(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) return { mime: 'application/pdf', ext: ['pdf'] };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return { mime: 'image/png', ext: ['png'] };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: ['jpg', 'jpeg'] };
  return null;
}

/** Nama berkas aman: tanpa jalur folder, karakter kendali, atau karakter yang bermasalah di header HTTP. */
export function namaBerkasAman(nama) {
  const dasar = String(nama || 'berkas').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').replace(/^\.+/, '').trim();
  return (dasar || 'berkas').slice(0, 150);
}
