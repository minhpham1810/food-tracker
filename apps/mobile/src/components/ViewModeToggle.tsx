import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import { radius, spacing, useStyles, useTheme, type ThemeColors } from '@/lib/theme';

export type ViewMode = 'list' | 'grid';

interface Props {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

/**
 * Google Drive-style layout switch: one button that shows the layout you would
 * switch *to*, not the one you are in.
 */
export function ViewModeToggle({ mode, onChange }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const next: ViewMode = mode === 'list' ? 'grid' : 'list';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={next === 'grid' ? 'Switch to grid view' : 'Switch to list view'}
      hitSlop={spacing.sm}
      onPress={() => onChange(next)}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      {next === 'grid' ? (
        <GridViewIcon color={colors.textMuted} />
      ) : (
        <ListViewIcon color={colors.textMuted} />
      )}
    </Pressable>
  );
}

// Drawn from plain views for the same reason as TabBarIcon: no icon package.

const STROKE = 1.8;

function GridViewIcon({ color, size = 18 }: { color: ColorValue; size?: number }) {
  const styles = useStyles(makeStyles);
  const cell = (size - 3) / 2;
  const square = { width: cell, height: cell, borderWidth: STROKE, borderColor: color, borderRadius: 2 };
  return (
    <View style={[styles.grid, { width: size, height: size }]}>
      <View style={square} />
      <View style={square} />
      <View style={square} />
      <View style={square} />
    </View>
  );
}

function ListViewIcon({ color, size = 18 }: { color: ColorValue; size?: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.lines, { width: size, height: size }]}>
      {[0, 1, 2].map((line) => (
        <View
          key={line}
          style={{ width: size, height: STROKE, borderRadius: STROKE, backgroundColor: color }}
        />
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  button: {
    padding: spacing.sm,
    borderRadius: radius.pill,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignContent: 'space-between' },
  lines: { justifyContent: 'space-evenly' },
});
