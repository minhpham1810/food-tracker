import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Link, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { ItemRow } from '@/components/ItemRow';
import { Reveal } from '@/components/Reveal';
import { ItemTile } from '@/components/ItemTile';
import { NotificationsBell } from '@/components/NotificationsBell';
import { TelemetryStrip } from '@/components/TelemetryStrip';
import { ViewModeToggle, type ViewMode } from '@/components/ViewModeToggle';
import { getState } from '@/lib/api';
import { useUnseenAlertCount } from '@/lib/seenAlerts';
import {
  dividerLabel,
  fontSize,
  motion,
  radius,
  spacing,
  useStyles,
  useTheme,
  type ThemeColors,
} from '@/lib/theme';
import type { AppState, ItemState } from '@/lib/types';

const POLL_INTERVAL_MS = 3000;

/**
 * Real glass only exists on iOS 26 and up. Everywhere else the header pill has
 * to be opaque, because its whole job is to stay readable with rows sliding
 * under it -- a transparent fallback would be unreadable, not merely plainer.
 */
const GLASS = isLiquidGlassAvailable();

const UNREACHABLE =
  'Check that the API is running and that EXPO_PUBLIC_API_BASE_URL points at this machine’s LAN IP.';

/** Stable empty array: `state?.items ?? []` would be a new dep on every render. */
const NO_ITEMS: ItemState[] = [];

/** A fresh item with this much runway or less is still on tonight's menu. */
const EAT_FIRST_DAYS = 2;

/**
 * The whole point of the app in one predicate. Anything the engine is not
 * plainly happy about is on the short list, plus fresh food that is simply
 * running out. An item outside the modelled range has no defensible
 * `days_left`, so it is never promoted on that number alone.
 */
function eatFirst(item: ItemState): boolean {
  if (item.status !== 'fresh') return true;
  return !item.outside_model_range && item.days_left <= EAT_FIRST_DAYS;
}

/**
 * Rows, not items: SectionList has no `numColumns`, so grid mode pairs items up
 * and each row renders its own cells. A short final row is padded with an empty
 * cell so a lone tile does not stretch across the screen.
 */
function toRows(items: ItemState[], columns: number): ItemState[][] {
  const rows: ItemState[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return rows;
}

export default function FridgeScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const navigation = useNavigation();

  // Alerts live on the notifications screen; the bell's badge is how this
  // screen still surfaces them, and it clears once that screen has been opened.
  const alertCount = useUnseenAlertCount(state?.alerts);
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

  const items = state?.items ?? NO_ITEMS;
  const columns = viewMode === 'grid' ? 2 : 1;
  // The backend already sorts by days_left, so filtering preserves urgency
  // order inside each section.
  const sections = useMemo(
    () =>
      [
        { title: 'Eat first', data: toRows(items.filter(eatFirst), columns) },
        { title: 'Later', data: toRows(items.filter((item) => !eatFirst(item)), columns) },
      ].filter((section) => section.data.length > 0),
    [items, columns],
  );

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
    <View style={styles.container}>
      <SectionList
        // Rows change shape when the layout flips; remount rather than reconcile.
        key={viewMode}
        sections={sections}
        keyExtractor={(row) => row[0].id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onPullToRefresh()}
            tintColor={colors.textMuted}
          />
        }
        ListHeaderComponent={
          <Reveal>
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
          </Reveal>
        }
        renderSectionHeader={({ section }) => (
          <GlassView
            glassEffectStyle="regular"
            style={[styles.sectionHeader, !GLASS && styles.sectionHeaderSolid]}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
          </GlassView>
        )}
        renderItem={({ item: row, index }) => (
          // Mount-only, and the poll never remounts a row: keys are item ids,
          // so a reorder moves an instance rather than replacing it.
          <Reveal delay={index * motion.stagger}>
            {viewMode === 'grid' ? (
              <View style={styles.gridRow}>
                {row.map((item) => (
                  <View key={item.id} style={styles.gridCell}>
                    <ItemTile item={item} />
                  </View>
                ))}
                {row.length < columns && <View style={styles.gridCell} />}
              </View>
            ) : (
              <ItemRow item={row[0]} />
            )}
          </Reveal>
        )}
        ListEmptyComponent={
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing in the fridge yet</Text>
            <Text style={styles.muted}>Scan a label, or add an item by hand.</Text>
            <Link href="/scan" asChild>
              {/* Link asChild injects the real navigation onPress via prop
                  composition; Button requires one, so this is a no-op. */}
              <Button title="Scan a label" arrow onPress={() => {}} />
            </Link>
            <Link href="/add-item" asChild>
              <Button title="Add manually" variant="secondary" arrow onPress={() => {}} />
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
  list: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl * 2,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.sm },
  // A floating pill, not a full-bleed bar: it sticks, and rows pass behind it.
  sectionHeader: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  sectionHeaderSolid: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionHeaderText: { ...dividerLabel, color: colors.textMuted },
  gridRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  gridCell: { flex: 1 },
  emptyCard: { alignItems: 'flex-start' },
  emptyTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: '600', letterSpacing: -0.4 },
});
