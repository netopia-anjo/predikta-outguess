'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { Game } from './game/Game';
import { Brand,Qr } from './game/bits';
import { fmt,useBoard,useContent } from '@/lib/hooks';
import { api,ApiError } from '@/lib/api';
import { PRIZES } from '@/shared/prizes';
import { validStaffPin } from '@/shared/validation';
export function TvApp() {
  const [auth,setAuth]=useState<'checking'|'out'|'in'>('checking');
  const [pin,setPin]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const operation=useRef(false);
  const expired=useCallback(()=>{setAuth('out');setPin('');setMessage('TV session ended. Enter the staff PIN to unlock again.');},[]);
  useEffect(()=>{
    let alive=true;
    api<{ok:boolean}>('/api/tv/session',{retries:0}).then(r=>{if(alive)setAuth(r.ok?'in':'out');}).catch(()=>{if(alive){setAuth('out');setMessage('Could not check the TV connection. Try unlocking again.');}});
    return()=>{alive=false;};
  },[]);
  async function unlock(e:React.FormEvent) {
    e.preventDefault();
    if(operation.current)return;
    const enteredPin=pin.trim();
    if(!validStaffPin(enteredPin)){setMessage('Enter a PIN with 4–12 digits.');return;}
    operation.current=true;setBusy(true);setMessage('');
    try{await api('/api/tv/login',{body:{pin:enteredPin},retries:0});setPin('');setAuth('in');}
    catch(e){setMessage(e instanceof ApiError&&e.status===429?'Too many attempts. Try again in 15 minutes.':e instanceof ApiError&&e.status===401?'That PIN did not match.':'Could not connect. Try again.');}
    finally{operation.current=false;setBusy(false);}
  }
  async function lock() {
    if(operation.current)return;
    operation.current=true;setBusy(true);setMessage('');
    try{await api('/api/tv/logout',{body:{},retries:1});setAuth('out');setPin('');}
    catch{setMessage('Could not lock the TV. Check the connection and try again.');}
    finally{operation.current=false;setBusy(false);}
  }
  if(auth==='checking')return <main className="loading" role="status">Checking TV access…</main>;
  if(auth==='out')return <main className="login"><form className="panel" onSubmit={unlock} noValidate aria-busy={busy}><Brand/><span className="eyebrow">Booth screen</span><h1>Unlock TV</h1><p className="muted">Staff access only. Enter the staff PIN to start the booth screen.</p><label className="f">Staff PIN<input type="password" inputMode="numeric" autoComplete="off" required minLength={4} maxLength={12} pattern="[0-9]{4,12}" disabled={busy} aria-invalid={!!message} aria-describedby={message?'tv-login-error':undefined} value={pin} onChange={e=>{setPin(e.target.value);setMessage('');}}/></label>{message&&<p id="tv-login-error" className="err" role="alert">{message}</p>}<button className="btn spark" disabled={busy}>{busy?'Unlocking…':'Unlock TV'}</button><a className="linkish" href="/play">Play on your phone</a></form></main>;
  return <TvScreen onAccessDenied={expired} onLock={lock} busy={busy} message={message}/>;
}
function TvScreen({onAccessDenied,onLock,busy,message}:{onAccessDenied:()=>void;onLock:()=>void;busy:boolean;message:string}) {
  const {content,failed}=useContent('/api/tv/content',onAccessDenied);
  const {board,live}=useBoard('/api/tv/board',onAccessDenied);
  const [player,setPlayer]=useState<string|null>(null);
  useEffect(()=>{if('serviceWorker' in navigator && process.env.NODE_ENV==='production')navigator.serviceWorker.register('/sw.js',{scope:'/tv'}).catch(()=>{});},[]);
  return <main className="tvviewport"><div className="tv"><div className="tvin">
    <aside className="tvrail">
      <Brand/>
      <h1>Outguess<br/><em>the crowd.</em></h1>
      <div className="tvcard tvqr">{content&&<Qr text={content.joinUrl} label="Scan to play on your phone"/>}<div><b>Scan to play</b><span>Or tap the screen to play here.</span></div></div>
      <div className="tvcard tv-prizes">
        <span className="eyebrow">Day {board?.prizes.activeDay??'–'} prizes</span>
        <div className="tvgc prize-value-banner"><b>PHP {board ? fmt(board.prizes.cashRemainingPhp) : '–'}</b><span>GCash up for grabs today</span></div>
        <ul className="tv-merch-stock" aria-label="Remaining merchandise">
          {PRIZES.filter(prize=>prize.amountPhp===null).map(prize=>{
            const item=board?.prizes.items.find(p=>p.id===prize.id);
            return <li key={prize.id}><span>{prize.name}{prize.valuePhp&&<small>Worth PHP {fmt(prize.valuePhp)} each</small>}</span><b>{item?fmt(item.remaining):'–'}</b></li>;
          })}
        </ul>
      </div>
      <div className="tvcard"><span className="eyebrow">Crowd prediction accuracy</span><span className="bigstat">{board?.stat.pct!=null?`${board.stat.pct}%`:'–'}</span><span className="tvsmall">{board?.stat.picks?`${fmt(board.stat.picks)} attendee picks · matched the winning ad`:'The crowd is warming up. Make the first call.'}</span></div>
      <div className="tvcard grow"><div className="head"><span className="eyebrow">Today’s top 10</span><span className={`tvsmall tvlive ${live?'':'off'}`}><i/>{live?'Live':'Reconnecting'}</span></div>
        <table className="lb"><caption className="sr-only">Today’s leaderboard</caption><tbody>{board?.leaderboard.map((p,i)=><tr key={p.id} className={p.id===player?'me':''}><td className="r">{String(i+1).padStart(2,'0')}</td><td>{p.name}</td><td className="s">{fmt(p.score)}</td></tr>)}</tbody></table>
        {!board?.leaderboard.length&&<span className="tvsmall">Your name could be here.</span>}
      </div>
      {message&&<p className="tvsmall" role="alert">{message}</p>}
      <button className="tvlock" onClick={onLock} disabled={busy}>{busy?'Locking…':'Lock TV'}</button>
    </aside>
    <section className="tvgame" aria-label="Touchscreen game">{content?<Game variant="tv" content={content} prizes={board?.prizes??null} onPlayer={setPlayer} onAccessDenied={onAccessDenied}/>:<div className="loading">{failed?'Waiting for the booth connection…':'Loading…'}</div>}</section>
  </div></div></main>;
}
