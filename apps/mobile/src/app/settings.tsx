import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { useSettings, type TemperatureUnit } from '@/lib/settings';
import {
  eyebrow,
  fontSize,
  spacing,
  THEME_PREFERENCES,
  useStyles,
  useTheme,
  type ThemeColors,
  type ThemePreference,
} from '@/lib/theme';

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
  const { temperatureUnit, setTemperatureUnit } = useSettings();
  const { preference, setPreference } = useTheme();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.eyebrow}>TEMPERATURE UNIT</Text>
        <Text style={styles.copy}>
          This changes displayed temperatures only. Freshness calculations continue using the
          original Celsius sensor data.
        </Text>
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
      </Card>

      <Card>
        <Text style={styles.eyebrow}>APPEARANCE</Text>
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
      </Card>

      <Card>
        <Text style={styles.eyebrow}>HELP</Text>
        <Link href="/user-manual" asChild>
          <Pressable accessibilityRole="button" style={styles.manualLink}>
            <View style={styles.manualText}>
              <Text style={styles.manualTitle}>User manual</Text>
              <Text style={styles.copy}>Learn how to scan, track, correct and ask about food.</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Link>
      </Card>

      <Text style={styles.disclaimer}>
        Freshness Tracker is a prototype for storage guidance, not a food-safety device. When in
        doubt, inspect the food and follow official safety advice.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
    eyebrow: { ...eyebrow, color: colors.textDim },
    copy: { color: colors.textMuted, fontSize: fontSize.sm, lineHeight: 19 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    manualLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    manualText: { flex: 1, gap: spacing.xs },
    manualTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
    chevron: { color: colors.textDim, fontSize: 30, lineHeight: 32 },
    disclaimer: { color: colors.textDim, fontSize: fontSize.xs, lineHeight: 17 },
  });
