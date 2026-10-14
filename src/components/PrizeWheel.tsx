'use client';
import { useEffect, useState } from 'react';
import type { PrizeWheelResult } from '@/shared/types';
import { NO_PRIZE_ID, prizeColor } from '@/shared/prizes';

export function PrizeWheel({result,animate=true}:{result:PrizeWheelResult;animate?:boolean}) {
  const [turn,setTurn]=useState(0);
  let angle=0;
  let winnerAngle=0;
  const segmentAngle=result.items.length?360/result.items.length:0;
  const gradient=result.items.map(prize=>{
    const start=angle;angle+=segmentAngle;
    if(prize.id===result.prizeId)winnerAngle=(start+angle)/2;
    const color=prizeColor(prize.id);
    return `${color} ${start}deg ${angle}deg`;
  }).join(',');
  const target=animate?1800+(360-winnerAngle):0;
  const background=result.items.length===1?prizeColor(result.items[0].id):`conic-gradient(${gradient})`;
  useEffect(()=>{
    let second=0;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>setTurn(target));});
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
  },[target]);
  return <div className="prize-wheel">
    <p className="small muted" style={{margin:0}}>The wheel reveals the recorded draw result.</p>
    <div className="prize-wheel-frame" aria-hidden="true">
      <span className="prize-wheel-pointer" />
      <div className="prize-wheel-disc" style={{background,transform:`rotate(${turn}deg)`}} />
      <span className="prize-wheel-hub">AdSpark<br/>Prizes</span>
    </div>
    <ul className="prize-wheel-legend" aria-label="Prizes in this draw">{result.items.map(prize=><li key={prize.id}>
      <i style={{background:prizeColor(prize.id)}} aria-hidden="true" />
      <span>{prize.name}</span><small>{prize.id===NO_PRIZE_ID?'No prize':`${prize.remaining} remaining`}</small>
    </li>)}</ul>
  </div>;
}
