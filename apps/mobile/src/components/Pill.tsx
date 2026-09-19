import { StyleSheet, Text } from 'react-native';

import { fontSize, radius, spacing } from '@/lib/theme';

interface Props {
  label: string;
  fg: string;
  border: string;
}

/** Small outlined chip -- confidence badges, "Demo coefficients", track labels. */
export function Pill({ label, fg, border }: Props) {
  return <Text style={[styles.pill, { color: fg, borderColor: border }]}>{label}</Text>;
}

const styles = StyleSheet.create({
  pill: {
    fontSize: fontSize.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    overflow: 'hidden',
  },
});
