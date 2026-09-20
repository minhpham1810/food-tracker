import type { ItemState } from './types';

export function estimateText(item: ItemState): string {
  if (item.outside_model_range) return 'outside modelled range';
  return dayBudgetText(item.days_left);
}

export function dayBudgetText(days: number): string {
  if (days <= 0) return 'Past budget';
  if (days < 1) return 'less than 1 day';
  // Round down so display rounding never adds available time.
  const whole = Math.floor(days);
  return `About ${whole} ${whole === 1 ? 'day' : 'days'}`;
}

/** Above this the fridge is warm enough that the rate deserves emphasis. */
export const AGING_RATE_EMPHASIS = 1.5;

/**
 * Current conditions only. This describes how fast the fridge is burning
 * shelf life right now, not the state of the food.
 */
export function agingRateText(rate: number | null): string {
  if (rate === null) return 'Aging rate unavailable';
  return `Aging ${rate.toFixed(1)}x normal speed`;
}
