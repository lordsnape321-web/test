import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";

/**
 * Root layout: providers plus the native stack.
 *
 * Order matters here. SafeAreaProvider has to wrap anything that reads insets,
 * ThemeProvider has to wrap anything that reads colours, and AuthProvider has to
 * wrap every screen that gates on sign-in. Putting them in this order means the
 * screens below can assume all three exist.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <StatusBar style="auto" />
          <Shell />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.bg },
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
  );
}
