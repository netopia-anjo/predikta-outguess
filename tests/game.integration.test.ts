import { beforeAll,beforeEach,afterAll,test,expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { makePool } from '../src/server/db';
import { GameService } from '../src/server/service';
import { loadSeed } from '../src/server/content';
import { seedEvent } from '../src/server/seed';
import { prizeWheelDisplay } from '../src/shared/prizes';
import { wheelSnapshot } from '../src/server/prize-odds';
import { exportCsv } from '../src/server/csv';
import type { PublicRound, Side } from '../src/shared/types';

const winningSide=(round:PublicRound):Side=>round.a.image?.includes('-b-')?'a':'b';

const url=process.env.TEST_DATABASE_URL||'postgresql://outguess:outguess@127.0.0.1:5434/outguess';
const schema=`test_${randomUUID().replaceAll('-','')}`;
const admin=makePool(url);
const pool=makePool(url,`-c search_path=${schema}`);
const START=Date.parse('2026-11-11T10:30:00+08:00');
let now=START;
let serial=0;
const service=new GameService(pool,{eventId:'test-event',demo:true,publicUrl:'https://booth.test',secret:'integration-test-secret-is-32-chars',staffPin:'4321'},()=>now,max=>max===100?99:0);
const signup=(mobile=`0917${String(++serial).padStart(7,'0')}`)=>({name:'Test Player',mobile,email:'test@example.com',company:'Co',role:'CMO',industry:'Agency',challenge:'Proving ROI',planning:'Yes',consent:true,optin:false,source:'phone'});
async function register(input=signup(),key=randomUUID()) {
  const c=await service.content();
  return service.signup({...input,contentVersion:c.version,consentVersion:c.consentVersion},key);
}
async function play(token:string,audience='genz') {
  const selected=await service.audience(token,audience);
  const rounds=selected.content.audiences.find(a=>a.id===audience)!.rounds;
  for(let i=0;i<3;i++){
    await service.start(token,i);
    await service.lock(token,i,{pick:winningSide(rounds[i]),conf:2,clientMs:5000});
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
  const selected=await service.audience(token,'genz');
  const rounds=selected.content.audiences.find(a=>a.id==='genz')!.rounds;
  await service.start(token,0);now+=10_000;
  expect((await service.current(token)).startedRound?.elapsedMs).toBe(10_000);
  const first=await service.lock(token,0,{pick:winningSide(rounds[0]),conf:2,clientMs:1000});
  expect(first.result.bonus).toBe(23);
  expect(await service.lock(token,0,{})).toEqual(first);
  await expect(service.audience(token,'moms')).rejects.toMatchObject({code:'audience_locked'});
  await expect(service.finish(token)).rejects.toMatchObject({code:'rounds_incomplete'});
  for(const i of [1,2]){await service.start(token,i);now+=5000;await service.lock(token,i,{pick:winningSide(rounds[i]),conf:2,clientMs:5000});}
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
  await service.updateInventory(staff,{day:1,revision:inventory.revision,totals:Object.fromEntries(inventory.items.map(p=>[p.id,p.id==='pouch'?1:0]))});
  const games=await Promise.all([register(),register()]);
  const finished=await Promise.all(games.map(p=>play(p.token)));
  const results=await Promise.allSettled(finished.map(p=>service.claim(staff,p.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true,day:1})));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const rejected=results.find(r=>r.status==='rejected');
  expect(rejected?.status==='rejected'&&rejected.reason.code).toBe('out_of_stock');
  expect((await service.inventory()).remaining).toBe(0);
  expect((await service.inventory()).fulfilled).toBe(1);
});
test('prize fulfillment: stock edits, restocking and seeding preserve saved totals',async()=>{
  const staff=await service.login('4321','inventory-staff');const initial=await service.inventory();
  const totals=Object.fromEntries(initial.items.map(p=>[p.id,p.id==='gcash_100'?100:0]));
  const stocked=await service.updateInventory(staff,{day:1,revision:initial.revision,totals});
  expect(stocked.cashRemainingPhp).toBe(10000);
  await expect(service.updateInventory(staff,{day:1,revision:initial.revision,totals})).rejects.toMatchObject({code:'inventory_changed'});
  await expect(service.updateInventory(staff,{day:1,revision:stocked.revision,totals:{...totals,pouch:-1}})).rejects.toMatchObject({code:'invalid_inventory'});
  await expect(service.updateInventory(staff,{day:1,revision:stocked.revision,totals:{...totals,pouch:.5}})).rejects.toMatchObject({code:'invalid_inventory'});
  const player=await register();const finished=await play(player.token);
  const result=await service.claim(staff,finished.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true,day:1});
  expect(result.prize?.id).toBe('gcash_100');expect(result.wheel?.items).toHaveLength(2);
  const drawn=await service.inventory();expect(drawn.cashRemainingPhp).toBe(9900);
  await expect(service.updateInventory(staff,{day:1,revision:drawn.revision,totals:{...totals,gcash_100:0}})).rejects.toMatchObject({code:'below_fulfilled'});
  await seedEvent(pool,'test-event',true,await loadSeed(true));expect(await service.inventory()).toEqual(drawn);
  now+=86400_000;expect(await service.inventory()).toEqual(drawn);
  const nextDayStaff=await service.login('4321','inventory-staff');
  const restocked=await service.updateInventory(nextDayStaff,{day:1,revision:drawn.revision,totals:{...totals,gcash_100:101}});
  expect(restocked.items.find(p=>p.id==='gcash_100')?.remaining).toBe(100);
});
test('prize fulfillment: historical claims are not redrawn or charged to new stock',async()=>{
  const player=await register();const finished=await play(player.token);const code=finished.reward!.code!;
  await pool.query('UPDATE claims SET claimed_at=$1 WHERE code=$2',[now,code]);
  const staff=await service.login('4321','historical-staff');
  const result=await service.claim(staff,code,{confirmedNumber:true,fulfillmentConfirmed:true,day:1});
  expect(result).toMatchObject({claimed:true,legacy:true,prize:null,replayed:true,wheel:null});
  expect((await service.inventory()).fulfilled).toBe(0);
});
test('prize fulfillment: both signup profiles require five fields and consent',async()=>{
  const minimal={...signup(),source:'tv',industry:'',challenge:'',planning:''};
  const tv=await register(minimal);
  expect((await pool.query('SELECT industry,challenge,planning,marketing_optin FROM players WHERE id=$1',[tv.me.id])).rows[0]).toEqual({industry:null,challenge:null,planning:null,marketing_optin:false});
  const phone=await register({...minimal,mobile:signup().mobile,source:'phone'});
  expect(phone.me.profile.complete).toBe(false);
  const content=await service.content();
  await expect(service.signup({...minimal,mobile:signup().mobile,consent:false,contentVersion:content.version,consentVersion:content.consentVersion},randomUUID())).rejects.toMatchObject({code:'invalid'});
});
test('prize fulfillment: staff auth across instances and duplicate fulfillment are single-use',async()=>{
  const {token}=await register();const me=await play(token);const code=me.reward?.code??'';
  await expect(service.lookup('',code)).rejects.toMatchObject({status:401});
  const staff=await service.login('4321','staff-ip');
  const stock=await service.inventory();await service.updateInventory(staff,{day:1,revision:stock.revision,totals:Object.fromEntries(stock.items.map(p=>[p.id,p.id==='pouch'?1:0]))});
  const second=new GameService(pool,service.options,()=>now,max=>max===100?99:0);
  expect((await second.lookup(staff,code.toLowerCase())).mobile).toMatch(/^09\d{9}$/);
  await expect(second.claim(staff,code,{confirmedNumber:true})).rejects.toMatchObject({status:400});
  const claims=await Promise.all(Array.from({length:8},()=>second.claim(staff,code,{confirmedNumber:true,fulfillmentConfirmed:true,day:1})));
  expect(claims.every(c=>c.claimed&&c.prize?.id==='pouch')).toBe(true);
  expect(claims.filter(c=>!c.replayed)).toHaveLength(1);expect((await service.inventory()).fulfilled).toBe(1);
  expect((await service.summary(staff)).kpis.claimedToday).toBe(1);
  await service.logout(staff);await expect(second.staff(staff)).rejects.toMatchObject({status:401});
});
test('PIN lockout is shared between instances and expires',async()=>{
  for(let i=0;i<5;i++)await expect(service.login('0000','ip')).rejects.toMatchObject({status:401});
  const second=new GameService(pool,service.options,()=>now,max=>max===100?99:0);
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
  const selected=await service.audience(token,'genz');await service.start(token,0);
  const winner=winningSide(selected.content.audiences.find(a=>a.id==='genz')!.rounds[0]);
  expect((await service.lock(token,0,{pick:winner,conf:2,clientMs:5000})).winner).toBe(winner);
  expect((await service.current(token)).content.version).toBe(c.id);
});


