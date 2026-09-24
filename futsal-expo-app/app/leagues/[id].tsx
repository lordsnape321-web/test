import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  Coins,
  Crown,
  Info,
  Lock,
  MapPin,
  Phone,
  Shield,
  Trophy,
  Users,
} from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fetchLeague } from "@/api";
import { LeagueAlbum } from "@/components/LeagueAlbum";
import { LeagueBracket } from "@/components/LeagueBracket";
import { LeagueFixtures } from "@/components/LeagueFixtures";
import { LeagueForm } from "@/components/LeagueForm";
import { LeagueHostPanel } from "@/components/LeagueHostPanel";
import { LeagueSquadPanel } from "@/components/LeagueSquadPanel";
import { LeagueTable, PrizeBreakdown } from "@/components/LeagueTable";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { leagueModeLabel, leagueStatusLabel, leagueVisibilityLabel, modeHasBracket } from "@/lib/league";
import { formatNPR, prettyDate } from "@/lib/futsal";
import type { LeagueDetail } from "@/lib/types";
import { fontSize, radius, space } from "@/theme";

/**
 * One league, in full 🏆 — a 1:1 port of the web app's
 * app/leagues/[id]/page.tsx.
 *
 * The page reads differently depending on who is looking at it: a visitor gets
 * the pitch (ground, size, terms, prize split, table and results), a captain
 * also gets their squad's entry panel, and the host gets the whole control room
 * — entries, ledger, fixtures and the album. All three are the same page and
 * the same data; only what the server sent differs.
 *
 * Layout: the web's lg two-column grid becomes one scroll — main column first,
 * sidebar after — which is exactly how the web stacks it below `lg`. The web's
 * `#album` scrollIntoView becomes a measured scrollTo on the ScrollView.
 */
