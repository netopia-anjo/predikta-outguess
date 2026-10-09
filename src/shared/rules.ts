// Game rules from BUILD_BRIEF.md. Used by the server (authoritative) and the clients (display).
import type { ConfIdx, Side } from './types';

export const ROUND_SECS = 30;
export const ROUND_MS = ROUND_SECS * 1000;
export const ROUNDS_PER_GAME = 3;
export const MAX_SPEED_BONUS = 30;

export const CONF = [
  { label: 'Hunch', ok: 100, no: 20 },
  { label: 'Pretty sure', ok: 150, no: 20 },
  { label: 'All in', ok: 200, no: 0 },
] as const;

export const MAX_SCORE = ROUNDS_PER_GAME * (CONF[2].ok + MAX_SPEED_BONUS); // 690

/** A null pick is a timeout: 0 points. Speed bonus is +1 per whole second left, correct picks only. */
export function scoreRound(pick: Side | null, winner: Side, conf: ConfIdx, msUsed: number) {
  if (!pick) return { correct: false, points: 0, bonus: 0 };
  const correct = pick === winner;
  const points = correct ? CONF[conf].ok : CONF[conf].no;
  const secsLeft = Math.floor(ROUND_SECS - msUsed / 1000);
  const bonus = correct ? Math.max(0, Math.min(MAX_SPEED_BONUS, secsLeft)) : 0;
  return { correct, points, bonus };
}

export const PERSONAS = {
  'The Crowd Whisperer': 'You read audiences well and back your calls. Predikta helps you prove it to clients before launch.',
  'The Quiet Strategist': 'Your instincts are better than you think. Predikta gives you the data to say it out loud.',
  'The Bold Gambler': 'You trust your gut. Predikta lets you test it before you spend.',
  'Fresh Eyes': 'You question the obvious, which is where surprises come from. Predikta shows which hunches to keep.',
} as const;
export type Persona = keyof typeof PERSONAS;

/** High accuracy = 2+ correct. High confidence = average confidence >= 1 (Hunch 0, Pretty sure 1, All in 2). */
export function personaOf(correct: number, avgConf: number): Persona {
  if (correct >= 2) return avgConf >= 1 ? 'The Crowd Whisperer' : 'The Quiet Strategist';
  return avgConf >= 1 ? 'The Bold Gambler' : 'Fresh Eyes';
}

interface ScoredRound {
  pick: Side | null;
  conf: ConfIdx;
  correct: boolean;
  points: number;
  bonus: number;
  msUsed: number;
}

/** Average confidence is taken over rounds with a pick; timeouts are left out. */
export function summarize(rounds: ScoredRound[]) {
  const picked = rounds.filter((r) => r.pick);
  const avgConf = picked.length ? picked.reduce((s, r) => s + r.conf, 0) / picked.length : 0;
  const correct = rounds.filter((r) => r.correct).length;
  return {
    score: rounds.reduce((s, r) => s + r.points + r.bonus, 0),
    totalMs: rounds.reduce((s, r) => s + r.msUsed, 0),
    correct,
    avgConf,
    persona: personaOf(correct, avgConf),
  };
}