test.each(['phone','tv'])('campaign questions: %s saves results before answers and issues one retry-safe code',async source=>{
  const player=await register({...signup(),source,industry:'',challenge:'',planning:''});
  const answers={industry:'Agency',challenge:'Proving ROI',planning:'Yes'};
  await expect(service.profile(player.token,answers)).rejects.toMatchObject({code:'rounds_incomplete'});
  const finished=await play(player.token);
  expect(finished.finished).toBe(true);expect(finished.score).toBeGreaterThan(0);
  expect(finished.reward?.code).toBeNull();expect(finished.profile.complete).toBe(false);
  await expect(service.retryAward(player.token)).rejects.toMatchObject({code:'profile_required'});
  await expect(service.profile(player.token,{...answers,industry:'invalid',planning:''})).rejects.toMatchObject({code:'invalid',details:{errors:{industry:'Choose an industry.',planning:'Pick one.'}}});
  expect((await service.current(player.token)).reward?.code).toBeNull();
  const saved=await Promise.all(Array.from({length:3},()=>service.profile(player.token,answers)));
  expect(saved[0].profile).toEqual({...answers,complete:true});
  expect(saved[0].reward?.code).toBeTruthy();
  expect(new Set(saved.map(p=>p.reward!.code)).size).toBe(1);
  expect((await service.current(player.token)).reward?.code).toBe(saved[0].reward?.code);
  expect((await service.retryAward(player.token)).reward?.code).toBe(saved[0].reward?.code);
  expect((await service.finish(player.token)).score).toBe(finished.score);
  expect((await service.inventory()).fulfilled).toBe(0);
  const staff=await service.login('4321','campaign-staff');
  expect((await service.summary(staff)).leads).toContainEqual(expect.objectContaining({name:'Test Player',challenge:'Proving ROI',planning:'Yes'}));
  expect(await service.exportRows(staff)).toContainEqual(expect.objectContaining(answers));
});

