import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FreshnessBar } from './FreshnessBar';
import { colors, fontSize, radius, shadows, spacing, statusColors } from '@/lib/theme';
import type { ItemState } from '@/lib/types';

interface Props {
  item: ItemState;
}

/**
 * Compact row for everything below the hero. Deliberately quieter: name, number,
 * bar. Detail and actions live one tap away rather than repeating per row.
 */
export function ItemRow({ item }: Props) {
  const palette = statusColors[item.status];

  // Link asChild clones its single child, and expo-router rejects a style ARRAY
  // on that child -- flatten it into one object first.
  const rowStyle = StyleSheet.flatten([styles.row, shadows.card]);

  return (
    <Link href={{ pathname: '/items/[id]', params: { id: item.id } }} asChild>
      <Pressable accessibilityRole="button" style={rowStyle}>
        <View style={styles.topRow}>
          <View style={styles.nameGroup}>
            <View style={[styles.statusDot, { backgroundColor: palette.bar }]} />
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
          </View>
          <Text style={[styles.days, { color: palette.fg }]}>
            {item.days_left.toFixed(1)}
            <Text style={styles.daysUnit}> d</Text>
          </Text>
        </View>
        <FreshnessBar daysLeft={item.days_left} status={item.status} />
        {item.opened && <Text style={styles.meta}>Opened</Text>}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nameGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  statusDot: { width: 7, height: 7, borderRadius: radius.pill },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: '600', flexShrink: 1 },
  days: { fontSize: fontSize.lg, fontWeight: '700' },
  daysUnit: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textDim },
  meta: { color: colors.textDim, fontSize: fontSize.xs },
});
