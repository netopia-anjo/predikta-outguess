import type { Pool } from 'pg';
import { transaction } from './db';
import { scheduleRows, type loadSeed } from './content';
export async function seedEvent(pool: Pool, eventId: string, demo: boolean, seed: Awaited<ReturnType<typeof loadSeed>>) {
  await transaction(pool, async db => {
    const { content: c, schedule: s } = seed;
    const rows = scheduleRows(s);
    await db.query('INSERT INTO content_versions(id,audiences,respondents,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [c.id,JSON.stringify(c.audiences),JSON.stringify(c.respondents),Date.now()]);
    await db.query('INSERT INTO events(id,demo,total_cap,active_content,consent_version,consent_text) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [eventId,demo,s.totalCap,c.id,seed.consentVersion,seed.consentText]);
    const e = (await db.query('SELECT * FROM events WHERE id=$1 FOR UPDATE',[eventId])).rows[0];
    if (e.demo !== demo) throw new Error('Use a separate database for demo and production.');
    if (e.awarded_count > s.totalCap) throw new Error('Cap is below already awarded rewards.');
    const released = (await db.query('SELECT * FROM gc_blocks WHERE event_id=$1 AND starts_at <= $2',[eventId,Date.now()])).rows;
    if (e.awarded_count && released.some(b => !rows.some(r => r.id === b.id && r.allocation === b.allocation && r.starts === b.starts_at && r.ends === b.ends_at))) throw new Error('Released blocks cannot change after awards.');
    await db.query('UPDATE events SET total_cap=$2,active_content=$3,consent_version=$4,consent_text=$5 WHERE id=$1',[eventId,s.totalCap,c.id,seed.consentVersion,seed.consentText]);
    await db.query('DELETE FROM gc_blocks WHERE event_id=$1',[eventId]);
    for (const r of rows) await db.query('INSERT INTO gc_blocks(id,event_id,starts_at,ends_at,allocation) VALUES($1,$2,$3,$4,$5)',[r.id,eventId,r.starts,r.ends,r.allocation]);
  });
}
