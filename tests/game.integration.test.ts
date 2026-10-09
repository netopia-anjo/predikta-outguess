import { beforeAll,beforeEach,afterAll,test,expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { makePool } from '../src/server/db';
import { GameService } from '../src/server/service';
import { loadSeed } from '../src/server/content';
import { seedEvent } from '../src/server/seed';

const url=process.env.TEST_DATABASE_URL||'postgresql://outguess:outguess@127.0.0.1:5434/outguess';
const schema=`test_${randomUUID().replaceAll('-','')}`;
const admin=makePool(url);
const pool=makePool(url,`-c search_path=${schema}`);
const START=Date.parse('2026-11-11T10:30:00+08:00');
let now=START;
let serial=0;
const service=new GameService(pool,{eventId:'test-event',demo:true,publicUrl:'https://booth.test',secret:'integration-test-secret-is-32-chars',staffPin:'4321'},()=>now);
const signup=(mobile=`0917${String(++serial).padStart(7,'0')}`)=>({name:'Test Player',mobile,email:'test@example.com',company:'Co',role:'CMO',industry:'Agency',challenge:'Proving ROI',planning:'Yes',consent:true,optin:false,source:'phone'});
async function register(input=signup(),key=randomUUID()) {
  const c=await service.content();
  return service.signup({...input,contentVersion:c.version,consentVersion:c.consentVersion},key);
}
async function play(token:string,audience='genz') {
  await service.audience(token,audience);
  for(let i=0;i<3;i++){
    await service.start(token,i);
    await service.lock(token,i,{pick:i===2?'a':'b',conf:2,clientMs:5000});
  }
  return service.finish(token);
}
beforeAll(async()=>{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(await readFile('migrations/001_initial.sql','utf8'));
});
beforeEach(async()=>{
  now=START;
  await pool.query('TRUNCATE events,content_versions,staff_sessions,login_throttles CASCADE');
  const seed=await loadSeed(true,START);
  seed.schedule={totalCap:300,days:['2026-11-11'],blocks:[{start:'10:00',end:'12:00',allocation:100},{start:'12:00',end:'18:00',allocation:200}]};
  await seedEvent(pool,'test-event',true,seed);
});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});

