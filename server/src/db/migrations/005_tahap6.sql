-- =====================================================================
--  Tahap 6: persetujuan berjenjang transaksi BKU, manajemen dokumen
--  bukti, rekonsiliasi bank otomatis, akuntansi & jurnal (SAP akrual),
--  pusat notifikasi, serta keamanan (sesi, kunci akun, audit data,
--  uji pemulihan cadangan)
-- =====================================================================

-- ---------- 1. Persetujuan berjenjang transaksi BKU ----------
ALTER TABLE persetujuan DROP CONSTRAINT IF EXISTS persetujuan_objek_check;
ALTER TABLE persetujuan ADD CONSTRAINT persetujuan_objek_check CHECK (objek IN ('spp','spj','bku'));
CREATE INDEX IF NOT EXISTS persetujuan_objek ON persetujuan (objek, objek_id, putaran);

-- Proyeksi status persetujuan per entri BKU (entri BKU sendiri append-only, status berubah di sini)
CREATE TABLE bku_status (
  entry_id       bigint PRIMARY KEY,
  skpd_id        int  NOT NULL REFERENCES skpd(id),
  tahun          int  NOT NULL,
  status         text NOT NULL CHECK (status IN ('menunggu','disetujui','ditolak','dikoreksi')),
  induk_id       bigint,                 -- pungutan pajak mengikuti status transaksi belanjanya
  putaran        int  NOT NULL DEFAULT 1,
  tahap          text,                   -- label tahap yang sedang menunggu
  peran_menunggu text,
  catatan        text,
  diperbarui_at  timestamptz NOT NULL DEFAULT now(),
  disetujui_at   timestamptz,
  dokumen_status text CHECK (dokumen_status IN ('lengkap','sebagian','belum','tidak_wajib')),  -- dihitung aplikasi
  dokumen_kurang text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX bku_status_skpd ON bku_status (skpd_id, tahun, status);
CREATE INDEX bku_status_dokumen ON bku_status (skpd_id, tahun, dokumen_status);
CREATE INDEX bku_status_induk ON bku_status (induk_id) WHERE induk_id IS NOT NULL;

-- Isi status untuk data lama: verifikasi lama dianggap disetujui, yang ditolak tetap ditolak,
-- sisanya menunggu verifikasi (alur dibuat aplikasi saat dibuka pertama kali).
INSERT INTO bku_status (entry_id, skpd_id, tahun, status, catatan, disetujui_at)
SELECT e.id, e.skpd_id, e.tahun,
       CASE WHEN EXISTS (SELECT 1 FROM bku_entries k WHERE k.koreksi_of = e.id) THEN 'dikoreksi'
            WHEN e.jenis = 'SALDO_AWAL' THEN 'disetujui'
            WHEN v.status = 'diverifikasi' THEN 'disetujui'
            WHEN v.status = 'ditolak' THEN 'ditolak' ELSE 'menunggu' END,
       CASE WHEN v.status IS NOT NULL THEN COALESCE(v.catatan, 'Verifikasi satu tingkat (sebelum persetujuan berjenjang)') END,
       CASE WHEN v.status = 'diverifikasi' THEN v.verified_at END
  FROM bku_entries e
  LEFT JOIN LATERAL (SELECT status, catatan, verified_at FROM bku_verifications WHERE entry_id = e.id ORDER BY verified_at DESC LIMIT 1) v ON true
 WHERE e.jenis <> 'PAJAK_PUNGUT';
INSERT INTO bku_status (entry_id, skpd_id, tahun, status, induk_id)
SELECT e.id, e.skpd_id, e.tahun, COALESCE(s.status, 'menunggu'), b.id
  FROM bku_entries e
  LEFT JOIN LATERAL (SELECT x.id FROM bku_entries x WHERE x.skpd_id = e.skpd_id AND x.tahun = e.tahun AND x.no_bukti = e.no_bukti
                       AND x.tanggal = e.tanggal AND x.jenis = 'BELANJA' AND x.id < e.id ORDER BY x.id DESC LIMIT 1) b ON true
  LEFT JOIN bku_status s ON s.entry_id = b.id
 WHERE e.jenis = 'PAJAK_PUNGUT';

-- ---------- 2. Manajemen dokumen & bukti transaksi ----------
ALTER TABLE lampiran ADD COLUMN jenis_dokumen text NOT NULL DEFAULT 'bukti_transaksi'
  CHECK (jenis_dokumen IN ('bukti_transaksi','nota_kuitansi','bukti_transfer','sp2d','dokumen_pajak','pertanggungjawaban','lainnya'));
ALTER TABLE lampiran ADD COLUMN nomor_dokumen text;
ALTER TABLE lampiran ADD COLUMN tanggal_dokumen date;
ALTER TABLE lampiran ADD COLUMN dihapus_at timestamptz;
ALTER TABLE lampiran ADD COLUMN dihapus_oleh int REFERENCES users(id);
ALTER TABLE lampiran ADD COLUMN alasan_hapus text;
CREATE INDEX lampiran_skpd_aktif ON lampiran (skpd_id, bku_entry_id) WHERE dihapus_at IS NULL;

-- Berkas bukti tidak boleh dihapus permanen atau diganti isinya: penghapusan hanya menandai (soft delete)
CREATE OR REPLACE FUNCTION jaga_lampiran() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Lampiran bukti tidak dapat dihapus permanen; gunakan penandaan hapus' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.data IS DISTINCT FROM OLD.data OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.bku_entry_id IS DISTINCT FROM OLD.bku_entry_id THEN
    RAISE EXCEPTION 'Isi berkas bukti tidak dapat diubah; unggah berkas baru' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.dihapus_at IS NULL AND NEW.dihapus_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM bku_status s WHERE s.entry_id = OLD.bku_entry_id AND s.status = 'disetujui') THEN
    RAISE EXCEPTION 'Transaksi sudah disetujui: dokumen bukti terkunci dan tidak dapat dihapus' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER lampiran_jaga BEFORE UPDATE OR DELETE ON lampiran FOR EACH ROW EXECUTE FUNCTION jaga_lampiran();

