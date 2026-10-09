import { makePool } from '../src/server/db';
import { config } from '../src/server/config';
import { loadSeed } from '../src/server/content';
import { seedEvent } from '../src/server/seed';
const pool = makePool();
try {
  const c = config();
  await seedEvent(pool, c.eventId, c.demo, await loadSeed(c.demo));
  console.log(`Seeded ${c.eventId} (${c.demo ? 'DEMO' : 'production'}). Existing players and claims preserved.`);
} finally { await pool.end(); }
