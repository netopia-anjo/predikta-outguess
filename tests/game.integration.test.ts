import { beforeAll,beforeEach,afterAll,test,expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
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
  for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())await pool.query(await readFile(`migrations/${file}`,'utf8'));
});
beforeEach(async()=>{
  now=START;
  await pool.query('TRUNCATE events,content_versions,staff_sessions,login_throttles CASCADE');
  const seed=await loadSeed(true);
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
  expect(me.score).toBe(673);expect(me.persona).toBe('The Crowd Whisperer');expect(me.reward?.code).toBeTruthy();
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
test('25 concurrent players complete with unique claim codes and finishes do not deduct inventory',async()=>{
  const registrations=await Promise.all(Array.from({length:25},()=>register()));
  const games=await Promise.all(registrations.map(r=>play(r.token)));
  const codes=games.map(g=>g.reward?.code??null);
  expect(codes.every(Boolean)).toBe(true);expect(new Set(codes).size).toBe(25);
  await Promise.all(registrations.map(r=>service.finish(r.token)));
  expect((await service.inventory()).fulfilled).toBe(0);
  expect((await service.board()).leaderboard).toHaveLength(10);
  expect((await service.board()).stat.picks).toBe(75);
});
test('prize fulfillment: concurrent requests for the last item deduct only once',async()=>{
  const staff=await service.login('4321','prize-staff');
  const inventory=await service.inventory();
  await service.updateInventory(staff,{revision:inventory.revision,totals:Object.fromEntries(inventory.items.map(p=>[p.id,p.id==='ballpen'?1:0]))});
  const games=await Promise.all([register(),register()]);
  const finished=await Promise.all(games.map(p=>play(p.token)));
  const results=await Promise.allSettled(finished.map(p=>service.claim(staff,p.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true})));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const rejected=results.find(r=>r.status==='rejected');
  expect(rejected?.status==='rejected'&&rejected.reason.code).toBe('out_of_stock');
  expect((await service.inventory()).remaining).toBe(0);
  expect((await service.inventory()).fulfilled).toBe(1);
});
test('prize fulfillment: stock edits, restocking and seeding preserve saved totals',async()=>{
  const staff=await service.login('4321','inventory-staff');const initial=await service.inventory();
  const totals=Object.fromEntries(initial.items.map(p=>[p.id,p.id==='gcash_150'?100:0]));
  const stocked=await service.updateInventory(staff,{revision:initial.revision,totals});
  expect(stocked.cashRemainingPhp).toBe(15000);
  await expect(service.updateInventory(staff,{revision:initial.revision,totals})).rejects.toMatchObject({code:'inventory_changed'});
  await expect(service.updateInventory(staff,{revision:stocked.revision,totals:{...totals,ballpen:-1}})).rejects.toMatchObject({code:'invalid_inventory'});
  await expect(service.updateInventory(staff,{revision:stocked.revision,totals:{...totals,ballpen:.5}})).rejects.toMatchObject({code:'invalid_inventory'});
  const player=await register();const finished=await play(player.token);
  const result=await service.claim(staff,finished.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true});
  expect(result.prize?.id).toBe('gcash_150');expect(result.wheel?.items).toHaveLength(1);
  const drawn=await service.inventory();expect(drawn.cashRemainingPhp).toBe(14850);
  await expect(service.updateInventory(staff,{revision:drawn.revision,totals:{...totals,gcash_150:0}})).rejects.toMatchObject({code:'below_fulfilled'});
  await seedEvent(pool,'test-event',true,await loadSeed(true));expect(await service.inventory()).toEqual(drawn);
  now+=86400_000;expect(await service.inventory()).toEqual(drawn);
  const nextDayStaff=await service.login('4321','inventory-staff');
  const restocked=await service.updateInventory(nextDayStaff,{revision:drawn.revision,totals:{...totals,gcash_150:101}});
  expect(restocked.items.find(p=>p.id==='gcash_150')?.remaining).toBe(100);
});
test('prize fulfillment: historical claims are not redrawn or charged to new stock',async()=>{
  const player=await register();const finished=await play(player.token);const code=finished.reward!.code!;
  await pool.query('UPDATE claims SET claimed_at=$1 WHERE code=$2',[now,code]);
  const staff=await service.login('4321','historical-staff');
  const result=await service.claim(staff,code,{confirmedNumber:true,fulfillmentConfirmed:true});
  expect(result).toMatchObject({claimed:true,legacy:true,prize:null,replayed:true,wheel:null});
  expect((await service.inventory()).fulfilled).toBe(0);
});
test('prize fulfillment: TV signup requires five fields and consent; phone retains qualifiers',async()=>{
  const minimal={...signup(),source:'tv',industry:'',challenge:'',planning:''};
  const tv=await register(minimal);
  expect((await pool.query('SELECT industry,challenge,planning,marketing_optin FROM players WHERE id=$1',[tv.me.id])).rows[0]).toEqual({industry:null,challenge:null,planning:null,marketing_optin:false});
  await expect(register({...minimal,mobile:signup().mobile,source:'phone'})).rejects.toMatchObject({code:'invalid'});
  const content=await service.content();
  await expect(service.signup({...minimal,mobile:signup().mobile,consent:false,contentVersion:content.version,consentVersion:content.consentVersion},randomUUID())).rejects.toMatchObject({code:'invalid'});
});
test('prize fulfillment: staff auth across instances and duplicate fulfillment are single-use',async()=>{
  const {token}=await register();const me=await play(token);const code=me.reward?.code??'';
  await expect(service.lookup('',code)).rejects.toMatchObject({status:401});
  const staff=await service.login('4321','staff-ip');
  const stock=await service.inventory();await service.updateInventory(staff,{revision:stock.revision,totals:Object.fromEntries(stock.items.map(p=>[p.id,p.id==='ballpen'?1:0]))});
  const second=new GameService(pool,service.options,()=>now);
  expect((await second.lookup(staff,code.toLowerCase())).mobile).toMatch(/^09\d{9}$/);
  await expect(second.claim(staff,code,{confirmedNumber:true})).rejects.toMatchObject({status:400});
  const claims=await Promise.all(Array.from({length:8},()=>second.claim(staff,code,{confirmedNumber:true,fulfillmentConfirmed:true})));
  expect(claims.every(c=>c.claimed&&c.prize?.id==='ballpen')).toBe(true);
  expect(claims.filter(c=>!c.replayed)).toHaveLength(1);expect((await service.inventory()).fulfilled).toBe(1);
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
