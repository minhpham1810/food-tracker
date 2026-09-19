import { StyleSheet, View, type ColorValue } from 'react-native';

/**
 * Tab icons drawn from plain views rather than an icon font.
 *
 * The project has no icon package installed, and these three shapes are simple
 * enough that adding one (plus its font loading) would cost more than it earns.
 */

interface IconProps {
  /** React Navigation hands tabBarIcon a ColorValue, which may be an opaque
   *  platform color rather than a plain hex string. */
  color: ColorValue;
  size?: number;
}

const STROKE = 1.8;

export function FridgeIcon({ color, size = 22 }: IconProps) {
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <View
        style={{
          width: size * 0.66,
          height: size * 0.88,
          borderWidth: STROKE,
          borderColor: color,
          borderRadius: 3,
        }}>
        {/* Freezer/fridge divider */}
        <View style={{ height: '36%', borderBottomWidth: STROKE, borderBottomColor: color }} />
        {/* Door handles, one either side of the divider */}
        <View
          style={{
            position: 'absolute',
            left: 2.5,
            top: '16%',
            width: STROKE,
            height: size * 0.12,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 2.5,
            top: '48%',
            width: STROKE,
            height: size * 0.16,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

export function ScanIcon({ color, size = 22 }: IconProps) {
  const arm = size * 0.3;
  const corner = { position: 'absolute' as const, width: arm, height: arm, borderColor: color };
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <View
        style={[
          corner,
          { top: 1, left: 1, borderTopWidth: STROKE, borderLeftWidth: STROKE, borderTopLeftRadius: 3 },
        ]}
      />
      <View
        style={[
          corner,
          { top: 1, right: 1, borderTopWidth: STROKE, borderRightWidth: STROKE, borderTopRightRadius: 3 },
        ]}
      />
      <View
        style={[
          corner,
          {
            bottom: 1,
            left: 1,
            borderBottomWidth: STROKE,
            borderLeftWidth: STROKE,
            borderBottomLeftRadius: 3,
          },
        ]}
      />
      <View
        style={[
          corner,
          {
            bottom: 1,
            right: 1,
            borderBottomWidth: STROKE,
            borderRightWidth: STROKE,
            borderBottomRightRadius: 3,
          },
        ]}
      />
      {/* Scan line */}
      <View style={{ width: size * 0.6, height: STROKE, backgroundColor: color }} />
    </View>
  );
}

export function AssistantIcon({ color, size = 22 }: IconProps) {
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <View
        style={{
          width: size * 0.86,
          height: size * 0.66,
          borderWidth: STROKE,
          borderColor: color,
          borderRadius: 4,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: size * 0.1,
        }}>
        {[0, 1, 2].map((dot) => (
          <View
            key={dot}
            style={{
              width: STROKE,
              height: STROKE,
              borderRadius: STROKE,
              backgroundColor: color,
            }}
          />
        ))}
      </View>
      {/* Speech tail */}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.1,
          left: size * 0.24,
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.13,
          borderTopWidth: size * 0.14,
          borderLeftColor: 'transparent',
          borderTopColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center' },
});
