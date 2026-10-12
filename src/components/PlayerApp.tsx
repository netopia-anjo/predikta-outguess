'use client';
import { Game } from './game/Game';
import { useBoard,useContent } from '@/lib/hooks';
export function PlayerApp() {
  const {content,failed}=useContent();
  const {board}=useBoard();
  if(!content)return <main className="loading" role="status">{failed?'Waiting for the booth connection…':'Getting the crowd ready…'}</main>;
  return <Game variant="phone" content={content} prizes={board?.prizes??null} landingBoard={board}/>;
}
