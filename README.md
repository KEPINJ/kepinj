# BKU BKAD — Sistem Buku Kas Umum

Aplikasi web penatausahaan kas bendahara untuk Badan Keuangan dan Aset Daerah (BKAD):
Buku Kas Umum, perhitungan pajak otomatis siap **Coretax DJP**, unggah & olah data Excel/CSV,
rekonsiliasi bank, realisasi anggaran, dan laporan cetak, dengan pembaruan **realtime**
dan **integritas data** terjamin.

**Coba demo:** https://kepinj.github.io/kepinj/ (login `admin` / `bku12345`). Demo berjalan sepenuhnya
di browser dengan data contoh. Untuk dipakai bekerja, pasang di server: lihat [docs/DEPLOY.md](docs/DEPLOY.md).

![Dashboard](docs/screenshots/dashboard.png)

## Fitur

| Modul | Isi |
|---|---|
| **Dashboard** | Saldo kas bank/tunai, penerimaan & pengeluaran, arus kas bulanan, realisasi anggaran, pajak belum disetor, transaksi terbaru (live), konsolidasi semua SKPD untuk pimpinan/admin |
| **Buku Kas Umum** | Catat SP2D UP/GU/TU/LS, belanja, penerimaan, penyetoran, pelimpahan; saldo berjalan; filter & pencarian; verifikasi/penolakan oleh verifikator (massal); jurnal koreksi (tanpa hapus/ubah); cetak kuitansi dengan terbilang; ekspor Excel |
| **Pajak otomatis saat input belanja** | Pilih jenis belanja → PPN 12% × DPP 11/12, PPh 22 1,5%, PPh 23 2% (4% tanpa NPWP), PPh 4(2) konstruksi/sewa, honor PPh 21; aturan batas Rp2 juta; nilai netto ke rekanan; pungutan otomatis dibukukan di BKU dan register pajak |
| **Kalkulator pajak** | PPh 21 TER bulanan (PP 58/2023, kategori A/B/C), PPh 21 Desember (Pasal 17 setahun), honor ASN final (0/5/15%), bukan pegawai (50% × Pasal 17), PPN & PPh belanja; hasil bisa langsung disimpan ke register |
| **Register pajak** | Status dipungut → disetor (NTPN, kode billing, otomatis membukukan setoran di BKU) → dilaporkan; ubah data bukti potong; ekspor Excel |
| **Ekspor Coretax** | XML impor massal **BPMP** (gaji pegawai tetap), **BP21** (honor/bukan pegawai), **BPPU** (PPh 22/23/4(2)), rekap PPN; validasi NPWP/NIK 16 digit, NITKU, kode objek, PTKP sebelum unduh |
| **Upload & Olah Data** | Unggah .xlsx/.csv (deteksi baris judul & angka format Indonesia), susun langkah: saring, kolom rumus, ganti nama, pilih kolom, kelompokkan & rekap, urutkan, hapus duplikat; rumus aman dengan fungsi pajak (`PPH21`, `TARIF_TER`, `HONOR_ASN`, `PPN`, `PPH22`, `PPH23`, `TERBILANG`, `IF`, …); templat tersimpan; ekspor Excel; **simpan hasil ke BKU** atau **hitung pajak massal** ke register |
| **Rekonsiliasi bank** | Cocokkan rekening koran dengan BKU kas bank (nilai, arah, tanggal ± toleransi, no. bukti, pembayaran netto setelah pajak) |
| **Penutupan kas** | Hitung fisik per pecahan uang, bandingkan dengan saldo BKU & bank, cetak register penutupan kas |
| **Realisasi anggaran** | Pagu DPA vs realisasi per kode rekening, peringatan melebihi pagu (juga saat input transaksi) |
| **Laporan** | Cetak BKU bulanan/tahunan format Permendagri 77/2020 dengan tanda tangan, buku pembantu pajak, realisasi |
| **Data master** | Rekanan, pegawai, kode rekening, anggaran (DPA), kode objek pajak, SKPD; impor massal dari Excel |
| **Keamanan & audit** | Peran Admin / Bendahara / Verifikator / Pimpinan, batas akses per SKPD, jejak audit permanen, verifikasi rantai hash |

## Arsitektur

```
Browser (React) ──REST──► API Node.js (Fastify)
     ▲                         │  satu transaksi ACID
     │ Server-Sent Events      ▼
     │                    PostgreSQL 16 ── tabel outbox ──► relay ──► Apache Kafka (topic bku.events)
     │                                                                    │
     └──────────── consumer realtime ◄────────────────────────────────────┤
                   consumer proyeksi (ringkasan harian) ◄─────────────────┘
```

**Kenapa PostgreSQL + Kafka, bukan Kafka saja?** Data keuangan butuh kebenaran tunggal yang
konsisten (saldo tidak boleh selisih satu rupiah pun). Maka:

- **PostgreSQL** adalah sumber kebenaran: transaksi ACID, constraint, tabel BKU **dipartisi per tahun**
  (2023–2032 + default) dengan indeks BRIN sehingga tetap cepat pada jutaan baris.
- **Integritas**: setiap entri BKU berisi hash SHA-256 dari isinya + hash entri sebelumnya (rantai per
  SKPD per tahun), penomoran dikunci sehingga tidak ada nomor ganda/lompat, tabel BKU dan audit dikunci
  trigger *append-only* (UPDATE/DELETE ditolak database). Perubahan langsung di database akan terdeteksi
  di menu *Integritas & Sistem*.
