import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
import { Reveal } from '@/components/Reveal';
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
  bezel,
  dividerLabel,
  fontSize,
  motion,
  radius,
  sectionTitle,
  spacing,
  useStyles,
  useTheme,
  type ThemeColors,
} from '@/lib/theme';
import type { FoodProfile, ItemState } from '@/lib/types';
import {
  estimate,
  dayBudgetText,
  currentConditionsText,
  AGING_RATE_CORRECTION,
  statusLabel,
} from '@/lib/estimate';
import { formatTemperature, useSettings } from '@/lib/settings';

/** Matches the fridge screen's cadence so the estimate tracks new readings. */
const ITEM_POLL_INTERVAL_MS = 3000;

const statusCopy: Record<ItemState['status'], string> = {
  fresh: 'No spoilage signal from the sensors.',
  check_early: 'Something looks off. Check this one early.',
  past_budget_quiet: 'Past its estimate, with no spoilage signal. Inspect before tossing.',
  discard_quality_signal: 'A quality-decline signal came through. Discard this.',
};

/** The three states the two-patch colorimetric label can be scored as. */
const labelScores = [
  ['Fresh', 1.0],
  ['Ambiguous', 0.5],
  ['Spoiled', 0.1],
] as const;

function temperatureRecommendation(
  optimization: ItemState['storage_optimization'],
  temperatureUnit: Parameters<typeof formatTemperature>[1],
): string {
  const target = formatTemperature(optimization.target_temperature_c, temperatureUnit);
  const current =
    optimization.current_temperature_c == null
      ? null
      : formatTemperature(optimization.current_temperature_c, temperatureUnit);

  switch (optimization.temperature_action) {
    case 'cool_to_target':
      return `Lower the fridge to ${target} or below.`;
    case 'maintain':
      return `The fridge is at ${current}. Keep it there.`;
    case 'check_freezing':
      return `${current} is below freezing. Colder slows spoilage, but freezing can damage quality.`;
    default:
      return `No live temperature reading. Keep the fridge at ${target} or below.`;
  }
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
  const [showDetails, setShowDetails] = useState(false);
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

  // The estimate reflects the newest reading, so this screen polls like the
  // fridge. Unlike load() it leaves draftName alone, so a rename in progress is
  // not overwritten, and it stands down during a mutation.
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
      </View>
    );
  }

  const palette = statusColors[item.status];
  const est = estimate(item);
  const optimization = item.storage_optimization;
  // Honesty about the data behind the number, in one line or none at all.
  const caveat = item.t_eff_incomplete ? item.history_message : item.estimate_message;
  // Label fields and provenance: real, occasionally useful, never the headline.
  const details = [
    { label: 'Brand', value: item.brand },
    { label: 'Printed date', value: item.printed_date },
    { label: 'Package size', value: item.package_size },
    { label: 'Lot code', value: item.lot_code },
    { label: 'Added', value: new Date(item.created_at * 1000).toLocaleDateString() },
  ].filter((row) => row.value);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: item.name }} />

      {error !== null && <Text style={styles.errorText}>{error}</Text>}

      {/* Hero: one status, one number, and the action that changes them. */}
      <Reveal delay={0}>
        <View style={[styles.hero, { backgroundColor: palette.wash, borderColor: palette.border }]}>
          <View style={styles.heroPlate}>
            <View style={styles.heroHeader}>
              <Text
                style={[styles.status, { color: palette.fg, borderColor: palette.border }]}>
                {statusLabel[item.status]}
              </Text>
              {item.opened && (
                <Pill label="Opened" fg={colors.textMuted} border={colors.borderStrong} />
              )}
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
            {!item.outside_model_range && (
              <FreshnessBar daysLeft={item.days_left} status={item.status} />
            )}
            {/* The headline assumes 4C. When the fridge is warmer that assumption is
                optimistic, so the correction sits directly beneath the number it
                corrects. Hidden without a usable reading -- never guessed at. */}
            {item.aging_rate != null
              && item.aging_rate > AGING_RATE_CORRECTION
              && optimization.current_temperature_c !== null
              && optimization.projected_days_at_current_temperature !== null && (
              <Text style={styles.correction}>
                {currentConditionsText(
                  optimization.projected_days_at_current_temperature,
                  formatTemperature(optimization.current_temperature_c, temperatureUnit),
                )}
              </Text>
            )}
            <Text style={styles.copy}>{statusCopy[item.status]}</Text>
            {caveat !== null && <Text style={styles.caveat}>{caveat}</Text>}
            {!item.opened && (
              <Button
                title="Mark opened"
                variant="secondary"
                disabled={pending}
                onPress={() => void mutate(() => markOpened(item.id))}
              />
            )}
          </View>
        </View>
      </Reveal>

      <Reveal delay={1 * motion.stagger}>
        <Card>
          <Text style={styles.heading}>Keep it longer</Text>
          <Text style={styles.copy}>{temperatureRecommendation(optimization, temperatureUnit)}</Text>
          {optimization.temperature_action === 'cool_to_target'
            && optimization.projected_days_at_current_temperature !== null
            && optimization.projected_days_at_target_temperature !== null
            && optimization.current_temperature_c !== null && (
            <View style={styles.projection}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>
                  At {formatTemperature(optimization.current_temperature_c, temperatureUnit)}
                </Text>
                <Text style={styles.rowValue}>
                  {dayBudgetText(optimization.projected_days_at_current_temperature)}
                </Text>
              </View>
              <View style={[styles.row, styles.rowDivider]}>
                <Text style={styles.rowLabel}>
                  At {formatTemperature(optimization.target_temperature_c, temperatureUnit)}
                </Text>
                <Text style={styles.rowValue}>
                  {dayBudgetText(optimization.projected_days_at_target_temperature)}
                </Text>
              </View>
            </View>
          )}
          <Text style={styles.copy}>{item.advice}</Text>
        </Card>
      </Reveal>

      <Reveal delay={2 * motion.stagger}>
        <Card>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Item name"
            placeholderTextColor={colors.textDim}
          />
          {draftName.trim().length > 0 && draftName.trim() !== item.name && (
            <Button
              title="Save name"
              disabled={pending}
              onPress={() => void mutate(() => renameItem(item.id, draftName.trim()))}
            />
          )}

          <Text style={styles.fieldLabel}>Category</Text>
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
      </Reveal>

      <Reveal delay={3 * motion.stagger}>
        <View style={styles.details}>
          <Pressable accessibilityRole="button" onPress={() => setShowDetails((shown) => !shown)}>
            <Text style={styles.disclosure}>{showDetails ? 'Hide details' : 'Details'}</Text>
          </Pressable>
          {showDetails && (
            <Card>
              {details.map((row, index) => (
                <View key={row.label} style={[styles.row, index > 0 && styles.rowDivider]}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowValue}>{row.value}</Text>
                </View>
              ))}
              <View style={[styles.row, styles.rowDivider]}>
                <Text style={styles.rowLabel}>Confidence</Text>
                <Pill label={item.confidence} {...confidenceColors[item.confidence]} />
              </View>
              {item.placeholder_profile && (
                <Text style={styles.footnote}>
                  This category uses demo coefficients, not validated shelf-life data.
                </Text>
              )}

              {/* Gas and the colorimetric label only appear when they can act on
                  the estimate; the control sits under its own reading. */}
              {item.fusion_uncertainty.used_for_estimate && (
                <>
                  <View style={[styles.row, styles.rowDivider]}>
                    <Text style={styles.rowLabel}>Fridge gas</Text>
                    {/* A missing baseline is "unavailable", never evidence of freshness. */}
                    <Text style={styles.rowValue}>
                      {item.gas_anomaly == null
                        ? 'Unavailable'
                        : `${Math.round(item.gas_anomaly * 100)}%`}
                    </Text>
                  </View>
                  <Text style={styles.fieldLabel}>Colour label</Text>
                  <View style={styles.chipRow}>
                    {labelScores.map(([label, score]) => (
                      <Chip
                        key={label}
                        label={label}
                        selected={item.color_score === score}
                        onPress={() => void mutate(() => setLabelScore(item.id, score))}
                      />
                    ))}
                  </View>
                  <Text style={styles.footnote}>
                    Gas and label readings can shorten the estimate, never extend it.
                  </Text>
                </>
              )}
            </Card>
          )}
        </View>
      </Reveal>

      <Reveal delay={4 * motion.stagger}>
        <Button
          title="Remove from fridge"
          variant="danger"
          disabled={pending}
          onPress={confirmDelete}
        />
      </Reveal>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl * 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  errorText: { color: colors.danger, fontSize: fontSize.sm },

  // The tray: the status wash, showing only as a rim around the plate.
  hero: {
    borderWidth: 1,
    borderRadius: radius.xxl,
    padding: bezel,
  },
  // The plate carries the content, so the number reads off the card surface
  // rather than off a tinted one.
  heroPlate: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl - bezel,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // Eyebrow: a pill above the headline, not a word floating next to it.
  status: {
    ...dividerLabel,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  numberRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  number: {
    fontSize: fontSize.display,
    fontWeight: '600',
    lineHeight: fontSize.display * 1.02,
    letterSpacing: -2.2,
  },
  numberUnit: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 16,
    paddingBottom: spacing.sm,
  },
  // A status word (no figure) never goes through the 52pt display type --
  // that size is tuned for one or two digits.
  numberFallback: { fontSize: fontSize.xl, fontWeight: '600', letterSpacing: -0.5 },
  // A warning, not a competing headline: well below the number it corrects.
  correction: { color: colors.warning, fontSize: fontSize.md, fontWeight: '600', lineHeight: 20 },
  copy: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 19 },
  caveat: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 16 },

  heading: { ...sectionTitle, color: colors.text },
  // The page background, not the card's: an inset tone in both schemes.
  projection: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { color: colors.textMuted, fontSize: fontSize.sm, flexShrink: 1 },
  rowValue: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  details: { gap: spacing.sm },
  disclosure: { color: colors.accentText, fontSize: fontSize.sm, fontWeight: '600' },
  footnote: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
});
