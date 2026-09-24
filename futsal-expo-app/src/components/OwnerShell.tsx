import {
  Bell,
  Building2,
  CalendarCheck,
  Globe,
  Inbox,
  LayoutDashboard,
  LogOut,
  Settings,
  Trophy,
  User as UserIcon,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useBreakpoints } from "@/lib/responsive";
import { fetchBookings, fetchNotifications, fetchVenues } from "@/api";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * OwnerShell — the Owner Studio chrome: Studio brand bar + the owner bottom
 * rail (a 1:1 port of OwnerShell's MOBILE_TABS).
 *
 * The web shell also has a desktop sidebar; on every width this app runs at
 * (phone / narrow web preview) the bottom rail *is* the navigation, matching
 * the mobile experience of the original. Profile lives on the rail's last item
 * on the web via NAV; here Settings is the player hub outside /admin, so a
 * compact top bar action pushes there.
 */

export const OWNER_NAV = [
  { href: "/admin", label: "Home", short: "Home", icon: LayoutDashboard, badge: "none" as const },
  {
    href: "/admin/requests",
    label: "Booking Requests",
    short: "Requests",
    icon: Inbox,
    badge: "requests" as const,
  },
  {
    href: "/admin/bookings",
    label: "All Bookings",
    short: "Bookings",
    icon: CalendarCheck,
    badge: "none" as const,
  },
  {
    href: "/admin/venues",
    label: "My Venues",
    short: "Venues",
    icon: Building2,
    badge: "none" as const,
  },
  {
    href: "/admin/leagues",
    label: "Leagues",
    short: "Leagues",
    icon: Trophy,
    badge: "none" as const,
  },
  {
    href: "/admin/notifications",
    label: "Notifications",
    short: "Alerts",
    icon: Bell,
    badge: "unread" as const,
  },
  {
    href: "/admin/profile",
    label: "My Profile",
    short: "Profile",
    icon: UserIcon,
    badge: "none" as const,
  },
];

/** Bottom-rail tabs — six items, as in the web MOBILE_TABS. */
export const OWNER_TABS = [
  { name: "index", label: "Home", icon: LayoutDashboard },
  { name: "requests", label: "Requests", icon: Inbox },
  { name: "bookings", label: "Bookings", icon: CalendarCheck },
  { name: "venues", label: "Venues", icon: Building2 },
  { name: "leagues", label: "Leagues", icon: Trophy },
  { name: "notifications", label: "Alerts", icon: Bell },
] as const;

function useOwnerBadges(userId: number | undefined) {
  const [pending, setPending] = useState(0);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [list, venues, notes] = await Promise.all([
        fetchBookings(),
        fetchVenues(),
        fetchNotifications(userId),
      ]);
      const mine = new Set(
        venues.filter((v) => (v as { ownerId?: number | null }).ownerId === userId).map((v) => v.id),
      );
      setPending(
        list.filter((b) => b.status === "pending" && b.venue && mine.has(b.venue.id)).length,
      );
      setUnread(notes.filter((n) => !n.isRead).length);
    } catch {
      /* badges are best-effort */
    }
  }, [userId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (!userId) return;
      fetchNotifications(userId)
        .then((n) => setUnread(n.filter((x) => !x.isRead).length))
        .catch(() => undefined);
    }, 15000);
    return () => clearInterval(t);
  }, [userId, load]);

  return { pending, unread, reload: load };
}

