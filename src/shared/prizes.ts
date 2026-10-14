import type { Prize, PrizeDay, PrizeStock, PrizeWheelResult } from './types';

export const PRIZES: readonly Prize[] = [
  { id: 'tote_bag_rope', name: 'Tote Bag — Rope', amountPhp: null, valuePhp: null },
  { id: 'pen_notebook', name: 'Pen & Notebook', amountPhp: null, valuePhp: null },
  { id: 'tote_bag_new', name: 'Tote Bag — New', amountPhp: null, valuePhp: null },
  { id: 'magsafe_wallet', name: 'MagSafe Wallet', amountPhp: null, valuePhp: null },
  { id: 'pouch', name: 'Pouch', amountPhp: null, valuePhp: null },
  { id: 'predikta_package', name: 'Digicon × Predikta Package', amountPhp: null, valuePhp: 75_000 },
  { id: 'gcash_100', name: 'PHP 100 GCash', amountPhp: 100, valuePhp: null },
  { id: 'gcash_500', name: 'PHP 500 GCash', amountPhp: 500, valuePhp: null },
  { id: 'gcash_1000', name: 'PHP 1,000 GCash', amountPhp: 1000, valuePhp: null },
  { id: 'gcash_2000', name: 'PHP 2,000 GCash', amountPhp: 2000, valuePhp: null },
];
export const DAILY_QUANTITIES: Record<string, number> = {
  tote_bag_rope: 30, pen_notebook: 24, tote_bag_new: 15, magsafe_wallet: 25, pouch: 25,
  predikta_package: 5, gcash_100: 15, gcash_500: 10, gcash_1000: 3, gcash_2000: 3,
};
export const isPrizeDay = (day: unknown): day is PrizeDay => day === 1 || day === 2;
export const MAX_PRIZE_QUANTITY = 1_000_000;
export const NO_PRIZE_ID = 'no_prize';
export const NO_PRIZE_LABEL = 'Thank you for playing';
export const NO_PRIZE_PERCENT = 15;
const COLORS = ['#ffd166', '#3fe0ff', '#8b5cf6', '#ff3da8', '#2f6bff', '#ffc34d', '#4ade80', '#fb923c', '#c084fc', '#67e8f9'];
export const prizeColor = (id: string) => id === NO_PRIZE_ID ? '#64748b' : COLORS[PRIZES.findIndex(p => p.id === id)] ?? '#3fe0ff';
/** Role-independent prize categories for the result animation; no draw probabilities. */
export function prizeWheelDisplay(stock: readonly Pick<PrizeStock, 'id' | 'name' | 'remaining'>[], prizeId = ''): PrizeWheelResult {
  const available = stock.filter(p => p.remaining > 0);
  return { prizeId, items: available.length ? [
    { id: NO_PRIZE_ID, name: NO_PRIZE_LABEL, remaining: null },
    ...available.map(p => ({ id: p.id, name: p.name, remaining: p.remaining })),
  ] : [] };
}
