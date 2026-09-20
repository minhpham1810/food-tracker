import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FreshnessBar } from './FreshnessBar';
import { itemMeta } from './ItemRow';
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
import { estimateText } from '@/lib/estimate';

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
  const { statusColors } = useTheme();
  const palette = statusColors[item.status];
  const meta = itemMeta(item);

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
          <View style={[styles.statusDot, { backgroundColor: palette.bar }]} />
          {item.has_photo === true ? (
            // On a photo the number needs its own backdrop, and `bar` rather than
            // `fg`: `fg` is tuned to read on a card, not on a dark scrim.
            <View style={styles.scrim}>
              <Text style={[styles.scrimNumber, { color: palette.bar }]}>
                {estimateText(item)}
              </Text>
            </View>
          ) : (
            <>
              <Text style={[styles.number, { color: palette.fg }]}>{estimateText(item)}</Text>
            </>
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
          <Text style={styles.meta}>assuming continued storage at {item.projection_temperature_c}C</Text>
          <Text style={styles.meta}>{item.profile_name} · D0: {item.d0_source} · Q10: {item.q10_source}</Text>
          <Text style={styles.meta}>Tracked since {new Date(item.created_at * 1000).toLocaleDateString()}</Text>
          {(item.history_message || item.estimate_message) && <Text style={styles.meta}>{item.history_message || item.estimate_message}</Text>}
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
  statusDot: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 7,
    height: 7,
    borderRadius: radius.pill,
  },
  number: { fontSize: 22, fontWeight: '800', letterSpacing: -1, textAlign: 'center' },
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
  scrimNumber: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: -0.4 },
  scrimUnit: { color: '#FBF5E3', fontSize: fontSize.xs, fontWeight: '600' },
  numberUnit: { color: colors.textMuted, fontSize: fontSize.xs },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: 2 },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  meta: { color: colors.textDim, fontSize: fontSize.xs },
});
