import { useRouter } from "expo-router";
import {
  CalendarPlus,
  Camera,
  Check,
  MapPin,
  RefreshCw,
  Shuffle,
  Trash2,
  Trophy,
} from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { leagueMatchesAction } from "@/api";
import { DateField, TimeField } from "@/components/DateTimeFields";
import { useTheme } from "@/context/ThemeContext";
import { LEAGUE_ROUNDS, leagueDateLabel, leagueModeLabel, modeHasBracket } from "@/lib/league";
import { formatTime12, initials } from "@/lib/futsal";
import type { LeagueDetail, LeagueMatchRow } from "@/lib/types";
import { fontSize, radius, space } from "@/theme";

/**
 * Fixtures & results ⚽ — a 1:1 port of the web app's
 * components/LeagueFixtures.tsx.
 *
 * The host writes the calendar (or lets the button draw a round robin) and taps
 * in the score after each game; everybody in the league reads it. A result
 * recorded here is the same result that shows on the squads' profiles and moves
 * the table above — there is only one place a score lives.
 *
 * Platform notes: `<input type="date|time">` becomes the DateField/TimeField
 * chip strips; `<select>` becomes Picker; the spin Loader2 becomes an
 * ActivityIndicator; venue links keep the web app's `/venues/:id` path.
 */
