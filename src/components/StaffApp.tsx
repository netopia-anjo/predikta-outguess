'use client';
import { useEffect,useRef,useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { api,ApiError } from '@/lib/api';
import { fmt,manilaTime } from '@/lib/hooks';
import { Brand } from './game/bits';
import { InventoryPanel } from './InventoryPanel';
import { PrizeWheel } from './PrizeWheel';
import type { FulfillResult, PrizeInventory, PrizeWheelResult, StaffClaim } from '@/shared/types';
import { NO_PRIZE_LABEL, wheelSnapshot } from '@/shared/prizes';
import { CLAIM_CODE_PATTERN, normalizeClaimCode, validStaffPin } from '@/shared/validation';

type Claim = StaffClaim;
interface Lead {name:string;email:string;company:string;role:string;challenge:string|null;planning:string|null;wantsSim:boolean;claimed:boolean}
interface Summary {
  inventory:PrizeInventory;
  kpis:{playsToday:number;claimedToday:number;remaining:number;hotLeads:number;noPrizeDraws:number};
  pending:{name:string;company:string;code:string;awardedAt:number}[];
  leads:Lead[];
}
function Scanner({onCode,onClose}:{onCode:(s:string)=>void;onClose:()=>void}) {
  const video=useRef<HTMLVideoElement>(null);
  const [error,setError]=useState('');
  const onCodeRef=useRef(onCode);
  useEffect(()=>{onCodeRef.current=onCode;},[onCode]);
  useEffect(()=>{
    let alive=true;
    let controls:IScannerControls|undefined;
    (async()=>{
      try {
        if(!window.isSecureContext||!navigator.mediaDevices)throw new Error('Camera scanning needs HTTPS. Enter the code below instead.');
        const {BrowserQRCodeReader}=await import('@zxing/browser');
        if(!alive||!video.current)return;
        const reader=new BrowserQRCodeReader();
        controls=await reader.decodeFromConstraints({video:{facingMode:'environment'}},video.current,(result,_error,c)=>{
          if(!alive||!result)return;
          const value=result.getText().trim();
          const code=CLAIM_CODE_PATTERN.test(value.toUpperCase())?value:(()=>{try{return new URL(value).searchParams.get('claim')||'';}catch{return '';}})();
          if(!CLAIM_CODE_PATTERN.test(code.toUpperCase()))return;
          alive=false;c.stop();onCodeRef.current(code.toUpperCase());
        });
        if(!alive)controls.stop();
      }catch(e){if(alive)setError(e instanceof Error&&e.message.includes('HTTPS')?e.message:'Camera unavailable. Allow camera access or enter the six-character code.');}
    })();
    return ()=>{alive=false;controls?.stop();};
  },[]);
  return <div className="scanpanel"><video ref={video} muted playsInline aria-label="Claim QR camera preview"/>{error&&<p role="status">{error}</p>}<button className="ghost" onClick={onClose}>Close scanner</button></div>;
}

export function StaffApp() {
  const [auth,setAuth]=useState<'checking'|'out'|'in'>('checking');
  const [pin,setPin]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [summary,setSummary]=useState<Summary|null>(null);
  const [online,setOnline]=useState(true);
  const [code,setCode]=useState('');
  const [claim,setClaim]=useState<Claim|null>(null);
  const [numberConfirmed,setNumberConfirmed]=useState(false);
  const [wheel,setWheel]=useState<PrizeWheelResult|null>(null);
  const [revealing,setRevealing]=useState(false);
  const [scanning,setScanning]=useState(false);
  const [filter,setFilter]=useState('');
  const [codeError,setCodeError]=useState('');
  const operation=useRef(false);
  const begin=()=>{if(operation.current)return false;operation.current=true;setBusy(true);setMessage('');return true;};
  const end=()=>{operation.current=false;setBusy(false);};
  useEffect(()=>{
    let alive=true;
    setCode(new URLSearchParams(window.location.search).get('claim')?.toUpperCase()||'');
    api<{ok:boolean}>('/api/staff/session',{retries:0}).then(r=>{if(alive)setAuth(r.ok?'in':'out');}).catch(()=>{if(alive)setAuth('out');});
    return()=>{alive=false;};
  },[]);
  useEffect(()=>{
    if(auth!=='in')return;
    let alive=true;
    let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{const s=await api<Summary>('/api/staff/summary',{retries:0});if(alive){setSummary(current=>current&&current.inventory.revision>s.inventory.revision?current:s);setOnline(true);}}
      catch(e){if(alive){setOnline(false);if(e instanceof ApiError&&e.status===401){setAuth('out');setSummary(null);setClaim(null);}}}
      if(alive)timer=setTimeout(poll,5000);
    }
    void poll();
    return()=>{alive=false;clearTimeout(timer);};
  },[auth]);
  const fail=(e:unknown,fallback:string)=>{
    if(e instanceof ApiError&&e.status===401&&auth==='in'){setAuth('out');setSummary(null);setClaim(null);setMessage('Session expired. Sign in again.');}
    else setMessage(fallback);
  };
  async function login(e:React.FormEvent){
    e.preventDefault();
    if(operation.current)return;
    const enteredPin=pin.trim();
    if(!validStaffPin(enteredPin)){setMessage('Enter a PIN with 4–12 digits.');return;}
    if(!begin())return;
    try{await api('/api/staff/login',{body:{pin:enteredPin},retries:0});setPin('');setAuth('in');}
    catch(e){setMessage(e instanceof ApiError&&e.status===429?'Too many attempts. Try again in 15 minutes.':e instanceof ApiError&&e.status===401?'That PIN did not match.':'Could not connect. Try again.');}
    finally{end();}
  }
  async function find(value=code){
    if(operation.current)return;
    const clean=normalizeClaimCode(value);
    setCode(clean);setClaim(null);setNumberConfirmed(false);setWheel(null);setMessage('');
    if(!CLAIM_CODE_PATTERN.test(clean)){setCodeError('Enter the six-character code shown on the player’s reward screen.');return;}
    setCodeError('');
    if(!begin())return;
    try{setClaim(await api<Claim>(`/api/staff/claims/${encodeURIComponent(clean)}`,{retries:1}));}
    catch(e){fail(e,e instanceof ApiError&&e.status===404?'No reward found for that code.':'Could not look up the reward. Try again.');}
    finally{end();}
  }
  async function fulfill(){
    if(!claim||claim.claimed||!numberConfirmed||!summary||!begin())return;
    setScanning(false);setWheel(null);setRevealing(true);
    try {
      const result=await api<FulfillResult>(`/api/staff/claims/${claim.code}/claim`,{body:{confirmedNumber:true,fulfillmentConfirmed:true,day:summary.inventory.activeDay},retries:2});
      setClaim(result);
      if(result.wheel&&!result.replayed) {
        setWheel(result.wheel);
        await new Promise(resolve=>setTimeout(resolve,window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:3100));
      }
      setMessage(result.replayed?'This draw is already complete. The saved result is shown.':result.outcome==='no_prize'?'Draw complete. No prize this time.':'Prize draw recorded. Hand the saved prize to the player.');
      try{const updated=await api<Summary>('/api/staff/summary',{retries:0});setSummary(current=>current&&current.inventory.revision>updated.inventory.revision?current:updated);}catch{/* Scheduled polling will reconnect. */}
    } catch(error) {
      fail(error,error instanceof ApiError&&error.code==='out_of_stock'?'Prizes are out of stock for the active day. Restock or activate the next day.':error instanceof ApiError&&error.code==='inventory_changed'?'The active day changed. Review the current day before drawing again.':'Could not confirm the draw. Find this code again to check the saved result before retrying.');
    } finally {setRevealing(false);end();}
  }
  async function logout(){
    if(!begin())return;
    setScanning(false);
    try{await api('/api/staff/logout',{body:{},retries:1});setAuth('out');setSummary(null);setClaim(null);setMessage('');setScanning(false);}
    catch(e){fail(e,'Could not sign out. Try again.');}finally{end();}
  }
  if(auth==='checking')return <main className="loading">Checking staff session…</main>;
  if(auth==='out')return <main className="login"><form className="panel" onSubmit={login} noValidate aria-busy={busy}><Brand/><span className="eyebrow">Booth operations</span><h1>Staff desk</h1><p className="muted">Sign in to confirm rewards and follow up with the crowd.</p><label className="f">Staff PIN<input type="password" inputMode="numeric" autoComplete="current-password" aria-label="Staff PIN" minLength={4} maxLength={12} pattern="[0-9]{4,12}" disabled={busy} aria-invalid={!!message} aria-describedby={message?'staff-login-error':undefined} value={pin} onChange={e=>{setPin(e.target.value);setMessage('');}} required/></label>{message&&<p id="staff-login-error" className="err" role="alert">{message}</p>}<button className="btn spark" disabled={busy}>{busy?'Signing in…':'Sign in'}</button><a className="linkish" href="/play">Back to the game</a></form></main>;
  const k=summary?.kpis;
  const leads=summary?.leads.filter(p=>`${p.name} ${p.company} ${p.email} ${p.role}`.toLowerCase().includes(filter.toLowerCase()))??[];
  return <div className="wrap"><header className="bar"><div className="mark"><Brand/><div><b>Outguess the Crowd</b><small>Staff desk</small></div></div><span className="chip">{summary?(online?'Connected':'Reconnecting…'):(online?'Loading…':'Reconnecting…')}</span><a className="ghost" href="/api/staff/export.csv">Export sign-ups</a><a className="ghost" href="/api/staff/claims.csv">Export claims</a><button className="ghost" disabled={busy} onClick={logout}>Sign out</button></header>
    <main className="staff"><div className="kpis">{[['Plays today',k?.playsToday],[`Prizes issued — Day ${summary?.inventory.activeDay??'–'}`,summary?.inventory.fulfilled],['Prizes remaining',k?.remaining],['Hot leads',k?.hotLeads]].map(([label,n])=><div className="kpi" key={label}><b>{n??'–'}</b><span>{label}</span></div>)}</div>
      <InventoryPanel inventory={summary?.inventory??null} disabled={busy} onBusyChange={value=>{operation.current=value;setBusy(value);}} onSaved={inventory=>setSummary(current=>current?{...current,inventory,kpis:{...current.kpis,remaining:inventory.remaining}}:current)} onAccessDenied={()=>{setAuth('out');setSummary(null);setClaim(null);setMessage('Session expired. Sign in again.');}} />
      <div className="cols"><section className="panel"><div className="panelhead"><h2>Confirm a reward</h2><button className="ghost" disabled={busy} onClick={()=>setScanning(v=>!v)}>{scanning?'Hide camera':'Scan QR'}</button></div>
        {scanning&&<Scanner onCode={value=>{setScanning(false);void find(value);}} onClose={()=>setScanning(false)}/>}
        <form className="find" noValidate aria-busy={busy} onSubmit={e=>{e.preventDefault();void find();}}><input aria-label="Claim code" required disabled={busy} aria-invalid={!!codeError} aria-describedby={codeError?'staff-code-error':undefined} value={code} onChange={e=>{setCode(e.target.value.toUpperCase());setClaim(null);setNumberConfirmed(false);setWheel(null);setCodeError('');setMessage('');}} placeholder="CODE" maxLength={6} autoComplete="off"/><button className="btn" disabled={busy}>{busy?'Checking…':'Find'}</button></form>
        {codeError&&<p id="staff-code-error" className="err" role="alert">{codeError}</p>}
        {message&&<p className="small muted" role="status">{message}</p>}
        {claim&&<div className="pcard"><dl className="kv"><dt>Player</dt><dd>{claim.name}</dd><dt>Company</dt><dd>{claim.company} · {claim.role}</dd><dt>Business number</dt><dd className="num">{claim.mobile}</dd><dt>Code</dt><dd className="num">{claim.code}</dd><dt>Score</dt><dd>{fmt(claim.score??0)} · {claim.persona}</dd><dt>Status</dt><dd>{claim.outcome==='no_prize'?'Draw complete — no prize':claim.claimed?`Fulfilled ${claim.claimedAt?manilaTime(claim.claimedAt):''}`:'Awaiting prize draw'}{claim.prizeDay&&` · Day ${claim.prizeDay}`}</dd></dl>
          {revealing&&<p className="small muted" role="status">{wheel?'Revealing the saved result…':'Drawing…'}</p>}
          {wheel&&<PrizeWheel result={wheel} />}
          {!wheel&&!claim.claimed&&!!summary?.inventory.remaining&&<PrizeWheel animate={false} result={wheelSnapshot(summary.inventory.items)} />}
          {claim.claimed&&!revealing&&<div className="prize-result" role="status"><span className="eyebrow">{claim.outcome==='no_prize'?'Draw complete':'Prize fulfilled'}</span><h3>{claim.outcome==='no_prize'?NO_PRIZE_LABEL:claim.prize?.name??'Previously fulfilled · historical record'}</h3>
            {claim.outcome==='no_prize'&&<p className="small muted">No prize this time. This draw is complete and cannot be spun again.</p>}
            {claim.prize?.valuePhp&&<p className="small muted">Worth PHP {fmt(claim.prize.valuePhp)}. Arrange package redemption with booth staff.</p>}
            {claim.prize?.amountPhp&&<p className="small muted">Arrange the GCash payout manually. The app does not send money.</p>}
          </div>}
          {!claim.claimed&&<><label className="opt"><input type="checkbox" disabled={busy} checked={numberConfirmed} onChange={e=>setNumberConfirmed(e.target.checked)}/><span>The player’s business number matches the number above.</span></label>
            <button className="btn spark" disabled={busy||!numberConfirmed||!summary?.inventory.remaining} onClick={fulfill}>{busy?'Drawing…':'Fulfill'}</button>
            <p className="small muted">Fulfill records one draw using the active day. There is a permanent 15% no-prize chance; otherwise one prize is issued. Hand over prizes or arrange payouts manually after a win.</p>
            {summary?.inventory.remaining===0&&<p className="err">No prizes remain. Set quantities in Prize inventory to restock.</p>}
          </>}
        </div>}
        <span className="eyebrow">Waiting to claim ({summary?.pending.length??'–'})</span><div className="pend">{summary?.pending.length?summary.pending.map(p=><button key={p.code} disabled={busy} onClick={()=>find(p.code)}><span>{p.name}<span className="muted"> · {p.company}</span></span><code>{p.code}</code></button>):<p className="small muted">{summary?'Nobody waiting.':'Loading claims…'}</p>}</div>
        {summary&&<p className="small muted">Day {summary.inventory.activeDay}: {fmt(summary.inventory.fulfilled)} prizes issued · {fmt(summary.inventory.remaining)} remaining · {fmt(summary.kpis.noPrizeDraws)} no-prize draws</p>}
      </section><section className="panel"><h2>Hot leads</h2><p className="small muted">Planning a campaign in the next six months, or interested in a Predikta simulation.</p><label className="f">Search leads<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Name, company, email or role"/></label><div className="tscroll"><table className="leads"><thead><tr><th>Player</th><th>Company · role</th><th>Challenge</th><th>Interest</th></tr></thead><tbody>{leads.map((p,i)=><tr key={`${p.email}-${i}`}><td data-label="Player"><b>{p.name}</b><br/><span className="small muted">{p.email}</span></td><td data-label="Company · role">{p.company}<br/><span className="small muted">{p.role}</span></td><td data-label="Challenge">{p.challenge||'—'}</td><td data-label="Interest">{p.planning==='Yes'&&<span className="flag hot">Campaign in 6 mo</span>}{p.wantsSim&&<span className="flag sim">Wants simulation</span>}{p.claimed&&<span className="flag cl">Fulfilled</span>}</td></tr>)}</tbody></table></div>{!leads.length&&<p className="small muted">{summary?'No leads match yet.':'Loading leads…'}</p>}</section></div>
    </main></div>;
}