export function LeagueDetailScreen({ ownerMode = false }: { ownerMode?: boolean } = {}) {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const { user } = useAuth();
  const { colors: c, isDark } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const inOwnerStudio = ownerMode || pathname === "/admin/leagues" || pathname.startsWith("/admin/leagues/");
  const allLeaguesPath = inOwnerStudio ? "/admin/leagues" : "/(app)/matches";
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [focusMatch, setFocusMatch] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const albumY = useRef(0);

  const load = useCallback(async () => {
    try {
      setLeague(await fetchLeague(Number(id), user?.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that league 🙏");
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (focusMatch !== null && albumY.current > 0) {
      scrollRef.current?.scrollTo({ y: Math.max(0, albumY.current - 16), animated: true });
    }
  }, [focusMatch]);

  useEffect(() => {
    if (edit === "1" && league?.viewer?.isHost) setEditing(true);
  }, [edit, league?.viewer?.isHost]);

  useEffect(() => {
    if (user?.role === "owner" && !inOwnerStudio) router.replace("/admin/leagues");
  }, [inOwnerStudio, router, user?.role]);

  // A league deep link is a common way to enter the wrong shell. Do not render
  // even the player league header while the owner redirect is being committed.
  if (user?.role === "owner" && !inOwnerStudio) {
    return (
      <View style={[styles.stateBox, { backgroundColor: "#020617" }]}>
        <ActivityIndicator size="large" color="#FBBF24" />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.stateBox, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" color={c.primary} />
        <Text style={[styles.stateSub, { color: c.textMuted }]}>Landing the league…</Text>
      </View>
    );
  }

  if (error || !league) {
    return (
      <View style={[styles.stateBox, { backgroundColor: c.bg }]}>
        <Text style={[styles.stateTitle, { color: c.text }]}>
          {error || "That league has moved on 🏆"}
        </Text>
        <Text style={[styles.stateSub, { color: c.textMuted }]}>
          Private leagues only open for the squads in them — if you were invited, log in with the
          captain's account and try again.
        </Text>
        <Pressable
          onPress={() => router.push(allLeaguesPath)}
          accessibilityRole="button"
          style={styles.backBtn}
        >
          <ArrowLeft size={16} color="#FFFFFF" />
          <Text style={styles.backBtnText}>All leagues</Text>
        </Pressable>
      </View>
    );
  }

  const status = leagueStatusLabel(league.status);
  const visibility = leagueVisibilityLabel(league.visibility);
  const mode = leagueModeLabel(league.mode);
  const isHost = league.viewer?.isHost ?? false;
  const myTeamIds = league.viewer?.myTeams.map((t) => t.teamId) ?? [];
  const spotsLeft = Math.max(0, league.maxTeams - league.approvedTeams);
  const closed = league.status === "completed" || league.status === "cancelled";
  const canSeeInside = league.viewer?.canSeeInside || league.visibility === "public";

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollBody}>
        {/* Cover */}
        <View style={styles.cover}>
          {league.bannerUrl ? (
            <Image source={{ uri: league.bannerUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <LinearGradient
              colors={["#047857", "#065F46", "#1C1917"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          )}
          <LinearGradient
            colors={["rgba(0,0,0,0.85)", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.2)"]}
            locations={[0, 0.55, 1]}
            start={{ x: 0, y: 1 }}
            end={{ x: 0, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.coverTopActions}>
            <Pressable
              onPress={() => router.push(allLeaguesPath)}
              accessibilityRole="button"
              style={[
                styles.allLeagues,
                {
                  backgroundColor: isDark ? "rgba(15,23,42,0.94)" : "rgba(255,255,255,0.9)",
                  borderColor: isDark ? "rgba(226,232,240,0.3)" : "rgba(255,255,255,0.85)",
                },
              ]}
            >
              <ArrowLeft size={14} color={isDark ? "#F1F5F9" : "#292524"} />
              <Text style={[styles.allLeaguesText, { color: isDark ? "#F1F5F9" : "#292524" }]}>
                All leagues
              </Text>
            </Pressable>
            {inOwnerStudio && isHost ? (
              <Pressable
                onPress={() => setEditing(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit league settings"
                style={styles.editLeagueBtn}
              >
                <Text style={styles.editLeagueText}>Edit settings</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.coverBottom}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: "rgba(255,255,255,0.92)" }]}>
                <Text style={[styles.badgeText, { color: "#292524" }]}>
                  {status.emoji} {status.label}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: "rgba(251,146,60,0.95)" }]}>
                <Text style={[styles.badgeText, { color: "#431407" }]}>
                  {mode.emoji} {mode.label}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: "rgba(255,255,255,0.92)" }]}>
                <Text style={[styles.badgeText, { color: "#44403C" }]}>
                  {league.format} • {league.approvedTeams}/{league.maxTeams} squads
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: "rgba(255,255,255,0.92)" }]}>
                <Text style={[styles.badgeText, { color: "#44403C" }]}>
                  {visibility.emoji} {visibility.label}
                </Text>
              </View>
              {isHost ? (
                <View style={[styles.badge, { backgroundColor: "#FBBF24" }]}>
                  <Crown size={12} color="#422006" />
                  <Text style={[styles.badgeText, { color: "#422006" }]}>You host this</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.coverTitle}>{league.name}</Text>
            <View style={styles.coverMeta}>
              <View style={styles.coverMetaRow}>
                <MapPin size={14} color="rgba(255,255,255,0.85)" />
                {league.venueId ? (
                  <Text
                    onPress={() =>
                      inOwnerStudio
                        ? router.push("/admin/venues")
                        : router.push(`/venues/${league.venueId}`)
                    }
                    style={styles.coverMetaLink}
                  >
                    {league.venueName}
                  </Text>
                ) : (
                  <Text style={styles.coverMetaText}>{league.venueName}</Text>
                )}
                {league.courtName ? (
                  <Text style={styles.coverMetaText}> • {league.courtName}</Text>
                ) : null}
              </View>
              <View style={styles.coverMetaRow}>
                <CalendarDays size={14} color="rgba(255,255,255,0.85)" />
                <Text style={styles.coverMetaText}>
                  Starts {prettyDate(league.startsAt)}
                  {league.endsAt ? ` • ends ${prettyDate(league.endsAt)}` : ""}
                </Text>
              </View>
              <View style={styles.coverMetaRow}>
                <Crown size={14} color="rgba(255,255,255,0.85)" />
                <Text style={styles.coverMetaText}>
                  Hosted by {league.hostName}
                  {league.hostRole === "owner" ? " (venue owner)" : ""}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.mainCol}>
            {/* Terms */}
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: isDark ? "#FB923C" : "#EA580C" }]}>
                The deal
              </Text>
              <View style={styles.dealGrid}>
                <View style={[styles.dealCell, { backgroundColor: c.inset }]}>
                  <View style={styles.dealHead}>
                    <Coins size={12} color={c.textFaint} />
                    <Text style={styles.dealLabel}>Entry fee</Text>
                  </View>
                  <Text style={[styles.dealValue, { color: c.text }]}>
                    {league.entryFee > 0 ? formatNPR(league.entryFee) : "Free"}
                  </Text>
                  {league.entryFee > 0 ? (
                    <Text style={[styles.dealFine, { color: isDark ? "#6EE7B7" : "#047857" }]}>
                      {formatNPR(league.deposit)} deposit locks the place
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.dealCell, { backgroundColor: c.inset }]}>
                  <View style={styles.dealHead}>
                    <Shield size={12} color={c.textFaint} />
                    <Text style={styles.dealLabel}>Back out</Text>
                  </View>
                  <Text style={[styles.dealValue, { color: c.text }]}>{league.refundPercent}% back</Text>
                  <Text style={[styles.dealFine, { color: c.textMuted }]}>
                    of what the squad paid — the rest stays with the league
                  </Text>
                </View>
                <View style={[styles.dealCell, { backgroundColor: c.inset }]}>
                  <View style={styles.dealHead}>
                    <Users size={12} color={c.textFaint} />
                    <Text style={styles.dealLabel}>Squads</Text>
                  </View>
                  <Text style={[styles.dealValue, { color: c.text }]}>
                    {league.approvedTeams}/{league.maxTeams}
                  </Text>
                  <Text style={[styles.dealFine, { color: c.textMuted }]}>
                    {spotsLeft > 0 && !closed
                      ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`
                      : "League full"}
                    {league.closesAt && !closed ? ` • entries close ${prettyDate(league.closesAt)}` : ""}
                  </Text>
                </View>
              </View>

              {league.description ? (
                <Text style={[styles.description, { color: c.textMuted }]}>{league.description}</Text>
              ) : null}

              <View style={styles.dealGrid2}>
                <PrizeBreakdown lines={league.prizeLines} prizePool={league.prizePool} />
                {league.rules ? (
                  <View style={[styles.rulesCard, { borderColor: c.border }]}>
                    <View style={styles.dealHead}>
                      <Info size={14} color={c.textFaint} />
                      <Text style={[styles.rulesTitle, { color: c.textMuted }]}>Rules</Text>
                    </View>
                    <Text style={[styles.rulesText, { color: c.textMuted }]}>{league.rules}</Text>
                  </View>
                ) : null}
              </View>

              {league.matchDays ? (
                <View style={styles.matchDaysRow}>
                  <CalendarDays size={12} color={c.textFaint} />
                  <Text style={[styles.matchDaysText, { color: c.textFaint }]}>
                    {league.matchDays}
                    {league.contactPhone ? ` • 📞 ${league.contactPhone}` : ""}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* The bracket, when that's the shape of the competition 🥊 */}
            {modeHasBracket(league.mode) && canSeeInside ? (
              <LeagueBracket
                league={league}
                hostId={user?.id ?? 0}
                isHost={isHost}
                onChanged={load}
              />
            ) : null}

            {/* Table — a round robin has one; a knockout's standings *are* the bracket */}
            {!modeHasBracket(league.mode) ? (
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={styles.sectionHead}>
                  <Trophy size={14} color={isDark ? "#6EE7B7" : "#047857"} />
                  <Text style={[styles.sectionTitleSm, { color: isDark ? "#6EE7B7" : "#047857" }]}>
                    League table
                  </Text>
                </View>
                {canSeeInside ? (
                  <View style={{ marginTop: space["3"] }}>
                    <LeagueTable
                      standings={league.standings}
                      highlightTeamIds={myTeamIds}
                      onTeamPress={inOwnerStudio ? () => router.push(allLeaguesPath) : undefined}
                    />
                  </View>
                ) : (
                  <View style={[styles.lockedTable, { borderColor: isDark ? "rgba(245,158,11,0.3)" : "#FCD34D" }]}>
                    <Lock size={14} color={isDark ? "#FBBF24" : "#B45309"} />
                    <Text style={[styles.lockedTableText, { color: isDark ? "#FBBF24" : "#B45309" }]}>
                      The table is inside the league — ask the host for an invitation.
                    </Text>
                  </View>
                )}
              </View>
            ) : null}

            {/* Fixtures */}
            {canSeeInside ? (
              <LeagueFixtures
                league={league}
                hostId={user?.id ?? 0}
                isHost={isHost}
                onChanged={load}
                onOpenAlbum={(mid) => setFocusMatch(mid)}
                onOpenVenue={inOwnerStudio ? () => router.push("/admin/venues") : undefined}
              />
            ) : (
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.muted, { color: c.textMuted }]}>
                  Fixtures and results are visible to the squads in this league.
                </Text>
              </View>
            )}

            {/* Album */}
            <View
              onLayout={(e) => {
                albumY.current = e.nativeEvent.layout.y;
              }}
            >
              <LeagueAlbum
                league={league}
                hostId={user?.id ?? 0}
                isHost={isHost}
                focusMatchId={focusMatch}
                onChanged={load}
              />
            </View>
          </View>

          {/* Sidebar — stacked under the main column on a phone, exactly as the
              web stacks its grid below `lg`. */}
          <View style={styles.sideCol}>
            {isHost && user ? (
              <LeagueHostPanel
                league={league}
                hostId={user.id}
                onChanged={load}
                onEdit={() => setEditing(true)}
                showSettings={!inOwnerStudio}
                onOpenTeam={inOwnerStudio ? () => router.push(allLeaguesPath) : undefined}
              />
            ) : null}

            {user && !isHost ? (
              <LeagueSquadPanel
                league={league}
                viewerId={user.id}
                onChanged={load}
                onOpenTeams={inOwnerStudio ? () => router.push(allLeaguesPath) : undefined}
              />
            ) : null}

            {!user ? (
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.loginTitle, { color: c.text }]}>
                  Want a place in this league?
                </Text>
                <Text style={[styles.loginSub, { color: c.textMuted }]}>
                  Log in as the captain of your squad, ask to join (or accept the invitation the
                  host sent you), and pay the deposit to lock it in.
                </Text>
                <Pressable
                  onPress={() => router.push("/login")}
                  accessibilityRole="button"
                  style={styles.loginBtn}
                >
                  <Text style={styles.loginBtnText}>Log in to enter</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Squad list */}
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.sectionHead}>
                <Users size={14} color={isDark ? "#6EE7B7" : "#047857"} />
                <Text style={[styles.sectionTitleSm, { color: isDark ? "#6EE7B7" : "#047857" }]}>
                  Squads in the league
                </Text>
              </View>
              {league.teams.length === 0 ? (
                <Text style={[styles.muted, { color: c.textMuted, marginTop: space["3"] }]}>
                  No squad has been admitted yet.
                </Text>
              ) : (
                <View style={styles.squadList}>
                  {league.teams.map((t) => (
                    <Pressable
                      key={t.teamId}
                      onPress={() =>
                        inOwnerStudio
                          ? router.push("/admin/leagues")
                          : router.push(`/teams/${t.teamId}`)
                      }
                      accessibilityRole="button"
                      style={styles.squadRow}
                    >
                      <View style={[styles.squadAvatar, { backgroundColor: t.logoColor }]}>
                        <Text style={styles.squadAvatarText}>{t.name.slice(0, 2).toUpperCase()}</Text>
                      </View>
                      <View style={styles.grow}>
                        <Text style={[styles.squadName, { color: c.text }]} numberOfLines={1}>
                          {t.name}
                        </Text>
                        <Text style={[styles.squadCode, { color: c.textFaint }]} numberOfLines={1}>
                          {t.teamCode}
                        </Text>
                      </View>
                      {myTeamIds.includes(t.teamId) ? (
                        <View style={styles.yoursBadge}>
                          <Text style={styles.yoursBadgeText}>YOURS</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* The host's private extras: everyone, admitted or not. */}
            {isHost && league.allTeams.some((t) => t.status !== "approved") ? (
              <View
                style={[
                  styles.behindCard,
                  {
                    borderColor: isDark ? "rgba(245,158,11,0.3)" : "#FCD34D",
                    backgroundColor: isDark ? "rgba(245,158,11,0.05)" : "rgba(255,251,235,0.6)",
                  },
                ]}
              >
                <Text style={[styles.behindTitle, { color: isDark ? "#FBBF24" : "#B45309" }]}>
                  Behind the scenes
                </Text>
                <View style={{ gap: 6, marginTop: 8 }}>
                  {league.allTeams
                    .filter((t) => t.status !== "approved")
                    .map((t) => (
                      <Text key={t.teamId} style={[styles.behindRow, { color: c.text }]}>
                        {t.name}: {t.status}
                        {t.paidAmount > 0 ? ` • ${formatNPR(t.paidAmount)} in` : ""}
                      </Text>
                    ))}
                </View>
              </View>
            ) : null}

            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.sectionHead}>
                <Camera size={12} color={c.textFaint} />
                <Text style={[styles.privacyTitle, { color: c.textFaint }]}>Photos &amp; privacy</Text>
              </View>
              <Text style={[styles.privacyText, { color: c.textMuted }]}>
                Photos are for the host and the squads that played. The host uploads from their
                phone or pastes an external album link — nothing here is public.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {user ? (
        <LeagueForm
          open={editing}
          onClose={() => setEditing(false)}
          hostId={user.id}
          initial={league}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      ) : null}
    </View>
  );
}

export default LeagueDetailScreen;

const styles = StyleSheet.create({
  scrollBody: { paddingBottom: space["8"] },
  stateBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space["6"],
    gap: space["3"],
  },
  stateTitle: { fontSize: 26, fontWeight: "900", textAlign: "center" },
  stateSub: { fontSize: fontSize.base, textAlign: "center", lineHeight: 20, maxWidth: 360 },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#059669",
    borderRadius: radius.xl,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: space["3"],
  },
  backBtnText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  cover: { height: 260, justifyContent: "space-between" },
  coverTopActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  allLeagues: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    margin: space["4"],
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  allLeaguesText: { fontSize: fontSize.sm, fontWeight: "900" },
  editLeagueBtn: {
    marginRight: space["4"],
    backgroundColor: "#FBBF24",
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  editLeagueText: { color: "#422006", fontSize: fontSize.xs, fontWeight: "900" },
  coverBottom: { padding: space["4"], gap: 4 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: "900" },
  coverTitle: {
    fontSize: 30,
    fontWeight: "900",
    color: "#FFFFFF",
    marginTop: 6,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  coverMeta: { gap: 4, marginTop: 4 },
  coverMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  coverMetaText: { fontSize: fontSize.sm, color: "rgba(255,255,255,0.85)", fontWeight: "600" },
  coverMetaLink: {
    fontSize: fontSize.sm,
    color: "rgba(255,255,255,0.9)",
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  content: { padding: space["4"], gap: space["5"] },
  mainCol: { gap: space["4"] },
  sideCol: { gap: space["4"] },
  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space["5"],
    gap: space["2.5"] ?? 10,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitleSm: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  dealGrid: { flexDirection: "row", flexWrap: "wrap", gap: space["3"], marginTop: space["2"] },
  dealCell: { flexGrow: 1, flexBasis: 140, borderRadius: radius.xl, padding: space["3.5"] ?? 14 },
  dealHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  dealLabel: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: "#A8A29E",
  },
  dealValue: { fontSize: 18, fontWeight: "900", marginTop: 4 },
  dealFine: { fontSize: 11, fontWeight: "700", marginTop: 2, lineHeight: 15 },
  description: { fontSize: fontSize.base, lineHeight: 20, marginTop: space["3"] },
  dealGrid2: { flexDirection: "row", flexWrap: "wrap", gap: space["3"], marginTop: space["3"] },
  rulesCard: { flexGrow: 1, flexBasis: 240, borderRadius: radius.xl, borderWidth: 1, padding: space["4"] },
  rulesTitle: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  rulesText: { fontSize: fontSize.base, lineHeight: 20, marginTop: 8 },
  matchDaysRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space["3"] },
  matchDaysText: { fontSize: 11, fontWeight: "700" },
  lockedTable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.xl,
    paddingHorizontal: space["4"],
    paddingVertical: 24,
    marginTop: space["3"],
  },
  lockedTableText: { flex: 1, fontSize: fontSize.sm, fontWeight: "700" },
  muted: { fontSize: fontSize.sm, fontWeight: "600", lineHeight: 18 },
  loginTitle: { fontSize: fontSize.base, fontWeight: "900" },
  loginSub: { fontSize: fontSize.sm, lineHeight: 18, marginTop: 4 },
  loginBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#059669",
    borderRadius: radius.xl,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: space["3"],
  },
  loginBtnText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FFFFFF" },
  squadList: { gap: space["2"], marginTop: space["3"] },
  squadRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  squadAvatar: {
    width: 32,
    height: 32,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  squadAvatarText: { fontSize: 10, fontWeight: "900", color: "#FFFFFF" },
  grow: { flex: 1, minWidth: 0 },
  squadName: { fontSize: fontSize.sm, fontWeight: "700" },
  squadCode: { fontSize: 10, fontWeight: "700" },
  yoursBadge: { backgroundColor: "#059669", borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  yoursBadgeText: { fontSize: 9, fontWeight: "900", color: "#FFFFFF" },
  behindCard: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space["5"],
  },
  behindTitle: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  behindRow: { fontSize: 11, fontWeight: "700" },
  privacyTitle: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  privacyText: { fontSize: 11, lineHeight: 16, marginTop: 8, fontWeight: "600" },
});
