-- =====================================================================
--  BKU BKAD - skema inti
--  PostgreSQL sebagai sumber kebenaran (ACID), tabel transaksi
--  dipartisi per tahun anggaran agar tetap cepat pada volume besar.
-- =====================================================================

CREATE TABLE skpd (
  id             serial PRIMARY KEY,
  kode           text NOT NULL UNIQUE,
  nama           text NOT NULL,
  alamat         text,
  npwp           text,
  nitku          text,
  kepala_nama    text,
  kepala_nip     text,
  bendahara_nama text,
  bendahara_nip  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            serial PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  full_name     text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin','bendahara','verifikator','pimpinan')),
  skpd_id       int REFERENCES skpd(id),
  active        boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rekening (
  kode   text PRIMARY KEY,
  nama   text NOT NULL,
  jenis  text NOT NULL CHECK (jenis IN ('pendapatan','belanja','pembiayaan','non_anggaran')),
  level  int  NOT NULL DEFAULT 6,
  parent text
);

CREATE TABLE rekanan (
  id          serial PRIMARY KEY,
  nama        text NOT NULL,
  jenis       text NOT NULL DEFAULT 'badan' CHECK (jenis IN ('badan','orang_pribadi')),
  npwp        text,
  nik         text,
  nitku       text,
  alamat      text,
  bank        text,
  no_rekening text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pegawai (
  id          serial PRIMARY KEY,
  skpd_id     int REFERENCES skpd(id),
  nip         text,
  nama        text NOT NULL,
  nik         text,
  npwp        text,
  status_ptkp text NOT NULL DEFAULT 'TK/0',
  golongan    text,
  jabatan     text,
  jenis       text NOT NULL DEFAULT 'pns' CHECK (jenis IN ('pns','pppk','non_asn')),
  aktif       boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX pegawai_nip_uq ON pegawai (nip) WHERE nip IS NOT NULL;

-- Referensi kode objek pajak (dapat diubah admin bila DJP memperbarui kode)
CREATE TABLE objek_pajak (
  kode         text PRIMARY KEY,
  jenis_pajak  text NOT NULL CHECK (jenis_pajak IN ('PPH21','PPH22','PPH23','PPH4A2','PPN')),
  nama         text NOT NULL,
  tarif        numeric(7,4) NOT NULL DEFAULT 0,
  dpp_persen   numeric(7,4) NOT NULL DEFAULT 100,
  coretax_form text NOT NULL CHECK (coretax_form IN ('BPPU','BP21','BPMP','PPN')),
  keterangan   text,
  aktif        boolean NOT NULL DEFAULT true
);

CREATE TABLE anggaran (
  id            serial PRIMARY KEY,
  skpd_id       int NOT NULL REFERENCES skpd(id),
  tahun         int NOT NULL,
  kode_rekening text NOT NULL REFERENCES rekening(kode),
  pagu          numeric(18,2) NOT NULL CHECK (pagu >= 0),
  UNIQUE (skpd_id, tahun, kode_rekening)
);

-- Kepala rantai hash per SKPD per tahun: mengunci penomoran agar berurutan
CREATE TABLE bku_chain_head (
  skpd_id   int NOT NULL REFERENCES skpd(id),
  tahun     int NOT NULL,
  last_no   int NOT NULL DEFAULT 0,
  last_hash text NOT NULL,
  PRIMARY KEY (skpd_id, tahun)
);

-- Buku Kas Umum: append-only, dipartisi per tahun
CREATE TABLE bku_entries (
  id             bigserial,
  skpd_id        int  NOT NULL REFERENCES skpd(id),
  tahun          int  NOT NULL,
  no_urut        int  NOT NULL,
  tanggal        date NOT NULL,
  no_bukti       text NOT NULL,
  jenis          text NOT NULL CHECK (jenis IN ('SALDO_AWAL','SP2D_UP','SP2D_GU','SP2D_TU','SP2D_LS','BELANJA','PAJAK_PUNGUT','PAJAK_SETOR','PENERIMAAN','PENYETORAN','PELIMPAHAN','KOREKSI','LAINNYA')),
  kode_rekening  text REFERENCES rekening(kode),
  uraian         text NOT NULL,
  penerimaan     numeric(18,2) NOT NULL DEFAULT 0 CHECK (penerimaan >= 0),
  pengeluaran    numeric(18,2) NOT NULL DEFAULT 0 CHECK (pengeluaran >= 0),
  metode         text NOT NULL DEFAULT 'bank' CHECK (metode IN ('bank','tunai')),
  rekanan_id     int REFERENCES rekanan(id),
  koreksi_of     bigint,
  import_batch   text,
  created_by     int NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL,
  prev_hash      text NOT NULL,
  hash           text NOT NULL,
  CHECK (penerimaan > 0 OR pengeluaran > 0 OR jenis = 'SALDO_AWAL'),
  PRIMARY KEY (id, tanggal)
) PARTITION BY RANGE (tanggal);

DO $$
DECLARE y int;
BEGIN
  FOR y IN 2023..2032 LOOP
    EXECUTE format('CREATE TABLE bku_entries_%s PARTITION OF bku_entries FOR VALUES FROM (%L) TO (%L)',
                   y, make_date(y,1,1), make_date(y+1,1,1));
  END LOOP;
END $$;
CREATE TABLE bku_entries_default PARTITION OF bku_entries DEFAULT;

CREATE INDEX bku_skpd_tahun_no ON bku_entries (skpd_id, tahun, no_urut);
CREATE INDEX bku_tanggal_brin  ON bku_entries USING brin (tanggal);
CREATE INDEX bku_rekening      ON bku_entries (kode_rekening);
CREATE INDEX bku_no_bukti      ON bku_entries (no_bukti);

-- Catatan BKU tidak boleh diubah/dihapus. Koreksi dilakukan dengan jurnal balik.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabel % bersifat append-only; gunakan entri koreksi', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER bku_immutable BEFORE UPDATE OR DELETE ON bku_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE bku_verifications (
  id          bigserial PRIMARY KEY,
  entry_id    bigint NOT NULL,
  status      text NOT NULL CHECK (status IN ('diverifikasi','ditolak')),
  catatan     text,
  verified_by int NOT NULL REFERENCES users(id),
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bku_verif_entry ON bku_verifications (entry_id, verified_at DESC);

CREATE TABLE pajak (
  id                    bigserial PRIMARY KEY,
  skpd_id               int NOT NULL REFERENCES skpd(id),
  bku_entry_id          bigint,
  tahun                 int NOT NULL,
  masa                  int NOT NULL CHECK (masa BETWEEN 1 AND 12),
  jenis_pajak           text NOT NULL CHECK (jenis_pajak IN ('PPH21','PPH22','PPH23','PPH4A2','PPN')),
  kode_objek            text REFERENCES objek_pajak(kode),
  penerima_nama         text NOT NULL,
  penerima_npwp         text,
  penerima_nik          text,
  penerima_nitku        text,
  status_ptkp           text,
  dokumen_jenis         text,
  dokumen_nomor         text,
  dokumen_tanggal       date,
  dpp                   numeric(18,2) NOT NULL DEFAULT 0,
  tarif                 numeric(7,4)  NOT NULL DEFAULT 0,
  nominal               numeric(18,2) NOT NULL DEFAULT 0,
  ditanggung_pemerintah boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'dipungut' CHECK (status IN ('dipungut','disetor','dilaporkan')),
  id_billing            text,
  ntpn                  text,
  tanggal_setor         date,
  no_bukti_potong       text,
  keterangan            text,
  detail                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by            int REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pajak_masa ON pajak (skpd_id, tahun, masa, jenis_pajak);

-- Data hasil upload (untuk pengolahan otomatis)
CREATE TABLE datasets (
  id         bigserial PRIMARY KEY,
  nama       text NOT NULL,
  file_name  text,
  columns    jsonb NOT NULL,
  row_count  int NOT NULL DEFAULT 0,
  created_by int REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dataset_rows (
  dataset_id bigint NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_no     int NOT NULL,
  data       jsonb NOT NULL,
  PRIMARY KEY (dataset_id, row_no)
);

CREATE TABLE pipelines (
  id         serial PRIMARY KEY,
  nama       text NOT NULL,
  deskripsi  text,
  config     jsonb NOT NULL,
  created_by int REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE penutupan_kas (
  id          serial PRIMARY KEY,
  skpd_id     int NOT NULL REFERENCES skpd(id),
  tanggal     date NOT NULL,
  saldo_bku   numeric(18,2) NOT NULL,
  saldo_bank  numeric(18,2) NOT NULL DEFAULT 0,
  kas_tunai   numeric(18,2) NOT NULL DEFAULT 0,
  denominasi  jsonb NOT NULL DEFAULT '{}'::jsonb,
  selisih     numeric(18,2) NOT NULL DEFAULT 0,
  keterangan  text,
  created_by  int REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox: setiap perubahan ditulis di transaksi yang sama,
-- lalu relay meneruskannya ke Kafka (atau bus internal).
CREATE TABLE outbox (
  id           bigserial PRIMARY KEY,
  topic        text NOT NULL,
  key          text,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION outbox_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('outbox', NEW.id::text);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER outbox_after_insert AFTER INSERT ON outbox
  FOR EACH ROW EXECUTE FUNCTION outbox_notify();

-- Proyeksi ringkasan harian (diisi oleh consumer event stream)
CREATE TABLE daily_summary (
  skpd_id          int  NOT NULL,
  tanggal          date NOT NULL,
  penerimaan       numeric(18,2) NOT NULL DEFAULT 0,
  pengeluaran      numeric(18,2) NOT NULL DEFAULT 0,
  jumlah_transaksi int NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (skpd_id, tanggal)
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    int,
  username   text,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  detail     jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created ON audit_log (created_at DESC);
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
