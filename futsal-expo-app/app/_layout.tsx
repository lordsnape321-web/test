import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { MobileNav } from "@/components/MobileNav";
import { Navbar } from "@/components/Navbar";
import { TurfBackdrop } from "@/components/TurfBackdrop";
import { useBreakpoints } from "@/lib/responsive";
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
  const { colors, isDark } = useTheme();
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const bp = useBreakpoints();
  const isOwnerStudio = pathname === "/admin" || pathname.startsWith("/admin/");
  const ownerOutsideStudio = ready && user?.role === "owner" && !isOwnerStudio;
  const showPlayerChrome = !isOwnerStudio && !ownerOutsideStudio;
  // Auth forms need the full viewport for their scrollable card. The player
  // rail is useful on app pages, but on login/signup it becomes an opaque
  // rectangle over the last form controls on short screens.
  const isChromeFreeScreen =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/venue/") ||
    pathname.startsWith("/venues/") ||
    pathname.startsWith("/booking/") ||
    pathname.startsWith("/payment/");
  const showPlayerRail = showPlayerChrome && !isChromeFreeScreen && bp.width < 1024;
  // Keep the native/web root surface deterministic even while Owner Studio is
  // switching its palette after a route change. A transparent scene must never
  // fall through to the browser's default white canvas.
  const shellBackground = isOwnerStudio
    ? isDark
      ? "#020617"
      : "#F1F5F9"
    : isDark
      ? "#020617"
      : "#FFFFFF";

  React.useEffect(() => {
    if (ownerOutsideStudio) router.replace("/admin");
  }, [ownerOutsideStudio, router]);

  // Do not mount a player route while the persisted session is being restored.
  // An owner opening a saved player URL must never see the player shell, even
  // for the short hydration window before `user.role` is available.
  if (!ready || ownerOutsideStudio) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? "#020617" : "#F1F5F9" }}>
        <ActivityIndicator size="large" color={isDark ? "#FBBF24" : "#F97316"} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: shellBackground }}>
      {/* `.turf-pattern` — warm peach / night blobs behind every player route. */}
      <TurfBackdrop style={{ backgroundColor: shellBackground }} />
      {showPlayerChrome ? <Navbar /> : null}
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            headerTitleStyle: { color: colors.text, fontFamily: APP_FONT_FAMILY },
            contentStyle: {
              backgroundColor: isOwnerStudio ? shellBackground : "transparent",
            },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="signup" options={{ headerShown: false }} />
          <Stack.Screen name="venue/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="venues/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="booking/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="leagues/index" options={{ headerShown: false }} />
          <Stack.Screen name="leagues/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="notifications" options={{ headerShown: false }} />
          <Stack.Screen name="profile" options={{ headerShown: false }} />
          <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
          <Stack.Screen name="teams/index" options={{ headerShown: false }} />
          <Stack.Screen name="teams/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="players/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="admin" options={{ headerShown: false }} />
          <Stack.Screen name="payment" options={{ headerShown: false }} />
        </Stack>
      </View>
      {showPlayerRail ? <MobileNav isDark={isDark} /> : null}
    </View>
  );
}
