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
