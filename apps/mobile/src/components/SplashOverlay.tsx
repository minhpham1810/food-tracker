/**
 * Hands the native splash off to the app without a hard cut.
 *
 * The native splash is configured in app.json (brand yellow, mark at 200 px).
 * This view is a pixel copy of it, so `fade: true` cross-dissolves the native
 * screen into an identical JS one; the overlay then swells the mark slightly
 * and fades out, revealing whatever the app has already rendered underneath.
 */

import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

// Module scope on purpose: this has to run before the first frame paints.
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 300 });

const HOLD_MS = 250;
const FADE_MS = 650;

export function SplashOverlay() {
  const [done, setDone] = useState(false);
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;

    // Hide only once this copy is mounted, otherwise the cross-fade lands on a
    // blank frame.
    SplashScreen.hideAsync().then(() => {
      if (cancelled) return;
      Animated.timing(t, {
        toValue: 1,
        delay: HOLD_MS,
        duration: FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => finished && setDone(true));
    });

    return () => {
      cancelled = true;
    };
  }, [t]);

  // Unmounted rather than left at opacity 0: it covers the whole screen and
  // would keep swallowing taps.
  if (done) return null;

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.fill,
        { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
      ]}>
      <Animated.Image
        source={require('../../assets/images/splash-icon.png')}
        style={[
          styles.mark,
          { transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] },
        ]}
      />
    </Animated.View>
  );
}

// Hardcoded, not themed: these two values have to match app.json's splash
// config, not the light/dark palette.
const styles = StyleSheet.create({
  fill: { alignItems: 'center', backgroundColor: '#FFD93D', justifyContent: 'center' },
  mark: { height: 200, resizeMode: 'contain', width: 200 },
});
