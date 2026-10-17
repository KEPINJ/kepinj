// =====================================================================
//  Event pipeline: Postgres outbox -> Kafka -> consumer (realtime & proyeksi)
//  Bila KAFKA_BROKERS kosong, event dialirkan lewat bus internal sehingga
//  aplikasi tetap berjalan single-node tanpa Kafka.
// =====================================================================
import os from 'node:os';
import pg from 'pg';
import { Kafka, logLevel } from 'kafkajs';
import { config } from '../config.js';
import { pool } from '../db.js';

const sseClients = new Set();
const state = { mode: config.kafkaBrokers.length ? 'kafka' : 'memory', connected: false, published: 0, consumed: 0, lastError: null, lastEventAt: null };
let producer;
let draining = false;
let pending = false;
let log = console;

export function eventStatus() {
  return { ...state, sseClients: sseClients.size, topic: state.mode === 'kafka' ? config.kafkaTopic : null };
}

export function addSseClient(client) {
  sseClients.add(client);
  return () => sseClients.delete(client);
}

function broadcast(evt) {
  const line = `id: ${evt.id}\nevent: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
  for (const c of sseClients) {
    if (c.filter && !c.filter(evt)) continue;
    try { c.write(line); } catch { sseClients.delete(c); }
  }
}

/** Proyeksi idempoten: hitung ulang ringkasan harian dari sumber kebenaran. */
async function project(evt) {
  if (evt.type !== 'bku.entry.created') return;
  const { skpd_id: skpd, tanggal } = evt.data;
  await pool.query(`
    INSERT INTO daily_summary (skpd_id, tanggal, penerimaan, pengeluaran, jumlah_transaksi, updated_at)
    SELECT $1, $2::date, COALESCE(SUM(penerimaan),0), COALESCE(SUM(pengeluaran),0), COUNT(*), now()
      FROM bku_entries WHERE skpd_id = $1 AND tanggal = $2::date
    ON CONFLICT (skpd_id, tanggal) DO UPDATE SET
      penerimaan = EXCLUDED.penerimaan, pengeluaran = EXCLUDED.pengeluaran,
      jumlah_transaksi = EXCLUDED.jumlah_transaksi, updated_at = now()`, [skpd, tanggal]);
}

async function handle(evt, { realtime = true, projection = true } = {}) {
  state.consumed++;
  state.lastEventAt = new Date().toISOString();
  if (projection) await project(evt).catch((e) => log.error(e, 'projection gagal'));
  if (realtime) broadcast(evt);
}

async function drain() {
  if (draining) { pending = true; return; }
  draining = true;
  try {
    do {
      pending = false;
      const client = await pool.connect();
      let batch = [];
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT id, topic, key, payload, created_at FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED');
        batch = rows.map((r) => ({ id: r.id, type: r.topic, key: r.key, data: r.payload, at: r.created_at }));
        if (batch.length) {
          if (state.mode === 'kafka') {
            await producer.send({
              topic: config.kafkaTopic,
              acks: -1,
              messages: batch.map((e) => ({ key: e.key || null, value: JSON.stringify(e), headers: { type: e.type } })),
            });
          }
          await client.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1)', [batch.map((e) => e.id)]);
        }
        await client.query('COMMIT');
        state.published += batch.length;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        state.lastError = e.message;
        log.error(e, 'outbox relay gagal; akan dicoba lagi');
        batch = [];
      } finally {
        client.release();
      }
      if (state.mode === 'memory') for (const e of batch) await handle(e);
      if (batch.length === 500) pending = true;
    } while (pending);
  } finally {
    draining = false;
  }
}

async function startKafka() {
  const kafka = new Kafka({ clientId: `bku-bkad-${os.hostname()}`, brokers: config.kafkaBrokers, logLevel: logLevel.WARN, retry: { retries: 10 } });
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({ waitForLeaders: true, topics: [{ topic: config.kafkaTopic, numPartitions: 6, replicationFactor: Number(process.env.KAFKA_REPLICATION || 1) }] });
  await admin.disconnect();

  producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  await producer.connect();

  // Proyeksi: satu consumer group bersama (tiap event diproses sekali di klaster)
  const projector = kafka.consumer({ groupId: 'bku-projection' });
  await projector.connect();
  await projector.subscribe({ topic: config.kafkaTopic, fromBeginning: true });
  await projector.run({ eachMessage: async ({ message }) => handle(JSON.parse(message.value.toString()), { realtime: false }) });

  // Realtime: group unik per instance agar setiap node menerima semua event untuk klien SSE-nya
  const realtime = kafka.consumer({ groupId: `bku-realtime-${os.hostname()}-${process.pid}` });
  await realtime.connect();
  await realtime.subscribe({ topic: config.kafkaTopic, fromBeginning: false });
  await realtime.run({ eachMessage: async ({ message }) => handle(JSON.parse(message.value.toString()), { projection: false }) });
  state.connected = true;
  return async () => { await Promise.allSettled([producer.disconnect(), projector.disconnect(), realtime.disconnect()]); };
}

export async function startEventPipeline(logger) {
  log = logger || console;
  let stopKafka = async () => {};
  if (state.mode === 'kafka') {
    try {
      stopKafka = await startKafka();
      log.info(`Event stream: Kafka ${config.kafkaBrokers.join(',')} topic ${config.kafkaTopic}`);
    } catch (e) {
      log.error(e, 'Kafka tidak dapat dihubungi, beralih ke bus internal');
      state.mode = 'memory';
      state.lastError = e.message;
    }
  }
  if (state.mode === 'memory') { state.connected = true; log.info('Event stream: bus internal (tanpa Kafka)'); }

  const listener = new pg.Client({ connectionString: config.databaseUrl });
  await listener.connect();
  listener.on('notification', () => drain());
  await listener.query('LISTEN outbox');
  const timer = setInterval(drain, 2000);
  drain();
  return async () => {
    clearInterval(timer);
    await listener.end().catch(() => {});
    await stopKafka();
  };
}
