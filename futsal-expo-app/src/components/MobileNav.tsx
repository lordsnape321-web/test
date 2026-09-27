import { usePathname, useRouter } from "expo-router";
import { CalendarCheck, Home, MapPin, Settings, Zap } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBreakpoints } from "@/lib/responsive";
import { colors as brand, radius, space } from "@/theme";

/**
 * The player rail is global, just like the web AppShell's MobileNav. Keeping it
 * outside the `(app)` route group matters: venue, team, player, league, auth,
 * notification, and booking detail screens all keep the same chrome as Home.
 */
const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/venues", label: "Courts", icon: MapPin },
  { href: "/matches", label: "Matches", icon: Zap },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function MobileNav({ isDark }: { isDark: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bp = useBreakpoints();

  // The source web rail is lg:hidden. React Native web previews can therefore
  // use the same desktop breakpoint while phones and tablets always get it.
  if (bp.width >= 1024) return null;

  const border = isDark ? "rgba(255,255,255,0.10)" : brand.borderSand;
  const bg = isDark ? "rgba(2,6,23,0.96)" : "rgba(255,255,255,0.96)";
  const activeText = isDark ? brand.emerald400 : brand.emerald700;
  const idleText = isDark ? brand.slate500 : brand.stone400;
  const activeSoft = isDark ? "rgba(16,185,129,0.15)" : brand.emerald100;

  return (
    <View
      style={[
        styles.nav,
        {
          backgroundColor: bg,
          borderTopColor: border,
          paddingBottom: insets.bottom,
          shadowColor: "rgb(180,120,60)",
          shadowOpacity: isDark ? 0 : 0.1,
          shadowRadius: 15,
          shadowOffset: { width: 0, height: -8 },
          elevation: 12,
        },
      ]}
    >
      <View style={styles.grid}>
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Pressable
              key={tab.href}
              onPress={() => {
                if (!active) router.push(tab.href);
              }}
              accessibilityRole="button"
              accessibilityState={active ? { selected: true } : {}}
              accessibilityLabel={tab.label}
              style={styles.item}
            >
              <View style={[styles.iconPill, active ? { backgroundColor: activeSoft, borderRadius: radius.xl } : null]}>
                <Icon size={20} color={active ? activeText : idleText} strokeWidth={active ? 2.5 : 2} />
              </View>
              <Text style={[styles.label, { color: active ? activeText : idleText }]} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { borderTopWidth: 1, paddingTop: space[1] },
  grid: {
    flexDirection: "row",
    maxWidth: 512,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: space[2],
    columnGap: space[1],
  },
  item: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 4,
    borderRadius: radius.xl,
    paddingVertical: space[2.5],
  },
  iconPill: {
    height: 32,
    width: 48,
    maxWidth: "100%",
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 10, fontWeight: "700", textAlign: "center", maxWidth: "100%" },
});
