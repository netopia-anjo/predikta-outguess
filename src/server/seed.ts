import type { Pool } from 'pg';
import { transaction } from './db';
import type { loadSeed } from './content';
export async function seedEvent(pool: Pool, eventId: string, demo: boolean, seed: Awaited<ReturnType<typeof loadSeed>>) {
  await transaction(pool, async db => {
    const { content: c } = seed;
    await db.query('INSERT INTO content_versions(id,audiences,respondents,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [c.id,JSON.stringify(c.audiences),JSON.stringify(c.respondents),Date.now()]);
    await db.query('INSERT INTO events(id,demo,total_cap,active_content,consent_version,consent_text) VALUES($1,$2,300,$3,$4,$5) ON CONFLICT DO NOTHING', [eventId,demo,c.id,seed.consentVersion,seed.consentText]);
    const e = (await db.query('SELECT * FROM events WHERE id=$1 FOR UPDATE',[eventId])).rows[0];
    if (e.demo !== demo) throw new Error('Use a separate database for demo and production.');
    await db.query('UPDATE events SET active_content=$2,consent_version=$3,consent_text=$4 WHERE id=$1',[eventId,c.id,seed.consentVersion,seed.consentText]);
    // Create missing rows only. Never restore stock or change fulfillment counters when re-seeding.
    await db.query('INSERT INTO prize_inventory(event_id,prize_id) SELECT $1,id FROM prize_catalog ON CONFLICT DO NOTHING',[eventId]);
  });
}
