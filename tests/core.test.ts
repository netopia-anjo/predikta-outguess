import { describe,test,expect } from 'vitest';
import { scoreRound,personaOf,summarize,MAX_SCORE } from '../src/shared/rules';
import { DAILY_QUANTITIES, PRIZES, prizeWheelDisplay } from '../src/shared/prizes';
import { isMarketingLeader, wheelSnapshot } from '../src/server/prize-odds';
import { validateSignup } from '../src/shared/validation';
import { signToken,verifyToken } from '../src/server/auth';
import { exportCsv,safeCell } from '../src/server/csv';
import { scheduleRows,loadSeed,publicContent,manilaStart,validateContent } from '../src/server/content';

describe('game rules',()=>{
  test('the entire scoring table, including zero-point all-in errors',()=>{
    for(const conf of [0,1,2] as const){
      expect(scoreRound('a','a',conf,30_000)).toEqual({correct:true,points:[100,150,200][conf],bonus:0});
      expect(scoreRound('b','a',conf,5000)).toEqual({correct:false,points:[20,20,0][conf],bonus:0});
      expect(scoreRound(null,'a',conf,30_000)).toEqual({correct:false,points:0,bonus:0});
    }
  });
  test('whole seconds, maximum bonus and score',()=>{
    expect(scoreRound('a','a',2,12_300).bonus).toBe(17);
    expect(scoreRound('a','a',2,29_999).bonus).toBe(0);
    expect(scoreRound('a','a',2,0).bonus).toBe(30);
    expect(MAX_SCORE).toBe(690);
  });
  test('all personas and timeout confidence exclusion',()=>{
    expect(personaOf(2,1)).toBe('The Crowd Whisperer');
    expect(personaOf(2,.99)).toBe('The Quiet Strategist');
    expect(personaOf(1,1)).toBe('The Bold Gambler');
    expect(personaOf(0,0)).toBe('Fresh Eyes');
    const s=summarize([{pick:'a',conf:2,correct:true,points:200,bonus:20,msUsed:10_000},{pick:null,conf:0,correct:false,points:0,bonus:0,msUsed:30_000}]);
    expect(s.avgConf).toBe(2);expect(s.totalMs).toBe(40_000);
  });
});
test('signup validates consent, qualifiers and normalized numbers',()=>{
  const good=validateSignup({name:' Bea ',mobile:'0917 123 4567',email:'Bea@example.com',company:'Co',role:'CMO',industry:'Agency',challenge:'Proving ROI',planning:'Yes',consent:true,optin:false});
  expect(good.errors).toEqual({});expect(good.value.mobile).toBe('09171234567');expect(good.value.optin).toBe(false);
  expect(validateSignup({consent:false}).errors.consent).toBeDefined();
  expect(validateSignup({...good.value,consent:true,optin:false,industry:'invalid'}).errors.industry).toBeDefined();
});
test('tokens reject tampering, expiry and wrong audience',()=>{
  const id='f7a39a81-1fc9-4ce3-aea7-5ab730d9a42b';
  const token=signToken(id,2000,'player','secret');
  expect(verifyToken(token,'player','secret',1000)).toBe(id);
  expect(verifyToken(token,'staff','secret',1000)).toBeNull();
  expect(verifyToken(token,'player','secret',2000)).toBeNull();
  expect(verifyToken(token+'x','player','secret',1000)).toBeNull();
});
test('CSV guards formulas, quotes, UTF-8 and excludes nonclaims',()=>{
  for(const s of ['=IMPORTXML("x")',' +123','\t=SUM(1)','@foo','-1'])expect(safeCell(s)).toBe(`'${s}`);
  expect(exportCsv([{name:'=A1',company:'A,"B"',mobile:'09171234567'}])).toContain('"\'=A1"');
  expect(exportCsv([{name:'Nonclaim'}],true)).not.toContain('Nonclaim');
});
test('ad import: public content hides answers and retains all fifteen supplied pairs',async()=>{
  const seed=await loadSeed(true);
  const c=publicContent(seed.content,'https://example.com',true,seed.consentText,seed.consentVersion);
  const text=JSON.stringify(c);
  for(const k of ['"winner"','"split"','"emotion"','"driver"','"reactions"','"surprise"','"insightSource"'])expect(text).not.toContain(k);
  expect(c.audiences.reduce((n,a)=>n+a.rounds.length,0)).toBe(15);
});
test('schedule rejects overallocations and overlap; day uses Manila timezone',()=>{
  expect(()=>scheduleRows({totalCap:301,days:['2026-11-11'],blocks:[{start:'10:00',end:'12:00',allocation:301}]})).toThrow();
  expect(()=>scheduleRows({totalCap:300,days:['2026-11-11','2026-11-12'],blocks:[{start:'10:00',end:'12:00',allocation:200}]})).toThrow();
  expect(()=>scheduleRows({totalCap:300,days:['2026-11-11'],blocks:[{start:'10:00',end:'12:00',allocation:100},{start:'11:00',end:'13:00',allocation:100}]})).toThrow();
  expect(manilaStart(Date.parse('2026-11-11T17:00:00Z'))).toBe(Date.parse('2026-11-12T00:00:00+08:00'));
});


