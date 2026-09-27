import { useFocusEffect, useRouter } from "expo-router";
import {
  ArrowRight,
  Banknote,
  CalendarClock,
  Globe,
  Lock,
  Plus,
  Swords,
  Trophy,
  Users,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchBookings, fetchLeagues, fetchVenues } from "@/api";
import { LeagueCard } from "@/components/LeagueCard";
import { LeagueForm } from "@/components/LeagueForm";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { formatNPR } from "@/lib/futsal";
import type { Booking, LeagueSummary } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/** Owner Studio → Leagues — host, monitor, and open the score desk. */
export default function OwnerLeagues() {
  const { user } = useAuth();
  const { colors: c, isDark } = useTheme();
  const router = useRouter();
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [venues, setVenues] = useState<Array<{ id: number; ownerId: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    // This screen is a control room, not a demo-data bootstrapper. Seeding
    // before the real requests made a slow/unavailable seed endpoint look like
    // the Owner Studio navigation had frozen.
    const [l, b, v] = await Promise.all([
      fetchLeagues(user.id),
      fetchBookings({ refresh: true }),
      fetchVenues(),
    ]);
    setLeagues(l);
    setBookings(b);
    setVenues(v.map((x) => ({ id: x.id, ownerId: x.ownerId ?? null })));
  }, [user]);

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
    () => new Set(venues.filter((v) => v.ownerId === user?.id).map((v) => v.id)),
    [venues, user],
  );
  const hosted = useMemo(() => leagues.filter((l) => l.hostId === user?.id), [leagues, user]);
  const playing = useMemo(
    () => leagues.filter((l) => l.hostId !== user?.id && (l.viewer?.myTeams ?? []).length > 0),
    [leagues, user],
  );
  const awaiting = useMemo(
    () =>
      bookings.filter(
        (b) =>
          b.competition &&
          b.competition.scoreStatus !== "recorded" &&
          b.venue &&
          myVenueIds.has(b.venue.id),
      ),
    [bookings, myVenueIds],
  );
  const stats = useMemo(() => {
    const squads = hosted.reduce((sum, l) => sum + l.approvedTeams, 0);
    const pools = hosted.reduce((sum, l) => sum + l.prizePool, 0);
    const fixtures = hosted.reduce((sum, l) => sum + l.playedMatches, 0);
    return { squads, pools, fixtures };
  }, [hosted]);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.headRow}>
        <View style={styles.grow}>
          <View style={styles.titleRow}>
            <Trophy size={22} color={c.text} />
            <Text style={[styles.h1, { color: c.text }]}>Leagues</Text>
          </View>
          <Text style={[styles.sub, { color: c.textMuted }]}>
            Tournaments on your grounds — entries, money, fixtures and results. Anyone can host,
            and you don&apos;t have to own the ground to do it.
          </Text>
        </View>
        <Pressable onPress={() => setShowForm(true)} style={styles.hostBtn}>
          <Plus size={16} color="#FFFFFF" />
          <Text style={styles.hostBtnText}>Host a league</Text>
        </Pressable>
      </View>

      <View style={styles.statGrid}>
        {[
          { l: "Leagues hosted", v: String(hosted.length), icon: Trophy },
          { l: "Squads entered", v: String(stats.squads), icon: Users },
          { l: "Fixtures played", v: String(stats.fixtures), icon: CalendarClock },
          { l: "Prize pools", v: stats.pools > 0 ? formatNPR(stats.pools) : "—", icon: Banknote },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <View
              key={s.l}
              style={[styles.statCard, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <Icon size={16} color={colors.emerald600} />
              <Text style={[styles.statValue, { color: c.text }]}>{s.v}</Text>
              <Text style={[styles.statLabel, { color: c.textFaint }]}>{s.l}</Text>
            </View>
          );
        })}
      </View>

      {awaiting.length > 0 ? (
        <View style={[styles.banner, { borderColor: isDark ? "rgba(99,102,241,0.35)" : "#C7D2FE" }]}>
          <View style={styles.titleRow}>
            <Swords size={16} color="#4338CA" />
            <Text style={styles.bannerTitle}>
              {awaiting.length} competition result{awaiting.length === 1 ? "" : "s"} still to record
            </Text>
          </View>
          {awaiting.slice(0, 3).map((b) => (
            <Text key={b.id} style={styles.bannerItem}>
              #{b.id} • {b.teamName || "Squad"} vs {b.competition?.opponentName || "opponent"} at{" "}
              {b.venue?.name ?? "your ground"}
              {b.competition?.leagueName ? ` • 🏆 ${b.competition.leagueName}` : ""}
            </Text>
          ))}
          <Pressable
            onPress={() => router.push("/admin/bookings")}
            style={styles.bannerBtn}
          >
            <Text style={styles.bannerBtnText}>Open the score desk</Text>
            <ArrowRight size={14} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator size="large" color={c.textFaint} style={{ marginTop: space[8] }} />
      ) : (
        <>
          <Text style={[styles.sectionLabel, { color: c.textFaint }]}>Leagues you host</Text>
          {hosted.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.emptyTitle, { color: c.text }]}>
                You aren&apos;t hosting a league yet 🏆
              </Text>
              <Text style={[styles.emptyBody, { color: c.textMuted }]}>
                Pick a ground, size it (4–32 squads), set the entry fee and prize pool, then send
                invitations — or leave it public so teams can request a place.
              </Text>
              <Pressable onPress={() => setShowForm(true)} style={styles.hostBtn}>
                <Plus size={14} color="#FFFFFF" />
                <Text style={styles.hostBtnText}>Host your first league</Text>
              </Pressable>
            </View>
          ) : (
            hosted.map((l) => (
              <View key={l.id} style={styles.leagueBlock}>
                <LeagueCard
                  league={l}
                  ownerMode
                  onPress={() => router.push(`/admin/leagues/${l.id}`)}
                />
                <View style={styles.leagueMetaRow}>
                  <View style={styles.leagueMetaItem}>
                    {l.visibility === "private" ? (
                      <Lock size={12} color={c.textFaint} />
                    ) : (
                      <Globe size={12} color={c.textFaint} />
                    )}
                    <Text style={[styles.leagueMeta, { color: c.textFaint }]}>
                      {l.visibility === "private" ? "Private" : "Public"}
                    </Text>
                  </View>
                  <Text style={[styles.leagueMeta, { color: c.textFaint }]}>
                    • {l.approvedTeams}/{l.maxTeams} squads
                  </Text>
                  {l.pendingTeams > 0 ? (
                    <Text style={[styles.leagueMeta, { color: "#D97706" }]}>
                      • {l.pendingTeams} waiting on you
                    </Text>
                  ) : null}
                </View>
              </View>
            ))
          )}

          {playing.length > 0 ? (
            <>
              <Text style={[styles.sectionLabel, { color: c.textFaint, marginTop: space[6] }]}>
                Leagues your squads play in
              </Text>
              {playing.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() => router.push(`/admin/leagues/${l.id}`)}
                  style={[styles.playingRow, { backgroundColor: c.surface, borderColor: c.border }]}
                >
                  <View style={styles.playingIcon}>
                    <Trophy size={18} color="#FFFFFF" />
                  </View>
                  <View style={styles.grow}>
                    <Text style={[styles.playingName, { color: c.text }]} numberOfLines={1}>
                      {l.name}
                    </Text>
                    <Text style={[styles.playingMeta, { color: c.textMuted }]} numberOfLines={1}>
                      {l.format} • {l.approvedTeams}/{l.maxTeams} squads •{" "}
                      {(l.viewer?.myTeams ?? []).map((m: { teamName: string }) => m.teamName).join(", ")}
                    </Text>
                  </View>
                  <ArrowRight size={16} color={c.textFaint} />
                </Pressable>
              ))}
            </>
          ) : null}
        </>
      )}

      {user ? (
        <LeagueForm
          open={showForm}
          onClose={() => setShowForm(false)}
          hostId={user.id}
          lockVenueId={myVenuesFirstId(venues, user.id)}
          onSaved={() => {
            setShowForm(false);
            void load();
          }}
        />
      ) : null}
    </ScrollView>
  );
}

