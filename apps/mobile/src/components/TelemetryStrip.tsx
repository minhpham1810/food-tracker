import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';

import { Card } from './Card';
import { formatTemperature, useSettings, type TemperatureUnit } from '@/lib/settings';
import {
  dividerLabel,
  fontSize,
  sectionTitle,
  spacing,
  useStyles,
  type ThemeColors,
} from '@/lib/theme';
import { AGING_RATE_EMPHASIS } from '@/lib/estimate';
import type { TelemetryState } from '@/lib/types';

const UNAVAILABLE = 'Unavailable';

/** Above this the fridge is warm enough that Track A burns noticeably faster. */
const WARM_FRIDGE_C = 8.0;

/** The temperature the whole model is stated against. */
const REFERENCE_C = 4;

interface Cell {
  label: string;
  value: string;
  /** Amber when the reading is itself the problem (warm fridge, gas anomaly). */
  alarm?: boolean;
}

function buildCells(
  t: TelemetryState,
  temperatureUnit: TemperatureUnit,
  disconnected: boolean,
): Cell[] {
  // Without a live reading there is no current rate to state.
  const rate = disconnected ? null : t.aging_rate;
  return [
    {
      label: 'Temperature',
      value:
        t.temperature == null ? UNAVAILABLE : formatTemperature(t.temperature, temperatureUnit),
      alarm: t.temperature != null && t.temperature > WARM_FRIDGE_C,
    },
    {
      label: 'Aging rate now',
      value: rate == null ? UNAVAILABLE : `${rate.toFixed(1)}x`,
      alarm: rate != null && rate >= AGING_RATE_EMPHASIS,
    },
    {
      label: 'Humidity',
      value: t.humidity == null ? UNAVAILABLE : `${t.humidity.toFixed(0)}%`,
    },
    {
      // A missing gas baseline is never a clean reading. Distinguish "the
      // sensor is not giving us gas" from "it is, and the baseline is still
      // filling up" -- the second one resolves itself, the first needs looking at.
      label: 'Fridge gas · experimental',
      value:
        t.gas_anomaly != null
          ? `${Math.round(t.gas_anomaly * 100)}%`
          : t.gas_resistance != null
            ? 'Baseline building'
            : UNAVAILABLE,
      alarm: t.gas_anomaly != null && t.gas_anomaly > 0.8,
    },
    {
      label: 'Gas status',
      value:
        t.iaq_accuracy == null ? UNAVAILABLE : t.iaq_accuracy >= 3 ? 'Calibrated' : 'Calibrating',
      alarm: t.iaq_accuracy != null && t.iaq_accuracy < 3,
    },
  ];
}

interface Summary {
  value: string;
  note: string;
  alarm: boolean;
}

/**
 * The one line a cook can act on: how cold the fridge is, and whether that is
 * costing them shelf life. Humidity, gas and calibration are diagnostics and
 * stay behind "Details" -- they are real, but nobody reorganises their dinner
 * around an uncalibrated gas baseline.
 */
function summarise(
  t: TelemetryState,
  temperatureUnit: TemperatureUnit,
  minutesStale: number | null,
  disconnected: boolean,
): Summary {
  const value =
    t.temperature == null ? UNAVAILABLE : formatTemperature(t.temperature, temperatureUnit);
  const reference = formatTemperature(REFERENCE_C, temperatureUnit, 0);

  if (disconnected) {
    return {
      value,
      note: minutesStale === null ? 'No readings yet' : `No readings for ${minutesStale}m`,
      alarm: true,
    };
  }
  const warm =
    (t.aging_rate != null && t.aging_rate >= AGING_RATE_EMPHASIS) ||
    (t.temperature != null && t.temperature > WARM_FRIDGE_C);
  if (!warm) return { value, note: `Normal · food ages about as fast as at ${reference}`, alarm: false };
  return {
    value,
    note:
      t.aging_rate == null
        ? `Warm · food ages faster than at ${reference}`
        : `Warm · food ages ${t.aging_rate.toFixed(1)}x as fast as at ${reference}`,
    alarm: true,
  };
}

interface Props {
  telemetry: TelemetryState;
  paused: boolean;
  scenario: string | null;
}

export function TelemetryStrip({ telemetry, paused, scenario }: Props) {
  const styles = useStyles(makeStyles);
  const { temperatureUnit } = useSettings();
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const age = telemetry.timestamp == null ? null : Math.max(0, now / 1000 - telemetry.timestamp);
  const disconnected = age === null || age > 180;
  const minutesStale = age === null ? null : Math.floor(age / 60);
  const summary = summarise(telemetry, temperatureUnit, minutesStale, disconnected);

  // Only worth a line of its own when the stream is not simply running: the
  // demo scenarios and the pause switch have to stay visible.
  const aside = paused ? 'Telemetry paused' : scenario ? `Scenario: ${scenario}` : null;

  return (
    <Card style={[styles.card, summary.alarm && styles.cardAlarm]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Fridge ${summary.value}. ${summary.note}.`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        <View style={styles.headerRow}>
          <Text style={styles.heading}>{disconnected ? 'Last fridge readings' : 'Fridge'}</Text>
          <Text style={styles.toggle}>{expanded ? 'Hide' : 'Details'}</Text>
        </View>
        <Text style={styles.summaryLine}>
          <Text style={[styles.value, summary.alarm && styles.alarm]}>{summary.value}</Text>
          <Text style={[styles.note, summary.alarm && styles.alarm]}>{`  ${summary.note}`}</Text>
        </Text>
      </Pressable>

      {aside !== null && <Text style={styles.meta}>{aside}</Text>}

      {expanded && (
        <View style={styles.grid}>
          {buildCells(telemetry, temperatureUnit, disconnected).map((cell) => (
            <View key={cell.label} style={styles.cell}>
              <Text style={styles.cellLabel}>{cell.label}</Text>
              <Text style={[styles.cellValue, cell.alarm && styles.cellValueAlarm]}>
                {cell.value}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  card: { marginBottom: spacing.md },
  cardAlarm: { backgroundColor: colors.warningBg, borderColor: colors.warningBorder },
  header: { gap: spacing.xs },
  pressed: { opacity: 0.7 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { ...sectionTitle, color: colors.text },
  toggle: { color: colors.accentText, fontSize: fontSize.xs, fontWeight: '600' },
  summaryLine: { lineHeight: 22 },
  value: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  note: { color: colors.textMuted, fontSize: fontSize.sm },
  alarm: { color: colors.warning },
  meta: { color: colors.textDim, fontSize: fontSize.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.xs },
  cell: { minWidth: 78, gap: 3 },
  cellLabel: { ...dividerLabel, color: colors.textDim },
  cellValue: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  cellValueAlarm: { color: colors.warning },
});
