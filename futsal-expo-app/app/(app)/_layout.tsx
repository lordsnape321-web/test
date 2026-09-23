import { Redirect, Tabs } from "expo-router";
import { CalendarCheck, Home, MapPin, Settings, Zap } from "lucide-react-native";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { fontSize } from "@/theme";

/**
 * The bottom rail — a 1:1 port of the web app's components/MobileNav.tsx.
 *
 * Five tabs, and deliberately no more. The web version sizes its grid from the
 * TABS array length rather than a hardcoded five columns, because the rail once
 * carried six items against a five-column grid and the sixth wrapped onto a
 * second row hidden under the nav's own background. The same array drives this
 * layout, so adding a tab can't reproduce that bug.
 *
 * Two things are intentionally absent, matching the original:
 *  - Leagues — they are matches with a table attached, reached via the Matches
 *    tab, not a destination of their own.
 *  - Alerts — notifications live behind the bell, not a second door to one inbox.
 */
const TABS = [
  { name: "index", label: "Home", icon: Home },
  { name: "venues", label: "Courts", icon: MapPin },
  { name: "matches", label: "Matches", icon: Zap },
  { name: "bookings", label: "Bookings", icon: CalendarCheck },
  { name: "settings", label: "Settings", icon: Settings },
] as const;

export default function AppLayout() {
  const { user, ready } = useAuth();
  const { colors } = useTheme();

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.activeText,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: fontSize["2xs"], fontWeight: "700" },
        tabBarItemStyle: { paddingVertical: 4 },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.label,
            tabBarIcon: ({ color, focused }) => (
              <View
                style={[
                  styles.iconPill,
                  focused ? { backgroundColor: colors.activeSoft } : null,
                ]}
              >
                <t.icon size={20} color={color} strokeWidth={focused ? 2.5 : 2} />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  // h-8 w-12 rounded-full in the original — the active-tab highlight.
  iconPill: {
    height: 32,
    width: 48,
    maxWidth: "100%",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
});
