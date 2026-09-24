import { useRouter } from "expo-router";
import { Bell, CheckCheck, ChevronRight, Heart, LogIn, Trash2 } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { deleteNotification, fetchNotifications, markAllNotificationsRead, markNotificationRead } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { timeAgo } from "@/lib/time";
import type { AppNotification } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Notifications — a port of the web app's app/notifications/page.tsx.
 *
 * Same copy, same type badges, same read/unread treatment, same three actions
 * (mark all read, open one and follow its link, delete one). The web "turf-pattern"
 * backdrop and hover states have no native equivalent, so the list renders on the
 * plain theme background and the row press is the only interaction affordance.
 */

type Badge = { bg: string; text: string };

/**
 * Per-type badge colours, transcribed from the web TYPE_STYLE class map. Light
 * values are the *-100 fill / *-700 text pairs; dark values are the translucent
 * *-500/15 fill over the *-300 text the web uses under `.dark`.
 */
function badgeFor(type: string, isDark: boolean): Badge {
  switch (type) {
    case "booking_confirmed":
    case "team":
      return isDark
        ? { bg: "rgba(16,185,129,0.15)", text: colors.emerald300 }
        : { bg: colors.emerald100, text: colors.emerald700 };
    case "booking_rejected":
    case "booking_cancelled":
      return isDark
        ? { bg: "rgba(239,68,68,0.15)", text: colors.red400 }
        : { bg: colors.red100, text: colors.red600 };
    case "payment":
      return isDark
        ? { bg: "rgba(249,115,22,0.15)", text: colors.orange300 }
        : { bg: colors.orange100, text: colors.orange700 };
    case "match_join":
      return isDark
        ? { bg: "rgba(14,165,233,0.15)", text: colors.sky300 }
        : { bg: colors.sky100, text: colors.sky700 };
    case "free_play":
      return isDark
        ? { bg: "rgba(139,92,246,0.15)", text: colors.violet300 }
        : { bg: "rgba(139,92,246,0.15)", text: colors.violet700 };
    case "booking_request":
    case "review":
      return isDark
        ? { bg: "rgba(245,158,11,0.15)", text: colors.amber300 }
        : { bg: "#FEF3C7", text: "#B45309" };
    case "info":
    default:
      return isDark
        ? { bg: "rgba(255,255,255,0.10)", text: colors.slate300 }
        : { bg: colors.stone200, text: colors.stone600 };
  }
}

/**
 * Notification links are server-generated web paths. The native route tree
 * exposes the same plural venue URL, so shared links can be pushed unchanged.
 */
function normalizeLink(link: string): string {
  return link;
}

