import { Medal, Target, Trophy } from "lucide-react-native";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useTheme } from "@/context/ThemeContext";
import type { StandingRow } from "@/lib/league";
import { initials } from "@/lib/futsal";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * The league table 📊 — a 1:1 port of the web app's components/LeagueTable.tsx.
 *
 * Real results only: a fixture without a score is a fixture, not a row, so a
 * table that appears here is one somebody actually earned. `form` carries the
 * last five results — the first thing anyone looks at after the points column.
 *
 * The web table is `min-w-[560px]` inside an `overflow-x-auto`; here that
 * becomes a horizontal ScrollView with the same 560px floor, so a phone pans
 * sideways instead of crushing the columns.
 */
export function LeagueTable({
  standings,
  highlightTeamIds = [],
  emptyHint = "The table fills up as results come in.",
  onTeamPress,
}: {
  standings: StandingRow[];
  highlightTeamIds?: number[];
  emptyHint?: string;
  /** Scoped shells can keep squad navigation inside their own route tree. */
  onTeamPress?: (teamId: number) => void;
}) {
  const { colors: c, isDark } = useTheme();
  const router = useRouter();

  if (standings.length === 0)
    return (
      <View style={[styles.empty, { borderColor: c.border }]}>
        <Text style={[styles.emptyText, { color: c.textFaint }]}>{emptyHint}</Text>
      </View>
    );

  return (
    <View style={[styles.wrap, { borderColor: c.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroll}>
        <View style={styles.table}>
          {/* head */}
          <View style={[styles.row, styles.head, { backgroundColor: "#047857" }]}>
            <Text style={[styles.th, styles.colRank]}>#</Text>
            <Text style={[styles.th, styles.colSquad]}>Squad</Text>
            <Text style={[styles.th, styles.colNum]}>P</Text>
            <Text style={[styles.th, styles.colNum]}>W</Text>
            <Text style={[styles.th, styles.colNum]}>D</Text>
            <Text style={[styles.th, styles.colNum]}>L</Text>
            <Text style={[styles.th, styles.colNum]}>GF</Text>
            <Text style={[styles.th, styles.colNum]}>GA</Text>
            <Text style={[styles.th, styles.colNum]}>GD</Text>
            <Text style={[styles.th, styles.colPts]}>Pts</Text>
            <Text style={[styles.th, styles.colForm]}>Form</Text>
          </View>
          {standings.map((row, i) => {
            const mine = highlightTeamIds.includes(row.teamId);
            return (
              <View
                key={row.teamId}
                style={[
                  styles.row,
                  styles.bodyRow,
                  {
                    backgroundColor: mine
                      ? isDark
                        ? "rgba(16,185,129,0.10)"
                        : "rgba(236,253,245,0.7)"
                      : c.surface,
                  },
                  { borderColor: isDark ? "rgba(255,255,255,0.05)" : "#FAFAF9" },
                ]}
              >
                <View style={[styles.colRank, styles.rankCell]}>
                  {i === 0 ? (
                    <Trophy size={14} color="#F59E0B" />
                  ) : i === 1 ? (
                    <Medal size={14} color="#A8A29E" />
                  ) : i === 2 ? (
                    <Medal size={14} color="#FB923C" />
                  ) : null}
                  <Text style={[styles.rankText, { color: c.textMuted }]}>{i + 1}</Text>
                </View>
                <View style={[styles.colSquad, styles.squadCell]}>
                  <Pressable
                    onPress={() =>
                      onTeamPress ? onTeamPress(row.teamId) : router.push(`/teams/${row.teamId}`)
                    }
                    accessibilityRole="button"
                    style={styles.squadPress}
                  >
                    <View style={[styles.avatar, { backgroundColor: row.logoColor }]}>
                      <Text style={styles.avatarText}>{initials(row.name)}</Text>
                    </View>
                    <View style={styles.grow}>
                      <Text style={[styles.squadName, { color: c.text }]} numberOfLines={1}>
                        {row.name}
                        {mine ? <Text style={styles.youBadge}> YOU</Text> : null}
                      </Text>
                    </View>
                  </Pressable>
                </View>
                <Text style={[styles.colNum, styles.td, { color: c.textMuted }]}>{row.played}</Text>
                <Text style={[styles.colNum, styles.td, styles.tdWin]}>{row.won}</Text>
                <Text style={[styles.colNum, styles.td, { color: c.textMuted }]}>{row.drawn}</Text>
                <Text style={[styles.colNum, styles.td, styles.tdLoss]}>{row.lost}</Text>
                <Text style={[styles.colNum, styles.td, { color: c.textMuted }]}>{row.goalsFor}</Text>
                <Text style={[styles.colNum, styles.td, { color: c.textMuted }]}>{row.goalsAgainst}</Text>
                <Text style={[styles.colNum, styles.td, { color: c.textMuted }]}>
                  {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                </Text>
                <View style={[styles.colPts, styles.ptsCell]}>
                  <View style={[styles.ptsPill, { backgroundColor: isDark ? "rgba(16,185,129,0.15)" : "#D1FAE5" }]}>
                    <Text style={[styles.ptsText, { color: isDark ? "#6EE7B7" : "#047857" }]}>
                      {row.points}
                    </Text>
                  </View>
                </View>
                <View style={[styles.colForm, styles.formCell]}>
                  {row.form.length === 0 ? (
                    <Text style={[styles.formEmpty, { color: c.border }]}>—</Text>
                  ) : (
                    row.form.map((f, k) => (
                      <View
                        key={k}
                        accessibilityLabel={f === "W" ? "Won" : f === "D" ? "Drew" : "Lost"}
                        style={[
                          styles.formBox,
                          {
                            backgroundColor:
                              f === "W" ? "#059669" : f === "D" ? "#A8A29E" : "#EF4444",
                          },
                        ]}
                      >
                        <Text style={styles.formBoxText}>{f}</Text>
                      </View>
                    ))
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/** The prize split, rendered as the host wrote it — a list, not a paragraph. */
export function PrizeBreakdown({
  lines,
  prizePool,
}: {
  lines: Array<{ place: string; prize: string }>;
  prizePool: number;
}) {
  const { colors: c, isDark } = useTheme();
  if (lines.length === 0 && prizePool <= 0) return null;

  const prizeBg = isDark ? "rgba(245,158,11,0.10)" : null;
  const prizeBorder = isDark ? "rgba(245,158,11,0.25)" : "#FCD34D";
  const labelColor = isDark ? "#FCD34D" : "#B45309";
  const rowBorder = isDark ? "rgba(245,158,11,0.20)" : "rgba(252,211,77,0.6)";

  const body = (
    <View
      style={[
        styles.prizeCard,
        { borderColor: prizeBorder, backgroundColor: prizeBg ?? "#FFFBEB" },
      ]}
    >
      <View style={styles.prizeHead}>
        <Target size={14} color={labelColor} />
        <Text style={[styles.prizeHeadText, { color: labelColor }]}>PRIZE POOL</Text>
      </View>
      {lines.length === 0 ? (
        <Text style={[styles.prizeFallback, { color: c.textMuted }]}>
          Bragging rights and a trophy 🏆
        </Text>
      ) : (
        <View style={styles.prizeList}>
          {lines.map((l, i) => (
            <View
              key={`${l.place}-${i}`}
              style={[
                styles.prizeRow,
                i === lines.length - 1 ? null : { borderBottomColor: rowBorder, borderBottomWidth: 1 },
              ]}
            >
              <Text style={[styles.prizePlace, { color: isDark ? "#E7E5E4" : "#44403C" }]}>
                {l.place}
              </Text>
              <Text style={[styles.prizeValue, { color: labelColor }]}>{l.prize}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  // Light mode gets the web's amber→orange gradient; dark uses the flat tint.
  if (isDark || prizeBg) return body;
  return (
    <LinearGradient
      colors={["#FFFBEB", "#FFF7ED"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.prizeCard, { borderColor: prizeBorder }]}
    >
      <View style={styles.prizeHead}>
        <Target size={14} color={labelColor} />
        <Text style={[styles.prizeHeadText, { color: labelColor }]}>PRIZE POOL</Text>
      </View>
      {lines.length === 0 ? (
        <Text style={[styles.prizeFallback, { color: colors.stone600 }]}>
          Bragging rights and a trophy 🏆
        </Text>
      ) : (
        <View style={styles.prizeList}>
          {lines.map((l, i) => (
            <View
              key={`${l.place}-${i}`}
              style={[
                styles.prizeRow,
                i === lines.length - 1 ? null : { borderBottomColor: rowBorder, borderBottomWidth: 1 },
              ]}
            >
              <Text style={[styles.prizePlace, { color: "#44403C" }]}>{l.place}</Text>
              <Text style={[styles.prizeValue, { color: labelColor }]}>{l.prize}</Text>
            </View>
          ))}
        </View>
      )}
    </LinearGradient>
  );
}

const ROW_HEIGHT = 40;

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: "hidden",
  },
  scroll: { minWidth: 560 },
  table: { minWidth: 560 },
  row: { flexDirection: "row", alignItems: "center" },
  head: { paddingHorizontal: 4, paddingVertical: 10 },
  bodyRow: { borderBottomWidth: StyleSheet.hairlineWidth, minHeight: ROW_HEIGHT },
  th: {
    fontSize: 10,
    fontWeight: "900",
    color: "#ECFDF5",
    textTransform: "uppercase",
    letterSpacing: 1,
    textAlign: "left",
    paddingHorizontal: 6,
  },
  td: { fontSize: fontSize.sm, fontWeight: "700", textAlign: "center", paddingHorizontal: 4 },
  colRank: { width: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
  colSquad: { width: 148, paddingHorizontal: 6 },
  colNum: { width: 36, textAlign: "center" },
  colPts: { width: 56, alignItems: "center" },
  colForm: { width: 96, paddingHorizontal: 6 },
  rankCell: { paddingVertical: 8 },
  rankText: { fontSize: fontSize.sm, fontWeight: "900" },
  squadCell: { paddingVertical: 6 },
  squadPress: { flexDirection: "row", alignItems: "center", gap: 8 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 10, fontWeight: "900", color: "#FFFFFF" },
  grow: { flex: 1, minWidth: 0 },
  squadName: { fontSize: fontSize.sm, fontWeight: "700" },
  youBadge: {
    fontSize: 9,
    fontWeight: "900",
    color: "#FFFFFF",
    backgroundColor: "#059669",
    borderRadius: radius.full,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
  tdWin: { color: "#059669" },
  tdLoss: { color: "#EF4444" },
  ptsCell: { alignItems: "center", paddingVertical: 6 },
  ptsPill: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  ptsText: { fontSize: fontSize.sm, fontWeight: "900" },
  formCell: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 },
  formBox: {
    width: 16,
    height: 16,
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  formBoxText: { fontSize: 9, fontWeight: "900", color: "#FFFFFF" },
  formEmpty: { fontSize: 10, fontWeight: "700" },
  empty: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingHorizontal: space["4"],
    paddingVertical: 32,
    alignItems: "center",
  },
  emptyText: { fontSize: fontSize.sm, fontWeight: "700", textAlign: "center" },
  prizeCard: { borderRadius: radius.xl, borderWidth: 1, padding: space["4"] },
  prizeHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  prizeHeadText: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  prizeFallback: { marginTop: 8, fontSize: fontSize.base, fontWeight: "700" },
  prizeList: { marginTop: 8, gap: 4 },
  prizeRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    paddingBottom: 4,
  },
  prizePlace: { fontSize: fontSize.base, fontWeight: "900", flexShrink: 1 },
  prizeValue: { fontSize: fontSize.base, fontWeight: "700" },
});
