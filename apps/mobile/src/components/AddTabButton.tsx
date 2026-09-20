import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { shadows, useStyles, type ThemeColors } from '@/lib/theme';

interface Props {
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: ((e: GestureResponderEvent) => void) | null;
  accessibilityState?: { selected?: boolean };
}

const SIZE = 58;
const BAR = 3;

/**
 * The center tab: one raised plus button for every way of adding food. It opens
 * the scan screen, which also links to manual entry.
 */
export function AddTabButton({ onPress, onLongPress, accessibilityState }: Props) {
  const styles = useStyles(makeStyles);
  const selected = accessibilityState?.selected ?? false;

  return (
    <View style={styles.slot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add food"
        accessibilityState={{ selected }}
        onPress={onPress}
        onLongPress={onLongPress ?? undefined}
        style={({ pressed }) =>
          StyleSheet.flatten([styles.circle, shadows.hero, pressed && styles.pressed])
        }>
        <View style={styles.horizontal} />
        <View style={styles.vertical} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  slot: { flex: 1, alignItems: 'center' },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    // Lift it half out of the bar; the ring in the bar's color separates it
    // from the screen content behind.
    marginTop: -SIZE / 3,
    backgroundColor: colors.fabBg,
    borderWidth: 4,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  horizontal: { position: 'absolute', width: SIZE * 0.4, height: BAR, borderRadius: BAR, backgroundColor: colors.fabFg },
  vertical: { position: 'absolute', width: BAR, height: SIZE * 0.4, borderRadius: BAR, backgroundColor: colors.fabFg },
});