test('campaign questions: previously issued codes survive missing campaign answers and fulfillment',async()=>{
  const player=await register();const finished=await play(player.token);const code=finished.reward!.code!;
  await pool.query('UPDATE players SET industry=NULL,challenge=NULL,planning=NULL WHERE id=$1',[player.me.id]);
  expect((await service.current(player.token)).profile.complete).toBe(false);
  expect((await service.retryAward(player.token)).reward?.code).toBe(code);
  const staff=await service.login('4321','old-code-staff');
  const inventory=await service.inventory();
  await service.updateInventory(staff,{day:1,revision:inventory.revision,totals:Object.fromEntries(inventory.items.map(p=>[p.id,p.id==='pouch'?1:0]))});
  await service.claim(staff,code,{confirmedNumber:true,fulfillmentConfirmed:true,day:1});
  expect((await service.current(player.token)).reward).toMatchObject({code,claimed:true,prize:{id:'pouch'}});
});


test('daily prizes: allocations, day switches and inactive-day edits remain separate',async()=>{
  const initial=await service.inventory();
  expect(initial.activeDay).toBe(1);expect(initial.packagePoolValuePhp).toBe(750000);
  expect(initial.days.map(day=>[day.total,day.remaining,day.cashRemainingPhp])).toEqual([[155,155,15500],[155,155,15500]]);
  const staff=await service.login('4321','daily-stock');
  const player=await register();const finished=await play(player.token);
  const drawn=await service.claim(staff,finished.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true,day:1});
  expect(drawn).toMatchObject({outcome:'prize',prizeDay:1,prize:{id:'tote_bag_rope'}});
  const beforeSwitch=await service.inventory();
  const day2=await service.switchPrizeDay(staff,{day:2,revision:beforeSwitch.revision});
  expect(day2.remaining).toBe(155);expect(day2.days[0].remaining).toBe(154);
  await expect(service.switchPrizeDay(staff,{day:1,revision:beforeSwitch.revision})).rejects.toMatchObject({code:'inventory_changed'});
  const pending=await register();const game=await play(pending.token);
  await expect(service.claim(staff,game.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true,day:1})).rejects.toMatchObject({code:'inventory_changed'});
  expect((await service.lookup(staff,game.reward!.code!)).claimed).toBe(false);
  const totals=Object.fromEntries(day2.days[0].items.map(p=>[p.id,p.total+(p.id==='pouch'?1:0)]));
  const edited=await service.updateInventory(staff,{day:1,revision:day2.revision,totals});
  expect(edited.remaining).toBe(155);expect(edited.days[0].items.find(p=>p.id==='pouch')?.total).toBe(26);
  await seedEvent(pool,'test-event',true,await loadSeed(true));expect(await service.inventory()).toEqual(edited);
  now+=86400_000;expect(await service.inventory()).toEqual(edited);
});

