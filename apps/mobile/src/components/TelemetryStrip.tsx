import { StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';

import { Card } from './Card';
import { eyebrow, fontSize, spacing, useStyles, type ThemeColors } from '@/lib/theme';
import type { TelemetryState } from '@/lib/types';

const UNAVAILABLE = 'Unavailable';

/** Above this the fridge is warm enough that Track A burns noticeably faster. */
const WARM_FRIDGE_C = 8.0;

interface Cell {
  label: string;
  value: string;
  /** Amber when the reading is itself the problem (warm fridge, gas anomaly). */
  alarm?: boolean;
}

function buildCells(t: TelemetryState): Cell[] {
  return [
    {
      label: 'Temperature',
      value: t.temperature == null ? UNAVAILABLE : `${t.temperature.toFixed(1)} °C`,
      alarm: t.temperature != null && t.temperature > WARM_FRIDGE_C,
    },
    {
      label: 'Humidity',
      value: t.humidity == null ? UNAVAILABLE : `${t.humidity.toFixed(0)}%`,
    },
    {
      // A missing gas baseline is "unavailable", never a clean reading.
      label: 'Fridge gas · experimental',
      value: t.gas_anomaly == null ? UNAVAILABLE : `${Math.round(t.gas_anomaly * 100)}%`,
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

interface Props {
  telemetry: TelemetryState;
  paused: boolean;
  scenario: string | null;
}

export function TelemetryStrip({ telemetry, paused, scenario }: Props) {
  const styles = useStyles(makeStyles);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const age = telemetry.timestamp == null ? null : Math.max(0, now / 1000 - telemetry.timestamp);
  const disconnected = age === null || age > 180;
  const status = disconnected
    ? age === null ? 'Disconnected · no readings' : `Disconnected · Last reading ${Math.floor(age / 60)}m ago`
    : paused ? 'Telemetry paused' : scenario ? `Scenario: ${scenario}` : 'Streaming';
  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>{disconnected ? 'LAST FRIDGE READINGS' : 'LIVE FRIDGE'}</Text>
        <Text style={styles.meta}>
          {status}
        </Text>
      </View>
      <View style={styles.grid}>
        {buildCells(telemetry).map((cell) => (
          <View key={cell.label} style={styles.cell}>
            <Text style={styles.cellLabel}>{cell.label}</Text>
            <Text style={[styles.cellValue, cell.alarm && styles.cellValueAlarm]}>
              {cell.value}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  card: { marginBottom: spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { ...eyebrow, color: colors.textDim },
  meta: { color: colors.textDim, fontSize: fontSize.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.xs },
  cell: { minWidth: 78, gap: 3 },
  cellLabel: { color: colors.textDim, fontSize: fontSize.xs, letterSpacing: 0.3 },
  cellValue: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', letterSpacing: -0.2 },
  cellValueAlarm: { color: colors.warning },
});
