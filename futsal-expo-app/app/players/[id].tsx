import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Crown,
  Hash,
  MapPin,
  MessageSquare,
  Send,
  Shield,
  ShieldAlert,
  Star,
  Trophy,
  UserPlus,
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
import { Picker } from "@react-native-picker/picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchPlayerDossier, sendTeamInvite, teamRequestAction, withdrawTeamInvite } from "@/api";
import { Avatar } from "@/components/Avatar";
import { PlayerRatingBadge } from "@/components/PlayerRating";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { initials } from "@/lib/futsal";
import { timeAgo } from "@/lib/time";
import type { PlayerDossier, PlayerMatchRow } from "@/lib/types";
import { colors as tokens, fontSize, radius, space } from "@/theme";

/**
 * The full dossier of one player 👤 — a 1:1 port of the web app's
 * app/players/[id]/page.tsx.
 *
 * A join request in the captain's panel is one sentence and a name, which is not
 * much to judge a person on. This page is what "view their full details" opens
 * into: profile, reliability, the squads they already play for, the games they
 * turn up to — and, for the captain reading it, the request itself, answerable
 * here rather than by closing the dialog and hunting for the row again.
 */
export default function PlayerDossierScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors: c, isDark } = useTheme();
  const { user } = useAuth();
  const inputFill = isDark ? "rgba(255,255,255,0.05)" : tokens.insetCream;

  const [data, setData] = useState<PlayerDossier | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeBad, setNoticeBad] = useState(false);
  const [inviteTeam, setInviteTeam] = useState("");
  const [inviteNote, setInviteNote] = useState("");

  const load = useCallback(async () => {
    try {
      const body = await fetchPlayerDossier(Number(id), user?.id);
      setData(body);
      if (!inviteTeam) {
        const first = (body.captainOptions ?? []).find(
          (t) =>
            !t.isMember &&
            !t.squadFull &&
            t.invitesLeftToday > 0 &&
            !t.hasPendingRequest &&
            !t.hasPendingInvite,
        );
        if (first) setInviteTeam(String(first.teamId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that player 🙏");
    } finally {
      setLoading(false);
    }
    // inviteTeam is read once, on the first load only — see the guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** One runner for the three actions a captain can take from here. */
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

  const decide = (row: PlayerDossier["myQueue"][number], action: "accept" | "decline") =>
    act(
      `${row.kind}-${row.id}-${action}`,
      () =>
        teamRequestAction({
          teamId: row.teamId,
          captainId: user?.id ?? 0,
          requestId: row.id,
          action,
        }),
      action === "accept"
        ? `${data?.player.name ?? "They"} is in ${row.teamName} 🎉`
        : `Request from ${data?.player.name ?? "that player"} declined`,
    );

  const withdraw = (row: PlayerDossier["myQueue"][number]) =>
    act(
      `withdraw-${row.id}`,
      () => withdrawTeamInvite(row.teamId, user?.id ?? 0, row.id),
      `Invite to ${row.teamName} withdrawn`,
    );

  const sendInvite = () => {
    const team = data?.captainOptions.find((t) => String(t.teamId) === inviteTeam);
    if (!team) return;
    void act(
      "invite",
      () =>
        sendTeamInvite({
          teamId: team.teamId,
          captainId: user?.id ?? 0,
          userId: data?.player.id ?? 0,
          message: inviteNote.trim(),
        }),
      `Invite sent to ${data?.player.name ?? "that player"} — they decide 📨`,
    );
  };

  if (loading) {
    return (
      <View style={[styles.stateBox, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" color={c.primary} />
        <Text style={[styles.stateSub, { color: c.textMuted }]}>Loading dossier…</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.stateBox, { backgroundColor: c.bg }]}>
        <Text style={[styles.stateTitle, { color: c.text }]}>{error || "No such player 👤"}</Text>
        <Pressable onPress={() => router.replace("/teams")} style={styles.backBtn}>
          <ArrowLeft size={16} color="#FFFFFF" />
          <Text style={styles.backBtnText}>Back to teams</Text>
        </Pressable>
      </View>
    );
  }

  const { player, stats } = data;
  const pending = data.myQueue.filter((q) => q.status === "pending");
  const history = data.myQueue.filter((q) => q.status !== "pending");
  const isSelf = data.viewer?.isSelf ?? false;
  const inviteTarget = data.captainOptions.find((t) => String(t.teamId) === inviteTeam);
  const canInvite =
    !!user &&
    !isSelf &&
    data.invitable &&
    !!inviteTarget &&
    !inviteTarget.isMember &&
    !inviteTarget.squadFull &&
    inviteTarget.invitesLeftToday > 0 &&
    !inviteTarget.hasPendingInvite &&
    !inviteTarget.hasPendingRequest;
  const joinedTeam = data.captainOptions.some((t) => t.isMember);
  /**
   * "Accept" is only honest if the squad has a seat, and the server already
   * refuses a full one — so the button says why it is off instead of failing
   * after the tap.
   */
  const squadFullFor = (teamId: number) =>
    data.captainOptions.find((t) => t.teamId === teamId)?.squadFull ?? false;

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

        {/* ------------------------------------------------------- who they are */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.headRow}>
            <Avatar
              user={{
                name: player.name,
                avatarColor: player.avatarColor,
                avatarUrl: player.avatarUrl,
              }}
              size={80}
            />
            <View style={styles.grow}>
              <Text style={[styles.title, { color: c.text }]}>{player.name}</Text>
              <View style={styles.chipRow}>
                <Text style={[styles.chip, { backgroundColor: c.inset, color: c.textMuted }]}>
                  {player.level}
                </Text>
                <Text style={[styles.chip, { backgroundColor: c.inset, color: c.textMuted }]}>
                  {player.position}
                </Text>
                <Text style={[styles.chip, { backgroundColor: c.inset, color: c.textMuted }]}>
                  <MapPin size={12} color={c.textMuted} /> {player.defaultCity}
                </Text>
                {player.role !== "player" ? (
                  <Text style={styles.roleChip}>
                    <ShieldAlert size={12} color="#B45309" /> {player.role} account
                  </Text>
                ) : null}
              </View>
              <View style={styles.ratingRow}>
                <PlayerRatingBadge stats={stats} />
                <Text style={styles.trustChip}>
                  {stats.trustEmoji} {stats.trustScore} trust — {stats.trustLabel}
                </Text>
                <Text style={[styles.since, { color: c.textFaint }]}>
                  on FutsalNepal since{" "}
                  {player.memberSince ? new Date(player.memberSince).toLocaleDateString() : "—"}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.statGrid}>
            {[
              { l: "Matches", v: String(player.matchesPlayed) },
              { l: "Games played", v: String(stats.completed) },
              {
                l: "Cancelled",
                v: `${stats.cancelled}${stats.cancelsThisMonth ? ` (${stats.cancelsThisMonth} this month)` : ""}`,
              },
              { l: "Reliability", v: `${stats.rating.toFixed(1)} ${stats.emoji}` },
            ].map((s) => (
              <View key={s.l} style={[styles.statCell, { backgroundColor: inputFill }]}>
                <Text style={[styles.statValue, { color: c.text }]}>{s.v}</Text>
                <Text style={[styles.statLabel, { color: c.textFaint }]}>{s.l}</Text>
              </View>
            ))}
          </View>

          {!data.invitable ? (
            <Text style={styles.warnBox}>
              This is a {player.role} account, not a player — squads are made of players, so there
              is nothing to invite here 🛡️
            </Text>
          ) : null}
        </View>

        {/* ------------------------------------------------------- decide, if asked */}
        {user && !isSelf && (pending.length > 0 || history.length > 0) ? (
          <View style={[styles.card, styles.amberCard]}>
            <Text style={styles.amberTitle}>
              <MessageSquare size={14} color="#B45309" /> Between you two
            </Text>
            <Text style={[styles.hint, { color: c.textMuted }]}>
              Only your own squads can see this — nobody else&apos;s requests or invitations.
            </Text>
            <View style={styles.list}>
              {[...pending, ...history].map((row) => (
                <View
                  key={`${row.kind}-${row.id}`}
                  style={[styles.rowCard, { backgroundColor: c.surface, borderColor: c.border }]}
                >
                  <View style={[styles.teamBadge, { backgroundColor: row.logoColor }]}>
                    <Text style={styles.teamBadgeText}>{initials(row.teamName)}</Text>
                  </View>
                  <View style={styles.grow}>
                    <Text style={[styles.rowName, { color: c.text }]} numberOfLines={2}>
                      {row.kind === "request"
                        ? `${player.name} asked to join ${row.teamName}`
                        : row.status === "pending"
                          ? `You invited them to ${row.teamName}`
                          : `Your ${row.teamName} invite was ${row.status}`}
                    </Text>
                    <Text style={[styles.rowMeta, { color: c.textFaint }]}>
                      {timeAgo(row.createdAt)}
                      {row.status !== "pending" ? ` • ${row.status}` : ""}
                    </Text>
                  </View>
                  {row.kind === "request" && row.status === "pending" ? (
                    <View style={styles.actionsRow}>
                      <Pressable
                        onPress={() => void decide(row, "accept")}
                        disabled={busy === `request-${row.id}-accept` || squadFullFor(row.teamId)}
                        style={[
                          styles.acceptBtn,
                          busy === `request-${row.id}-accept` || squadFullFor(row.teamId)
                            ? styles.dim
                            : null,
                        ]}
                      >
                        <Check size={14} color="#FFFFFF" />
                        <Text style={styles.acceptText}>Accept</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void decide(row, "decline")}
                        disabled={busy === `request-${row.id}-decline`}
                        style={[
                          styles.declineBtn,
                          { borderColor: c.border },
                          busy === `request-${row.id}-decline` ? styles.dim : null,
                        ]}
                      >
                        <X size={14} color={c.textMuted} />
                        <Text style={[styles.declineText, { color: c.textMuted }]}>Decline</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {row.kind === "invite" && row.status === "pending" ? (
                    <Pressable
                      onPress={() => void withdraw(row)}
                      disabled={busy === `withdraw-${row.id}`}
                      style={[
                        styles.declineBtn,
                        { borderColor: c.border },
                        busy === `withdraw-${row.id}` ? styles.dim : null,
                      ]}
                    >
                      <Text style={[styles.declineText, { color: c.textMuted }]}>
                        Withdraw invite
                      </Text>
                    </Pressable>
                  ) : null}
                  {row.message ? (
                    <Text style={[styles.quote, { backgroundColor: inputFill, color: isDark ? c.text : tokens.stone600 }]}>
                      “{row.message}”
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ------------------------------------------------------- invite them */}
        {user && !isSelf && data.invitable && data.captainOptions.length > 0 && !joinedTeam ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={styles.sectionTitleGreen}>
              <UserPlus size={14} color={tokens.emerald700} /> Bring them into your squad
            </Text>
            <Text style={[styles.hint, { color: c.textMuted }]}>
              An invitation is a question, not an add: {player.name} accepts or declines it
              themselves.
            </Text>
            <View style={styles.inviteForm}>
              <View style={[styles.pickerWrap, styles.grow, { backgroundColor: inputFill, borderColor: c.border }]}>
                <Picker
                  selectedValue={inviteTeam}
                  onValueChange={(v) => setInviteTeam(String(v))}
                  style={{ color: c.text }}
                >
                  {data.captainOptions.map((t) => (
                    <Picker.Item
                      key={t.teamId}
                      value={String(t.teamId)}
                      label={`${t.name} — ${t.memberCount}/${t.maxPlayers}${
                        t.isMember
                          ? " • already in"
                          : t.hasPendingRequest
                            ? " • asked you"
                            : t.hasPendingInvite
                              ? " • invited"
                              : t.squadFull
                                ? " • full"
                                : ` • ${t.invitesLeftToday} invites left`
                      }`}
                    />
                  ))}
                </Picker>
              </View>
              <Pressable
                onPress={sendInvite}
                disabled={!canInvite || busy === "invite"}
                style={[styles.sendBtn, !canInvite || busy === "invite" ? styles.dim : null]}
              >
                <Send size={16} color="#FFFFFF" />
                <Text style={styles.sendText}>{busy === "invite" ? "Sending…" : "Send invite"}</Text>
              </Pressable>
            </View>
            <TextInput
              value={inviteNote}
              onChangeText={setInviteNote}
              maxLength={200}
              placeholder={'Why them? Optional note they\'ll see — e.g. "we need a keeper on Tuesdays"'}
              placeholderTextColor={c.textFaint}
              style={[styles.noteInput, { backgroundColor: inputFill, borderColor: c.border, color: c.text }]}
            />
          </View>
        ) : null}

        {/* ------------------------------------------------------- their squads */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
            <Shield size={14} color={c.textMuted} /> Squads they play for • {data.teams.length}
          </Text>
          {data.teams.length === 0 ? (
            <Text style={[styles.hint, { color: c.textFaint }]}>
              Not in a squad yet — a free agent anyone&apos;s team could invite ⚽
            </Text>
          ) : (
            <View style={styles.list}>
              {data.teams.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => router.push(`/teams/${t.id}`)}
                  style={[styles.squadRow, { borderColor: c.border, backgroundColor: isDark ? "rgba(255,255,255,0.05)" : tokens.stone50 }]}
                >
                  <View style={[styles.squadLogo, { backgroundColor: t.logoColor }]}>
                    <Text style={styles.squadLogoText}>{initials(t.name)}</Text>
                  </View>
                  <View style={styles.grow}>
                    <View style={styles.inlineWrap}>
                      <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>
                        {t.name}
                      </Text>
                      {t.role === "captain" ? <Text style={styles.captainPill}>👑 Captain</Text> : null}
                    </View>
                    <Text style={[styles.rowMeta, { color: c.textFaint }]} numberOfLines={1}>
                      {t.level} • {t.wins}W {t.draws}D {t.losses}L • {t.memberCount}/{t.maxPlayers}{" "}
                      mates
                      {t.homeGround ? ` • ${t.homeGround}` : ""}
                    </Text>
                    {t.description || t.motto ? (
                      <Text style={[styles.squadQuote, { color: c.textFaint }]} numberOfLines={2}>
                        {t.description || t.motto}
                      </Text>
                    ) : null}
                  </View>
                  {t.teamCode ? (
                    <Text style={styles.codeChip}>
                      <Hash size={10} color={c.textMuted} /> {t.teamCode}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* ------------------------------------------------------- games */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
            <Trophy size={14} color={c.textMuted} /> Games they organise
          </Text>
          <MatchList rows={data.matches.organized} empty="No open match up right now." />
        </View>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
            <CalendarDays size={14} color={c.textMuted} /> Games they&apos;ve joined
          </Text>
          <MatchList rows={data.matches.joined} empty="Nothing on the calendar yet." />
        </View>

        {/* ------------------------------------------------------- reviews */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
            <Star size={14} color={c.textMuted} /> What they say about venues • {data.reviews.length}
          </Text>
          {data.reviews.length === 0 ? (
            <Text style={[styles.hint, { color: c.textFaint }]}>
              No reviews written yet — playing first, talking later 😄
            </Text>
          ) : (
            <View style={styles.list}>
              {data.reviews.map((r) => (
                <View
                  key={r.id}
                  style={[styles.reviewRow, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : tokens.stone50 }]}
                >
                  <Text style={[styles.reviewHead, { color: c.text }]}>
                    <Text style={styles.stars}>
                      {"★".repeat(r.rating)}
                      <Text style={{ color: tokens.stone300 }}>{"★".repeat(5 - r.rating)}</Text>
                    </Text>
                    {r.venueName}
                  </Text>
                  {r.message ? (
                    <Text style={[styles.reviewMsg, { color: c.textMuted }]}>{r.message}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      {loading ? <Spinner label="Loading…" /> : null}
    </SafeAreaView>
  );
}

function MatchList({ rows, empty }: { rows: PlayerMatchRow[]; empty: string }) {
  const { colors: c } = useTheme();
  const router = useRouter();
  if (rows.length === 0) {
    return <Text style={[styles.hint, { color: c.textFaint, marginTop: space[2] }]}>{empty}</Text>;
  }
  return (
    <View style={styles.list}>
      {rows.map((m) => (
        <View
          key={m.id}
          style={[styles.matchRow, { backgroundColor: c.inset }]}
        >
          <View style={[styles.dateChip, { backgroundColor: c.surface }]}>
            <Text style={[styles.dateChipText, { color: c.textMuted }]}>{m.date.slice(5)}</Text>
          </View>
          <View style={styles.grow}>
            <Text style={[styles.matchTitle, { color: c.text }]} numberOfLines={1}>
              {m.title}
            </Text>
            <Text style={[styles.matchMeta, { color: c.textFaint }]} numberOfLines={1}>
              {m.startTime}–{m.endTime}
              {m.venueName ? ` • ${m.venueName}` : ""} • Rs. {m.pricePerPlayer}
            </Text>
          </View>
          <Pressable onPress={() => router.push("/(app)/matches")}>
            <Text style={styles.matchLink}>open match</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  content: { padding: space[4], paddingBottom: space[16] },
  stateBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[6],
    gap: space[3],
  },
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
  amberCard: { borderColor: "#FCD34D", backgroundColor: "rgba(251,191,36,0.08)" },
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
  sectionTitleGreen: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: tokens.emerald700,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  headRow: { flexDirection: "row", gap: space[4], alignItems: "flex-start" },
  title: { fontSize: fontSize["2xl"], fontWeight: "900" },
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
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: fontSize.xs,
    fontWeight: "700",
    backgroundColor: "#FEF3C7",
    color: "#B45309",
    overflow: "hidden",
  },
  ratingRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 },
  trustChip: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    backgroundColor: tokens.stone100,
    color: tokens.stone600,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: "hidden",
  },
  since: { fontSize: fontSize.xs, fontWeight: "600" },

  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: space[4] },
  statCell: {
    flexGrow: 1,
    minWidth: 90,
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
    alignItems: "center",
  },
  statValue: { fontSize: fontSize.lg, fontWeight: "900", textAlign: "center" },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
    textAlign: "center",
  },
  warnBox: {
    borderRadius: radius["2xl"],
    backgroundColor: "#FFFBEB",
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: fontSize.xs,
    fontWeight: "700",
    color: "#B45309",
    marginTop: space[3],
  },

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
  teamBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  teamBadgeText: { fontSize: 10, fontWeight: "900", color: "#FFFFFF" },
  rowName: { fontSize: fontSize.base, fontWeight: "900" },
  rowMeta: { fontSize: fontSize.xs, fontWeight: "600", marginTop: 1 },
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
  acceptText: { fontSize: fontSize.xs, fontWeight: "900", color: "#FFFFFF" },
  declineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  declineText: { fontSize: fontSize.xs, fontWeight: "900" },
  quote: {
    borderRadius: radius.xl,
    paddingHorizontal: space[3],
    paddingVertical: 8,
    fontSize: fontSize.xs,
    fontStyle: "italic",
    marginTop: 6,
    width: "100%",
  },

  inviteForm: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: space[3] },
  pickerWrap: { borderWidth: 1, borderRadius: radius.xl, overflow: "hidden", minHeight: 44 },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: tokens.emerald600,
    borderRadius: radius.xl,
    paddingHorizontal: space[4],
    paddingVertical: 12,
  },
  sendText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FFFFFF" },
  noteInput: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.base,
    fontWeight: "600",
    marginTop: 8,
    minHeight: 44,
  },

  inlineWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
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

  squadRow: {
    borderWidth: 1,
    borderRadius: radius["2xl"],
    padding: space[3],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[3],
  },
  squadLogo: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  squadLogoText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FFFFFF" },
  squadQuote: { fontSize: fontSize.xs, fontStyle: "italic", marginTop: 4 },

  matchRow: {
    borderRadius: radius.xl,
    padding: space[2],
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  dateChip: {
    width: 40,
    height: 36,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  dateChipText: { fontSize: 10, fontWeight: "900" },
  matchTitle: { fontSize: fontSize.sm, fontWeight: "900" },
  matchMeta: { fontSize: 10, fontWeight: "600", marginTop: 1 },
  matchLink: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: tokens.emerald600,
  },

  reviewRow: { borderRadius: radius["2xl"], padding: space[3] },
  reviewHead: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  stars: { color: tokens.amber400 },
  reviewMsg: { fontSize: fontSize.xs, lineHeight: 16, marginTop: 4 },
});
