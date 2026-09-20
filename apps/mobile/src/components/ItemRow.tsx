import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FreshnessBar } from './FreshnessBar';
import { itemPhotoUrl } from '@/lib/api';
import { fontSize, radius, spacing, useStyles, useTheme, type ThemeColors } from '@/lib/theme';
import type { ItemState } from '@/lib/types';
import { estimate } from '@/lib/estimate';

interface Props {
  item: ItemState;
}

/**
 * List-view row for a fridge item: leading badge (the label photo when the item
 * was scanned, otherwise its initial), name, trailing number. The status word is
 * deliberately absent -- the color already says it, and detail lives one tap away.
 */
export function ItemRow({ item }: Props) {
  const styles = useStyles(makeStyles);
  const { statusColors } = useTheme();
  const palette = statusColors[item.status];
  const { value, label } = estimate(item);

  return (
    <Link href={{ pathname: '/items/[id]', params: { id: item.id } }} asChild>
      <Pressable accessibilityRole="button" style={styles.row}>
        <View style={[styles.badge, { backgroundColor: palette.wash, borderColor: palette.border }]}>
          {item.has_photo === true ? (
            <Image
              source={{ uri: itemPhotoUrl(item.id) }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              // The photo never changes, and the fridge list re-renders on every poll.
              cachePolicy="memory-disk"
              transition={120}
            />
          ) : (
            <Text style={[styles.badgeText, { color: palette.fg }]}>
              {item.name.trim().charAt(0).toUpperCase() || '?'}
            </Text>
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          {item.opened && <Text style={styles.meta}>Opened</Text>}
          {!item.outside_model_range && <FreshnessBar daysLeft={item.days_left} status={item.status} />}
        </View>

        <View style={styles.trailing}>
          {value !== null ? (
            <>
              <Text style={[styles.days, { color: palette.fg }]}>{value}</Text>
              <Text style={styles.daysUnit}>{label}</Text>
            </>
          ) : (
            <Text style={[styles.daysStatus, { color: palette.fg }]} numberOfLines={2}>
              {label}
            </Text>
          )}
        </View>
      </Pressable>
    </Link>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    // Clips the photo to the rounded corners.
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: fontSize.lg, fontWeight: '600' },
  body: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: '500', letterSpacing: -0.1 },
  meta: { color: colors.textDim, fontSize: fontSize.xs },
  // Caps the trailing block so a long status word can't squeeze the name column.
  trailing: { alignItems: 'flex-end', maxWidth: 84 },
  days: { fontSize: fontSize.xl, fontWeight: '600', letterSpacing: -0.5 },
  daysUnit: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textDim },
  daysStatus: { fontSize: fontSize.sm, fontWeight: '600', textAlign: 'right' },
});
