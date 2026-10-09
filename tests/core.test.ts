import { describe,test,expect } from 'vitest';
import { scoreRound,personaOf,summarize,MAX_SCORE } from '../src/shared/rules';
import { validateSignup } from '../src/shared/validation';
import { signToken,verifyToken } from '../src/server/auth';
import { exportCsv,safeCell } from '../src/server/csv';
import { scheduleRows,loadSeed,publicContent,manilaStart } from '../src/server/content';

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
test('demo content hides answers and retains nine ad pairs',async()=>{
  const seed=await loadSeed(true);
  const c=publicContent(seed.content,'https://example.com',true,seed.consentText,seed.consentVersion);
  const text=JSON.stringify(c);
  for(const k of ['"winner"','"split"','"emotion"','"driver"','"reactions"','"surprise"'])expect(text).not.toContain(k);
  expect(c.audiences.reduce((n,a)=>n+a.rounds.length,0)).toBe(9);
});
test('schedule rejects overallocations and overlap; day uses Manila timezone',()=>{
  expect(()=>scheduleRows({totalCap:301,days:['2026-11-11'],blocks:[{start:'10:00',end:'12:00',allocation:301}]})).toThrow();
  expect(()=>scheduleRows({totalCap:300,days:['2026-11-11','2026-11-12'],blocks:[{start:'10:00',end:'12:00',allocation:200}]})).toThrow();
  expect(()=>scheduleRows({totalCap:300,days:['2026-11-11'],blocks:[{start:'10:00',end:'12:00',allocation:100},{start:'11:00',end:'13:00',allocation:100}]})).toThrow();
  expect(manilaStart(Date.parse('2026-11-11T17:00:00Z'))).toBe(Date.parse('2026-11-12T00:00:00+08:00'));
});
