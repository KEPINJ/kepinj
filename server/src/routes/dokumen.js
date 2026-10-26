// Verifikasi keaslian dokumen cetak lewat QR code. Setiap cetakan menyimpan "sidik" (SHA-256)
// dari data yang dicetak; halaman publik menghitung ulang sidik dari data terkini dan membandingkannya.
import { createHash, randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, notFound, int, scopeSkpd } from '../lib/http.js';
import { dataSpj } from './spj.js';
import { NAMA_BULAN } from '../lib/kalender.js';

const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const ALFABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const kodeBaru = () => Array.from(randomBytes(10), (b) => ALFABET[b % ALFABET.length]).join('');

/** Hitung sidik dan ringkasan dokumen dari data terkini. */
async function sidikDokumen(jenis, skpd, p) {
  if (jenis === 'kuitansi') {
    const { rows: [e] } = await query('SELECT id, skpd_id, no_urut, tanggal, no_bukti, uraian, penerimaan, pengeluaran, hash FROM bku_entries WHERE id = $1', [int(p.entry_id)]);
    if (!e || e.skpd_id !== skpd) throw notFound('Transaksi tidak ditemukan');
    const nilai = Number(e.pengeluaran) || Number(e.penerimaan);
    return { judul: `Kuitansi BKU No. ${e.no_urut} (${e.no_bukti})`, sidik: sha([e.hash]),
      ringkasan: { 'No. BKU': e.no_urut, Tanggal: e.tanggal, 'No. bukti': e.no_bukti, Uraian: e.uraian.slice(0, 160), Nilai: nilai } };
  }
  if (jenis === 'bku') {
    const tahun = int(p.tahun); const bulan = int(p.bulan) || null;
    const dari = bulan ? `${tahun}-${String(bulan).padStart(2, '0')}-01` : `${tahun}-01-01`;
    const sampai = bulan ? new Date(Date.UTC(tahun, bulan, 0)).toISOString().slice(0, 10) : `${tahun}-12-31`;
    const { rows } = await query('SELECT hash, penerimaan, pengeluaran FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND tanggal BETWEEN $3 AND $4 ORDER BY tanggal, no_urut', [skpd, tahun, dari, sampai]);
    const masuk = rows.reduce((s, r) => s + Number(r.penerimaan), 0); const keluar = rows.reduce((s, r) => s + Number(r.pengeluaran), 0);
    return { judul: `Buku Kas Umum ${bulan ? NAMA_BULAN[bulan - 1] : 'Tahun'} ${tahun}`, sidik: sha(rows.map((r) => r.hash)),
      ringkasan: { Periode: `${dari} s.d. ${sampai}`, 'Jumlah transaksi': rows.length, Penerimaan: masuk, Pengeluaran: keluar } };
  }
  if (jenis === 'spj') {
    const tahun = int(p.tahun); const bulan = int(p.bulan);
    const d = await dataSpj(skpd, tahun, bulan);
    return { judul: `SPJ ${p.versi === 'administratif' ? 'Administratif' : 'Fungsional'} ${d.nama_bulan} ${tahun}`,
      sidik: sha({ r: d.rekening.map((r) => [r.kode_rekening, r.jumlah_sd]), a: d.arus, s: d.saldo_kas }),
      ringkasan: { Bulan: `${d.nama_bulan} ${tahun}`, 'Jumlah SPJ s.d. bulan ini': d.total.jumlah_sd, 'Saldo kas': d.saldo_kas.saldo } };
  }
  throw bad('Jenis dokumen tidak dikenal');
}

export default async function dokumenRoutes(app) {
  app.post('/api/dokumen', { preHandler: requireAuth }, async (req) => {
    const b = req.body || {};
    const skpd = scopeSkpd(req.user, b.skpd_id);
    const parameter = b.parameter || {};
    const s = await sidikDokumen(b.jenis, skpd, parameter);
    const { rows: [ada] } = await query('SELECT kode FROM dokumen_verifikasi WHERE jenis = $1 AND skpd_id = $2 AND parameter = $3 AND sidik = $4 LIMIT 1',
      [b.jenis, skpd, parameter, s.sidik]);
    if (ada) return { kode: ada.kode, judul: s.judul };
    const kode = kodeBaru();
    await query('INSERT INTO dokumen_verifikasi (kode, jenis, skpd_id, judul, parameter, sidik, ringkasan, dibuat_oleh) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [kode, b.jenis, skpd, s.judul, parameter, s.sidik, s.ringkasan, req.user.id]);
    return { kode, judul: s.judul };
  });

  // Publik (tanpa login): dipanggil dari halaman hasil pindai QR
  app.get('/api/publik/dokumen/:kode', async (req) => {
    const kode = String(req.params.kode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const { rows: [d] } = await query(`SELECT d.*, s.nama AS skpd_nama, s.kode AS skpd_kode, u.full_name AS dibuat_nama
      FROM dokumen_verifikasi d JOIN skpd s ON s.id = d.skpd_id LEFT JOIN users u ON u.id = d.dibuat_oleh WHERE d.kode = $1`, [kode]);
    if (!d) throw notFound('Kode dokumen tidak terdaftar. Dokumen ini tidak diterbitkan oleh aplikasi BKU.');
    let kini = null;
    try { kini = await sidikDokumen(d.jenis, d.skpd_id, d.parameter); } catch { /* data sumber hilang */ }
    return {
      kode: d.kode, jenis: d.jenis, judul: d.judul, skpd: `${d.skpd_kode} ${d.skpd_nama}`, dicetak_pada: d.dibuat_at, dicetak_oleh: d.dibuat_nama,
      ringkasan: d.ringkasan, sidik: d.sidik, cocok: kini?.sidik === d.sidik,
      pesan: kini?.sidik === d.sidik ? 'Isi dokumen sesuai dengan data BKU saat ini.' : 'Data sumber telah berubah sejak dokumen dicetak (mis. ada transaksi/koreksi baru pada periode tersebut). Minta cetakan terbaru.',
    };
  });
}
