/**
 * Single source of truth for color, spacing, type and elevation.
 *
 * Screens must not hardcode hex values -- add a token here instead. Before this
 * existed the same palette was hand-copied into all three screens, which is why
 * they drifted apart.
 */

import { Platform, type ViewStyle } from 'react-native';

import type { ItemState } from './types';

export const colors = {
  // Surfaces -- near-black with a cool undertone, so the accent colors read as
  // deliberate rather than as "the only color on screen".
  bg: '#0A0E14',
  surface: '#121821',
  surfaceRaised: '#18202B',
  inputBg: '#0D131B',

  // Lines: hairlines, not boxes. Borders here are felt more than seen.
  border: '#1E2733',
  borderStrong: '#2C3846',

  // Text
  text: '#F2F5F9',
  textMuted: '#94A3B4',
  textDim: '#64748B',

  // Interactive
  accent: '#38BDF8',
  accentText: '#7DD3FC',
  codeText: '#A5C9E8',
  buttonBg: '#17324D',
  buttonBorder: '#2E6491',
  buttonSecondaryBg: '#161E28',
  buttonSecondaryBorder: '#2C3846',
  chipSelectedBg: '#14304C',
  chipSelectedBorder: '#2E6491',

  // Feedback
  danger: '#F87171',
  dangerBg: '#2A1618',
  dangerBorder: '#6E3438',
  warning: '#FBBF24',
  warningBg: '#2A2212',
  warningBorder: '#6E5720',
  info: '#93C5FD',
  infoBg: '#141D2B',
  infoBorder: '#2F4C74',
} as const;

export interface StatusPalette {
  /** Text/label color. */
  fg: string;
  /** Fill color for the freshness bar. */
  bar: string;
  /** Border color for pills and accents. */
  border: string;
  /** Low-alpha wash for hero backgrounds. */
  wash: string;
}

/**
 * Keyed by the fused `status` the backend returns from engine/fusion.py.
 * Keep these four in sync with ItemState['status'].
 */
export const statusColors: Record<ItemState['status'], StatusPalette> = {
  fresh: { fg: '#4ADE80', bar: '#4ADE80', border: '#2C6E45', wash: 'rgba(74, 222, 128, 0.09)' },
  check_early: { fg: '#FBBF24', bar: '#FBBF24', border: '#6E5720', wash: 'rgba(251, 191, 36, 0.10)' },
  past_budget_quiet: {
    fg: '#93C5FD',
    bar: '#60A5FA',
    border: '#2F4C74',
    wash: 'rgba(147, 197, 253, 0.09)',
  },
  discard_quality_signal: {
    fg: '#F87171',
    bar: '#F87171',
    border: '#6E3438',
    wash: 'rgba(248, 113, 113, 0.10)',
  },
};

/**
 * Confidence is the *spread across tracks*, not a probability -- see
 * engine/fusion.py. Color it, but never render it as a percentage.
 */
export const confidenceColors: Record<ItemState['confidence'], { fg: string; border: string }> = {
  high: { fg: '#4ADE80', border: '#2C6E45' },
  med: { fg: '#FBBF24', border: '#6E5720' },
  low: { fg: '#F87171', border: '#6E3438' },
};

/** 4-point rhythm. Everything on screen should land on one of these. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

export const fontSize = {
  /** Hero freshness number only. */
  display: 52,
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 22,
} as const;

/** Uppercase section labels ("EAT FIRST", "TRACK AGREEMENT"). */
export const eyebrow = {
  fontSize: fontSize.xs,
  fontWeight: '700' as const,
  letterSpacing: 1.2,
};

/**
 * Depth. RN needs per-platform props: iOS uses shadow*, Android uses elevation,
 * and web maps the shadow props through react-native-web.
 */
export const shadows: { card: ViewStyle; hero: ViewStyle } = {
  card: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 3 },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
  }) as ViewStyle,
  hero: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 8 },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
  }) as ViewStyle,
};
