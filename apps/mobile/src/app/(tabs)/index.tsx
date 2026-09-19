import { Link, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { ItemRow } from '@/components/ItemRow';
import { ItemTile } from '@/components/ItemTile';
import { NotificationsBell } from '@/components/NotificationsBell';
import { TelemetryStrip } from '@/components/TelemetryStrip';
import { ViewModeToggle, type ViewMode } from '@/components/ViewModeToggle';
import { getState } from '@/lib/api';
import { colors, eyebrow, fontSize, spacing } from '@/lib/theme';
import type { AppState } from '@/lib/types';

const POLL_INTERVAL_MS = 3000;

const UNREACHABLE =
  'Check that the API is running and that EXPO_PUBLIC_API_BASE_URL points at this machine’s LAN IP.';

export default function FridgeScreen() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const navigation = useNavigation();

  // Alerts live on the notifications screen; the bell's badge is how this
  // screen still surfaces them.
  const alertCount = state?.alerts.length ?? 0;
  useEffect(() => {
    navigation.setOptions({ headerRight: () => <NotificationsBell count={alertCount} /> });
  }, [navigation, alertCount]);

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

  // items[0] is the most urgent -- the backend sorts by days_left. It gets a
  // color highlight in place rather than a separate card.
  const items = state.items;
  const mostUrgentId = items[0]?.id;

  return (
    <View style={styles.container}>
      <FlatList
        // FlatList cannot change numColumns in place; remount when the layout flips.
        key={viewMode}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={viewMode === 'grid' ? 2 : 1}
        columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
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
            {items.length > 0 && (
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitle}>
                  <Text style={styles.sectionLabel}>IN YOUR FRIDGE</Text>
                  <Text style={styles.sectionCount}>{items.length}</Text>
                </View>
                <ViewModeToggle mode={viewMode} onChange={setViewMode} />
              </View>
            )}
          </View>
        }
        renderItem={({ item }) =>
          viewMode === 'grid' ? (
            <View style={styles.gridCell}>
              <ItemTile item={item} highlighted={item.id === mostUrgentId} />
            </View>
          ) : (
            <ItemRow item={item} highlighted={item.id === mostUrgentId} />
          )
        }
        ListEmptyComponent={
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
    marginBottom: spacing.sm,
  },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionLabel: { ...eyebrow, color: colors.textDim },
  sectionCount: { color: colors.textDim, fontSize: fontSize.xs, fontWeight: '700' },
  // Each cell is exactly half the row, so a lone last tile doesn't stretch to full
  // width; the negative margin cancels the cells' outer padding at the list edges.
  gridRow: { marginHorizontal: -spacing.xs - 2 },
  gridCell: { width: '50%', paddingHorizontal: spacing.xs + 2, paddingBottom: spacing.md },
  emptyCard: { alignItems: 'flex-start' },
  emptyTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  emptyAction: { paddingVertical: spacing.xs },
  emptyActionText: { color: colors.accentText, fontSize: fontSize.sm, fontWeight: '700' },
});
