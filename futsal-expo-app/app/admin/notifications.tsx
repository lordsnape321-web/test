import { useRouter } from "expo-router";
import { Bell, CheckCheck, ChevronRight, Trash2 } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  deleteNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { timeAgo } from "@/lib/time";
import { colors, fontSize, radius, space } from "@/theme";
import type { AppNotification } from "@/lib/types";

const TYPE_STYLE: Record<string, { bg: string; fg: string }> = {
  booking_request: { bg: "rgba(245,158,11,0.15)", fg: "#B45309" },
  booking_confirmed: { bg: "rgba(16,185,129,0.15)", fg: "#047857" },
  booking_rejected: { bg: "rgba(239,68,68,0.15)", fg: "#DC2626" },
  booking_cancelled: { bg: "rgba(239,68,68,0.15)", fg: "#DC2626" },
  payment: { bg: "rgba(249,115,22,0.15)", fg: "#C2410C" },
  match_join: { bg: "rgba(14,165,233,0.15)", fg: "#0369A1" },
  free_play: { bg: "rgba(139,92,246,0.15)", fg: "#6D28D9" },
  review: { bg: "rgba(245,158,11,0.15)", fg: "#B45309" },
  info: { bg: "#F1F5F9", fg: "#475569" },
};

/** Owner Studio notifications — same markup/copy as the player page. */
export default function OwnerNotifications() {
  const { user } = useAuth();
  const { colors: c, isDark } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    const list = await fetchNotifications(user.id);
    setItems(list);
  }, [user]);

  useEffect(() => {
    (async () => {
      if (user) await load();
      setLoading(false);
    })();
  }, [user, load]);

  async function markAll() {
    if (!user) return;
    await markAllNotificationsRead(user.id);
    await load();
  }

  async function markOne(n: AppNotification) {
    await markNotificationRead(n.id);
    if (n.link) {
      const path = n.link.replace(/^https?:\/\/[^/]+/, "");
      if (path.startsWith("/")) {
        router.push(path as never);
        return;
      }
    }
    await load();
  }

  async function remove(id: number) {
    await deleteNotification(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  const unread = items.filter((x) => !x.isRead).length;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.headRow}>
        <View style={styles.grow}>
          <View style={styles.titleRow}>
            <Bell size={22} color={c.text} />
            <Text style={[styles.h1, { color: c.text }]}>Notifications</Text>
          </View>
          <Text style={[styles.sub, { color: c.textMuted }]}>
            {unread > 0 ? `${unread} unread updates` : "You're all caught up"} — requests,
            cancellations & payments.
          </Text>
        </View>
        {unread > 0 ? (
          <Pressable
            onPress={() => void markAll()}
            style={[styles.markAllBtn, { backgroundColor: isDark ? "#FFFFFF" : "#0F172A" }]}
          >
            <CheckCheck size={16} color={isDark ? "#0F172A" : "#FFFFFF"} />
            <Text style={[styles.markAllText, { color: isDark ? "#0F172A" : "#FFFFFF" }]}>
              Mark all read
            </Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={c.textFaint} style={{ marginTop: space[8] }} />
      ) : items.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Bell size={40} color={c.textFaint} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>No notifications</Text>
          <Text style={[styles.emptyBody, { color: c.textMuted }]}>
            New booking requests from players will land here instantly.
          </Text>
        </View>
      ) : (
        items.map((n) => {
          const tone = TYPE_STYLE[n.type] ?? TYPE_STYLE.info!;
          return (
            <View
              key={n.id}
              style={[
                styles.card,
                {
                  backgroundColor: c.surface,
                  borderColor: n.isRead ? c.border : c.text,
                  borderWidth: n.isRead ? 1 : 1.5,
                },
              ]}
            >
              <View style={[styles.typeChip, { backgroundColor: tone.bg }]}>
                <Text style={[styles.typeText, { color: tone.fg }]}>
                  {n.type.replace(/_/g, " ")}
                </Text>
              </View>
              <Pressable onPress={() => void markOne(n)} style={styles.grow}>
                <Text style={[styles.title, { color: c.text }]}>
                  {n.isRead ? "" : "● "}
                  {n.title}
                </Text>
                {n.message ? (
                  <Text style={[styles.message, { color: c.textMuted }]}>{n.message}</Text>
                ) : null}
                <View style={styles.metaRow}>
                  <Text style={[styles.meta, { color: c.textFaint }]}>
                    {timeAgo(n.createdAt)}
                  </Text>
                  {n.link ? (
                    <View style={styles.openRow}>
                      <Text style={[styles.openText, { color: colors.orange500 }]}>• Open</Text>
                      <ChevronRight size={12} color={colors.orange500} />
                    </View>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                onPress={() => void remove(n.id)}
                style={styles.deleteBtn}
                accessibilityLabel="Delete"
              >
                <Trash2 size={16} color={c.textFaint} />
              </Pressable>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space[4], paddingBottom: space[16], gap: space[2.5] },
  headRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space[3],
  },
  grow: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  h1: { fontSize: fontSize["2xl"], fontWeight: "900" },
  sub: { fontSize: fontSize.sm, marginTop: space[1] },
  markAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.xl,
    paddingHorizontal: space[4],
    paddingVertical: space[2.5],
    minHeight: 40,
  },
  markAllText: { fontSize: fontSize.xs, fontWeight: "900" },
  emptyCard: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[10],
    alignItems: "center",
    marginTop: space[4],
  },
  emptyTitle: { marginTop: space[3], fontSize: fontSize.lg, fontWeight: "800" },
  emptyBody: { marginTop: space[1], fontSize: fontSize.sm, textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
  },
  typeChip: {
    borderRadius: radius.lg,
    paddingHorizontal: space[2.5],
    paddingVertical: space[1.5],
    marginTop: 2,
  },
  typeText: { fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  title: { fontSize: fontSize.sm, fontWeight: "800", lineHeight: 19 },
  message: { fontSize: 13, lineHeight: 19, marginTop: space[1] },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], marginTop: space[1.5] },
  meta: { fontSize: 11, fontWeight: "700" },
  openRow: { flexDirection: "row", alignItems: "center", gap: 1 },
  openText: { fontSize: 11, fontWeight: "900" },
  deleteBtn: { padding: space[1.5], minHeight: 36, minWidth: 36, alignItems: "center", justifyContent: "center" },
});