test('registration is idempotent under concurrent retries and rejects reused numbers',async()=>{
  const input=signup(),key=randomUUID();
  const responses=await Promise.all(Array.from({length:8},()=>register(input,key)));
  expect(new Set(responses.map(r=>r.token)).size).toBe(1);
  expect((await pool.query('SELECT count(*)::int n FROM players')).rows[0].n).toBe(1);
  await expect(register({...input,name:'Changed'},key)).rejects.toMatchObject({code:'idempotency_conflict'});
  await expect(register({...input,mobile:input.mobile.replace('0917','0917 ')})).rejects.toMatchObject({code:'duplicate_mobile'});
});
test('complete game has authoritative scoring, resume and immutable retries',async()=>{
  const {token}=await register();
  await expect(service.start(token,0)).rejects.toMatchObject({code:'out_of_order'});
  await service.audience(token,'genz');
  await service.start(token,0);now+=10_000;
  expect((await service.current(token)).startedRound?.elapsedMs).toBe(10_000);
  const first=await service.lock(token,0,{pick:'b',conf:2,clientMs:1000});
  expect(first.result.bonus).toBe(23);
  expect(await service.lock(token,0,{})).toEqual(first);
  await expect(service.audience(token,'moms')).rejects.toMatchObject({code:'audience_locked'});
  await expect(service.finish(token)).rejects.toMatchObject({code:'rounds_incomplete'});
  for(const i of [1,2]){await service.start(token,i);now+=5000;await service.lock(token,i,{pick:i===2?'a':'b',conf:2,clientMs:5000});}
  const me=await service.finish(token);
  expect(me.score).toBe(673);expect(me.persona).toBe('The Crowd Whisperer');expect(me.gc?.status).toBe('awarded');
  expect(await service.finish(token)).toEqual(me);
  expect((await service.board()).stat).toEqual({picks:3,matches:3,pct:100});
});
test('late submission becomes timeout; invalid inputs cannot change the round',async()=>{
  const {token}=await register();await service.audience(token,'moms');await service.start(token,0);
  await expect(service.lock(token,0,{pick:'a',conf:99,clientMs:0})).rejects.toMatchObject({status:400});
  now+=45_001;
  const reveal=await service.lock(token,0,{pick:'a',conf:2,clientMs:1000});
  expect(reveal.result).toMatchObject({pick:null,points:0,bonus:0,msUsed:30_000});
  expect((await service.board()).stat.picks).toBe(0);
});
test('25 concurrent players complete with unique rewards and retried finishes do not increment inventory',async()=>{
  const registrations=await Promise.all(Array.from({length:25},()=>register()));
  const games=await Promise.all(registrations.map(r=>play(r.token)));
  const codes=games.map(g=>g.gc?.status==='awarded'?g.gc.code:null);
  expect(codes.every(Boolean)).toBe(true);expect(new Set(codes).size).toBe(25);
  await Promise.all(registrations.map(r=>service.finish(r.token)));
  expect((await service.event()).awarded_count).toBe(25);
  expect((await service.board()).leaderboard).toHaveLength(10);
  expect((await service.board()).stat.picks).toBe(75);
});
test('last two of 300 rewards are awarded once under concurrent finishes',async()=>{
  now=Date.parse('2026-11-11T13:00:00+08:00');
  const c=await service.content();
  // Fixture represents 298 already completed and reserved games before this burst.
  await pool.query(`INSERT INTO players(id,event_id,content_version,signup_key,signup_digest,source,name,mobile,email,company,role,industry,challenge,planning,consent_version,consent_text,consent_at,marketing_optin,created_at,session_expires,finished_at,score,total_ms,correct,persona)
    SELECT gen_random_uuid(),'test-event',$1,'fixture-'||n,'fixture','phone','Earlier Player','0999'||lpad(n::text,7,'0'),'old@example.com','Co','Role','Agency','Proving ROI','No','v1','Consent',$2,false,$2,$3,$2,0,90000,0,'Fresh Eyes' FROM generate_series(1,298)n`,[c.version,now,now+86400_000]);
  await pool.query("INSERT INTO claims(player_id,event_id,code,awarded_at) SELECT id,event_id,'F'||lpad(row_number() OVER()::text,5,'0'),$1 FROM players",[now]);
  await pool.query("UPDATE events SET awarded_count=298 WHERE id='test-event'");
  const registrations=await Promise.all(Array.from({length:25},()=>register()));
  const games=await Promise.all(registrations.map(r=>play(r.token)));
  expect(games.filter(g=>g.gc?.status==='awarded')).toHaveLength(2);
  expect(games.filter(g=>g.gc?.status==='waiting')).toHaveLength(23);
  await Promise.all(registrations.map(r=>service.retryAward(r.token)));
  expect((await service.event()).awarded_count).toBe(300);
  expect((await pool.query('SELECT count(*)::int n FROM claims')).rows[0].n).toBe(300);
  expect((await service.board()).gc).toEqual({availableNow:0,leftToday:0,nextDropAt:null});
});
test('block exhaustion, next release, and inventory rollover',async()=>{
  await pool.query('UPDATE gc_blocks SET allocation=1');
  const one=await register(),two=await register();await play(one.token);
  const waiting=await play(two.token);
  expect(waiting.gc).toMatchObject({status:'waiting',nextDropAt:Date.parse('2026-11-11T12:00:00+08:00')});
  now=Date.parse('2026-11-11T12:00:00+08:00');
  expect((await service.retryAward(two.token)).gc?.status).toBe('awarded');
  expect((await service.event()).awarded_count).toBe(2);
});
test('staff auth survives a second app instance and confirmation is single-use',async()=>{
  const {token}=await register();const me=await play(token);const code=me.gc?.status==='awarded'?me.gc.code:'';
  await expect(service.lookup('',code)).rejects.toMatchObject({status:401});
  const staff=await service.login('4321','staff-ip');
  const second=new GameService(pool,service.options,()=>now);
  expect((await second.lookup(staff,code.toLowerCase())).mobile).toMatch(/^09\d{9}$/);
  await expect(second.claim(staff,code,{confirmedNumber:true})).rejects.toMatchObject({status:400});
  const claims=await Promise.all(Array.from({length:8},()=>second.claim(staff,code,{confirmedNumber:true,fulfillmentConfirmed:true})));
  expect(claims.every(c=>c.claimed)).toBe(true);
  expect((await service.summary(staff)).kpis.claimedToday).toBe(1);
  await service.logout(staff);await expect(second.staff(staff)).rejects.toMatchObject({status:401});
});
test('PIN lockout is shared between instances and expires',async()=>{
  for(let i=0;i<5;i++)await expect(service.login('0000','ip')).rejects.toMatchObject({status:401});
  const second=new GameService(pool,service.options,()=>now);
  await expect(second.login('4321','ip')).rejects.toMatchObject({status:429});
  now+=15*60_000;
  expect(await second.login('4321','ip')).toBeTruthy();
});
test('published content changes cannot alter an existing player’s reveals',async()=>{
  const {token}=await register();
  const p=await service.player(token);const c=await service.storedContent(p.content_version);
  const changed=structuredClone(c);changed.id='new-version';changed.audiences[0].rounds[0].winner='a';changed.audiences[0].rounds[0].split={a:80,b:20};
  await pool.query('INSERT INTO content_versions(id,audiences,respondents,created_at) VALUES($1,$2,$3,$4)',[changed.id,JSON.stringify(changed.audiences),JSON.stringify(changed.respondents),now]);
  await pool.query('UPDATE events SET active_content=$1',[changed.id]);
  await service.audience(token,'genz');await service.start(token,0);
  expect((await service.lock(token,0,{pick:'b',conf:2,clientMs:5000})).winner).toBe('b');
  expect((await service.current(token)).content.version).toBe(c.id);
});
