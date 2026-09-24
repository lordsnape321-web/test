import { Tabs } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";

/**
 * Player routes share the global Navbar and MobileNav from the root layout.
 * Keeping the tabs navigator here preserves Expo Router's nested route state,
 * while the global chrome also stays present on detail, auth, and notification
 * screens exactly as it does in the web AppShell.
 */
export default function AppLayout() {
  const { colors: c } = useTheme();

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
  hiddenTabBar: { height: 0, display: "none" },
});
