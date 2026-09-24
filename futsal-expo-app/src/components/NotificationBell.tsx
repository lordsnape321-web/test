import { Bell, CheckCheck, ChevronRight } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { timeAgo } from "@/lib/time";
import { colors as brand, fontSize, radius, space } from "@/theme";

/**
 * NotificationBell — the navbar inbox control (web components/NotificationBell).
 *
 * Polls unread every 15s; tapping opens /notifications (RN has no popup menu
 * that matches the web dropdown on a phone, so the full list is one tap away).
 */
export function NotificationBell({ variant }: { variant?: "dark" | "light" }) {
  const { user, isOwner } = useAuth();
  const { colors: c, isDark } = useTheme();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<Array<{ id: number; title: string; message: string; isRead: boolean; createdAt: string | null }>>([]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const items = await fetchNotifications(user.id);
      setUnread(items.filter((n) => !n.isRead).length);
      setLatest(items.slice(0, 5));
    } catch {
      /* best-effort badge */
    }
  }, [user]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  async function markAll() {
    if (!user) return;
    await markAllNotificationsRead(user.id);
    await load();
  }

  async function openOne(id: number) {
    await markNotificationRead(id);
    await load();
    router.push(isOwner ? "/admin/notifications" : "/notifications");
  }

  const isDarkHeader = variant === "dark" || isDark;
  const btnBg = isDarkHeader ? brand.slate900 : brand.white;
  const btnBorder = isDarkHeader ? "rgba(255,255,255,0.10)" : brand.stone200;
  const btnFg = isDarkHeader ? brand.slate300 : brand.stone600;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => router.push(isOwner ? "/admin/notifications" : "/notifications")}
        style={[styles.btn, { backgroundColor: btnBg, borderColor: btnBorder }]}
        accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell size={20} color={btnFg} />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
          </View>
        ) : null}
      </Pressable>

      {/* Compact unread list — open shows the dedicated screen. */}
      {false ? (
        <View style={[styles.pop, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.popHead}>
            <Text style={[styles.popTitle, { color: c.text }]}>Notifications</Text>
            <Pressable onPress={() => void markAll()} style={styles.markAll}>
              <CheckCheck size={14} color={brand.emerald600} />
              <Text style={styles.markAllText}>Mark all read</Text>
            </Pressable>
          </View>
          {latest.map((n) => (
            <Pressable key={n.id} onPress={() => void openOne(n.id)} style={styles.popRow}>
              <View style={styles.grow}>
                <Text style={[styles.popMsg, { color: c.text }]} numberOfLines={1}>
                  {n.title}
                </Text>
                <Text style={[styles.popTime, { color: c.textFaint }]}>
                  {timeAgo(n.createdAt)}
                </Text>
              </View>
              <ChevronRight size={14} color={c.textFaint} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", zIndex: 40 },
  btn: {
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
  badge: {
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
  badgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  pop: {
    position: "absolute",
    right: 0,
    top: 48,
    width: 280,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[2],
    zIndex: 30,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  popHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[2],
    paddingVertical: space[2],
  },
  popTitle: { fontSize: fontSize.sm, fontWeight: "900" },
  markAll: { flexDirection: "row", alignItems: "center", gap: 4 },
  markAllText: { fontSize: fontSize.xs, fontWeight: "800", color: brand.emerald600 },
  popRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius.xl,
    paddingHorizontal: space[2.5],
    paddingVertical: space[2],
  },
  grow: { flex: 1, minWidth: 0 },
  popMsg: { fontSize: fontSize.sm, fontWeight: "700" },
  popTime: { fontSize: fontSize.xs, fontWeight: "600", marginTop: 1 },
});
