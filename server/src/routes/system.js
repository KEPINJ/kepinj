import { query } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { eventStatus, addSseClient } from '../events/bus.js';
import { int } from '../lib/http.js';

export default async function systemRoutes(app) {
  app.get('/api/health', async () => {
    await query('SELECT 1');
    return { ok: true, events: eventStatus().mode };
  });

  app.get('/api/system/status', { preHandler: requireAuth }, async () => {
    const [db, parts, outbox, counts] = await Promise.all([
      query("SELECT pg_size_pretty(pg_database_size(current_database())) AS ukuran, version() AS versi"),
      query(`SELECT c.relname AS partisi, pg_size_pretty(pg_total_relation_size(c.oid)) AS ukuran, c.reltuples::bigint AS perkiraan_baris
        FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'bku_entries' ORDER BY c.relname`),
      query(`SELECT COUNT(*) FILTER (WHERE published_at IS NULL)::int AS antre, COUNT(*)::int AS total,
        MAX(published_at) AS terakhir_terbit FROM outbox`),
      query(`SELECT (SELECT COUNT(*) FROM bku_entries)::int AS bku, (SELECT COUNT(*) FROM pajak)::int AS pajak,
        (SELECT COUNT(*) FROM datasets)::int AS dataset, (SELECT COUNT(*) FROM audit_log)::int AS audit`),
    ]);
    return { database: db.rows[0], partisi: parts.rows, outbox: outbox.rows[0], jumlah: counts.rows[0], event: eventStatus() };
  });

  app.get('/api/audit', { preHandler: requireRole('admin', 'pimpinan', 'verifikator') }, async (req) => {
    const params = []; const where = [];
    if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(action ILIKE $1 OR username ILIKE $1 OR entity_id ILIKE $1)`); }
    if (req.query.action) { params.push(req.query.action); where.push(`action = $${params.length}`); }
    params.push(Math.min(int(req.query.limit, 200), 1000));
    const { rows } = await query(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT $${params.length}`, params);
    return { rows };
  });

  // Server-Sent Events: pembaruan realtime ke browser
  app.get('/api/stream', { preHandler: requireAuth }, (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ mode: eventStatus().mode })}\n\n`);
    const user = req.user;
    const client = {
      write: (s) => reply.raw.write(s),
      filter: (evt) => ['admin', 'pimpinan'].includes(user.role) || Number(evt.data?.skpd_id) === user.skpd_id,
    };
    const remove = addSseClient(client);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    req.raw.on('close', () => { clearInterval(ping); remove(); });
    reply.hijack();
  });
}
