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
import { GatewaySheet } from "@/components/GatewaySheet";
import { MobileNav } from "@/components/MobileNav";
import { Navbar } from "@/components/Navbar";
import { PushBridge } from "@/components/PushBridge";
import { TurfBackdrop } from "@/components/TurfBackdrop";
import { hydratePaymentMode } from "@/lib/payment-mode";
import { announce, mark } from "@/lib/perf";
import { useBreakpoints } from "@/lib/responsive";
import {
  APP_FONT_FAMILY,
  darkPalette,
  lightPalette,
  ownerDarkPalette,
  ownerPalette,
} from "@/theme";

// The earliest code of ours the bundle runs: everything after this is measured
// from here. See src/lib/perf.ts.
announce();
mark("bundle evaluated");

// Which checkout the app runs (the gateways' test servers, or the built-in
// demo replica) is a saved setting, so it is read back before the first screen
// can offer to pay. Failure is harmless: the default is the real test server.
void hydratePaymentMode();

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

  // The whole app is gated on five font faces; knowing how long that takes is
  // the difference between blaming the fonts and blaming the bundle.
  React.useEffect(() => {
    if (fontsLoaded) mark("fonts ready");
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: lightPalette.bg }}>
        <ActivityIndicator size="large" color={lightPalette.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <ThemedStatusBar />
          {/* Registers this phone for push once someone is signed in, and routes
              a tapped notification to the screen it is about. Invisible. */}
          <PushBridge />
          <Shell />
          {/* One sheet for the whole app: on a phone a Pay opens the gateway's
              page here instead of sending the player to a browser. */}
          <GatewaySheet />
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
  // switching its palette after a route change. Every scene gets a real canvas
  // colour; nothing falls through to the browser's default white surface.
  const shellBackground = isOwnerStudio
    ? isDark
      ? ownerDarkPalette.bg
      : ownerPalette.bg
    : isDark
      ? darkPalette.bg
      : lightPalette.bg;

  React.useEffect(() => {
    if (ownerOutsideStudio) router.replace("/admin");
  }, [ownerOutsideStudio, router]);

  // First paint of the shell — bundle parsed, fonts in, providers mounted. This
  // is the number to compare against the request timings in the same log.
  React.useEffect(() => {
    mark("app ready");
  }, []);

  // Do not mount a player route while the persisted session is being restored.
  // An owner opening a saved player URL must never see the player shell, even
  // for the short hydration window before `user.role` is available.
  if (!ready || ownerOutsideStudio) {
    const loadingPalette = isOwnerStudio
      ? isDark
        ? ownerDarkPalette
        : ownerPalette
      : isDark
        ? darkPalette
        : lightPalette;
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: loadingPalette.bg }}>
        <ActivityIndicator size="large" color={loadingPalette.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: shellBackground }}>
      {/* `.turf-pattern` — warm peach / night blobs behind every player route. */}
      <TurfBackdrop style={{ backgroundColor: shellBackground }} />
      {showPlayerChrome ? <Navbar /> : null}
      {/* Full-bleed: the app fills the browser window at every size. The
          wide-screen breathing room comes from the responsive gutters and the
          extra grid columns, not from a fixed-width column with empty margins. */}
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            headerTitleStyle: { color: colors.text, fontFamily: APP_FONT_FAMILY },
            contentStyle: {
              backgroundColor: shellBackground,
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
      {showPlayerRail ? <MobileNav /> : null}
    </View>
  );
}
