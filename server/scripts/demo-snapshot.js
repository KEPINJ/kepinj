// Membuat snapshot database demo (migrasi + data contoh) dengan PGlite, tanpa server PostgreSQL.
// Pemakaian: node scripts/demo-snapshot.js <file-keluaran.tar.gz>
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const out = resolve(process.argv[2] || '../web/public/demo/bku-demo.tar.gz');
process.env.DATABASE_URL = 'pglite:memory';
const { pool } = await import('../src/db.js');
pool.onEnd = async (db) => {
  await db.query('VACUUM');
  const file = await db.dumpDataDir('gzip');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(await file.arrayBuffer()));
  console.log(`[demo] snapshot ditulis ke ${out} (${(file.size / 1048576).toFixed(1)} MB)`);
};
await import('../src/db/seed.js');
