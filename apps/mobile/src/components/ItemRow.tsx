import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FreshnessBar } from './FreshnessBar';
import { itemPhotoUrl } from '@/lib/api';
import { fontSize, radius, spacing, useStyles, useTheme, type ThemeColors } from '@/lib/theme';
import type { ItemState } from '@/lib/types';
import { estimateText } from '@/lib/estimate';

interface Props {
  item: ItemState;
  /** The most urgent item: marked with a status-color wash, not a label. */
  highlighted?: boolean;
}

/** Secondary line shared by the list row and the grid tile. */
export function itemMeta(item: ItemState): string | null {
  const parts = [item.brand, item.opened ? 'Opened' : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * List-view row for a fridge item, laid out like a Google Drive
 * file row: leading badge (the label photo when the item was scanned, otherwise
 * its initial), name + meta, trailing number. Detail and actions
 * live one tap away rather than repeating per row.
 */
export function ItemRow({ item, highlighted = false }: Props) {
  const styles = useStyles(makeStyles);
  const { statusColors } = useTheme();
  const palette = statusColors[item.status];
  const meta = itemMeta(item);

  return (
    <Link href={{ pathname: '/items/[id]', params: { id: item.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        style={
          highlighted
            ? StyleSheet.flatten([
                styles.row,
                styles.highlighted,
                { backgroundColor: palette.wash, borderColor: palette.border },
              ])
            : styles.row
        }>
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
          {meta !== null && (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          )}
          {!item.outside_model_range && <FreshnessBar daysLeft={item.days_left} status={item.status} />}
          <Text style={styles.meta}>assuming continued storage at {item.projection_temperature_c}C</Text>
          <Text style={styles.meta}>{item.profile_name} · D0: {item.d0_source} · Q10: {item.q10_source}</Text>
          <Text style={styles.meta}>Tracked since {new Date(item.created_at * 1000).toLocaleDateString()}</Text>
          {(item.history_message || item.estimate_message) && <Text style={styles.meta}>{item.history_message || item.estimate_message}</Text>}
        </View>

        <Text style={[styles.days, { color: palette.fg }]}>
          {estimateText(item)}
        </Text>
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
    // A transparent frame on every row keeps content aligned with the
    // highlighted row, whose frame is colored.
    borderWidth: 1,
    borderColor: 'transparent',
    borderBottomColor: colors.border,
  },
  // Link asChild rejects a style array, hence the flatten above.
  highlighted: { borderRadius: radius.md, marginBottom: spacing.xs },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    // Clips the photo to the rounded corners.
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: fontSize.lg, fontWeight: '700' },
  body: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  meta: { color: colors.textDim, fontSize: fontSize.xs },
  days: { fontSize: fontSize.lg, fontWeight: '700' },
  daysUnit: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textDim },
});
