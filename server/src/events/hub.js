// Inti event (tanpa dependensi Node): status, klien SSE, proyeksi ringkasan harian.
// Dipakai bersama oleh pipeline server (bus.js) dan mode demo di browser.
import { config } from '../config.js';
import { pool } from '../db.js';

const sseClients = new Set();
export const state = { mode: config.kafkaBrokers.length ? 'kafka' : 'memory', connected: false, published: 0, consumed: 0, lastError: null, lastEventAt: null };
export const log = { current: console };

export function eventStatus() {
  return { ...state, sseClients: sseClients.size, topic: state.mode === 'kafka' ? config.kafkaTopic : null };
}

export function addSseClient(client) {
  sseClients.add(client);
  return () => sseClients.delete(client);
}

export function broadcast(evt) {
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

export async function handle(evt, { realtime = true, projection = true } = {}) {
  state.consumed++;
  state.lastEventAt = new Date().toISOString();
  if (projection) await project(evt).catch((e) => log.current.error(e, 'projection gagal'));
  if (realtime) broadcast(evt);
}
