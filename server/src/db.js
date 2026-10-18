import pgNative from 'pg';
import pglite from './db/pglite-pg.js';
import { config } from './config.js';

// DATABASE_URL=pglite:memory menjalankan PostgreSQL WASM di dalam proses (demo & build snapshot)
const pg = config.databaseUrl.startsWith('pglite:') ? pglite : pgNative;

// DATE dikembalikan sebagai string 'YYYY-MM-DD' (hindari geseran zona waktu),
// NUMERIC tetap string agar presisi uang terjaga, BIGINT dikonversi ke Number.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
