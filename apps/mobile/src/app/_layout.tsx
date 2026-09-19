import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/lib/theme';

/**
 * Root stack. The tab bar lives in (tabs); anything declared here pushes *over*
 * it with a back button -- which is what item detail wants.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* Screens paint a near-black background, so the status bar needs light glyphs. */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { color: colors.text },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="items/[id]" options={{ title: 'Item detail' }} />
        <Stack.Screen name="add-item" options={{ title: 'Add manually' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
