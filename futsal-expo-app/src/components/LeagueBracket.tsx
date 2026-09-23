import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";
import { ArrowRight, RefreshCw, Swords, Trophy } from "lucide-react-native";
import { leagueMatchesAction } from "@/api";
import { useTheme } from "@/context/ThemeContext";
import { leagueDateLabel, standingsFor } from "@/lib/league";
import { formatTime12 } from "@/lib/futsal";
import type { LeagueDetail, LeagueMatchRow } from "@/lib/types";
import { fontSize, radius, space } from "@/theme";

/**
 * The bracket 🥊 — a 1:1 port of the web app's components/LeagueBracket.tsx.
 *
 * Knockout leagues don't have a table — they have a shape, and the shape is the
 * thing a captain wants to look at: who do we play, and who is waiting in the
 * next round. Rounds run left to right, each slot naming the squad in it or,
 * while the game before it is still to be played, *where* that squad will come
 * from ("Winner Group A", "Bye 🎟️").
 *
 * This component only reads. Scores and kick-off times are entered in the
 * fixture list below, and the next round fills itself the moment a result is
 * recorded — see `advanceBracket` in `/api/tournaments/[id]/matches`.
 * The rounds rail scrolls sideways on a phone, same as the web's overflow-x.
 */
export function LeagueBracket({
  league,
  hostId,
  isHost,
  onChanged,
}: {
  league: LeagueDetail;
  hostId: number;
  isHost: boolean;
  onChanged: () => void;
}) {
  const { colors: c, isDark } = useTheme();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const bracketMatches = league.matches.filter((m) => m.bracketRound > 0);

  // One column per knockout round, in order, third place last.
  const rounds = useMemo(() => {
    const byRound = new Map<number, LeagueMatchRow[]>();
    for (const m of bracketMatches) {
      const list = byRound.get(m.bracketRound) ?? [];
      list.push(m);
      byRound.set(m.bracketRound, list);
    }
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([roundIndex, rows]) => ({
        roundIndex,
        label: rows[0]?.round ?? "Round",
        rows: rows.slice().sort((a, b) => a.slot - b.slot),
      }));
  }, [bracketMatches]);

  // Groups + knockout: the group tables are the first stage, and they are what
  // the empty "Winner Group A" slots are waiting on.
  const groups = useMemo(() => {
    const groupRounds = [
      ...new Set(league.matches.filter((m) => /^Group /.test(m.round)).map((m) => m.round)),
    ].sort();
    return groupRounds.map((round) => {
      const fixtures = league.matches.filter((m) => m.round === round);
      const ids = [...new Set(fixtures.flatMap((m) => [m.homeTeamId, m.awayTeamId]))];
      const likes = ids.map((id) => {
        const t = league.teams.find((x) => x.teamId === id);
        return {
          teamId: id,
          name: t?.name ?? "Squad",
          logoColor: t?.logoColor ?? "#16a34a",
          teamCode: t?.teamCode ?? "",
        };
      });
      const played = fixtures.filter((f) => f.homeScore !== null && f.awayScore !== null).length;
      return {
        round,
        table: standingsFor(likes, fixtures),
        done: fixtures.length > 0 && played === fixtures.length,
        played,
        total: fixtures.length,
      };
    });
  }, [league.matches, league.teams]);

  const waiting = bracketMatches.filter((m) => m.homeTeamId === 0 || m.awayTeamId === 0).length;

  async function fill() {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const data = await leagueMatchesAction(league.id, { hostId, action: "advance" });
      setMsg(String(data.message ?? "Bracket updated ✅"));
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy(false);
    }
  }

  if (bracketMatches.length === 0 && groups.length === 0) {
    return (
      <View style={[styles.emptyBox, { borderColor: c.border }]}>
        <Text style={[styles.emptyText, { color: c.textFaint }]}>
          {isHost
            ? "No bracket yet — draw it and the shape of the tournament appears here."
            : "The host hasn't drawn the bracket yet."}
        </Text>
      </View>
    );
  }

  const noticeTone = err
    ? { bg: isDark ? "rgba(239,68,68,0.10)" : "#FEF2F2", fg: "#DC2626" }
    : { bg: isDark ? "rgba(5,150,105,0.10)" : "#ECFDF5", fg: "#047857" };

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Swords size={14} color={isDark ? "#FB923C" : "#EA580C"} />
          <Text style={[styles.title, { color: isDark ? "#FB923C" : "#EA580C" }]}>The bracket</Text>
        </View>
        {isHost && waiting > 0 ? (
          <Pressable
            onPress={() => void fill()}
            disabled={busy}
            accessibilityRole="button"
            style={[styles.fillBtn, { borderColor: isDark ? "rgba(249,115,22,0.3)" : "#FED7AA" }, busy ? styles.disabled : null]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={isDark ? "#FDBA74" : "#C2410C"} />
            ) : (
              <RefreshCw size={12} color={isDark ? "#FDBA74" : "#C2410C"} />
            )}
            <Text style={[styles.fillText, { color: isDark ? "#FDBA74" : "#C2410C" }]}>
              Fill {waiting} empty {waiting === 1 ? "slot" : "slots"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.sub, { color: c.textFaint }]}>
        Win and you move right. A slot with no squad in it yet says where that squad will come
        from — it fills the moment the game before it is decided.
      </Text>

      {msg || err ? (
        <View style={[styles.notice, { backgroundColor: noticeTone.bg }]}>
          <Text style={[styles.noticeText, { color: noticeTone.fg }]}>{err || msg}</Text>
        </View>
      ) : null}

      {groups.length > 0 ? (
        <View style={styles.groups}>
          {groups.map((g) => (
            <View key={g.round} style={[styles.groupCard, { borderColor: c.border }]}>
              <View style={styles.groupHead}>
                <Text style={[styles.groupTitle, { color: isDark ? "#6EE7B7" : "#047857" }]}>
                  {g.round}
                </Text>
                <Text style={[styles.groupMeta, { color: c.textFaint }]}>
                  {g.done ? "✓ through to the bracket" : `${g.played}/${g.total} played`}
                </Text>
              </View>
              <View style={styles.groupList}>
                {g.table.slice(0, 3).map((row, i) => (
                  <View key={row.teamId} style={styles.groupRow}>
                    <View style={styles.groupTeam}>
                      <View style={[styles.groupRank, { backgroundColor: row.logoColor }]}>
                        <Text style={styles.groupRankText}>{i + 1}</Text>
                      </View>
                      <Text style={[styles.groupName, { color: c.text }]} numberOfLines={1}>
                        {row.name}
                      </Text>
                    </View>
                    <Text style={[styles.groupStat, { color: c.textFaint }]}>
                      {row.played}p • {row.points}pts
                      {i < 2 ? (
                        <Text style={{ color: isDark ? "#6EE7B7" : "#059669", fontWeight: "900" }}>
                          {" "}
                          →
                        </Text>
                      ) : null}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {rounds.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.roundsRail}
          contentContainerStyle={styles.roundsInner}
        >
          {rounds.map((round) => (
            <View key={round.roundIndex} style={styles.roundCol}>
              <Text style={[styles.roundLabel, { color: c.textFaint }]}>{round.label}</Text>
              <View style={styles.roundList}>
                {round.rows.map((m) => (
                  <Slot key={m.id} match={m} isFinal={round.label === "Final"} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={[styles.knockoutWait, { backgroundColor: c.inset }]}>
          <Text style={[styles.knockoutWaitText, { color: c.textFaint }]}>
            The knockout stage appears once the groups are drawn.
          </Text>
        </View>
      )}
    </View>
  );
}

/** One game in the bracket: two lines, the winner in bold, empty slots named. */
function Slot({ match, isFinal }: { match: LeagueMatchRow; isFinal: boolean }) {
  const { colors: c, isDark } = useTheme();
  const decided = match.homeScore !== null && match.awayScore !== null;
  const homeWon = decided && (match.homeScore ?? 0) > (match.awayScore ?? 0);
  const awayWon = decided && (match.awayScore ?? 0) > (match.homeScore ?? 0);
  const bye =
    (match.homeTeamId > 0 && match.awayTeamId === 0 && !match.awayFrom) ||
    (match.awayTeamId > 0 && match.homeTeamId === 0 && !match.homeFrom);

  return (
    <View
      style={[
        styles.slot,
        isFinal
          ? { borderColor: isDark ? "rgba(245,158,11,0.3)" : "#FCD34D", backgroundColor: isDark ? "rgba(245,158,11,0.05)" : "rgba(255,251,235,0.6)" }
          : { borderColor: c.border },
      ]}
    >
      <View style={styles.slotHead}>
        <View style={styles.slotHeadLeft}>
          {isFinal ? <Trophy size={12} color="#F59E0B" /> : null}
          <Text style={[styles.slotMeta, { color: c.textFaint }]}>
            {leagueDateLabel(match.date)}
            {match.startTime ? ` • ${formatTime12(match.startTime)}` : " • TBC"}
          </Text>
        </View>
        {bye ? <Text style={[styles.bye, { color: isDark ? "#6EE7B7" : "#059669" }]}>bye</Text> : null}
      </View>
      <Line
        name={match.homeTeamName}
        label={match.homeLabel}
        score={match.homeScore}
        won={homeWon}
        waiting={match.homeTeamId === 0}
      />
      <View style={styles.vsLine}>
        <ArrowRight size={10} color={c.border} />
        <Text style={[styles.vsLineText, { color: c.border }]}>vs</Text>
      </View>
      <Line
        name={match.awayTeamName}
        label={match.awayLabel}
        score={match.awayScore}
        won={awayWon}
        waiting={match.awayTeamId === 0}
      />
    </View>
  );
}

function Line({
  name,
  label,
  score,
  won,
  waiting,
}: {
  name: string;
  label: string;
  score: number | null;
  won: boolean;
  waiting: boolean;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={styles.line}>
      <Text
        style={[
          styles.lineName,
          waiting
            ? { fontStyle: "italic", color: c.textFaint, fontWeight: "600" }
            : won
              ? { fontWeight: "900", color: c.text }
              : { fontWeight: "700", color: c.textMuted },
        ]}
        numberOfLines={1}
      >
        {waiting ? label || "TBD" : name}
      </Text>
      <Text
        style={[
          styles.lineScore,
          { color: won ? "#059669" : c.textFaint },
        ]}
      >
        {score ?? "–"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space["5"],
    gap: space["3"],
    marginTop: space["3"],
  },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space["2"],
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  fillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  fillText: { fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.5 },
  sub: { fontSize: 11, fontWeight: "600", lineHeight: 16 },
  notice: { borderRadius: radius.xl, paddingHorizontal: space["4"], paddingVertical: 10 },
  noticeText: { fontSize: fontSize.sm, fontWeight: "700" },
  groups: { flexDirection: "row", flexWrap: "wrap", gap: space["3"] },
  groupCard: {
    flexGrow: 1,
    flexBasis: 240,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space["3"],
  },
  groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupTitle: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  groupMeta: { fontSize: 11, fontWeight: "700" },
  groupList: { marginTop: 8, gap: 4 },
  groupRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  groupTeam: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 },
  groupRank: {
    width: 16,
    height: 16,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  groupRankText: { fontSize: 8, fontWeight: "900", color: "#FFFFFF" },
  groupName: { fontSize: fontSize.sm, fontWeight: "700", flexShrink: 1 },
  groupStat: { fontSize: fontSize.sm, fontWeight: "700" },
  roundsRail: { marginTop: 4 },
  roundsInner: { gap: space["3"], paddingRight: space["4"] },
  roundCol: { minWidth: 208, flex: 1 },
  roundLabel: {
    marginBottom: 8,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  roundList: { gap: space["2"] },
  slot: { borderRadius: radius.xl, borderWidth: 1, padding: space["2.5"] ?? 10 },
  slotHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  slotHeadLeft: { flexDirection: "row", alignItems: "center", gap: 4 },
  slotMeta: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  bye: { fontSize: 11, fontWeight: "700" },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  lineName: { flex: 1, fontSize: fontSize.sm },
  lineScore: { fontSize: fontSize.sm, fontWeight: "900" },
  vsLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginVertical: 2,
  },
  vsLineText: { fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  knockoutWait: { borderRadius: radius.xl, paddingHorizontal: space["4"], paddingVertical: 24 },
  knockoutWaitText: { fontSize: fontSize.sm, fontWeight: "700", textAlign: "center" },
  emptyBox: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingHorizontal: space["4"],
    paddingVertical: 24,
    marginTop: space["3"],
  },
  emptyText: { fontSize: fontSize.sm, fontWeight: "700", textAlign: "center" },
});
