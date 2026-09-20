import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SplashOverlay } from '@/components/SplashOverlay';
import { SettingsProvider } from '@/lib/settings';
import { ThemeProvider, useTheme } from '@/lib/theme';

/**
 * Root stack. The tab bar lives in (tabs); anything declared here pushes *over*
 * it with a back button -- which is what item detail wants.
 */
export default function RootLayout() {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <SafeAreaProvider>
          <RootStack />
          <SplashOverlay />
        </SafeAreaProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}

// Split out because it reads the theme, which the provider above it supplies.
function RootStack() {
  const { colors, scheme } = useTheme();

  return (
    <>
      {/* Not style="auto": that follows the OS, which the user can override here. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTitleStyle: { color: colors.text },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="items/[id]" options={{ title: 'Item detail' }} />
        <Stack.Screen name="add-item" options={{ title: 'Add manually' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="user-manual" options={{ title: 'User manual' }} />
      </Stack>
    </>
  );
}
