import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { makePool, transaction } from '../src/server/db';

const pool = makePool();
try {
  await transaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(739201)");
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir('migrations')).filter(n => n.endsWith('.sql')).sort()) {
      const sql = await readFile(`migrations/${name}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await db.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name,checksum]);
      console.log(`Applied ${name}`);
    }
  });
} finally { await pool.end(); }
