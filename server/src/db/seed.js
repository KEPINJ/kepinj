// Data contoh realistis untuk demo: 4 SKPD, transaksi Jan s.d. hari ini, pajak, anggaran.
// Jalankan: npm run seed  (AKAN MENGHAPUS data transaksi yang ada)
import { mkdir } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { pool, tx } from '../db.js';
import { migrate } from './migrate.js';
import { hashPassword } from '../auth.js';
import { catatTransaksi, setorPajak } from '../lib/transaksi.js';
import { insertEntries } from '../lib/ledger.js';
import { insertPajak } from '../routes/pajak.js';
import { catatPenerimaan, buatSts, batasSetor } from '../routes/penerimaan.js';
import { limpahUp, belanjaPembantu, ajukanSpj, sahkanSpj } from '../routes/pembantu.js';
import { POLA, bagiPola, tetapkanPerubahan } from '../routes/anggarankas.js';
import { kandidatTransfer } from '../routes/transfer.js';
import { potonganBelanja, pph21Bulanan, pph21HonorASN, pph21BukanPegawai } from '../../../shared/tax.js';

let seed = 20260117;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));
const round = (n, to = 1000) => Math.round(n / to) * to;
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ntpn = () => Array.from({ length: 16 }, () => pick('ABCDEF0123456789'.split(''))).join('');

const SKPD = [
  { kode: '5.02.0.00.0.00.01.0000', nama: 'Badan Keuangan dan Aset Daerah', npwp: '0012345678901000', kepala_nama: 'Dr. H. Ahmad Fauzi, S.E., M.Si.', kepala_nip: '197203151998031004', bendahara_nama: 'Siti Rahmawati, S.E.', bendahara_nip: '198507122010012015', alamat: 'Jl. Jenderal Sudirman No. 1', skala: 1 },
  { kode: '1.01.0.00.0.00.01.0000', nama: 'Dinas Pendidikan', npwp: '0023456789012000', kepala_nama: 'Drs. Bambang Sutrisno, M.Pd.', kepala_nip: '196905101994031007', bendahara_nama: 'Rina Kartika, S.Ak.', bendahara_nip: '198911202014032008', alamat: 'Jl. Pendidikan No. 12', skala: 0.8 },
  { kode: '1.02.0.00.0.00.01.0000', nama: 'Dinas Kesehatan', npwp: '0034567890123000', kepala_nama: 'dr. Linda Hapsari, M.Kes.', kepala_nip: '197512082003122003', bendahara_nama: 'Agus Prasetyo, A.Md.', bendahara_nip: '199002142015031002', alamat: 'Jl. Kesehatan No. 5', skala: 0.7 },
  { kode: '1.03.0.00.0.00.01.0000', nama: 'Dinas Pekerjaan Umum dan Penataan Ruang', npwp: '0045678901234000', kepala_nama: 'Ir. Hendra Wijaya, M.T.', kepala_nip: '197001011996031009', bendahara_nama: 'Dewi Lestari, S.E.', bendahara_nip: '198804252012122001', alamat: 'Jl. Ahmad Yani No. 30', skala: 1.2 },
];

// [kode, nama, jenis_belanja (pajak), rentang nilai]
const REKENING = [
  ['5.1.01.01.01.0001', 'Belanja Gaji Pokok PNS', null],
  ['5.1.01.01.02.0001', 'Belanja Tunjangan Keluarga PNS', null],
  ['5.1.02.01.01.0024', 'Belanja Alat/Bahan untuk Kegiatan Kantor - Alat Tulis Kantor', 'barang', [1_500_000, 25_000_000]],
  ['5.1.02.01.01.0026', 'Belanja Alat/Bahan untuk Kegiatan Kantor - Bahan Cetak', 'barang', [2_500_000, 18_000_000]],
  ['5.1.02.01.01.0052', 'Belanja Makanan dan Minuman Rapat', 'jasa', [2_500_000, 15_000_000]],
  ['5.1.02.02.01.0003', 'Honorarium Narasumber atau Pembahas, Moderator, Pembawa Acara, dan Panitia', 'honor', [1_500_000, 6_000_000]],
  ['5.1.02.02.01.0026', 'Belanja Jasa Tenaga Administrasi', 'jasa', [4_000_000, 20_000_000]],
  ['5.1.02.02.01.0055', 'Belanja Jasa Konsultansi Perencanaan', 'jasa', [15_000_000, 90_000_000]],
  ['5.1.02.03.02.0035', 'Belanja Pemeliharaan Kendaraan Dinas Bermotor Perorangan', 'jasa', [2_500_000, 12_000_000]],
  ['5.1.02.04.01.0001', 'Belanja Perjalanan Dinas Biasa', null, [1_500_000, 9_000_000]],
  ['5.1.02.02.01.0061', 'Belanja Tagihan Listrik', null, [8_000_000, 22_000_000]],
  ['5.2.02.10.01.0002', 'Belanja Modal Personal Computer', 'barang', [25_000_000, 150_000_000]],
  ['5.2.03.01.01.0001', 'Belanja Modal Bangunan Gedung Kantor', 'konstruksi', [80_000_000, 450_000_000]],
];
const PENDAPATAN = [
  ['4.1.02.02.01.0002', 'Retribusi Penyewaan Tanah dan Bangunan', [3_500_000, 18_000_000]],
  ['4.1.02.02.01.0003', 'Retribusi Pemakaian Ruangan/Gedung Pertemuan', [750_000, 4_500_000]],
  ['4.1.04.03.01.0001', 'Hasil Penjualan Aset Daerah yang Tidak Dipisahkan (Lelang)', [12_000_000, 65_000_000]],
  ['4.1.04.14.01.0001', 'Pendapatan Denda Keterlambatan Pelaksanaan Pekerjaan', [2_000_000, 25_000_000]],
  ['4.1.02.01.01.0001', 'Retribusi Pelayanan Kesehatan di Puskesmas', [1_000_000, 6_000_000]],
  ['4.1.02.03.01.0001', 'Retribusi Persetujuan Bangunan Gedung (PBG)', [2_500_000, 30_000_000]],
];
const NON_ANGGARAN = [['0.0.00.00.00.0001', 'Uang Persediaan (UP)'], ['0.0.00.00.00.0002', 'Pajak dan Potongan (PFK)']];

const REKANAN = [
  ['CV Maju Jaya Abadi', '0123456789012000', 'Bank Daerah', '1001002003'], ['PT Konsultan Nusantara Prima', '0234567890123000', 'Bank Mandiri', '1230004567'],
  ['CV Bangun Karya Mandiri', '0345678901234000', 'BRI', '0123010045678'], ['Toko ATK Sentosa', '0456789012345000', 'BNI', '0987654321'],
  ['PT Sinar Teknologi Informatika', '0567890123456000', 'BCA', '5430987612'], ['CV Rasa Nusantara Catering', '0678901234567000', 'Bank Daerah', '1001009988'],
  ['PT Percetakan Mitra Grafika', '0789012345678000', 'BRI', '0123010099887'], ['Bengkel Auto Prima', '0890123456789000', 'BNI', '0812345678'],
];

const NAMA = ['Budi Santoso', 'Sri Wahyuni', 'Andi Pratama', 'Dewi Anggraini', 'Eko Saputro', 'Fitri Handayani', 'Gilang Ramadhan', 'Hesti Purwanti', 'Irfan Hakim', 'Joko Susilo', 'Kartini Sari', 'Lukman Hidayat', 'Maya Puspita', 'Nur Aisyah', 'Oki Setiawan', 'Putri Ayu', 'Rudi Hartono', 'Sinta Maharani', 'Taufik Ismail', 'Umi Kalsum', 'Wahyu Nugroho', 'Yuni Astuti', 'Zainal Arifin', 'Arief Budiman'];
const GOL = ['II/c', 'II/d', 'III/a', 'III/b', 'III/c', 'III/d', 'IV/a', 'IV/b'];
const GAJI_GOL = { II: [3_200_000, 4_400_000], III: [4_100_000, 7_800_000], IV: [6_800_000, 11_500_000] };
const PTKP = ['TK/0', 'TK/1', 'K/0', 'K/1', 'K/2', 'K/3', 'TK/2', 'K/1'];

const OBJEK = [
  ['21-100-01', 'PPH21', 'Penghasilan pegawai tetap (bulanan, TER)', 0, 100, 'BPMP'],
  ['21-100-03', 'PPH21', 'Upah pegawai tidak tetap / tenaga kerja lepas', 0, 100, 'BP21'],
  ['21-100-07', 'PPH21', 'Imbalan kepada tenaga ahli / bukan pegawai', 5, 50, 'BP21'],
  ['21-100-08', 'PPH21', 'Honorarium narasumber/peserta kegiatan (bukan pegawai)', 5, 50, 'BP21'],
  ['21-402-01', 'PPH21', 'Honorarium ASN/pejabat yang dibebankan APBN/APBD (final)', 5, 100, 'BP21'],
  ['22-100-01', 'PPH22', 'Pembelian barang oleh bendahara pemerintah', 1.5, 100, 'BPPU'],
  ['24-104-01', 'PPH23', 'Imbalan jasa teknik', 2, 100, 'BPPU'],
  ['24-104-14', 'PPH23', 'Imbalan jasa lain (PMK 141/2015)', 2, 100, 'BPPU'],
  ['24-100-01', 'PPH23', 'Sewa dan penghasilan lain sehubungan dengan penggunaan harta', 2, 100, 'BPPU'],
  ['28-403-02', 'PPH4A2', 'Persewaan tanah dan/atau bangunan', 10, 100, 'BPPU'],
  ['28-409-07', 'PPH4A2', 'Jasa konstruksi - pekerjaan konstruksi kualifikasi kecil', 1.75, 100, 'BPPU'],
  ['28-409-08', 'PPH4A2', 'Jasa konstruksi - pekerjaan konstruksi kualifikasi menengah/besar', 2.65, 100, 'BPPU'],
  ['28-409-11', 'PPH4A2', 'Jasa konsultansi konstruksi dengan sertifikat', 3.5, 100, 'BPPU'],
];