/** First venue owned by this account — LeagueForm's default ground. */
function myVenuesFirstId(
  venues: Array<{ id: number; ownerId: number | null }>,
  userId: number,
): number | undefined {
  return venues.find((v) => v.ownerId === userId)?.id;
}

const styles = StyleSheet.create({
  scroll: { padding: space[4], paddingBottom: space[16], gap: space[3] },
  headRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: space[3] },
  grow: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  h1: { fontSize: fontSize["2xl"], fontWeight: "900" },
  sub: { fontSize: fontSize.sm, marginTop: space[1] },
  hostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    backgroundColor: colors.emerald600,
    paddingHorizontal: space[4],
    paddingVertical: space[2.5],
    minHeight: 40,
  },
  hostBtnText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  statCard: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 140,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    gap: 2,
  },
  statValue: { fontSize: fontSize.xl, fontWeight: "900", marginTop: space[1.5] },
  statLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  banner: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    backgroundColor: "rgba(99,102,241,0.06)",
    gap: space[1.5],
  },
  bannerTitle: { fontSize: fontSize.sm, fontWeight: "900", color: "#4338CA", flex: 1 },
  bannerItem: { fontSize: fontSize.xs, fontWeight: "600", color: "#4338CA", lineHeight: 17 },
  bannerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: radius.full,
    backgroundColor: "#4F46E5",
    paddingHorizontal: space[3.5],
    paddingVertical: space[2],
    marginTop: space[1.5],
    minHeight: 36,
  },
  bannerBtnText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginTop: space[3],
  },
  emptyCard: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[8],
    alignItems: "center",
    gap: space[2],
  },
  emptyTitle: { fontSize: fontSize.sm, fontWeight: "900", textAlign: "center" },
  emptyBody: { fontSize: fontSize.xs, textAlign: "center", lineHeight: 17, maxWidth: 360 },
  leagueBlock: { gap: space[1.5] },
  leagueMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[1],
  },
  leagueMetaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  leagueMeta: { fontSize: 11, fontWeight: "700" },
  playingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
  },
  playingIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    backgroundColor: colors.emerald600,
    alignItems: "center",
    justifyContent: "center",
  },
  playingName: { fontSize: fontSize.sm, fontWeight: "900" },
  playingMeta: { fontSize: 11, fontWeight: "600", marginTop: 2 },
});
