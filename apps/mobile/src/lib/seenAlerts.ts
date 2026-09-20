import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { Alert } from './types';

const STORAGE_KEY = 'freshness-tracker.seen-alerts';

/**
 * Alert codes the user has already looked at.
 *
 * The backend recomputes alerts from scratch on every poll, so "read" is not
 * something it can tell us -- the same warning arrives again every three
 * seconds for as long as it holds. This is the client's side of that: the bell
 * badges what is *new* since the notifications screen was last open.
 *
 * Marking replaces the list rather than adding to it, which prunes itself: a
 * code that clears server-side drops out, so if the same condition returns
 * later it counts as new again and badges a second time.
 */
let seen: readonly string[] = [];
const listeners = new Set<() => void>();

void AsyncStorage.getItem(STORAGE_KEY)
  .then((stored) => {
    if (stored === null) return;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || !parsed.every((code) => typeof code === 'string')) return;
    seen = parsed;
    listeners.forEach((listener) => listener());
  })
  .catch(() => undefined);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Stable reference between changes -- useSyncExternalStore re-renders forever
// if the snapshot is a fresh array each call.
function getSnapshot(): readonly string[] {
  return seen;
}

export function markAlertsSeen(alerts: Alert[]): void {
  const codes = alerts.map((alert) => alert.code);
  const unchanged =
    codes.length === seen.length && codes.every((code, index) => code === seen[index]);
  if (unchanged) return;

  seen = codes;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(codes)).catch(() => undefined);
  listeners.forEach((listener) => listener());
}

/** How many current alerts the user has not opened the notifications screen on. */
export function useUnseenAlertCount(alerts: Alert[] | undefined): number {
  const marked = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (alerts === undefined) return 0;
  return alerts.reduce((count, alert) => (marked.includes(alert.code) ? count : count + 1), 0);
}
