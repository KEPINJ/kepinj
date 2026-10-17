// Pengganti server/src/events/bus.js untuk mode demo: outbox dialirkan langsung di browser (tanpa Kafka).
import { pool } from '../../../../server/src/db.js';
import { state, handle } from '../../../../server/src/events/hub.js';

export { eventStatus, addSseClient } from '../../../../server/src/events/hub.js';

state.mode = 'demo';
state.connected = true;

export async function drainOutbox() {
  const c = await pool.connect();
  let batch;
  try {
    const { rows } = await c.query(`UPDATE outbox SET published_at = now() WHERE id IN
      (SELECT id FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 1000) RETURNING id, topic, key, payload, created_at`);
    batch = rows.sort((a, b) => a.id - b.id).map((r) => ({ id: r.id, type: r.topic, key: r.key, data: r.payload, at: r.created_at }));
  } finally {
    c.release();
  }
  state.published += batch.length;
  for (const e of batch) await handle(e);
  if (batch.length === 1000) await drainOutbox();
}

export async function startEventPipeline() {
  return async () => {};
}
