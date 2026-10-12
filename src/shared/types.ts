import type { Persona } from './rules';

export type Side = 'a' | 'b';
export type ConfIdx = 0 | 1 | 2;

export interface Ad {
  visual: string;
  copy: string;
  /** Placeholder art colors and variant, used when there is no image yet. */
  b1: string;
  b2: string;
  k: string;
  a: string;
  v: string;
  /** Pre-generated AdSpark image, e.g. /content/ads/brewha-a.webp */
  image?: string;
}

export interface Round {
  brand: string;
  product: string;
  objective: string;
  surprise?: boolean;
  a: Ad;
  b: Ad;
  winner: Side;
  split: Record<Side, number>;
  emotion: string;
  driver: string;
  reactions: string[];
}

export interface Audience {
  id: string;
  name: string;
  meta: string;
  chips: string[];
  rounds: Round[];
}

/** What the client gets before a pick: no answers. */
export type PublicRound = Pick<Round, 'brand' | 'product' | 'objective' | 'a' | 'b'>;
export interface PublicAudience extends Omit<Audience, 'rounds'> {
  rounds: PublicRound[];
}
export interface ContentPayload {
  version: string;
  demo: boolean;
  consentText: string;
  consentVersion: string;
  audiences: PublicAudience[];
  joinUrl: string;
  contactUrl: string;
  privacyPolicyUrl: string | null;
}

export interface RoundResult {
  idx: number;
  /** Only sent once the round is locked in. */
  winner: Side;
  pick: Side | null;
  conf: ConfIdx;
  correct: boolean;
  points: number;
  bonus: number;
  msUsed: number;
}

export interface Reaction {
  text: string;
  respondent: string;
}

export interface Reveal {
  idx: number;
  winner: Side;
  split: Record<Side, number>;
  emotion: string;
  driver: string;
  surprise: boolean;
  reactions: Reaction[];
  result: RoundResult;
  wallet: number;
}

export interface Prize { id: string; name: string; amountPhp: number | null }
export interface PrizeStock extends Prize { total: number; fulfilled: number; remaining: number }
export interface PrizeInventory {
  revision: number;
  items: PrizeStock[];
  total: number;
  fulfilled: number;
  remaining: number;
  cashRemainingPhp: number;
}
export interface RewardState {
  code: string | null;
  claimed: boolean;
  mobileMasked: string;
  prize: Prize | null;
  legacy: boolean;
}
export interface PrizeWheelResult { items: PrizeStock[]; prizeId: string }
export interface StaffClaim {
  name: string; company: string; role: string; mobile: string;
  score: number | null; persona: string | null; code: string;
  claimed: boolean; claimedAt: number | null; prize: Prize | null; legacy: boolean;
}
export interface FulfillResult extends StaffClaim { replayed: boolean; wheel: PrizeWheelResult | null }

export interface Me {
  content: ContentPayload;
  id: string;
  name: string;
  audienceId: string | null;
  rounds: RoundResult[];
  /** A round that was started but not locked in (for resuming). */
  startedRound: { idx: number; elapsedMs: number } | null;
  wallet: number;
  finished: boolean;
  score: number | null;
  correct: number | null;
  persona: Persona | null;
  wantsSim: boolean;
  reward: RewardState | null;
}

export interface Board {
  prizes: PrizeInventory;
  stat: { picks: number; matches: number; pct: number | null };
  leaderboard: { id: string; name: string; score: number }[];
}
