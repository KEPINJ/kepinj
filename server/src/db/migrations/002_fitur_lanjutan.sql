-- =====================================================================
--  Fitur lanjutan: tutup buku, pengaturan, SPP-SPM-SP2D, panjar,
--  lampiran bukti, rekonsiliasi tersimpan, verifikasi dokumen (QR)
-- =====================================================================

-- Pengaturan aplikasi (ambang peringatan, batas kas tunai, dsb)
CREATE TABLE pengaturan (
  kunci      text PRIMARY KEY,
  nilai      jsonb NOT NULL,
  keterangan text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pengaturan (kunci, nilai, keterangan) VALUES
  ('batas_kas_tunai', '50000000', 'Batas saldo kas tunai harian di brankas bendahara (Rp)'),
  ('batas_transaksi_tunai', '10000000', 'Transaksi tunai di atas nilai ini ditandai (Rp)'),
  ('ambang_pagu_persen', '90', 'Peringatan bila realisasi rekening mencapai persentase pagu ini'),
  ('ambang_gu_persen', '50', 'Sarankan pengajuan GU bila belanja UP terpakai mencapai persentase ini'),
  ('batas_hari_panjar', '14', 'Panjar wajib dipertanggungjawabkan dalam jumlah hari ini');

-- Tutup buku per bulan: transaksi pada bulan yang dikunci ditolak database
CREATE TABLE periode_kunci (
  skpd_id      int  NOT NULL REFERENCES skpd(id),
  tahun        int  NOT NULL,
  bulan        int  NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  ringkasan    jsonb NOT NULL DEFAULT '{}'::jsonb,
  catatan      text,
  dikunci_oleh int REFERENCES users(id),
  dikunci_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (skpd_id, tahun, bulan)
);

CREATE OR REPLACE FUNCTION cek_periode_kunci() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM periode_kunci WHERE skpd_id = NEW.skpd_id
              AND tahun = EXTRACT(YEAR FROM NEW.tanggal)::int AND bulan = EXTRACT(MONTH FROM NEW.tanggal)::int) THEN
    RAISE EXCEPTION 'Periode %/% sudah ditutup buku; transaksi tidak dapat ditambahkan pada bulan tersebut',
      EXTRACT(MONTH FROM NEW.tanggal)::int, EXTRACT(YEAR FROM NEW.tanggal)::int USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER bku_periode_kunci BEFORE INSERT ON bku_entries
  FOR EACH ROW EXECUTE FUNCTION cek_periode_kunci();

-- Pengajuan SPP -> SPM -> SP2D
CREATE TABLE spp (
  id            serial PRIMARY KEY,
  skpd_id       int  NOT NULL REFERENCES skpd(id),
  tahun         int  NOT NULL,
  jenis         text NOT NULL CHECK (jenis IN ('UP','GU','TU','LS_GAJI','LS_BARANG')),
  nomor_spp     text NOT NULL,
  tanggal_spp   date NOT NULL,
  uraian        text NOT NULL,
  nilai         numeric(18,2) NOT NULL CHECK (nilai > 0),
  kode_rekening text REFERENCES rekening(kode),
  rekanan_id    int REFERENCES rekanan(id),
  status        text NOT NULL DEFAULT 'spp' CHECK (status IN ('spp','spm','sp2d','ditolak')),
  nomor_spm     text,
  tanggal_spm   date,
  nomor_sp2d    text,
  tanggal_sp2d  date,
  catatan       text,
  bku_entry_ids bigint[] NOT NULL DEFAULT '{}',
  created_by    int REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spp_skpd_tahun ON spp (skpd_id, tahun, status);
CREATE UNIQUE INDEX spp_nomor_uq ON spp (skpd_id, tahun, nomor_spp);

-- Panjar (uang muka kegiatan) kepada PPTK / pelaksana
CREATE TABLE panjar (
  id               serial PRIMARY KEY,
  skpd_id          int  NOT NULL REFERENCES skpd(id),
  tahun            int  NOT NULL,
  nomor            text NOT NULL,
  tanggal          date NOT NULL,
  pegawai_id       int REFERENCES pegawai(id),
  penerima_nama    text NOT NULL,
  kegiatan         text NOT NULL,
  kode_rekening    text REFERENCES rekening(kode),
  nilai            numeric(18,2) NOT NULL CHECK (nilai > 0),
  metode           text NOT NULL DEFAULT 'tunai' CHECK (metode IN ('bank','tunai')),
  batas_tanggal    date NOT NULL,
  status           text NOT NULL DEFAULT 'berjalan' CHECK (status IN ('berjalan','selesai')),
  tanggal_selesai  date,
  realisasi        numeric(18,2),
  sisa_kembali     numeric(18,2),
  bku_entry_ids    bigint[] NOT NULL DEFAULT '{}',
  catatan          text,
  created_by       int REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX panjar_skpd_tahun ON panjar (skpd_id, tahun, status);
CREATE UNIQUE INDEX panjar_nomor_uq ON panjar (skpd_id, tahun, nomor);

-- Lampiran bukti digital per transaksi BKU (foto nota, kuitansi, faktur PDF)
CREATE TABLE lampiran (
  id           bigserial PRIMARY KEY,
  bku_entry_id bigint NOT NULL,
  skpd_id      int NOT NULL REFERENCES skpd(id),
  nama_file    text NOT NULL,
  mime         text NOT NULL,
  ukuran       int  NOT NULL,
  sha256       text NOT NULL,
  data         bytea NOT NULL,
  keterangan   text,
  uploaded_by  int REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lampiran_entry ON lampiran (bku_entry_id);

-- Hasil rekonsiliasi bank yang disimpan
CREATE TABLE rekonsiliasi_bank (
  id          serial PRIMARY KEY,
  skpd_id     int NOT NULL REFERENCES skpd(id),
  dari        date NOT NULL,
  sampai      date NOT NULL,
  ringkasan   jsonb NOT NULL,
  pasangan    jsonb NOT NULL DEFAULT '[]'::jsonb,
  catatan     text,
  created_by  int REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Dokumen cetak yang dapat diverifikasi lewat QR code
CREATE TABLE dokumen_verifikasi (
  kode        text PRIMARY KEY,
  jenis       text NOT NULL,
  skpd_id     int NOT NULL REFERENCES skpd(id),
  judul       text NOT NULL,
  parameter   jsonb NOT NULL DEFAULT '{}'::jsonb,
  sidik       text NOT NULL,
  ringkasan   jsonb NOT NULL DEFAULT '{}'::jsonb,
  dibuat_oleh int REFERENCES users(id),
  dibuat_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dokumen_verifikasi_skpd ON dokumen_verifikasi (skpd_id, dibuat_at DESC);
