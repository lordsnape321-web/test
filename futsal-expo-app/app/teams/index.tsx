import { useRouter } from "expo-router";
import {
  ArrowUpRight,
  Check,
  Crown,
  Dice5,
  Hash,
  Hourglass,
  MailQuestion,
  MapPin,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  Trophy,
  Users,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  answerTeamInvite,
  createTeam,
  fetchLeagues,
  fetchMyInvites,
  fetchTeams,
  fetchVenues,
  leaveTeam,
  requestJoinTeam,
  seedDemo,
} from "@/api";
import { Avatar } from "@/components/Avatar";
import { LeagueTable } from "@/components/LeagueTable";
import { TeamManager } from "@/components/TeamManager";
import { Notice, Spinner } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { initials } from "@/lib/futsal";
import type { LeagueSummary, TeamCard, TeamInvite } from "@/lib/types";
import {
  TEAM_DESCRIPTION_MAX,
  normalizeTeamCode,
  suggestTeamCode,
  type Quota,
} from "@/lib/teams";
import {
  firstError,
  validateMessage,
  validateTeamCode,
  validateTeamDescription,
  validateTitle,
} from "@/lib/validation";
import { colors as tokens, fontSize, radius, space } from "@/theme";

const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#be123c", "#4d7c0f"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];

/**
 * Teams & friendly leagues 🛡️ — a 1:1 port of the web app's app/teams/page.tsx.
 *
 * Same section order: header + quota line, search, notice, open invitations,
 * league tables, the squad grid, create modal, and the captain's TeamManager
 * panel. Platform notes: the web's md:grid-cols-2 becomes a single column
 * (phone-first), `<select>` becomes Picker, and window.location.href = "/login"
 * becomes a router push.
 */
