import { Link, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { ItemRow } from '@/components/ItemRow';
import { ItemTile } from '@/components/ItemTile';
import { NotificationsBell } from '@/components/NotificationsBell';
import { TelemetryStrip } from '@/components/TelemetryStrip';
import { ViewModeToggle, type ViewMode } from '@/components/ViewModeToggle';
import { getState } from '@/lib/api';
import { fontSize, spacing, useStyles, useTheme, type ThemeColors } from '@/lib/theme';
import type { AppState } from '@/lib/types';

const POLL_INTERVAL_MS = 3000;

const UNREACHABLE =
  'Check that the API is running and that EXPO_PUBLIC_API_BASE_URL points at this machine’s LAN IP.';

export default function FridgeScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
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
            {error !== null && <Text style={styles.errorText}>{error}</Text>}
            <TelemetryStrip
              telemetry={state.telemetry}
              paused={state.telemetry_paused}
              scenario={state.active_scenario}
            />
            {items.length > 0 && (
              <View style={styles.headerRow}>
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
            <Text style={styles.muted}>Scan a label, or add an item by hand.</Text>
            <Link href="/scan" asChild>
              {/* Link asChild injects the real navigation onPress via prop
                  composition; Button requires one, so this is a no-op. */}
              <Button title="Scan a label" onPress={() => {}} />
            </Link>
            <Link href="/add-item" asChild>
              <Button title="Add manually" variant="secondary" onPress={() => {}} />
            </Link>
          </Card>
        }
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 18 },
  errorText: { color: colors.danger, fontSize: fontSize.sm, marginBottom: spacing.sm },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.sm },
  // Each cell is exactly half the row, so a lone last tile doesn't stretch to full
  // width; the negative margin cancels the cells' outer padding at the list edges.
  gridRow: { marginHorizontal: -spacing.xs - 2 },
  gridCell: { width: '50%', paddingHorizontal: spacing.xs + 2, paddingBottom: spacing.md },
  emptyCard: { alignItems: 'flex-start' },
  emptyTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
});
