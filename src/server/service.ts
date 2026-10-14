import 'server-only';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from './db';
import { signToken, verifyToken, pinMatches } from './auth';
import { publicContent, manilaStart, type StoredContent } from './content';
import { scoreRound, summarize, ROUND_MS } from '../shared/rules';
import { CLAIM_CODE_PATTERN, normalizeClaimCode, validStaffPin, validateCampaign, validateSignup } from '../shared/validation';
import type { Board, ConfIdx, FulfillResult, Me, Prize, PrizeDay, PrizeDayStock, PrizeInventory, PrizeStock, DrawOutcome, Reveal, RoundResult, Side, StaffClaim } from '../shared/types';
import { isPrizeDay, MAX_PRIZE_QUANTITY, NO_PRIZE_ID, NO_PRIZE_PERCENT, PRIZES, prizeWheelDisplay } from '../shared/prizes';
import { prizeWeights, wheelSnapshot } from './prize-odds';

type Db = Pool | PoolClient;
export class HttpError extends Error {
  constructor(public status: number, public code: string, public details: Record<string,unknown> = {}) { super(code); }
}
interface Options { eventId: string; demo: boolean; secret: string; staffPin: string; publicUrl: string; contactUrl?: string; privacyPolicyUrl?: string | null }
interface Player {
  id: string; event_id: string; content_version: string; signup_key: string; signup_digest: string; name: string; mobile: string;
  audience_id: string | null; score: number | null; correct: number | null; persona: Me['persona']; finished_at: number | null;
  session_expires: number; wants_sim: boolean;
  industry: string | null; challenge: string | null; planning: string | null;
  round_indices: number[] | null;
  round_swaps: boolean[] | null;
}
interface EventRow { id: string; demo: boolean; total_cap: number; awarded_count: number; active_content: string; consent_text: string; consent_version: string; active_prize_day: PrizeDay }
interface RoundRow { idx: number; started_at: number; locked_at: number | null; reveal: Reveal | null }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const masked = (m: string) => `${m.slice(0,4)} ••• ${m.slice(-4)}`;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const prizeOf = (row: { prize_id?: string | null; prize_name?: string; amount_php?: number | null; value_php?: number | null }): Prize | null =>
  row.prize_id ? { id:row.prize_id, name:row.prize_name!, amountPhp:row.amount_php ?? null, valuePhp:row.value_php ?? null } : null;

const outcomeOf = (row: { claimed_at?: number | null; prize_id?: string | null; draw_outcome?: 'prize' | 'no_prize' | null }): DrawOutcome =>
  row.claimed_at ? row.draw_outcome ?? (row.prize_id ? 'prize' : 'legacy') : 'pending';

