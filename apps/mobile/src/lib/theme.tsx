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

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform, useColorScheme, type ViewStyle } from 'react-native';

import type { ItemState } from './types';

const darkColors = {
  // Surfaces -- the brand ink (#2A2100) taken down to near-black. Warm, so the
  // yellow mark in the app icon looks like it came from the same tin of paint.
  bg: '#14110A',
  surface: '#1E1A0F',
  surfaceRaised: '#292314',
  inputBg: '#171308',

  // Lines: hairlines, not boxes. Borders here are felt more than seen.
  border: '#332C1B',
  borderStrong: '#473D26',

  // Text
  text: '#FBF5E3',
  textMuted: '#BCAE8B',
  textDim: '#8D815F',

  // Interactive -- brand yellow.
  accent: '#FFD93D',
  accentText: '#FFD93D',
  codeText: '#F0CE7A',
  buttonBg: '#4A3A0C',
  buttonBorder: '#7A5F14',
  buttonSecondaryBg: '#201B10',
  buttonSecondaryBorder: '#473D26',
  chipSelectedBg: '#4A3A0C',
  chipSelectedBorder: '#C99B1E',

  // Feedback. `warning` is orange, not amber: amber is now the brand's own
  // color and would read as chrome rather than as a warning.
  danger: '#F87171',
  dangerBg: '#2C1512',
  dangerBorder: '#6E3A32',
  warning: '#FB923C',
  warningBg: '#2E1D0C',
  warningBorder: '#6E4820',
  info: '#93C5FD',
  infoBg: '#16202B',
  infoBorder: '#2F4C74',
};

export type ThemeColors = typeof darkColors;

/**
 * Light mirror of the same roles, not a brighter copy of the same hues: the
 * tinted fills (buttons, chips, banners) stay pale so `text` reads on top of
 * them, exactly as `text` reads on the dark theme's dark fills.
 */
const lightColors: ThemeColors = {
  bg: '#FFF8E1',
  surface: '#FFFFFF',
  surfaceRaised: '#FFF2C9',
  inputBg: '#FFFFFF',

  border: '#EFE2B4',
  borderStrong: '#DCC886',

  text: '#2A2100',
  textMuted: '#6A5C2C',
  textDim: '#8A7B48',

  // Brand yellow is a fill here, never text: on white it fails contrast, so
  // anything that has to be *read* uses the deep gold instead.
  accent: '#B26E00',
  accentText: '#8F5A00',
  codeText: '#7A4E00',
  buttonBg: '#FFD93D',
  buttonBorder: '#E0B01E',
  buttonSecondaryBg: '#FFFFFF',
  buttonSecondaryBorder: '#DCC886',
  chipSelectedBg: '#FFE98F',
  chipSelectedBorder: '#E0B01E',

  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  dangerBorder: '#FCA5A5',
  warning: '#C2410C',
  warningBg: '#FFF4E8',
  warningBorder: '#FDBA74',
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
  check_early: { fg: '#FDBA74', bar: '#FB923C', border: '#7A4820', wash: 'rgba(251, 146, 60, 0.10)' },
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
  check_early: { fg: '#C2410C', bar: '#F97316', border: '#FDBA74', wash: 'rgba(249, 115, 22, 0.12)' },
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
  med: { fg: '#FDBA74', border: '#7A4820' },
  low: { fg: '#F87171', border: '#6E3438' },
};

const lightConfidenceColors: ConfidenceColors = {
  high: { fg: '#15803D', border: '#86EFAC' },
  med: { fg: '#C2410C', border: '#FDBA74' },
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

const THEME_PREFERENCE_KEY = 'freshness-tracker.theme-preference';

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
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(THEME_PREFERENCE_KEY)
      .then((stored) => {
        if (active && THEME_PREFERENCES.includes(stored as ThemePreference)) {
          setPreferenceState(stored as ThemePreference);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(THEME_PREFERENCE_KEY, next).catch(() => undefined);
  }, []);

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
