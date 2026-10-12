import type { Prize } from './types';

export const PRIZES: readonly Prize[] = [
  { id: 'gcash_150', name: 'PHP 150 GCash', amountPhp: 150 },
  { id: 'cellphone_holder', name: 'Cellphone Holder', amountPhp: null },
  { id: 'tote_bag', name: 'Tote Bag', amountPhp: null },
  { id: 'pencil_holder', name: 'Pencil Holder', amountPhp: null },
  { id: 'ballpen', name: 'Ballpen', amountPhp: null },
];
export const MAX_PRIZE_QUANTITY = 1_000_000;
export const PRIZE_COLORS = ['#ffd166', '#3fe0ff', '#8b5cf6', '#ff3da8', '#2f6bff'];
export const PRIZE_POOL_VALUE_PHP = 30_000;
