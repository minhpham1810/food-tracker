import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { bezel, fontSize, motion, radius, spacing, useStyles, type ThemeColors } from '@/lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Diameter of the nested icon disc. Sized so it clears the pill's inner padding. */
const DISC = 32;

interface Props {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  /** `danger` is for actions that destroy saved data, not for cancelling a draft. */
  variant?: 'primary' | 'secondary' | 'danger';
  /**
   * Nested trailing arrow. For buttons that take you somewhere -- never for one
   * that commits a change, where an arrow promises a journey that isn't coming.
   */
  arrow?: boolean;
  style?: ViewStyle;
}

/**
 * Pill button. The primary is a solid high-contrast neutral, not the brand
 * yellow: a CTA on every screen would spend the mark until it stopped reading
 * as one. Yellow stays on the add button and the active tab.
 */
export function Button({
  title,
  onPress,
  disabled = false,
  variant = 'primary',
  arrow = false,
  style,
}: Props) {
  const styles = useStyles(makeStyles);
  const press = useRef(new Animated.Value(0)).current;

  // Interpolated, not toggled: a step change in scale reads as a glitch, a
  // 120ms ease reads as the surface taking the weight of the finger.
  const animate = (to: number) =>
    Animated.timing(press, {
      toValue: to,
      duration: motion.press,
      easing: motion.curve,
      useNativeDriver: true,
    }).start();

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => animate(1)}
      onPressOut={() => animate(0)}
      style={[
        styles.base,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        arrow && styles.withArrow,
        disabled && styles.disabled,
        style,
        { transform: [{ scale }] },
      ]}>
      <Text
        style={[
          styles.label,
          variant === 'primary' && styles.primaryLabel,
          variant === 'danger' && styles.dangerLabel,
        ]}>
        {title}
      </Text>
      {arrow && (
        <View style={[styles.disc, variant === 'primary' && styles.discOnPrimary]}>
          <Arrow color={variant === 'primary' ? styles.primaryLabel.color : styles.label.color} />
        </View>
      )}
    </AnimatedPressable>
  );
}

/** Drawn, not imported -- the project has no icon package, and this is two bars. */
function Arrow({ color }: { color: string }) {
  return (
    <View style={{ width: 11, height: 11 }}>
      <View
        style={{
          position: 'absolute',
          top: 5,
          width: 11,
          height: 1.5,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 0,
          top: 1.5,
          width: 8,
          height: 8,
          borderTopWidth: 1.5,
          borderRightWidth: 1.5,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  base: {
    backgroundColor: colors.primaryBg,
    borderRadius: radius.pill,
    // 48pt: comfortably over the 44pt touch floor without looking inflated.
    minHeight: 48,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The disc sits flush in the pill's right inset, so that side gives up its
  // text padding and the row spreads instead of centring.
  withArrow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingRight: bezel,
    paddingVertical: bezel + 2,
  },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.md,
  },
  // On the solid pill the disc is a hole punched in the fill, not a raised chip.
  discOnPrimary: { backgroundColor: 'rgba(0, 0, 0, 0.12)' },
  // Outlined, not filled: one solid button per view is what makes it primary.
  secondary: {
    backgroundColor: colors.buttonSecondaryBg,
    borderColor: colors.buttonSecondaryBorder,
    borderWidth: 1,
  },
  // Red edge and red label on no fill: loud enough to hesitate at, quiet enough
  // that it never competes with the primary action beside it.
  danger: {
    backgroundColor: colors.buttonSecondaryBg,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
  },
  disabled: { opacity: 0.5 },
  label: { color: colors.text, fontWeight: '600', fontSize: fontSize.md, letterSpacing: -0.1 },
  primaryLabel: { color: colors.primaryFg },
  dangerLabel: { color: colors.danger },
});
