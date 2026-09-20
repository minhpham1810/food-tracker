import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ErrorState } from '@/components/ErrorState';
import { FreshnessBar } from '@/components/FreshnessBar';
import { Pill } from '@/components/Pill';
import {
  deleteItem,
  getItem,
  getProfiles,
  markOpened,
  renameItem,
  setCategory,
  setLabelScore,
} from '@/lib/api';
import {
  eyebrow,
  fontSize,
  radius,
  shadows,
  spacing,
  useStyles,
  useTheme,
  type ThemeColors,
} from '@/lib/theme';
import type { FoodProfile, ItemState } from '@/lib/types';
import { parsePrintedDate } from '@/lib/dates';
import { estimate, dayBudgetText, agingRateText, AGING_RATE_EMPHASIS, statusLabel } from '@/lib/estimate';
import { formatTemperature, useSettings } from '@/lib/settings';

/** Matches the dashboard's cadence so the aging rate tracks new readings. */
const ITEM_POLL_INTERVAL_MS = 3000;

const statusCopy: Record<ItemState['status'], string> = {
  fresh: 'Tracks aligned with the temperature-history forecast.',
  check_early: "Something's off — check this early.",
  past_budget_quiet: 'Past date but no spoilage signal — inspect before tossing.',
  discard_quality_signal: 'Quality decline signal detected — discard this item.',
};

/** The three states the two-patch colorimetric label can be scored as. */
const labelScores = [
  ['Fresh', 1.0],
  ['Ambiguous', 0.5],
  ['Spoiled', 0.1],
] as const;

function percent(value: number | null, fallback: string): string {
  return value == null ? fallback : `${Math.round(value * 100)}%`;
}

