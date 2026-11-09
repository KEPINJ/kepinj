-- Tahap 7: QR Code aset (inventarisasi fisik) dan AI Assistant analisis perbendaharaan.

-- ---------- 1. Aset dengan QR Code ----------
-- Kartu aset sederhana (setara KIB) yang dapat ditautkan ke transaksi belanja modal di BKU.
CREATE TABLE aset (
  id               bigserial PRIMARY KEY,
  skpd_id          int  NOT NULL REFERENCES skpd(id),
  kode_barang      text NOT NULL,                 -- kode barang (mis. 1.3.02.06.02.0001 - peralatan komputer)
  nup              int  NOT NULL,                 -- nomor urut pendaftaran per kode barang
  nama             text NOT NULL,
  merk_tipe        text,
  spesifikasi      text,
  nomor_seri       text,
  tahun_perolehan  int  NOT NULL CHECK (tahun_perolehan BETWEEN 1950 AND 2100),
  tanggal_perolehan date,
  harga_perolehan  numeric(18,2) NOT NULL CHECK (harga_perolehan >= 0),
  sumber_dana      text,
  cara_perolehan   text NOT NULL DEFAULT 'pembelian' CHECK (cara_perolehan IN ('pembelian','hibah','transfer','lainnya')),
  lokasi           text,                          -- gedung / ruang
  penanggung_jawab text,
  kondisi          text NOT NULL DEFAULT 'B' CHECK (kondisi IN ('B','RR','RB')),   -- Baik, Rusak Ringan, Rusak Berat
  status           text NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','dipindahkan','diusulkan_hapus','dihapus')),
  kode_qr          text NOT NULL UNIQUE,          -- token acak di dalam QR (tidak dapat ditebak dari id)
  bku_entry_id     bigint,                        -- transaksi belanja modal asal (bila dibeli dari kas SKPD)
  keterangan       text,
  dibuat_oleh      int REFERENCES users(id),
  dibuat_at        timestamptz NOT NULL DEFAULT now(),
  diubah_at        timestamptz NOT NULL DEFAULT now(),
  terakhir_diperiksa timestamptz,
  UNIQUE (skpd_id, kode_barang, nup)
);
CREATE INDEX aset_skpd ON aset (skpd_id, status);
CREATE INDEX aset_bku ON aset (bku_entry_id);

-- Sesi inventarisasi (pemeriksaan fisik / stock opname aset)
CREATE TABLE inventarisasi (
  id              bigserial PRIMARY KEY,
  skpd_id         int  NOT NULL REFERENCES skpd(id),
  nama            text NOT NULL,
  tanggal_mulai   date NOT NULL DEFAULT current_date,
  tanggal_selesai date,
  status          text NOT NULL DEFAULT 'berjalan' CHECK (status IN ('berjalan','selesai')),
  catatan         text,
  dibuat_oleh     int REFERENCES users(id),
  dibuat_at       timestamptz NOT NULL DEFAULT now(),
  ringkasan       jsonb
);
CREATE UNIQUE INDEX inventarisasi_berjalan ON inventarisasi (skpd_id) WHERE status = 'berjalan';

-- Hasil pemindaian/pemeriksaan satu aset (append-only)
CREATE TABLE aset_pemeriksaan (
  id               bigserial PRIMARY KEY,
  aset_id          bigint NOT NULL REFERENCES aset(id),
  inventarisasi_id bigint REFERENCES inventarisasi(id),
  kondisi          text NOT NULL CHECK (kondisi IN ('B','RR','RB')),
  lokasi           text,
  sesuai_lokasi    boolean,
  catatan          text,
  cara             text NOT NULL DEFAULT 'qr' CHECK (cara IN ('qr','manual')),
  oleh             int REFERENCES users(id),
  waktu            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aset_pemeriksaan_aset ON aset_pemeriksaan (aset_id, waktu DESC);
CREATE INDEX aset_pemeriksaan_inv ON aset_pemeriksaan (inventarisasi_id);
CREATE TRIGGER aset_pemeriksaan_immutable BEFORE UPDATE OR DELETE ON aset_pemeriksaan FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Aset tidak dihapus fisik: penghapusan BMD melalui status (riwayat tetap ada)
CREATE OR REPLACE FUNCTION jaga_aset() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Data aset tidak dapat dihapus; ubah status menjadi diusulkan_hapus/dihapus';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER aset_no_delete BEFORE DELETE ON aset FOR EACH ROW EXECUTE FUNCTION jaga_aset();
CREATE TRIGGER aset_audit_data AFTER INSERT OR UPDATE OR DELETE ON aset FOR EACH ROW EXECUTE FUNCTION catat_audit_data();

-- ---------- 2. AI Assistant ----------
-- Log pertanyaan & jawaban asisten untuk akuntabilitas (siapa bertanya apa, data apa yang dibaca)
CREATE TABLE asisten_log (
  id          bigserial PRIMARY KEY,
  user_id     int REFERENCES users(id),
  skpd_id     int,
  tahun       int,
  pertanyaan  text NOT NULL,
  jawaban     text,
  alat        text[],                 -- fungsi data yang dipanggil
  mode        text NOT NULL,          -- 'claude' (model bahasa) atau 'lokal' (pencocokan maksud tanpa internet)
  durasi_ms   int,
  galat       text,
  waktu       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asisten_log_user ON asisten_log (user_id, waktu DESC);