export function LeagueFixtures({
  league,
  hostId,
  isHost,
  onChanged,
  onOpenAlbum,
  onOpenVenue,
}: {
  league: LeagueDetail;
  hostId: number;
  isHost: boolean;
  onChanged: () => void;
  onOpenAlbum?: (matchId: number) => void;
  onOpenVenue?: (venueId: number) => void;
}) {
  const { colors: c, isDark } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [homeTeamId, setHomeTeamId] = useState("");
  const [awayTeamId, setAwayTeamId] = useState("");
  const [round, setRound] = useState<string>(LEAGUE_ROUNDS[0]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [scores, setScores] = useState<Record<number, { home: string; away: string }>>({});

  const squads = league.teams;
  const modeInfo = leagueModeLabel(league.mode);
  const drawLabel = modeHasBracket(league.mode)
    ? league.mode === "group_knockout"
      ? "Draw groups + bracket"
      : "Draw the bracket"
    : "Draw the round robin";
  const { upcoming, results } = useMemo(() => {
    const played = league.matches.filter((m) => m.homeScore !== null && m.awayScore !== null);
    const rest = league.matches.filter((m) => m.homeScore === null || m.awayScore === null);
    return {
      results: [...played].sort((a, b) => String(b.date).localeCompare(String(a.date))),
      upcoming: [...rest].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    };
  }, [league.matches]);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMsg("");
    setErr("");
    try {
      const data = await leagueMatchesAction(league.id, { hostId, ...body });
      setMsg(String(data.message ?? "Saved ✅"));
      setShowAdd(false);
      setHomeTeamId("");
      setAwayTeamId("");
      setDate("");
      setStartTime("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  function scoreValue(m: LeagueMatchRow, side: "home" | "away") {
    const local = scores[m.id];
    if (local) return local[side];
    const v = side === "home" ? m.homeScore : m.awayScore;
    return v === null ? "" : String(v);
  }

  const noticeTone = err
    ? { bg: isDark ? "rgba(239,68,68,0.10)" : "#FEF2F2", fg: "#DC2626" }
    : { bg: isDark ? "rgba(5,150,105,0.10)" : "#ECFDF5", fg: "#047857" };

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Trophy size={14} color={isDark ? "#6EE7B7" : "#047857"} />
          <Text style={[styles.title, { color: isDark ? "#6EE7B7" : "#047857" }]}>
            Fixtures &amp; results
          </Text>
          <View style={[styles.modeChip, { backgroundColor: isDark ? "rgba(249,115,22,0.15)" : "#FFEDD5" }]}>
            <Text style={[styles.modeChipText, { color: isDark ? "#FDBA74" : "#C2410C" }]}>
              {modeInfo.emoji} {modeInfo.label}
            </Text>
          </View>
          <View style={[styles.playedChip, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "#F5F5F4" }]}>
            <Text style={[styles.playedChipText, { color: isDark ? "#CBD5E1" : "#78716C" }]}>
              {league.playedMatches}/{league.totalMatches || 0} played
            </Text>
          </View>
        </View>
        {isHost ? (
          <View style={styles.hostActions}>
            <Pressable
              onPress={() => void post({ action: "generate" }, "generate")}
              disabled={busy !== "" || squads.length < 2}
              accessibilityRole="button"
              style={[styles.drawBtn, { borderColor: isDark ? "rgba(16,185,129,0.4)" : "#6EE7B7" }, busy || squads.length < 2 ? styles.disabled : null]}
            >
              {busy === "generate" ? (
                <ActivityIndicator size="small" color={isDark ? "#6EE7B7" : "#047857"} />
              ) : (
                <Shuffle size={14} color={isDark ? "#6EE7B7" : "#047857"} />
              )}
              <Text style={[styles.drawText, { color: isDark ? "#6EE7B7" : "#047857" }]}>{drawLabel}</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowAdd((v) => !v)}
              accessibilityRole="button"
              style={styles.addBtn}
            >
              <CalendarPlus size={14} color="#FFFFFF" />
              <Text style={styles.addBtnText}>Add a fixture</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {msg || err ? (
        <View style={[styles.notice, { backgroundColor: noticeTone.bg }]}>
          <Text style={[styles.noticeText, { color: noticeTone.fg }]}>{err || msg}</Text>
        </View>
      ) : null}

      {isHost && showAdd ? (
        <View style={[styles.addForm, { borderColor: c.border, backgroundColor: c.inset }]}>
          {/* A squad can't play itself, so each list hides whoever is already
              picked on the other side — the server refuses it too, but the
              option shouldn't have been there to click. */}
          <View style={[styles.pickerBox, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Picker
              selectedValue={homeTeamId}
              onValueChange={(v) => setHomeTeamId(String(v))}
              style={{ color: c.text }}
            >
              <Picker.Item label="Home squad…" value="" />
              {squads
                .filter((s) => String(s.teamId) !== awayTeamId)
                .map((s) => (
                  <Picker.Item key={s.teamId} label={s.name} value={String(s.teamId)} />
                ))}
            </Picker>
          </View>
          <View style={[styles.pickerBox, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Picker
              selectedValue={awayTeamId}
              onValueChange={(v) => setAwayTeamId(String(v))}
              style={{ color: c.text }}
            >
              <Picker.Item label="Away squad…" value="" />
              {squads
                .filter((s) => String(s.teamId) !== homeTeamId)
                .map((s) => (
                  <Picker.Item key={s.teamId} label={s.name} value={String(s.teamId)} />
                ))}
            </Picker>
          </View>
          <View style={[styles.pickerBox, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Picker selectedValue={round} onValueChange={setRound} style={{ color: c.text }}>
              {LEAGUE_ROUNDS.map((r) => (
                <Picker.Item key={r} label={r} value={r} />
              ))}
            </Picker>
          </View>
          <DateField label="Date" value={date} onChange={setDate} allowClear />
          <TimeField label="Kick-off" value={startTime} onChange={setStartTime} allowClear />
          <Pressable
            onPress={() =>
              void post(
                {
                  action: "create",
                  homeTeamId: Number(homeTeamId),
                  awayTeamId: Number(awayTeamId),
                  round,
                  date,
                  startTime,
                },
                "create",
              )
            }
            disabled={busy !== "" || !homeTeamId || !awayTeamId || homeTeamId === awayTeamId}
            accessibilityRole="button"
            style={[
              styles.submitBtn,
              busy !== "" || !homeTeamId || !awayTeamId || homeTeamId === awayTeamId
                ? styles.disabled
                : null,
            ]}
          >
            {busy === "create" ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : null}
            <Text style={styles.submitText}>
              {busy === "create"
                ? "Adding…"
                : homeTeamId && homeTeamId === awayTeamId
                  ? "Pick two different squads 🙂"
                  : "Add fixture 📅"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {league.matches.length === 0 ? (
        <View style={[styles.emptyBox, { borderColor: c.border }]}>
          <Text style={[styles.emptyText, { color: c.textFaint }]}>
            No fixtures yet.{" "}
            {isHost
              ? league.mode === "knockout"
                ? "Draw the bracket and every round appears, byes included."
                : league.mode === "group_knockout"
                  ? "Draw the groups and the bracket — the knockout fills itself as the groups finish."
                  : "Draw the round robin and every squad plays every other once."
              : "The host will publish the calendar soon."}
          </Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {upcoming.map((m) => (
          <View key={m.id} style={[styles.fixture, { borderColor: c.border }]}>
            <View style={styles.fixtureTop}>
              <View style={styles.grow}>
                <Text style={styles.fixtureMeta}>
                  {m.round} • {leagueDateLabel(m.date)}
                  {m.startTime ? ` • ${formatTime12(m.startTime)}` : ""}
                </Text>
                <View style={styles.vsRow}>
                  <View style={styles.teamInline}>
                    <View style={[styles.miniAvatar, { backgroundColor: m.homeLogoColor }]}>
                      <Text style={styles.miniAvatarText}>{initials(m.homeTeamName)}</Text>
                    </View>
                    <Text style={[styles.teamName, { color: c.text }]}>{m.homeTeamName}</Text>
                  </View>
                  <Text style={[styles.vs, { color: c.textFaint }]}>vs</Text>
                  <View style={styles.teamInline}>
                    <View style={[styles.miniAvatar, { backgroundColor: m.awayLogoColor }]}>
                      <Text style={styles.miniAvatarText}>{initials(m.awayTeamName)}</Text>
                    </View>
                    <Text style={[styles.teamName, { color: c.text }]}>{m.awayTeamName}</Text>
                  </View>
                </View>
                {m.notes ? (
                  <Text style={[styles.notes, { color: c.textFaint }]}>{m.notes}</Text>
                ) : null}
              </View>
              {!isHost ? (
                <View style={[styles.awaitChip, { backgroundColor: c.inset }]}>
                  <Text style={[styles.awaitChipText, { color: c.textMuted }]}>Awaiting kickoff</Text>
                </View>
              ) : null}
            </View>

            {isHost && m.bracketRound > 0 && (m.homeTeamId === 0 || m.awayTeamId === 0) ? (
              <View style={[styles.waitingBox, { backgroundColor: c.inset }]}>
                <Text style={[styles.waitingText, { color: c.textFaint }]}>
                  ⏳ Waiting on the game before it — the squad lands here as soon as that result
                  is in.
                </Text>
              </View>
            ) : null}

            {isHost && m.bracketRound > 0 && m.homeTeamId > 0 && m.awayTeamId > 0 ? (
              <ScheduleRow
                match={m}
                busy={busy === `schedule-${m.id}`}
                onSave={(d, t) =>
                  void post({ action: "schedule", matchId: m.id, date: d, startTime: t }, `schedule-${m.id}`)
                }
              />
            ) : null}

            {isHost && m.homeTeamId > 0 && m.awayTeamId > 0 ? (
              <View style={styles.scoreRow}>
                <TextInput
                  value={scoreValue(m, "home")}
                  onChangeText={(t) =>
                    setScores((p) => ({
                      ...p,
                      [m.id]: { home: t.replace(/[^0-9]/g, "").slice(0, 2), away: p[m.id]?.away ?? scoreValue(m, "away") },
                    }))
                  }
                  placeholder="0"
                  placeholderTextColor={c.textFaint}
                  keyboardType="number-pad"
                  style={[styles.scoreInput, { borderColor: c.border, color: c.text, backgroundColor: c.inset }]}
                />
                <Text style={[styles.dash, { color: c.textFaint }]}>–</Text>
                <TextInput
                  value={scoreValue(m, "away")}
                  onChangeText={(t) =>
                    setScores((p) => ({
                      ...p,
                      [m.id]: { home: p[m.id]?.home ?? scoreValue(m, "home"), away: t.replace(/[^0-9]/g, "").slice(0, 2) },
                    }))
                  }
                  placeholder="0"
                  placeholderTextColor={c.textFaint}
                  keyboardType="number-pad"
                  style={[styles.scoreInput, { borderColor: c.border, color: c.text, backgroundColor: c.inset }]}
                />
                <Pressable
                  onPress={() =>
                    void post(
                      {
                        action: "score",
                        matchId: m.id,
                        homeScore: scoreValue(m, "home") === "" ? "" : Number(scoreValue(m, "home")),
                        awayScore: scoreValue(m, "away") === "" ? "" : Number(scoreValue(m, "away")),
                      },
                      `score-${m.id}`,
                    )
                  }
                  disabled={busy !== ""}
                  accessibilityRole="button"
                  style={[styles.saveScore, busy !== "" ? styles.disabled : null]}
                >
                  {busy === `score-${m.id}` ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Check size={14} color="#FFFFFF" />
                  )}
                  <Text style={styles.saveScoreText}>Save score</Text>
                </Pressable>
                <Pressable
                  onPress={() => void post({ action: "delete", matchId: m.id }, `del-${m.id}`)}
                  disabled={busy !== ""}
                  accessibilityRole="button"
                  accessibilityLabel="Delete fixture"
                  style={[styles.iconAction, { borderColor: c.border }, busy !== "" ? styles.disabled : null]}
                >
                  <Trash2 size={14} color={c.textMuted} />
                </Pressable>
                {onOpenAlbum ? (
                  <Pressable
                    onPress={() => onOpenAlbum(m.id)}
                    accessibilityRole="button"
                    style={[styles.iconAction, { borderColor: c.border }]}
                  >
                    <Camera size={14} color={c.textMuted} />
                    <Text style={[styles.iconActionText, { color: c.textMuted }]}>Photos</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {results.length > 0 ? (
        <View style={styles.resultsBlock}>
          <Text style={[styles.resultsHead, { color: c.textFaint }]}>Results</Text>
          <View style={styles.list}>
            {results.map((m) => {
              const homeWon = Number(m.homeScore) > Number(m.awayScore);
              const awayWon = Number(m.awayScore) > Number(m.homeScore);
              return (
                <View key={m.id} style={[styles.resultRow, { backgroundColor: c.inset }]}>
                  <View style={styles.resultScore}>
                    <Text
                      style={[
                        styles.resultTeam,
                        { color: homeWon ? (isDark ? "#6EE7B7" : "#047857") : c.text },
                        homeWon ? styles.resultWin : null,
                      ]}
                    >
                      {m.homeTeamName}
                    </Text>
                    <View style={[styles.scorePill, { backgroundColor: c.surface }]}>
                      <Text style={[styles.scorePillText, { color: c.text }]}>
                        {m.homeScore}–{m.awayScore}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.resultTeam,
                        { color: awayWon ? (isDark ? "#6EE7B7" : "#047857") : c.text },
                        awayWon ? styles.resultWin : null,
                      ]}
                    >
                      {m.awayTeamName}
                    </Text>
                  </View>
                  <View style={styles.resultMeta}>
                    <Text style={[styles.resultMetaText, { color: c.textFaint }]}>
                      {m.round} • {leagueDateLabel(m.date)}
                    </Text>
                    {isHost ? (
                      <Pressable
                        onPress={() =>
                          void post({ action: "score", matchId: m.id, homeScore: "", awayScore: "" }, `clear-${m.id}`)
                        }
                        disabled={busy !== ""}
                        accessibilityRole="button"
                        accessibilityLabel="Clear the score (a mistake)"
                        style={[styles.fixBtn, { borderColor: c.border }]}
                      >
                        <Text style={[styles.fixBtnText, { color: c.textMuted }]}>Fix</Text>
                      </Pressable>
                    ) : null}
                    {onOpenAlbum && m.mediaCount > 0 ? (
                      <Pressable
                        onPress={() => onOpenAlbum(m.id)}
                        accessibilityRole="button"
                        style={[styles.mediaBtn, { backgroundColor: c.surface }]}
                      >
                        <Camera size={12} color={isDark ? "#6EE7B7" : "#047857"} />
                        <Text style={[styles.mediaBtnText, { color: isDark ? "#6EE7B7" : "#047857" }]}>
                          {m.mediaCount}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {league.venueName ? (
        <View style={styles.venueLine}>
          <MapPin size={12} color={c.textFaint} />
          <Text style={[styles.venueText, { color: c.textFaint }]}>
            All fixtures at{" "}
            <Text
              onPress={() => {
                if (!league.venueId) return;
                if (onOpenVenue) onOpenVenue(league.venueId);
                else router.push(`/venues/${league.venueId}`);
              }}
              style={[styles.venueText, { color: c.textFaint, textDecorationLine: "underline" }]}
            >
              {league.venueName}
            </Text>
            {league.matchDays ? ` • ${league.matchDays}` : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A kick-off time for one bracket game ⏰
 *
 * A drawn bracket arrives with the shape but no clock — the host decides which
 * round plays on which Saturday, and can do it before the slots are full, so
 * "Semi-final 2, Sunday 9 AM" can be on the fixture list while it still reads
 * "Winner Group A".
 */
function ScheduleRow({
  match,
  busy,
  onSave,
}: {
  match: LeagueMatchRow;
  busy: boolean;
  onSave: (date: string, startTime: string) => void;
}) {
  const { colors: c } = useTheme();
  const [date, setDate] = useState(match.date);
  const [startTime, setStartTime] = useState(match.startTime);
  const changed = date !== match.date || startTime !== match.startTime;

  return (
    <View style={styles.schedule}>
      <DateField label="Date" value={date} onChange={setDate} />
      <TimeField label="Kick-off" value={startTime} onChange={setStartTime} />
      <Pressable
        onPress={() => onSave(date, startTime)}
        disabled={busy || !changed || (!date && !startTime)}
        accessibilityRole="button"
        style={[
          styles.setKickBtn,
          { borderColor: c.border },
          busy || !changed || (!date && !startTime) ? styles.disabled : null,
        ]}
      >
        {busy ? <ActivityIndicator size="small" color={c.textMuted} /> : null}
        <Text style={[styles.setKickText, { color: c.textMuted }]}>
          {busy ? "Saving…" : changed ? "Set kick-off 📅" : "Kick-off set ✓"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space["5"],
    gap: space["3"],
  },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space["2"],
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  title: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  modeChip: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  modeChipText: { fontSize: 10, fontWeight: "900" },
  playedChip: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  playedChipText: { fontSize: 10, fontWeight: "900" },
  hostActions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  drawBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  drawText: { fontSize: 11, fontWeight: "900" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#059669",
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addBtnText: { fontSize: 11, fontWeight: "900", color: "#FFFFFF" },
  notice: { borderRadius: radius.xl, paddingHorizontal: space["4"], paddingVertical: 10 },
  noticeText: { fontSize: fontSize.sm, fontWeight: "700" },
  addForm: {
    gap: space["2"],
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space["3"],
  },
  pickerBox: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
    justifyContent: "center",
  },
  submitBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1C1917",
    borderRadius: radius.lg,
    paddingVertical: 11,
  },
  submitText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FFFFFF" },
  disabled: { opacity: 0.45 },
  emptyBox: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingHorizontal: space["4"],
    paddingVertical: 24,
  },
  emptyText: { fontSize: fontSize.sm, fontWeight: "700", textAlign: "center" },
  list: { gap: space["2"] },
  fixture: { borderRadius: radius.xl, borderWidth: 1, padding: space["3"], gap: space["2"] },
  fixtureTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: space["2"] },
  grow: { flex: 1, minWidth: 0 },
  fixtureMeta: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: "#F97316",
  },
  vsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  teamInline: { flexDirection: "row", alignItems: "center", gap: 6 },
  miniAvatar: {
    width: 24,
    height: 24,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  miniAvatarText: { fontSize: 9, fontWeight: "900", color: "#FFFFFF" },
  teamName: { fontSize: fontSize.base, fontWeight: "900" },
  vs: { fontSize: fontSize.sm, fontWeight: "900" },
  notes: { fontSize: 11, fontWeight: "600", marginTop: 4 },
  awaitChip: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  awaitChipText: { fontSize: 10, fontWeight: "900" },
  waitingBox: { borderRadius: radius.lg, paddingHorizontal: space["3"], paddingVertical: 8 },
  waitingText: { fontSize: 11, fontWeight: "700" },
  schedule: { gap: space["2"], marginTop: 4 },
  setKickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  setKickText: { fontSize: 11, fontWeight: "900" },
  scoreRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  scoreInput: {
    width: 56,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: 6,
    textAlign: "center",
    fontSize: fontSize.base,
    fontWeight: "900",
  },
  dash: { fontSize: fontSize.sm, fontWeight: "900" },
  saveScore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#059669",
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveScoreText: { fontSize: 11, fontWeight: "900", color: "#FFFFFF" },
  iconAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  iconActionText: { fontSize: 11, fontWeight: "900" },
  resultsBlock: { gap: space["2"] },
  resultsHead: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  resultRow: {
    borderRadius: radius.xl,
    paddingHorizontal: space["3.5"] ?? 14,
    paddingVertical: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  resultScore: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  resultTeam: { fontSize: fontSize.base, fontWeight: "700" },
  resultWin: { fontWeight: "900" },
  scorePill: { borderRadius: radius.lg, paddingHorizontal: 10, paddingVertical: 4 },
  scorePillText: { fontSize: fontSize.base, fontWeight: "900" },
  resultMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  resultMetaText: { fontSize: 10, fontWeight: "700" },
  fixBtn: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: 8, paddingVertical: 4 },
  fixBtnText: { fontSize: 10, fontWeight: "900" },
  mediaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.lg,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  mediaBtnText: { fontSize: 10, fontWeight: "900" },
  venueLine: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  venueText: { fontSize: 11, fontWeight: "700" },
});
