import { LinearGradient } from "expo-linear-gradient";
import { usePathname, useRouter } from "expo-router";
import {
  Bell,
  CalendarCheck,
  ChevronDown,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Settings,
  Trophy,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react-native";
import React, { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useBreakpoints } from "@/lib/responsive";
import { APP_FONT_FAMILY, colors as brand, fontSize, radius, space } from "@/theme";

/*
 * The top rail 🧭 — a 1:1 port of the web app's components/Navbar.tsx.
 *
 * Two things are deliberately absent (same as the original):
 *  - Leagues: second half of Matches, not their own destination.
 *  - Alerts: the bell owns the inbox.
 */
const PUBLIC_LINKS = [
  { href: "/venues", label: "Find Courts", icon: MapPin },
  { href: "/matches", label: "Find Match", icon: Zap },
  { href: "/teams", label: "Teams", icon: Users },
] as const;

const PLAYER_LINKS = [
  ...PUBLIC_LINKS,
  { href: "/bookings", label: "My Bookings", icon: CalendarCheck },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isOwner, signOut } = useAuth();
  const { colors: c, isDark } = useTheme();
  const { sm, lg } = useBreakpoints();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const LINKS = !user ? PUBLIC_LINKS : isOwner ? PUBLIC_LINKS : PLAYER_LINKS;

  const isLight = !isDark;
  // sticky top-0 border-b border-[#F0E3CC] bg-[#FFFDF7]/90 | dark slate-950/90
  const headerBg = isDark ? "rgba(2,6,23,0.92)" : "rgba(255,253,247,0.94)";
  const headerBorder = isDark ? "rgba(255,255,255,0.10)" : brand.borderSand;

  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: insets.top,
          backgroundColor: headerBg,
          borderBottomColor: headerBorder,
        },
      ]}
    >
      <View style={[styles.inner, { paddingHorizontal: sm ? space[6] : space[4] }]}>
        {/* Brand */}
        <Pressable
          onPress={() => router.push("/")}
          style={styles.brand}
          accessibilityRole="button"
          accessibilityLabel="FutsalNepal home"
        >
          <LinearGradient
            colors={[brand.emerald500, brand.green700]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.brandIcon}
          >
            <Trophy size={20} color="#FFFFFF" strokeWidth={2.5} />
          </LinearGradient>
          <View style={styles.brandText}>
            <Text style={[styles.wordmark, { color: c.text, fontSize: sm ? 17 : 15 }]} numberOfLines={1}>
              Futsal
              <Text style={{ color: isDark ? brand.emerald400 : brand.emerald600 }}>Nepal</Text>
            </Text>
            {sm ? (
              <Text style={[styles.tagline, { color: c.textFaint }]}>Friends • Fun • Football</Text>
            ) : null}
          </View>
        </Pressable>

        {lg ? (
          <View style={styles.desktopNav}>
            {LINKS.map((link) => {
              const active = pathname === link.href || pathname.startsWith(link.href + "/");
              const Icon = link.icon;
              return (
                <Pressable
                  key={link.href}
                  onPress={() => router.push(link.href as never)}
                  accessibilityRole="link"
                  style={[
                    styles.desktopLink,
                    active
                      ? { backgroundColor: brand.emerald600 }
                      : { backgroundColor: "transparent" },
                  ]}
                >
                  <Icon size={16} color={active ? "#FFFFFF" : isLight ? brand.stone600 : brand.slate300} />
                  <Text style={[styles.desktopLinkText, { color: active ? "#FFFFFF" : isLight ? brand.stone600 : brand.slate300 }]}>
                    {link.label}
                  </Text>
                </Pressable>
              );
            })}
            {user && isOwner ? (
              <Pressable
                onPress={() => router.push("/admin")}
                accessibilityRole="link"
                style={[styles.desktopLink, styles.ownerLink]}
              >
                <LayoutDashboard size={16} color="#FFFFFF" />
                <Text style={[styles.desktopLinkText, { color: "#FFFFFF" }]}>Owner Studio</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.actions, { gap: sm ? space[2] : space[1.5] }]}>
          <ThemeToggle />
          {user ? <NotificationBell /> : null}
          {user && sm ? (
            <Pressable
              onPress={() => router.push("/(app)/settings")}
              style={[
                styles.iconBtn,
                pathname.startsWith("/settings")
                  ? { backgroundColor: brand.emerald600, borderColor: brand.emerald600 }
                  : {
                      borderColor: isLight ? brand.stone200 : "rgba(255,255,255,0.10)",
                      backgroundColor: isLight ? brand.white : brand.slate900,
                    },
              ]}
              accessibilityLabel="Settings"
            >
              <Settings
                size={20}
                color={
                  pathname.startsWith("/settings")
                    ? "#FFFFFF"
                    : isLight
                      ? brand.stone600
                      : brand.slate300
                }
              />
            </Pressable>
          ) : null}

          {!user && sm ? (
            <View style={styles.authRow}>
              <Pressable
                onPress={() => router.push("/login")}
                style={[
                  styles.loginBtn,
                  {
                    borderColor: isLight ? brand.stone200 : "rgba(255,255,255,0.10)",
                    backgroundColor: isLight ? brand.white : brand.slate900,
                  },
                ]}
              >
                <LogIn size={16} color={isLight ? brand.stone700 : brand.slate200} />
                <Text style={[styles.loginText, { color: isLight ? brand.stone700 : brand.slate200 }]}>
                  Log in
                </Text>
              </Pressable>
              <Pressable onPress={() => router.push("/signup")} style={styles.joinBtn}>
                <UserPlus size={16} color="#FFFFFF" />
                <Text style={styles.joinText}>Join free</Text>
              </Pressable>
            </View>
          ) : user && sm ? (
            <View style={styles.profileWrap}>
              <Pressable
                onPress={() => setProfileOpen((v) => !v)}
                style={[
                  styles.profileBtn,
                  {
                    borderColor: isLight ? brand.stone200 : "rgba(255,255,255,0.10)",
                    backgroundColor: isLight ? brand.white : brand.slate900,
                  },
                ]}
              >
                <Avatar
                  user={{
                    name: user.name,
                    avatarColor: (user as { avatarColor?: string }).avatarColor ?? "#16a34a",
                    avatarUrl: (user as { avatarUrl?: string }).avatarUrl,
                  }}
                  size={32}
                />
                <View style={styles.profileMeta}>
                  <Text style={[styles.profileName, { color: c.text }]} numberOfLines={1}>
                    {user.name}
                  </Text>
                  <Text style={[styles.profileRole, { color: c.textMuted }]} numberOfLines={1}>
                    {isOwner ? "Venue Owner" : `${user.level ?? "Rookie"} • ${user.position ?? "—"}`}
                  </Text>
                </View>
                <ChevronDown size={16} color={c.textFaint} />
              </Pressable>

              {profileOpen ? (
                <>
                  <Pressable style={styles.overlay} onPress={() => setProfileOpen(false)} />
                  <View
                    style={[
                      styles.dropdown,
                      {
                        borderColor: isLight ? brand.stone200 : "rgba(255,255,255,0.10)",
                        backgroundColor: isLight ? brand.white : brand.slate900,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.dropdownHead,
                        {
                          borderBottomColor: isLight ? brand.stone100 : "rgba(255,255,255,0.05)",
                          backgroundColor: isLight ? "rgba(255,247,237,0.6)" : "rgba(249,115,22,0.10)",
                        },
                      ]}
                    >
                      <Text style={[styles.dropdownName, { color: c.text }]} numberOfLines={1}>
                        {user.name}
                      </Text>
                      <Text style={[styles.dropdownEmail, { color: c.textMuted }]} numberOfLines={1}>
                        {user.email}
                      </Text>
                      <Text style={[styles.dropdownMeta, { color: c.textFaint }]}>
                        {isOwner
                          ? "Venue Owner account"
                          : `${user.level ?? ""} • ${user.position ?? ""}`}
                      </Text>
                    </View>
                    <View style={styles.dropdownList}>
                      <Pressable
                        onPress={() => {
                          setProfileOpen(false);
                          router.push(isOwner ? "/admin" : "/(app)/bookings");
                        }}
                        style={styles.dropdownItem}
                      >
                        {isOwner ? (
                          <LayoutDashboard size={16} color={brand.orange500} />
                        ) : (
                          <CalendarCheck size={16} color={brand.emerald600} />
                        )}
                        <Text style={[styles.dropdownItemText, { color: c.text }]}>
                          {isOwner ? "Open Owner Studio" : "My Bookings"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setProfileOpen(false);
                          router.push("/(app)/settings");
                        }}
                        style={styles.dropdownItem}
                      >
                        <Settings size={16} color={brand.emerald600} />
                        <Text style={[styles.dropdownItemText, { color: c.text }]}>Settings</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setProfileOpen(false);
                          router.push(isOwner ? "/admin/profile" : "/profile");
                        }}
                        style={styles.dropdownItem}
                      >
                        <Users size={16} color={brand.emerald600} />
                        <Text style={[styles.dropdownItemText, { color: c.text }]}>My profile</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setProfileOpen(false);
                          void signOut().then(() => router.replace("/"));
                        }}
                        style={styles.dropdownItem}
                      >
                        <LogOut size={16} color={brand.red500} />
                        <Text style={[styles.dropdownItemText, { color: brand.red500 }]}>
                          Log out
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </>
              ) : null}
            </View>
          ) : null}

          {!lg ? (
            <>
          {/* Hamburger (matches the web mobile menu; the bottom rail is always there too) */}
          <Pressable
            onPress={() => setOpen((v) => !v)}
            style={[
              styles.iconBtn,
              {
                borderColor: isLight ? brand.stone200 : "rgba(255,255,255,0.10)",
                backgroundColor: isLight ? brand.white : brand.slate900,
              },
            ]}
            accessibilityLabel="Menu"
          >
            {open ? (
              <X size={20} color={isLight ? brand.stone700 : brand.slate200} />
            ) : (
              <Menu size={20} color={isLight ? brand.stone700 : brand.slate200} />
            )}
          </Pressable>
            </>
          ) : null}
        </View>
      </View>

      {open && !lg ? (
        <View
          style={[
            styles.mobileMenu,
            {
              borderTopColor: headerBorder,
              backgroundColor: isDark ? brand.slate950 : brand.headerCream,
            },
          ]}
        >
          <View style={styles.mobileLinks}>
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(l.href + "/");
              const Icon = l.icon;
              return (
                <Pressable
                  key={l.href}
                  onPress={() => {
                    setOpen(false);
                    router.push(l.href as never);
                  }}
                  style={[
                    styles.mobileLink,
                    active
                      ? { backgroundColor: brand.emerald600 }
                      : { backgroundColor: isLight ? brand.stone100 : "rgba(255,255,255,0.05)" },
                  ]}
                >
                  <Icon size={16} color={active ? "#FFFFFF" : isLight ? brand.stone700 : brand.slate200} />
                  <Text
                    style={[
                      styles.mobileLinkText,
                      { color: active ? "#FFFFFF" : isLight ? brand.stone700 : brand.slate200 },
                    ]}
                  >
                    {l.label}
                  </Text>
                </Pressable>
              );
            })}
            {user && isOwner ? (
              <Pressable
                onPress={() => {
                  setOpen(false);
                  router.push("/admin");
                }}
                style={[styles.mobileLink, { backgroundColor: brand.orange500 }]}
              >
                <LayoutDashboard size={16} color="#FFFFFF" />
                <Text style={[styles.mobileLinkText, { color: "#FFFFFF" }]}>
                  Open Owner Studio
                </Text>
              </Pressable>
            ) : null}
            {user ? (
              <Pressable
                onPress={() => {
                  setOpen(false);
                  router.push("/(app)/settings");
                }}
                style={[
                  styles.mobileLink,
                  pathname.startsWith("/settings")
                    ? { backgroundColor: brand.emerald600 }
                    : { backgroundColor: isLight ? brand.stone100 : "rgba(255,255,255,0.05)" },
                ]}
              >
                <Settings
                  size={16}
                  color={
                    pathname.startsWith("/settings")
                      ? "#FFFFFF"
                      : isLight
                        ? brand.stone700
                        : brand.slate200
                  }
                />
                <Text
                  style={[
                    styles.mobileLinkText,
                    {
                      color: pathname.startsWith("/settings")
                        ? "#FFFFFF"
                        : isLight
                          ? brand.stone700
                          : brand.slate200,
                    },
                  ]}
                >
                  Settings
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View style={[styles.mobileAuth, { borderTopColor: isLight ? brand.stone100 : "rgba(255,255,255,0.05)" }]}>
            {!user ? (
              <View style={styles.mobileAuthRow}>
                <Pressable
                  onPress={() => {
                    setOpen(false);
                    router.push("/login");
                  }}
                  style={[
                    styles.mobileAuthBtn,
                    {
                      borderColor: isLight ? brand.stone200 : "rgba(255,255,255,0.10)",
                      backgroundColor: isLight ? brand.white : brand.slate900,
                    },
                  ]}
                >
                  <LogIn size={16} color={isLight ? brand.stone700 : brand.slate200} />
                  <Text style={[styles.mobileAuthText, { color: isLight ? brand.stone700 : brand.slate200 }]}>
                    Log in
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setOpen(false);
                    router.push("/signup");
                  }}
                  style={[styles.mobileAuthBtn, { backgroundColor: brand.emerald600, borderColor: brand.emerald600 }]}
                >
                  <UserPlus size={16} color="#FFFFFF" />
                  <Text style={[styles.mobileAuthText, { color: "#FFFFFF" }]}>Join free</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.mobileUser, { borderColor: isLight ? brand.stone200 : "rgba(255,255,255,0.10)", backgroundColor: isLight ? brand.white : brand.slate900 }]}>
                <Avatar
                  user={{
                    name: user.name,
                    avatarColor: (user as { avatarColor?: string }).avatarColor ?? "#16a34a",
                    avatarUrl: (user as { avatarUrl?: string }).avatarUrl,
                  }}
                  size={40}
                />
                <View style={styles.grow}>
                  <Text style={[styles.mobileUserName, { color: c.text }]} numberOfLines={1}>
                    {user.name}
                  </Text>
                  <Text style={[styles.mobileUserMeta, { color: c.textMuted }]}>
                    {isOwner ? "👑 Venue Owner" : `⚽ Player • ${user.level ?? "Rookie"}`}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setOpen(false);
                    void signOut().then(() => router.replace("/"));
                  }}
                  style={[styles.outBtn, { borderColor: isLight ? brand.red200 : "rgba(239,68,68,0.3)", backgroundColor: isLight ? brand.red50 : "rgba(239,68,68,0.10)" }]}
                >
                  <LogOut size={14} color={isLight ? brand.red500 : brand.red400} />
                  <Text style={[styles.outText, { color: isLight ? brand.red500 : brand.red400 }]}>Out</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: 1,
    zIndex: 50,
    // sticky top-0 — in RN the shell keeps this pinned above the scroll content
  },
  inner: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: space[4],
    maxWidth: 1280,
    width: "100%",
    alignSelf: "center",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  desktopNav: { flexDirection: "row", alignItems: "center", gap: space[1], flex: 1, justifyContent: "center" },
  desktopLink: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.full, paddingHorizontal: space[4], paddingVertical: space[2] },
  desktopLinkText: { fontSize: fontSize.base, fontWeight: "600" },
  ownerLink: { marginLeft: space[1], backgroundColor: brand.orange500 },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: brand.emerald500,
    // emerald-500 → green-700 gradient
    shadowColor: "#059669",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  brandText: { minWidth: 0 },
  wordmark: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.3,
    lineHeight: 18,
  },
  tagline: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 2.2,
    marginTop: 1,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: space[2] },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  authRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  loginBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    minHeight: 40,
  },
  loginText: { fontSize: fontSize.base, fontWeight: "700" },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    backgroundColor: brand.emerald600,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    minHeight: 40,
    shadowColor: "#059669",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  joinText: { fontSize: fontSize.base, fontWeight: "800", color: "#FFFFFF" },
  profileWrap: { position: "relative" },
  profileBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius.full,
    borderWidth: 1,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: space[3],
    minHeight: 40,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  profileMeta: { maxWidth: 120 },
  profileName: { fontSize: fontSize.sm, fontWeight: "800" },
  profileRole: { fontSize: 10, fontWeight: "500", marginTop: 1 },
  overlay: { position: "absolute", left: 0, right: 0, top: -8, bottom: -400, zIndex: 10 },
  dropdown: {
    position: "absolute",
    right: 0,
    top: 48,
    width: 240,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    overflow: "hidden",
    zIndex: 20,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  dropdownHead: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: 1,
  },
  dropdownName: { fontSize: fontSize.base, fontWeight: "800" },
  dropdownEmail: { fontSize: fontSize.sm },
  dropdownMeta: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 4 },
  dropdownList: { padding: space[1.5] },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2.5],
    borderRadius: radius.xl,
    paddingHorizontal: space[3],
    paddingVertical: space[2.5],
    minHeight: 40,
  },
  dropdownItemText: { fontSize: fontSize.base, fontWeight: "700" },
  mobileMenu: {
    borderTopWidth: 1,
    paddingHorizontal: space[4],
    paddingBottom: space[4],
    paddingTop: space[2],
  },
  mobileLinks: { gap: space[1] },
  mobileLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius.xl,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: 44,
  },
  mobileLinkText: { fontSize: fontSize.base, fontWeight: "700" },
  mobileAuth: { marginTop: space[3], paddingTop: space[3], borderTopWidth: 1 },
  mobileAuthRow: { flexDirection: "row", gap: space[2] },
  mobileAuthBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: space[3],
    minHeight: 44,
  },
  mobileAuthText: { fontSize: fontSize.base, fontWeight: "800" },
  mobileUser: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[3],
  },
  grow: { flex: 1, minWidth: 0 },
  mobileUserName: { fontSize: fontSize.base, fontWeight: "800" },
  mobileUserMeta: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 2 },
  outBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space[3.5],
    paddingVertical: space[2],
    minHeight: 36,
  },
  outText: { fontSize: fontSize.sm, fontWeight: "800" },
});
