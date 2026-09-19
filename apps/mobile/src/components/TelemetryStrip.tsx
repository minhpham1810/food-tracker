import { StyleSheet, Text, View } from 'react-native';

import { Card } from './Card';
import { colors, eyebrow, fontSize, spacing } from '@/lib/theme';
import type { TelemetryState } from '@/lib/types';

const UNAVAILABLE = 'Unavailable';

/** Above this the fridge is warm enough that Track A burns noticeably faster. */
const WARM_FRIDGE_C = 8.0;

interface Cell {
  label: string;
  value: string;
  /** Amber when the reading is itself the problem (warm, door ajar). */
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
      label: 'Gas anomaly',
      value: t.gas_anomaly == null ? UNAVAILABLE : `${Math.round(t.gas_anomaly * 100)}%`,
      alarm: t.gas_anomaly != null && t.gas_anomaly > 0.8,
    },
    {
      label: 'Door',
      value: t.door_open == null ? UNAVAILABLE : t.door_open ? 'Open' : 'Closed',
      alarm: t.door_open === true,
    },
    {
      // service.snapshot() computes this with milk's Q10 regardless of item.
      label: 'Demo milk burn rate',
      value: t.burn_multiplier == null ? UNAVAILABLE : `${t.burn_multiplier.toFixed(2)}×`,
      alarm: t.burn_multiplier != null && t.burn_multiplier > 1.5,
    },
  ];
}

interface Props {
  telemetry: TelemetryState;
  paused: boolean;
  scenario: string | null;
}

export function TelemetryStrip({ telemetry, paused, scenario }: Props) {
  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>LIVE FRIDGE</Text>
        <Text style={styles.meta}>
          {paused ? 'Telemetry paused' : scenario ? `Scenario: ${scenario}` : 'Streaming'}
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

const styles = StyleSheet.create({
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
