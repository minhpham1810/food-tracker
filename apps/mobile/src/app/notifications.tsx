import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AlertsBanner } from '@/components/AlertsBanner';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { getState } from '@/lib/api';
import { eyebrow, fontSize, spacing, useStyles, useTheme, type ThemeColors } from '@/lib/theme';
import type { AppState } from '@/lib/types';

const POLL_INTERVAL_MS = 3000;

const UNREACHABLE =
  'Check that the API is running and that EXPO_PUBLIC_API_BASE_URL points at this machine’s LAN IP.';

/**
 * Fridge and food alerts, opened from the bell on the Fridge tab. Same /state
 * payload as the Fridge screen, polled only while open.
 */
export default function NotificationsScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await getState());
      setError(null);
    } catch {
      setError(UNREACHABLE);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [refresh]),
  );

  const onPullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  if (state === null && error !== null) {
    return <ErrorState message={error} onRetry={() => void refresh()} />;
  }

  if (state === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading notifications…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onPullToRefresh()}
          tintColor={colors.textMuted}
        />
      }>
      {error !== null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>ALERTS</Text>
        <Text style={styles.sectionCount}>{state.alerts.length}</Text>
      </View>
      {state.alerts.length > 0 ? (
        <AlertsBanner alerts={state.alerts} />
      ) : (
        <Card>
          <Text style={styles.emptyTitle}>All clear</Text>
          <Text style={styles.muted}>No fridge or food alerts right now.</Text>
        </Card>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 18 },
  errorBanner: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
  },
  errorText: { color: colors.danger, fontSize: fontSize.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionLabel: { ...eyebrow, color: colors.textDim },
  sectionCount: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '700' },
  emptyTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
});
