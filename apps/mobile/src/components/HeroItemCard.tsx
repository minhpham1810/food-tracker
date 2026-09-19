import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { FreshnessBar } from './FreshnessBar';
import { Pill } from './Pill';
import { colors, confidenceColors, eyebrow, fontSize, radius, shadows, spacing, statusColors } from '@/lib/theme';
import type { ItemState } from '@/lib/types';

interface Props {
  item: ItemState;
  statusCopy: string;
  pending: boolean;
  onMarkOpened: () => void;
}

/**
 * The single most urgent item, given the whole top of the screen.
 *
 * The list is already sorted by days_left, so item[0] is the answer to "what do
 * I eat first" -- the point of the product. Making the reader scan a uniform
 * list to find that out wastes the ordering the engine already did.
 */
export function HeroItemCard({ item, statusCopy, pending, onMarkOpened }: Props) {
  const palette = statusColors[item.status];

  return (
    <View style={[styles.card, { backgroundColor: palette.wash, borderColor: palette.border }, shadows.hero]}>
      <View style={styles.headerRow}>
        <Text style={[styles.eyebrow, { color: palette.fg }]}>EAT FIRST</Text>
        <Pill label={item.confidence} {...confidenceColors[item.confidence]} />
      </View>

      <Link href={{ pathname: '/items/[id]', params: { id: item.id } }} asChild>
        <Pressable accessibilityRole="button" style={styles.body}>
          <Text style={styles.name} numberOfLines={2}>
            {item.name}
          </Text>

          <View style={styles.numberRow}>
            <Text style={[styles.number, { color: palette.fg }]}>{item.days_left.toFixed(1)}</Text>
            <Text style={styles.numberUnit}>days{'\n'}left</Text>
          </View>

          <FreshnessBar daysLeft={item.days_left} status={item.status} />
          <Text style={styles.statusCopy}>{statusCopy}</Text>

          {item.placeholder_profile && (
            <View style={styles.badgeRow}>
              <Pill label="Demo coefficients" fg={colors.textDim} border={colors.borderStrong} />
            </View>
          )}
        </Pressable>
      </Link>

      <Button
        title={item.opened ? 'Opened' : 'Mark opened'}
        disabled={item.opened || pending}
        onPress={onMarkOpened}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { ...eyebrow },
  body: { gap: spacing.sm },
  name: { color: colors.text, fontSize: fontSize.xl, fontWeight: '700' },
  numberRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  number: {
    fontSize: fontSize.display,
    fontWeight: '800',
    lineHeight: fontSize.display * 1.02,
    letterSpacing: -1.5,
  },
  numberUnit: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 16,
    paddingBottom: spacing.sm,
  },
  statusCopy: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 18 },
  badgeRow: { flexDirection: 'row', marginTop: spacing.xs },
});
