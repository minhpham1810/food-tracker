import { Link } from 'expo-router';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import { radius, spacing, useTheme } from '@/lib/theme';

/** Header action that opens app preferences and help. */
export function SettingsButton() {
  const { colors } = useTheme();
  return (
    <Link href="/settings" asChild>
      {/* The inset lives on the inner View, not on the Pressable's `style`:
          `Link asChild` merges props through Radix's Slot, which combines
          `style` by object spread. Spreading a function yields {}, so a
          `({ pressed }) => ...` style is silently dropped -- which is how this
          button ended up flush against the screen edge. */}
      <Pressable accessibilityRole="button" accessibilityLabel="Settings" hitSlop={spacing.sm}>
        {({ pressed }) => (
          <View style={[styles.inner, pressed && styles.pressed]}>
            <SettingsIcon color={colors.text} />
          </View>
        )}
      </Pressable>
    </Link>
  );
}

/** Three sliders: recognizable on iOS, Android and web without an icon font. */
function SettingsIcon({ color, size = 22 }: { color: ColorValue; size?: number }) {
  const knob = 5;
  return (
    <View style={{ width: size, height: size, justifyContent: 'space-around', paddingVertical: 2 }}>
      {[0.28, 0.7, 0.42].map((position, index) => (
        <View key={index} style={styles.track}>
          <View style={[styles.line, { backgroundColor: color }]} />
          <View
            style={[
              styles.knob,
              {
                backgroundColor: color,
                left: size * position - knob / 2,
                width: knob,
                height: knob,
                borderRadius: knob / 2,
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches the screens' own gutter, so the icon lines up with content below.
  inner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: radius.pill },
  pressed: { opacity: 0.6 },
  track: { height: 5, justifyContent: 'center' },
  line: { height: 1.8, borderRadius: 2 },
  knob: { position: 'absolute' },
});
