-- =====================================================================
--  Tahap 4: bendahara penerimaan (BKU penerimaan & STS), bendahara
--  pengeluaran pembantu (pelimpahan UP & SPJ), dan tutup tahun anggaran
-- =====================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','bendahara','verifikator','pimpinan','bendahara_penerimaan','bendahara_pembantu'));

-- Kepala rantai hash untuk buku-buku pembantu (BKU penerimaan per SKPD, BKU pembantu per unit kerja)
CREATE TABLE subledger_head (
  buku      text NOT NULL,
  lingkup   int  NOT NULL,
  tahun     int  NOT NULL,
  last_no   int  NOT NULL DEFAULT 0,
  last_hash text NOT NULL,
  PRIMARY KEY (buku, lingkup, tahun)
);

-- ---------- Bendahara penerimaan ----------
CREATE TABLE bkp_entries (
  id            bigserial PRIMARY KEY,
  skpd_id       int  NOT NULL REFERENCES skpd(id),
  tahun         int  NOT NULL,
  no_urut       int  NOT NULL,
  tanggal       date NOT NULL,
  no_bukti      text NOT NULL,
  jenis         text NOT NULL CHECK (jenis IN ('SALDO_AWAL','TERIMA','SETOR')),
  kode_rekening text REFERENCES rekening(kode),
  uraian        text NOT NULL,
  penerimaan    numeric(18,2) NOT NULL DEFAULT 0 CHECK (penerimaan >= 0),
  pengeluaran   numeric(18,2) NOT NULL DEFAULT 0 CHECK (pengeluaran >= 0),
  metode        text NOT NULL DEFAULT 'tunai' CHECK (metode IN ('bank','tunai')),
  penyetor      text,
  dasar         text,
  sts_id        int,
  created_by    int  NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL,
  prev_hash     text NOT NULL,
  hash          text NOT NULL,
  UNIQUE (skpd_id, tahun, no_urut)
);
CREATE INDEX bkp_tanggal ON bkp_entries (skpd_id, tanggal);
CREATE TRIGGER bkp_immutable BEFORE UPDATE OR DELETE ON bkp_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER bkp_periode_kunci BEFORE INSERT ON bkp_entries FOR EACH ROW EXECUTE FUNCTION cek_periode_kunci();

-- Surat Tanda Setoran ke rekening kas umum daerah
CREATE TABLE sts (
  id           serial PRIMARY KEY,
  skpd_id      int  NOT NULL REFERENCES skpd(id),
  tahun        int  NOT NULL,
  nomor        text NOT NULL,
  tanggal      date NOT NULL,
  bank         text,
  no_bukti_bank text,
  uraian       text,
  total        numeric(18,2) NOT NULL CHECK (total > 0),
  created_by   int REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skpd_id, tahun, nomor)
);
CREATE TABLE sts_rincian (
  bkp_entry_id  bigint PRIMARY KEY REFERENCES bkp_entries(id),
  sts_id        int NOT NULL REFERENCES sts(id),
  kode_rekening text,
  nilai         numeric(18,2) NOT NULL
);
CREATE INDEX sts_rincian_sts ON sts_rincian (sts_id);

-- Target pendapatan per rekening (dipisah dari pagu belanja)
CREATE TABLE target_pendapatan (
  skpd_id       int  NOT NULL REFERENCES skpd(id),
  tahun         int  NOT NULL,
  kode_rekening text NOT NULL REFERENCES rekening(kode),
  target        numeric(18,2) NOT NULL CHECK (target >= 0),
  PRIMARY KEY (skpd_id, tahun, kode_rekening)
);

-- ---------- Bendahara pengeluaran pembantu ----------
CREATE TABLE unit_kerja (
  id             serial PRIMARY KEY,
  skpd_id        int  NOT NULL REFERENCES skpd(id),
  kode           text NOT NULL,
  nama           text NOT NULL,
  bendahara_nama text,
  bendahara_nip  text,
  aktif          boolean NOT NULL DEFAULT true,
  UNIQUE (skpd_id, kode)
);
ALTER TABLE users ADD COLUMN unit_id int REFERENCES unit_kerja(id);

CREATE TABLE bpp_entries (
  id            bigserial PRIMARY KEY,
  skpd_id       int  NOT NULL REFERENCES skpd(id),
  unit_id       int  NOT NULL REFERENCES unit_kerja(id),
  tahun         int  NOT NULL,
  no_urut       int  NOT NULL,
  tanggal       date NOT NULL,
  no_bukti      text NOT NULL,
  jenis         text NOT NULL CHECK (jenis IN ('PELIMPAHAN','BELANJA','PAJAK_PUNGUT','SERAH_PAJAK','PENGEMBALIAN')),
  kode_rekening text REFERENCES rekening(kode),
  rekanan_id    int REFERENCES rekanan(id),
  uraian        text NOT NULL,
  penerimaan    numeric(18,2) NOT NULL DEFAULT 0 CHECK (penerimaan >= 0),
  pengeluaran   numeric(18,2) NOT NULL DEFAULT 0 CHECK (pengeluaran >= 0),
  metode        text NOT NULL DEFAULT 'tunai' CHECK (metode IN ('bank','tunai')),
  pajak         jsonb NOT NULL DEFAULT '[]'::jsonb,
  induk_id      bigint,
  bku_ref       bigint,
  created_by    int  NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL,
  prev_hash     text NOT NULL,
  hash          text NOT NULL,
  UNIQUE (unit_id, tahun, no_urut)
);
CREATE INDEX bpp_unit_tanggal ON bpp_entries (unit_id, tanggal);
CREATE TRIGGER bpp_immutable BEFORE UPDATE OR DELETE ON bpp_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER bpp_periode_kunci BEFORE INSERT ON bpp_entries FOR EACH ROW EXECUTE FUNCTION cek_periode_kunci();

CREATE TABLE spj_pembantu (
  id            serial PRIMARY KEY,
  skpd_id       int  NOT NULL REFERENCES skpd(id),
  unit_id       int  NOT NULL REFERENCES unit_kerja(id),
  tahun         int  NOT NULL,
  nomor         text NOT NULL,
  tanggal       date NOT NULL,
  sampai        date NOT NULL,
  total_belanja numeric(18,2) NOT NULL,
  total_pajak   numeric(18,2) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'diajukan' CHECK (status IN ('diajukan','disahkan','ditolak')),
  catatan       text,
  bku_entry_ids bigint[] NOT NULL DEFAULT '{}',
  diajukan_oleh int REFERENCES users(id),
  diajukan_at   timestamptz NOT NULL DEFAULT now(),
  diproses_oleh int REFERENCES users(id),
  diproses_at   timestamptz,
  UNIQUE (unit_id, tahun, nomor)
);
CREATE TABLE spj_pembantu_rincian (
  bpp_entry_id bigint PRIMARY KEY REFERENCES bpp_entries(id),
  spj_id       int NOT NULL REFERENCES spj_pembantu(id)
);
CREATE INDEX spj_pembantu_rincian_spj ON spj_pembantu_rincian (spj_id);

-- ---------- Tutup tahun anggaran ----------
CREATE TABLE tutup_tahun (
  skpd_id        int NOT NULL REFERENCES skpd(id),
  tahun          int NOT NULL,
  ringkasan      jsonb NOT NULL,
  saldo_awal_ids bigint[] NOT NULL DEFAULT '{}',
  ditutup_oleh   int REFERENCES users(id),
  ditutup_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (skpd_id, tahun)
);
