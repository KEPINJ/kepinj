import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './db/migrate.js';
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
    reply.code(status).send({ error: message, masalah: err.masalah, log: err.log });
  });

  authRoutes(app);
  for (const r of [bkuRoutes, pajakRoutes, dataRoutes, laporanRoutes, masterRoutes, systemRoutes, tutupBukuRoutes, pengingatRoutes, spjRoutes, anomaliRoutes]) await app.register(r);

  if (existsSync(config.webDist)) {
    await app.register(fstatic, { root: config.webDist });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Endpoint tidak ditemukan' }) : reply.sendFile('index.html')));
  }
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (config.isProd && (config.jwtSecret.length < 32 || config.jwtSecret.startsWith('ganti'))) {
    console.error('JWT_SECRET wajib diisi string acak minimal 32 karakter di produksi');
    process.exit(1);
  }
  await migrate();
  const app = await buildApp();
  const stopEvents = await startEventPipeline(app.log);
  await app.listen({ port: config.port, host: config.host });
  const shutdown = async () => {
    await app.close();
    await stopEvents();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
