import { StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { colors, fontSize, spacing } from '@/lib/theme';

interface Props {
  message: string;
  onRetry: () => void;
}

/**
 * Full-screen failure state with a way out. Replaces the previous behaviour where
 * a failed first fetch left the screen on a spinner forever with no retry.
 */
export function ErrorState({ message, onRetry }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Can&apos;t reach the backend</Text>
      <Text style={styles.message}>{message}</Text>
      <Button title="Try again" onPress={onRetry} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  message: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 19 },
  button: { marginTop: spacing.sm, alignSelf: 'stretch' },
});