test('daily prizes: the 15 percent boundary closes no-prize draws without consuming stock',async()=>{
  const missService=new GameService(pool,service.options,()=>now,()=>14);
  const winService=new GameService(pool,service.options,()=>now,max=>max===100?15:0);
  const staff=await service.login('4321','no-prize');
  const player=await register();const finished=await play(player.token);
  const initial=await service.inventory();
  const result=await missService.claim(staff,finished.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true,day:1});
  expect(result).toMatchObject({claimed:true,outcome:'no_prize',legacy:false,prize:null,prizeDay:1});
  expect(result.wheel?.prizeId).toBe('no_prize');
  expect(result.wheel?.items[0]).toMatchObject({id:'no_prize',remaining:null});
  expect(JSON.stringify(result.wheel)).not.toContain('probability');
  const stored=(await pool.query('SELECT wheel_snapshot FROM claims WHERE code=$1',[result.code])).rows[0].wheel_snapshot;
  expect(stored.items[0].probability).toBe(.15);
  const current=await service.inventory();expect(current.days).toEqual(initial.days);
  const repeats=await Promise.all(Array.from({length:4},()=>winService.claim(staff,result.code,{confirmedNumber:true,fulfillmentConfirmed:true,day:2})));
  expect(repeats.every(r=>r.outcome==='no_prize'&&r.replayed)).toBe(true);
  expect((await service.current(player.token)).reward).toMatchObject({outcome:'no_prize',claimed:true,legacy:false});
  const summary=await service.summary(staff);expect(summary.kpis.claimedToday).toBe(0);expect(summary.kpis.noPrizeDraws).toBe(1);expect(summary.pending).toHaveLength(0);
  expect(summary.leads[0].claimed).toBe(false);
  expect(summary.leads[0].drawComplete).toBe(true);
  const rows=await service.exportRows(staff);expect(rows[0]).toMatchObject({draw_outcome:'no_prize',prize_id:null});
  expect(exportCsv(rows,true)).toContain('"Thank you for playing"');
  const next=await register();const game=await play(next.token);
  const won=await winService.claim(staff,game.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true,day:1});
  expect(won.outcome).toBe('prize');expect((await service.inventory()).remaining).toBe(154);
  await register({...signup(),name:'Undrawn Lead'});
  const leads=(await service.summary(staff)).leads;
  expect(leads.filter(p=>p.drawComplete)).toHaveLength(2);
  expect(leads.filter(p=>p.claimed)).toHaveLength(1);
  expect(leads.find(p=>p.name==='Undrawn Lead')).toMatchObject({claimed:false,drawComplete:false});
});

test('daily prizes: package value is separate from cash, and depleted stock blocks spins',async()=>{
  const staff=await service.login('4321','package-staff');const inventory=await service.inventory();
  const totals=Object.fromEntries(inventory.items.map(p=>[p.id,p.id==='predikta_package'?1:0]));
  await service.updateInventory(staff,{day:1,revision:inventory.revision,totals});
  const player=await register();const finished=await play(player.token);
  const result=await service.claim(staff,finished.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true,day:1});
  expect(result.prize).toMatchObject({id:'predikta_package',amountPhp:null,valuePhp:75000});
  expect((await service.inventory()).cashRemainingPhp).toBe(0);
  expect(result.wheel?.items.map(p=>p.id)).toEqual(['no_prize','predikta_package']);
  expect(JSON.stringify(result.wheel)).not.toContain('probability');
  const next=await register();const game=await play(next.token);
  const missService=new GameService(pool,service.options,()=>now,()=>0);
  await expect(missService.claim(staff,game.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true,day:1})).rejects.toMatchObject({code:'out_of_stock'});
  expect((await service.lookup(staff,game.reward!.code!)).claimed).toBe(false);
  expect((await service.inventory()).days[1].remaining).toBe(155);
});