export class GameService {
  constructor(public pool: Pool, public options: Options, public now = () => Date.now(), private drawRandom: (max: number) => number = randomInt) {}
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
  private gameContent(p: Player, c: StoredContent): StoredContent {
    const indices=p.round_indices??[0,1,2];
    return {...c,audiences:c.audiences.map(a=>{
      if(a.id!==p.audience_id)return a;
      if(indices.some(i=>!a.rounds[i]))throw new HttpError(503,'content_missing');
      return {...a,rounds:indices.map((i,idx)=>{
        const round=a.rounds[i];
        if(!p.round_swaps?.[idx])return round;
        return {...round,a:round.b,b:round.a,winner:round.winner==='a'?'b' as const:'a' as const,
          split:round.split?{a:round.split.b,b:round.split.a}:null};
      })};
    })};
  }
  async content() {
    const e = await this.event();
    return publicContent(await this.storedContent(e.active_content),this.options.publicUrl,e.demo,e.consent_text,e.consent_version,this.options);
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
  async inventory(db: Db = this.pool): Promise<PrizeInventory> {
    const rows = (await db.query<PrizeStock & {revision:number;day:PrizeDay;activeDay:PrizeDay}>(`SELECT p.id,p.name,p.amount_php AS "amountPhp",p.value_php AS "valuePhp",
      i.day,i.total,i.fulfilled,i.total-i.fulfilled AS remaining,e.inventory_revision AS revision,e.active_prize_day AS "activeDay"
      FROM daily_prize_inventory i JOIN prize_catalog p ON p.id=i.prize_id JOIN events e ON e.id=i.event_id
      WHERE i.event_id=$1 AND p.active ORDER BY i.day,p.position`,[this.options.eventId])).rows;
    if (rows.length !== PRIZES.length * 2) throw new HttpError(503,'prizes_not_initialized');
    const days: PrizeDayStock[] = ([1,2] as const).map(day => {
      const items = rows.filter(row => row.day === day).map(row=>({id:row.id,name:row.name,amountPhp:row.amountPhp,valuePhp:row.valuePhp,total:row.total,fulfilled:row.fulfilled,remaining:row.remaining}));
      return {day,items,total:items.reduce((n,p)=>n+p.total,0),fulfilled:items.reduce((n,p)=>n+p.fulfilled,0),
        remaining:items.reduce((n,p)=>n+p.remaining,0),cashRemainingPhp:items.reduce((n,p)=>n+p.remaining*(p.amountPhp??0),0)};
    });
    return {...days.find(day => day.day === rows[0].activeDay)!,revision:rows[0].revision,activeDay:rows[0].activeDay,days,
      packagePoolValuePhp:rows.filter(row=>row.id==='predikta_package').reduce((n,p)=>n+p.total*(p.valuePhp??0),0)};
  }
  async staffInventory(token: string) { await this.staff(token); return this.inventory(); }
  async updateInventory(token: string, body: Record<string,unknown>) {
    await this.staff(token);
    const totals = body.totals;
    if (!isPrizeDay(body.day) || !Number.isSafeInteger(body.revision) || Number(body.revision)<0 || !totals || typeof totals!=='object' || Array.isArray(totals)) throw new HttpError(400,'invalid_inventory');
    const values = totals as Record<string,unknown>;
    if (Object.keys(values).length!==PRIZES.length || PRIZES.some(p=>!Number.isInteger(values[p.id]) || Number(values[p.id])<0 || Number(values[p.id])>MAX_PRIZE_QUANTITY)) throw new HttpError(400,'invalid_inventory');
    return transaction(this.pool,async db=>{
      await this.event(db,true);
      const current=await this.inventory(db);
      if(current.revision!==body.revision)throw new HttpError(409,'inventory_changed');
      const day=current.days.find(day=>day.day===body.day)!;
      if(day.items.some(p=>Number(values[p.id])<p.fulfilled))throw new HttpError(400,'below_fulfilled');
      for(const p of day.items)await db.query('UPDATE daily_prize_inventory SET total=$4 WHERE event_id=$1 AND day=$2 AND prize_id=$3',[this.options.eventId,day.day,p.id,values[p.id]]);
      await db.query('UPDATE events SET inventory_revision=inventory_revision+1 WHERE id=$1',[this.options.eventId]);
      return this.inventory(db);
    });
  }
  async switchPrizeDay(token: string, body: Record<string,unknown>) {
    await this.staff(token);
    if (!isPrizeDay(body.day) || !Number.isSafeInteger(body.revision) || Number(body.revision)<0) throw new HttpError(400,'invalid_inventory');
    return transaction(this.pool,async db=>{
      await this.event(db,true);
      const current=await this.inventory(db);
      if(current.revision!==body.revision)throw new HttpError(409,'inventory_changed');
      if(current.activeDay!==body.day)await db.query('UPDATE events SET active_prize_day=$2,inventory_revision=inventory_revision+1 WHERE id=$1',[this.options.eventId,body.day]);
      return this.inventory(db);
    });
  }
  async me(p: Player, db: Db = this.pool): Promise<Me> {
    const e = await this.event(db);
    const c = this.gameContent(p,await this.storedContent(p.content_version,db));
    const rows = await this.rounds(p.id,db);
    const results = rows.filter(r => r.reveal).map(r => r.reveal!.result);
    const open = rows.find(r => !r.locked_at);
    const claim = (await db.query('SELECT c.*,p.name AS prize_name,p.amount_php,p.value_php FROM claims c LEFT JOIN prize_catalog p ON p.id=c.prize_id WHERE c.player_id=$1',[p.id])).rows[0];
    const reward: Me['reward'] = !p.finished_at ? null : {code:claim?.code??null,claimed:!!claim?.claimed_at,
      mobileMasked:masked(p.mobile),prize:claim?prizeOf(claim):null,legacy:!!claim&&outcomeOf(claim)==='legacy',
      outcome:claim?outcomeOf(claim):'pending',prizeDay:claim?.prize_day??null};
    const profile = validateCampaign({...p});
    return { id: p.id, name: p.name, audienceId: p.audience_id, content: publicContent(c,this.options.publicUrl,e.demo,e.consent_text,e.consent_version,this.options),
      rounds: results, startedRound: open ? { idx: open.idx, elapsedMs: Math.max(0,this.now()-open.started_at) } : null,
      wallet: results.reduce((n,r) => n+r.points+r.bonus,0), finished: !!p.finished_at, score: p.score, correct: p.correct, persona: p.persona, wantsSim: p.wants_sim,
      profile: {...profile.value, complete: !Object.keys(profile.errors).length}, reward };
  }
  async signup(body: Record<string,unknown>, key: string) {
    if (!/^[\w-]{32,100}$/.test(key)) throw new HttpError(400,'idempotency_key_required');
    if (!['phone','tv'].includes(String(body.source))) throw new HttpError(400,'invalid_source');
    const { value: v, errors } = validateSignup(body,body.source==='tv'?'tv':'phone');
    if (Object.keys(errors).length) throw new HttpError(400,'invalid',{errors});
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
        ON CONFLICT(event_id,mobile) DO NOTHING RETURNING *`,[randomUUID(),e.id,e.active_content,hash(key),digest,body.source,v.name,v.mobile,v.email,v.company,v.role,v.industry||null,v.challenge||null,v.planning||null,e.consent_version,e.consent_text,now,v.optin,now+30*86400_000]);
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
      const audience=c.audiences.find(a => a.id === audienceId);
      if (!audience) throw new HttpError(400,'unknown_audience');
      const played=(await this.rounds(p.id,db)).length>0;
      if (p.finished_at || (played && p.audience_id !== audienceId)) throw new HttpError(409,'audience_locked');
      if(p.audience_id===audienceId)return this.me(p,db);
      const indices=audience.rounds.map((_,i)=>i);
      if(indices.length>3)for(let i=0;i<3;i++){
        const j=randomInt(i,indices.length);
        [indices[i],indices[j]]=[indices[j],indices[i]];
      }
      const swaps=Array.from({length:3},()=>randomInt(2)===1);
      const r = await db.query('UPDATE players SET audience_id=$2,round_indices=$3,round_swaps=$4 WHERE id=$1 RETURNING *',[p.id,audienceId,indices.slice(0,3),swaps]);
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
      const c = this.gameContent(p,await this.storedContent(p.content_version,db));
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
        ...(round.insightSource?{insightSource:round.insightSource}:{}),
        reactions: round.reactions.map((text,i) => ({ text, respondent: c.respondents[(ai*2+i)%c.respondents.length] })), result, wallet: previous+score.points+score.bonus };
      await db.query('UPDATE rounds SET locked_at=$3,pick=$4,conf=$5,correct=$6,points=$7,bonus=$8,ms_used=$9,reveal=$10 WHERE player_id=$1 AND idx=$2',
        [p.id,idx,this.now(),pick,conf,score.correct,score.points,score.bonus,msUsed,JSON.stringify(reveal)]);
      return reveal;
    });
  }
  private async award(p: Player, db: PoolClient) {
    if (!p.finished_at || (await db.query('SELECT 1 FROM claims WHERE player_id=$1',[p.id])).rowCount) return;
    if (Object.keys(validateCampaign({...p}).errors).length) return;
    // A claim code identifies a completed game; only staff fulfillment consumes stock.
    const e = await this.event(db);
    for (;;) {
      const code = Array.from({length:6},() => alphabet[randomInt(alphabet.length)]).join('');
      const r = await db.query('INSERT INTO claims(player_id,event_id,code,awarded_at) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO NOTHING',[p.id,e.id,code,this.now()]);
      if (r.rowCount) break;
    }
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
      const me = await this.me(p,db);
      if (!me.reward?.code) throw new HttpError(409,'profile_required');
      return me;
    });
  }
  async profile(token: string, body: Record<string,unknown>) {
    return transaction(this.pool,async db => {
      const p = await this.player(token,db,true);
      if (!p.finished_at) throw new HttpError(409,'rounds_incomplete');
      const {value,errors} = validateCampaign(body);
      if (Object.keys(errors).length) throw new HttpError(400,'invalid',{errors});
      const updated = (await db.query('UPDATE players SET industry=$2,challenge=$3,planning=$4 WHERE id=$1 RETURNING *',
        [p.id,value.industry,value.challenge,value.planning])).rows[0] as Player;
      await this.award(updated,db);
      return this.me(updated,db);
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
    return { prizes: await this.inventory(), stat: {...stat,pct: stat.picks ? Math.round(stat.matches/stat.picks*100) : null},
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
    const rows = (await this.pool.query(`SELECT p.*,c.code,c.awarded_at,c.claimed_at,c.prize_day,c.draw_outcome FROM players p LEFT JOIN claims c ON c.player_id=p.id WHERE p.event_id=$1 ORDER BY p.created_at DESC`,[e.id])).rows;
    const day = manilaStart(this.now());
    const isToday = (n: number | null) => n !== null && n >= day && n < day+86400_000;
    const leads = rows.filter(p => p.planning === 'Yes' || p.wants_sim).map(p => ({name:p.name,email:p.email,company:p.company,role:p.role,challenge:p.challenge,planning:p.planning,wantsSim:p.wants_sim,claimed:!!p.claimed_at&&p.draw_outcome!=='no_prize',drawComplete:!!p.claimed_at}));
    const inventory=await this.inventory();
    return { inventory,kpis: {playsToday:rows.filter(p => isToday(p.finished_at)).length,claimedToday:rows.filter(p => isToday(p.claimed_at)&&p.draw_outcome!=='no_prize').length,
      noPrizeDraws:rows.filter(p=>p.draw_outcome==='no_prize'&&p.prize_day===inventory.activeDay).length,remaining:inventory.remaining,hotLeads:leads.length},
      pending: rows.filter(p => p.code && !p.claimed_at).map(p => ({name:p.name,company:p.company,code:p.code,awardedAt:p.awarded_at})),leads };
  }
  async claimView(code: string, db: Db = this.pool): Promise<StaffClaim> {
    code = normalizeClaimCode(code);
    if (!CLAIM_CODE_PATTERN.test(code)) throw new HttpError(400,'invalid_claim_code');
    const p = (await db.query(`SELECT p.name,p.company,p.role,p.mobile,p.score,p.persona,c.code,c.claimed_at,c.prize_id,c.draw_outcome,c.prize_day,
      pc.name AS prize_name,pc.amount_php,pc.value_php FROM claims c JOIN players p ON p.id=c.player_id
      LEFT JOIN prize_catalog pc ON pc.id=c.prize_id WHERE c.code=$1 AND c.event_id=$2 AND p.finished_at IS NOT NULL`,[code,this.options.eventId])).rows[0];
    if (!p) throw new HttpError(404,'no_such_code');
    return { name:p.name,company:p.company,role:p.role,mobile:p.mobile,score:p.score,persona:p.persona,code:p.code,claimed:!!p.claimed_at,claimedAt:p.claimed_at,prize:prizeOf(p),legacy:outcomeOf(p)==='legacy',outcome:outcomeOf(p),prizeDay:p.prize_day??null };
  }
  async lookup(token: string, code: string) { await this.staff(token); return this.claimView(code); }
  async claim(token: string, code: string, body: Record<string,unknown>): Promise<FulfillResult> {
    const staff = await this.staff(token);
    if (body.confirmedNumber !== true || body.fulfillmentConfirmed !== true) throw new HttpError(400,'confirm_number_and_fulfillment');
    return transaction(this.pool,async db => {
      // The shared event lock serializes all draws and stock edits across replicas.
      await this.event(db,true);
      const clean=normalizeClaimCode(code);
      await db.query('SELECT player_id FROM claims WHERE code=$1 AND event_id=$2 FOR UPDATE',[clean,this.options.eventId]);
      const existing=await this.claimView(clean,db);
      if(existing.claimed)return {...existing,replayed:true,wheel:null};
      const inventory=await this.inventory(db);
      if (!isPrizeDay(body.day)) throw new HttpError(400,'invalid_inventory');
      if (body.day!==inventory.activeDay) throw new HttpError(409,'inventory_changed');
      const items=inventory.items.filter(p=>p.remaining>0);
      if(!items.length)throw new HttpError(409,'out_of_stock');
      let prize: PrizeStock | null = null;
      if (this.drawRandom(100) >= NO_PRIZE_PERCENT) {
        const weighted=prizeWeights(items,existing.role);
        let ticket=this.drawRandom(weighted.reduce((n,p)=>n+p.weight,0));
        prize=weighted.find(p=>{ticket-=p.weight;return ticket<0;})!.prize;
        await db.query('UPDATE daily_prize_inventory SET fulfilled=fulfilled+1 WHERE event_id=$1 AND day=$2 AND prize_id=$3',[this.options.eventId,inventory.activeDay,prize.id]);
      }
      const wheel=wheelSnapshot(items,prize?.id??NO_PRIZE_ID,existing.role);
      await db.query('UPDATE claims SET prize_id=$3,wheel_snapshot=$4,claimed_at=$5,staff_session=$6,draw_outcome=$7,prize_day=$8 WHERE code=$1 AND event_id=$2',
        [clean,this.options.eventId,prize?.id??null,JSON.stringify(wheel),this.now(),staff,prize?'prize':'no_prize',inventory.activeDay]);
      await db.query('UPDATE events SET inventory_revision=inventory_revision+1 WHERE id=$1',[this.options.eventId]);
      return {...await this.claimView(clean,db),replayed:false,wheel:prizeWheelDisplay(items,wheel.prizeId)};
    });
  }
  async exportRows(token: string) {
    await this.staff(token);
    return (await this.pool.query(`SELECT p.*,c.code,c.awarded_at,c.claimed_at,c.prize_id,c.draw_outcome,c.prize_day,pc.name AS prize_name,pc.amount_php,pc.value_php
      FROM players p LEFT JOIN claims c ON c.player_id=p.id LEFT JOIN prize_catalog pc ON pc.id=c.prize_id
      WHERE p.event_id=$1 ORDER BY p.created_at`,[this.options.eventId])).rows;
  }
}
