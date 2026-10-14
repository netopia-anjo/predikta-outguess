'use client';
import { useEffect, useState } from 'react';
import type { Board, ContentPayload } from '../shared/types';
import { api, ApiError } from './api';

export function useContent(path = '/api/content', onUnauthorized?: () => void) {
  const [content,setContent] = useState<ContentPayload|null>(null);
  const [failed,setFailed] = useState(false);
  useEffect(()=>{
    let alive=true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const c = await api<ContentPayload>(path,{retries:1});
        if (!alive) return;
        setContent(c); setFailed(false);
        // Warm only the landing preview; gameplay loads the assigned pair before its timer.
        const preview = c.audiences[0]?.rounds[0];
        if (preview) for (const ad of [preview.a,preview.b]) if (ad.image) new Image().src=ad.image;
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401 && onUnauthorized) { onUnauthorized(); return; }
        setFailed(true); timer=setTimeout(load,5000);
      }
    }
    void load();
    return ()=>{alive=false;clearTimeout(timer);};
  },[path,onUnauthorized]);
  return {content,failed};
}
export function useBoard(path = '/api/board', onUnauthorized?: () => void) {
  const [board,setBoard] = useState<Board|null>(null);
  const [live,setLive] = useState(false);
  useEffect(()=>{
    let alive=true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {const b=await api<Board>(path,{retries:0});if(alive){setBoard(b);setLive(true);}}
      catch (e) {if(alive){setLive(false);if(e instanceof ApiError && e.status===401 && onUnauthorized){onUnauthorized();return;}}}
      if(alive)timer=setTimeout(poll,3000);
    }
    void poll();
    return ()=>{alive=false;clearTimeout(timer);};
  },[path,onUnauthorized]);
  return {board,live};
}
export const fmt=(n:number)=>n.toLocaleString('en-PH');
export const manilaTime=(ms:number)=>new Date(ms).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'});