test('daily prizes: concurrent day switch and draw cannot consume the wrong day',async()=>{
  const staff=await service.login('4321','day-race');const player=await register();const game=await play(player.token);
  const initial=await service.inventory();
  const results=await Promise.allSettled([
    service.switchPrizeDay(staff,{day:2,revision:initial.revision}),
    service.claim(staff,game.reward!.code!,{confirmedNumber:true,fulfillmentConfirmed:true,day:1}),
  ]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const rejected=results.find(r=>r.status==='rejected');expect(rejected?.status==='rejected'&&rejected.reason.code).toBe('inventory_changed');
  const inventory=await service.inventory();expect(inventory.days[1].fulfilled).toBe(0);
});


test('package odds: stored roles determine weighted draws and saved results never change on retries',async()=>{
  const draws:number[]=[];
  const biased=new GameService(pool,service.options,()=>now,max=>{draws.push(max);return max===100?99:max>1000?6190:482;});
  const staff=await service.login('4321','role-weight-staff');
  for(const role of ['Marketing Manager','VP of Marketing','Head of Marketing','CMO','Marketing Director']){
    const player=await register({...signup(),role});const finished=await play(player.token);
    const before=await service.inventory();
    const result=await biased.claim(staff,finished.reward!.code!,{day:1,confirmedNumber:true,fulfillmentConfirmed:true,role:role==='Marketing Manager'?'CMO':'Marketing Manager'});
    const expectedId=role==='Marketing Manager'?'gcash_100':'predikta_package';
    expect(result.prize?.id).toBe(expectedId);
    expect(result.wheel).toEqual(prizeWheelDisplay(before.items,expectedId));
    expect(JSON.stringify(result.wheel)).not.toContain('probability');
    const snapshot=(await pool.query('SELECT wheel_snapshot FROM claims WHERE code=$1',[result.code])).rows[0].wheel_snapshot;
    expect(snapshot).toEqual(wheelSnapshot(before.items,expectedId,role));
    const calls=draws.length;
    const replay=await biased.claim(staff,result.code,{day:2,confirmedNumber:true,fulfillmentConfirmed:true,role:'CMO'});
    expect(replay).toMatchObject({replayed:true,prizeDay:1,prize:{id:expectedId}});
    expect(draws).toHaveLength(calls);
    expect((await service.current(player.token)).reward?.prize?.id).toBe(expectedId);
  }
  const inventory=await service.inventory();
  expect(inventory.fulfilled).toBe(5);expect(inventory.items.find(p=>p.id==='predikta_package')?.remaining).toBe(1);
  expect(inventory.days[1].remaining).toBe(155);
});


test('ad shuffle: saved assignments map winners and splits, reject malformed arrays and preserve NULL games',async()=>{
  const player=await register();await service.audience(player.token,'genz');
  await pool.query('UPDATE players SET round_swaps=$2 WHERE id=$1',[player.me.id,[true,false,true]]);
  const selected=await service.current(player.token);
  const rounds=selected.content.audiences.find(a=>a.id==='genz')!.rounds;
  expect(rounds.map(winningSide)).toEqual(['a','b','a']);
  await Promise.all(Array.from({length:3},async()=>expect((await service.audience(player.token,'genz')).content).toEqual(selected.content)));
  for(const invalid of [[true,false],[true,null,false]])await expect(pool.query('UPDATE players SET round_swaps=$2 WHERE id=$1',[player.me.id,invalid])).rejects.toMatchObject({code:'23514'});
  for(let i=0;i<3;i++){
    await service.start(player.token,i);
    const winner=winningSide(rounds[i]);
    const reveal=await service.lock(player.token,i,{pick:winner,conf:2,clientMs:5000});
    expect(reveal.result.correct).toBe(true);expect(reveal.winner).toBe(winner);expect(reveal.split![winner]).toBeGreaterThan(50);
    expect(reveal.reactions.every(r=>r.respondent.includes('simulated reaction'))).toBe(true);
    expect(await service.lock(player.token,i,{pick:winner==='a'?'b':'a',conf:0,clientMs:30_000})).toEqual(reveal);
    expect((await service.current(player.token)).content).toEqual(selected.content);
  }
  expect((await service.finish(player.token)).correct).toBe(3);
  const oldPlayer=await register();await service.audience(oldPlayer.token,'moms');
  await pool.query('UPDATE players SET round_swaps=NULL WHERE id=$1',[oldPlayer.me.id]);
  const old=await service.current(oldPlayer.token);
  expect(old.content.audiences.find(a=>a.id==='moms')!.rounds.map(winningSide)).toEqual(['b','b','b']);
  expect((await service.audience(oldPlayer.token,'moms')).content).toEqual(old.content);
});

test.each(['phone','tv'])('ad selection: %s receives three unique stable pairs with shuffled original-B winners',async source=>{
  const player=await register({...signup(),source});
  const full=(await service.content()).audiences.find(a=>a.id==='genz')!;
  expect(full.rounds).toHaveLength(5);
  const selected=await service.audience(player.token,'genz');
  const rounds=selected.content.audiences.find(a=>a.id==='genz')!.rounds;
  const stored=(await pool.query('SELECT round_indices,round_swaps FROM players WHERE id=$1',[player.me.id])).rows[0];
  const indices=stored.round_indices as number[],swaps=stored.round_swaps as boolean[];
  expect(swaps).toHaveLength(3);expect(swaps.every(s=>typeof s==='boolean')).toBe(true);
  expect(indices).toHaveLength(3);expect(new Set(indices).size).toBe(3);expect(indices.every(i=>i>=0&&i<5)).toBe(true);
  expect(rounds).toEqual(indices.map((i,idx)=>swaps[idx]?{...full.rounds[i],a:full.rounds[i].b,b:full.rounds[i].a}:full.rounds[i]));
  expect((await service.audience(player.token,'genz')).content).toEqual(selected.content);
  expect((await service.current(player.token)).content).toEqual(selected.content);
  for(let i=0;i<3;i++){
    await service.start(player.token,i);
    const winner=winningSide(rounds[i]);
    const reveal=await service.lock(player.token,i,{pick:i===0?(winner==='a'?'b':'a'):winner,conf:2,clientMs:5000});
    const sourceRound=(await loadSeed(true)).content.audiences[0].rounds[indices[i]];
    expect(reveal).toMatchObject({winner,insightSource:'illustrative',emotion:sourceRound.emotion,driver:sourceRound.driver,result:{correct:i!==0}});
    expect(reveal.split).toEqual(swaps[i]?{a:sourceRound.split!.b,b:sourceRound.split!.a}:sourceRound.split);
    expect(reveal.reactions).toHaveLength(2);
    expect(await service.lock(player.token,i,{})).toEqual(reveal);
  }
  await expect(service.start(player.token,3)).rejects.toMatchObject({code:'invalid_round'});
  const finished=await service.finish(player.token);expect(finished.rounds).toHaveLength(3);expect(finished.correct).toBe(2);
  const inventory=await service.inventory();
  await seedEvent(pool,'test-event',true,await loadSeed(true));
  expect((await service.current(player.token)).content).toEqual(selected.content);
  expect(await service.inventory()).toEqual(inventory);
});

test('ad selection: legacy games keep original content, order, answers and insights after reseeding',async()=>{
  const legacy=JSON.parse(await readFile('tests/fixtures/legacy-content.json','utf8'));
  const latest=await loadSeed(true);
  await seedEvent(pool,'test-event',true,{...latest,content:{id:'legacy-ad-import-check',...legacy}});
  const player=await register();await service.audience(player.token,'genz');
  // Simulate a player whose game began before round-selection/swap storage existed.
  await pool.query('UPDATE players SET round_indices=NULL,round_swaps=NULL WHERE id=$1',[player.me.id]);
  const selected=await service.current(player.token);
  expect((await service.audience(player.token,'genz')).content).toEqual(selected.content);
  await service.start(player.token,0);
  await seedEvent(pool,'test-event',true,latest);
  const resumed=await service.current(player.token);
  expect(resumed.content).toEqual(selected.content);expect(resumed.startedRound?.idx).toBe(0);
  expect((await service.audience(player.token,'genz')).content).toEqual(selected.content);
  for(let i=0;i<3;i++){
    if(i>0)await service.start(player.token,i);
    const old=legacy.audiences[0].rounds[i];
    const reveal=await service.lock(player.token,i,{pick:old.winner,conf:2,clientMs:5000});
    expect(reveal.winner).toBe(old.winner);expect(reveal.split).toEqual(old.split);
    expect(reveal.emotion).toBe(old.emotion);expect(reveal.reactions).toHaveLength(2);
  }
  const finished=await service.finish(player.token);expect(finished.correct).toBe(3);expect(finished.reward?.code).toBeTruthy();
});
