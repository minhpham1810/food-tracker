import type { ItemState } from './types';

/** The value/label split display type needs -- see `estimate` and `dayBudget`. */
export interface Estimate {
  /** The figure to set at display size. null when there is no number to show. */
  value: string | null;
  /** Small label beside the value; carries the whole phrase when value is null. */
  label: string;
}

/** Short form of the fused status -- the headline on the detail screen. */
export const statusLabel: Record<ItemState['status'], string> = {
  fresh: 'Fresh',
  check_early: 'Check early',
  past_budget_quiet: 'Past budget',
  discard_quality_signal: 'Discard',
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
  if (days < 1) return 'Less than 1 day';
  // Round down so display rounding never adds available time.
  const whole = Math.floor(days);
  return `About ${whole} ${whole === 1 ? 'day' : 'days'}`;
}

/**
 * Above this the fridge is warm enough to say so. It is a property of the
 * fridge, not of any one item, so it is stated once on the fridge screen.
 */
export const AGING_RATE_EMPHASIS = 1.5;

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
