import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

// DATE dikembalikan sebagai string 'YYYY-MM-DD' (hindari geseran zona waktu),
// NUMERIC tetap string agar presisi uang terjaga, BIGINT dikonversi ke Number.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

// Pelaku permintaan (pengguna login) untuk jejak audit perubahan data: trigger catat_audit_data membaca
// bku.user_id & bku.username yang disetel di awal setiap transaksi.
export const aktor = new AsyncLocalStorage();
const TULIS = /^\s*(INSERT|UPDATE|DELETE|WITH)\b/i;

async function tandaiAktor(client) {
  const a = aktor.getStore();
  if (a?.id) await client.query("SELECT set_config('bku.user_id', $1, true), set_config('bku.username', $2, true)", [String(a.id), a.username || '']);
}

export const query = (text, params) => (aktor.getStore()?.id && TULIS.test(text) ? tx((c) => c.query(text, params)) : pool.query(text, params));

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await tandaiAktor(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function emit(client, topic, key, payload) {
  await client.query('INSERT INTO outbox (topic, key, payload) VALUES ($1, $2, $3)', [topic, key, payload]);
}

export async function audit(client, user, action, entity, entityId, detail, ip) {
  await client.query(
    'INSERT INTO audit_log (user_id, username, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [user?.id ?? null, user?.username ?? null, action, entity, entityId == null ? null : String(entityId), detail ?? null, ip ?? null],
  );
}