async function writeSamples(pegawai, bankRows) {
  const dir = new URL('../../../samples/', import.meta.url).pathname;
  await mkdir(dir, { recursive: true });
  const save = async (name, header, rows) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(header).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));
    ws.columns.forEach((c) => { c.width = 22; });
    await wb.xlsx.writeFile(dir + name);
  };
  await save('contoh_daftar_gaji_oktober.xlsx', ['NIP', 'Nama Pegawai', 'NPWP', 'Golongan', 'Jabatan', 'Status PTKP', 'Gaji Pokok', 'Tunjangan Keluarga', 'Tunjangan Jabatan', 'Tunjangan Beras'],
    pegawai.map((p) => [p.nip, p.nama, p.npwp, p.golongan, p.jabatan, p.status_ptkp, p.gaji, Math.round(p.gaji * (p.status_ptkp.startsWith('K') ? 0.1 : 0)), between(5, 25) * 100_000, 289_680]));
  await save('contoh_honor_narasumber.xlsx', ['Tanggal', 'Nama', 'NIK', 'NPWP', 'Status', 'Golongan', 'Kegiatan', 'Jam', 'Tarif per Jam'],
    Array.from({ length: 18 }, (_, i) => {
      const asn = i % 3 !== 0;
      return [ymd(2026, 10, between(1, 15)), pick(NAMA), String(3300000000000000 + between(1e8, 9e8)), asn ? '' : `0${between(1e13, 9e13)}`, asn ? 'ASN' : 'Non ASN', asn ? pick(['III/a', 'III/c', 'IV/a', 'II/d']) : '', pick(['Bimtek Penatausahaan Keuangan', 'Sosialisasi Coretax', 'Rakor Pengelolaan Aset']), between(2, 6), pick([900_000, 1_000_000, 1_400_000, 1_700_000])];
    }));
  await save('contoh_transaksi_belanja.xlsx', ['Tanggal', 'No Bukti', 'Uraian', 'Kode Rekening', 'Nilai'],
    Array.from({ length: 25 }, (_, i) => {
      const rek = pick(REKENING.slice(2, 11));
      return [`${between(1, 16)}/10/2026`, `BKT-IMP-${String(i + 1).padStart(3, '0')}`, `${rek[1]} - kegiatan ${pick(['rutin', 'koordinasi', 'monitoring', 'pelaporan'])}`, rek[0], round(between(...(rek[3] || [1e6, 5e6])) / 3)];
    }));
  const csv = ['Tanggal;Keterangan;Debet;Kredit', ...bankRows.map((r) => `${r.tanggal.split('-').reverse().join('/')};${r.ket};${r.debet ? r.debet.toFixed(2).replace('.', ',') : ''};${r.kredit ? r.kredit.toFixed(2).replace('.', ',') : ''}`)].join('\n');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${dir}contoh_mutasi_bank_september.csv`, csv);
  console.log(`[seed] file contoh dibuat di ${dir}`);
}


/** PDF satu halaman sederhana (contoh lampiran nota) tanpa pustaka tambahan. */
function pdfNota(lines) {
  const esc = (t) => t.replace(/[()\\]/g, (m) => `\\${m}`);
  const isi = `BT /F1 13 Tf 60 770 Td 20 TL ${lines.map((l) => `(${esc(l)}) '`).join(' ')} ET`;
  const obj = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${isi.length} >>\nstream\n${isi}\nendstream`];
  let out = '%PDF-1.4\n'; const off = [];
  obj.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${obj.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${obj.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Data demo fitur lanjutan: riwayat SPP, tutup buku, panjar, transaksi ganda, lampiran. */
async function seedFiturLanjutan({ TAHUN, lastMonth, lastDay, skpdIds, userIds }) {
  const bendahara = ['bendahara', 'bendahara.disdik', 'bendahara.dinkes', 'bendahara.pupr'];
  const kurangiHari = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  for (const [si, skpd] of skpdIds.entries()) {
    const s = SKPD[si];
    const user = { id: userIds[bendahara[si]], full_name: s.bendahara_nama };
    // Riwayat SPP -> SPM -> SP2D untuk setiap SP2D yang sudah dibukukan
    const { rows: sp2d } = await pool.query(`SELECT no_bukti, MIN(tanggal) AS tanggal, MIN(jenis) FILTER (WHERE jenis LIKE 'SP2D%') AS jenis, MIN(uraian) FILTER (WHERE jenis LIKE 'SP2D%') AS uraian,
        SUM(penerimaan) AS nilai, MIN(kode_rekening) AS kode_rekening, array_agg(id ORDER BY no_urut) AS ids
      FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND no_bukti IN (SELECT no_bukti FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND jenis IN ('SP2D_UP','SP2D_GU','SP2D_LS'))
      GROUP BY no_bukti ORDER BY MIN(tanggal)`, [skpd, TAHUN]);
    const urut = {};
    const nomor = (jenis) => { urut[jenis] = (urut[jenis] || 0) + 1; return `${String(urut[jenis]).padStart(4, '0')}/SPP-${jenis.replace('_', '-')}/${s.kode.slice(0, 4)}/${TAHUN}`; };
    for (const r of sp2d) {
      const jenis = { SP2D_UP: 'UP', SP2D_GU: 'GU', SP2D_LS: 'LS_GAJI' }[r.jenis];
      const n = nomor(jenis);
      await pool.query(`INSERT INTO spp (skpd_id, tahun, jenis, nomor_spp, tanggal_spp, uraian, nilai, kode_rekening, status, nomor_spm, tanggal_spm, nomor_sp2d, tanggal_sp2d, bku_entry_ids, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sp2d',$9,$10,$11,$12,$13,$14)`,
      [skpd, TAHUN, jenis, n, kurangiHari(r.tanggal, 5), r.uraian.replace(/^Penerimaan SP2D /, ''), r.nilai, jenis === 'LS_GAJI' ? r.kode_rekening : null, n.replace('SPP', 'SPM'), kurangiHari(r.tanggal, 2), r.no_bukti, r.tanggal, r.ids, user.id]);
    }
    // Tutup buku berurutan (PUPR sengaja tertinggal untuk contoh laporan pimpinan)
    const sampai = Math.max(0, lastMonth - [3, 2, 3, 5][si]);
    for (let b = 1; b <= sampai; b++) {
      const akhir = new Date(Date.UTC(TAHUN, b, 0)).toISOString().slice(0, 10);
      const { rows: [r] } = await pool.query(`SELECT COALESCE(SUM(penerimaan) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = $3), 0)::float AS penerimaan,
          COALESCE(SUM(pengeluaran) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = $3), 0)::float AS pengeluaran,
          COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE tanggal <= $4), 0)::float AS saldo_akhir, COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = $3)::int AS transaksi
        FROM bku_entries WHERE skpd_id = $1 AND tahun = $2`, [skpd, TAHUN, b, akhir]);
      const { rows: [last] } = await pool.query('SELECT no_urut, hash FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND tanggal <= $3 ORDER BY no_urut DESC LIMIT 1', [skpd, TAHUN, akhir]);
      await pool.query(`INSERT INTO periode_kunci (skpd_id, tahun, bulan, ringkasan, catatan, dikunci_oleh, dikunci_at) VALUES ($1,$2,$3,$4,'SPJ fungsional telah disahkan',$5,$6)`,
        [skpd, TAHUN, b, { ...r, no_urut_terakhir: last?.no_urut || 0, hash_terakhir: last?.hash || null }, user.id, new Date(Date.UTC(TAHUN, b, 10, 2)).toISOString()]);
    }
  }

  // Contoh khusus BKAD (SKPD pertama): pengajuan yang sedang berjalan, panjar, transaksi ganda, lampiran
  const skpd = skpdIds[0]; const s = SKPD[0];
  const user = { id: userIds.bendahara, full_name: s.bendahara_nama };
  const tgl = (d) => ymd(TAHUN, lastMonth, Math.min(d, lastDay));
  const rekanan = (await pool.query('SELECT id FROM rekanan ORDER BY id')).rows.map((r) => r.id);
  const kode4 = s.kode.slice(0, 4);
  const proses = [
    ['LS_BARANG', 'spp', 'Pembayaran jasa konsultansi penyusunan kajian optimalisasi aset daerah termin I', 87_500_000, '5.1.02.02.01.0055', rekanan[1], null],
    ['TU', 'spm', 'Tambahan uang untuk kegiatan rekonsiliasi aset se-kabupaten', 75_000_000, null, null, null],
    ['LS_BARANG', 'ditolak', 'Pengadaan personal computer untuk bidang anggaran', 142_000_000, '5.2.02.10.01.0002', rekanan[4], 'Dokumen kontrak dan BAST belum dilampirkan'],
  ];
  for (const [i, [jenis, status, uraian, nilai, kode, rk, catatan]] of proses.entries()) {
    const { rows: [n] } = await pool.query('SELECT COUNT(*)::int + 1 AS n FROM spp WHERE skpd_id = $1 AND tahun = $2 AND jenis = $3', [skpd, TAHUN, jenis]);
    const nomor = `${String(n.n).padStart(4, '0')}/SPP-${jenis.replace('_', '-')}/${kode4}/${TAHUN}`;
    await pool.query(`INSERT INTO spp (skpd_id, tahun, jenis, nomor_spp, tanggal_spp, uraian, nilai, kode_rekening, rekanan_id, status, nomor_spm, tanggal_spm, catatan, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [skpd, TAHUN, jenis, nomor, tgl(14 + i * 3), uraian, nilai, kode, rk, status, status === 'spm' ? nomor.replace('SPP', 'SPM') : null, status === 'spm' ? tgl(20) : null, catatan, user.id]);
  }

  const peg = (await pool.query('SELECT id, nama FROM pegawai WHERE skpd_id = $1 ORDER BY id LIMIT 3', [skpd])).rows;
  const panjar = [
    [peg[0], tgl(2), 'Rapat koordinasi penyusunan laporan keuangan di kecamatan', '5.1.02.01.01.0052', 6_500_000, tgl(16), 'tunai'],
    [peg[1], tgl(lastDay - 6), 'Bimbingan teknis aplikasi BKU bagi bendahara pembantu', '5.1.02.02.01.0003', 4_000_000, null, 'tunai'],
    [peg[2], tgl(5), 'Perjalanan dinas pendampingan inventarisasi aset', '5.1.02.04.01.0001', 8_000_000, null, 'bank'],
  ];
  for (const [i, [p, tanggal, kegiatan, kode, nilai, batas, metode]] of panjar.entries()) {
    const bt = batas || new Date(Date.UTC(TAHUN, lastMonth - 1, Number(tanggal.slice(8)) + 14)).toISOString().slice(0, 10);
    const { rows: [r] } = await pool.query(`INSERT INTO panjar (skpd_id, tahun, nomor, tanggal, pegawai_id, penerima_nama, kegiatan, kode_rekening, nilai, metode, batas_tanggal, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [skpd, TAHUN, `PJR-${String(i + 1).padStart(3, '0')}/${TAHUN}`, tanggal, p.id, p.nama, kegiatan, kode, nilai, metode, bt, user.id]);
    if (i === 2) { // sudah dipertanggungjawabkan
      const realisasi = 7_350_000;
      await tx(async (c) => {
        const { entry } = await catatTransaksi(c, user, skpd, { tanggal: tgl(12), jenis: 'BELANJA', no_bukti: `PJR-003/${TAHUN}`, kode_rekening: kode, metode,
          uraian: `Pertanggungjawaban panjar PJR-003/${TAHUN}: ${kegiatan} (${p.nama})`, pengeluaran: realisasi });
        await c.query(`UPDATE panjar SET status = 'selesai', tanggal_selesai = $2, realisasi = $3, sisa_kembali = $4, bku_entry_ids = $5 WHERE id = $1`, [r.id, tgl(12), realisasi, nilai - realisasi, [entry.id]]);
      });
    }
  }

  // Transaksi ganda yang disengaja: tagihan yang sama tercatat dua kali
  const { rows: [asli] } = await pool.query(`SELECT * FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND jenis = 'BELANJA' AND rekanan_id IS NOT NULL AND EXTRACT(MONTH FROM tanggal) = $3 ORDER BY pengeluaran DESC LIMIT 1`, [skpd, TAHUN, lastMonth]);
  if (asli) {
    const rek = REKENING.find((r) => r[0] === asli.kode_rekening);
    const p = rek?.[2] && rek[2] !== 'honor' ? potonganBelanja({ nilai: Number(asli.pengeluaran), termasukPPN: true, jenis: rek[2] }).potongan : [];
    await tx((c) => catatTransaksi(c, user, skpd, { tanggal: asli.tanggal, jenis: 'BELANJA', no_bukti: `${asli.no_bukti}A`, kode_rekening: asli.kode_rekening, rekanan_id: asli.rekanan_id,
      uraian: asli.uraian, pengeluaran: Number(asli.pengeluaran), metode: asli.metode, pajak: p }));
  }

  // Lampiran contoh (nota PDF) pada beberapa belanja bulan berjalan
  const { rows: bel } = await pool.query(`SELECT e.id, e.no_bukti, e.tanggal, e.uraian, e.pengeluaran, rk.nama AS rekanan FROM bku_entries e LEFT JOIN rekanan rk ON rk.id = e.rekanan_id
    WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.jenis = 'BELANJA' AND EXTRACT(MONTH FROM e.tanggal) = $3 ORDER BY e.no_urut LIMIT 4`, [skpd, TAHUN, lastMonth]);
  for (const e of bel) {
    const buf = pdfNota(['NOTA / KUITANSI PEMBAYARAN', '', `No. bukti : ${e.no_bukti}`, `Tanggal   : ${e.tanggal}`, `Penerima  : ${e.rekanan || 'Pelaksana kegiatan'}`,
      `Uraian    : ${e.uraian.slice(0, 60)}`, `Jumlah    : Rp ${Number(e.pengeluaran).toLocaleString('id-ID')}`, '', 'Lunas dibayar,', '', '', '(tanda tangan & stempel)']);
    await pool.query(`INSERT INTO lampiran (bku_entry_id, skpd_id, nama_file, mime, ukuran, sha256, data, uploaded_by) VALUES ($1,$2,$3,'application/pdf',$4,encode(sha256($5),'hex'),$5,$6)`,
      [e.id, skpd, `nota-${e.no_bukti}.pdf`, buf.length, buf, user.id]);
  }
}

const hariKerjaBerikut = (d) => { const x = new Date(`${d}T00:00:00Z`); do x.setUTCDate(x.getUTCDate() + 1); while (x.getUTCDay() === 0 || x.getUTCDay() === 6); return x.toISOString().slice(0, 10); };
const akhirPekan = (d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

/** Tahap 4 (BKAD): BKU penerimaan & STS, bendahara pembantu dengan SPJ. Dijalankan sebelum tutup buku. */
async function seedTahap4({ TAHUN, lastMonth, lastDay, skpdIds, userIds, rekananIds }) {
  const skpd = skpdIds[0]; const s = SKPD[0];
  const today = ymd(TAHUN, lastMonth, lastDay);
  // ---- Bendahara penerimaan ----
  const penerima = { id: userIds.penerimaan, full_name: 'Nur Aisyah, S.E.' };
  const rekBkad = PENDAPATAN.slice(0, 4);
  const PENYETOR = ['PT Graha Niaga Lestari', 'Koperasi Pegawai Pemda', 'CV Mitra Usaha Bersama', 'Yayasan Pendidikan Harapan', 'PT Sumber Rejeki Abadi', 'Bank Daerah Cabang Utama'];
  const realPer = {};
  let noTbp = 0;
  for (let m = 1; m <= lastMonth; m++) {
    const maxDay = m === lastMonth ? lastDay : new Date(TAHUN, m, 0).getDate();
    const n = between(3, 6);
    const hari = Array.from({ length: n }, () => between(2, maxDay)).sort((a, b) => a - b);
    const items = [];
    for (const d of hari) {
      let tanggal = ymd(TAHUN, m, d);
      if (akhirPekan(tanggal)) tanggal = hariKerjaBerikut(tanggal);
      if (Number(tanggal.slice(5, 7)) !== m) tanggal = ymd(TAHUN, m, d - (new Date(Date.UTC(TAHUN, m - 1, d)).getUTCDay() === 0 ? 2 : 1));
      if (tanggal > today) continue;
      const [kode, nama, rentang] = rekBkad[rnd() < 0.45 ? 0 : rnd() < 0.55 ? 1 : rnd() < 0.5 ? 3 : 2];
      const nilai = round(between(...rentang), 5_000);
      noTbp++;
      const penyetor = pick(PENYETOR);
      await tx(async (c) => {
        const e = await catatPenerimaan(c, penerima, skpd, { tanggal, kode_rekening: kode, nilai, metode: rnd() < 0.7 ? 'bank' : 'tunai', no_bukti: `TBP-${String(noTbp).padStart(4, '0')}/${TAHUN}`,
          penyetor, uraian: `${nama} - ${penyetor}` });
        items.push(e);
      });
      realPer[kode] = (realPer[kode] || 0) + nilai;
    }
    // STS pada hari kerja berikutnya; penerimaan terbaru (belum lewat batas setor) dibiarkan belum disetor
    const batas = batasSetor(today);
    for (const e of items) {
      const tanggal = hariKerjaBerikut(e.tanggal);
      if (tanggal > today || (m === lastMonth && e.tanggal >= batas)) continue;
      await tx((c) => buatSts(c, penerima, skpd, { tanggal, entry_ids: [e.id], no_bukti_bank: `TRX${between(1e8, 9e8)}` }));
    }
  }
  // Satu penerimaan lama yang terlambat disetor (lebih dari 1 hari kerja) agar tampil di peringatan
  const lateDay = Math.max(2, lastDay - 8);
  let late = ymd(TAHUN, lastMonth, lateDay);
  if (akhirPekan(late)) late = hariKerjaBerikut(late);
  await tx((c) => catatPenerimaan(c, penerima, skpd, { tanggal: late, kode_rekening: rekBkad[0][0], nilai: 7_250_000, metode: 'tunai', no_bukti: `TBP-${String(++noTbp).padStart(4, '0')}/${TAHUN}`,
    penyetor: 'CV Mitra Usaha Bersama', uraian: 'Retribusi Penyewaan Tanah dan Bangunan - kios pasar blok C (triwulan IV)' }));
  realPer[rekBkad[0][0]] = (realPer[rekBkad[0][0]] || 0) + 7_250_000;
  if (!akhirPekan(today)) await tx((c) => catatPenerimaan(c, penerima, skpd, { tanggal: today, kode_rekening: rekBkad[1][0], nilai: 2_400_000, metode: 'tunai', no_bukti: `TBP-${String(++noTbp).padStart(4, '0')}/${TAHUN}`,
    penyetor: 'Yayasan Pendidikan Harapan', uraian: 'Retribusi Pemakaian Ruangan/Gedung Pertemuan - aula lantai 3' }));
  for (const [kode, total] of Object.entries(realPer)) {
    await pool.query('INSERT INTO target_pendapatan (skpd_id, tahun, kode_rekening, target) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [skpd, TAHUN, kode, round((total / lastMonth) * 12 * (0.95 + rnd() * 0.3), 1_000_000)]);
  }
  // Target pendapatan SKPD lain (realisasi dicatat oleh bendahara penerimaan masing-masing)
  await pool.query('INSERT INTO target_pendapatan (skpd_id, tahun, kode_rekening, target) VALUES ($1,$2,$3,$4),($5,$2,$6,$7) ON CONFLICT DO NOTHING',
    [skpdIds[2], TAHUN, PENDAPATAN[4][0], 450_000_000, skpdIds[3], PENDAPATAN[5][0], 1_250_000_000]);

  // ---- Bendahara pengeluaran pembantu ----
  const induk = { id: userIds.bendahara, full_name: s.bendahara_nama, role: 'bendahara', skpd_id: skpd };
  const pembantu = { id: userIds.pembantu, full_name: 'Gilang Ramadhan, S.E.' };
  const unit = (await pool.query(`INSERT INTO unit_kerja (skpd_id, kode, nama, bendahara_nama, bendahara_nip) VALUES
    ($1,'UPT-PAD','UPT Pelayanan Pendapatan Daerah Wilayah I','Gilang Ramadhan, S.E.','199103182015031004'),
    ($1,'BID-ANG','Bidang Anggaran','Maya Puspita, A.Md.','199306052019022003'),
    ($1,'BID-AST','Bidang Pengelolaan Aset','Oki Setiawan, S.E.','198910112014031002') RETURNING *`, [skpd])).rows;
  await pool.query('UPDATE users SET unit_id = $1 WHERE id = $2', [unit[0].id, userIds.pembantu]);
  const m1 = Math.max(1, lastMonth - 1); const m2 = lastMonth;
  const t = (m, d) => ymd(TAHUN, m, Math.min(d, m === lastMonth ? lastDay : 28));
  const belanja = (u, user, m, d, i, kode, uraian, nilai, jenis, rekanan) => tx((c) => belanjaPembantu(c, user, u, {
    tanggal: t(m, d), no_bukti: `BPP-${u.kode}-${String(m).padStart(2, '0')}${String(i).padStart(2, '0')}`, kode_rekening: kode, uraian, nilai, rekanan_id: rekanan || null,
    metode: nilai > 2_000_000 ? 'bank' : 'tunai', pajak: jenis ? potonganBelanja({ nilai, termasukPPN: true, jenis }).potongan : [] }));
  // UPT: bulan lalu dipertanggungjawabkan dan disahkan; bulan ini SPJ diajukan dan satu belanja belum di-SPJ-kan
  await tx((c) => limpahUp(c, induk, unit[0], { tanggal: t(m1, 2), nilai: 60_000_000 }));
  await belanja(unit[0], pembantu, m1, 4, 1, '5.1.02.01.01.0024', 'Belanja ATK pelayanan wajib pajak', 4_850_000, 'barang', rekananIds[3]);
  await belanja(unit[0], pembantu, m1, 9, 2, '5.1.02.01.01.0026', 'Cetak blanko SPPT dan formulir pendaftaran', 8_200_000, 'barang', rekananIds[6]);
  await belanja(unit[0], pembantu, m1, 15, 3, '5.1.02.01.01.0052', 'Makan minum sosialisasi pajak daerah di kecamatan', 3_600_000, 'jasa', rekananIds[5]);
  await belanja(unit[0], pembantu, m1, 18, 4, '5.1.02.04.01.0001', 'Perjalanan dinas pendataan objek pajak ke 4 kecamatan', 2_750_000, null);
  await belanja(unit[0], pembantu, m1, 23, 5, '5.1.02.03.02.0035', 'Servis kendaraan operasional penagihan', 2_400_000, 'jasa', rekananIds[7]);
  await tx((c) => ajukanSpj(c, pembantu, unit[0], { tanggal: t(m1, 28), sampai: t(m1, 28) }));
  const { rows: [spj1] } = await pool.query('SELECT id FROM spj_pembantu WHERE unit_id = $1 ORDER BY id DESC LIMIT 1', [unit[0].id]);
  await tx(async (c) => {
    const r = await sahkanSpj(c, induk, spj1.id, { tanggal: t(m2, 2), catatan: 'Bukti lengkap dan sesuai DPA' });
    const { rows } = await c.query("SELECT id FROM pajak WHERE bku_entry_id = ANY($1) AND status = 'dipungut'", [r.bku_entry_ids]);
    if (rows.length && t(m2, 10) <= today) await setorPajak(c, induk, rows.map((x) => x.id), { ntpn: ntpn(), id_billing: `0${between(1e13, 9e13)}`, tanggal_setor: t(m2, 10) });
  });
  await belanja(unit[0], pembantu, m2, 6, 1, '5.1.02.01.01.0052', 'Makan minum rapat evaluasi target PAD triwulan III', 2_850_000, 'jasa', rekananIds[5]);
  await belanja(unit[0], pembantu, m2, 9, 2, '5.1.02.01.01.0024', 'Belanja tinta dan kertas printer loket pelayanan', 3_150_000, 'barang', rekananIds[3]);
  await belanja(unit[0], pembantu, m2, 14, 3, '5.1.02.04.01.0001', 'Perjalanan dinas penagihan tunggakan retribusi', 1_850_000, null);
  await tx((c) => ajukanSpj(c, pembantu, unit[0], { tanggal: t(m2, 16), sampai: t(m2, 16) }));
  await belanja(unit[0], pembantu, m2, 21, 4, '5.1.02.03.02.0035', 'Penggantian ban kendaraan roda dua penagih', 1_600_000, null);
  // Bidang Anggaran: pelimpahan berjalan
  await tx((c) => limpahUp(c, induk, unit[1], { tanggal: t(m2, 5), nilai: 20_000_000 }));
  await belanja(unit[1], induk, m2, 12, 1, '5.1.02.01.01.0052', 'Makan minum rapat pembahasan KUA-PPAS', 4_400_000, 'jasa', rekananIds[5]);
  await belanja(unit[1], induk, m2, 19, 2, '5.1.02.01.01.0026', 'Penggandaan dokumen rancangan APBD', 5_750_000, 'barang', rekananIds[6]);
  console.log(`[seed] Tahap 4: ${noTbp} penerimaan, ${unit.length} unit kerja`);
}

/** TA sebelumnya untuk Dinas Kesehatan: Januari-November sudah ditutup buku, Desember siap tutup tahun. */
async function seedTahunLalu({ skpdIds, userIds, rekananIds }) {
  const T = 2025; const si = 2; const skpd = skpdIds[si]; const s = SKPD[si];
  const user = { id: userIds['bendahara.dinkes'], full_name: s.bendahara_nama };
  const gaji = round(between(48, 56) * 1_000_000, 100);
  const UP = 350_000_000;
  const perRek = {};
  await tx((c) => insertEntries(c, user, skpd, [{ tanggal: ymd(T, 1, 2), no_bukti: `SP2D-UP-001/${s.kode.slice(0, 4)}`, jenis: 'SP2D_UP', kode_rekening: '0.0.00.00.00.0001', uraian: `Penerimaan SP2D Uang Persediaan (UP) TA ${T}`, penerimaan: UP }]));
  let spj = 0; let gu = 0; let nb = 0;
  for (let m = 1; m <= 12; m++) {
    const maxDay = new Date(T, m, 0).getDate();
    await tx((c) => insertEntries(c, user, skpd, [
      { tanggal: ymd(T, m, 1), no_bukti: `SP2D-LS-GAJI-${String(m).padStart(2, '0')}/${T}`, jenis: 'SP2D_LS', kode_rekening: '5.1.01.01.01.0001', uraian: `Penerimaan SP2D LS Gaji dan Tunjangan PNS bulan ${m}/${T}`, penerimaan: gaji },
      { tanggal: ymd(T, m, 1), no_bukti: `SP2D-LS-GAJI-${String(m).padStart(2, '0')}/${T}`, jenis: 'BELANJA', kode_rekening: '5.1.01.01.01.0001', uraian: `Pembayaran Gaji dan Tunjangan PNS bulan ${m}/${T}`, pengeluaran: gaji },
    ]));
    perRek['5.1.01.01.01.0001'] = (perRek['5.1.01.01.01.0001'] || 0) + gaji;
    if (m > 1) {
      await tx(async (c) => {
        const { rows } = await c.query("SELECT id FROM pajak WHERE skpd_id = $1 AND tahun = $2 AND masa = $3 AND status = 'dipungut'", [skpd, T, m - 1]);
        if (rows.length) {
          const r = await setorPajak(c, user, rows.map((x) => x.id), { ntpn: ntpn(), id_billing: `0${between(1e13, 9e13)}`, tanggal_setor: ymd(T, m, 10) });
          await c.query("UPDATE pajak SET status = 'dilaporkan', no_bukti_potong = 'BP-' || id WHERE id = ANY($1)", [r.rows.map((x) => x.id)]);
        }
      });
    }
    const days = Array.from({ length: m === 12 ? 4 : between(5, 8) }, () => between(2, m === 12 ? 20 : maxDay - 1)).sort((a, b) => a - b);
    for (const d of days) {
      const rek = pick(REKENING.slice(2, 11));
      const nilai = round(between(...rek[3]) * 0.7);
      nb++;
      const b = { tanggal: ymd(T, m, d), no_bukti: `BKT-${String(m).padStart(2, '0')}-${String(nb).padStart(4, '0')}/${T}`, jenis: 'BELANJA', kode_rekening: rek[0], uraian: `${rek[1]} - kegiatan bulan ${m}`,
        pengeluaran: nilai, metode: 'bank', rekanan_id: rek[2] && rek[2] !== 'honor' ? pick(rekananIds) : null };
      if (rek[2] && rek[2] !== 'honor') b.pajak = potonganBelanja({ nilai, termasukPPN: true, jenis: rek[2] }).potongan;
      await tx((c) => catatTransaksi(c, user, skpd, b));
      perRek[rek[0]] = (perRek[rek[0]] || 0) + nilai;
      spj += nilai;
      if (spj > UP * 0.6 && m < 12) {
        gu++;
        await tx((c) => insertEntries(c, user, skpd, [{ tanggal: ymd(T, m, Math.min(maxDay, d + 2)), no_bukti: `SP2D-GU-${String(gu).padStart(3, '0')}/${T}`, jenis: 'SP2D_GU', kode_rekening: '0.0.00.00.00.0001', uraian: `Penerimaan SP2D Ganti Uang (GU) ke-${gu}`, penerimaan: spj }]));
        spj = 0;
      }
    }
    if (m < 12) {
      const end = ymd(T, m, maxDay);
      const { rows: [r] } = await pool.query(`SELECT COALESCE(SUM(penerimaan - pengeluaran),0) AS saldo, COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode='bank'),0) AS bank,
        COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode='tunai'),0) AS tunai FROM bku_entries WHERE skpd_id = $1 AND tahun = $2 AND tanggal <= $3`, [skpd, T, end]);
      await pool.query('INSERT INTO penutupan_kas (skpd_id, tanggal, saldo_bku, saldo_bank, kas_tunai, selisih, keterangan, created_by) VALUES ($1,$2,$3,$4,$5,0,$6,$7)', [skpd, end, r.saldo, r.bank, r.tunai, 'Penutupan kas akhir bulan', user.id]);
    }
  }
  for (const [kode, total] of Object.entries(perRek)) await pool.query('INSERT INTO anggaran (skpd_id, tahun, kode_rekening, pagu) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [skpd, T, kode, round(total * (1.04 + rnd() * 0.12), 1_000_000)]);
  await pool.query(`INSERT INTO bku_verifications (entry_id, status, verified_by) SELECT id, 'diverifikasi', $3 FROM bku_entries WHERE skpd_id = $1 AND tahun = $2`, [skpd, T, userIds.verifikator]);
  for (let b = 1; b <= 11; b++) {
    const akhir = ymd(T, b, new Date(T, b, 0).getDate());
    const { rows: [r] } = await pool.query(`SELECT COALESCE(SUM(penerimaan) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = $3), 0)::float AS penerimaan,
        COALESCE(SUM(pengeluaran) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = $3), 0)::float AS pengeluaran,
        COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE tanggal <= $4), 0)::float AS saldo_akhir, COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM tanggal) = $3)::int AS transaksi
      FROM bku_entries WHERE skpd_id = $1 AND tahun = $2`, [skpd, T, b, akhir]);
    await pool.query(`INSERT INTO periode_kunci (skpd_id, tahun, bulan, ringkasan, catatan, dikunci_oleh, dikunci_at) VALUES ($1,$2,$3,$4,'SPJ fungsional telah disahkan',$5,$6)`,
      [skpd, T, b, r, user.id, new Date(Date.UTC(T, b, 10, 2)).toISOString()]);
  }
  console.log(`[seed] ${s.nama} TA ${T}: siap tutup tahun`);
}

async function seedTahap5({ TAHUN, lastMonth, lastDay, skpdIds, userIds }) {
  const verif = userIds.verifikator; const pimp = userIds.pimpinan;
  const jam = (tgl, h) => new Date(`${tgl}T${String(h).padStart(2, '0')}:15:00+07:00`).toISOString();
  const tambahHari = (tgl, n) => { const d = new Date(`${tgl}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const tahap = async (objek, id, skpd, tahun, putaran, urutan, peran, label, status, oleh, waktu, catatan = null) => pool.query(
    `INSERT INTO persetujuan (objek, objek_id, skpd_id, tahun, putaran, urutan, peran, label, status, oleh, waktu, catatan, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($11, now()))`, [objek, String(id), skpd, tahun, putaran, urutan, peran, label, status, oleh, waktu, catatan]);
  const SPP = [['verifikator', 'Verifikasi PPK-SKPD'], ['pimpinan', 'Persetujuan PA/KPA']];
  const SPJ = [['verifikator', 'Verifikasi PPK-SKPD'], ['pimpinan', 'Pengesahan PA/KPA']];
  const alur = async (objek, id, skpd, tahun, tgl, status, catatan) => {
    const L = objek === 'spp' ? SPP : SPJ;
    // status: setuju (semua), tahap2 (verifikator setuju, pimpinan menunggu), menunggu (tahap 1), tolak (ditolak tahap 1)
    if (status === 'setuju') { await tahap(objek, id, skpd, tahun, 1, 1, ...L[0], 'setuju', verif, jam(tgl, 9)); await tahap(objek, id, skpd, tahun, 1, 2, ...L[1], 'setuju', pimp, jam(tambahHari(tgl, 1), 10)); }
    if (status === 'tahap2') { await tahap(objek, id, skpd, tahun, 1, 1, ...L[0], 'setuju', verif, jam(tgl, 9), 'Dokumen lengkap'); await tahap(objek, id, skpd, tahun, 1, 2, ...L[1], 'menunggu', null, null); }
    if (status === 'menunggu') { await tahap(objek, id, skpd, tahun, 1, 1, ...L[0], 'menunggu', null, null); await tahap(objek, id, skpd, tahun, 1, 2, ...L[1], 'antre', null, null); }
    if (status === 'tolak') { await tahap(objek, id, skpd, tahun, 1, 1, ...L[0], 'tolak', verif, jam(tgl, 11), catatan); await tahap(objek, id, skpd, tahun, 1, 2, ...L[1], 'batal', null, null); }
  };

  // ---- Persetujuan SPJ fungsional untuk bulan yang sudah ditutup buku ----
  const { rows: kunci } = await pool.query('SELECT skpd_id, tahun, bulan, dikunci_at::date::text AS tgl FROM periode_kunci ORDER BY 1, 2, 3');
  for (const k of kunci) await alur('spj', `${k.skpd_id}/${k.tahun}/${k.bulan}`, k.skpd_id, k.tahun, tambahHari(k.tgl, -3), 'setuju');
  // BKAD: SPJ Agustus sudah diverifikasi, menunggu pengesahan PA/KPA
  const bkad = skpdIds[0];
  const { rows: [kb] } = await pool.query('SELECT COALESCE(MAX(bulan),0)::int AS b FROM periode_kunci WHERE skpd_id = $1 AND tahun = $2', [bkad, TAHUN]);
  if (kb.b + 1 < lastMonth) await alur('spj', `${bkad}/${TAHUN}/${kb.b + 1}`, bkad, TAHUN, ymd(TAHUN, kb.b + 2, 5), 'tahap2');

  // ---- Persetujuan SPP ----
  const { rows: spp } = await pool.query('SELECT id, skpd_id, tahun, status, tanggal_spp::text AS tgl, catatan FROM spp ORDER BY id');
  for (const r of spp) {
    const st = { sp2d: 'setuju', spm: 'setuju', spp: 'menunggu', ditolak: 'tolak' }[r.status];
    if (st) await alur('spp', r.id, r.skpd_id, r.tahun, tambahHari(r.tgl, 1), st, r.catatan);
  }
  // Satu SPP LS yang sudah lolos verifikasi dan menunggu persetujuan PA/KPA
  const rek = (await pool.query('SELECT id FROM rekanan ORDER BY id')).rows.map((r) => r.id);
  const { rows: [n] } = await pool.query("SELECT COUNT(*)::int + 1 AS n FROM spp WHERE skpd_id = $1 AND tahun = $2 AND jenis = 'LS_BARANG'", [bkad, TAHUN]);
  const tglSpp = ymd(TAHUN, lastMonth, Math.max(1, lastDay - 4));
  const { rows: [baru] } = await pool.query(`INSERT INTO spp (skpd_id, tahun, jenis, nomor_spp, tanggal_spp, uraian, nilai, kode_rekening, rekanan_id, status, created_by)
    VALUES ($1,$2,'LS_BARANG',$3,$4,$5,$6,$7,$8,'spp',$9) RETURNING id`,
  [bkad, TAHUN, `${String(n.n).padStart(4, '0')}/SPP-LS-BARANG/${SKPD[0].kode.slice(0, 4)}/${TAHUN}`, tglSpp, 'Pembayaran pemeliharaan kendaraan dinas operasional triwulan IV', 48_600_000, '5.1.02.03.02.0035', rek[7] || rek[0], userIds.bendahara]);
  await alur('spp', baru.id, bkad, TAHUN, tambahHari(tglSpp, 1), 'tahap2');

  // ---- Anggaran kas (rencana penarikan dana) seluruh SKPD tahun berjalan ----
  for (const skpd of skpdIds) {
    const { rows } = await pool.query('SELECT kode_rekening, pagu::float AS pagu FROM anggaran WHERE skpd_id = $1 AND tahun = $2', [skpd, TAHUN]);
    for (const r of rows) {
      const nilai = bagiPola(r.pagu, r.kode_rekening.startsWith('5.1.01') ? POLA.rata : POLA.triwulan);
      await pool.query(`INSERT INTO anggaran_kas (skpd_id, tahun, kode_rekening, bulan, nilai) SELECT $1, $2, $3, b, v FROM unnest($4::numeric[]) WITH ORDINALITY AS t(v, b)`, [skpd, TAHUN, r.kode_rekening, nilai]);
    }
  }

  // ---- Pergeseran anggaran (ditetapkan) dan rancangan APBD Perubahan (draf) di BKAD ----
  const { rows: ang } = await pool.query(`SELECT a.kode_rekening, a.pagu::float AS pagu, COALESCE((SELECT SUM(pengeluaran - penerimaan) FROM bku_entries e
      WHERE e.skpd_id = a.skpd_id AND e.tahun = a.tahun AND e.kode_rekening = a.kode_rekening AND e.jenis IN ('BELANJA','SP2D_LS','KOREKSI')), 0)::float AS real
    FROM anggaran a WHERE a.skpd_id = $1 AND a.tahun = $2 AND a.kode_rekening LIKE '5.1.02%' ORDER BY a.pagu - COALESCE((SELECT SUM(pengeluaran - penerimaan) FROM bku_entries e
      WHERE e.skpd_id = a.skpd_id AND e.tahun = a.tahun AND e.kode_rekening = a.kode_rekening AND e.jenis IN ('BELANJA','SP2D_LS','KOREKSI')), 0) DESC`, [bkad, TAHUN]);
  if (ang.length >= 3) {
    const [longgar, , ketat] = [ang[0], null, ang[ang.length - 1]];
    const kurang = Math.ceil(Math.max(0, ketat.real - ketat.pagu) / 1_000_000) * 1_000_000;
    const geser = Math.min(kurang + 25_000_000, Math.floor((longgar.pagu - longgar.real) / 2_000_000) * 1_000_000);
    const admin = { id: userIds.admin, full_name: 'Administrator BKAD' };
    await tx(async (c) => {
      const rincian = [
        { kode_rekening: longgar.kode_rekening, pagu_baru: longgar.pagu - geser, alasan: 'Efisiensi kegiatan' },
        { kode_rekening: ketat.kode_rekening, pagu_baru: ketat.pagu + geser, alasan: 'Kebutuhan triwulan IV' },
      ];
      const { rows: [p] } = await c.query(`INSERT INTO perubahan_anggaran (skpd_id, tahun, nomor, jenis, tanggal, dasar, uraian, rincian, created_by)
        VALUES ($1,$2,$3,'pergeseran',$4,$5,$6,$7,$8) RETURNING id`, [bkad, TAHUN, `001/PGS/${TAHUN}`, ymd(TAHUN, 7, 15),
        'Peraturan Kepala Daerah tentang Perubahan Penjabaran APBD', 'Pergeseran antar-objek belanja barang dan jasa', JSON.stringify(rincian), admin.id]);
      await tetapkanPerubahan(c, admin, p.id);
      await c.query('UPDATE perubahan_anggaran SET ditetapkan_at = $2 WHERE id = $1', [p.id, jam(ymd(TAHUN, 7, 16), 10)]);
      const { rows: [g] } = await c.query("SELECT pagu::float AS pagu FROM anggaran WHERE skpd_id = $1 AND tahun = $2 AND kode_rekening = '5.1.01.01.01.0001'", [bkad, TAHUN]);
      if (g) {
        await c.query(`INSERT INTO perubahan_anggaran (skpd_id, tahun, nomor, jenis, tanggal, dasar, uraian, rincian, created_by) VALUES ($1,$2,$3,'perubahan',$4,$5,$6,$7,$8)`,
          [bkad, TAHUN, `001/APBD-P/${TAHUN}`, ymd(TAHUN, lastMonth, Math.max(1, lastDay - 2)), 'Rancangan Perda APBD Perubahan', 'Penyesuaian gaji dan tunjangan pasca kenaikan gaji pokok',
            JSON.stringify([{ kode_rekening: '5.1.01.01.01.0001', pagu_lama: g.pagu, pagu_baru: g.pagu + 60_000_000, alasan: 'Kenaikan gaji pokok PNS' }]), admin.id]);
      }
    });
  }

  // ---- Kontak pengingat & rekening bendahara ----
  const kontak = { admin: ['admin.bkad@contoh.go.id', null], bendahara: ['siti.rahmawati@contoh.go.id', '081234567801'], verifikator: ['yusuf.maulana@contoh.go.id', '081234567802'],
    pimpinan: [null, '081234567803'], 'bendahara.disdik': ['rina.kartika@contoh.go.id', '081234567804'], 'bendahara.dinkes': [null, '081234567805'],
    'bendahara.pupr': ['dewi.lestari@contoh.go.id', null], penerimaan: ['nur.aisyah@contoh.go.id', '081234567806'], pembantu: [null, '081234567807'] };
  for (const [u, [email, wa]] of Object.entries(kontak)) await pool.query('UPDATE users SET email = $2, no_wa = $3 WHERE id = $1', [userIds[u], email, wa]);
  for (const [i, skpd] of skpdIds.entries()) {
    await pool.query('UPDATE skpd SET rekening_bendahara = $2, bank_bendahara = $3 WHERE id = $1', [skpd, `100200${String(3000001 + i * 1111)}`, 'Bank Daerah']);
  }

  // ---- Contoh berkas transfer massal yang sudah selesai (awal bulan berjalan) ----
  const kandidat = (await kandidatTransfer(bkad, TAHUN, { dari: ymd(TAHUN, lastMonth, 1), sampai: ymd(TAHUN, lastMonth, Math.min(10, lastDay)) })).filter((k) => !k.masalah.length && k.nilai > 0);
  if (kandidat.length >= 2) {
    const pilih = kandidat.slice(0, 5);
    const total = pilih.reduce((t, k) => t + k.nilai, 0);
    const tgl = pilih.map((k) => k.tanggal).sort().pop();
    const { rows: [b] } = await pool.query(`INSERT INTO transfer_batch (skpd_id, tahun, nomor, tanggal, format, rekening_sumber, total, jumlah, status, created_by, created_at, diunduh_at)
      VALUES ($1,$2,$3,$4,'mandiri_mcm',$5,$6,$7,'selesai',$8,$9,$9) RETURNING id`,
    [bkad, TAHUN, `TRF-001/${SKPD[0].kode.slice(0, 4)}/${TAHUN}`, tgl, '1002003000001', total, pilih.length, userIds.bendahara, jam(tgl, 14)]);
    for (const [i, k] of pilih.entries()) {
      await pool.query(`INSERT INTO transfer_item (batch_id, bku_entry_id, rekanan_id, nama, bank, kode_bank, no_rekening, bruto, potongan, nilai, berita, status, keterangan)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [b.id, k.id, k.rekanan_id, k.nama, k.bank, k.kode_bank, String(k.no_rekening).replace(/[\s.-]/g, ''),
        k.bruto, k.potongan, k.nilai, `${k.no_bukti} ${k.uraian}`.slice(0, 120), i === 1 ? 'gagal' : 'berhasil', i === 1 ? 'Nama penerima tidak sesuai rekening' : null]);
    }
  }
  console.log('[seed] Tahap 5: anggaran kas, persetujuan berjenjang, kontak pengingat, transfer massal');
}

async function main() {
  await migrate();
  const today = new Date();
  const TAHUN = 2026;
  const lastMonth = today.getFullYear() === TAHUN ? today.getMonth() + 1 : 12;
  const lastDay = today.getFullYear() === TAHUN ? today.getDate() : 31;

  await pool.query(`TRUNCATE bku_verifications, pajak, bku_chain_head, daily_summary, outbox, penutupan_kas, dataset_rows, datasets, pipelines, anggaran, pegawai,
    periode_kunci, spp, panjar, lampiran, rekonsiliasi_bank, dokumen_verifikasi RESTART IDENTITY CASCADE`);
  await pool.query('UPDATE users SET unit_id = NULL');
  await pool.query(`TRUNCATE spj_pembantu_rincian, spj_pembantu, bpp_entries, sts_rincian, sts, bkp_entries, target_pendapatan, subledger_head, tutup_tahun RESTART IDENTITY`);
  await pool.query('TRUNCATE anggaran_kas, perubahan_anggaran, persetujuan, pengingat_log, transfer_item, transfer_batch RESTART IDENTITY');
  await pool.query("DELETE FROM pengaturan WHERE kunci IN ('pengingat_terakhir', 'cadangan_terakhir')");
  await pool.query('DELETE FROM unit_kerja');
  await pool.query("SELECT setval(pg_get_serial_sequence('unit_kerja', 'id'), 1, false)");
  await pool.query('ALTER TABLE bku_entries DISABLE TRIGGER bku_immutable');
  await pool.query('TRUNCATE bku_entries');
  await pool.query('ALTER TABLE bku_entries ENABLE TRIGGER bku_immutable');

  const skpdIds = [];
  for (const s of SKPD) {
    const { rows: [r] } = await pool.query(`INSERT INTO skpd (kode, nama, npwp, alamat, kepala_nama, kepala_nip, bendahara_nama, bendahara_nip)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama, npwp = EXCLUDED.npwp RETURNING id`,
    [s.kode, s.nama, s.npwp, s.alamat, s.kepala_nama, s.kepala_nip, s.bendahara_nama, s.bendahara_nip]);
    skpdIds.push(r.id);
  }
  for (const [kode, nama] of REKENING) await pool.query('INSERT INTO rekening (kode, nama, jenis, level) VALUES ($1,$2,$3,6) ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama', [kode, nama, 'belanja']);
  for (const [kode, nama] of PENDAPATAN) await pool.query('INSERT INTO rekening (kode, nama, jenis, level) VALUES ($1,$2,$3,6) ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama', [kode, nama, 'pendapatan']);
  for (const [kode, nama] of NON_ANGGARAN) await pool.query('INSERT INTO rekening (kode, nama, jenis, level) VALUES ($1,$2,$3,6) ON CONFLICT (kode) DO NOTHING', [kode, nama, 'non_anggaran']);
  for (const o of OBJEK) await pool.query(`INSERT INTO objek_pajak (kode, jenis_pajak, nama, tarif, dpp_persen, coretax_form, keterangan) VALUES ($1,$2,$3,$4,$5,$6,'Cocokkan dengan referensi kode objek pajak Coretax terbaru')
    ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama, tarif = EXCLUDED.tarif, coretax_form = EXCLUDED.coretax_form`, o);
  const rekananIds = [];
  if (!(await pool.query('SELECT 1 FROM rekanan LIMIT 1')).rows.length) {
    for (const [nama, npwp, bank, norek] of REKANAN) rekananIds.push((await pool.query('INSERT INTO rekanan (nama, jenis, npwp, bank, no_rekening, alamat) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [nama, 'badan', npwp, bank, norek, 'Kota Contoh'])).rows[0].id);
  } else rekananIds.push(...(await pool.query('SELECT id FROM rekanan ORDER BY id LIMIT 8')).rows.map((r) => r.id));

  const pw = await hashPassword('bku12345');
  const users = [
    ['admin', 'Administrator BKAD', 'admin', skpdIds[0]], ['bendahara', 'Siti Rahmawati, S.E.', 'bendahara', skpdIds[0]],
    ['verifikator', 'Yusuf Maulana, S.E., Ak.', 'verifikator', skpdIds[0]], ['pimpinan', 'Dr. H. Ahmad Fauzi, S.E., M.Si.', 'pimpinan', skpdIds[0]],
    ['bendahara.disdik', 'Rina Kartika, S.Ak.', 'bendahara', skpdIds[1]], ['bendahara.dinkes', 'Agus Prasetyo, A.Md.', 'bendahara', skpdIds[2]],
    ['bendahara.pupr', 'Dewi Lestari, S.E.', 'bendahara', skpdIds[3]],
    ['penerimaan', 'Nur Aisyah, S.E.', 'bendahara_penerimaan', skpdIds[0]], ['pembantu', 'Gilang Ramadhan, S.E.', 'bendahara_pembantu', skpdIds[0]],
  ];
  const userIds = {};
  for (const [u, n, r, s] of users) {
    userIds[u] = (await pool.query(`INSERT INTO users (username, full_name, password_hash, role, skpd_id) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, skpd_id = EXCLUDED.skpd_id RETURNING id`, [u, n, pw, r, s])).rows[0].id;
  }

  let samplePegawai = [];
  const bankRows = [];
  for (const [si, s] of SKPD.entries()) {
    const skpd = skpdIds[si];
    const user = { id: userIds[['bendahara', 'bendahara.disdik', 'bendahara.dinkes', 'bendahara.pupr'][si]], full_name: s.bendahara_nama };
    // Pegawai
    const peg = Array.from({ length: Math.round(12 * s.skala) }, (_, i) => {
      const golongan = pick(GOL); const g = golongan.split('/')[0];
      return { nip: `19${between(70, 95)}${String(between(1, 12)).padStart(2, '0')}${String(between(1, 28)).padStart(2, '0')}20${between(10, 22)}0${between(1, 2)}${String(1000 + si * 100 + i)}`,
        nama: `${NAMA[(i + si * 5) % NAMA.length]}${i >= NAMA.length ? ' II' : ''}`, npwp: `0${between(1e13, 9e13)}`, golongan,
        jabatan: pick(['Analis Keuangan', 'Pengelola Anggaran', 'Bendahara Pengeluaran Pembantu', 'Penata Laporan Keuangan', 'Pranata Komputer', 'Kepala Sub Bagian']),
        status_ptkp: pick(PTKP), gaji: round(between(...GAJI_GOL[g]), 100) };
    });
    for (const p of peg) await pool.query('INSERT INTO pegawai (skpd_id, nip, nama, npwp, status_ptkp, golongan, jabatan, jenis) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [skpd, p.nip, p.nama, p.npwp, p.status_ptkp, p.golongan, p.jabatan, 'pns']);
    if (si === 0) samplePegawai = peg;

    const belanjaPerRek = {};
    const UP = round(500_000_000 * s.skala, 1_000_000);
    await tx(async (c) => {
      await insertEntries(c, user, skpd, [{ tanggal: ymd(TAHUN, 1, 2), no_bukti: `SP2D-UP-001/${s.kode.slice(0, 4)}`, jenis: 'SP2D_UP', kode_rekening: '0.0.00.00.00.0001', uraian: `Penerimaan SP2D Uang Persediaan (UP) TA ${TAHUN}`, penerimaan: UP }]);
    });
    let spjSejakGu = 0; let gu = 0; let nb = 0;
    for (let m = 1; m <= lastMonth; m++) {
      const maxDay = m === lastMonth ? lastDay : new Date(TAHUN, m, 0).getDate();
      const events = [];
      // Gaji LS (tanggal 1)
      events.push({ d: 1, kind: 'gaji' });
      // Belanja GU
      const n = Math.round(between(14, 24) * s.skala);
      for (let i = 0; i < n; i++) events.push({ d: between(2, Math.max(2, maxDay)), kind: 'belanja' });
      if (maxDay >= 3) events.push({ d: Math.min(3, maxDay), kind: 'tunai' });
      if (m > 1 && maxDay >= 10) events.push({ d: 10, kind: 'setor' });
      if (rnd() < 0.15 * s.skala && m >= 4) events.push({ d: between(5, Math.max(5, maxDay)), kind: 'modal' });
      events.sort((a, b) => a.d - b.d);
      for (const ev of events) {
        if (ev.d > maxDay) continue;
        const tanggal = ymd(TAHUN, m, ev.d);
        await tx(async (c) => {
          if (ev.kind === 'gaji') {
            const bruto = peg.reduce((a, p) => a + p.gaji, 0);
            await insertEntries(c, user, skpd, [
              { tanggal, no_bukti: `SP2D-LS-GAJI-${String(m).padStart(2, '0')}`, jenis: 'SP2D_LS', kode_rekening: '5.1.01.01.01.0001', uraian: `Penerimaan SP2D LS Gaji dan Tunjangan PNS bulan ${m}/${TAHUN}`, penerimaan: bruto },
              { tanggal, no_bukti: `SP2D-LS-GAJI-${String(m).padStart(2, '0')}`, jenis: 'BELANJA', kode_rekening: '5.1.01.01.01.0001', uraian: `Pembayaran Gaji dan Tunjangan PNS bulan ${m}/${TAHUN} (${peg.length} pegawai)`, pengeluaran: bruto },
            ]);
            belanjaPerRek['5.1.01.01.01.0001'] = (belanjaPerRek['5.1.01.01.01.0001'] || 0) + bruto;
            await insertPajak(c, user, skpd, peg.map((p) => {
              const h = pph21Bulanan({ bruto: p.gaji, status: p.status_ptkp });
              return { tahun: TAHUN, masa: m, jenis_pajak: 'PPH21', kode_objek: '21-100-01', penerima_nama: p.nama, penerima_npwp: p.npwp, status_ptkp: p.status_ptkp, dpp: p.gaji, tarif: h.tarif, nominal: h.pph, ditanggung_pemerintah: true, detail: { bruto: p.gaji, jabatan: p.jabatan, kategori: h.kategori } };
            }).filter((x) => x.nominal > 0));
          } else if (ev.kind === 'tunai') {
            const v = round(between(15, 35) * 1_000_000 * s.skala, 1_000_000);
            await insertEntries(c, user, skpd, [
              { tanggal, no_bukti: `CEK-${String(m).padStart(2, '0')}01`, jenis: 'PELIMPAHAN', uraian: 'Penarikan tunai dari rekening bendahara (cek)', pengeluaran: v, metode: 'bank' },
              { tanggal, no_bukti: `CEK-${String(m).padStart(2, '0')}01`, jenis: 'PELIMPAHAN', uraian: 'Penerimaan kas tunai dari penarikan cek', penerimaan: v, metode: 'tunai' },
            ]);
            if (m === 9 && si === 0) bankRows.push({ tanggal, ket: `TARIK TUNAI CEK-${String(m).padStart(2, '0')}01`, debet: v, kredit: 0 });
          } else if (ev.kind === 'setor') {
            const { rows } = await c.query(`SELECT id FROM pajak WHERE skpd_id = $1 AND tahun = $2 AND masa = $3 AND status = 'dipungut'`, [skpd, TAHUN, m - 1]);
            if (rows.length) {
              const res = await setorPajak(c, user, rows.map((r) => r.id), { ntpn: ntpn(), id_billing: `0${between(1e13, 9e13)}`, tanggal_setor: tanggal });
              if (m === 9 && si === 0) for (const e of res.saved) bankRows.push({ tanggal, ket: `MPN ${e.no_bukti}`, debet: Number(e.pengeluaran), kredit: 0 });
              if (m - 1 <= lastMonth - 3) await c.query(`UPDATE pajak SET status = 'dilaporkan', no_bukti_potong = 'BP-' || id WHERE id = ANY($1)`, [res.rows.map((r) => r.id)]);
            }
          } else {
            const rek = ev.kind === 'modal' ? pick(REKENING.slice(11)) : pick(REKENING.slice(2, 11));
            const nilai = round(between(...rek[3]) * (ev.kind === 'modal' ? 1 : s.skala));
            const tunai = nilai <= 2_000_000 && rnd() < 0.6;
            const rekanan = rek[2] && rek[2] !== 'honor' ? pick(rekananIds) : null;
            nb++;
            const b = { tanggal, no_bukti: `BKT-${String(m).padStart(2, '0')}-${String(nb).padStart(4, '0')}`, jenis: 'BELANJA', kode_rekening: rek[0], uraian: `${rek[1]}${rekanan ? '' : ' - kegiatan bulan ' + m}`, pengeluaran: nilai, metode: tunai ? 'tunai' : 'bank', rekanan_id: rekanan };
            if (rek[2] === 'honor') {
              const asn = rnd() < 0.6;
              const nama = pick(NAMA);
              const h = asn ? pph21HonorASN({ bruto: nilai, golongan: pick(['III', 'IV', 'II']) }) : pph21BukanPegawai({ bruto: nilai });
              b.uraian = `Honorarium narasumber a.n. ${nama}`;
              if (h.pph > 0) b.pajak = [{ jenis_pajak: 'PPH21', kode_objek: asn ? '21-402-01' : '21-100-08', penerima_nama: nama, penerima_nik: String(3300000000000000 + between(1e8, 9e8)), status_ptkp: 'TK/0', dpp: asn ? nilai : h.dpp, bruto: nilai, tarif: h.tarif, nominal: h.pph }];
            } else if (rek[2]) {
              const p = potonganBelanja({ nilai, termasukPPN: true, jenis: rek[2] });
              b.pajak = p.potongan.map((x) => ({ ...x }));
            }
            await catatTransaksi(c, user, skpd, b);
            belanjaPerRek[rek[0]] = (belanjaPerRek[rek[0]] || 0) + nilai;
            spjSejakGu += nilai;
            if (b.metode === 'bank' && m === 9 && si === 0) bankRows.push({ tanggal, ket: `TRF ${b.no_bukti} ${rek[1].slice(0, 30)}`, debet: nilai - (b.pajak || []).reduce((a, x) => a + x.nominal, 0), kredit: 0 });
            // SP2D GU bila SPJ > 60% UP
            if (spjSejakGu > UP * 0.6) {
              gu++;
              const t2 = ymd(TAHUN, m, Math.min(maxDay, ev.d + 2));
              await insertEntries(c, user, skpd, [{ tanggal: t2, no_bukti: `SP2D-GU-${String(gu).padStart(3, '0')}`, jenis: 'SP2D_GU', kode_rekening: '0.0.00.00.00.0001', uraian: `Penerimaan SP2D Ganti Uang (GU) ke-${gu}`, penerimaan: spjSejakGu }]);
              if (m === 9 && si === 0) bankRows.push({ tanggal: t2, ket: `SP2D GU ${gu} KASDA`, debet: 0, kredit: spjSejakGu });
              spjSejakGu = 0;
            }
          }
        });
      }
      // Penutupan kas akhir bulan
      if (m < lastMonth) {
        await tx(async (c) => {
          const end = ymd(TAHUN, m, new Date(TAHUN, m, 0).getDate());
          const { rows: [r] } = await c.query(`SELECT COALESCE(SUM(penerimaan - pengeluaran),0) AS saldo, COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode='bank'),0) AS bank, COALESCE(SUM(penerimaan - pengeluaran) FILTER (WHERE metode='tunai'),0) AS tunai FROM bku_entries WHERE skpd_id = $1 AND tanggal <= $2`, [skpd, end]);
          await c.query('INSERT INTO penutupan_kas (skpd_id, tanggal, saldo_bku, saldo_bank, kas_tunai, denominasi, selisih, keterangan, created_by) VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8)',
            [skpd, end, r.saldo, r.bank, r.tunai, { 100000: Math.floor(Number(r.tunai) / 100000) }, 'Penutupan kas akhir bulan', user.id]);
        });
      }
    }
    // Anggaran: pagu = proyeksi setahun x 1,15-1,4
    for (const [kode, total] of Object.entries(belanjaPerRek)) {
      const pagu = round((total / lastMonth) * 12 * (1.15 + rnd() * 0.25), 1_000_000);
      await pool.query('INSERT INTO anggaran (skpd_id, tahun, kode_rekening, pagu) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [skpd, TAHUN, kode, pagu]);
    }
    for (const [kode, , jenis] of REKENING) if (jenis && !belanjaPerRek[kode]) await pool.query('INSERT INTO anggaran (skpd_id, tahun, kode_rekening, pagu) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [skpd, TAHUN, kode, round(between(50, 300) * 1_000_000 * s.skala, 1_000_000)]);
    // Verifikasi: semua sampai 2 bulan lalu
    await pool.query(`INSERT INTO bku_verifications (entry_id, status, catatan, verified_by)
      SELECT id, CASE WHEN random() < 0.01 THEN 'ditolak' ELSE 'diverifikasi' END, NULL, $3 FROM bku_entries WHERE skpd_id = $1 AND tanggal < $2`,
    [skpd, ymd(TAHUN, Math.max(1, lastMonth - 1), 1), userIds.verifikator]);
    await pool.query(`UPDATE bku_verifications SET catatan = 'Bukti pendukung belum lengkap' WHERE status = 'ditolak' AND catatan IS NULL`);
    const { rows: [cnt] } = await pool.query('SELECT COUNT(*)::int AS n FROM bku_entries WHERE skpd_id = $1', [skpd]);
    console.log(`[seed] ${s.nama}: ${cnt.n} entri BKU`);
  }
  await seedTahap4({ TAHUN, lastMonth, lastDay, skpdIds, userIds, rekananIds });
  await seedTahunLalu({ skpdIds, userIds, rekananIds });
  await seedFiturLanjutan({ TAHUN, lastMonth, lastDay, skpdIds, userIds });
  await seedTahap5({ TAHUN, lastMonth, lastDay, skpdIds, userIds });
  // Mutasi bank contoh: salin transaksi bank September + 2 baris yang tidak ada di BKU (biaya admin & bunga)
  bankRows.push({ tanggal: '2026-09-30', ket: 'BIAYA ADMINISTRASI', debet: 15000, kredit: 0 }, { tanggal: '2026-09-30', ket: 'BUNGA JASA GIRO', debet: 0, kredit: 48250.37 });
  if (bankRows.length > 4) bankRows.splice(3, 1); // satu transaksi BKU sengaja tidak ada di bank
  bankRows.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  await pool.query(`INSERT INTO daily_summary (skpd_id, tanggal, penerimaan, pengeluaran, jumlah_transaksi)
    SELECT skpd_id, tanggal, SUM(penerimaan), SUM(pengeluaran), COUNT(*) FROM bku_entries GROUP BY 1,2
    ON CONFLICT (skpd_id, tanggal) DO UPDATE SET penerimaan = EXCLUDED.penerimaan, pengeluaran = EXCLUDED.pengeluaran, jumlah_transaksi = EXCLUDED.jumlah_transaksi`);
  await pool.query('UPDATE outbox SET published_at = now() WHERE published_at IS NULL');
  await writeSamples(samplePegawai, bankRows).catch((e) => console.warn(`[seed] file contoh tidak ditulis (${e.code || e.message}); data database tetap lengkap`));
  console.log('[seed] selesai. Login: admin / bendahara / verifikator / pimpinan / penerimaan / pembantu, password: bku12345');
}

main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
