import 'server-only';
import type { PrizeStock, WheelSegment } from '../shared/types';
import { NO_PRIZE_ID, NO_PRIZE_LABEL, NO_PRIZE_PERCENT } from '../shared/prizes';

interface WeightedWheelSegment extends WheelSegment { probability: number }
export interface WeightedWheelResult { items: WeightedWheelSegment[]; prizeId: string }

const MARKETING_LEADER_ROLES = new Set([
  'vp of marketing', 'vice president of marketing', 'vp marketing', 'vice president marketing',
  'marketing vp', 'head of marketing', 'marketing head', 'cmo', 'chief marketing officer',
  'marketing director', 'director of marketing',
]);
export function isMarketingLeader(role: string): boolean {
  const title = role.normalize('NFKC').toLowerCase().replaceAll('.', '').replace(/[,\p{Dash_Punctuation}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return MARKETING_LEADER_ROLES.has(title);
}
/** Integer weights preserve secure integer-ticket sampling, including the lower package weight. */
export function prizeWeights(stock: readonly PrizeStock[], role = '') {
  const leader=isMarketingLeader(role);
  // At full daily stock: 85% * (5 * 480) / (5 * 480 + 150 * 52) = 20%.
  const packageWeight = leader ? 480 : 1;
  const otherWeight = leader ? 52 : 4;
  return stock.filter(p => p.remaining > 0).map(prize => ({
    prize, weight: prize.remaining * (prize.id === 'predikta_package' ? packageWeight : otherWeight),
  }));
}
export function wheelSnapshot(stock: readonly PrizeStock[], prizeId = '', role = ''): WeightedWheelResult {
  const items = prizeWeights(stock, role);
  const total = items.reduce((n,p) => n + p.weight, 0);
  return { prizeId, items: total ? [
    { id: NO_PRIZE_ID, name: NO_PRIZE_LABEL, probability: NO_PRIZE_PERCENT / 100, remaining: null },
    ...items.map(({prize,weight}) => ({ id:prize.id, name:prize.name, remaining:prize.remaining, probability:(100 - NO_PRIZE_PERCENT) / 100 * weight / total })),
  ] : [] };
}
