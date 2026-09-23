import { Redirect, Tabs } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View, type ColorValue } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { fontSize } from "@/theme";

/**
 * Authenticated area: a tab bar for the two top-level lists.
 *
 * The guard lives here rather than in each screen so there is one place that
 * decides "not signed in means no content". `ready` prevents the redirect from
 * firing before AsyncStorage has been read — without it, a signed-in user would
 * be bounced to /login on every cold start.
 */
export default function AppLayout() {
  const { user, ready, signOut } = useAuth();
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
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Venues",
          tabBarLabel: "Venues",
          tabBarIcon: ({ color }) => <TabIcon glyph="🏟️" color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: "My bookings",
          tabBarLabel: "Bookings",
          tabBarIcon: ({ color }) => <TabIcon glyph="📅" color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarLabel: "Account",
          tabBarIcon: ({ color }) => <TabIcon glyph="👤" color={color} />,
          headerRight: () => (
            <Text
              onPress={signOut}
              accessibilityRole="button"
              style={{ color: colors.primary, fontSize: fontSize.sm, fontWeight: "600" }}
            >
              Sign out
            </Text>
          ),
        }}
      />
    </Tabs>
  );
}

/** Emoji tab icon. A real app would use a vector icon set here. */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return (
    <Text style={{ fontSize: 18, color }} accessibilityElementsHidden>
      {glyph}
    </Text>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
