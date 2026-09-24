import { Tabs } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";
import { OwnerGuard } from "@/components/OwnerGuard";
import { OwnerHeader, OwnerTabBar } from "@/components/OwnerShell";
import { useTheme } from "@/context/ThemeContext";

/**
 * Owner Studio layout — brand bar + the six-item owner rail, with every child
 * gated by OwnerGuard (loading → sign-in → owners-only → content).
 */
export default function AdminLayout() {
  const { colors: c } = useTheme();
  return (
    <OwnerGuard>
      <View style={[styles.flex, { backgroundColor: c.bg }]}>
        <OwnerHeader />
        <Tabs
          screenOptions={{ headerShown: false }}
          tabBar={(props) => (
            <OwnerTabBar
              state={props.state}
              descriptors={props.descriptors as never}
              navigation={
                props.navigation as unknown as {
                  emit: (e: unknown) => boolean;
                  navigate: (name: string) => void;
                }
              }
            />
          )}
        >
          <Tabs.Screen name="index" options={{ title: "Home" }} />
          <Tabs.Screen name="requests" options={{ title: "Requests" }} />
          <Tabs.Screen name="bookings" options={{ title: "Bookings" }} />
          <Tabs.Screen name="venues" options={{ title: "Venues" }} />
          <Tabs.Screen name="leagues" options={{ title: "Leagues" }} />
          <Tabs.Screen name="notifications" options={{ title: "Alerts" }} />
          {/* Profile sits outside the rail but is still an owner screen. */}
          <Tabs.Screen name="profile" options={{ title: "Profile", href: null }} />
        </Tabs>
      </View>
    </OwnerGuard>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
