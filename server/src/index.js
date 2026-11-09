import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './db/migrate.js';
import { ensureAdmin } from './db/bootstrap.js';
import { authPlugin, authRoutes } from './auth.js';
import { startEventPipeline } from './events/bus.js';
import bkuRoutes from './routes/bku.js';
import pajakRoutes from './routes/pajak.js';
import dataRoutes from './routes/data.js';
import laporanRoutes from './routes/laporan.js';
import masterRoutes from './routes/master.js';
import systemRoutes from './routes/system.js';
import tutupBukuRoutes from './routes/tutupbuku.js';
import pengingatRoutes from './routes/pengingat.js';
import spjRoutes from './routes/spj.js';
import anomaliRoutes from './routes/anomali.js';
import sppRoutes from './routes/spp.js';
import panjarRoutes from './routes/panjar.js';
import lampiranRoutes from './routes/lampiran.js';
import dokumenRoutes from './routes/dokumen.js';
import pimpinanRoutes from './routes/pimpinan.js';
import penerimaanRoutes from './routes/penerimaan.js';
import pembantuRoutes from './routes/pembantu.js';
import tutupTahunRoutes from './routes/tutuptahun.js';
import anggaranKasRoutes from './routes/anggarankas.js';
import persetujuanRoutes from './routes/persetujuan.js';
import pengingatLuarRoutes, { mulaiPenjadwal } from './routes/pengingatluar.js';
import transferRoutes from './routes/transfer.js';
import cadanganRoutes from './routes/cadangan.js';
import rekonsiliasiRoutes from './routes/rekonsiliasi.js';
import monitoringRoutes from './routes/monitoring.js';
import akuntansiRoutes from './routes/akuntansi.js';
import notifikasiRoutes from './routes/notifikasi.js';
import keamananRoutes from './routes/keamanan.js';
import asetRoutes from './routes/aset.js';
import asistenRoutes from './routes/asisten.js';

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: 20 * 1024 * 1024, trustProxy: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });
  authPlugin(app);

  // Batas percobaan login sederhana per IP
  const attempts = new Map();
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST' || req.url !== '/api/auth/login') return;
    const now = Date.now();
    const a = (attempts.get(req.ip) || []).filter((t) => now - t < 60_000);
    a.push(now);
    attempts.set(req.ip, a);
    if (a.length > 10) reply.code(429).send({ error: 'Terlalu banyak percobaan login, coba lagi 1 menit lagi' });
  });

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode || (err.code === 'P0001' ? 409 : err.code === '23505' ? 409 : err.code === '23503' ? 400 : 500);
    if (status >= 500) req.log.error(err);
    const message = err.code === '23505' ? 'Data dengan kunci yang sama sudah ada'
      : err.code === '23503' ? 'Referensi data tidak ditemukan (periksa kode/ID yang dipilih)'
      : status >= 500 ? 'Terjadi kesalahan pada server' : err.message;
    reply.code(status).send({ error: message, masalah: err.masalah, log: err.log, alasan: err.alasan });
  });

  authRoutes(app);
  for (const r of [bkuRoutes, pajakRoutes, dataRoutes, laporanRoutes, masterRoutes, systemRoutes, tutupBukuRoutes, pengingatRoutes, spjRoutes, anomaliRoutes,
    sppRoutes, panjarRoutes, lampiranRoutes, dokumenRoutes, pimpinanRoutes, penerimaanRoutes, pembantuRoutes, tutupTahunRoutes,
    anggaranKasRoutes, persetujuanRoutes, pengingatLuarRoutes, transferRoutes, cadanganRoutes, rekonsiliasiRoutes, monitoringRoutes, akuntansiRoutes, notifikasiRoutes, keamananRoutes, asetRoutes, asistenRoutes]) await app.register(r);

  if (existsSync(config.webDist)) {
    await app.register(fstatic, { root: config.webDist });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Endpoint tidak ditemukan' }) : reply.sendFile('index.html')));
  }
  return app;
}

/** Jalankan server (dipakai `node src/index.js` dan titik masuk cPanel `app.cjs`). */
export async function start() {
  if (config.isProd && (config.jwtSecret.length < 32 || config.jwtSecret.startsWith('ganti'))) {
    console.error('JWT_SECRET wajib diisi string acak minimal 32 karakter di produksi');
    process.exit(1);
  }
  await migrate();
  const app = await buildApp();
  await ensureAdmin(app.log);
  const stopEvents = await startEventPipeline(app.log);
  if (typeof globalThis.PhusionPassenger !== 'undefined' || typeof globalThis.LsNode !== 'undefined') {
    // Hosting cPanel (Phusion Passenger / LiteSpeed lsnode): socket diatur web server
    await app.ready();
    app.server.listen(typeof globalThis.PhusionPassenger !== 'undefined' ? 'passenger' : config.port);
  } else {
    await app.listen({ port: config.port, host: config.host });
  }
  const stopJadwal = config.scheduler ? mulaiPenjadwal(app.log) : () => {};
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    stopJadwal();
    await app.close();
    await stopEvents();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) await start();
