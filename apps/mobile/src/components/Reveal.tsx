import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, type StyleProp, type ViewStyle } from 'react-native';

import { motion } from '@/lib/theme';

/** How far the content travels on the way in. Small: this is a settle, not a slide. */
const RISE = 14;

interface Props {
  children: ReactNode;
  /** Offset in ms -- pass `index * motion.stagger` to cascade a list. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Entry animation: content rises and fades into place instead of appearing.
 *
 * Mount-only by design. Anything that re-mounts on a data poll would flicker,
 * so this goes on stable, keyed content -- a screen's cards, a list's items --
 * never on a value that ticks.
 *
 * Only `opacity` and `transform` are animated, both on the native driver, so
 * the work never touches layout or the JS thread.
 */
export function Reveal({ children, delay = 0, style }: Props) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    // Reduce Motion is a real setting with a real reason behind it: skip
    // straight to the resting state rather than playing a shorter version.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (cancelled) return;
        if (reduced) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          toValue: 1,
          duration: motion.enter,
          delay,
          easing: motion.curve,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => progress.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [progress, delay]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [RISE, 0] }) },
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}
