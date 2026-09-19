import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/lib/theme';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** Single-select chip -- food category pickers on the scan and add-item screens. */
export function Chip({ label, selected, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected]}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  selected: {
    backgroundColor: colors.chipSelectedBg,
    borderColor: colors.chipSelectedBorder,
  },
  label: { color: colors.text, fontSize: fontSize.sm },
});
