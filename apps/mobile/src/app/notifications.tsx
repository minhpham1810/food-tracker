import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AlertsBanner } from '@/components/AlertsBanner';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { getState } from '@/lib/api';
import { markAlertsSeen } from '@/lib/seenAlerts';
import { fontSize, spacing, useStyles, useTheme, type ThemeColors } from '@/lib/theme';
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
      const next = await getState();
      setState(next);
      // Read the moment they are on screen, including ones that arrive while
      // it stays open -- the user is looking straight at them.
      markAlertsSeen(next.alerts);
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
      {error !== null && <Text style={styles.errorText}>{error}</Text>}

      {state.alerts.length > 0 ? (
        <AlertsBanner alerts={state.alerts} />
      ) : (
        <Card>
          <Text style={styles.emptyTitle}>All clear</Text>
          <Text style={styles.muted}>Nothing needs your attention.</Text>
        </Card>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 18 },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.md },
  emptyTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
});
