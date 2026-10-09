import 'server-only';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from './db';
import { signToken, verifyToken, pinMatches } from './auth';
import { publicContent, manilaStart, type StoredContent } from './content';
import { scoreRound, summarize, ROUND_MS } from '../shared/rules';
import { CLAIM_CODE_PATTERN, normalizeClaimCode, validStaffPin, validateSignup } from '../shared/validation';
import type { Board, ConfIdx, GcStatus, Me, Reveal, RoundResult, Side } from '../shared/types';

type Db = Pool | PoolClient;
export class HttpError extends Error {
  constructor(public status: number, public code: string, public details: Record<string,unknown> = {}) { super(code); }
}
interface Options { eventId: string; demo: boolean; secret: string; staffPin: string; publicUrl: string }
interface Player {
  id: string; event_id: string; content_version: string; signup_key: string; signup_digest: string; name: string; mobile: string;
  audience_id: string | null; score: number | null; correct: number | null; persona: Me['persona']; finished_at: number | null;
  session_expires: number; wants_sim: boolean;
}
interface EventRow { id: string; demo: boolean; total_cap: number; awarded_count: number; active_content: string; consent_text: string; consent_version: string }
interface RoundRow { idx: number; started_at: number; locked_at: number | null; reveal: Reveal | null }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const masked = (m: string) => `${m.slice(0,4)} ••• ${m.slice(-4)}`;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class GameService {
  constructor(public pool: Pool, public options: Options, public now = () => Date.now()) {}
  async event(db: Db = this.pool, lock = false): Promise<EventRow> {
    const e = (await db.query(`SELECT * FROM events WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [this.options.eventId])).rows[0];
    if (!e) throw new HttpError(503,'event_not_seeded');
    if (e.demo !== this.options.demo) throw new HttpError(503,'event_mode_mismatch');
    return e;
  }
  async storedContent(id: string, db: Db = this.pool): Promise<StoredContent> {
    const c = (await db.query('SELECT * FROM content_versions WHERE id=$1',[id])).rows[0];
    if (!c) throw new HttpError(503,'content_missing');
    return c;
  }
  async content() {
    const e = await this.event();
    return publicContent(await this.storedContent(e.active_content),this.options.publicUrl,e.demo,e.consent_text,e.consent_version);
  }
  async player(token: string, db: Db = this.pool, lock = false): Promise<Player> {
    const id = verifyToken(token,'player',this.options.secret,this.now());
    if (!id) throw new HttpError(401,'unknown_player');
    const p = (await db.query(`SELECT * FROM players WHERE id=$1 AND event_id=$2 AND session_expires>$3${lock ? ' FOR UPDATE' : ''}`, [id,this.options.eventId,this.now()])).rows[0];
    if (!p) throw new HttpError(401,'unknown_player');
    return p;
  }
  async rounds(id: string, db: Db = this.pool): Promise<RoundRow[]> {
    return (await db.query('SELECT * FROM rounds WHERE player_id=$1 ORDER BY idx',[id])).rows;
  }
  async gc(db: Db = this.pool, e?: EventRow): Promise<GcStatus> {
    e ??= await this.event(db);
    const dayEnd = manilaStart(this.now()) + 86400_000;
    const b = (await db.query(`SELECT
      COALESCE(SUM(allocation) FILTER (WHERE starts_at <= $2),0)::int AS released,
      COALESCE(SUM(allocation) FILTER (WHERE starts_at < $3),0)::int AS tonight,
      MIN(starts_at) FILTER (WHERE starts_at > $2) AS next
      FROM gc_blocks WHERE event_id=$1`,[e.id,this.now(),dayEnd])).rows[0];
    const availableNow = Math.max(0,Math.min(b.released,e.total_cap)-e.awarded_count);
    return { availableNow, leftToday: Math.max(0,Math.min(b.tonight,e.total_cap)-e.awarded_count), nextDropAt: availableNow || e.awarded_count >= e.total_cap ? null : b.next };
  }
  async me(p: Player, db: Db = this.pool): Promise<Me> {
    const e = await this.event(db);
    const c = await this.storedContent(p.content_version,db);
    const rows = await this.rounds(p.id,db);
    const results = rows.filter(r => r.reveal).map(r => r.reveal!.result);
    const open = rows.find(r => !r.locked_at);
    const claim = (await db.query('SELECT * FROM claims WHERE player_id=$1',[p.id])).rows[0];
    const gc: Me['gc'] = !p.finished_at ? null : claim
      ? { status: 'awarded', code: claim.code, claimed: !!claim.claimed_at, mobileMasked: masked(p.mobile) }
      : { status: 'waiting', nextDropAt: (await this.gc(db,e)).nextDropAt, mobileMasked: masked(p.mobile) };
    return { id: p.id, name: p.name, audienceId: p.audience_id, content: publicContent(c,this.options.publicUrl,e.demo,e.consent_text,e.consent_version),
      rounds: results, startedRound: open ? { idx: open.idx, elapsedMs: Math.max(0,this.now()-open.started_at) } : null,
      wallet: results.reduce((n,r) => n+r.points+r.bonus,0), finished: !!p.finished_at, score: p.score, correct: p.correct, persona: p.persona, wantsSim: p.wants_sim, gc };
  }
  async signup(body: Record<string,unknown>, key: string) {
    if (!/^[\w-]{32,100}$/.test(key)) throw new HttpError(400,'idempotency_key_required');
    const { value: v, errors } = validateSignup(body);
    if (Object.keys(errors).length) throw new HttpError(400,'invalid',{errors});
    if (!['phone','tv'].includes(String(body.source))) throw new HttpError(400,'invalid_source');
    const digest = hash(JSON.stringify({ ...v, source: body.source, version: body.contentVersion, consent: body.consentVersion }));
    const p = await transaction(this.pool,async db => {
      // Per-key advisory lock also covers a request whose INSERT has not committed yet.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${this.options.eventId}:${key}`]);
      const existing = (await db.query('SELECT * FROM players WHERE event_id=$1 AND signup_key=$2',[this.options.eventId,hash(key)])).rows[0];
      if (existing) {
        if (existing.signup_digest !== digest) throw new HttpError(409,'idempotency_conflict');
        return existing as Player;
      }
      const e = await this.event(db);
      if (body.contentVersion !== e.active_content || body.consentVersion !== e.consent_version) throw new HttpError(409,'content_updated');
      const now = this.now();
      const r = await db.query(`INSERT INTO players(id,event_id,content_version,signup_key,signup_digest,source,name,mobile,email,company,role,industry,challenge,planning,
        consent_version,consent_text,consent_at,marketing_optin,created_at,session_expires)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$17,$19)
        ON CONFLICT(event_id,mobile) DO NOTHING RETURNING *`,[randomUUID(),e.id,e.active_content,hash(key),digest,body.source,v.name,v.mobile,v.email,v.company,v.role,v.industry,v.challenge,v.planning,e.consent_version,e.consent_text,now,v.optin,now+30*86400_000]);
      if (!r.rowCount) throw new HttpError(409,'duplicate_mobile');
      return r.rows[0] as Player;
    });
    return { token: signToken(p.id,p.session_expires,'player',this.options.secret), me: await this.me(p) };
  }
  async current(token: string) { return this.me(await this.player(token)); }
  async audience(token: string, audienceId: unknown) {
    return transaction(this.pool,async db => {
      const p = await this.player(token,db,true);
      const c = await this.storedContent(p.content_version,db);
      if (!c.audiences.some(a => a.id === audienceId)) throw new HttpError(400,'unknown_audience');
      if (p.finished_at || ((await this.rounds(p.id,db)).length && p.audience_id !== audienceId)) throw new HttpError(409,'audience_locked');
      const r = await db.query('UPDATE players SET audience_id=$2 WHERE id=$1 RETURNING *',[p.id,audienceId]);
      return this.me(r.rows[0],db);
    });
  }
  async start(token: string, idx: number) {
    if (!Number.isInteger(idx) || idx < 0 || idx > 2) throw new HttpError(400,'invalid_round');
    return transaction(this.pool,async db => {
      const p = await this.player(token,db,true);
      const rows = await this.rounds(p.id,db);
      const existing = rows.find(r => r.idx === idx);
      if (existing) return { elapsedMs: Math.max(0,this.now()-existing.started_at), locked: !!existing.locked_at };
      if (!p.audience_id || p.finished_at || rows.length !== idx || rows.some(r => !r.locked_at)) throw new HttpError(409,'out_of_order');
      await db.query('INSERT INTO rounds(player_id,idx,started_at) VALUES($1,$2,$3)',[p.id,idx,this.now()]);
      return { elapsedMs: 0, locked: false };
    });
  }
  async lock(token: string, idx: number, body: Record<string,unknown>): Promise<Reveal> {
    if (!Number.isInteger(idx) || idx < 0 || idx > 2) throw new HttpError(400,'invalid_round');
    return transaction(this.pool,async db => {
      const p = await this.player(token,db,true);
      const row = (await this.rounds(p.id,db)).find(r => r.idx === idx);
      if (!row) throw new HttpError(409,'not_started');
      if (row.reveal) return row.reveal;
      if (body.pick !== null && body.pick !== 'a' && body.pick !== 'b') throw new HttpError(400,'invalid_pick');
      if (![0,1,2].includes(body.conf as number) || typeof body.clientMs !== 'number' || !Number.isFinite(body.clientMs) || body.clientMs < 0) throw new HttpError(400,'invalid_confidence_or_time');
      const c = await this.storedContent(p.content_version,db);
      const ai = c.audiences.findIndex(a => a.id === p.audience_id);
      const round = c.audiences[ai].rounds[idx];
      const serverMs = Math.max(0,this.now()-row.started_at);
      const pick = serverMs > ROUND_MS+15_000 ? null : body.pick as Side | null;
      const conf = body.conf as ConfIdx;
      const msUsed = pick ? Math.min(ROUND_MS,Math.max(body.clientMs,serverMs-3000,0)) : ROUND_MS;
      const score = scoreRound(pick,round.winner,conf,msUsed);
      const result: RoundResult = { idx, winner: round.winner, pick, conf, ...score, msUsed };
      const previous = (await this.rounds(p.id,db)).reduce((n,r) => n+(r.reveal?.result.points ?? 0)+(r.reveal?.result.bonus ?? 0),0);
      const reveal: Reveal = { idx, winner: round.winner, split: round.split, emotion: round.emotion, driver: round.driver, surprise: !!round.surprise,
        reactions: round.reactions.map((text,i) => ({ text, respondent: c.respondents[(ai*2+i)%c.respondents.length] })), result, wallet: previous+score.points+score.bonus };
      await db.query('UPDATE rounds SET locked_at=$3,pick=$4,conf=$5,correct=$6,points=$7,bonus=$8,ms_used=$9,reveal=$10 WHERE player_id=$1 AND idx=$2',
        [p.id,idx,this.now(),pick,conf,score.correct,score.points,score.bonus,msUsed,JSON.stringify(reveal)]);
      return reveal;
    });
  }
  private async award(p: Player, db: PoolClient) {
    if (!p.finished_at || (await db.query('SELECT 1 FROM claims WHERE player_id=$1',[p.id])).rowCount) return;
    // Lock the event row: inventory is shared by every Cloud Run instance.
    const e = await this.event(db,true);
    if ((await this.gc(db,e)).availableNow <= 0) return;
    for (;;) {
      const code = Array.from({length:6},() => alphabet[randomInt(alphabet.length)]).join('');
      const r = await db.query('INSERT INTO claims(player_id,event_id,code,awarded_at) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO NOTHING',[p.id,e.id,code,this.now()]);
      if (r.rowCount) break;
    }
    await db.query('UPDATE events SET awarded_count=awarded_count+1 WHERE id=$1',[e.id]);
  }
  async finish(token: string) {
    return transaction(this.pool,async db => {
      let p = await this.player(token,db,true);
      if (!p.finished_at) {
        const rows = await this.rounds(p.id,db);
        if (rows.length !== 3 || rows.some(r => !r.reveal)) throw new HttpError(409,'rounds_incomplete');
        const s = summarize(rows.map(r => r.reveal!.result));
        p = (await db.query('UPDATE players SET score=$2,total_ms=$3,correct=$4,persona=$5,finished_at=$6 WHERE id=$1 RETURNING *',[p.id,s.score,s.totalMs,s.correct,s.persona,this.now()])).rows[0];
      }
      await this.award(p,db);
      return this.me(p,db);
    });
  }
  async retryAward(token: string) {
    return transaction(this.pool,async db => {
      const p = await this.player(token,db,true);
      if (!p.finished_at) throw new HttpError(409,'rounds_incomplete');
      await this.award(p,db);
      return this.me(p,db);
    });
  }
  async interest(token: string, wants: unknown) {
    if (typeof wants !== 'boolean') throw new HttpError(400,'invalid_interest');
    const p = await this.player(token);
    if (!p.finished_at) throw new HttpError(409,'rounds_incomplete');
    return this.me((await this.pool.query('UPDATE players SET wants_sim=$2 WHERE id=$1 RETURNING *',[p.id,wants])).rows[0]);
  }
  async board(): Promise<Board> {
    const e = await this.event();
    const stat = (await this.pool.query(`SELECT count(*) FILTER (WHERE r.pick IS NOT NULL)::int picks,
      count(*) FILTER (WHERE r.correct)::int matches FROM rounds r JOIN players p ON p.id=r.player_id WHERE p.event_id=$1`,[e.id])).rows[0];
    const leaders = (await this.pool.query('SELECT id,name,score FROM players WHERE event_id=$1 AND finished_at >= $2 AND finished_at < $3 ORDER BY score DESC,total_ms ASC,finished_at ASC,id ASC LIMIT 10',[e.id,manilaStart(this.now()),manilaStart(this.now())+86400_000])).rows;
    return { gc: await this.gc(this.pool,e), stat: {...stat,pct: stat.picks ? Math.round(stat.matches/stat.picks*100) : null},
      leaderboard: leaders.map(p => ({id:p.id,name:p.name.trim().split(/\s+/).map((n:string,i:number) => i ? `${n[0]}.` : n).join(' '),score:p.score})) };
  }
  async login(pin: unknown, identity: string, kind: 'staff' | 'tv' = 'staff') {
    if (!validStaffPin(pin)) throw new HttpError(400,'invalid_pin');
    const result = await transaction(this.pool,async db => {
      const now = this.now();
      const key = hash(identity);
      await db.query('INSERT INTO login_throttles(identity,updated_at) VALUES($1,$2) ON CONFLICT DO NOTHING',[key,now]);
      const r = (await db.query('SELECT * FROM login_throttles WHERE identity=$1 FOR UPDATE',[key])).rows[0];
      if (r.locked_until > now) return { error: new HttpError(429,'locked_out',{retryAt:r.locked_until}) };
      if (typeof pin !== 'string' || !pinMatches(pin,this.options.staffPin,this.options.secret)) {
        const n = (now-r.updated_at > 15*60_000 ? 0 : r.failures)+1;
        await db.query('UPDATE login_throttles SET failures=$2,locked_until=$3,updated_at=$4 WHERE identity=$1',[key,n >= 5 ? 0 : n,n >= 5 ? now+15*60_000 : 0,now]);
        return { error: new HttpError(401,'wrong_pin') };
      }
      await db.query('DELETE FROM login_throttles WHERE identity=$1',[key]);
      const id = randomUUID();
      const expires = now+12*3600_000;
      await db.query('INSERT INTO staff_sessions(id,expires_at,created_at) VALUES($1,$2,$3)',[id,expires,now]);
      return { token: signToken(id,expires,kind,this.options.secret) };
    });
    if (result.error) throw result.error;
    return result.token!;
  }
  async accessSession(token: string, kind: 'staff' | 'tv') {
    const id = verifyToken(token,kind,this.options.secret,this.now());
    if (!id || !(await this.pool.query('SELECT 1 FROM staff_sessions WHERE id=$1 AND expires_at>$2',[id,this.now()])).rowCount) throw new HttpError(401,`${kind}_required`);
    return id;
  }
  async staff(token: string) { return this.accessSession(token,'staff'); }
  async tv(token: string) { return this.accessSession(token,'tv'); }
  async logout(token: string, kind: 'staff' | 'tv' = 'staff') { const id = await this.accessSession(token,kind); await this.pool.query('UPDATE staff_sessions SET expires_at=$2 WHERE id=$1',[id,this.now()]); }
  async summary(token: string) {
    await this.staff(token);
    const e = await this.event();
    const rows = (await this.pool.query(`SELECT p.*,c.code,c.awarded_at,c.claimed_at FROM players p LEFT JOIN claims c ON c.player_id=p.id WHERE p.event_id=$1 ORDER BY p.created_at DESC`,[e.id])).rows;
    const day = manilaStart(this.now());
    const isToday = (n: number | null) => n !== null && n >= day && n < day+86400_000;
    const leads = rows.filter(p => p.planning === 'Yes' || p.wants_sim).map(p => ({name:p.name,email:p.email,company:p.company,role:p.role,challenge:p.challenge,planning:p.planning,wantsSim:p.wants_sim,claimed:!!p.claimed_at}));
    const gc = await this.gc(this.pool,e);
    const allocation = (await this.pool.query('SELECT COALESCE(sum(allocation),0)::int n FROM gc_blocks WHERE event_id=$1 AND starts_at >= $2 AND starts_at < $3',[e.id,day,day+86400_000])).rows[0].n;
    return { kpis: {playsToday:rows.filter(p => isToday(p.finished_at)).length,claimedToday:rows.filter(p => isToday(p.claimed_at)).length,leftToday:gc.leftToday,allocToday:allocation,awardedTotal:e.awarded_count,cap:e.total_cap,waitingForDrop:rows.filter(p => p.finished_at && !p.code).length,hotLeads:leads.length},
      pending: rows.filter(p => p.code && !p.claimed_at).map(p => ({name:p.name,company:p.company,code:p.code,awardedAt:p.awarded_at})),leads };
  }
  async claimView(code: string, db: Db = this.pool) {
    code = normalizeClaimCode(code);
    if (!CLAIM_CODE_PATTERN.test(code)) throw new HttpError(400,'invalid_claim_code');
    const p = (await db.query(`SELECT p.name,p.company,p.role,p.mobile,p.score,p.persona,c.code,c.claimed_at FROM claims c JOIN players p ON p.id=c.player_id WHERE c.code=$1 AND c.event_id=$2`,[code.trim().toUpperCase(),this.options.eventId])).rows[0];
    if (!p) throw new HttpError(404,'no_such_code');
    return { name:p.name,company:p.company,role:p.role,mobile:p.mobile,score:p.score,persona:p.persona,code:p.code,claimed:!!p.claimed_at,claimedAt:p.claimed_at };
  }
  async lookup(token: string, code: string) { await this.staff(token); return this.claimView(code); }
  async claim(token: string, code: string, body: Record<string,unknown>) {
    const staff = await this.staff(token);
    if (body.confirmedNumber !== true || body.fulfillmentConfirmed !== true) throw new HttpError(400,'confirm_number_and_fulfillment');
    return transaction(this.pool,async db => {
      const result = await db.query('UPDATE claims SET claimed_at=$3,staff_session=$4 WHERE code=$1 AND event_id=$2 AND claimed_at IS NULL RETURNING player_id',[code.trim().toUpperCase(),this.options.eventId,this.now(),staff]);
      // A repeated confirmation returns the same fulfilled claim; it never initiates a payout.
      if (!result.rowCount) await this.claimView(code,db);
      return this.claimView(code,db);
    });
  }
  async exportRows(token: string) {
    await this.staff(token);
    return (await this.pool.query(`SELECT p.*,c.code,c.awarded_at,c.claimed_at FROM players p LEFT JOIN claims c ON c.player_id=p.id WHERE p.event_id=$1 ORDER BY p.created_at`,[this.options.eventId])).rows;
  }
}
