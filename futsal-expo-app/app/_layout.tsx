import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { TurfBackdrop } from "@/components/TurfBackdrop";
import { APP_FONT_FAMILY } from "@/theme";

/**
 * Root layout: fonts + providers + the native stack.
 *
 * Plus Jakarta Sans is the web app's `--font-sans`. React Native cannot read
 * CSS, so the faces are loaded here and installed as the default family on
 * every `Text` / `TextInput` — otherwise the whole port falls back to the
 * system font and looks like a different product.
 *
 * Order matters here. SafeAreaProvider has to wrap anything that reads insets,
 * ThemeProvider has to wrap anything that reads colours, and AuthProvider has to
 * wrap every screen that gates on sign-in. Putting them in this order means the
 * screens below can assume all three exist.
 */
function useAppFontDefaults(loaded: boolean) {
  React.useEffect(() => {
    if (!loaded) return;
    const family = APP_FONT_FAMILY;
    const text = Text as unknown as { defaultProps?: { style?: unknown } };
    const input = TextInput as unknown as { defaultProps?: { style?: unknown } };
    text.defaultProps = text.defaultProps || {};
    input.defaultProps = input.defaultProps || {};
    text.defaultProps.style = [{ fontFamily: family }];
    input.defaultProps.style = [{ fontFamily: family }];
  }, [loaded]);
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  useAppFontDefaults(fontsLoaded);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF9F0" }}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <ThemedStatusBar />
          <Shell />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? "light" : "dark"} />;
}

function Shell() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: isTransparent(colors.bg) ? undefined : colors.bg }}>
      {/* `.turf-pattern` — warm peach / night blobs behind every route. */}
      <TurfBackdrop />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text, fontFamily: APP_FONT_FAMILY },
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: "Sign in", headerShown: false }} />
        <Stack.Screen name="signup" options={{ title: "Create account", headerShown: false }} />
        <Stack.Screen name="venue/[id]" options={{ title: "Venue" }} />
        <Stack.Screen name="booking/[id]" options={{ title: "Booking" }} />
        <Stack.Screen name="leagues/index" options={{ headerShown: false }} />
        <Stack.Screen name="leagues/[id]" options={{ title: "League" }} />
        <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
        <Stack.Screen name="profile" options={{ title: "My profile" }} />
        <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
        <Stack.Screen name="teams/index" options={{ title: "Teams" }} />
        <Stack.Screen name="teams/[id]" options={{ title: "Squad" }} />
        <Stack.Screen name="players/[id]" options={{ title: "Player" }} />
        <Stack.Screen name="admin" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

/** Palette bg may be transparent (player + turf) or a solid studio colour. */
function isTransparent(bg: string) {
  return bg === "transparent";
}
