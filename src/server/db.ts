import pg from 'pg';
import type { PoolClient } from 'pg';

// All bigint values in this schema are epoch milliseconds, within JS's safe integer range.
pg.types.setTypeParser(20, Number);
export const makePool = (connectionString?: string, options?: string) => new pg.Pool({
  ...(connectionString || process.env.DATABASE_URL
    ? { connectionString: connectionString ?? process.env.DATABASE_URL }
    : { host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`, database: process.env.DB_NAME,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD }),
  max: Number(process.env.DB_POOL_MAX || 5),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30_000,
  options,
});
const globalDb = globalThis as typeof globalThis & { outguessPool?: pg.Pool };
export function getPool() {
  return globalDb.outguessPool ??= makePool();
}
export async function transaction<T>(pool: pg.Pool, fn: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally { db.release(); }
}