export default function ItemDetailScreen() {
  const styles = useStyles(makeStyles);
  const { colors, statusColors, confidenceColors } = useTheme();
  const { temperatureUnit } = useSettings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<ItemState | null>(null);
  const [profiles, setProfiles] = useState<FoodProfile[]>([]);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getItem(id);
      setItem(next);
      setDraftName(next.name);
      setError(null);
    } catch {
      setError('Could not load this item. It may have been removed, or the API restarted.');
    }
  }, [id]);

  useEffect(() => {
    void load();
    getProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, [load]);

  // The aging rate reflects the newest reading, so this screen polls like the
  // dashboard. Unlike load() it leaves draftName alone, so a rename in
  // progress is not overwritten, and it stands down during a mutation.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    const timer = setInterval(() => {
      if (pendingRef.current) return;
      getItem(id)
        .then(setItem)
        .catch(() => {
          /* Keep the last good reading; load() owns error reporting. */
        });
    }, ITEM_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [id]);

  /** Every mutation endpoint returns the updated ItemState, so adopt the response. */
  const mutate = async (action: () => Promise<ItemState>) => {
    setPending(true);
    try {
      const next = await action();
      setItem(next);
      setDraftName(next.name);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const confirmDelete = () => {
    if (item === null) return;
    Alert.alert('Remove this item?', `${item.name} will be removed from the fridge.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setPending(true);
          deleteItem(item.id)
            .then(() => router.back())
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
              setPending(false);
            });
        },
      },
    ]);
  };

  if (item === null && error !== null) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  if (item === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading item…</Text>
      </View>
    );
  }

  // Comparison only: the printed date never enters the freshness calculation.
  const printed = parsePrintedDate(item.printed_date);
  const printedDays = printed === null ? null : Math.max(0, (printed.getTime() - Date.now()) / 86400000);

  const palette = statusColors[item.status];
  const est = estimate(item);
  // Same value/label pair as the hero, flattened to one line for running text.
  const estimateLine = est.value !== null ? `${est.value} ${est.label}` : est.label;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: item.name }} />

      {error !== null && <Text style={styles.errorText}>{error}</Text>}

      {/* Hero: the item's status, number and confidence at a glance. */}
      <View
        style={[styles.hero, { backgroundColor: palette.wash, borderColor: palette.border }, shadows.hero]}>
        <View style={styles.heroHeader}>
          <Text style={[styles.heroEyebrow, { color: palette.fg }]}>{statusLabel[item.status]}</Text>
          <Pill label={item.confidence} {...confidenceColors[item.confidence]} />
        </View>
        <View style={styles.numberRow}>
          {est.value !== null ? (
            <>
              <Text style={[styles.number, { color: palette.fg }]}>{est.value}</Text>
              <Text style={styles.numberUnit}>{est.label}</Text>
            </>
          ) : (
            <Text style={[styles.numberFallback, { color: palette.fg }]}>{est.label}</Text>
          )}
        </View>
        {!item.outside_model_range && <FreshnessBar daysLeft={item.days_left} status={item.status} />}
        <Text style={styles.statusCopy}>
          {item.t_eff_incomplete ? item.history_message : statusCopy[item.status]}
        </Text>
        <Button
          title={item.opened ? 'Opened' : 'Mark opened'}
          disabled={item.opened || pending}
          onPress={() => void mutate(() => markOpened(item.id))}
        />
      </View>

      <Card>
        <Text style={styles.eyebrow}>WHY THIS NUMBER</Text>
        {/* Current conditions, not a prediction about the food. */}
        <Text
          style={[
            styles.agingRate,
            item.aging_rate != null && item.aging_rate >= AGING_RATE_EMPHASIS && styles.agingRateHot,
          ]}>
          {agingRateText(item.aging_rate)}
        </Text>
        <Text style={styles.agingRateCaption}>Current fridge conditions, not a forecast</Text>
        <Text style={styles.statusCopy}>
          Assuming continued storage at{' '}
          {formatTemperature(item.projection_temperature_c, temperatureUnit)}
        </Text>
        {item.estimate_message && <Text style={styles.statusCopy}>{item.estimate_message}</Text>}
        {printedDays !== null && (
          <Text style={styles.comparison}>
            Printed date: {printedDays.toFixed(0)} days · Our estimate: {estimateLine}
          </Text>
        )}
      </Card>

      <Card>
        <Text style={styles.eyebrow}>HOW THIS IS CALCULATED</Text>
        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>Profile</Text>
          <Text style={styles.trackValue}>{item.profile_name}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>D0 source</Text>
          <Text style={styles.trackValue}>{item.d0_source}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>Q10 source</Text>
          <Text style={styles.trackValue}>{item.q10_source}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>Tracking started</Text>
          <Text style={styles.trackValue}>{new Date(item.created_at * 1000).toLocaleString()}</Text>
        </View>
        {item.placeholder_profile && (
          <View style={styles.badgeRow}>
            <Pill label="Demo coefficients" fg={colors.textDim} border={colors.borderStrong} />
          </View>
        )}
      </Card>

      {item.fusion_uncertainty.used_for_estimate ? <Card>
        <Text style={styles.eyebrow}>EXPERIMENTAL FUSION</Text>

        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>Track A · temperature + time</Text>
          <Text style={styles.trackValue}>{item.outside_model_range ? item.model_message : dayBudgetText(item.track_a_days_left)}</Text>
        </View>
        <View style={styles.divider} />

        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>Track B · gas anomaly</Text>
          {/* A missing baseline is "unavailable", never evidence of freshness. */}
          <Text style={styles.trackValue}>{percent(item.gas_anomaly, 'Unavailable')}</Text>
        </View>
        <View style={styles.divider} />

        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>Track C · colorimetric label</Text>
          <Text style={styles.trackValue}>{percent(item.color_score, 'Not scored')}</Text>
        </View>
        {/* Track C's control sits directly under its reading, so the cause and
            effect of scoring a label are visible in one place. */}
        <View style={styles.buttonRow}>
          {labelScores.map(([label, score]) => (
            <Button
              key={label}
              title={label}
              variant="secondary"
              disabled={pending}
              style={styles.flexButton}
              onPress={() => void mutate(() => setLabelScore(item.id, score))}
            />
          ))}
        </View>
        <Text style={styles.footnote}>
          Only Track A produces a days-left figure. B and C can shorten or zero it, never extend
          it. Scoring the label is manual — this is not food-image analysis.
        </Text>
      </Card>

      : <Card>
        <Text style={styles.eyebrow}>TEMPERATURE + TIME ESTIMATE</Text>
        <Text style={styles.footnote}>Fridge gas is experimental and does not change this item's estimate. Fusion weights and calibration uncertainty are unused.</Text>
      </Card>}

      <Card>
        <Text style={styles.eyebrow}>CORRECT THIS ITEM</Text>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          style={styles.input}
          value={draftName}
          onChangeText={setDraftName}
          placeholder="Item name"
          placeholderTextColor={colors.textDim}
        />
        <Button
          title="Save name"
          disabled={pending || draftName.trim().length === 0 || draftName === item.name}
          onPress={() => void mutate(() => renameItem(item.id, draftName.trim()))}
        />

        <Text style={styles.fieldLabel}>Food category</Text>
        <View style={styles.chipRow}>
          {profiles.map((profile) => (
            <Chip
              key={profile.id}
              label={profile.name}
              selected={profile.id === item.profile_id}
              onPress={() => void mutate(() => setCategory(item.id, profile.id))}
            />
          ))}
        </View>
      </Card>

      <Card>
        <Text style={styles.eyebrow}>LABEL DATA</Text>
        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>Brand</Text>
          <Text style={styles.trackValue}>{item.brand ?? '—'}</Text>
        </View>
        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>Printed date</Text>
          <Text style={styles.trackValue}>{item.printed_date ?? '—'}</Text>
        </View>
        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>Package size</Text>
          <Text style={styles.trackValue}>{item.package_size ?? '—'}</Text>
        </View>
        <View style={styles.trackRow}>
          <Text style={styles.trackLabel}>Lot code</Text>
          <Text style={styles.trackValue}>{item.lot_code ?? '—'}</Text>
        </View>
        <View style={styles.divider} />
        <Text style={styles.fieldLabel}>Storage advice</Text>
        <Text style={styles.advice}>{item.advice}</Text>
      </Card>

      <Button
        title="Remove from fridge"
        variant="secondary"
        disabled={pending}
        onPress={confirmDelete}
        style={styles.deleteButton}
      />
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg,
  },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  errorText: { color: colors.danger, fontSize: fontSize.sm },

  hero: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroEyebrow: { ...eyebrow },
  numberRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  number: {
    fontSize: fontSize.display,
    fontWeight: '800',
    lineHeight: fontSize.display * 1.02,
    letterSpacing: -1.5,
  },
  numberUnit: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 16,
    paddingBottom: spacing.sm,
  },
  // A status word (no figure) never goes through the 52pt display type --
  // that size is tuned for one or two digits.
  numberFallback: { fontSize: fontSize.xl, fontWeight: '800' },
  agingRate: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: spacing.sm,
  },
  // Warm fridge: larger and amber, so it reads at a glance from a distance.
  agingRateHot: { color: colors.warning, fontSize: fontSize.xl, fontWeight: '800' },
  agingRateCaption: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 16 },
  statusCopy: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 18 },
  comparison: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  badgeRow: { flexDirection: 'row' },

  eyebrow: { ...eyebrow, color: colors.textDim },
  trackRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  trackLabel: { color: colors.textMuted, fontSize: fontSize.sm, flexShrink: 1 },
  trackValue: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border },
  footnote: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 16, marginTop: spacing.xs },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flexButton: { flex: 1 },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    fontSize: fontSize.sm,
  },
  advice: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 19 },
  deleteButton: { borderColor: colors.dangerBorder },
});
