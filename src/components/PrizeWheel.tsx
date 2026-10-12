'use client';
import { useEffect, useState } from 'react';
import type { PrizeWheelResult } from '@/shared/types';
import { PRIZE_COLORS, PRIZES } from '@/shared/prizes';

export function PrizeWheel({result,animate=true}:{result:PrizeWheelResult;animate?:boolean}) {
  const [turn,setTurn]=useState(0);
  const total=result.items.reduce((n,p)=>n+p.remaining,0);
  let angle=0;
  let winnerAngle=0;
  const gradient=result.items.map(prize=>{
    const start=angle;angle+=prize.remaining/total*360;
    if(prize.id===result.prizeId)winnerAngle=(start+angle)/2;
    const color=PRIZE_COLORS[PRIZES.findIndex(p=>p.id===prize.id)];
    return `${color} ${start}deg ${angle}deg`;
  }).join(',');
  const target=animate?1800+(360-winnerAngle):0;
  const background=result.items.length===1?PRIZE_COLORS[PRIZES.findIndex(p=>p.id===result.items[0].id)]:`conic-gradient(${gradient})`;
  useEffect(()=>{
    let second=0;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>setTurn(target));});
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
  },[target]);
  return <div className="prize-wheel">
    <div className="prize-wheel-frame" aria-hidden="true">
      <span className="prize-wheel-pointer" />
      <div className="prize-wheel-disc" style={{background,transform:`rotate(${turn}deg)`}} />
      <span className="prize-wheel-hub">AdSpark<br/>Prizes</span>
    </div>
    <ul className="prize-wheel-legend" aria-label="Prizes in this draw">{result.items.map(prize=><li key={prize.id}>
      <i style={{background:PRIZE_COLORS[PRIZES.findIndex(p=>p.id===prize.id)]}} aria-hidden="true" />
      <span>{prize.name}</span><small>{prize.remaining} in this draw</small>
    </li>)}</ul>
  </div>;
}