export default function TeamsScreen() {
  const router = useRouter();
  const { colors: c, isDark } = useTheme();
  const { user, ready } = useAuth();
  const inputFill = isDark ? "rgba(255,255,255,0.05)" : tokens.insetCream;

  const [teams, setTeams] = useState<TeamCard[]>([]);
  const [venues, setVenues] = useState<Array<{ id: number; name: string; city: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [motto, setMotto] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("Intermediate");
  const [color, setColor] = useState(COLORS[0]);
  const [homeVenueId, setHomeVenueId] = useState("0");
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [managing, setManaging] = useState<TeamCard | null>(null);
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [notice, setNotice] = useState("");
  const [noticeBad, setNoticeBad] = useState(false);
  // `find` is what's typed, `q` is what has been submitted — searching on submit
  // keeps a keystroke from firing a request (and a re-seed) every time.
  const [find, setFind] = useState("");
  const [q, setQ] = useState("");
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [answering, setAnswering] = useState<number | null>(null);

  /**
   * `viewerId` tells the API whose buttons to draw: it comes back with whether
   * this player is a member, whether they captain the squad, and whether they
   * have a request waiting on the captain.
   */
  const load = useCallback(async () => {
    const [listed, myInvites] = await Promise.all([
      fetchTeams({ q: q.trim() || undefined, viewerId: user?.id }),
      // Pending invitations addressed to this player. Kept in the same round trip
      // so a fresh invite can't leave the banner one render behind.
      user ? fetchMyInvites(user.id) : Promise.resolve([] as TeamInvite[]),
    ]);
    setTeams(listed.teams);
    setQuota(listed.quota);
    setInvites(myInvites);
    return listed.teams;
  }, [q, user]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Seed on first visit so a fresh database has squads to show. The call is
        // idempotent ("Already seeded"), so re-running it after a search is cheap.
        try {
          await seedDemo();
        } catch {
          /* seed is best-effort — a live backend may refuse or already be seeded */
        }
        await load();
      } catch {
        if (alive) setNoticeBad(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  // Live leagues this viewer may see (public ones, plus any private league they
  // host or hold a place in). `viewerId` is what keeps a private league private.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await fetchLeagues(user?.id);
        if (alive) setLeagues(rows.slice(0, 12));
      } catch {
        if (alive) setLeagues([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.id]);

  // Venues for the home-turf dropdowns — only courts that exist on the platform.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchVenues();
        if (alive) {
          setVenues(list.map((v) => ({ id: v.id, name: v.name, city: v.city })));
        }
      } catch {
        if (alive) setVenues([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Ask to join / withdraw. Asking no longer adds you to the squad — it files a
   * request the captain accepts or declines, so the button reports what is
   * really true. Each ask burns one of the day's five slots, which is why the
   * server's fresh `quota` is read back into state instead of guessed at.
   */
  async function toggleMembership(t: TeamCard) {
    if (!user) {
      router.push("/login");
      return;
    }
    setActing(t.id);
    setNotice("");
    setNoticeBad(false);
    try {
      const pending = t.viewer?.requestStatus === "pending";
      if (pending || t.viewer?.isMember) {
        const data = await leaveTeam(t.id, user.id);
        setNotice(
          data.cancelled
            ? `Request to join ${t.name} withdrawn`
            : data.left
              ? `You've stepped away from ${t.name}`
              : `You've stepped away from ${t.name}`,
        );
      } else {
        const data = await requestJoinTeam(t.id, user.id);
        if (data.quota) setQuota(data.quota);
        setNotice(
          data.alreadyMember
            ? `You're already in ${t.name} 🛡️`
            : `Request sent — ${t.name}'s captain will review it 👑` +
              (typeof data.quota?.left === "number"
                ? ` • ${data.quota.left} of ${data.quota.limit} asks left today`
                : ""),
        );
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work 🛡️");
      setNoticeBad(true);
    } finally {
      setActing(null);
      await load();
    }
  }

  /**
   * Answer an invitation ✅❌ — the mirror of `toggleMembership`, with the roles
   * swapped: the squad asked, so this player is the one who decides.
   */
  async function answerInvite(inviteId: number, teamName: string, action: "accept" | "decline") {
    if (!user) {
      setNoticeBad(true);
      setNotice("Login to answer an invitation 🔒");
      return;
    }
    setAnswering(inviteId);
    setNotice("");
    setNoticeBad(false);
    try {
      const data = await answerTeamInvite({ userId: user.id, inviteId, action });
      setNotice(
        data.alreadyMember
          ? `You're already in ${teamName} 🛡️`
          : action === "accept"
            ? `You're in ${teamName} 🎉 pick them as your team when you book a court`
            : `You declined ${teamName} — no hard feelings`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work 🛡️");
      setNoticeBad(true);
    } finally {
      setAnswering(null);
      await load();
    }
  }

  async function createTeamNow() {
    if (!user) return;
    const errs: Record<string, string> = {};
    const nErr = validateTitle(name, { min: 3, max: 50, label: "Team name" });
    if (nErr) errs.name = nErr;
    if (motto.trim()) {
      const mErr = validateMessage(motto.trim(), { min: 3, max: 120, label: "Motto", required: false });
      if (mErr) errs.motto = mErr;
    }
    if (description.trim()) {
      const dErr = validateTeamDescription(description.trim());
      if (dErr) errs.description = dErr;
    }
    const cErr = validateTeamCode(code);
    if (cErr) errs.code = cErr;
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setFormError(firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏");
      return;
    }
    setFieldErrors({});
    setFormError("");
    setCreating(true);
    try {
      const data = await createTeam({
        name: name.trim(),
        motto: motto.trim(),
        // Optional "about us" — players read it before asking to join.
        description: description.trim(),
        // Unique searchable handle — normalised here and again server-side.
        teamCode: normalizeTeamCode(code),
        captainId: user.id,
        level,
        logoColor: color,
        // A venue that exists on the platform, never free text.
        homeVenueId: Number(homeVenueId) || 0,
        maxPlayers: 12,
        lookingForPlayers: true,
      });
      setShowCreate(false);
      setName("");
      setMotto("");
      setDescription("");
      setCode("");
      setHomeVenueId("0");
      setFormError("");
      setNotice(
        `${data.team?.name ?? "Your team"} is live 🎉 Share the code ${
          data.team?.teamCode ?? ""
        } so other players can find you`,
      );
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't create team 🙏");
    } finally {
      setCreating(false);
      await load();
    }
  }

  const goTeam = (id: number) => router.push(`/teams/${id}`);
  const goPlayer = (id: number) => router.push(`/players/${id}`);
  const goLeagues = () =>
    router.push({ pathname: "/(app)/matches", params: { tab: "leagues" } });

  if (!ready) {
    return (
      <View style={[styles.stateBox, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* header */}
          <View style={styles.headerRow}>
            <View style={styles.grow}>
              <Text style={styles.eyebrow}>
                <Users size={14} color={tokens.orange500} /> FIND YOUR PEOPLE
              </Text>
              <Text style={[styles.h1, { color: c.text }]}>Teams & friendly leagues</Text>
              <Text style={[styles.sub, { color: c.textMuted }]}>
                {q
                  ? `${teams.length} squad${teams.length === 1 ? "" : "s"} matching "${q}"`
                  : `${teams.length} welcoming squads • every skill level has a home here`}
              </Text>
              {user && quota ? (
                <Text style={[styles.quotaLine, { color: c.textMuted }]}>
                  <Hourglass size={12} color={c.textMuted} />{" "}
                  {quota.left > 0 ? (
                    <>
                      {quota.left} of {quota.limit} join requests left today
                      <Text style={{ color: c.textFaint }}>
                        {" "}
                        • and a squad can send {quota.limit} invites a day
                      </Text>
                    </>
                  ) : (
                    <>You&apos;ve used all {quota.limit} join requests today — the count resets after midnight 🌙</>
                  )}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => (user ? setShowCreate(true) : router.push("/login"))}
              style={styles.startBtn}
            >
              <Plus size={16} color="#FFFFFF" strokeWidth={3} />
              <Text style={styles.startText}>Start a team</Text>
            </Pressable>
          </View>

          {/* search */}
          <View style={styles.searchRow}>
            <View
              style={[styles.searchBox, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <Search size={16} color={c.textFaint} />
              <TextInput
                value={find}
                onChangeText={setFind}
                onSubmitEditing={() => setQ(find)}
                returnKeyType="search"
                placeholder="Search a team code — e.g. CHARGERS-4X7K"
                placeholderTextColor={c.textFaint}
                autoCapitalize="characters"
                style={[styles.searchInput, { color: c.text }]}
              />
            </View>
            <Pressable onPress={() => setQ(find)} style={styles.searchBtn}>
              <Text style={styles.searchBtnText}>Search</Text>
            </Pressable>
            {q ? (
              <Pressable
                onPress={() => {
                  setQ("");
                  setFind("");
                }}
                style={[styles.clearBtn, { borderColor: c.border }]}
              >
                <X size={16} color={c.textMuted} />
                <Text style={[styles.clearText, { color: c.textMuted }]}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          {notice ? (
            <Text
              style={[
                styles.notice,
                noticeBad ? styles.noticeBad : styles.noticeGood,
              ]}
            >
              {notice}
            </Text>
          ) : null}

          {/* Open invitations 📨 */}
          {user && invites.length > 0 ? (
            <View style={styles.inviteBanner}>
              <Text style={styles.inviteBannerTitle}>
                <MailQuestion size={14} color={tokens.emerald700} /> Invitations for you
                <Text style={styles.inviteCount}> {invites.length}</Text>
              </Text>
              <Text style={styles.inviteBannerSub}>
                Nothing changes until you answer — accept to join, or decline and they&apos;ll know.
              </Text>
              <View style={styles.list}>
                {invites.map((i) => (
                  <View
                    key={i.id}
                    style={[styles.inviteCard, { backgroundColor: c.surface, borderColor: c.border }]}
                  >
                    <View style={[styles.inviteLogo, { backgroundColor: i.teamLogoColor }]}>
                      <Text style={styles.inviteLogoText}>{initials(i.teamName)}</Text>
                    </View>
                    <View style={styles.grow}>
                      <Pressable onPress={() => goTeam(i.teamId)}>
                        <Text style={[styles.inviteName, { color: c.text }]} numberOfLines={1}>
                          {i.teamName}
                          {i.teamCode ? (
                            <Text style={styles.codeChip}> {i.teamCode}</Text>
                          ) : null}
                        </Text>
                      </Pressable>
                      <Text style={[styles.inviteMeta, { color: c.textMuted }]} numberOfLines={1}>
                        {i.captainName} invited you • {i.memberCount}/{i.maxPlayers} in squad •{" "}
                        {i.teamLevel}
                      </Text>
                      {i.message ? (
                        <Text style={[styles.inviteMsg, { color: c.textMuted }]} numberOfLines={2}>
                          “{i.message}”
                        </Text>
                      ) : null}
                      {i.squadFull ? (
                        <Text style={styles.fullWarn}>
                          This squad is full — the captain has to raise the team size before you can
                          join 👥
                        </Text>
                      ) : null}
                      <Pressable onPress={() => goTeam(i.teamId)} style={styles.readFirst}>
                        <ArrowUpRight size={12} color={tokens.emerald700} />
                        <Text style={styles.readFirstText}>Read the full squad first</Text>
                      </Pressable>
                    </View>
                    <View style={styles.inviteActions}>
                      <Pressable
                        onPress={() => void answerInvite(i.id, i.teamName, "accept")}
                        disabled={answering === i.id || i.squadFull}
                        style={[
                          styles.acceptBtn,
                          answering === i.id || i.squadFull ? styles.dim : null,
                        ]}
                      >
                        <Check size={14} color="#FFFFFF" />
                        <Text style={styles.acceptText}>
                          {answering === i.id ? "One sec…" : "Accept"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void answerInvite(i.id, i.teamName, "decline")}
                        disabled={answering === i.id}
                        style={[styles.declineBtn, { borderColor: c.border }, answering === i.id ? styles.dim : null]}
                      >
                        <X size={14} color={c.textMuted} />
                        <Text style={[styles.declineText, { color: c.textMuted }]}>Decline</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {loading ? (
            <Spinner label="Loading squads…" />
          ) : (
            <>
              {/* League tables */}
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={styles.inlineBetween}>
                  <Text style={[styles.cardTitle, { color: tokens.emerald700 }]}>
                    <Trophy size={16} color={tokens.emerald700} /> League tables
                  </Text>
                  <Pressable onPress={goLeagues} style={styles.linkRow}>
                    <Text style={styles.linkText}>All leagues</Text>
                    <ArrowUpRight size={14} color={tokens.emerald700} />
                  </Pressable>
                </View>
                {leagues.length === 0 ? (
                  <View style={[styles.emptyBox, { borderColor: c.border }]}>
                    <Text style={[styles.emptyTitle, { color: c.text }]}>
                      No league is running right now 🏆
                    </Text>
                    <Text style={[styles.emptyBody, { color: c.textFaint }]}>
                      Anyone can host one — a player, a captain, or a ground owner. Pick a format,
                      set the entry fee and prize pool, then invite the squads.
                    </Text>
                    <Pressable onPress={goLeagues} style={styles.hostBtn}>
                      <Plus size={14} color="#FFFFFF" />
                      <Text style={styles.hostText}>Host a league</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.list}>
                    {leagues.slice(0, 3).map((l) => {
                      const status =
                        l.status === "registration"
                          ? { emoji: "📝", label: "Taking entries" }
                          : l.status === "ongoing"
                            ? { emoji: "⚽", label: "In progress" }
                            : l.status === "completed"
                              ? { emoji: "🏁", label: "Finished" }
                              : { emoji: "🚫", label: "Cancelled" };
                      const myTeamIds = (l.viewer?.myTeams ?? []).map((m) => m.teamId);
                      return (
                        <View key={l.id}>
                          <View style={styles.leagueHead}>
                            <Pressable
                              onPress={() => router.push(`/leagues/${l.id}`)}
                              style={styles.grow}
                            >
                              <Text style={[styles.leagueName, { color: c.text }]} numberOfLines={1}>
                                {l.name}
                              </Text>
                            </Pressable>
                            <Text style={styles.statusChip}>
                              {status.emoji} {status.label}
                            </Text>
                            {l.visibility === "private" ? (
                              <Text
                                style={[
                                  styles.privateChip,
                                  isDark && {
                                    backgroundColor: "rgba(245,158,11,0.15)",
                                    color: "#FCD34D",
                                  },
                                ]}
                              >
                                🔒 Private
                              </Text>
                            ) : null}
                            <Text style={[styles.leagueMeta, { color: c.textFaint }]}>
                              {l.format} • {l.approvedTeams}/{l.maxTeams} squads
                              {l.venueName ? ` • ${l.venueName}` : ""}
                            </Text>
                          </View>
                          <View style={styles.leagueTable}>
                            <LeagueTable
                              standings={l.standings}
                              highlightTeamIds={myTeamIds}
                              emptyHint="No results in yet — the table fills up as matches are played."
                            />
                          </View>
                        </View>
                      );
                    })}
                    {leagues.length > 3 ? (
                      <Pressable onPress={goLeagues} style={styles.moreLink}>
                        <Text style={styles.moreLinkText}>
                          +{leagues.length - 3} more league{leagues.length - 3 === 1 ? "" : "s"} →
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>

              {teams.length === 0 ? (
                <View style={[styles.emptyCard, { borderColor: c.border, backgroundColor: c.surface }]}>
                  <Text style={[styles.emptyTitle, { color: c.text }]}>
                    {q ? `No squad matches "${q}" yet` : "No squads on the platform yet"}
                  </Text>
                  <Text style={[styles.emptyBody, { color: c.textFaint }]}>
                    {q
                      ? "Check the code for typos — no spaces, and dashes count."
                      : "Be the first to start one 🎉"}
                  </Text>
                </View>
              ) : null}

              <View style={styles.grid}>
                {teams.map((t) => {
                  // The API tells us this viewer's relationship to the squad; fall
                  // back to the roster for a logged-out visitor.
                  const isCaptain = t.viewer?.isCaptain ?? (user ? t.captainId === user.id : false);
                  const member =
                    t.viewer?.isMember ?? t.players.some((p) => p.id === user?.id);
                  const pending = t.viewer?.requestStatus === "pending";
                  // An open invitation from this squad outranks everything: the captain
                  // has already said yes, so the player is only being asked to confirm.
                  const invited =
                    t.viewer?.inviteStatus === "pending" && t.viewer?.inviteId != null;
                  const winRate =
                    t.wins + t.losses + t.draws > 0
                      ? Math.round((t.wins / (t.wins + t.losses + t.draws)) * 100)
                      : 0;
                  return (
                    <View
                      key={t.id}
                      style={[styles.teamCard, { backgroundColor: c.surface, borderColor: c.border }]}
                    >
                      <View style={styles.teamHead}>
                        <View style={[styles.teamLogo, { backgroundColor: t.logoColor }]}>
                          <Text style={styles.teamLogoText}>{initials(t.name)}</Text>
                        </View>
                        <View style={styles.grow}>
                          <View style={styles.inlineRow}>
                            <Pressable onPress={() => goTeam(t.id)} style={styles.grow}>
                              <Text style={[styles.teamName, { color: c.text }]} numberOfLines={1}>
                                {t.name}
                              </Text>
                            </Pressable>
                            {t.lookingForPlayers ? (
                              <Text style={styles.welcoming}>● Welcoming new friends</Text>
                            ) : null}
                          </View>
                          <Text style={[styles.motto, { color: c.textFaint }]} numberOfLines={1}>
                            "{t.motto || "Come play with us!"}"
                          </Text>
                          {t.description ? (
                            <>
                              <Text style={[styles.desc, { color: c.textMuted }]} numberOfLines={3}>
                                {t.description}
                              </Text>
                              <Pressable onPress={() => goTeam(t.id)} style={styles.readFirst}>
                                <ArrowUpRight size={12} color={tokens.emerald700} />
                                <Text style={styles.readFirstText}>Read the full squad page</Text>
                              </Pressable>
                            </>
                          ) : null}
                          <View style={styles.metaRow}>
                            <Text style={[styles.metaText, { color: c.textMuted }]}>
                              <Crown size={12} color={tokens.amber400} /> {t.captainName} • {t.level}
                            </Text>
                            {t.teamCode ? (
                              <Text style={styles.codeChip} numberOfLines={1}>
                                <Hash size={10} color={c.textMuted} /> {t.teamCode}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      </View>

                      <View style={styles.statGrid}>
                        {[
                          { l: "Wins", v: String(t.wins) },
                          { l: "Draws", v: String(t.draws) },
                          { l: "Losses", v: String(t.losses) },
                          { l: "Win %", v: `${winRate}%` },
                        ].map((s) => (
                          <View key={s.l} style={[styles.statCell, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : tokens.insetCream }]}>
                            <Text style={[styles.statValue, { color: c.text }]}>{s.v}</Text>
                            <Text style={[styles.statLabel, { color: c.textFaint }]}>{s.l}</Text>
                          </View>
                        ))}
                      </View>

                      {t.homeGround ? (
                        <Text style={[styles.homeLine, { color: c.textMuted }]}>
                          <MapPin size={14} color={c.textMuted} /> Home turf: {t.homeGround}
                        </Text>
                      ) : null}

                      <View style={styles.rosterRow}>
                        <View style={styles.avatarStack}>
                          {t.players.slice(0, 6).map((p) => (
                            <Pressable
                              key={p.id}
                              onPress={() => goPlayer(p.id)}
                              accessibilityLabel={`${p.name} (${p.position}) — full details`}
                              style={[
                                styles.stackItem,
                                { borderColor: c.surface, backgroundColor: c.surface },
                              ]}
                            >
                              <Avatar
                                user={{
                                  name: p.name,
                                  avatarColor: p.avatarColor,
                                  avatarUrl: p.avatarUrl,
                                }}
                                size={32}
                              />
                            </Pressable>
                          ))}
                          {t.memberCount > 6 ? (
                            <View
                              style={[
                                styles.moreCount,
                                { borderColor: c.surface, backgroundColor: c.inset },
                              ]}
                            >
                              <Text style={[styles.moreCountText, { color: c.textMuted }]}>
                                +{t.memberCount - 6}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.rosterRight}>
                          <Text style={[styles.metaText, { color: c.textMuted }]}>
                            <Shield size={14} color={c.textMuted} /> {t.memberCount}/{t.maxPlayers} mates
                          </Text>
                          <Pressable
                            onPress={() => goTeam(t.id)}
                            style={[styles.fullPageBtn, { borderColor: c.border }]}
                          >
                            <ArrowUpRight size={12} color={c.textMuted} />
                            <Text style={[styles.fullPageText, { color: c.textMuted }]}>Full page</Text>
                          </Pressable>
                        </View>
                      </View>

                      {isCaptain ? (
                        <>
                          <Pressable onPress={() => setManaging(t)} style={styles.manageBtn}>
                            <Settings size={16} color="#FFFFFF" />
                            <Text style={styles.manageText}>Manage your squad</Text>
                            {t.pendingRequests > 0 ? (
                              <Text style={styles.manageBadge}>
                                <Hourglass size={10} color="#FFFFFF" /> {t.pendingRequests} waiting
                              </Text>
                            ) : null}
                            {t.pendingInvites > 0 ? (
                              <Text style={styles.manageBadge}>
                                <Send size={10} color="#FFFFFF" /> {t.pendingInvites} invited
                              </Text>
                            ) : null}
                          </Pressable>
                          <Text style={[styles.caption, { color: c.textFaint }]}>
                            👑 You captain this squad — a team always has exactly one captain, so
                            hand over the armband in Manage before stepping away
                          </Text>
                          <Text style={[styles.caption, { color: c.textFaint }]}>
                            <Send size={10} color={c.textFaint} />{" "}
                            {t.invitesLeftToday > 0
                              ? `Invite ${t.invitesLeftToday} more player${
                                  t.invitesLeftToday === 1 ? "" : "s"
                                } today — nobody joins without saying yes`
                              : "5 invites already sent today — the count resets at midnight 🌙"}
                          </Text>
                        </>
                      ) : invited ? (
                        <View style={styles.invitedBox}>
                          <Text style={styles.invitedTitle}>
                            <Send size={12} color={tokens.emerald700} /> {t.captainName} invited you
                            🎉
                          </Text>
                          <Text style={styles.invitedSub}>
                            Nothing changes until you answer. Accept to join the squad, or decline
                            and they&apos;ll know.
                          </Text>
                          <View style={styles.inviteActions}>
                            <Pressable
                              onPress={() =>
                                t.viewer?.inviteId &&
                                void answerInvite(t.viewer.inviteId, t.name, "accept")
                              }
                              disabled={acting === t.id || t.memberCount >= t.maxPlayers}
                              style={[
                                styles.acceptWide,
                                acting === t.id || t.memberCount >= t.maxPlayers
                                  ? styles.dim
                                  : null,
                              ]}
                            >
                              <Check size={14} color="#FFFFFF" />
                              <Text style={styles.acceptText}>Accept &amp; join</Text>
                            </Pressable>
                            <Pressable
                              onPress={() =>
                                t.viewer?.inviteId &&
                                void answerInvite(t.viewer.inviteId, t.name, "decline")
                              }
                              disabled={acting === t.id}
                              style={[styles.declineBtn, { borderColor: c.border }, acting === t.id ? styles.dim : null]}
                            >
                              <X size={14} color={c.textMuted} />
                              <Text style={[styles.declineText, { color: c.textMuted }]}>Decline</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => void toggleMembership(t)}
                          disabled={acting === t.id}
                          style={[
                            styles.joinBtn,
                            pending
                              ? [
                                  styles.joinPending,
                                  isDark && {
                                    backgroundColor: "rgba(245,158,11,0.12)",
                                    borderColor: "rgba(245,158,11,0.35)",
                                  },
                                ]
                              : member
                                ? styles.joinMember
                                : styles.joinAsk,
                            acting === t.id ? styles.dim : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.joinText,
                              { color: pending || member ? c.textMuted : "#FFFFFF" },
                            ]}
                          >
                            {acting === t.id
                              ? "One sec…"
                              : pending
                                ? "Request pending ⏳ — tap to withdraw"
                                : member
                                  ? "Take a break from team"
                                  : quota && quota.left <= 0
                                    ? "Daily join limit reached 🌙"
                                    : "Request to join 🛡️"}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* create modal */}
      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowCreate(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.kav}>
            <View style={[styles.sheet, { backgroundColor: c.surface }]}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <View style={styles.sheetHead}>
                  <View style={styles.grow}>
                    <Text style={[styles.sheetTitle, { color: c.text }]}>
                      Start your own crew 🎉
                    </Text>
                    <Text style={[styles.sheetSub, { color: c.textMuted }]}>
                      Every great team starts with one friend.
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setShowCreate(false)}
                    style={[styles.close, { backgroundColor: c.inset }]}
                  >
                    <X size={16} color={c.textMuted} />
                  </Pressable>
                </View>

                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Team name</Text>
                <TextInput
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    setFieldErrors((p) => ({ ...p, name: "" }));
                  }}
                  placeholder="e.g. Sunday Smiles FC"
                  placeholderTextColor={c.textFaint}
                  maxLength={50}
                  style={[
                    styles.input,
                    {
                      backgroundColor: inputFill,
                      borderColor: fieldErrors.name ? tokens.red400 : c.border,
                      color: c.text,
                    },
                  ]}
                />
                {fieldErrors.name ? (
                  <Text style={styles.fieldError}>{fieldErrors.name}</Text>
                ) : (
                  <Text style={[styles.hint, { color: c.textFaint }]}>
                    {name.trim().length}/50 • min 3 ✨
                  </Text>
                )}

                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Team motto</Text>
                <TextInput
                  value={motto}
                  onChangeText={(t) => {
                    setMotto(t);
                    setFieldErrors((p) => ({ ...p, motto: "" }));
                  }}
                  placeholder="e.g. Play happy, win happy"
                  placeholderTextColor={c.textFaint}
                  maxLength={120}
                  style={[
                    styles.input,
                    {
                      backgroundColor: inputFill,
                      borderColor: fieldErrors.motto ? tokens.red400 : c.border,
                      color: c.text,
                    },
                  ]}
                />
                {fieldErrors.motto ? <Text style={styles.fieldError}>{fieldErrors.motto}</Text> : null}

                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>
                  About your squad — optional
                </Text>
                <TextInput
                  value={description}
                  onChangeText={(t) => {
                    setDescription(t);
                    setFieldErrors((p) => ({ ...p, description: "" }));
                  }}
                  multiline
                  maxLength={TEAM_DESCRIPTION_MAX}
                  placeholder="Training nights, who pays for the court, whether beginners get game time…"
                  placeholderTextColor={c.textFaint}
                  style={[
                    styles.input,
                    styles.textarea,
                    {
                      backgroundColor: inputFill,
                      borderColor: fieldErrors.description ? tokens.red400 : c.border,
                      color: c.text,
                    },
                  ]}
                />
                {fieldErrors.description ? (
                  <Text style={styles.fieldError}>{fieldErrors.description}</Text>
                ) : (
                  <Text style={[styles.hint, { color: c.textFaint }]}>
                    {description.trim().length}/{TEAM_DESCRIPTION_MAX} • players read this before
                    they ask to join, and captains write it once ✍️
                  </Text>
                )}

                <Text style={[styles.fieldLabel, styles.fieldLabelRow, { color: c.textFaint }]}>
                  <Hash size={12} color={c.textFaint} /> Team code — unique
                </Text>
                <View style={styles.codeRow}>
                  <TextInput
                    value={code}
                    onChangeText={(t) => {
                      setCode(t.toUpperCase());
                      setFieldErrors((p) => ({ ...p, code: "", teamCode: "" }));
                    }}
                    placeholder="CHARGERS-4X7K"
                    placeholderTextColor={c.textFaint}
                    maxLength={24}
                    autoCapitalize="characters"
                    style={[
                      styles.input,
                      styles.grow,
                      styles.monoInput,
                      {
                        backgroundColor: inputFill,
                        borderColor:
                          fieldErrors.teamCode || fieldErrors.code ? tokens.red400 : c.border,
                        color: c.text,
                      },
                    ]}
                  />
                  <Pressable
                    onPress={() => setCode(suggestTeamCode(name))}
                    accessibilityLabel="Generate a code from the team name"
                    style={[styles.iconBtn, { borderColor: c.border }]}
                  >
                    <Dice5 size={16} color={c.textMuted} />
                  </Pressable>
                </View>
                {fieldErrors.teamCode || fieldErrors.code ? (
                  <Text style={styles.fieldError}>{fieldErrors.teamCode || fieldErrors.code}</Text>
                ) : (
                  <Text style={[styles.hint, { color: c.textFaint }]}>
                    Optional — leave it blank and we&apos;ll generate one. Letters, numbers and
                    dashes only, 4–24 chars. Teammates search this exact code to find you 🔎
                  </Text>
                )}

                <View style={styles.twoCol}>
                  <View style={styles.grow}>
                    <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Level</Text>
                    <View style={[styles.pickerWrap, { backgroundColor: inputFill, borderColor: c.border }]}>
                      <Picker
                        selectedValue={level}
                        onValueChange={(v) => setLevel(String(v))}
                        style={{ color: c.text }}
                      >
                        {LEVELS.map((l) => (
                          <Picker.Item key={l} label={l} value={l} />
                        ))}
                      </Picker>
                    </View>
                  </View>
                  <View style={styles.grow}>
                    <Text style={[styles.fieldLabel, styles.fieldLabelRow, { color: c.textFaint }]}>
                      <MapPin size={12} color={c.textFaint} /> Home turf
                    </Text>
                    <View style={[styles.pickerWrap, { backgroundColor: inputFill, borderColor: c.border }]}>
                      <Picker
                        selectedValue={homeVenueId}
                        onValueChange={(v) => setHomeVenueId(String(v))}
                        style={{ color: c.text }}
                      >
                        <Picker.Item label="No home turf yet" value="0" />
                        {venues.map((v) => (
                          <Picker.Item
                            key={v.id}
                            label={`${v.name} — ${v.city}`}
                            value={String(v.id)}
                          />
                        ))}
                      </Picker>
                    </View>
                    <Text style={[styles.hint, { color: c.textFaint }]}>
                      {venues.length > 0
                        ? `From the platform's ${venues.length} venues 📍`
                        : "No venues yet — set it later"}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.fieldLabel, { color: c.textFaint }]}>Pick your colours</Text>
                <View style={styles.swatches}>
                  {COLORS.map((sw) => (
                    <Pressable
                      key={sw}
                      onPress={() => setColor(sw)}
                      accessibilityLabel={sw}
                      style={[
                        styles.swatch,
                        {
                          backgroundColor: sw,
                          borderColor: color === sw ? tokens.emerald500 : "transparent",
                        },
                      ]}
                    />
                  ))}
                </View>

                {formError ? <Notice message={formError} /> : null}

                <Pressable
                  onPress={() => void createTeamNow()}
                  disabled={creating}
                  style={[styles.createBtn, creating ? styles.dim : null]}
                >
                  <Text style={styles.createText}>
                    {creating ? "Gathering the crew…" : "Create my team 🎉"}
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Captain's control panel 👑 — only ever mounted for the squad's captain. */}
      {managing && user ? (
        <TeamManager
          team={{
            id: managing.id,
            name: managing.name,
            motto: managing.motto,
            description: managing.description ?? "",
            teamCode: managing.teamCode ?? "",
            level: managing.level,
            logoColor: managing.logoColor,
            maxPlayers: managing.maxPlayers,
            homeGround: managing.homeGround,
            homeVenueId: managing.homeVenueId,
            lookingForPlayers: managing.lookingForPlayers,
            captainId: managing.captainId,
          }}
          captainId={user.id}
          onClose={() => setManaging(null)}
          onChanged={async () => {
            const fresh = await load();
            const stillCaptain =
              fresh.find((t) => t.id === managing.id)?.viewer?.isCaptain ?? false;
            if (!stillCaptain) {
              setManaging(null);
              setNoticeBad(false);
              setNotice("Armband handed over 👑 you're a regular member of the squad now");
            }
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  content: { padding: space[4], paddingBottom: space[16] },
  stateBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.45 },
  list: { marginTop: space[3], gap: space[2] },

  headerRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: space[3] },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
    color: tokens.orange500,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  h1: { fontSize: fontSize["3xl"], fontWeight: "900", marginTop: 4 },
  sub: { fontSize: fontSize.base, marginTop: 4 },
  quotaLine: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: tokens.emerald600,
    borderRadius: radius["2xl"],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    shadowColor: "rgba(0,0,0,0.2)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  startText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },

  searchRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[5] },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderWidth: 1,
    borderRadius: radius["2xl"],
    paddingHorizontal: space[3],
    minHeight: 48,
    flexGrow: 1,
    minWidth: 180,
  },
  searchInput: { flex: 1, fontSize: fontSize.base, fontWeight: "600", paddingVertical: 10 },
  searchBtn: {
    backgroundColor: tokens.stone900,
    borderRadius: radius["2xl"],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    justifyContent: "center",
  },
  searchBtnText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  clearText: { fontSize: fontSize.base, fontWeight: "900" },

  notice: {
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: fontSize.xs,
    fontWeight: "700",
    marginTop: space[3],
  },
  noticeBad: { backgroundColor: tokens.red50, color: tokens.red600 },
  noticeGood: { backgroundColor: tokens.emerald50, color: tokens.emerald700 },

  inviteBanner: {
    marginTop: space[5],
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderColor: "#A7F3D0",
    backgroundColor: isDarkInviteBg(),
    padding: space[4],
  },
  inviteBannerTitle: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: tokens.emerald700,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inviteCount: {
    backgroundColor: tokens.emerald600,
    color: "#FFFFFF",
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 1,
    fontSize: fontSize["2xs"],
    marginLeft: 4,
  },
  inviteBannerSub: { fontSize: fontSize.xs, fontWeight: "600", color: tokens.stone500, marginTop: 4 },

  inviteCard: {
    borderWidth: 1,
    borderRadius: radius["2xl"],
    padding: space[3],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[3],
  },
  inviteLogo: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteLogoText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FFFFFF" },
  inviteName: { fontSize: fontSize.base, fontWeight: "900" },
  inviteMeta: { fontSize: fontSize.xs, fontWeight: "600", marginTop: 2 },
  inviteMsg: { fontSize: fontSize.xs, fontStyle: "italic", marginTop: 4 },
  fullWarn: { fontSize: fontSize.xs, fontWeight: "700", color: "#B45309", marginTop: 4 },
  inviteActions: { flexDirection: "row", gap: 6, marginLeft: "auto" },
  readFirst: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 6 },
  readFirstText: { fontSize: fontSize.xs, fontWeight: "900", color: tokens.emerald700 },

  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: tokens.emerald600,
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  acceptWide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flex: 1,
    backgroundColor: tokens.emerald600,
    borderRadius: radius.xl,
    paddingVertical: 10,
  },
  acceptText: { fontSize: fontSize.xs, fontWeight: "900", color: "#FFFFFF" },
  declineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  declineText: { fontSize: fontSize.xs, fontWeight: "900" },

  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[5],
    marginTop: space[6],
    shadowColor: "rgba(180,120,60,0.08)",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 1,
  },
  cardTitle: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inlineBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
    flexWrap: "wrap",
  },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  linkText: { fontSize: fontSize.xs, fontWeight: "900", color: tokens.emerald700 },

  emptyBox: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[5],
    alignItems: "center",
    marginTop: space[3],
  },
  emptyTitle: { fontSize: fontSize.base, fontWeight: "900", textAlign: "center" },
  emptyBody: { fontSize: fontSize.sm, fontWeight: "600", textAlign: "center", marginTop: 4 },
  hostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: tokens.emerald600,
    borderRadius: radius.full,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    marginTop: space[3],
  },
  hostText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FFFFFF" },

  leagueHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: space[3] },
  leagueName: { fontSize: fontSize.base, fontWeight: "900" },
  statusChip: {
    fontSize: 10,
    fontWeight: "900",
    backgroundColor: tokens.stone100,
    color: tokens.stone600,
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  privateChip: {
    fontSize: 10,
    fontWeight: "900",
    backgroundColor: "#FEF3C7",
    color: "#B45309",
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  leagueMeta: { fontSize: fontSize.xs, fontWeight: "700" },
  leagueTable: { marginTop: space[2] },
  moreLink: { alignItems: "center", paddingVertical: space[2] },
  moreLinkText: { fontSize: fontSize.xs, fontWeight: "900", color: tokens.emerald700 },

  emptyCard: {
    marginTop: space[6],
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[8],
    alignItems: "center",
  },

  grid: { marginTop: space[6], gap: space[4] },
  teamCard: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[5],
    shadowColor: "rgba(180,120,60,0.08)",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 1,
  },
  teamHead: { flexDirection: "row", gap: space[3] },
  teamLogo: {
    width: 56,
    height: 56,
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  teamLogoText: { fontSize: fontSize.lg, fontWeight: "900", color: "#FFFFFF" },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  teamName: { fontSize: fontSize.md, fontWeight: "800" },
  welcoming: {
    fontSize: 10,
    fontWeight: "900",
    color: tokens.emerald700,
    backgroundColor: tokens.emerald100,
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
    flexShrink: 0,
  },
  motto: { fontSize: fontSize.xs, fontStyle: "italic", marginTop: 2 },
  desc: { fontSize: fontSize.xs, lineHeight: 17, marginTop: 6 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 },
  metaText: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  codeChip: {
    fontSize: 10,
    fontWeight: "900",
    backgroundColor: tokens.stone100,
    color: tokens.stone600,
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },

  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: space[4] },
  statCell: { flexGrow: 1, minWidth: 70, borderRadius: radius.xl, paddingVertical: 8, alignItems: "center" },
  statValue: { fontSize: fontSize.base, fontWeight: "900" },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  homeLine: {
    fontSize: fontSize.xs,
    marginTop: space[3],
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  rosterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space[3],
    gap: space[2],
    flexWrap: "wrap",
  },
  avatarStack: { flexDirection: "row" },
  stackItem: { borderRadius: 18, borderWidth: 2, marginRight: -8 },
  moreCount: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  moreCountText: { fontSize: 10, fontWeight: "900" },
  rosterRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  fullPageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fullPageText: { fontSize: 10, fontWeight: "900" },

  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexWrap: "wrap",
    backgroundColor: tokens.amber400,
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
    marginTop: space[4],
  },
  manageText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  manageBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: "900",
    color: "#FFFFFF",
    overflow: "hidden",
  },
  caption: {
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 14,
    marginTop: 6,
  },

  invitedBox: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: "#A7F3D0",
    backgroundColor: "rgba(16,185,129,0.06)",
    padding: space[3],
    marginTop: space[3],
  },
  invitedTitle: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    color: tokens.emerald700,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  invitedSub: { fontSize: 10, fontWeight: "600", color: tokens.stone500, marginTop: 2, lineHeight: 14 },
  joinBtn: {
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
    alignItems: "center",
    marginTop: space[4],
  },
  joinAsk: { backgroundColor: tokens.emerald600 },
  joinPending: {
    borderWidth: 1,
    borderColor: "#FCD34D",
    backgroundColor: "#FFFBEB",
  },
  joinMember: {
    borderWidth: 1,
    borderColor: tokens.stone200,
    backgroundColor: tokens.stone50,
  },
  joinText: { fontSize: fontSize.base, fontWeight: "900" },

  /* create modal */
  backdrop: { flex: 1, backgroundColor: "rgba(28,25,23,0.5)", justifyContent: "flex-end" },
  kav: { maxHeight: "92%" },
  sheet: {
    borderTopLeftRadius: radius["3xl"],
    borderTopRightRadius: radius["3xl"],
    padding: space[5],
    paddingBottom: space[10],
  },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  sheetTitle: { fontSize: fontSize.xl, fontWeight: "900" },
  sheetSub: { fontSize: fontSize.sm, marginTop: 2 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: space[3],
    marginBottom: 6,
  },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  input: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.base,
    fontWeight: "600",
    minHeight: 44,
  },
  textarea: { minHeight: 88, textAlignVertical: "top" },
  fieldError: { fontSize: fontSize.xs, fontWeight: "700", color: tokens.red500, marginTop: 4 },
  hint: { fontSize: fontSize.xs, marginTop: 4, lineHeight: 15 },
  monoInput: { letterSpacing: 1 },
  codeRow: { flexDirection: "row", gap: space[2], alignItems: "center" },
  iconBtn: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  twoCol: { flexDirection: "row", gap: space[3] },
  pickerWrap: { borderWidth: 1, borderRadius: radius.xl, overflow: "hidden", minHeight: 44 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
  createBtn: {
    backgroundColor: tokens.emerald600,
    borderRadius: radius["2xl"],
    paddingVertical: 14,
    alignItems: "center",
    marginTop: space[5],
  },
  createText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
});

/** Emerald invitation wash — same tint the web uses on the banner. */
function isDarkInviteBg(): string {
  return "rgba(236,253,245,0.7)";
}
