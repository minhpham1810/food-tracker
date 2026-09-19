import { StyleSheet, View } from 'react-native';

import type { ItemState } from '@/lib/types';
import { colors, radius, statusColors } from '@/lib/theme';

/**
 * Days at which the bar reads as completely full. Anything with more runway than
 * this is simply "not urgent" -- the bar exists to rank what to eat first, so
 * there is nothing useful to distinguish between 9 days and 30.
 */
const URGENCY_HORIZON_DAYS = 7;

interface Props {
  daysLeft: number;
  status: ItemState['status'];
}

/**
 * Deliberately driven by `days_left`, NOT `freshness_fraction`.
 *
 * freshness_fraction is `1 - t_eff/D0` (engine/burn.py), so it sits at ~1.0 for
 * every freshly-added item regardless of shelf life -- chicken with 1.7 days left
 * and milk with 8.5 both rendered as full bars, which made the Eat First ordering
 * invisible. days_left already carries the temperature history and the B/C fusion.
 */
export function FreshnessBar({ daysLeft, status }: Props) {
  const fraction = Math.max(0, Math.min(1, daysLeft / URGENCY_HORIZON_DAYS));
  const palette = statusColors[status];

  return (
    <View style={styles.track}>
      <View
        style={[
          styles.fill,
          { width: `${fraction * 100}%`, backgroundColor: palette.bar },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginVertical: 4,
  },
  fill: { height: '100%', borderRadius: radius.pill },
});
