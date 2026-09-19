import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AlertsBanner } from '@/components/AlertsBanner';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { HeroItemCard } from '@/components/HeroItemCard';
import { ItemRow } from '@/components/ItemRow';
import { TelemetryStrip } from '@/components/TelemetryStrip';
import { getState, markOpened } from '@/lib/api';
import { colors, eyebrow, fontSize, spacing } from '@/lib/theme';
import type { AppState, ItemState } from '@/lib/types';

const POLL_INTERVAL_MS = 3000;

const statusCopy: Record<ItemState['status'], string> = {
  fresh: 'Tracks aligned with the temperature-history forecast.',
  check_early: "Something's off — check this early.",
  past_budget_quiet: 'Past date but no spoilage signal — inspect before tossing.',
  discard_quality_signal: 'Quality decline signal detected — discard this item.',
};

const UNREACHABLE =
  'Check that the API is running and that EXPO_PUBLIC_API_BASE_URL points at this machine’s LAN IP.';

export default function FridgeScreen() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // One round trip for telemetry + items + alerts; items arrive pre-sorted.
      setState(await getState());
      setError(null);
    } catch {
      setError(UNREACHABLE);
    }
  }, []);

  // Poll only while this tab is focused -- the previous setInterval kept hitting
  // the API from the Scan and Assistant tabs too.
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

  const onMarkOpened = async (id: string) => {
    setPendingId(id);
    try {
      await markOpened(id);
      await refresh();
    } catch {
      setError('Could not mark that item opened.');
    } finally {
      setPendingId(null);
    }
  };

  if (state === null && error !== null) {
    return <ErrorState message={error} onRetry={() => void refresh()} />;
  }

  if (state === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading fridge…</Text>
      </View>
    );
  }

  // items[0] is the most urgent -- the backend sorts by days_left.
  const [hero, ...rest] = state.items;

  return (
    <View style={styles.container}>
      <FlatList
        data={rest}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onPullToRefresh()}
            tintColor={colors.textMuted}
          />
        }
        ListHeaderComponent={
          <View>
            {error !== null && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            <TelemetryStrip
              telemetry={state.telemetry}
              paused={state.telemetry_paused}
              scenario={state.active_scenario}
            />
            <AlertsBanner alerts={state.alerts} />
            {hero && (
              <HeroItemCard
                item={hero}
                statusCopy={statusCopy[hero.status]}
                pending={pendingId === hero.id}
                onMarkOpened={() => void onMarkOpened(hero.id)}
              />
            )}
            {rest.length > 0 && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>ALSO IN YOUR FRIDGE</Text>
                <Text style={styles.sectionCount}>{rest.length}</Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => <ItemRow item={item} />}
        ListEmptyComponent={
          hero ? null : (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nothing in the fridge yet</Text>
              <Text style={styles.muted}>
                Scan a product label, or add an item by hand if there is nothing to scan.
              </Text>
              <Link href="/scan" asChild>
                <Pressable accessibilityRole="button" style={styles.emptyAction}>
                  <Text style={styles.emptyActionText}>Scan a label</Text>
                </Pressable>
              </Link>
              <Link href="/add-item" asChild>
                <Pressable accessibilityRole="button" style={styles.emptyAction}>
                  <Text style={styles.emptyActionText}>Add manually</Text>
                </Pressable>
              </Link>
            </Card>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionLabel: { ...eyebrow, color: colors.textDim },
  sectionCount: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '700' },
  emptyCard: { alignItems: 'flex-start' },
  emptyTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  emptyAction: { paddingVertical: spacing.xs },
  emptyActionText: { color: colors.accentText, fontSize: fontSize.sm, fontWeight: '700' },
});