export default function NotificationsScreen() {
  const { colors: c, isDark } = useTheme();
  const { user, ready } = useAuth();
  const router = useRouter();

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const list = await fetchNotifications(user.id);
      setItems(list);
    } catch {
      setItems([]);
    }
  }, [user]);

  useEffect(() => {
    (async () => {
      if (user) await load();
      setLoading(false);
    })();
  }, [user, load]);

  useEffect(() => {
    if (ready && user?.role === "owner") router.replace("/admin/notifications");
  }, [ready, user, router]);

  async function markAll() {
    if (!user) return;
    await markAllNotificationsRead(user.id);
    load();
  }

  async function openOne(n: AppNotification) {
    await markNotificationRead(n.id);
    if (n.link) {
      try {
        router.push(normalizeLink(n.link) as never);
      } catch {
        load();
      }
    } else {
      load();
    }
  }

  async function remove(id: number) {
    await deleteNotification(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  // Defensive boundary for direct/deep links. The root shell also redirects
  // owners, but this screen must never render player notifications while that
  // redirect is being committed.
  if (ready && user?.role === "owner") {
    return (
      <SafeAreaView style={[styles.flex, styles.center, { backgroundColor: c.bg }]} edges={["top"]}>
        <ActivityIndicator size="large" color={c.textFaint} />
      </SafeAreaView>
    );
  }

  // Signed-out state: the web page shows a "your letters await" card. Reachable
  // only by deep link in the app, but ported for parity. Gate on `ready` so a
  // signed-in user isn't flashed this card during the cold-start profile fetch.
  if (ready && !user) {
    return (
      <SafeAreaView style={[styles.flex, styles.center, { backgroundColor: c.bg }]} edges={["top"]}>
        <View style={[styles.signedOutCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.signedOutIcon, { backgroundColor: colors.orange100 }]}>
            <Bell size={32} color={colors.orange500} />
          </View>
          <Text style={[styles.signedOutTitle, { color: c.text }]}>Your letters await 💌</Text>
          <Text style={[styles.signedOutBody, { color: c.textMuted }]}>
            Game confirmations, friend joins and little surprises land here.
          </Text>
          <View style={styles.signedOutActions}>
            <Pressable
              onPress={() => router.push("/login")}
              style={[styles.signedOutBtn, { backgroundColor: colors.emerald600 }]}
            >
              <LogIn size={16} color="#FFFFFF" />
              <Text style={styles.signedOutBtnText}>Log in</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push("/signup")}
              style={[styles.signedOutBtn, { borderColor: c.border }]}
            >
              <Text style={[styles.signedOutBtnText, { color: c.text }]}>Join free</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const unread = items.filter((x) => !x.isRead).length;

  const header = (
    <View style={styles.headerRow}>
      <View style={styles.grow}>
        <View style={styles.eyebrowRow}>
          <Heart size={14} color={colors.orange500} />
          <Text style={styles.eyebrow}>Little notes for you</Text>
        </View>
        <Text style={[styles.h1, { color: c.text }]}>
          Updates
          {unread > 0 ? (
            <Text style={styles.freshCount}>  ({unread} fresh)</Text>
          ) : null}
        </Text>
      </View>
      <Pressable
        onPress={() => void markAll()}
        disabled={unread === 0}
        style={[
          styles.catchUpBtn,
          {
            borderColor: c.border,
            backgroundColor: c.surface,
            opacity: unread === 0 ? 0.45 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Mark all notifications as read"
        accessibilityState={{ disabled: unread === 0 }}
      >
        <CheckCheck size={16} color={c.text} />
        <Text style={[styles.catchUpText, { color: c.text }]}>Mark all read</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top"]}>
      <FlatList
        data={items}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? (
            <View style={styles.skeletonWrap}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.skeleton, { backgroundColor: c.surface }]} />
              ))}
            </View>
          ) : (
            <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Bell size={40} color={c.textFaint} />
              <Text style={[styles.emptyTitle, { color: c.text }]}>All quiet, all good 🎉</Text>
              <Text style={[styles.emptyBody, { color: c.textMuted }]}>
                Book a court or join a game — little joys will pop up here.
              </Text>
              <Pressable
                onPress={() => router.push("/venues")}
                style={[styles.emptyBtn, { backgroundColor: colors.emerald600 }]}
              >
                <Text style={styles.emptyBtnText}>Find a court</Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item: n }) => {
          const badge = badgeFor(n.type, isDark);
          return (
            <View
              style={[
                styles.noteRow,
                n.isRead
                  ? { backgroundColor: c.surface, borderColor: c.border }
                  : {
                      backgroundColor: isDark ? "rgba(16,185,129,0.14)" : colors.emerald50,
                      borderColor: isDark ? "rgba(110,231,183,0.45)" : colors.emerald300,
                    },
              ]}
            >
              <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.badgeText, { color: badge.text }]}>
                  {n.isRead ? "" : "● "}
                  {n.type.replace(/_/g, " ")}
                </Text>
              </View>

              <Pressable style={styles.grow} onPress={() => void openOne(n)}>
                <Text style={[styles.noteTitle, { color: c.text }]}>{n.title}</Text>
                {n.message ? (
                  <Text style={[styles.noteMessage, { color: c.textMuted }]}>{n.message}</Text>
                ) : null}
                <View style={styles.noteMetaRow}>
                  <Text style={[styles.noteMeta, { color: c.textFaint }]}>{timeAgo(n.createdAt)}</Text>
                  {n.link ? (
                    <View style={styles.lookRow}>
                      <Text style={styles.lookText}>• Have a look</Text>
                      <ChevronRight size={12} color={colors.emerald600} />
                    </View>
                  ) : null}
                </View>
              </Pressable>

              <Pressable
                onPress={() => void remove(n.id)}
                accessibilityRole="button"
                accessibilityLabel="Delete notification"
                style={styles.deleteBtn}
              >
                <Trash2 size={16} color={c.textFaint} />
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: space[4] },

  /* Signed-out card */
  signedOutCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[8],
    alignItems: "center",
  },
  signedOutIcon: {
    width: 64,
    height: 64,
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  signedOutTitle: { fontSize: fontSize["2xl"], fontWeight: "900", marginTop: space[4], textAlign: "center" },
  signedOutBody: { fontSize: fontSize.base, marginTop: space[2], textAlign: "center" },
  signedOutActions: { flexDirection: "row", gap: space[2], marginTop: space[6], alignSelf: "stretch" },
  signedOutBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: "transparent",
    paddingVertical: space[3],
  },
  signedOutBtnText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },

  /* Header */
  listContent: { padding: space[4], paddingBottom: space[12], gap: space[2.5] },
  headerRow: { flexDirection: "row", alignItems: "flex-end", gap: space[3], marginBottom: space[2] },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
    color: colors.orange500,
  },
  h1: { fontSize: fontSize["3xl"], fontWeight: "900", marginTop: 2 },
  freshCount: { fontSize: fontSize.xl, color: colors.orange500 },
  catchUpBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  catchUpText: { fontSize: fontSize.xs, fontWeight: "900" },

  /* Loading + empty */
  skeletonWrap: { gap: space[2.5] },
  skeleton: { height: 80, borderRadius: radius["2xl"] },
  emptyCard: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[12],
    alignItems: "center",
  },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: "800", marginTop: space[3], textAlign: "center" },
  emptyBody: { fontSize: fontSize.base, marginTop: space[1], textAlign: "center" },
  emptyBtn: {
    marginTop: space[4],
    borderRadius: radius["2xl"],
    backgroundColor: colors.emerald600,
    paddingHorizontal: space[6],
    paddingVertical: space[3],
  },
  emptyBtnText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },

  /* Note row */
  noteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
  },
  badge: { borderRadius: radius.xl, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { fontSize: fontSize["2xs"], fontWeight: "900", textTransform: "uppercase" },
  noteTitle: { fontSize: fontSize.base, fontWeight: "800", lineHeight: 19 },
  noteMessage: { fontSize: 13, lineHeight: 19, marginTop: space[1] },
  noteMetaRow: { flexDirection: "row", alignItems: "center", gap: space[1], marginTop: 6 },
  noteMeta: { fontSize: fontSize.xs, fontWeight: "700" },
  lookRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  lookText: { fontSize: fontSize.xs, fontWeight: "700", color: colors.emerald600 },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
});
