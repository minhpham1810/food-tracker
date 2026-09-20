import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import { radius, spacing, THEME_PREFERENCES, useTheme, type ThemePreference } from '@/lib/theme';

const LABELS: Record<ThemePreference, string> = {
  system: 'following the system',
  light: 'light',
  dark: 'dark',
};

/**
 * Header action that cycles system -> light -> dark. One button rather than a
 * settings screen, in the same spirit as ViewModeToggle: the app has no other
 * settings to put on one.
 */
export function ThemeToggle() {
  const { colors, preference, setPreference } = useTheme();

  const next =
    THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(preference) + 1) % THEME_PREFERENCES.length];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Appearance: ${LABELS[preference]}. Switch to ${LABELS[next]}.`}
      hitSlop={spacing.sm}
      onPress={() => setPreference(next)}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      {preference === 'system' ? (
        <AutoIcon color={colors.text} />
      ) : preference === 'light' ? (
        <SunIcon color={colors.text} cutout={colors.surface} />
      ) : (
        <MoonIcon color={colors.text} cutout={colors.surface} />
      )}
    </Pressable>
  );
}

// Drawn from plain views for the same reason as TabBarIcon: no icon package.
// `cutout` is the header background: the shapes are built by covering part of a
// filled view with it, which is cheaper than pulling in an SVG renderer.

const STROKE = 1.8;

interface IconProps {
  color: ColorValue;
  cutout?: ColorValue;
  size?: number;
}

/** Outlined circle with a filled right half -- the usual "auto contrast" glyph. */
function AutoIcon({ color, size = 20 }: IconProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: STROKE,
        borderColor: color,
        overflow: 'hidden',
        alignItems: 'flex-end',
      }}>
      <View style={{ width: '50%', height: '100%', backgroundColor: color }} />
    </View>
  );
}

function SunIcon({ color, cutout, size = 20 }: IconProps) {
  const core = size * 0.52;
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      {[0, 45, 90, 135].map((angle) => (
        <View
          key={angle}
          style={{
            position: 'absolute',
            width: size,
            height: STROKE,
            borderRadius: STROKE,
            backgroundColor: color,
            transform: [{ rotate: `${angle}deg` }],
          }}
        />
      ))}
      {/* Painted over the middle of the rays, leaving eight spokes. */}
      <View
        style={{
          width: core,
          height: core,
          borderRadius: core / 2,
          borderWidth: STROKE,
          borderColor: color,
          backgroundColor: cutout,
        }}
      />
    </View>
  );
}

/** Crescent: a filled disc with an offset disc of the header color over it. */
function MoonIcon({ color, cutout, size = 20 }: IconProps) {
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
      <View
        style={{
          position: 'absolute',
          top: -size * 0.26,
          right: -size * 0.2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: cutout,
        }}
      />
    </View>
  );
}

// No color tokens here, so this sheet does not need to be per-scheme.
const styles = StyleSheet.create({
  button: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: radius.sm },
  pressed: { opacity: 0.6 },
  frame: { alignItems: 'center', justifyContent: 'center' },
});
