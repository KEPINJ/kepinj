# Panduan Online-kan Aplikasi BKU

Ada dua cara, dan keduanya bisa dipakai bersamaan:

| | Demo GitHub Pages | Server sungguhan |
|---|---|---|
| Untuk | Mencoba, presentasi, pelatihan | Pemakaian kerja sehari-hari |
| Data | Data contoh, tersimpan di browser masing-masing | Satu database bersama untuk semua pegawai |
| Biaya | Gratis | Sewa VPS atau layanan cloud |
| Kafka | Tidak (event diproses di browser) | Ya (VPS) / bus internal (Render) |

## 1. Demo di GitHub Pages

Aplikasi demo dibangun otomatis oleh GitHub Actions (`.github/workflows/pages.yml`) setiap ada perubahan di cabang `main`. Backend, database PostgreSQL (versi WebAssembly, PGlite), dan data contoh semuanya berjalan di browser pengunjung, jadi GitHub Pages cukup menyajikan file statis.

Pengaturan sekali saja di GitHub:

1. Buka repo → **Settings** → **Pages**.
2. Pada **Build and deployment → Source**, pilih **GitHub Actions** (bukan "Deploy from a branch").
3. Buka tab **Actions** → **Demo GitHub Pages** → **Run workflow** (atau tunggu push berikutnya ke `main`).

Alamat demo: `https://<username>.github.io/<nama-repo>/`. Akun: `admin`, `bendahara`, `verifikator`, `pimpinan`, password `bku12345`.

Perubahan yang dibuat di demo hanya tersimpan di browser yang dipakai. Tombol **Reset data demo** di bagian atas mengembalikan data ke kondisi awal. Jangan memasukkan data keuangan asli ke demo.

## 2. Server sungguhan

### Pilihan A: VPS dengan Docker (direkomendasikan)

Cocok untuk server milik Pemda/BKAD atau VPS sewaan (minimal 2 vCPU, RAM 4 GB, disk 40 GB, Ubuntu 22.04/24.04). Ini menjalankan stack lengkap: PostgreSQL, Apache Kafka, aplikasi, dan HTTPS otomatis.

```bash
# 1. Pasang Docker
curl -fsSL https://get.docker.com | sh

# 2. Ambil kode
git clone https://github.com/KEPINJ/kepinj.git bku && cd bku

# 3. Isi konfigurasi
cp .env.example .env
nano .env   # ganti POSTGRES_PASSWORD, JWT_SECRET (acak ≥32 karakter), ADMIN_PASSWORD, DOMAIN
# contoh membuat JWT_SECRET acak:  openssl rand -base64 48

# 4. Arahkan DNS domain (record A) ke IP server, lalu jalankan
docker compose --profile https up -d --build
```

Buka `https://<DOMAIN>`, login sebagai `admin` dengan `ADMIN_PASSWORD`, segera ganti password, lalu isi **Data Master** (SKPD, rekening, rekanan, pegawai) dan buat akun pengguna.

Tanpa domain (hanya jaringan kantor): `docker compose up -d --build`, lalu buka `http://<IP-server>:8080`.

Perintah perawatan:

```bash
docker compose logs -f app                              # lihat log
git pull && docker compose --profile https up -d --build  # perbarui aplikasi
docker compose exec postgres pg_dump -U bku bku | gzip > backup-$(date +%F).sql.gz   # cadangkan database
```

Jadwalkan perintah backup di atas dengan `cron` setiap malam dan simpan salinannya di luar server.

### Pilihan B: Render (tanpa mengurus server)

1. Daftar di [render.com](https://render.com) dan hubungkan akun GitHub.
2. **New → Blueprint**, pilih repo ini. Render membaca `render.yaml` dan membuat layanan web + database PostgreSQL di region Singapura.
3. Isi `ADMIN_PASSWORD` saat diminta, lalu **Apply**.
4. Setelah build selesai, buka alamat `https://bku-bkad.onrender.com` (atau domain sendiri via **Settings → Custom Domains**).

Render tidak menyediakan Kafka. Aplikasi otomatis memakai bus event internal, jadi pembaruan realtime tetap berjalan untuk satu instance.

### Pilihan C: Railway atau penyedia Docker lain

Buat layanan dari repo (Dockerfile terdeteksi otomatis), tambahkan PostgreSQL, lalu isi variabel:

- `DATABASE_URL`: connection string PostgreSQL
- `JWT_SECRET`: string acak ≥32 karakter
- `ADMIN_PASSWORD`: password admin pertama
- `KAFKA_BROKERS` (opsional): alamat broker Kafka bila tersedia

## Keamanan untuk produksi

- Selalu gunakan HTTPS (profil `https` atau domain dari penyedia).
- Aplikasi menolak berjalan bila `JWT_SECRET` lemah di mode produksi.
- Jangan menjalankan `seed.js` di server produksi karena perintah itu mengganti data dengan data contoh.
- Batasi akses port PostgreSQL dan Kafka hanya di jaringan internal Docker (sudah demikian di `docker-compose.yml`).
