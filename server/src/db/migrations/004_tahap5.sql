-- =====================================================================
--  Tahap 5: anggaran kas & perubahan anggaran, persetujuan berjenjang,
--  pengingat WhatsApp/email, transfer massal CMS bank, pencadangan
-- =====================================================================

-- ---------- Anggaran kas & APBD Perubahan ----------
ALTER TABLE anggaran ADD COLUMN pagu_murni numeric(18,2);
UPDATE anggaran SET pagu_murni = pagu;
CREATE OR REPLACE FUNCTION isi_pagu_murni() RETURNS trigger AS $$
BEGIN
  NEW.pagu_murni := COALESCE(NEW.pagu_murni, NEW.pagu);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER anggaran_pagu_murni BEFORE INSERT ON anggaran FOR EACH ROW EXECUTE FUNCTION isi_pagu_murni();

-- Rencana penarikan dana per bulan (dasar SPD) per kode rekening
CREATE TABLE anggaran_kas (
  skpd_id       int  NOT NULL REFERENCES skpd(id),
  tahun         int  NOT NULL,
  kode_rekening text NOT NULL REFERENCES rekening(kode),
  bulan         int  NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  nilai         numeric(18,2) NOT NULL DEFAULT 0 CHECK (nilai >= 0),
  PRIMARY KEY (skpd_id, tahun, kode_rekening, bulan)
);

-- Pergeseran (total tetap) atau perubahan APBD (total berubah)
CREATE TABLE perubahan_anggaran (
  id              serial PRIMARY KEY,
  skpd_id         int  NOT NULL REFERENCES skpd(id),
  tahun           int  NOT NULL,
  nomor           text NOT NULL,
  jenis           text NOT NULL CHECK (jenis IN ('pergeseran','perubahan')),
  tanggal         date NOT NULL,
  dasar           text,
  uraian          text,
  rincian         jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ditetapkan')),
  created_by      int REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  ditetapkan_oleh int REFERENCES users(id),
  ditetapkan_at   timestamptz,
  UNIQUE (skpd_id, tahun, nomor)
);

-- ---------- Persetujuan berjenjang (SPP & SPJ) ----------
CREATE TABLE persetujuan (
  id         bigserial PRIMARY KEY,
  objek      text NOT NULL CHECK (objek IN ('spp','spj')),
  objek_id   text NOT NULL,
  skpd_id    int  NOT NULL REFERENCES skpd(id),
  tahun      int  NOT NULL,
  putaran    int  NOT NULL DEFAULT 1,
  urutan     int  NOT NULL,
  peran      text NOT NULL,
  label      text NOT NULL,
  status     text NOT NULL CHECK (status IN ('antre','menunggu','setuju','tolak','batal')),
  catatan    text,
  oleh       int REFERENCES users(id),
  waktu      timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (objek, objek_id, putaran, urutan)
);
CREATE INDEX persetujuan_menunggu ON persetujuan (skpd_id, status, peran);

-- ---------- Pengingat WhatsApp / email ----------
ALTER TABLE users ADD COLUMN email text;
ALTER TABLE users ADD COLUMN no_wa text;
ALTER TABLE users ADD COLUMN pengingat jsonb NOT NULL DEFAULT '{"email": true, "wa": true}'::jsonb;

CREATE TABLE pengingat_log (
  id         bigserial PRIMARY KEY,
  user_id    int REFERENCES users(id) ON DELETE SET NULL,
  kanal      text NOT NULL CHECK (kanal IN ('email','wa')),
  tujuan     text NOT NULL,
  judul      text NOT NULL,
  isi        text NOT NULL,
  status     text NOT NULL CHECK (status IN ('terkirim','gagal','simulasi')),
  galat      text,
  pemicu     text NOT NULL DEFAULT 'jadwal',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pengingat_log_waktu ON pengingat_log (created_at DESC);

-- ---------- Transfer massal CMS bank ----------
ALTER TABLE skpd ADD COLUMN rekening_bendahara text;
ALTER TABLE skpd ADD COLUMN bank_bendahara text;

CREATE TABLE transfer_batch (
  id          serial PRIMARY KEY,
  skpd_id     int  NOT NULL REFERENCES skpd(id),
  tahun       int  NOT NULL,
  nomor       text NOT NULL,
  tanggal     date NOT NULL,
  format      text NOT NULL,
  rekening_sumber text,
  total       numeric(18,2) NOT NULL,
  jumlah      int  NOT NULL,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','dikirim','selesai','batal')),
  catatan     text,
  created_by  int REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  diunduh_at  timestamptz,
  UNIQUE (skpd_id, tahun, nomor)
);
CREATE TABLE transfer_item (
  id           bigserial PRIMARY KEY,
  batch_id     int NOT NULL REFERENCES transfer_batch(id) ON DELETE CASCADE,
  bku_entry_id bigint NOT NULL,
  rekanan_id   int REFERENCES rekanan(id),
  nama         text NOT NULL,
  bank         text,
  kode_bank    text,
  no_rekening  text NOT NULL,
  bruto        numeric(18,2) NOT NULL,
  potongan     numeric(18,2) NOT NULL DEFAULT 0,
  nilai        numeric(18,2) NOT NULL CHECK (nilai > 0),
  berita       text,
  status       text NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu','berhasil','gagal')),
  keterangan   text
);
CREATE INDEX transfer_item_entry ON transfer_item (bku_entry_id);
