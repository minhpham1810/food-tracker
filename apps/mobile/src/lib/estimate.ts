import type { ItemState } from './types';

/** The value/label split display type needs -- see `estimate` and `dayBudget`. */
export interface Estimate {
  /** The figure to set at display size. null when there is no number to show. */
  value: string | null;
  /** Small label beside the value; carries the whole phrase when value is null. */
  label: string;
}

export function estimate(item: ItemState): Estimate {
  if (item.outside_model_range) return { value: null, label: 'Outside modelled range' };
  return dayBudget(item.days_left);
}

export function dayBudget(days: number): Estimate {
  if (days <= 0) return { value: null, label: 'Past budget' };
  if (days < 1) return { value: '<1', label: 'day left' };
  // Round down so display rounding never adds available time.
  const whole = Math.floor(days);
  return { value: String(whole), label: whole === 1 ? 'day left' : 'days left' };
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
