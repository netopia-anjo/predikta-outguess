'use client';
import { useState } from 'react';
import type { PrizeInventory } from '@/shared/types';
import { MAX_PRIZE_QUANTITY } from '@/shared/prizes';
import { api, ApiError } from '@/lib/api';
import { fmt } from '@/lib/hooks';

interface Props {
  inventory: PrizeInventory | null;
  disabled: boolean;
  onSaved: (inventory: PrizeInventory) => void;
  onAccessDenied: () => void;
}
export function InventoryPanel({inventory,disabled,onSaved,onAccessDenied}:Props) {
  const [draft,setDraft]=useState<{revision:number;totals:Record<string,string>}|null>(null);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');
  const edit=()=>{if(!inventory)return;setMessage('');setDraft({revision:inventory.revision,totals:Object.fromEntries(inventory.items.map(p=>[p.id,String(p.total)]))});};
  const stale=!!draft&&draft.revision!==inventory?.revision;
  async function save(event:React.FormEvent) {
    event.preventDefault();
    if(!draft||!inventory||saving||disabled||stale)return;
    const totals=Object.fromEntries(Object.entries(draft.totals).map(([id,value])=>[id,Number(value)]));
    if(inventory.items.some(p=>!/^\d+$/.test(draft.totals[p.id])||!Number.isInteger(totals[p.id])||totals[p.id]<p.fulfilled||totals[p.id]>MAX_PRIZE_QUANTITY)) {
      setMessage(`Use whole quantities from the fulfilled count up to ${fmt(MAX_PRIZE_QUANTITY)}.`);return;
    }
    setSaving(true);setMessage('');
    try {
      const saved=await api<PrizeInventory>('/api/staff/inventory',{body:{revision:draft.revision,totals},retries:0});
      onSaved(saved);setDraft(null);setMessage('Inventory saved.');
    } catch(error) {
      if(error instanceof ApiError&&error.status===401)onAccessDenied();
      else if(error instanceof ApiError&&error.code==='inventory_changed')setMessage('Inventory changed while you were editing. Reload quantities and review them before saving.');
      else if(error instanceof ApiError&&error.code==='below_fulfilled')setMessage('Total stock cannot be lower than the number already fulfilled.');
      else setMessage('Could not confirm the save. Reload quantities to check the current stock before trying again.');
    } finally {setSaving(false);}
  }
  async function reload() {
    if(saving||disabled)return;setSaving(true);
    try {
      const latest=await api<PrizeInventory>('/api/staff/inventory',{retries:1});onSaved(latest);
      setDraft({revision:latest.revision,totals:Object.fromEntries(latest.items.map(p=>[p.id,String(p.total)]))});setMessage('Latest quantities loaded.');
    } catch(error){if(error instanceof ApiError&&error.status===401)onAccessDenied();else setMessage('Could not reload inventory. Try again.');}
    finally{setSaving(false);}
  }
  return <section className="panel inventory-panel" aria-labelledby="inventory-title">
    <div className="panelhead"><h2 id="inventory-title">Prize inventory</h2>
      {!draft&&<button className="ghost" disabled={disabled||saving||!inventory} onClick={edit}>Set quantities</button>}
    </div>
    <p className="small muted" style={{margin:0}}>Whole-event stock · no daily reset. Totals include prizes already fulfilled. Increase a total to restock.</p>
    <form onSubmit={save} noValidate aria-busy={saving}>
      <div className="inventory-grid">{inventory?.items.map(prize=><div className="inventory-item" key={prize.id}>
        <h3>{prize.name}</h3>
        <b className="inventory-remaining">{fmt(prize.remaining)} <small>remaining</small></b>
        <span className="small muted">{fmt(prize.fulfilled)} fulfilled · {fmt(prize.total)} total</span>
        {draft&&<label className="f">Total stock<input type="number" inputMode="numeric" min={prize.fulfilled} max={MAX_PRIZE_QUANTITY} step={1}
          disabled={disabled||saving} value={draft.totals[prize.id]} onChange={e=>setDraft({...draft,totals:{...draft.totals,[prize.id]:e.target.value}})} /></label>}
      </div>)}</div>
      {!inventory&&<p className="small muted">Loading inventory…</p>}
      {stale&&<p className="err" role="status">Stock has changed. Reload quantities before saving.</p>}
      {message&&<p className={message.includes('saved')||message.includes('loaded')?'toast':'err'} role="status">{message}</p>}
      {draft&&<div className="inventory-actions">
        <button className="btn spark" type="submit" disabled={disabled||saving||stale}>{saving?'Saving…':'Save quantities'}</button>
        <button className="ghost" type="button" disabled={disabled||saving} onClick={reload}>Reload quantities</button>
        <button className="ghost" type="button" disabled={disabled||saving} onClick={()=>{setDraft(null);setMessage('');}}>Cancel</button>
      </div>}
    </form>
  </section>;
}
