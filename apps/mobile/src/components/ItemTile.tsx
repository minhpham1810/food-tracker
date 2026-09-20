import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FreshnessBar } from './FreshnessBar';
import { itemMeta, statusWord } from './ItemRow';
import { itemPhotoUrl } from '@/lib/api';
import {
  fontSize,
  radius,
  shadows,
  spacing,
  useStyles,
  useTheme,
  type ThemeColors,
} from '@/lib/theme';
import type { ItemState } from '@/lib/types';
import { estimate } from '@/lib/estimate';

interface Props {
  item: ItemState;
  /** The most urgent item: marked with a status-color border, not a label. */
  highlighted?: boolean;
}

/**
 * Grid-view tile, laid out like a Google Drive file card: a large preview area
 * on top -- the label photo for a scanned item, otherwise the days-left number
 * on the status wash -- and the name underneath.
 */
export function ItemTile({ item, highlighted = false }: Props) {
  const styles = useStyles(makeStyles);
  const { statusColors, colors } = useTheme();
  const palette = statusColors[item.status];
  const meta = itemMeta(item);
  const { value, label } = estimate(item);

  // Link asChild clones its single child, and expo-router rejects a style ARRAY
  // on that child -- flatten it into one object first.
  const tileStyle = StyleSheet.flatten([
    styles.tile,
    highlighted ? [styles.highlighted, { borderColor: palette.bar }, shadows.hero] : shadows.card,
  ]);

  return (
    <Link href={{ pathname: '/items/[id]', params: { id: item.id } }} asChild>
      <Pressable accessibilityRole="button" style={tileStyle}>
        <View style={[styles.preview, { backgroundColor: palette.wash }]}>
          {item.has_photo === true && (
            <Image
              source={{ uri: itemPhotoUrl(item.id) }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              // The photo never changes, and the fridge list re-renders on every poll.
              cachePolicy="memory-disk"
              transition={120}
            />
          )}
          <View style={[styles.statusBadge, { backgroundColor: colors.surface, borderColor: palette.border }]}>
            <Text style={[styles.statusBadgeText, { color: palette.fg }]}>{statusWord(item.status)}</Text>
          </View>
          {item.has_photo === true ? (
            // On a photo the number needs its own backdrop, and `bar` rather than
            // `fg`: `fg` is tuned to read on a card, not on a dark scrim.
            <View style={styles.scrim}>
              {value !== null ? (
                <View style={styles.scrimRow}>
                  <Text style={[styles.scrimNumber, { color: palette.bar }]}>{value}</Text>
                  <Text style={styles.scrimUnit}>{label}</Text>
                </View>
              ) : (
                <Text style={[styles.scrimNumber, { color: palette.bar }]}>{label}</Text>
              )}
            </View>
          ) : value !== null ? (
            <View style={styles.numberRow}>
              <Text style={[styles.number, { color: palette.fg }]}>{value}</Text>
              <Text style={styles.numberUnit}>{label}</Text>
            </View>
          ) : (
            <Text style={[styles.statusWord, { color: palette.fg }]}>{label}</Text>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta ?? ' '}
          </Text>
          {!item.outside_model_range && <FreshnessBar daysLeft={item.days_left} status={item.status} />}
        </View>
      </Pressable>
    </Link>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  highlighted: { borderWidth: 1.5 },
  preview: {
    aspectRatio: 1.35,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  statusBadgeText: { fontSize: fontSize.xs, fontWeight: '700' },
  numberRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: spacing.xs },
  number: { fontSize: 22, fontWeight: '800', letterSpacing: -1, textAlign: 'center' },
  numberUnit: { color: colors.textMuted, fontSize: fontSize.xs, paddingBottom: 3 },
  statusWord: { fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center', paddingHorizontal: spacing.sm },
  // Fixed black/white: this sits on the photo, not on a themed surface.
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  scrimRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  scrimNumber: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: -0.4 },
  scrimUnit: { color: '#FBF5E3', fontSize: fontSize.xs, fontWeight: '600', paddingBottom: 2 },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: 2 },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  meta: { color: colors.textDim, fontSize: fontSize.xs },
});
