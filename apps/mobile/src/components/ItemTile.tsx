import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { itemPhotoUrl } from '@/lib/api';
import {
  bezel,
  dividerLabel,
  fontSize,
  radius,
  spacing,
  useStyles,
  useTheme,
  type ThemeColors,
} from '@/lib/theme';
import type { ItemState } from '@/lib/types';
import { estimate } from '@/lib/estimate';

interface Props {
  item: ItemState;
}

/**
 * Grid tile: a preview area carrying the one number that matters -- the label
 * photo for a scanned item, otherwise the days left on the status wash -- and
 * the name underneath. No status word and no bar: at this size the color and
 * the figure say the same thing three times over.
 */
export function ItemTile({ item }: Props) {
  const styles = useStyles(makeStyles);
  const { statusColors } = useTheme();
  const palette = statusColors[item.status];
  const { value, label } = estimate(item);

  return (
    <Link href={{ pathname: '/items/[id]', params: { id: item.id } }} asChild>
      <Pressable accessibilityRole="button" style={styles.tile}>
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
          {item.opened && <Text style={styles.opened}>Opened</Text>}
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
        </View>
      </Pressable>
    </Link>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  // The tray.
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.xxl,
    padding: bezel,
  },
  // The plate. Concentric with the tray, and it clips its own photo.
  preview: {
    aspectRatio: 1.35,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xxl - bezel,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  numberRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: spacing.xs },
  number: { fontSize: fontSize.display * 0.75, fontWeight: '600', letterSpacing: -1.6, textAlign: 'center' },
  numberUnit: { color: colors.textMuted, fontSize: fontSize.xs, paddingBottom: 7 },
  opened: {
    ...dividerLabel,
    position: 'absolute',
    top: spacing.sm,
    left: spacing.md,
    color: colors.textDim,
  },
  statusWord: { fontSize: fontSize.sm, fontWeight: '600', textAlign: 'center', paddingHorizontal: spacing.sm },
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
  scrimNumber: { fontSize: fontSize.lg, fontWeight: '700', letterSpacing: -0.4 },
  scrimUnit: { color: '#FBF5E3', fontSize: fontSize.xs, fontWeight: '600', paddingBottom: 2 },
  footer: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  name: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500', letterSpacing: -0.1 },
});
