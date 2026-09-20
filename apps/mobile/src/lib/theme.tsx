/**
 * Single source of truth for color, spacing, type and elevation.
 *
 * Screens must not hardcode hex values -- add a token here instead. Before this
 * existed the same palette was hand-copied into all three screens, which is why
 * they drifted apart.
 *
 * Colors are per-scheme, so they cannot be read at module scope. Screens build
 * their stylesheet through `useStyles(makeStyles)` and read one-off values
 * through `useTheme()`.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Platform, useColorScheme, type ViewStyle } from 'react-native';

import type { ItemState } from './types';

const darkColors = {
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
};

export type ThemeColors = typeof darkColors;

/**
 * Light mirror of the same roles, not a brighter copy of the same hues: the
 * tinted fills (buttons, chips, banners) stay pale so `text` reads on top of
 * them, exactly as `text` reads on the dark theme's dark fills.
 */
const lightColors: ThemeColors = {
  bg: '#F4F6F9',
  surface: '#FFFFFF',
  surfaceRaised: '#EDF1F6',
  inputBg: '#FFFFFF',

  border: '#E2E8F0',
  borderStrong: '#CBD5E1',

  text: '#0F172A',
  textMuted: '#475569',
  textDim: '#64748B',

  accent: '#0284C7',
  accentText: '#0369A1',
  codeText: '#1D4ED8',
  buttonBg: '#DBEAFE',
  buttonBorder: '#93C5FD',
  buttonSecondaryBg: '#FFFFFF',
  buttonSecondaryBorder: '#CBD5E1',
  chipSelectedBg: '#DBEAFE',
  chipSelectedBorder: '#60A5FA',

  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  dangerBorder: '#FCA5A5',
  warning: '#B45309',
  warningBg: '#FFFBEB',
  warningBorder: '#FCD34D',
  info: '#1D4ED8',
  infoBg: '#EFF6FF',
  infoBorder: '#93C5FD',
};

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
export type StatusColors = Record<ItemState['status'], StatusPalette>;

const darkStatusColors: StatusColors = {
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

// `fg` is darkened against `bar`: the bar is a fill and only has to be seen,
// while `fg` is text on a near-white card and has to be read.
const lightStatusColors: StatusColors = {
  fresh: { fg: '#15803D', bar: '#22C55E', border: '#86EFAC', wash: 'rgba(34, 197, 94, 0.10)' },
  check_early: { fg: '#B45309', bar: '#F59E0B', border: '#FCD34D', wash: 'rgba(245, 158, 11, 0.12)' },
  past_budget_quiet: {
    fg: '#1D4ED8',
    bar: '#3B82F6',
    border: '#93C5FD',
    wash: 'rgba(59, 130, 246, 0.10)',
  },
  discard_quality_signal: {
    fg: '#B91C1C',
    bar: '#EF4444',
    border: '#FCA5A5',
    wash: 'rgba(239, 68, 68, 0.10)',
  },
};

/**
 * Confidence is the *spread across tracks*, not a probability -- see
 * engine/fusion.py. Color it, but never render it as a percentage.
 */
export type ConfidenceColors = Record<ItemState['confidence'], { fg: string; border: string }>;

const darkConfidenceColors: ConfidenceColors = {
  high: { fg: '#4ADE80', border: '#2C6E45' },
  med: { fg: '#FBBF24', border: '#6E5720' },
  low: { fg: '#F87171', border: '#6E3438' },
};

const lightConfidenceColors: ConfidenceColors = {
  high: { fg: '#15803D', border: '#86EFAC' },
  med: { fg: '#B45309', border: '#FCD34D' },
  low: { fg: '#B91C1C', border: '#FCA5A5' },
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
 *
 * Opacity is shared by both schemes: a black shadow on the near-black dark
 * background is invisible at any of these values, so it is tuned for light.
 */
const iosShadow = (opacity: number, radius: number, height: number): ViewStyle => ({
  shadowColor: '#000',
  shadowOpacity: opacity,
  shadowRadius: radius,
  shadowOffset: { width: 0, height },
});

export const shadows: { card: ViewStyle; hero: ViewStyle } = {
  card: Platform.select({
    android: { elevation: 3 },
    default: iosShadow(0.12, 10, 4),
  }) as ViewStyle,
  hero: Platform.select({
    android: { elevation: 8 },
    default: iosShadow(0.18, 20, 8),
  }) as ViewStyle,
};

// --- Scheme selection -------------------------------------------------------

export type ColorScheme = 'light' | 'dark';
/** What the user picked. 'system' follows the OS and is the default. */
export type ThemePreference = ColorScheme | 'system';

export const THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];

interface Theme {
  scheme: ColorScheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  colors: ThemeColors;
  statusColors: StatusColors;
  confidenceColors: ConfidenceColors;
}

const schemes: Record<ColorScheme, Omit<Theme, 'scheme' | 'preference' | 'setPreference'>> = {
  dark: {
    colors: darkColors,
    statusColors: darkStatusColors,
    confidenceColors: darkConfidenceColors,
  },
  light: {
    colors: lightColors,
    statusColors: lightStatusColors,
    confidenceColors: lightConfidenceColors,
  },
};

const ThemeContext = createContext<Theme>({
  scheme: 'dark',
  preference: 'system',
  setPreference: () => undefined,
  ...schemes.dark,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>('system');

  const value = useMemo<Theme>(() => {
    // useColorScheme is 'unspecified'/null until the OS answers; dark is this
    // app's origin, so that is what an unknown system scheme falls back to.
    const scheme: ColorScheme =
      preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;
    return { scheme, preference, setPreference, ...schemes[scheme] };
  }, [preference, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Build a stylesheet from the active palette.
 *
 * `make` must be a module-level const, not an inline arrow -- it is a useMemo
 * dependency, so a fresh function every render rebuilds the stylesheet every
 * render.
 */
export function useStyles<T>(make: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => make(colors), [make, colors]);
}
