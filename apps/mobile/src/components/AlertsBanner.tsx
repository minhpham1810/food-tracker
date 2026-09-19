import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/lib/theme';
import type { Alert } from '@/lib/types';

function palette(severity: string) {
  if (severity === 'warning') {
    return { bg: colors.warningBg, border: colors.warningBorder, fg: colors.warning };
  }
  if (severity === 'critical' || severity === 'error') {
    return { bg: colors.dangerBg, border: colors.dangerBorder, fg: colors.danger };
  }
  return { bg: colors.infoBg, border: colors.infoBorder, fg: colors.info };
}

export function AlertsBanner({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  return (
    <View style={styles.stack}>
      {alerts.map((alert) => {
        const p = palette(alert.severity);
        return (
          <View
            key={alert.code}
            style={[styles.row, { backgroundColor: p.bg, borderColor: p.border }]}>
            <Text style={[styles.text, { color: p.fg }]}>{alert.message}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm, marginBottom: spacing.sm + 2 },
  row: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  text: { fontSize: fontSize.sm, lineHeight: 18 },
});
