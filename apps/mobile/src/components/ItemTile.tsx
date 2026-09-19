import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FreshnessBar } from './FreshnessBar';
import { itemMeta } from './ItemRow';
import { colors, fontSize, radius, shadows, spacing, statusColors } from '@/lib/theme';
import type { ItemState } from '@/lib/types';

interface Props {
  item: ItemState;
  /** The most urgent item: marked with a status-color border, not a label. */
  highlighted?: boolean;
}

/**
 * Grid-view tile, laid out like a Google Drive file card: a large preview area
 * on top (here the days-left number on the status wash, since items have no
 * photo) and the name underneath.
 */
export function ItemTile({ item, highlighted = false }: Props) {
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
          <View style={[styles.statusDot, { backgroundColor: palette.bar }]} />
          <Text style={[styles.number, { color: palette.fg }]}>{item.days_left.toFixed(1)}</Text>
          <Text style={styles.numberUnit}>days left</Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta ?? ' '}
          </Text>
          <FreshnessBar daysLeft={item.days_left} status={item.status} />
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
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
  number: { fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  numberUnit: { color: colors.textMuted, fontSize: fontSize.xs },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: 2 },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  meta: { color: colors.textDim, fontSize: fontSize.xs },
});
