# Hosting Aplikasi BKU di cPanel (Zenhosta dan hosting sejenis)

Panduan ini untuk paket hosting cPanel yang punya menu **Setup Node.js App**. Kalau menu itu tidak ada di cPanel Anda, minta CS Zenhosta mengaktifkan Node.js untuk akun Anda, atau gunakan paket yang mendukung Node.js.

Di hosting cPanel, Apache Kafka tidak tersedia. Aplikasi otomatis memakai bus event internal, jadi pembaruan realtime tetap berjalan.

## Yang perlu disiapkan

- Akses cPanel hosting Zenhosta.
- Domain atau subdomain untuk aplikasi, misalnya `bku.namadaerah.go.id`.
- File `bku-bkad-cpanel.zip`, diunduh dari halaman **Releases** repo GitHub (rilis "Paket hosting cPanel").

## Langkah 1: Unggah aplikasi

1. Login cPanel → **File Manager**.
2. Masuk ke folder utama akun (`/home/USERNAME`, bukan `public_html`).
3. Klik **Upload** dan unggah `bku-bkad-cpanel.zip`.
4. Klik kanan file zip → **Extract** ke `/home/USERNAME`. Hasilnya folder `bku` yang berisi `server`, `shared`, `web`, dan `samples`.
5. Pastikan file `/home/USERNAME/bku/server/package.json` dan `/home/USERNAME/bku/server/app.cjs` ada. Kalau ZIP diekstrak di dalam folder `bku` yang sudah ada, hasilnya menjadi bertingkat (`bku/bku/server`) dan aplikasi tidak akan jalan.

## Langkah 2: Siapkan database

Pilih salah satu cara berikut.

**A. PostgreSQL dari cPanel (pilih ini bila menunya ada)**

1. cPanel → **PostgreSQL Databases**.
2. Buat database `bku`. Nama lengkapnya akan memakai awalan akun, misalnya `USERNAME_bku`.
3. Buat user baru dengan password yang kuat, lalu tambahkan user ke database dengan **ALL PRIVILEGES**.
4. Nilai `DATABASE_URL` untuk langkah 3:
   `postgres://USERNAME_bkuuser:PASSWORD@localhost:5432/USERNAME_bku`

   Kalau password mengandung karakter `@ : / ? #`, ganti password dengan yang hanya huruf dan angka.

Aplikasi butuh PostgreSQL versi 11 atau lebih baru. Versinya bisa dicek di phpPgAdmin.

**B. Tanpa PostgreSQL (database bawaan aplikasi)**

Kalau cPanel tidak punya menu PostgreSQL, aplikasi bisa memakai PostgreSQL bawaan (PGlite) yang menyimpan data di sebuah folder hosting. Tidak perlu membuat apa pun. Cukup isi:

`DATABASE_URL` = `pglite:/home/USERNAME/bku-data`

Folder `bku-data` sengaja diletakkan di luar folder `bku` supaya tidak ikut tertimpa saat aplikasi diperbarui. Cara ini cocok untuk satu instansi dengan jumlah transaksi kecil sampai menengah. Untuk skala besar, gunakan cara A atau VPS (lihat `docs/DEPLOY.md`).

## Langkah 3: Buat aplikasi Node.js

cPanel → **Setup Node.js App** → **Create Application**, lalu isi:

| Kolom | Isi |
|---|---|
| Node.js version | 22 (atau versi 20 terbaru bila 22 tidak ada) |
| Application mode | Production |
| Application root | `bku/server` |
| Application URL | domain/subdomain aplikasi |
| Application startup file | `app.cjs` |

Di bagian **Environment variables**, tambahkan:

| Nama | Nilai |
|---|---|
| `DATABASE_URL` | dari langkah 2 |
| `JWT_SECRET` | string acak minimal 32 karakter, misalnya hasil password generator 48 karakter |
| `ADMIN_PASSWORD` | password awal akun `admin` |

Klik **Create**.

## Langkah 4: Pasang dependensi dan jalankan

