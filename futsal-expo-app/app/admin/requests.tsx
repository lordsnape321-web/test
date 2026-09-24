import { useFocusEffect } from "expo-router";
import {
  Check,
  Globe,
  Gift,
  Inbox,
  Lock,
  Phone,
  ReceiptText,
  Shield,
  Swords,
  Ticket,
  Wallet,
  X,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchBookings, fetchVenues, patchBooking } from "@/api";
import { PlayerRatingBadge } from "@/components/PlayerRating";
import { ReceiptViewer } from "@/components/ReceiptUploader";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import { useBreakpoints } from "@/lib/responsive";
import type { Booking } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Booking requests — pending vs decided tabs, full card rows with every chip
 * from the web admin/requests page, Accept / Decline (confirm → Alert).
 */
export default function OwnerRequests() {
  const { user } = useAuth();
  const { colors: c, isDark } = useTheme();
  const { sm } = useBreakpoints();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [venues, setVenues] = useState<Array<{ id: number; ownerId: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [viewReceipt, setViewReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [b, v] = await Promise.all([fetchBookings(), fetchVenues()]);
    setBookings(b);
    setVenues(v.map((x) => ({ id: x.id, ownerId: x.ownerId ?? null })));
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          await load();
        } finally {
          setLoading(false);
        }
      })();
    }, [load]),
  );

  const myVenueIds = useMemo(
    () => new Set(venues.filter((v) => user && v.ownerId === user.id).map((v) => v.id)),
    [venues, user],
  );
  const mine = useMemo(
    () => bookings.filter((b) => b.venue && myVenueIds.has(b.venue.id)),
    [bookings, myVenueIds],
  );
  const pending = mine.filter((b) => b.status === "pending");
  const decided = mine.filter((b) => b.status === "confirmed" || b.status === "rejected");
  const list = tab === "pending" ? pending : decided;

  function decide(id: number, ok: boolean) {
    if (!ok) {
      Alert.alert(
        "Decline this booking request?",
        "The player will be notified.",
        [
          { text: "Keep pending", style: "cancel" },
          {
            text: "Decline",
            style: "destructive",
            onPress: () => {
              void runDecide(id, false);
            },
          },
        ],
      );
      return;
    }
    void runDecide(id, true);
  }

  async function runDecide(id: number, ok: boolean) {
    setActing(id);
    try {
      await patchBooking(id, {
        status: ok ? "confirmed" : "rejected",
        actor: "owner",
        actorId: user?.id,
      });
      await load();
    } catch {
      Alert.alert("Something went wrong", "Try again in a moment.");
    } finally {
      setActing(null);
    }
  }

  const statusBg = (b: Booking) =>
    b.status === "pending"
      ? "rgba(245,158,11,0.15)"
      : b.status === "confirmed"
        ? "rgba(16,185,129,0.15)"
        : "rgba(239,68,68,0.15)";
  const statusFg = (b: Booking) =>
    b.status === "pending" ? "#B45309" : b.status === "confirmed" ? "#047857" : "#DC2626";

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.headRow}>
        <View style={styles.grow}>
          <View style={styles.titleRow}>
            <Inbox size={22} color={c.text} />
            <Text style={[styles.h1, { color: c.text }]}>Booking requests</Text>
            {pending.length > 0 ? (
              <View style={styles.waitBadge}>
                <Text style={styles.waitBadgeText}>{pending.length} waiting</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.sub, { color: c.textMuted }]}>
            Accept to confirm the slot (public match goes live) or decline to free it up.
          </Text>
        </View>
      </View>

      <View style={[styles.tabRow, { backgroundColor: c.surface, borderColor: c.border }]}>
        {(["pending", "decided"] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[
              styles.tabBtn,
              tab === t
                ? { backgroundColor: isDark ? "#FFFFFF" : "#0F172A" }
                : { backgroundColor: "transparent" },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                tab === t ? { color: isDark ? "#0F172A" : "#FFFFFF" } : { color: c.textMuted },
              ]}
            >
              {t === "pending" ? `Pending (${pending.length})` : `Decided (${decided.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={c.textFaint} style={{ marginTop: space[8] }} />
      ) : list.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Inbox size={40} color={c.textFaint} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>
            {tab === "pending" ? "Inbox zero 🎉" : "Nothing decided yet"}
          </Text>
          <Text style={[styles.emptyBody, { color: c.textMuted }]}>
            {tab === "pending"
              ? "When players book your courts, requests land here for approval."
              : "Accepted and declined requests will show up here."}
          </Text>
        </View>
      ) : (
        list.map((b) => (
          <View
            key={b.id}
            style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <View style={styles.cardBody}>
              <View style={[styles.requestMain, !sm && styles.requestMainNarrow]}>
                {b.venue?.imageUrl ? (
                  <Image
                    source={{ uri: b.venue.imageUrl }}
                    style={[styles.cardImg, !sm && styles.cardImgNarrow]}
                  />
                ) : (
                  <View
                    style={[
                      styles.cardImg,
                      !sm && styles.cardImgNarrow,
                      { backgroundColor: c.border },
                    ]}
                  />
                )}
                <View style={[styles.requestInfo, !sm && styles.requestInfoNarrow]}>
                <View style={styles.chipRow}>
                  <Text style={[styles.mono, { color: c.textFaint }]}>#FN-{b.id}</Text>
                  <View style={[styles.chip, { backgroundColor: statusBg(b) }]}>
                    <Text style={[styles.chipText, { color: statusFg(b) }]}>{b.status}</Text>
                  </View>
                  {b.competition ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(99,102,241,0.15)" }]}>
                      <Swords size={10} color="#4338CA" />
                      <Text style={[styles.chipText, { color: "#4338CA" }]}>
                        Competition • you score it
                      </Text>
                    </View>
                  ) : b.visibility === "public" ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(14,165,233,0.15)" }]}>
                      <Globe size={10} color="#0369A1" />
                      <Text style={[styles.chipText, { color: "#0369A1" }]}>
                        Public • 👥{b.ourCrew ?? 0} + 🙋{b.openSpots ?? 0}
                      </Text>
                    </View>
                  ) : (
                    <View style={[styles.chip, { backgroundColor: isDark ? "#1E293B" : "#F1F5F9" }]}>
                      <Lock size={10} color={c.textMuted} />
                      <Text style={[styles.chipText, { color: c.textMuted }]}>Private</Text>
                    </View>
                  )}
                </View>

                <View style={styles.nameRow}>
                  <Text style={[styles.name, { color: c.text }]}>
                    {b.bookerName || "Player"} — {b.venue?.name}
                  </Text>
                  {b.playerStats ? <PlayerRatingBadge stats={b.playerStats} /> : null}
                </View>

                <View style={styles.chipRow}>
                  {b.isFreePlay ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(139,92,246,0.15)" }]}>
                      <Gift size={10} color="#6D28D9" />
                      <Text style={[styles.chipText, { color: "#6D28D9" }]}>FREE HOUR 🎁</Text>
                    </View>
                  ) : null}
                  {b.promoCode && (b.discountAmount ?? 0) > 0 ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(16,185,129,0.15)" }]}>
                      <Ticket size={10} color="#047857" />
                      <Text style={[styles.chipText, { color: "#047857" }]}>
                        {b.promoCode} −{formatNPR(b.discountAmount ?? 0)}
                      </Text>
                    </View>
                  ) : null}
                  {b.teamName ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(14,165,233,0.15)" }]}>
                      <Shield size={10} color="#0369A1" />
                      <Text style={[styles.chipText, { color: "#0369A1" }]}>{b.teamName}</Text>
                    </View>
                  ) : null}
                  {b.competition ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(99,102,241,0.15)" }]}>
                      <Text style={[styles.chipText, { color: "#4338CA" }]}>
                        🆚 vs {b.competition.opponentName || "opponent"}
                        {b.competition.leagueName ? ` • 🏆 ${b.competition.leagueName}` : ""}
                      </Text>
                    </View>
                  ) : null}
                  {b.depositRequired ? (
                    <View
                      style={[
                        styles.chip,
                        {
                          backgroundColor:
                            b.depositStatus === "paid"
                              ? "rgba(16,185,129,0.15)"
                              : b.depositStatus === "forfeited"
                                ? "rgba(239,68,68,0.15)"
                                : "rgba(245,158,11,0.15)",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color:
                              b.depositStatus === "paid"
                                ? "#047857"
                                : b.depositStatus === "forfeited"
                                  ? "#DC2626"
                                  : "#B45309",
                          },
                        ]}
                      >
                        🛡️ {formatNPR(b.depositAmount ?? 0)} • {b.depositStatus}
                      </Text>
                    </View>
                  ) : null}
                  {b.paymentStatus === "paid" || b.paymentStatus === "deposit_paid" ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(14,165,233,0.15)" }]}>
                      <Text style={[styles.chipText, { color: "#0369A1" }]}>
                        ✓ {b.paymentMethod} verified
                        {b.gatewayTxnId ? ` • ${b.gatewayTxnId.slice(0, 12)}` : ""}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Text style={[styles.meta, { color: c.textMuted }]}>
                  {b.court?.name} ({b.court && "format" in b.court ? (b.court as { format?: string }).format ?? "" : ""}) •{" "}
                  {prettyDate(b.date)} • {formatTime12(b.startTime)} –{" "}
                  {formatTime12(b.endTime || b.startTime)} • {b.durationHours} hr
                </Text>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Phone size={12} color={c.textFaint} />
                    <Text style={[styles.metaSmall, { color: c.textMuted }]}>
                      {b.bookerPhone || "—"}
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Wallet size={12} color={c.textFaint} />
                    <Text style={[styles.metaSmall, { color: c.textMuted }]}>
                      {b.paymentMethod} • {b.paymentStatus}
                    </Text>
                  </View>
                  {b.receiptUrl ? (
                    <Pressable
                      onPress={() => setViewReceipt(b.receiptUrl ?? "")}
                      style={[styles.chip, { backgroundColor: "rgba(16,185,129,0.15)" }]}
                    >
                      <ReceiptText size={10} color="#047857" />
                      <Text style={[styles.chipText, { color: "#047857" }]}>View receipt 🧾</Text>
                    </Pressable>
                  ) : b.paymentMethod !== "Cash at Venue" ? (
                    <Text style={[styles.metaSmall, { color: c.textFaint }]}>No receipt yet</Text>
                  ) : null}
                  {b.notes ? (
                    <Text style={[styles.notes, { color: c.textMuted }]}>“{b.notes}”</Text>
                  ) : null}
                </View>
              </View>
            </View>

              <View
                style={[
                  styles.cardFooter,
                  { borderTopColor: c.border },
                ]}
              >
                <View style={styles.priceCol}>
                  {(b.discountAmount ?? 0) > 0 && (b.priceBeforeDiscount ?? 0) > b.totalPrice ? (
                    <Text style={[styles.strike, { color: c.textFaint }]}>
                      {formatNPR(b.priceBeforeDiscount ?? 0)}
                    </Text>
                  ) : null}
                  <Text style={[styles.price, { color: c.text }]}>{formatNPR(b.totalPrice)}</Text>
                </View>
                {tab === "pending" ? (
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => decide(b.id, true)}
                      disabled={acting === b.id}
                      style={[styles.acceptBtn, { opacity: acting === b.id ? 0.5 : 1 }]}
                    >
                      <Check size={14} color="#FFFFFF" strokeWidth={3} />
                      <Text style={styles.acceptText}>{acting === b.id ? "…" : "Accept"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => decide(b.id, false)}
                      disabled={acting === b.id}
                      style={[
                        styles.declineBtn,
                        {
                          opacity: acting === b.id ? 0.5 : 1,
                          backgroundColor: isDark ? "rgba(239,68,68,0.15)" : "#FEF2F2",
                          borderColor: isDark ? "rgba(248,113,113,0.35)" : "#FECACA",
                        },
                      ]}
                    >
                      <X size={14} color="#DC2626" strokeWidth={3} />
                      <Text style={styles.declineText}>Decline</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={[styles.metaSmall, { color: c.textFaint }]}>
                    {b.createdAt ? new Date(b.createdAt).toLocaleDateString() : ""}
                  </Text>
                )}
              </View>
            </View>
          </View>
        ))
      )}

      {viewReceipt ? (
        <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt(null)} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space[4], paddingBottom: space[16], gap: space[3] },
  headRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  grow: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  h1: { fontSize: fontSize["2xl"], fontWeight: "900" },
  waitBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.orange500,
    paddingHorizontal: space[2.5],
    paddingVertical: space[1],
  },
  waitBadgeText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
  sub: { fontSize: fontSize.sm, marginTop: space[1] },
  tabRow: {
    flexDirection: "row",
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space[1],
    alignSelf: "flex-start",
  },
  tabBtn: { borderRadius: radius.lg, paddingHorizontal: space[4], paddingVertical: space[2] },
  tabText: { fontSize: fontSize.xs, fontWeight: "900", textTransform: "uppercase" },
  emptyCard: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[10],
    alignItems: "center",
  },
  emptyTitle: { marginTop: space[3], fontSize: fontSize.lg, fontWeight: "800" },
  emptyBody: { marginTop: space[1], fontSize: fontSize.sm, textAlign: "center" },
  card: { borderRadius: radius["2xl"], borderWidth: 1, overflow: "hidden" },
  cardBody: { gap: space[4], padding: space[4] },
  requestMain: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: space[4],
  },
  requestMainNarrow: { flexDirection: "column" },
  requestInfo: { flexGrow: 1, flexBasis: 220, minWidth: 0 },
  requestInfoNarrow: { width: "100%", flexBasis: "auto" },
  cardImg: { width: 144, height: 96, flexShrink: 0, borderRadius: radius.xl },
  cardImgNarrow: { width: "100%", height: 112 },

  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  mono: { fontFamily: "monospace", fontSize: fontSize.xs, fontWeight: "700" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.full,
    paddingHorizontal: space[2.5],
    paddingVertical: space[1],
  },
  chipText: { fontSize: 10, fontWeight: "900" },
  nameRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  name: { fontSize: fontSize.base, fontWeight: "800", flex: 1, minWidth: 120 },
  meta: { fontSize: 13, fontWeight: "600", marginTop: space[1] },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[3],
    marginTop: space[1.5],
  },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaSmall: { fontSize: fontSize.xs, fontWeight: "600" },
  notes: { fontSize: fontSize.xs, fontStyle: "italic" },
  cardFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    borderTopWidth: 1,
    paddingTop: space[3],
  },
  priceCol: { alignItems: "flex-end", flexShrink: 0 },

  strike: { fontSize: fontSize.xs, textDecorationLine: "line-through", fontWeight: "700" },
  price: { fontSize: fontSize.xl, fontWeight: "900" },
  actionRow: { flexDirection: "row", gap: space[2] },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.xl,
    backgroundColor: colors.emerald600,
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
    minHeight: 40,
  },
  acceptText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
  declineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
    minHeight: 40,
  },
  declineText: { color: "#DC2626", fontSize: fontSize.xs, fontWeight: "900" },
});
