import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type ColorValue } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/lib/theme';

interface Props {
  /** Active alerts; a badge shows when this is above zero. */
  count: number;
}

/** Fridge header action -- opens the notifications screen. */
export function NotificationsBell({ count }: Props) {
  const label = count > 0 ? `Notifications, ${count} active` : 'Notifications';

  return (
    <Link href="/notifications" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.button}>
        <BellIcon color={colors.text} />
        {count > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

// Drawn from plain views for the same reason as TabBarIcon: no icon package.

const STROKE = 1.8;

function BellIcon({ color, size = 22 }: { color: ColorValue; size?: number }) {
  const dome = size * 0.62;
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <View
        style={{
          width: dome,
          height: size * 0.58,
          borderWidth: STROKE,
          borderBottomWidth: 0,
          borderColor: color,
          borderTopLeftRadius: dome / 2,
          borderTopRightRadius: dome / 2,
        }}
      />
      {/* Rim */}
      <View style={{ width: size * 0.84, height: STROKE, borderRadius: STROKE, backgroundColor: color }} />
      {/* Clapper */}
      <View
        style={{
          width: size * 0.22,
          height: size * 0.11,
          marginTop: 1.5,
          borderBottomLeftRadius: size * 0.11,
          borderBottomRightRadius: size * 0.11,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  frame: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 0,
    right: spacing.sm,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.bg, fontSize: 10, fontWeight: '800' },
});
