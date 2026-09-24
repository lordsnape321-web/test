import { Tabs, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

/**
 * Player routes share the global Navbar and MobileNav from the root layout.
 * Keeping the tabs navigator here preserves Expo Router's nested route state,
 * while the global chrome also stays present on detail, auth, and notification
 * screens exactly as it does in the web AppShell.
 */
export default function AppLayout() {
  const { colors: c, isDark } = useTheme();
  const { user, ready } = useAuth();
  const router = useRouter();
  const ownerInPlayerTree = ready && user?.role === "owner";

  useEffect(() => {
    if (ownerInPlayerTree) router.replace("/admin");
  }, [ownerInPlayerTree, router]);

  // This is a second boundary below the root shell. It prevents a stale back
  // stack or a direct player-group deep link from ever mounting player tabs for
  // an authenticated owner.
  if (!ready || ownerInPlayerTree) {
    return (
      <View style={[styles.flex, styles.center, { backgroundColor: isDark ? "#020617" : "#F1F5F9" }]}>
        <ActivityIndicator size="large" color={isDark ? "#FBBF24" : "#F97316"} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: c.bg },
        }}
        // The web app's bottom navigation is global, not limited to this route
        // group. The root layout renders the native equivalent once.
        tabBar={() => <View style={styles.hiddenTabBar} />}
      >
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="venues" options={{ title: "Courts" }} />
        <Tabs.Screen name="matches" options={{ title: "Matches" }} />
        <Tabs.Screen name="bookings" options={{ title: "Bookings" }} />
        <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  hiddenTabBar: { height: 0, display: "none" },
});
