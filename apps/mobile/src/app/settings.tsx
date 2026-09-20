import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View, type ColorValue } from 'react-native';

import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { useSettings, type TemperatureUnit } from '@/lib/settings';
import {
  fontSize,
  spacing,
  THEME_PREFERENCES,
  useStyles,
  useTheme,
  type ThemeColors,
  type ThemePreference,
} from '@/lib/theme';

/** Small right-pointing chevron drawn from views, matching SettingsButton/TabBarIcon. */
function ChevronRight({ color, size = 16 }: { color: ColorValue; size?: number }) {
  const thickness = 1.8;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.5,
          height: size * 0.5,
          borderTopWidth: thickness,
          borderRightWidth: thickness,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

const UNIT_LABELS: Record<TemperatureUnit, string> = {
  celsius: 'Celsius (°C)',
  fahrenheit: 'Fahrenheit (°F)',
};

const APPEARANCE_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export default function SettingsScreen() {
  const styles = useStyles(makeStyles);
  const { colors, preference, setPreference } = useTheme();
  const { temperatureUnit, setTemperatureUnit } = useSettings();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.settingRow}>
          <Text style={styles.rowLabel}>Temperature unit</Text>
          <View style={styles.chipRow}>
            {(Object.keys(UNIT_LABELS) as TemperatureUnit[]).map((unit) => (
              <Chip
                key={unit}
                label={UNIT_LABELS[unit]}
                selected={temperatureUnit === unit}
                onPress={() => setTemperatureUnit(unit)}
              />
            ))}
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.settingRow}>
          <Text style={styles.rowLabel}>Appearance</Text>
          <View style={styles.chipRow}>
            {THEME_PREFERENCES.map((option) => (
              <Chip
                key={option}
                label={APPEARANCE_LABELS[option]}
                selected={preference === option}
                onPress={() => setPreference(option)}
              />
            ))}
          </View>
        </View>
      </Card>

      <Card>
        <Link href="/user-manual" asChild>
          <Pressable accessibilityRole="button" style={styles.manualLink}>
            <View style={styles.manualText}>
              <Text style={styles.manualTitle}>User manual</Text>
              <Text style={styles.copy}>How to scan, track and correct what is in the fridge.</Text>
            </View>
            <ChevronRight color={colors.textDim} />
          </Pressable>
        </Link>
      </Card>

      <Text style={styles.disclaimer}>
        A prototype for storage guidance, not a food-safety device. When in doubt, inspect the
        food and follow official safety advice.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
    settingRow: { gap: spacing.sm, paddingVertical: spacing.sm },
    divider: { height: 1, backgroundColor: colors.border },
    rowLabel: { color: colors.text, fontSize: fontSize.sm },
    copy: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 19 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    manualLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    manualText: { flex: 1, gap: spacing.xs },
    manualTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
    disclaimer: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 17 },
  });