/** Top brand bar shared by every Owner Studio screen. */
export function OwnerHeader() {
  const { colors: c, isDark } = useTheme();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { sm } = useBreakpoints();
  const { pending, unread } = useOwnerBadges(user?.id);
  const totalBadge = pending + unread;

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: isDark ? "rgba(15,23,42,0.98)" : "#FFFFFF",
          borderColor: c.border,
          paddingTop: insets.top + space[2.5],
        },
      ]}
    >
      <Pressable
        onPress={() => router.push("/admin")}
        style={styles.brand}
        accessibilityRole="button"
        accessibilityLabel="FutsalNepal Studio home"
      >
        <View style={styles.brandIcon}>
          <Trophy size={18} color={colors.amber400} strokeWidth={2.5} />
        </View>
        <View>
          <Text style={[styles.brandTitle, { color: c.text }]}>
            FutsalNepal <Text style={{ color: colors.orange500 }}>Studio</Text>
          </Text>
          <Text style={[styles.brandSub, { color: c.textFaint }]}>Owner Console</Text>
        </View>
      </Pressable>

      <View style={styles.headerActions}>
        <Pressable
          onPress={() => router.push("/")}
          style={[styles.ghostBtn, { borderColor: c.border }]}
          accessibilityLabel="View player site"
        >
          <Globe size={14} color={c.textMuted} />
          {sm ? <Text style={[styles.ghostText, { color: c.textMuted }]}>Player site</Text> : null}
        </Pressable>
        <ThemeToggle />
        {sm ? (
          <Pressable
            onPress={() => router.push("/(app)/settings")}
            style={[styles.iconBtn, { borderColor: c.border }]}
            accessibilityLabel="Settings"
          >
            <Settings size={16} color={c.textMuted} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.push("/admin/notifications")}
          style={[styles.iconBtn, { borderColor: c.border }]}
          accessibilityLabel={
            unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
          }
        >
          <Bell size={16} color={c.textMuted} />
          {unread > 0 ? (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{unread > 9 ? "9+" : unread}</Text>
            </View>
          ) : null}
        </Pressable>
        {user ? (
          <Pressable
            onPress={() => router.push("/admin/profile")}
            style={[styles.profileIconBtn, { borderColor: c.border }]}
            accessibilityLabel="My profile"
          >
            <Avatar
              user={{
                name: user.name,
                avatarColor: user.avatarColor ?? colors.emerald600,
                avatarUrl: user.avatarUrl,
              }}
              size={30}
              rounded={false}
            />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            void signOut().then(() => router.replace("/"));
          }}
          style={[styles.iconBtn, { borderColor: c.border }]}
          accessibilityLabel="Log out"
        >
          <LogOut size={16} color={c.textMuted} />
        </Pressable>
      </View>
      {totalBadge > 0 ? null : null}
    </View>
  );
}

/** Studio tab bar for the admin stack (mirrors OWNER_TABS + badges). */
export function OwnerTabBar({
  state,
  descriptors,
  navigation,
}: {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: { emit: (e: unknown) => boolean; navigate: (name: string) => void };
}) {
  const { colors: c, isDark } = useTheme();
  const { user } = useAuth();
  const { pending, unread } = useOwnerBadges(user?.id);

  return (
    <View
      style={[
        styles.tabBar,
        { backgroundColor: isDark ? "rgba(15,23,42,0.98)" : "#FFFFFF", borderColor: c.border },
      ]}
    >
      {OWNER_TABS.map((t, i) => {
        const focused = state.index === i;
        const route = state.routes[i];
        const count = t.name === "requests" ? pending : t.name === "notifications" ? unread : 0;
        const Icon = t.icon;
        return (
          <Pressable
            key={t.name}
            onPress={() => {
              if (focused) return;
              // expo-router's emit return shape varies; navigatting on plain
              // press matches the default tabBar behaviour.
              navigation.emit({ type: "tabPress", target: route?.key, canPreventDefault: true });
              navigation.navigate(t.name);
            }}
            style={styles.tabItem}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={descriptors[route?.key ?? ""]?.options?.title ?? t.label}
          >
            <View>
              <Icon
                size={20}
                color={focused ? c.text : c.textFaint}
                strokeWidth={focused ? 2.5 : 2}
              />
              {count > 0 ? (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{count > 9 ? "9+" : count}</Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[
                styles.tabLabel,
                { color: focused ? c.text : c.textFaint },
              ]}
              numberOfLines={1}
            >
              {t.label}
            </Text>
            <View
              style={[
                styles.tabIndicator,
                { backgroundColor: focused ? c.text : "transparent" },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2.5],
    borderBottomWidth: 1,
    paddingTop: space[6],
  },
  brand: { flexDirection: "row", alignItems: "center", gap: space[2.5], minWidth: 0 },
  brandIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.xl,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: { fontSize: fontSize.sm, fontWeight: "900", letterSpacing: -0.3 },
  brandSub: {
    fontSize: fontSize["2xs"],
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: space[1.5], marginLeft: "auto" },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  ghostText: { fontSize: fontSize.xs, fontWeight: "700" },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  profileIconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  headerBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  headerBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    paddingBottom: space[1],
    paddingHorizontal: space[1],
  },
  tabItem: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 2,
    paddingVertical: space[2],
  },
  tabLabel: { fontSize: fontSize["2xs"], fontWeight: "700", maxWidth: "100%" },
  tabIndicator: {
    height: 4,
    width: 24,
    borderRadius: 2,
    marginTop: 2,
  },
  tabBadge: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  tabBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
});
