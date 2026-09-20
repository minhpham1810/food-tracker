import { Pressable, StyleSheet, Text } from 'react-native';

import { fontSize, radius, spacing, useStyles, type ThemeColors } from '@/lib/theme';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** Single-select chip -- food category pickers on the scan and add-item screens. */
export function Chip({ label, selected, onPress }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  chip: {
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  selected: {
    backgroundColor: colors.chipSelectedBg,
    borderColor: colors.chipSelectedBorder,
  },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  label: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
});
