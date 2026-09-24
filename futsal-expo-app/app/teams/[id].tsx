import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Check,
  Crown,
  Hash,
  Hourglass,
  LogIn,
  MailQuestion,
  MapPin,
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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  answerTeamInvite,
  fetchTeam,
  leaveTeam,
  requestJoinTeam,
  teamRequestAction,
  withdrawTeamInvite,
} from "@/api";
import { Avatar } from "@/components/Avatar";
import { Notice, Spinner } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { timeAgo } from "@/lib/time";
import { initials } from "@/lib/futsal";
import type { TeamCompetitionProfile, TeamDetail } from "@/lib/types";
import { colors as tokens, fontSize, radius, space } from "@/theme";

/**
 * One squad, in full 🛡️ — a 1:1 port of the web app's app/teams/[id]/page.tsx.
 *
 * The list page has to fit a dozen teams on a screen, so a card can only show a
 * clamped line. This page is what a player should read before asking to join —
 * or before answering an invitation: the whole description, the record, every
 * name in the squad (each one a link to that player's dossier), and the button
 * that matches the truth of where they stand.
 *
 * The web's `lg` two-column? There isn't one — same single scroll as the original.
 */
export default function TeamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: c, isDark } = useTheme();
  const { user } = useAuth();
  const inputFill = isDark ? "rgba(255,255,255,0.05)" : tokens.insetCream;

  const [data, setData] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeBad, setNoticeBad] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await fetchTeam(Number(id), user?.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that squad 🛡️");
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, run: () => Promise<unknown>, okMsg: string) {
    setBusy(key);
    setNotice("");
    setNoticeBad(false);
    try {
      await run();
      setNotice(okMsg);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work 🛡️");
      setNoticeBad(true);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <View style={[styles.stateBox, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" color={c.primary} />
        <Text style={[styles.stateSub, { color: c.textMuted }]}>Loading the squad…</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.stateBox, { backgroundColor: c.bg }]}>
        <Text style={[styles.stateTitle, { color: c.text }]}>{error || "No such squad 🛡️"}</Text>
        <Pressable onPress={() => router.replace("/teams")} style={styles.backBtn}>
          <ArrowLeft size={16} color="#FFFFFF" />
          <Text style={styles.backBtnText}>Back to teams</Text>
        </Pressable>
      </View>
    );
  }

  const { team, roster, viewer } = data;
  const captain = data.captain;
  // Older responses (or a squad nobody has competed against yet) carry an empty
  // profile rather than null, so the section can be skipped with one check.
  const comp: TeamCompetitionProfile = data.competition ?? {
    record: {
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
      form: [],
    },
    leagues: [],
    results: [],
  };
  const pendingInvite =
    viewer?.inviteStatus === "pending" && viewer?.inviteId ? viewer.inviteId : null;
  const requested = viewer?.requestStatus === "pending";
  const squadFull = roster.length >= team.maxPlayers;
  const goPlayer = (pid: number) => router.push(`/players/${pid}`);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.replace("/teams")} style={styles.backLink}>
          <ArrowLeft size={14} color={c.textMuted} />
          <Text style={[styles.backLinkText, { color: c.textMuted }]}>ALL TEAMS</Text>
        </Pressable>

        {notice ? (
          <Text style={[styles.notice, noticeBad ? styles.noticeBad : styles.noticeGood]}>
            {notice}
          </Text>
        ) : null}

        {/* ------------------------------------------------------- the squad */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.headRow}>
            <View style={[styles.logo, { backgroundColor: team.logoColor }]}>
              <Text style={styles.logoText}>{initials(team.name)}</Text>
            </View>
            <View style={styles.grow}>
              <View style={styles.inlineWrap}>
                <Text style={[styles.title, { color: c.text }]}>{team.name}</Text>
                {team.lookingForPlayers ? (
                  <Text style={styles.welcoming}>● Welcoming new friends</Text>
                ) : null}
              </View>
              <Text style={[styles.motto, { color: c.textFaint }]}>
                "{team.motto || "Come play with us!"}"
              </Text>
              <View style={styles.chipRow}>
                <Text style={[styles.chip, { backgroundColor: c.inset, color: c.textMuted }]}>
                  {team.level}
                </Text>
                {team.teamCode ? (
                  <Text style={[styles.chip, styles.mono, { backgroundColor: c.inset, color: c.textMuted }]}>
                    <Hash size={12} color={c.textMuted} /> {team.teamCode}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => goPlayer(team.captainId)}
                  style={[styles.chip, { backgroundColor: c.inset }]}
                >
                  <Crown size={12} color={tokens.amber400} />
                  <Text style={[styles.chipText, { color: c.textMuted }]}>{team.captainName}</Text>
                </Pressable>
                {team.homeGround ? (
                  <Pressable
                    onPress={() =>
                      team.homeVenueId ? router.push(`/venues/${team.homeVenueId}`) : undefined
                    }
                    style={[styles.chip, { backgroundColor: c.inset }]}
                  >
                    <MapPin size={12} color={c.textMuted} />
                    <Text style={[styles.chipText, { color: c.textMuted }]}>{team.homeGround}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>

          {/* The whole thing — no clamping, no tooltip, no "read more". */}
          {team.description ? (
            <Text style={[styles.desc, { backgroundColor: inputFill, color: isDark ? c.text : tokens.stone700 }]}>
              {team.description}
            </Text>
          ) : (
            <Text style={[styles.descEmpty, { borderColor: c.border, color: c.textFaint }]}>
              {viewer?.isCaptain
                ? "You haven't written a description yet — players read this before asking to join, so a couple of lines about training nights and how you split the bill goes a long way ✍️"
                : "This squad hasn't written a description yet — ask the captain what to expect 🤝"}
            </Text>
          )}

          <View style={styles.statGrid}>
            {[
              { l: "Record", v: `${team.wins}W ${team.draws}D ${team.losses}L` },
              { l: "Win rate", v: `${team.winRate}%` },
              { l: "Games played", v: String(team.gamesPlayed) },
              { l: "Squad size", v: `${roster.length}/${team.maxPlayers}` },
            ].map((s) => (
              <View
                key={s.l}
                style={[styles.statCell, { backgroundColor: inputFill }]}
              >
                <Text style={[styles.statValue, { color: c.text }]}>{s.v}</Text>
                <Text style={[styles.statLabel, { color: c.textFaint }]}>{s.l}</Text>
              </View>
            ))}
          </View>

          {/* ---------------------------------------------------- your move */}
          <View style={styles.moveBox}>
            {!user ? (
              <Pressable onPress={() => router.push("/login")} style={styles.loginBtn}>
                <LogIn size={16} color="#FFFFFF" />
                <Text style={styles.loginText}>Log in to see your standing with this squad</Text>
              </Pressable>
            ) : viewer?.isCaptain ? (
              <View>
                <Pressable onPress={() => router.replace("/teams")} style={styles.manageLink}>
                  <Settings size={16} color="#FFFFFF" />
                  <Text style={styles.manageLinkText}>Manage your squad</Text>
                </Pressable>
                <Text style={[styles.caption, { color: c.textFaint }]}>
                  <Send size={10} color={c.textFaint} /> {captain?.quota.left ?? 0} of{" "}
                  {captain?.quota.limit ?? 5} invites left today
                </Text>
              </View>
            ) : pendingInvite ? (
              <View style={styles.invitedBox}>
                <Text style={styles.invitedTitle}>
                  <Send size={16} color={tokens.emerald700} /> {team.captainName} invited you to join
                  🎉
                </Text>
                <Text style={styles.invitedSub}>
                  Nothing changes until you answer. Read the roster and the description above — that
                  is who you would be playing with.
                </Text>
                <View style={styles.inviteActions}>
                  <Pressable
                    onPress={() =>
                      void act(
                        "accept",
                        () =>
                          answerTeamInvite({
                            userId: user.id,
                            inviteId: pendingInvite,
                            action: "accept",
                          }),
                        `You're in ${team.name} 🎉`,
                      )
                    }
                    disabled={busy === "accept" || squadFull}
                    style={[styles.acceptWide, busy === "accept" || squadFull ? styles.dim : null]}
                  >
                    <Check size={16} color="#FFFFFF" />
                    <Text style={styles.acceptText}>
                      {busy === "accept" ? "One sec…" : "Accept & join"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      void act(
                        "decline",
                        () =>
                          answerTeamInvite({
                            userId: user.id,
                            inviteId: pendingInvite,
                            action: "decline",
                          }),
                        `You declined ${team.name}`,
                      )
                    }
                    disabled={busy === "decline"}
                    style={[styles.declineBtn, { borderColor: c.border }, busy === "decline" ? styles.dim : null]}
                  >
                    <X size={16} color={c.textMuted} />
                    <Text style={[styles.declineText, { color: c.textMuted }]}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  multiline
                  maxLength={200}
                  placeholder="Optional note for the captain — a line about how you play goes a long way"
                  placeholderTextColor={c.textFaint}
                  style={[styles.noteInput, { backgroundColor: inputFill, borderColor: c.border, color: c.text }]}
                />
                <View style={styles.moveActions}>
                  {requested ? (
                    <Pressable
                      onPress={() =>
                        void act(
                          "withdraw",
                          () => leaveTeam(team.id, user.id),
                          `Request to join ${team.name} withdrawn`,
                        )
                      }
                      disabled={busy === "withdraw"}
                      style={[
                        styles.withdrawBtn,
                        isDark && {
                          backgroundColor: "rgba(245,158,11,0.12)",
                          borderColor: "rgba(245,158,11,0.35)",
                        },
                        busy === "withdraw" ? styles.dim : null,
                      ]}
                    >
                      <Hourglass size={16} color={isDark ? "#FCD34D" : "#B45309"} />
                      <Text
                        style={[
                          styles.withdrawText,
                          isDark && { color: "#FCD34D" },
                        ]}
                      >
                        Request pending ⏳ — tap to withdraw
                      </Text>
                    </Pressable>
                  ) : viewer?.isMember ? (
                    <Pressable
                      onPress={() =>
                        void act(
                          "leave",
                          () => leaveTeam(team.id, user.id),
                          `You've stepped away from ${team.name}`,
                        )
                      }
                      disabled={busy === "leave"}
                      style={[styles.memberBtn, { borderColor: c.border }, busy === "leave" ? styles.dim : null]}
                    >
                      <Text style={[styles.memberText, { color: c.textMuted }]}>
                        Take a break from the team
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() =>
                        void act(
                          "ask",
                          () => requestJoinTeam(team.id, user.id, note.trim()),
                          `Request sent — ${team.name}'s captain will review it 👑`,
                        )
                      }
                      disabled={busy === "ask" || squadFull}
                      style={[styles.askBtn, busy === "ask" || squadFull ? styles.dim : null]}
                    >
                      <Text style={styles.askText}>
                        {busy === "ask"
                          ? "Sending…"
                          : squadFull
                            ? "Squad is full 👥"
                            : "Request to join 🛡️"}
                      </Text>
                    </Pressable>
                  )}
                </View>
                <Text style={[styles.caption, { color: c.textFaint }]}>
                  A captain accepts or declines you — five asks a day each way keeps it fair for
                  both sides 🌙
                </Text>
              </>
            )}
          </View>
        </View>

        {/* ---------------------------------------------------- captain's queue */}
        {viewer?.isCaptain && captain ? (
          <View style={[styles.card, styles.amberCard]}>
            <Text style={styles.amberTitle}>
              <Users size={14} color="#B45309" /> Players waiting on you •{" "}
              {captain.pendingRequests.length}
            </Text>
            {captain.pendingRequests.length === 0 ? (
              <Text style={[styles.hint, { color: c.textMuted }]}>
                Nobody waiting right now 🎉 Share the code {team.teamCode || "—"} so players can find
                you.
              </Text>
            ) : (
              <View style={styles.list}>
                {captain.pendingRequests.map((r) => (
                  <View
                    key={r.id}
                    style={[styles.rowCard, { backgroundColor: c.surface, borderColor: c.border }]}
                  >
                    <Pressable onPress={() => goPlayer(r.userId)}>
                      <Avatar
                        user={{ name: r.name, avatarColor: r.avatarColor, avatarUrl: r.avatarUrl }}
                        size={36}
                      />
                    </Pressable>
                    <View style={styles.grow}>
                      <Pressable onPress={() => goPlayer(r.userId)}>
                        <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>
                          {r.name}
                        </Text>
                      </Pressable>
                      <Text style={[styles.rowMeta, { color: c.textFaint }]} numberOfLines={1}>
                        {r.level} • {r.position} • asked {timeAgo(r.createdAt)}
                      </Text>
                      {r.message ? (
                        <Text style={[styles.rowMsg, { color: c.textMuted }]}>“{r.message}”</Text>
                      ) : null}
                    </View>
                    <View style={styles.actionsRow}>
                      <Pressable
                        onPress={() =>
                          void act(
                            `req-${r.id}-accept`,
                            () =>
                              teamRequestAction({
                                teamId: team.id,
                                captainId: user?.id ?? 0,
                                requestId: r.id,
                                action: "accept",
                              }),
                            `${r.name} is in the squad 🎉`,
                          )
                        }
                        disabled={busy === `req-${r.id}-accept` || squadFull}
                        style={[
                          styles.acceptBtn,
                          busy === `req-${r.id}-accept` || squadFull ? styles.dim : null,
                        ]}
                      >
                        <Check size={14} color="#FFFFFF" />
                        <Text style={styles.acceptText}>Accept</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          void act(
                            `req-${r.id}-decline`,
                            () =>
                              teamRequestAction({
                                teamId: team.id,
                                captainId: user?.id ?? 0,
                                requestId: r.id,
                                action: "decline",
                              }),
                            `${r.name}'s request declined`,
                          )
                        }
                        disabled={busy === `req-${r.id}-decline`}
                        style={[
                          styles.declineBtn,
                          { borderColor: c.border },
                          busy === `req-${r.id}-decline` ? styles.dim : null,
                        ]}
                      >
                        <X size={14} color={c.textMuted} />
                        <Text style={[styles.declineText, { color: c.textMuted }]}>Decline</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {captain.invites.filter((i) => i.status === "pending").length > 0 ? (
              <View style={[styles.subBox, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : tokens.stone50 }]}>
                <Text style={[styles.microTitle, { color: c.textFaint }]}>
                  <MailQuestion size={12} color={c.textFaint} /> Invitations awaiting an answer
                </Text>
                <View style={styles.list}>
                  {captain.invites
                    .filter((i) => i.status === "pending")
                    .map((i) => (
                      <View key={i.id} style={styles.inviteLine}>
                        <Pressable onPress={() => goPlayer(i.userId)} style={styles.grow}>
                          <Text style={[styles.inviteLineName, { color: c.text }]} numberOfLines={1}>
                            {i.name} — {i.level} • {i.position}
                          </Text>
                        </Pressable>
                        <Text style={[styles.rowMeta, { color: c.textFaint }]}>
                          {timeAgo(i.createdAt)}
                        </Text>
                        <Pressable
                          onPress={() =>
                            void act(
                              `wd-${i.id}`,
                              () => withdrawTeamInvite(team.id, user?.id ?? 0, i.id),
                              `Invite to ${i.name} withdrawn`,
                            )
                          }
                          disabled={busy === `wd-${i.id}`}
                          style={[
                            styles.ghostXs,
                            { borderColor: c.border },
                            busy === `wd-${i.id}` ? styles.dim : null,
                          ]}
                        >
                          <Text style={[styles.ghostXsText, { color: c.textMuted }]}>Withdraw</Text>
                        </Pressable>
                      </View>
                    ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ------------------------------------- league & competition record */}
        {comp.record.played > 0 || comp.leagues.length > 0 ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
              <Trophy size={14} color={c.textMuted} /> League &amp; competition
            </Text>
            <View style={styles.statGrid}>
              {[
                { l: "Played", v: String(comp.record.played) },
                {
                  l: "Record",
                  v: `${comp.record.won}W ${comp.record.drawn}D ${comp.record.lost}L`,
                },
                {
                  l: "Goals",
                  v: `${comp.record.goalsFor}:${comp.record.goalsAgainst}`,
                },
                { l: "Competition pts", v: String(comp.record.points) },
              ].map((s) => (
                <View key={s.l} style={[styles.statCell, { backgroundColor: inputFill }]}>
                  <Text style={[styles.statValue, { color: c.text }]}>{s.v}</Text>
                  <Text style={[styles.statLabel, { color: c.textFaint }]}>{s.l}</Text>
                </View>
              ))}
            </View>

            {comp.leagues.length > 0 ? (
              <View style={styles.list}>
                {comp.leagues.map((l) => (
                  <Pressable
                    key={l.tournamentId}
                    onPress={() => router.push(`/leagues/${l.tournamentId}`)}
                    style={[styles.leagueRow, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : tokens.stone50 }]}
                  >
                    <Text style={[styles.leagueRowName, { color: c.text }]}>{l.name}</Text>
                    <Text style={styles.statusChip}>
                      {l.status === "ongoing"
                        ? "⚽ In progress"
                        : l.status === "completed"
                          ? "🏁 Finished"
                          : l.status === "registration"
                            ? "📝 Entries open"
                            : "🚫 Cancelled"}
                    </Text>
                    {l.standing ? (
                      <Text
                        style={[
                          styles.standingChip,
                          isDark && {
                            backgroundColor: "rgba(245,158,11,0.15)",
                            color: "#FCD34D",
                          },
                        ]}
                      >
                        {l.standing}
                        {l.standing === 1 ? "st" : l.standing === 2 ? "nd" : l.standing === 3 ? "rd" : "th"}{" "}
                        of {l.tableSize}
                      </Text>
                    ) : null}
                    <Text style={[styles.leagueRowMeta, { color: c.textFaint }]}>
                      {l.format} • {l.record.played}P {l.record.points}pts
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {comp.results.length > 0 ? (
              <View style={styles.resultsBox}>
                <Text style={[styles.microTitle, { color: c.textFaint }]}>Recent results</Text>
                <View style={styles.list}>
                  {comp.results.slice(0, 6).map((r) => (
                    <View key={`${r.source}-${r.id}`} style={[styles.resultRow, { borderColor: c.border }]}>
                      <View
                        style={[
                          styles.outcome,
                          {
                            backgroundColor:
                              r.outcome === "W"
                                ? tokens.emerald600
                                : r.outcome === "D"
                                  ? tokens.stone400
                                  : tokens.red500,
                          },
                        ]}
                      >
                        <Text style={styles.outcomeText}>{r.outcome}</Text>
                      </View>
                      <View style={styles.grow}>
                        <Text style={[styles.resultOpp, { color: c.text }]} numberOfLines={1}>
                          {r.home ? "vs" : "at"} {r.opponent}
                        </Text>
                        <Text style={[styles.rowMeta, { color: c.textFaint }]} numberOfLines={1}>
                          {r.leagueName}
                          {r.source === "booking" ? " • venue-scored" : ` • ${r.round}`} • {r.date}
                        </Text>
                      </View>
                      <Text style={[styles.score, { color: c.text }]}>
                        {r.scored}–{r.conceded}
                      </Text>
                      <Pressable
                        onPress={() => {
                          if (r.source === "booking") router.push("/(app)/bookings");
                          else if (r.leagueId) router.push(`/leagues/${r.leagueId}`);
                        }}
                        style={[styles.ghostXs, { borderColor: c.border }]}
                      >
                        <Text style={[styles.ghostXsText, { color: c.textMuted }]}>
                          {r.source === "booking" ? "Booking" : "Table"}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            <Text style={[styles.hint, { color: c.textFaint }]}>
              🏆 League fixtures are scored by the host; competition bookings by the venue owner.
              Both count on this record.
            </Text>
          </View>
        ) : null}

        {/* ---------------------------------------------------- the roster */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
            <Shield size={14} color={c.textMuted} /> The squad • {roster.length}/{team.maxPlayers}
          </Text>
          <View style={styles.rosterGrid}>
            {roster.map((m) => (
              <Pressable
                key={m.userId}
                onPress={() => goPlayer(m.userId)}
                style={[styles.rosterRow, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : tokens.stone50 }]}
              >
                <Avatar
                  user={{ name: m.name, avatarColor: m.avatarColor, avatarUrl: m.avatarUrl }}
                  size={36}
                />
                <View style={styles.grow}>
                  <View style={styles.inlineWrap}>
                    <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>
                      {m.name}
                    </Text>
                    {m.isCaptain ? (
                      <Text
                        style={[
                          styles.captainPill,
                          isDark && {
                            backgroundColor: "rgba(245,158,11,0.15)",
                            color: "#FCD34D",
                          },
                        ]}
                      >
                        👑 Captain
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.rowMeta, { color: c.textFaint }]} numberOfLines={1}>
                    {m.level} • {m.position}
                    {m.email ? ` • ${m.email}` : ""}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.hint, { color: c.textFaint }]}>
            <Trophy size={12} color={c.textFaint} /> Tap any name for that player&apos;s full details
            — level, reliability, and the other squads they play for.
          </Text>
        </View>
      </ScrollView>
      {loading && notice ? <Spinner label={notice} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  content: { padding: space[4], paddingBottom: space[16] },
  stateBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: space[6], gap: space[3] },
  stateTitle: { fontSize: fontSize.base, fontWeight: "900", textAlign: "center" },
  stateSub: { fontSize: fontSize.base, fontWeight: "600" },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: tokens.emerald600,
    borderRadius: radius["2xl"],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  backBtnText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  dim: { opacity: 0.45 },

  backLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  backLinkText: { fontSize: fontSize.xs, fontWeight: "900", letterSpacing: 1 },

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

  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[5],
    marginTop: space[4],
    shadowColor: "rgba(180,120,60,0.08)",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 1,
  },
  amberCard: {
    borderColor: "#FCD34D",
    backgroundColor: "rgba(251,191,36,0.08)",
  },
  amberTitle: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: "#B45309",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  headRow: { flexDirection: "row", gap: space[4], alignItems: "flex-start" },
  logo: {
    width: 80,
    height: 80,
    borderRadius: radius["3xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { fontSize: fontSize["2xl"], fontWeight: "900", color: "#FFFFFF" },
  inlineWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  title: { fontSize: fontSize["2xl"], fontWeight: "900" },
  welcoming: {
    fontSize: 10,
    fontWeight: "900",
    color: tokens.emerald700,
    backgroundColor: tokens.emerald100,
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  motto: { fontSize: fontSize.xs, fontStyle: "italic", marginTop: 2 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: fontSize.xs,
    fontWeight: "700",
    overflow: "hidden",
  },
  chipText: { fontSize: fontSize.xs, fontWeight: "700" },
  mono: { letterSpacing: 0.5 },

  desc: {
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: fontSize.base,
    lineHeight: 20,
    marginTop: space[4],
  },
  descEmpty: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: fontSize.xs,
    fontWeight: "600",
    marginTop: space[4],
  },

  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: space[4] },
  statCell: {
    flexGrow: 1,
    minWidth: 90,
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
    alignItems: "center",
  },
  statValue: { fontSize: fontSize.base, fontWeight: "900", textAlign: "center" },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
    textAlign: "center",
  },

  moveBox: { marginTop: space[4] },
  loginBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: tokens.stone900,
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
  },
  loginText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  manageLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: tokens.amber400,
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
  },
  manageLinkText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },
  caption: {
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 14,
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },

  invitedBox: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: "#A7F3D0",
    backgroundColor: "rgba(16,185,129,0.06)",
    padding: space[4],
  },
  invitedTitle: {
    fontSize: fontSize.base,
    fontWeight: "900",
    color: tokens.emerald700,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  invitedSub: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: tokens.stone500,
    marginTop: 4,
    lineHeight: 16,
  },
  inviteActions: { flexDirection: "row", gap: 8, marginTop: space[3] },
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
  acceptText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FFFFFF" },
  declineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space[4],
    paddingVertical: 10,
  },
  declineText: { fontSize: fontSize.sm, fontWeight: "900" },

  noteInput: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.base,
    fontWeight: "600",
    minHeight: 64,
    textAlignVertical: "top",
  },
  moveActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  withdrawBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: 1,
    minWidth: 200,
    borderWidth: 1,
    borderColor: "#FCD34D",
    backgroundColor: "#FFFBEB",
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
  },
  withdrawText: { fontSize: fontSize.base, fontWeight: "900", color: "#B45309" },
  memberBtn: {
    flex: 1,
    minWidth: 200,
    borderWidth: 1,
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
    alignItems: "center",
  },
  memberText: { fontSize: fontSize.base, fontWeight: "900" },
  askBtn: {
    flex: 1,
    minWidth: 200,
    backgroundColor: tokens.emerald600,
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
    alignItems: "center",
  },
  askText: { fontSize: fontSize.base, fontWeight: "900", color: "#FFFFFF" },

  hint: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    marginTop: 8,
    lineHeight: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },

  list: { marginTop: space[3], gap: space[2] },
  rowCard: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space[3],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
  },
  rowName: { fontSize: fontSize.base, fontWeight: "900" },
  rowMeta: { fontSize: fontSize.xs, fontWeight: "600", marginTop: 1 },
  rowMsg: { fontSize: fontSize.xs, fontStyle: "italic", marginTop: 4 },
  actionsRow: { flexDirection: "row", gap: 6, marginLeft: "auto" },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: tokens.emerald600,
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  subBox: { borderRadius: radius.xl, padding: space[3], marginTop: space[3] },
  microTitle: {
    fontSize: fontSize["2xs"],
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  inviteLine: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  inviteLineName: { fontSize: fontSize.sm, fontWeight: "700" },
  ghostXs: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  ghostXsText: { fontSize: 9, fontWeight: "900" },

  leagueRow: {
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  leagueRowName: { fontSize: fontSize.base, fontWeight: "700" },
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
  standingChip: {
    fontSize: 10,
    fontWeight: "900",
    backgroundColor: "#FEF3C7",
    color: "#B45309",
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  leagueRowMeta: { fontSize: fontSize.xs, fontWeight: "700", marginLeft: "auto" },

  resultsBox: { marginTop: space[3] },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    paddingVertical: 8,
  },
  outcome: {
    width: 24,
    height: 24,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  outcomeText: { fontSize: 11, fontWeight: "900", color: "#FFFFFF" },
  resultOpp: { fontSize: 13, fontWeight: "700" },
  score: { fontSize: fontSize.base, fontWeight: "900" },

  rosterGrid: { marginTop: space[3], gap: 8 },
  rosterRow: {
    borderRadius: radius["2xl"],
    paddingVertical: 10,
    paddingHorizontal: space[3],
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  captainPill: {
    fontSize: 9,
    fontWeight: "900",
    color: "#B45309",
    backgroundColor: "#FEF3C7",
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
});