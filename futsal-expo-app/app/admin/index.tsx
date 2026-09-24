import { useFocusEffect, useRouter } from "expo-router";
import {
  ArrowRight,
  Banknote,
  Building2,
  CalendarCheck,
  Check,
  Clock,
  Inbox,
  Swords,
  Trophy,
  X,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchBookings, fetchVenues, patchBooking } from "@/api";
import {
  BookingDonut,
  PaymentParty,
  PeakHours,
  RevenueRainbow,
} from "@/components/OwnerCharts";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import type { Booking, Venue } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Owner Studio overview — KPI cards, awaiting-approval preview, four charts,
 * venues strip, and the league/score-desk entry points (admin/page.tsx).
 */
export default function OwnerHome() {
  const { user } = useAuth();
  const { colors: c, isDark } = useTheme();
  const router = useRouter();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [v, b] = await Promise.all([fetchVenues(), fetchBookings({ refresh: true })]);
    setVenues(v);
    setBookings(b);
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

  const myVenues = useMemo(
    () => venues.filter((v) => user && v.ownerId === user.id),
    [venues, user],
  );
  const myVenueIds = useMemo(() => new Set(myVenues.map((v) => v.id)), [myVenues]);
  const myBookings = useMemo(
    () =>
      bookings
        .filter((b) => b.venue && myVenueIds.has(b.venue.id))
        .filter(
          (b) =>
            b.visibility !== "competition" ||
            b.competition?.competitionStatus === "accepted" ||
            !b.competition?.competitionStatus ||
            b.competition.competitionStatus === "none",
        ),
    [bookings, myVenueIds],
  );

  const pending = myBookings.filter((b) => b.status === "pending");
  const confirmed = myBookings.filter((b) => b.status === "confirmed");
  const revenue = myBookings
    .filter((b) => b.status === "confirmed" || b.status === "completed")
    .reduce((s, b) => s + b.totalPrice, 0);
  const today = new Date().toISOString().slice(0, 10);
  const todaysGames = myBookings.filter(
    (b) => b.date === today && (b.status === "confirmed" || b.status === "pending"),
  );
  const myCourts = myVenues.flatMap((v) => v.courts ?? []);
  const awaitingScores = myBookings.filter(
    (b) =>
      b.visibility === "competition" &&
      b.competition &&
      b.competition.competitionStatus !== "pending" &&
      b.competition.competitionStatus !== "declined" &&
      b.competition.competitionStatus !== "cancelled" &&
      b.competition.scoreStatus !== "recorded",
  );

  const revenueByDay = useMemo(() => {
    const map = new Map<string, number>();
    myBookings
      .filter((b) => b.status === "confirmed" || b.status === "completed")
      .forEach((b) => map.set(b.date, (map.get(b.date) ?? 0) + b.totalPrice));
    return [...map.entries()].sort().slice(-7);
  }, [myBookings]);

  const statusCounts = useMemo(
    () => ({
      pending: myBookings.filter((b) => b.status === "pending").length,
      confirmed: myBookings.filter((b) => b.status === "confirmed").length,
      completed: myBookings.filter((b) => b.status === "completed").length,
      cancelled: myBookings.filter((b) => b.status === "cancelled").length,
      rejected: myBookings.filter((b) => b.status === "rejected").length,
    }),
    [myBookings],
  );

  const payByMethod = useMemo(() => {
    const map = new Map<string, { n: number; amt: number }>();
    myBookings
      .filter((b) => b.status === "confirmed" || b.status === "completed")
      .forEach((b) => {
        const m = String(b.paymentMethod ?? "Other");
        const cur = map.get(m) ?? { n: 0, amt: 0 };
        cur.n += 1;
        cur.amt += b.totalPrice;
        map.set(m, cur);
      });
    return [...map.entries()]
      .map(([m, v]): [string, number, number] => [m, v.n, v.amt])
      .sort((a, b) => b[2] - a[2]);
  }, [myBookings]);

  const peakHours = useMemo(() => {
    const map = new Map<string, number>();
    myBookings
      .filter((b) => b.status !== "cancelled" && b.status !== "rejected")
      .forEach((b) => {
        const hr = b.startTime ? b.startTime.slice(0, 5) : "?";
        map.set(hr, (map.get(hr) ?? 0) + 1);
      });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 10) as Array<
      [string, number]
    >;
  }, [myBookings]);

  async function decide(id: number, ok: boolean) {
    setActing(id);
    try {
      await patchBooking(id, { status: ok ? "confirmed" : "rejected", actor: "owner", actorId: user?.id });
      await load();
    } finally {
      setActing(null);
    }
  }

  if (loading) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <ActivityIndicator size="large" color={c.textFaint} />
      </ScrollView>
    );
  }

  if (myVenues.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Building2 size={48} color={c.textFaint} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>Welcome to Owner Studio 🎉</Text>
          <Text style={[styles.emptyBody, { color: c.textMuted }]}>
            List your first futsal arena to start receiving booking requests, tracking revenue and
            managing courts.
          </Text>
          <Pressable
            onPress={() => router.push("/admin/venues")}
            style={[styles.emptyBtn, { backgroundColor: isDark ? "#FFFFFF" : "#0F172A" }]}
          >
            <Text style={[styles.emptyBtnText, { color: isDark ? "#0F172A" : "#FFFFFF" }]}>
              + List my first venue
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  const hour = new Date().getHours();
  const greet = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  const kpis = [
    {
      icon: Inbox,
      label: "Pending requests",
      value: String(pending.length),
      sub: "need your decision",
      hot: pending.length > 0,
      href: "/admin/requests" as const,
    },
    {
      icon: Banknote,
      label: "Revenue",
      value: formatNPR(revenue),
      sub: `${confirmed.length} confirmed bookings`,
      hot: false,
      href: "/admin/bookings" as const,
    },
    {
      icon: CalendarCheck,
      label: "Today's games",
      value: String(todaysGames.length),
      sub: "scheduled for today",
      hot: false,
      href: "/admin/bookings" as const,
    },
    {
      icon: Building2,
      label: "Venues / Courts",
      value: `${myVenues.length} / ${myCourts.length}`,
      sub: `${myCourts.filter((x) => x.isActive).length} courts live`,
      hot: false,
      href: "/admin/venues" as const,
    },
  ];

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={[styles.greet, { color: c.text }]}>
        Good {greet}, {user?.name.split(" ")[0]} 👋
      </Text>
      <Text style={[styles.sub, { color: c.textMuted }]}>
        Here&apos;s what&apos;s happening across your {myVenues.length} venue
        {myVenues.length !== 1 ? "s" : ""} today.
      </Text>

      <View style={styles.kpiGrid}>
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Pressable
              key={k.label}
              onPress={() => router.push(k.href)}
              style={[
                styles.kpiCard,
                {
                  backgroundColor: c.surface,
                  borderColor: k.hot ? colors.orange500 : c.border,
                },
              ]}
            >
              <View
                style={[
                  styles.kpiIcon,
                  { backgroundColor: k.hot ? colors.orange500 : isDark ? "#FFFFFF" : "#0F172A" },
                ]}
              >
                <Icon size={18} color={k.hot ? "#FFFFFF" : isDark ? "#0F172A" : "#FFFFFF"} />
              </View>
              <Text style={[styles.kpiValue, { color: c.text }]} numberOfLines={1}>
                {k.value}
              </Text>
              <Text style={[styles.kpiLabel, { color: c.textFaint }]}>{k.label}</Text>
              <View style={styles.kpiSubRow}>
                <Text style={[styles.kpiSub, { color: c.textMuted }]}>{k.sub}</Text>
                <ArrowRight size={12} color={c.textFaint} />
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.twoCol}>
        <View style={[styles.panel, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.panelHead}>
            <View style={styles.panelTitleRow}>
              <Clock size={16} color={colors.orange500} />
              <Text style={[styles.panelTitle, { color: c.text }]}>Awaiting your approval</Text>
            </View>
            <Pressable onPress={() => router.push("/admin/requests")}>
              <Text style={styles.link}>View all →</Text>
            </Pressable>
          </View>
          {pending.length === 0 ? (
            <View style={[styles.inlineEmpty, { backgroundColor: isDark ? "#1E293B" : "#F8FAFC" }]}>
              <Text style={[styles.inlineEmptyText, { color: c.textFaint }]}>
                No pending requests. New bookings from players will appear here. ✅
              </Text>
            </View>
          ) : (
            pending.slice(0, 4).map((b) => (
              <View
                key={b.id}
                style={[styles.approveRow, { borderColor: c.border, backgroundColor: isDark ? "#0F172A" : "#F8FAFC" }]}
              >
                <View style={styles.grow}>
                  <Text style={[styles.approveName, { color: c.text }]} numberOfLines={1}>
                    {b.bookerName || "Player"} • {formatNPR(b.totalPrice)}
                  </Text>
                  <Text style={[styles.approveMeta, { color: c.textMuted }]} numberOfLines={1}>
                    {b.venue?.name} • {b.court?.name} • {prettyDate(b.date)}{" "}
                    {formatTime12(b.startTime)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => void decide(b.id, true)}
                  disabled={acting === b.id}
                  style={[styles.approveBtn, { opacity: acting === b.id ? 0.5 : 1 }]}
                  accessibilityLabel="Accept"
                >
                  <Check size={16} color="#FFFFFF" strokeWidth={3} />
                </Pressable>
                <Pressable
                  onPress={() => void decide(b.id, false)}
                  disabled={acting === b.id}
                  style={[styles.declineBtn, { opacity: acting === b.id ? 0.5 : 1 }]}
                  accessibilityLabel="Decline"
                >
                  <X size={16} color="#DC2626" strokeWidth={3} />
                </Pressable>
              </View>
            ))
          )}
        </View>
        <RevenueRainbow data={revenueByDay} />
      </View>

      <View style={styles.threeCol}>
        <BookingDonut counts={statusCounts} />
        <PaymentParty byMethod={payByMethod} />
        <PeakHours byHour={peakHours} />
      </View>

      <View style={[styles.panel, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.panelHead}>
          <Text style={[styles.panelTitle, { color: c.text }]}>My venues</Text>
          <Pressable onPress={() => router.push("/admin/venues")}>
            <Text style={styles.link}>Manage →</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.venueStrip}>
          {myVenues.map((v) => (
            <Pressable
              key={v.id}
              onPress={() => router.push("/admin/venues")}
              style={[styles.venueCard, { borderColor: c.border, backgroundColor: isDark ? "#0F172A" : "#F8FAFC" }]}
            >
              {v.imageUrl ? (
                <Image source={{ uri: v.imageUrl }} style={styles.venueImg} />
              ) : (
                <View style={[styles.venueImg, { backgroundColor: c.border }]} />
              )}
              <View style={styles.grow}>
                <Text style={[styles.venueName, { color: c.text }]} numberOfLines={1}>
                  {v.name}
                </Text>
                <Text style={[styles.venueMeta, { color: c.textMuted }]}>
                  {v.courtCount} courts • {(v.courts ?? []).filter((x) => x.isActive).length} live
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.twoCol}>
        <Pressable
          onPress={() => router.push("/admin/leagues")}
          style={[styles.promoCard, { borderColor: isDark ? "rgba(5,150,105,0.35)" : "#A7F3D0", backgroundColor: c.surface }]}
        >
          <View style={[styles.promoIcon, { backgroundColor: colors.emerald600 }]}>
            <Trophy size={18} color="#FFFFFF" />
          </View>
          <View style={styles.grow}>
            <Text style={[styles.promoTitle, { color: c.text }]}>
              Host a league at your ground
            </Text>
            <Text style={[styles.promoBody, { color: c.textMuted }]}>
              Size it, set the entry fee and prize pool, then invite squads or take requests. Photos
              and results live on the league page.
            </Text>
          </View>
          <ArrowRight size={16} color={c.textFaint} />
        </Pressable>
        <Pressable
          onPress={() => router.push("/admin/bookings")}
          style={[styles.promoCard, { borderColor: isDark ? "rgba(99,102,241,0.35)" : "#C7D2FE", backgroundColor: c.surface }]}
        >
          <View style={[styles.promoIcon, { backgroundColor: "#4F46E5" }]}>
            <Swords size={18} color="#FFFFFF" />
          </View>
          <View style={styles.grow}>
            <Text style={[styles.promoTitle, { color: c.text }]}>Competition score desk</Text>
            <Text style={[styles.promoBody, { color: c.textMuted }]}>
              {awaitingScores.length > 0
                ? `${awaitingScores.length} result${awaitingScores.length === 1 ? "" : "s"} waiting — ${awaitingScores
                    .slice(0, 2)
                    .map((b) => `${b.bookerName} vs ${b.competition?.opponentName ?? "opponent"}`)
                    .join(", ")}${awaitingScores.length > 2 ? "…" : ""}`
                : "When two squads book a competition game, you record the score and it lands on both their profiles."}
            </Text>
          </View>
          <ArrowRight size={16} color={c.textFaint} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space[4], paddingBottom: space[16], gap: space[2] },
  greet: { fontSize: fontSize["2xl"], fontWeight: "900", letterSpacing: -0.5 },
  sub: { fontSize: fontSize.sm, marginTop: space[1] },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
    marginTop: space[4],
  },
  kpiCard: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 150,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
  },
  kpiIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiValue: { fontSize: fontSize["2xl"], fontWeight: "900", marginTop: space[3] },
  kpiLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 2,
  },
  kpiSubRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  kpiSub: { fontSize: fontSize.xs, fontWeight: "600", flex: 1 },
  twoCol: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
    gap: space[3],
    marginTop: space[2],
  },
  threeCol: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
    gap: space[3],
    marginTop: space[2],
  },
  panel: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 260,
    gap: space[2.5],
  },
  panelHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  panelTitleRow: { flexDirection: "row", alignItems: "center", gap: space[2], flex: 1 },
  panelTitle: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    flex: 1,
  },
  link: { fontSize: fontSize.xs, fontWeight: "900", color: colors.orange500 },
  inlineEmpty: { borderRadius: radius.xl, paddingVertical: space[6], paddingHorizontal: space[4] },
  inlineEmptyText: { fontSize: fontSize.sm, textAlign: "center" },
  approveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space[3],
  },
  grow: { flex: 1, minWidth: 0 },
  approveName: { fontSize: fontSize.sm, fontWeight: "800" },
  approveMeta: { fontSize: fontSize.xs, marginTop: 2 },
  approveBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.xl,
    backgroundColor: colors.emerald600,
    alignItems: "center",
    justifyContent: "center",
  },
  declineBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.xl,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  venueStrip: { flexGrow: 0, marginTop: space[1] },
  venueCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[3],
    marginRight: space[3],
    width: 256,
  },
  venueImg: { width: 56, height: 56, borderRadius: radius.xl },
  venueName: { fontSize: fontSize.sm, fontWeight: "800" },
  venueMeta: { fontSize: fontSize.xs, marginTop: 2 },
  promoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 260,
  },
  promoIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  promoTitle: { fontSize: fontSize.sm, fontWeight: "900" },
  promoBody: { fontSize: fontSize.xs, marginTop: 2, lineHeight: 16 },
  emptyCard: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[10],
    alignItems: "center",
    marginTop: space[6],
  },
  emptyTitle: { marginTop: space[4], fontSize: fontSize.xl, fontWeight: "900", textAlign: "center" },
  emptyBody: {
    marginTop: space[2],
    fontSize: fontSize.sm,
    textAlign: "center",
    lineHeight: 19,
    maxWidth: 320,
  },
  emptyBtn: {
    marginTop: space[5],
    borderRadius: radius.xl,
    paddingHorizontal: space[6],
    paddingVertical: space[3],
    minHeight: 44,
    justifyContent: "center",
  },
  emptyBtnText: { fontSize: fontSize.sm, fontWeight: "900" },
});
