import {
  Bell,
  Building2,
  CalendarCheck,
  Globe,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Trophy,
  X,
  User as UserIcon,
} from "lucide-react-native";
import { usePathname, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useBreakpoints } from "@/lib/responsive";
import { fetchBookings, fetchNotifications, fetchVenues } from "@/api";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * OwnerShell — the Owner Studio chrome: responsive Studio brand bar, desktop
 * sidebar, and six-item mobile rail (the same breakpoints as the web shell).
 * The mobile drawer carries the web shell's profile/settings actions that do not
 * fit in the bottom rail.
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
  {
    href: "/settings",
    label: "Settings",
    short: "Settings",
    icon: Settings,
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
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { sm, lg } = useBreakpoints();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pending, unread } = useOwnerBadges(user?.id);

  const logout = () => {
    setDrawerOpen(false);
    void signOut().then(() => router.replace("/"));
  };

  return (
    <>
      <View
        style={[
          styles.header,
          {
            backgroundColor: isDark ? colors.slate950 : colors.white,
            borderColor: c.border,
            paddingTop: insets.top + space[2.5],
          },
        ]}
      >
        {!lg ? (
          <Pressable
            onPress={() => setDrawerOpen(true)}
            style={[styles.iconBtn, { borderColor: c.border }]}
            accessibilityLabel="Open menu"
          >
            <Menu size={20} color={c.textMuted} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => router.push("/admin")}
          style={styles.brand}
          accessibilityRole="button"
          accessibilityLabel="FutsalNepal Studio home"
        >
          <View style={styles.brandIcon}>
            <Trophy size={18} color={colors.amber400} strokeWidth={2.5} />
          </View>
          <View style={styles.brandCopy}>
            <Text style={[styles.brandTitle, { color: c.text }]} numberOfLines={1}>
              FutsalNepal <Text style={{ color: colors.orange500 }}>Studio</Text>
            </Text>
            <Text style={[styles.brandSub, { color: c.textFaint }]} numberOfLines={1}>
              Owner Console
            </Text>
          </View>
        </Pressable>

        <View style={styles.headerActions}>
          {sm ? (
            <Pressable
              onPress={() => router.push("/")}
              style={[styles.ghostBtn, { borderColor: c.border }]}
              accessibilityLabel="View player site"
            >
              <Globe size={14} color={c.textMuted} />
              <Text style={[styles.ghostText, { color: c.textMuted }]} numberOfLines={1}>
                View player site
              </Text>
            </Pressable>
          ) : null}
          <ThemeToggle />
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
          {sm && user ? (
            <Pressable
              onPress={() => router.push("/admin/profile")}
              style={[lg ? styles.profileHeaderBtn : styles.profileIconBtn, { borderColor: c.border, backgroundColor: lg ? c.inset : "transparent" }]}
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
              {lg ? (
                <View style={styles.profileMeta}>
                  <Text style={[styles.profileName, { color: c.text }]} numberOfLines={1}>
                    {user.name}
                  </Text>
                  <Text style={[styles.profileRole, { color: c.textFaint }]}>Venue Owner</Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
          {sm ? (
            <Pressable
              onPress={logout}
              style={[styles.iconBtn, { borderColor: c.border }]}
              accessibilityLabel="Log out"
            >
              <LogOut size={16} color={c.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {!lg ? (
        <Modal
          visible={drawerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setDrawerOpen(false)}
        >
          <OwnerDrawer
            pathname={pathname}
            user={user}
            pending={pending}
            unread={unread}
            colors={c}
            topInset={insets.top}
            bottomInset={insets.bottom}
            onClose={() => setDrawerOpen(false)}
            onNavigate={(href) => {
              setDrawerOpen(false);
              router.push(href as never);
            }}
            onLogout={logout}
          />
        </Modal>
      ) : null}
    </>
  );
}

function OwnerDrawer({
  pathname,
  user,
  pending,
  unread,
  colors: c,
  topInset,
  bottomInset,
  onClose,
  onNavigate,
  onLogout,
}: {
  pathname: string;
  user: { name: string; avatarColor?: string | null; avatarUrl?: string | null } | null;
  pending: number;
  unread: number;
  colors: { bg: string; surface: string; inset: string; border: string; text: string; textMuted: string; textFaint: string };
  topInset: number;
  bottomInset: number;
  onClose: () => void;
  onNavigate: (href: string) => void;
  onLogout: () => void;
}) {
  return (
    <View style={styles.drawerOverlay}>
      <Pressable style={styles.drawerScrim} onPress={onClose} accessibilityLabel="Close menu" />
      <View
        style={[
          styles.drawer,
          {
            backgroundColor: c.surface,
            borderRightColor: c.border,
            paddingTop: topInset + space[4],
            paddingBottom: bottomInset + space[4],
          },
        ]}
      >
        <View style={styles.drawerHead}>
          <View style={styles.drawerBrand}>
            <View style={styles.brandIcon}>
              <Trophy size={18} color={colors.amber400} strokeWidth={2.5} />
            </View>
            <Text style={[styles.drawerTitle, { color: c.text }]}>Owner Studio</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={[styles.iconBtn, { borderColor: c.border }]}
            accessibilityLabel="Close menu"
          >
            <X size={18} color={c.textMuted} />
          </Pressable>
        </View>

        {user ? (
          <View style={[styles.drawerUser, { backgroundColor: c.inset, borderColor: c.border }]}>
            <Avatar
              user={{
                name: user.name,
                avatarColor: user.avatarColor ?? colors.emerald600,
                avatarUrl: user.avatarUrl,
              }}
              size={36}
              rounded={false}
            />
            <View style={styles.drawerUserCopy}>
              <Text style={[styles.drawerUserName, { color: c.text }]} numberOfLines={1}>
                {user.name}
              </Text>
              <Text style={[styles.drawerUserRole, { color: c.textMuted }]}>Venue Owner</Text>
            </View>
          </View>
        ) : null}

        <ScrollView style={styles.drawerList} contentContainerStyle={styles.drawerListContent}>
          {OWNER_NAV.map((item) => {
            const active = item.href === "/admin"
              ? pathname === "/admin"
              : pathname === item.href || pathname.startsWith(item.href + "/");
            const count = item.badge === "requests" ? pending : item.badge === "unread" ? unread : 0;
            const Icon = item.icon;
            return (
              <Pressable
                key={item.href}
                onPress={() => onNavigate(item.href)}
                style={[
                  styles.drawerItem,
                  {
                    backgroundColor: active ? c.text : "transparent",
                    borderColor: active ? c.text : "transparent",
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Icon size={18} color={active ? c.surface : c.textMuted} />
                <Text
                  style={[styles.drawerItemText, { color: active ? c.surface : c.text }]}
                  numberOfLines={1}
                >
                  {item.href === "/admin" ? "Overview" : item.label}
                </Text>
                {count > 0 ? (
                  <View style={styles.drawerBadge}>
                    <Text style={styles.drawerBadgeText}>{count > 99 ? "99+" : count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={[styles.drawerFooter, { borderTopColor: c.border }]}>
          <Pressable
            onPress={() => onNavigate("/")}
            style={[styles.drawerFooterBtn, { borderColor: c.border }]}
          >
            <Globe size={16} color={c.textMuted} />
            <Text style={[styles.drawerFooterText, { color: c.textMuted }]}>View player site</Text>
          </Pressable>
          <Pressable
            onPress={onLogout}
            style={[styles.drawerFooterBtn, { backgroundColor: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.20)" }]}
          >
            <LogOut size={16} color={colors.red500} />
            <Text style={[styles.drawerFooterText, { color: colors.red500 }]}>Log out</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Desktop Owner Studio sidebar; the web shell swaps to this at lg. */
export function OwnerSidebar() {
  const { colors: c } = useTheme();
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { pending, unread } = useOwnerBadges(user?.id);

  return (
    <View style={styles.sidebar}>
      <View style={[styles.sidebarCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        {OWNER_NAV.map((item) => {
          const active = item.href === "/admin"
            ? pathname === "/admin"
            : pathname === item.href || pathname.startsWith(item.href + "/");
          const count = item.badge === "requests" ? pending : item.badge === "unread" ? unread : 0;
          const Icon = item.icon;
          return (
            <Pressable
              key={item.href}
              onPress={() => router.push(item.href as never)}
              style={[
                styles.sidebarItem,
                { backgroundColor: active ? c.text : "transparent" },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Icon size={18} color={active ? c.surface : c.textMuted} />
              <Text
                style={[styles.sidebarItemText, { color: active ? c.surface : c.text }]}
                numberOfLines={1}
              >
                {item.href === "/admin" ? "Overview" : item.label}
              </Text>
              {count > 0 ? (
                <View style={styles.sidebarBadge}>
                  <Text style={styles.sidebarBadgeText}>{count > 99 ? "99+" : count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.sidebarPromo, { backgroundColor: colors.slate900 }]}>
        <Text style={styles.sidebarPromoTitle}>Need more bookings? 📈</Text>
        <Text style={styles.sidebarPromoBody}>
          Accept requests fast — venues that respond within 15 minutes get 3× more repeat players.
        </Text>
        <Pressable
          onPress={() => router.push("/admin/requests")}
          style={styles.sidebarPromoButton}
        >
          <Text style={styles.sidebarPromoButtonText}>Review requests</Text>
        </Pressable>
      </View>
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
  const insets = useSafeAreaInsets();
  const { pending, unread } = useOwnerBadges(user?.id);

  return (
    <View
      style={[
        styles.tabBar,
        {
          backgroundColor: isDark ? colors.slate950 : colors.white,
          borderColor: c.border,
          paddingBottom: insets.bottom + space[1],
        },
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
  brand: { flexDirection: "row", alignItems: "center", gap: space[2.5], minWidth: 0, flexShrink: 1 },
  brandCopy: { minWidth: 0, flexShrink: 1 },
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: space[1.5], marginLeft: "auto", flexShrink: 0 },
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
    position: "relative",
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  profileHeaderBtn: {
    minHeight: 36,
    maxWidth: 190,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  profileMeta: { minWidth: 0, maxWidth: 120 },
  profileName: { fontSize: fontSize.xs, fontWeight: "900" },
  profileRole: { fontSize: 10, fontWeight: "700", marginTop: 1 },
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
  sidebar: { width: 256, flexShrink: 0, gap: space[4] },
  sidebarCard: { borderWidth: 1, borderRadius: radius["2xl"], padding: space[3], gap: space[1] },
  sidebarItem: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space[3], borderRadius: radius.xl, paddingHorizontal: space[3.5], paddingVertical: space[2.5] },
  sidebarItemText: { flex: 1, minWidth: 0, fontSize: fontSize.sm, fontWeight: "800" },
  sidebarBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.orange500, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  sidebarBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  sidebarPromo: { borderRadius: radius["2xl"], padding: space[5] },
  sidebarPromoTitle: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
  sidebarPromoBody: { color: colors.slate300, fontSize: fontSize.xs, lineHeight: 17, marginTop: space[1] },
  sidebarPromoButton: { minHeight: 40, borderRadius: radius.xl, backgroundColor: colors.amber400, alignItems: "center", justifyContent: "center", marginTop: space[3], paddingHorizontal: space[3] },
  sidebarPromoButtonText: { color: colors.slate950, fontSize: fontSize.xs, fontWeight: "900" },
  drawerOverlay: { flex: 1, flexDirection: "row" },
  drawerScrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(15,23,42,0.50)" },
  drawer: { width: 288, height: "100%", borderRightWidth: 1, paddingHorizontal: space[4], shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 8, height: 0 }, elevation: 12 },
  drawerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: space[3] },
  drawerBrand: { flexDirection: "row", alignItems: "center", gap: space[2] },
  drawerTitle: { fontSize: fontSize.base, fontWeight: "900" },
  drawerUser: { flexDirection: "row", alignItems: "center", gap: space[3], borderWidth: 1, borderRadius: radius.xl, padding: space[3], marginBottom: space[3] },
  drawerUserCopy: { flex: 1, minWidth: 0 },
  drawerUserName: { fontSize: fontSize.sm, fontWeight: "900" },
  drawerUserRole: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 2 },
  drawerList: { flex: 1 },
  drawerListContent: { gap: space[1] },
  drawerItem: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 44, borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: space[3.5], paddingVertical: space[2.5] },
  drawerItemText: { flex: 1, minWidth: 0, fontSize: fontSize.sm, fontWeight: "800" },
  drawerBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.orange500, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  drawerBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  drawerFooter: { gap: space[2], borderTopWidth: 1, paddingTop: space[3] },
  drawerFooterBtn: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space[2], borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: space[3.5], paddingVertical: space[2.5] },
  drawerFooterText: { fontSize: fontSize.sm, fontWeight: "800" },
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
