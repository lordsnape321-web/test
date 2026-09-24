import { Redirect, Tabs } from "expo-router";
import { CalendarCheck, Home, MapPin, Settings, Zap } from "lucide-react-native";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useBreakpoints } from "@/lib/responsive";
import { colors as brand, fontSize, radius, space } from "@/theme";

/**
 * Player shell — Navbar (top) + screen + MobileNav (bottom), matching the web
 * AppShell's <Navbar /> / <MobileNav /> sandwich.
 *
 * The bottom rail is a custom tabBar that mirrors MobileNav's classes:
 * border-t border-[#F0E3CC] bg-white/95 shadow, active emerald-700 text with
 * an emerald-100 pill behind a 20px icon, 10px bold labels.
 */
const TABS = [
  { name: "index", label: "Home", icon: Home, href: "/" as const },
  { name: "venues", label: "Courts", icon: MapPin, href: "/venues" as const },
  { name: "matches", label: "Matches", icon: Zap, href: "/matches" as const },
  { name: "bookings", label: "Bookings", icon: CalendarCheck, href: "/bookings" as const },
  { name: "settings", label: "Settings", icon: Settings, href: "/(app)/settings" as const },
] as const;

export default function AppLayout() {
  const { user, ready } = useAuth();
  const { colors: c, isDark } = useTheme();
  const bp = useBreakpoints();
  // Web MobileNav is `lg:hidden` — hide the bottom rail on wide screens.
  const showBottomRail = bp.width < 1024;

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <View style={[styles.flex, { backgroundColor: c.bg }]}>
      <Navbar />
      <View style={styles.flex}>
        <Tabs
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: c.bg },
          }}
          tabBar={(props) =>
            showBottomRail ? (
              <MobileNav
                state={props.state}
                navigation={props.navigation as never}
                isDark={isDark}
              />
            ) : (
              <View style={{ display: "none" }} />
            )
          }
        >
          {TABS.map((t) => (
            <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
          ))}
        </Tabs>
      </View>
    </View>
  );
}

/** MobileNav port — fixed bottom rail with the web's colours and active pill. */
function MobileNav({
  state,
  navigation,
  isDark,
}: {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  navigation: {
    emit: (e: unknown) => boolean;
    navigate: (name: string) => void;
  };
  isDark: boolean;
}) {
  const insets = useSafeAreaInsets();
  const border = isDark ? "rgba(255,255,255,0.10)" : brand.borderSand;
  const bg = isDark ? "rgba(2,6,23,0.96)" : "rgba(255,255,255,0.96)";

  return (
    <View
      style={[
        styles.nav,
        {
          backgroundColor: bg,
          borderTopColor: border,
          paddingBottom: Math.max(insets.bottom, space[1]),
          shadowColor: "rgb(180,120,60)",
          shadowOpacity: isDark ? 0 : 0.1,
          shadowRadius: 15,
          shadowOffset: { width: 0, height: -8 },
          elevation: 12,
        },
      ]}
    >
      <View style={styles.navGrid}>
        {TABS.map((t, i) => {
          const focused = state.index === i;
          const route = state.routes[i];
          const activeText = isDark ? brand.emerald400 : brand.emerald700;
          const idleText = isDark ? brand.slate500 : brand.stone400;
          const activeSoft = isDark ? "rgba(16,185,129,0.15)" : brand.emerald100;
          const Icon = t.icon;
          return (
            <View key={t.name} style={styles.navItem}>
              <Pressable
                onPress={() => {
                  const e = navigation.emit({
                    type: "tabPress",
                    target: route?.key,
                    canPreventDefault: true,
                  }) as unknown as { defaultPrevented?: boolean };
                  if (!focused && !e.defaultPrevented) {
                    navigation.navigate(t.name);
                  }
                }}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={t.label}
                style={styles.navLink}
              >
                <View
                  style={[
                    styles.iconPill,
                    focused ? { backgroundColor: activeSoft } : null,
                  ]}
                >
                  <Icon size={20} color={focused ? activeText : idleText} strokeWidth={focused ? 2.5 : 2} />
                </View>
                <Text
                  style={[
                    styles.navLabel,
                    { color: focused ? activeText : idleText },
                  ]}
                  numberOfLines={1}
                >
                  {t.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  nav: {
    borderTopWidth: 1,
    paddingTop: space[1],
    // pb-[env(safe-area-inset-bottom)] applied via insets above
  },
  navGrid: {
    flexDirection: "row",
    maxWidth: 512,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: space[2],
  },
  navItem: { flex: 1, minWidth: 0 },
  navLink: {
    alignItems: "center",
    gap: 4,
    borderRadius: radius.xl,
    paddingVertical: space[2.5],
  },
  // h-8 w-12 rounded-full place-items-center
  iconPill: {
    height: 32,
    width: 48,
    maxWidth: "100%",
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  navLabel: {
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    maxWidth: "100%",
  },
});
