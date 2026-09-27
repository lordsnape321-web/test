import { useRouter } from "expo-router";
import { Bell, CheckCheck } from "lucide-react-native";
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
import { SwipeNotificationRow } from "@/components/SwipeNotificationRow";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
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

const DARK_TYPE_TEXT: Record<string, string> = {
  booking_request: "#FCD34D",
  booking_confirmed: "#6EE7B7",
  booking_rejected: "#FCA5A5",
  booking_cancelled: "#FCA5A5",
  payment: "#FDBA74",
  match_join: "#7DD3FC",
  free_play: "#C4B5FD",
  review: "#FCD34D",
  info: "#CBD5E1",
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
    try {
      setItems(await fetchNotifications(user.id));
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

  // Owner notifications stay live while this screen is open so payment
  // requests and verified advances appear without manual refresh.
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [user, load]);

  async function markAll() {
    if (!user) return;
    try {
      await markAllNotificationsRead(user.id);
      await load();
    } catch {
      /* keep the inbox visible if the API is temporarily unavailable */
    }
  }

  async function markOne(n: AppNotification) {
    // Opening remains available if the read mutation is temporarily unavailable,
    // but the local read state only changes after the database confirms it.
    let persistedRead = false;
    try {
      await markNotificationRead(n.id);
      persistedRead = true;
    } catch {
      // Continue to the destination without pretending the read state was saved.
    }
    if (persistedRead) {
      setItems((prev) => prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item)));
    }
    const destination = ownerNotificationDestination(n.link);
    if (destination) {
      try {
        router.push(destination);
      } catch {
        await load();
      }
      return;
    }
    await load();
  }

  /** Keep notification deep links inside the Owner Studio route tree. */
  function ownerNotificationDestination(link: string | null):
    | "/admin/bookings"
    | "/admin/requests"
    | "/admin/leagues"
    | `/admin/leagues/${string}`
    | "/admin/notifications"
    | "/admin/venues"
    | null {
    if (!link) return null;
    // Links come from the API and may be a player path, an Owner Studio path,
    // or an absolute web URL. Strip host/query/hash before mapping them so an
    // alert can never accidentally send an owner through the player shell.
    let path = link.replace(/^https?:\/\/[^/]+/, "");
    path = path.split(/[?#]/, 1)[0] || "/";
    try {
      path = decodeURIComponent(path);
    } catch {
      // Keep the original path if a legacy payload contains malformed encoding.
    }
    if (!path.startsWith("/")) path = `/${path}`;
    if (path.startsWith("/admin/leagues/")) {
      const leagueId = path.slice("/admin/leagues/".length).split("/")[0];
      return leagueId ? `/admin/leagues/${leagueId}` : "/admin/leagues";
    }
    if (path === "/admin/leagues" || path.startsWith("/admin/leagues/")) return "/admin/leagues";
    if (path.startsWith("/leagues/")) {
      const leagueId = path.slice("/leagues/".length).split("/")[0];
      return leagueId ? `/admin/leagues/${leagueId}` : "/admin/leagues";
    }
    if (path === "/leagues" || path.startsWith("/leagues/")) return "/admin/leagues";
    if (path.startsWith("/admin/requests") || path.startsWith("/request")) {
      return "/admin/requests";
    }
    if (path.startsWith("/admin/booking") || path.startsWith("/booking") || path.startsWith("/bookings")) {
      return "/admin/bookings";
    }
    if (path.startsWith("/admin/venue") || path.startsWith("/venue") || path.startsWith("/venues")) {
      return "/admin/venues";
    }
    if (path.startsWith("/admin/notification") || path.startsWith("/notification")) {
      return "/admin/notifications";
    }
    return null;
  }

  async function markReadOnly(n: AppNotification) {
    if (n.isRead) return;
    try {
      await markNotificationRead(n.id);
      setItems((prev) => prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item)));
    } catch {
      await load();
    }
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
        <Pressable
          onPress={() => void markAll()}
          disabled={unread === 0}
          style={[
            styles.markAllBtn,
            {
              backgroundColor: isDark ? "#FFFFFF" : "#0F172A",
              opacity: unread === 0 ? 0.45 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: unread === 0 }}
        >
          <CheckCheck size={16} color={isDark ? "#0F172A" : "#FFFFFF"} />
          <Text style={[styles.markAllText, { color: isDark ? "#0F172A" : "#FFFFFF" }]}>Mark all read</Text>
        </Pressable>
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
          const toneBg = n.type === "info" && isDark ? "rgba(148,163,184,0.14)" : tone.bg;
          const toneFg = isDark ? DARK_TYPE_TEXT[n.type] ?? c.textMuted : tone.fg;
          return (
            <SwipeNotificationRow
              key={n.id}
              notification={n}
              badge={{ bg: toneBg, text: toneFg }}
              owner
              onOpen={(item) => void markOne(item)}
              onRead={(item) => void markReadOnly(item)}
              onDelete={(id) => void remove(id)}
            />
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
  typeColumn: { width: 96, flexShrink: 0 },
  contentColumn: { flex: 1, minWidth: 0 },
  typeChip: {
    width: "100%",
    minHeight: 32,
    justifyContent: "center",
    borderRadius: radius.lg,
    paddingHorizontal: space[2],
    paddingVertical: space[1.5],
  },
  typeText: { fontSize: 9, lineHeight: 12, fontWeight: "900", textTransform: "uppercase", textAlign: "center" },
  title: { fontSize: fontSize.sm, fontWeight: "800", lineHeight: 19 },
  message: { fontSize: 13, lineHeight: 19, marginTop: space[1] },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], marginTop: space[1.5] },
  meta: { fontSize: 11, fontWeight: "700" },
  openRow: { flexDirection: "row", alignItems: "center", gap: 1 },
  openText: { fontSize: 11, fontWeight: "900" },

});
