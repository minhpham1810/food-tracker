import { Link, Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { AssistantIcon, FridgeIcon, ScanIcon } from '@/components/TabBarIcon';
import { colors, fontSize, spacing } from '@/lib/theme';

/** Header action on the Fridge tab -- opens the manual add-item screen. */
function AddItemButton() {
  return (
    <Link href="/add-item" asChild>
      <Pressable accessibilityRole="button" style={styles.headerButton}>
        <Text style={styles.headerButtonText}>+ Add</Text>
      </Pressable>
    </Link>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        // Without this the navigator paints its own light background behind each
        // screen, which flashes white on tab switches.
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accentText,
        tabBarInactiveTintColor: colors.textDim,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Fridge',
          headerRight: () => <AddItemButton />,
          tabBarIcon: ({ color }) => <FridgeIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{ title: 'Scan', tabBarIcon: ({ color }) => <ScanIcon color={color} /> }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: 'Assistant',
          tabBarIcon: ({ color }) => <AssistantIcon color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  headerButtonText: { color: colors.accentText, fontSize: fontSize.md, fontWeight: '700' },
});
