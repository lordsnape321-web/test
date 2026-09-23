import { Star } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { useTheme } from "@/context/ThemeContext";
import type { PlayerStats } from "@/lib/loyalty";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * PlayerRating — a 1:1 port of the web app's components/PlayerRating.tsx.
 *
 * Two exports, as in the original:
 *   - PlayerRatingBadge: the compact pill (star + rating + emoji) shown in lists.
 *   - PlayerRatingCard: the profile's reliability card with the SVG donut.
 *
 * The donut is drawn with react-native-svg rather than an inline <svg>: same
 * geometry (r=42, strokeWidth=10, circumference ≈ 264), same -90° rotation so
 * the arc starts at 12 o'clock, same amber fill over a neutral track.
 */

type Tier = { bg: string; text: string };

/** Rating tier colours, transcribed from the web component's class ladder. */
function tierFor(rating: number, isDark: boolean): Tier {
  if (rating >= 4.5)
    return { bg: "rgba(16,185,129,0.15)", text: isDark ? colors.emerald300 : colors.emerald700 };
  if (rating >= 3.5)
    return { bg: "rgba(132,204,22,0.15)", text: isDark ? "#BEF264" : "#4D7C0F" }; // lime
  if (rating >= 2.5)
    return { bg: "rgba(245,158,11,0.15)", text: isDark ? colors.amber300 : "#B45309" }; // amber
  return { bg: "rgba(239,68,68,0.15)", text: isDark ? colors.red400 : colors.red600 };
}

export function PlayerRatingBadge({
  stats,
  size = "md",
}: {
  stats: PlayerStats;
  size?: "sm" | "md";
}) {
  const { isDark } = useTheme();
  const tier = tierFor(stats.rating, isDark);
  const sm = size === "sm";
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tier.bg, paddingHorizontal: sm ? space[2] : space[2.5], paddingVertical: sm ? 2 : space[1] },
      ]}
    >
      <Star size={sm ? 12 : 14} color={tier.text} fill={tier.text} />
      <Text style={[styles.badgeText, { color: tier.text, fontSize: sm ? fontSize["2xs"] : fontSize.xs }]}>
        {stats.rating.toFixed(1)} {stats.emoji}
      </Text>
    </View>
  );
}

export function PlayerRatingCard({ stats }: { stats: PlayerStats }) {
  const { colors: c, isDark } = useTheme();
  const pct = Math.round((stats.rating / 5) * 100);
  const CIRC = 264;
  const dash = `${(pct / 100) * CIRC} ${CIRC}`;
  const track = isDark ? "rgba(255,255,255,0.10)" : colors.stone100;

  const tiles = [
    { l: "Played 🎉", v: String(stats.completed) },
    { l: "Cancelled 🚫", v: String(stats.cancelled) },
    { l: "This month ⚠️", v: `${stats.cancelsThisMonth}/3` },
  ];

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text style={styles.cardTitle}>My reliability {stats.emoji}</Text>

      <View style={styles.donutRow}>
        <View style={styles.donutBox}>
          <Svg width={96} height={96} viewBox="0 0 100 100">
            <G rotation={-90} originX={50} originY={50}>
              <Circle cx={50} cy={50} r={42} stroke={track} strokeWidth={10} fill="none" />
              <Circle
                cx={50}
                cy={50}
                r={42}
                stroke={colors.amber400}
                strokeWidth={10}
                strokeLinecap="round"
                strokeDasharray={dash}
                fill="none"
              />
            </G>
          </Svg>
          <View style={styles.donutCenter}>
            <Text style={[styles.donutValue, { color: c.text }]}>{stats.rating.toFixed(1)}</Text>
            <Text style={[styles.donutMax, { color: c.textFaint }]}>/ 5</Text>
          </View>
        </View>

        <View style={styles.grow}>
          <Text style={[styles.label, { color: c.text }]}>{stats.label}</Text>
          <Text style={[styles.labelSub, { color: c.textMuted }]}>
            {stats.total === 0
              ? "Play your first game to earn stars! Every completed game builds trust. 🌱"
              : `${stats.completed} played • ${stats.cancelled} cancelled. Venues see this — keep it shiny! ✨`}
          </Text>
        </View>
      </View>

      <View style={styles.tiles}>
        {tiles.map((t) => (
          <View key={t.l} style={[styles.tile, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : colors.stone50 }]}>
            <Text style={[styles.tileValue, { color: c.text }]} numberOfLines={1}>
              {t.v}
            </Text>
            <Text style={[styles.tileLabel, { color: c.textFaint }]}>{t.l}</Text>
          </View>
        ))}
      </View>

      {stats.blocked ? (
        <Text style={[styles.banner, { backgroundColor: "rgba(239,68,68,0.10)", color: isDark ? colors.red400 : colors.red600 }]}>
          🛑 Booking paused — 3 cancels this month. It resets next month. Please honour your games! 🙏
        </Text>
      ) : stats.cancelsThisMonth > 0 ? (
        <Text style={[styles.banner, { backgroundColor: "rgba(245,158,11,0.10)", color: isDark ? colors.amber300 : "#B45309" }]}>
          ⚠️ {stats.cancelsThisMonth}/3 cancels used this month. One more stretch of no-shows pauses booking — play fair! 💛
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },

  /* Badge */
  badge: { flexDirection: "row", alignItems: "center", gap: space[1], borderRadius: radius.full, alignSelf: "flex-start" },
  badgeText: { fontWeight: "900" },

  /* Card */
  card: { borderRadius: radius["3xl"], borderWidth: 1, padding: space[5] },
  cardTitle: {
    fontSize: fontSize.base,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: colors.amber400,
  },
  donutRow: { flexDirection: "row", alignItems: "center", gap: space[4], marginTop: space[3] },
  donutBox: { width: 96, height: 96, alignItems: "center", justifyContent: "center" },
  donutCenter: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  donutValue: { fontSize: fontSize["2xl"], fontWeight: "900" },
  donutMax: { fontSize: fontSize["2xs"], fontWeight: "700" },
  label: { fontSize: fontSize.lg, fontWeight: "900" },
  labelSub: { fontSize: fontSize.xs, lineHeight: 17, marginTop: 2 },

  /* Tiles */
  tiles: { flexDirection: "row", gap: space[2], marginTop: space[3] },
  tile: { flex: 1, borderRadius: radius.xl, paddingHorizontal: 4, paddingVertical: space[2], alignItems: "center" },
  tileValue: { fontSize: fontSize.base, fontWeight: "900" },
  tileLabel: { fontSize: fontSize["2xs"], fontWeight: "700", textAlign: "center" },

  /* Banner */
  banner: { marginTop: space[3], borderRadius: radius.xl, paddingHorizontal: 14, paddingVertical: 10, fontSize: fontSize.xs, fontWeight: "700", lineHeight: 17 },
});
