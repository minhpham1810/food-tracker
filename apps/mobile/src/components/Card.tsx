import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radius, shadows, spacing } from '@/lib/theme';

interface Props {
  children: ReactNode;
  style?: ViewStyle;
}

export function Card({ children, style }: Props) {
  return <View style={[styles.card, shadows.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