- **Apache Kafka** menerima setiap perubahan melalui pola *transactional outbox* (tidak ada event hilang
  atau event tanpa data), menjadi aliran data realtime untuk layar pengguna, proyeksi analitik, dan
  integrasi sistem lain (SIPD, data warehouse, BI) dengan retensi 1 tahun yang bisa diputar ulang.
- Tanpa `KAFKA_BROKERS`, aplikasi otomatis memakai bus internal sehingga tetap jalan di satu server.

### Hasil uji beban (500.000 transaksi dalam satu SKPD-tahun)

| Operasi | Waktu |
|---|---|
| Simpan 500.000 entri (dengan rantai hash) | 31,9 detik (±15.700 entri/detik) |
| Buka halaman BKU 1 bulan + saldo berjalan | 123 ms |
| Ringkasan saldo periode | 65 ms |
| Verifikasi rantai hash 500.000 entri | 4,2 detik |

Jalankan sendiri: `DATABASE_URL=postgres://…/bku_uji node server/scripts/loadtest.js 500000` (pakai database terpisah).

## Menjalankan

Panduan memasang di server (VPS + HTTPS, Render, Railway) dan mengaktifkan demo GitHub Pages ada di
[docs/DEPLOY.md](docs/DEPLOY.md). Untuk hosting cPanel seperti Zenhosta, lihat [docs/HOSTING-CPANEL.md](docs/HOSTING-CPANEL.md).
Bila PostgreSQL tidak tersedia, aplikasi dapat memakai PostgreSQL bawaan (PGlite) dengan `DATABASE_URL=pglite:/path/folder-data`. Pada instalasi baru tanpa data contoh, akun `admin` dibuat otomatis
dengan password dari `ADMIN_PASSWORD` (atau password acak yang dicetak di log).

### Cara cepat (Docker)

```bash
cp .env.example .env          # ganti password & JWT_SECRET
docker compose up -d --build  # PostgreSQL + Apache Kafka + aplikasi
docker compose exec app node src/db/seed.js   # opsional: data contoh TA 2026
```

Buka http://localhost:8080. Pantau Kafka dengan `docker compose --profile monitoring up -d` lalu buka http://localhost:8081.

### Tanpa Docker (pengembangan)

Butuh Node.js 20+ dan PostgreSQL 14+ (Kafka opsional).

```bash
cd server && npm install
export DATABASE_URL=postgres://bku:bku@localhost:5432/bku
export KAFKA_BROKERS=localhost:9092      # kosongkan untuk tanpa Kafka
npm run seed      # membuat tabel + data contoh
npm run dev       # API di :8080

cd ../web && npm install && npm run dev   # UI di :5173 (proxy ke API)
# atau: npm run build  -> API ikut menyajikan UI di :8080
```

### Akun demo (setelah seed)

Password semua akun: `bku12345` — **wajib diganti** sebelum dipakai sungguhan.

| Username | Peran |
|---|---|
| `admin` | Administrator (semua SKPD, data master, pengguna) |
| `bendahara` | Bendahara pengeluaran BKAD |
| `verifikator` | Verifikator (verifikasi/tolak transaksi) |
| `pimpinan` | Pimpinan (lihat semua, konsolidasi) |
| `bendahara.disdik`, `bendahara.dinkes`, `bendahara.pupr` | Bendahara SKPD lain |

File contoh untuk dicoba di menu Olah Data dan Rekonsiliasi ada di folder [`samples/`](samples/).

### Demo di browser (tanpa server)

```bash
cd server && npm install && cd ../web && npm install
npm run build:demo     # snapshot data contoh (PGlite) + build mode demo ke web/dist
npx vite preview --mode demo
```

Pada mode demo, rute API server yang sama dijalankan di browser dan database memakai PGlite
(PostgreSQL WebAssembly). Modul khusus Node (driver `pg`, Kafka, JWT) diganti versi browser di `web/src/demo/`.

### Tes

```bash
cd server && npm test     # perhitungan pajak, rumus, XML Coretax, rantai hash
```

## Catatan penting

- **Template Coretax**: struktur XML mengikuti template impor massal Coretax (BPMP, BP21, BPPU).
  DJP dapat memperbarui template; seluruh nama elemen dipusatkan di `server/src/lib/coretax.js` agar
  mudah disesuaikan. Uji unggah satu file di Coretax sebelum dipakai massal.
- **Kode objek pajak** pada data contoh perlu dicocokkan dengan referensi Coretax terbaru; ubah di
  menu *Data Master → Kode objek pajak* tanpa mengubah kode program.
- **Tarif**: TER PP 58/2023, Pasal 17 UU HPP, PPN 12% × DPP nilai lain 11/12 (PMK 131/2024),
  PPh 21 final honor APBD (PP 80/2010), batas pungut bendahara Rp2 juta (PMK 59/2022).
- Data contoh (nama, NPWP, kode rekening) adalah fiktif.

## Struktur folder

```
server/          API Fastify, migrasi SQL, event pipeline Kafka, seeder, tes
  src/routes/    bku, pajak, data (olah data), laporan (dashboard, rekonsiliasi, penutupan kas), master, sistem
  src/lib/       ledger (rantai hash), coretax (XML), excel, transaksi
shared/          Mesin pajak, evaluator rumus & pengolah data (dipakai server dan browser)
web/             React + Vite + Tailwind (15 halaman)
  src/demo/      Mode demo: backend & PostgreSQL (PGlite) berjalan di browser untuk GitHub Pages
deploy/          Caddyfile (HTTPS otomatis)
samples/         Contoh daftar gaji, honor, transaksi belanja, mutasi bank
docs/            DEPLOY.md & HOSTING-CPANEL.md (panduan online-kan) dan tangkapan layar
scripts/         build-cpanel.sh (paket ZIP untuk hosting cPanel)
```
