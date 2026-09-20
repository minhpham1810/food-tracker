import { Tabs } from 'expo-router';

import { AddTabButton } from '@/components/AddTabButton';
import { NotificationsBell } from '@/components/NotificationsBell';
import { SettingsButton } from '@/components/SettingsButton';
import { AssistantIcon, FridgeIcon } from '@/components/TabBarIcon';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: 'center',
        headerLeft: () => <SettingsButton />,
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        // Without this the navigator paints its own light background behind each
        // screen, which flashes white on tab switches.
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accentText,
        tabBarInactiveTintColor: colors.textDim,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Fridge',
          // The Fridge screen replaces this with a live alert count once state loads.
          headerRight: () => <NotificationsBell count={0} />,
          tabBarIcon: ({ color }) => <FridgeIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Add to fridge',
          tabBarButton: ({ onPress, onLongPress, accessibilityState }) => (
            <AddTabButton
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityState={accessibilityState}
            />
          ),
        }}
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
