import type { ItemState } from './types';

/** The value/label split display type needs -- see `estimate` and `dayBudget`. */
export interface Estimate {
  /** The figure to set at display size. null when there is no number to show. */
  value: string | null;
  /** Small label beside the value; carries the whole phrase when value is null. */
  label: string;
}

/** Short form of the fused status -- the hero eyebrow on the detail screen. */
export const statusLabel: Record<ItemState['status'], string> = {
  fresh: 'FRESH',
  check_early: 'CHECK EARLY',
  past_budget_quiet: 'PAST BUDGET',
  discard_quality_signal: 'DISCARD',
};

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

/**
 * Below this the 4C headline is close enough that a correction would be noise.
 * Above it the headline is optimistic and the user is told so.
 */
export const AGING_RATE_CORRECTION = 1.3;

/**
 * The honest correction to the 4C headline when the fridge is warmer than the
 * model's reference. Rounds exactly like dayBudgetText so the two never
 * disagree about where a day boundary falls.
 */
export function currentConditionsText(days: number, temperature: string): string {
  if (days <= 0) return `At the current ${temperature}, already past budget`;
  if (days < 1) return `At the current ${temperature}, less than 1 day`;
  const whole = Math.floor(days);
  return `At the current ${temperature}, closer to ${whole} ${whole === 1 ? 'day' : 'days'}`;
}