test('package odds: marketing title variants qualify but near-matches do not',()=>{
  for(const role of ['VP of Marketing','vice president of marketing','VP Marketing','Vice President Marketing','Marketing VP','Head of Marketing','Marketing Head','CMO','Chief Marketing Officer','Marketing Director','Director of Marketing','  V.P.,   MARKETING  ','Vice-President of Marketing','Head—of—Marketing','C.M.O.'])expect(isMarketingLeader(role),role).toBe(true);
  for(const role of ['Director','VP','Head','Marketing Manager','Assistant VP of Marketing','Assistant to the Head of Marketing','Former CMO','CMO assistant','Director of Sales','Marketing Director at Example','', 'VP of Marketing / Assistant'])expect(isMarketingLeader(role),role).toBe(false);
});

test('package odds: balanced probabilities preserve no-prize and handle depleted stock',()=>{
  const stock=PRIZES.map(p=>({...p,total:DAILY_QUANTITIES[p.id],fulfilled:0,remaining:DAILY_QUANTITIES[p.id]}));
  const ordinary=wheelSnapshot(stock,'','Marketing Manager');const leader=wheelSnapshot(stock,'','Head of Marketing');
  const display=prizeWheelDisplay(stock,'predikta_package');
  expect(display.items).toEqual(ordinary.items.map(({id,name,remaining})=>({id,name,remaining})));
  expect(display.items).toEqual(leader.items.map(({id,name,remaining})=>({id,name,remaining})));
  expect(JSON.stringify(display)).not.toContain('probability');
  expect(ordinary.items.find(p=>p.id==='predikta_package')?.probability).toBeCloseTo(.85*5/605,8);
  expect(leader.items.find(p=>p.id==='predikta_package')?.probability).toBeCloseTo(.20,8);
  for(const result of [ordinary,leader]){expect(result.items[0].probability).toBe(.15);expect(result.items.reduce((n,p)=>n+p.probability,0)).toBeCloseTo(1);}
  const noPackages=stock.map(p=>p.id==='predikta_package'?{...p,remaining:0}:p);
  expect(wheelSnapshot(noPackages,'','CMO').items.some(p=>p.id==='predikta_package')).toBe(false);
  expect(wheelSnapshot(noPackages,'','CMO')).toEqual(wheelSnapshot(noPackages,'','Marketing Manager'));
  const packageOnly=stock.filter(p=>p.id==='predikta_package');
  for(const role of ['Marketing Manager','CMO'])expect(wheelSnapshot(packageOnly,'',role).items.map(p=>p.probability)).toEqual([.15,.85]);
  expect(wheelSnapshot([], '', 'CMO').items).toEqual([]);
});


test('ad import: supplied images have complete explicitly illustrative insights',async()=>{
  const seed=await loadSeed(true);
  expect(seed.content.respondents).toHaveLength(6);
  expect(seed.content.respondents.every(r=>r.includes('simulated reaction'))).toBe(true);
  for(const audience of seed.content.audiences){
    expect(audience.rounds).toHaveLength(5);
    for(const round of audience.rounds){
      expect(round).toMatchObject({winner:'b',insightSource:'illustrative'});
      expect(round.split!.a+round.split!.b).toBe(100);expect(round.split!.b).toBeGreaterThan(50);
      expect(round.emotion?.trim()).toBeTruthy();expect(round.driver?.trim()).toBeTruthy();
      expect(round.reactions).toHaveLength(2);expect(round.reactions.every(r=>r.trim())).toBe(true);
      expect(round.a.image).toMatch(/-a-[a-f0-9]{12}\.webp$/);
      expect(round.b.image).toMatch(/-b-[a-f0-9]{12}\.webp$/);
    }
  }
  const invalid=structuredClone(seed.content.audiences);invalid[0].rounds[0].split={a:50,b:50};
  expect(()=>validateContent(invalid,seed.content.respondents)).toThrow('Invalid preference split');
});
