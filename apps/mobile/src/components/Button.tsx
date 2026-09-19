import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/lib/theme';

interface Props {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  style?: ViewStyle;
}

export function Button({ title, onPress, disabled = false, variant = 'primary', style }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.base, variant === 'secondary' && styles.secondary, disabled && styles.disabled, style]}>
      <Text style={styles.label}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.buttonBg,
    borderColor: colors.buttonBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  secondary: {
    backgroundColor: colors.buttonSecondaryBg,
    borderColor: colors.buttonSecondaryBorder,
  },
  disabled: { opacity: 0.5 },
  label: { color: colors.text, fontWeight: '700', fontSize: fontSize.md, letterSpacing: -0.1 },
});
