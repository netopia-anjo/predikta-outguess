'use client';
import { useState } from 'react';
import type { PrizeDay, PrizeInventory } from '@/shared/types';
import { MAX_PRIZE_QUANTITY } from '@/shared/prizes';
import { api, ApiError } from '@/lib/api';
import { fmt } from '@/lib/hooks';

interface Props {
  inventory: PrizeInventory | null;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: (inventory: PrizeInventory) => void;
  onAccessDenied: () => void;
}
export function InventoryPanel({inventory,disabled,onBusyChange,onSaved,onAccessDenied}:Props) {
  const [dayChoice,setViewedDay]=useState<PrizeDay|null>(null);
  const viewedDay=dayChoice??inventory?.activeDay??1;
  const [draft,setDraft]=useState<{day:PrizeDay;revision:number;totals:Record<string,string>}|null>(null);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');
  const selected=inventory?.days.find(day=>day.day===viewedDay);
  const edit=()=>{if(!selected||!inventory)return;setMessage('');setDraft({day:viewedDay,revision:inventory.revision,totals:Object.fromEntries(selected.items.map(p=>[p.id,String(p.total)]))});};
  const stale=!!draft&&draft.revision!==inventory?.revision;
  const start=()=>{setSaving(true);onBusyChange(true);setMessage('');};
  const end=()=>{setSaving(false);onBusyChange(false);};
  const failed=(error:unknown)=>{
    if(error instanceof ApiError&&error.status===401)onAccessDenied();
    else if(error instanceof ApiError&&error.code==='inventory_changed')setMessage('Inventory or the active day changed. Reload quantities and review them before trying again.');
    else if(error instanceof ApiError&&error.code==='below_fulfilled')setMessage('Total stock cannot be lower than the number already issued.');
    else setMessage('Could not confirm the change. Reload quantities to check the saved state before trying again.');
  };
  async function save(event:React.FormEvent) {
    event.preventDefault();
    if(!draft||!selected||saving||disabled||stale)return;
    const totals=Object.fromEntries(Object.entries(draft.totals).map(([id,value])=>[id,Number(value)]));
    if(selected.items.some(p=>!/^\d+$/.test(draft.totals[p.id])||!Number.isInteger(totals[p.id])||totals[p.id]<p.fulfilled||totals[p.id]>MAX_PRIZE_QUANTITY)) {
      setMessage(`Use whole quantities from the issued count up to ${fmt(MAX_PRIZE_QUANTITY)}.`);return;
    }
    start();
    try {
      onSaved(await api<PrizeInventory>('/api/staff/inventory',{body:{day:draft.day,revision:draft.revision,totals},retries:0}));
      setDraft(null);setMessage(`Day ${draft.day} inventory saved.`);
    } catch(error) {failed(error);} finally {end();}
  }
  async function reload() {
    if(saving||disabled)return;start();
    try {
      const latest=await api<PrizeInventory>('/api/staff/inventory',{retries:1});onSaved(latest);
      if(draft){const day=latest.days.find(day=>day.day===draft.day)!;setDraft({day:draft.day,revision:latest.revision,totals:Object.fromEntries(day.items.map(p=>[p.id,String(p.total)]))});}
      setMessage('Latest quantities loaded.');
    } catch(error){failed(error);} finally{end();}
  }
  async function activate() {
    if(!inventory||draft||saving||disabled||viewedDay===inventory.activeDay)return;
    start();
    try {
      const latest=await api<PrizeInventory>('/api/staff/inventory/day',{body:{day:viewedDay,revision:inventory.revision},retries:0});
      onSaved(latest);setMessage(`Day ${latest.activeDay} is active. All new draws use this day's stock.`);
    } catch(error){failed(error);} finally{end();}
  }
  return <section className="panel inventory-panel" aria-labelledby="inventory-title">
    <div className="panelhead"><h2 id="inventory-title">Daily prize inventory</h2>
      {!draft&&<button className="ghost" disabled={disabled||saving||!selected} onClick={edit}>Set quantities</button>}
    </div>
    <div className="inventory-day-controls">
      <div className="inventory-days" role="group" aria-label="View prize inventory day">{([1,2] as const).map(day=><button type="button" className="ghost" key={day} aria-pressed={viewedDay===day} disabled={disabled||saving||!!draft} onClick={()=>{setViewedDay(day);setMessage('');}}>Day {day}{inventory?.activeDay===day?' · Active':''}</button>)}</div>
      <span className="chip">Draws use Day {inventory?.activeDay??'–'}</span>
      {inventory&&viewedDay!==inventory.activeDay&&<button type="button" className="btn" disabled={disabled||saving||!!draft} onClick={activate}>Activate Day {viewedDay}</button>}
    </div>
    <p className="small muted" style={{margin:0}}>Viewing Day {viewedDay}. Each day keeps its own stock; unused prizes do not carry over. Totals include prizes already issued. Increase a total to restock.</p>
    <form onSubmit={save} noValidate aria-busy={saving}>
      <div className="inventory-grid">{selected?.items.map(prize=><div className="inventory-item" key={prize.id}>
        <h3>{prize.name}</h3>
        {prize.valuePhp&&<span className="small muted">Worth PHP {fmt(prize.valuePhp)} each</span>}
        <b className="inventory-remaining">{fmt(prize.remaining)} <small>remaining</small></b>
        <span className="small muted">{fmt(prize.fulfilled)} issued · {fmt(prize.total)} total</span>
        {draft&&<label className="f">Day {draft.day} total — {prize.name}<input type="number" inputMode="numeric" min={prize.fulfilled} max={MAX_PRIZE_QUANTITY} step={1}
          disabled={disabled||saving} value={draft.totals[prize.id]} onChange={e=>setDraft({...draft,totals:{...draft.totals,[prize.id]:e.target.value}})} /></label>}
      </div>)}</div>
      {!inventory&&<p className="small muted">Loading inventory…</p>}
      {stale&&<p className="err" role="status">Inventory or active day changed. Reload quantities before saving.</p>}
      {message&&<p className="small muted" role="status">{message}</p>}
      <div className="inventory-actions">
        {draft&&<button className="btn spark" type="submit" disabled={disabled||saving||stale}>{saving?'Saving…':`Save Day ${draft.day} quantities`}</button>}
        <button className="ghost" type="button" disabled={disabled||saving} onClick={reload}>Reload quantities</button>
        {draft&&<button className="ghost" type="button" disabled={disabled||saving} onClick={()=>{setDraft(null);setMessage('');}}>Cancel</button>}
      </div>
    </form>
  </section>;
}