1. Di halaman aplikasi yang baru dibuat, klik **Run NPM Install** dan tunggu sampai selesai.
2. Klik **Restart**.
3. Buka alamat aplikasi. Pembukaan pertama bisa memakan 10–20 detik karena tabel database dibuat.
4. Login dengan username `admin` dan password dari `ADMIN_PASSWORD`, lalu segera ganti password lewat ikon kunci di kiri bawah.

Kalau **Run NPM Install** gagal karena batas memori, pasang lewat Terminal:

1. Salin perintah `source /home/USERNAME/nodevenv/...` yang tertera di bagian atas halaman aplikasi.
2. Buka cPanel → **Terminal**, tempel perintah itu, lalu jalankan:

```bash
cd ~/bku/server
npm ci --omit=dev
```

## Langkah 5: Aktifkan HTTPS

1. cPanel → **SSL/TLS Status** → centang domain aplikasi → **Run AutoSSL**.
2. cPanel → **Domains** → aktifkan **Force HTTPS Redirect** untuk domain aplikasi.

## Langkah 6: Isi data awal

1. **Data Master** → isi SKPD, rekening belanja, rekanan, dan pegawai. Semua bisa diisi per baris atau diimpor dari Excel.
2. **Pengguna** → buat akun bendahara, verifikator, dan pimpinan untuk tiap SKPD.

### Data contoh untuk latihan (opsional)

Data contoh TA 2026 bisa dimuat untuk pelatihan. Perintah ini **menghapus semua transaksi** yang sudah ada, jadi jangan dijalankan setelah aplikasi dipakai sungguhan.

1. Setup Node.js App → **Stop App**.
2. Terminal (setelah perintah `source ...` di atas):

```bash
cd ~/bku/server
npm run seed
```

3. **Start App**. Akun contoh: `admin`, `bendahara`, `verifikator`, `pimpinan`, password `bku12345`.

## Memperbarui aplikasi

1. Unduh `bku-bkad-cpanel.zip` terbaru dari Releases.
2. File Manager → unggah ke `/home/USERNAME` → **Extract** dan timpa folder `bku`.
3. Setup Node.js App → **Run NPM Install** → **Restart**.

Data tidak hilang. Struktur database baru diterapkan otomatis saat aplikasi dijalankan.

## Cadangan data (backup)

- **Cara A (PostgreSQL):** cPanel → **Backup** → bagian *Download a PostgreSQL Database Backup* → klik nama database.
- **Cara B (PGlite):** Setup Node.js App → **Stop App** → File Manager → klik kanan `bku-data` → **Compress** → unduh hasilnya → **Start App**.

Lakukan backup rutin, minimal setiap minggu dan sebelum memperbarui aplikasi. Simpan salinannya di luar hosting.

## Jika ada masalah

| Gejala | Penyebab dan solusi |
|---|---|
| Log berisi `Cannot find module '/home/USERNAME/bku/server//app.cjs'` | File aplikasi tidak ada di `bku/server`. Periksa apakah ZIP terekstrak bertingkat (`bku/bku/server`) atau di folder lain, lalu pindahkan folder `bku` hasil ekstrak ke `/home/USERNAME`. |
| Halaman "503" atau "Incomplete response" | Lihat log di `bku/server/stderr.log` (File Manager). Pastikan **Run NPM Install** sudah selesai dan semua variabel lingkungan terisi. |
| Log berisi `JWT_SECRET wajib diisi` | `JWT_SECRET` kosong atau kurang dari 32 karakter. |
| Log berisi `sedang dipakai proses lain` | Aplikasi lama belum berhenti (cara B). Tunggu 30 detik lalu klik **Restart**. |
| Log berisi `ECONNREFUSED ...:5432` atau `password authentication failed` | Periksa `DATABASE_URL` (nama database/user lengkap dengan awalan akun). |
| Penanda "Realtime" di kanan atas menunjukkan "Offline" | Server hosting menahan koneksi realtime. Aplikasi tetap berfungsi; data diperbarui saat halaman dimuat ulang. |
| Upload Excel besar gagal | Batas unggah hosting. Pecah file atau minta CS menaikkan batas. |