-- Riwayat unggah/hapus/unduh dokumen (append-only)
CREATE TABLE lampiran_riwayat (
  id           bigserial PRIMARY KEY,
  lampiran_id  bigint REFERENCES lampiran(id),
  bku_entry_id bigint NOT NULL,
  skpd_id      int NOT NULL,
  aksi         text NOT NULL CHECK (aksi IN ('unggah','hapus','unduh')),
  nama_file    text,
  jenis_dokumen text,
  catatan      text,
  oleh         int REFERENCES users(id),
  ip           text,
  waktu        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lampiran_riwayat_skpd ON lampiran_riwayat (skpd_id, waktu DESC);
CREATE INDEX lampiran_riwayat_entry ON lampiran_riwayat (bku_entry_id);
CREATE TRIGGER lampiran_riwayat_immutable BEFORE UPDATE OR DELETE ON lampiran_riwayat FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
INSERT INTO lampiran_riwayat (lampiran_id, bku_entry_id, skpd_id, aksi, nama_file, jenis_dokumen, oleh, waktu)
SELECT id, bku_entry_id, skpd_id, 'unggah', nama_file, jenis_dokumen, uploaded_by, created_at FROM lampiran;

-- ---------- 3. Rekonsiliasi bank otomatis ----------
ALTER TABLE rekonsiliasi_bank ADD COLUMN status text NOT NULL DEFAULT 'final' CHECK (status IN ('draf','final'));
ALTER TABLE rekonsiliasi_bank ADD COLUMN nama_file text;
ALTER TABLE rekonsiliasi_bank ADD COLUMN saldo_bank numeric(18,2);
ALTER TABLE rekonsiliasi_bank ADD COLUMN saldo_bku numeric(18,2);
ALTER TABLE rekonsiliasi_bank ADD COLUMN hasil jsonb;
ALTER TABLE rekonsiliasi_bank ADD COLUMN difinalkan_oleh int REFERENCES users(id);
ALTER TABLE rekonsiliasi_bank ADD COLUMN difinalkan_at timestamptz;

-- ---------- 5. Akuntansi & jurnal ----------
-- Bagan akun (struktur Bagan Akun Standar pemda: 1 Aset, 2 Kewajiban, 3 Ekuitas, 4 Pendapatan-LRA,
-- 5 Belanja, 6 Pembiayaan, 7 Pendapatan-LO, 8 Beban)
CREATE TABLE akun (
  kode         text PRIMARY KEY,
  nama         text NOT NULL,
  kelompok     text NOT NULL CHECK (kelompok IN ('aset','kewajiban','ekuitas','pendapatan_lra','belanja','pembiayaan','pendapatan_lo','beban')),
  saldo_normal text NOT NULL CHECK (saldo_normal IN ('D','K')),
  basis        text NOT NULL CHECK (basis IN ('LO','LRA')),   -- LO = jurnal finansial (akrual), LRA = jurnal anggaran (kas)
  level        int  NOT NULL DEFAULT 6,
  induk        text,
  aktif        boolean NOT NULL DEFAULT true,
  keterangan   text
);

-- Pemetaan kode rekening anggaran ke akun (bila tidak diisi, sistem memakai pemetaan struktural BAS)
CREATE TABLE pemetaan_akun (
  kode_rekening text PRIMARY KEY REFERENCES rekening(kode),
  akun_lo       text REFERENCES akun(kode),
  akun_lra      text REFERENCES akun(kode),
  perlakuan     text CHECK (perlakuan IN ('beban','aset','persediaan','telaah')),
  catatan       text,
  diubah_oleh   int REFERENCES users(id),
  diubah_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jurnal (
  id             bigserial PRIMARY KEY,
  skpd_id        int  NOT NULL REFERENCES skpd(id),
  tahun          int  NOT NULL,
  nomor          text NOT NULL,
  tanggal        date NOT NULL,
  jenis          text NOT NULL CHECK (jenis IN ('otomatis','umum','penyesuaian','koreksi','balik')),
  sumber_bku_id  bigint,
  aturan         text,
  uraian         text NOT NULL,
  dasar          text,                    -- rujukan kebijakan/aturan perlakuan
  balik_dari     bigint REFERENCES jurnal(id),
  dibalik        boolean NOT NULL DEFAULT false,
  dibuat_oleh    int REFERENCES users(id),
  dibuat_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skpd_id, tahun, nomor)
);
CREATE UNIQUE INDEX jurnal_sumber_uq ON jurnal (sumber_bku_id) WHERE jenis = 'otomatis' AND NOT dibalik;
CREATE INDEX jurnal_periode ON jurnal (skpd_id, tahun, tanggal);

CREATE TABLE jurnal_rinci (
  id        bigserial PRIMARY KEY,
  jurnal_id bigint NOT NULL REFERENCES jurnal(id),
  urut      int  NOT NULL,
  basis     text NOT NULL CHECK (basis IN ('LO','LRA')),
  akun_kode text NOT NULL REFERENCES akun(kode),
  debit     numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  kredit    numeric(18,2) NOT NULL DEFAULT 0 CHECK (kredit >= 0),
  keterangan text,
  CHECK ((debit > 0 AND kredit = 0) OR (kredit > 0 AND debit = 0))
);
CREATE INDEX jurnal_rinci_jurnal ON jurnal_rinci (jurnal_id);
CREATE INDEX jurnal_rinci_akun ON jurnal_rinci (akun_kode);

-- Jurnal yang sudah diposting tidak dapat diubah; koreksi lewat jurnal balik
CREATE TRIGGER jurnal_rinci_immutable BEFORE UPDATE OR DELETE ON jurnal_rinci FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE OR REPLACE FUNCTION jaga_jurnal() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Jurnal tidak dapat dihapus; buat jurnal balik' USING ERRCODE = 'P0001'; END IF;
  IF (NEW.nomor, NEW.tanggal, NEW.uraian, NEW.skpd_id, NEW.jenis) IS DISTINCT FROM (OLD.nomor, OLD.tanggal, OLD.uraian, OLD.skpd_id, OLD.jenis)
     OR (OLD.dibalik AND NOT NEW.dibalik) THEN
    RAISE EXCEPTION 'Jurnal yang sudah diposting tidak dapat diubah' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER jurnal_jaga BEFORE UPDATE OR DELETE ON jurnal FOR EACH ROW EXECUTE FUNCTION jaga_jurnal();

-- Validasi keseimbangan: per jurnal dan per basis, total debit = total kredit (diperiksa saat commit)
CREATE OR REPLACE FUNCTION cek_seimbang() RETURNS trigger AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT basis, SUM(debit) AS d, SUM(kredit) AS k FROM jurnal_rinci WHERE jurnal_id = NEW.jurnal_id GROUP BY basis LOOP
    IF r.d <> r.k THEN
      RAISE EXCEPTION 'Jurnal % tidak seimbang pada basis % (debit %, kredit %)', NEW.jurnal_id, r.basis, r.d, r.k USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER jurnal_seimbang AFTER INSERT ON jurnal_rinci DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION cek_seimbang();

-- ---------- 6. Pusat notifikasi ----------
CREATE TABLE notifikasi (
  id        bigserial PRIMARY KEY,
  skpd_id   int REFERENCES skpd(id),
  user_id   int REFERENCES users(id) ON DELETE CASCADE,   -- penerima tertentu, atau
  peran     text[],                                       -- semua pengguna dengan peran ini (NULL = semua)
  kategori  text NOT NULL,
  tingkat   text NOT NULL CHECK (tingkat IN ('bahaya','peringatan','info','sukses')),
  judul     text NOT NULL,
  pesan     text,
  link      text,
  ref       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifikasi_waktu ON notifikasi (created_at DESC);
CREATE INDEX notifikasi_user ON notifikasi (user_id, created_at DESC);

-- Status baca per pengguna, untuk notifikasi tersimpan ('n:<id>') maupun notifikasi status ('pajak-2026-9-setor', dsb)
CREATE TABLE notifikasi_baca (
  user_id   int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kunci     text NOT NULL,
  dibaca_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kunci)
);

-- ---------- 7. Keamanan ----------
ALTER TABLE users ADD COLUMN gagal_login int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN gagal_terakhir timestamptz;
ALTER TABLE users ADD COLUMN terkunci_sampai timestamptz;
ALTER TABLE users ADD COLUMN password_diubah_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN wajib_ganti_password boolean NOT NULL DEFAULT false;

CREATE TABLE password_riwayat (
  id         bigserial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_riwayat_user ON password_riwayat (user_id, created_at DESC);

-- Sesi login: dasar session timeout (tidak aktif) dan pencabutan sesi oleh admin
CREATE TABLE sesi (
  id             text PRIMARY KEY,
  user_id        int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dibuat_at      timestamptz NOT NULL DEFAULT now(),
  terakhir_aktif timestamptz NOT NULL DEFAULT now(),
  kedaluwarsa_at timestamptz NOT NULL,
  ip             text,
  user_agent     text,
  dicabut_at     timestamptz,
  alasan_cabut   text
);
CREATE INDEX sesi_aktif ON sesi (user_id) WHERE dicabut_at IS NULL;

-- Jejak perubahan data master (nilai sebelum & sesudah), diisi trigger database
CREATE TABLE audit_data (
  id        bigserial PRIMARY KEY,
  tabel     text NOT NULL,
  aksi      text NOT NULL,
  kunci     text,
  sebelum   jsonb,
  sesudah   jsonb,
  user_id   int,
  username  text,
  waktu     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_data_waktu ON audit_data (waktu DESC);
CREATE INDEX audit_data_tabel ON audit_data (tabel, kunci);
CREATE TRIGGER audit_data_immutable BEFORE UPDATE OR DELETE ON audit_data FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION catat_audit_data() RETURNS trigger AS $$
DECLARE
  lama jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  baru jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  j jsonb := COALESCE(baru, lama);
  uid text := NULLIF(current_setting('bku.user_id', true), '');
BEGIN
  -- Saat pemulihan cadangan, isi audit_data ikut dipulihkan dari berkas: jangan menambah baris baru
  IF current_setting('bku.pulih', true) = 'on' THEN RETURN NULL; END IF;
  -- Jangan simpan rahasia di jejak audit
  -- Kolom operasional login (waktu login terakhir, hitungan gagal) tidak dianggap perubahan data
  lama := lama - 'password_hash' - 'last_login_at' - 'gagal_login' - 'gagal_terakhir';
  baru := baru - 'password_hash' - 'last_login_at' - 'gagal_login' - 'gagal_terakhir';
  IF TG_TABLE_NAME = 'pengaturan' AND j->>'kunci' IN ('smtp_pass','wa_token') THEN
    lama := jsonb_set(lama, '{nilai}', '"••••••"'::jsonb, false); baru := jsonb_set(baru, '{nilai}', '"••••••"'::jsonb, false);
  END IF;
  IF TG_OP = 'UPDATE' AND lama = baru THEN RETURN NEW; END IF;
  INSERT INTO audit_data (tabel, aksi, kunci, sebelum, sesudah, user_id, username)
  VALUES (TG_TABLE_NAME, TG_OP, COALESCE(j->>'id', j->>'kode', j->>'kunci', j->>'kode_rekening', j->>'username'),
          lama, baru, uid::int, NULLIF(current_setting('bku.username', true), ''));
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','skpd','rekening','rekanan','pegawai','anggaran','objek_pajak','pengaturan','unit_kerja',
                           'target_pendapatan','akun','pemetaan_akun','periode_kunci'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION catat_audit_data()', t || '_audit_data', t);
  END LOOP;
END $$;

-- Hasil uji pemulihan cadangan (restore ke skema sementara lalu dibandingkan)
CREATE TABLE uji_pemulihan (
  id          bigserial PRIMARY KEY,
  nama_file   text NOT NULL,
  mulai       timestamptz NOT NULL DEFAULT now(),
  durasi_ms   int,
  berhasil    boolean NOT NULL,
  tabel       int,
  baris       bigint,
  rincian     jsonb,
  galat       text,
  oleh        int REFERENCES users(id),
  pemicu      text NOT NULL DEFAULT 'manual'
);
