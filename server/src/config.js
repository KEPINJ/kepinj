export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgres://bku:bku@localhost:5432/bku',
  jwtSecret: process.env.JWT_SECRET || 'ganti-secret-ini-di-produksi',
  // Kosongkan KAFKA_BROKERS untuk memakai bus event internal (mode single-node)
  kafkaBrokers: (process.env.KAFKA_BROKERS || '').split(',').map((s) => s.trim()).filter(Boolean),
  kafkaTopic: process.env.KAFKA_TOPIC || 'bku.events',
  webDist: process.env.WEB_DIST || new URL('../../web/dist', import.meta.url).pathname,
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50),
  isProd: process.env.NODE_ENV === 'production',
  // Folder berkas cadangan basis data (sebaiknya di luar folder publik dan ikut dicadangkan ke media lain)
  backupDir: process.env.BACKUP_DIR || new URL('../backups', import.meta.url).pathname,
  // Matikan penjadwal (pengingat & pencadangan otomatis), mis. saat menjalankan beberapa instans
  scheduler: process.env.SCHEDULER !== 'off',
};
