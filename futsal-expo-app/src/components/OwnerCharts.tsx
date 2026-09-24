import { Flame, PieChart, TrendingUp, Wallet } from "lucide-react-native";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTheme } from "@/context/ThemeContext";
import { formatNPR } from "@/lib/futsal";
import { fontSize, radius, space } from "@/theme";

/**
 * OwnerCharts — a 1:1 port of the web OwnerCharts, with RN substitutions:
 *
 *  - CSS linear-gradient bars → solid colours from the same rainbow ramp
 *  - conic-gradient donut → react-native-svg arcs (same segment maths)
 *  - hover titles → accessibilityLabel
 *
 * Copy, empty states, totals and day labels match the original.
 */

// Warm, friendly rainbow palette — one colour per bar (from/to pairs from web).
const RAINBOW = [
  { solid: "#10b981", soft: "#D1FAE5", softText: "#047857", emoji: "🌱" },
  { solid: "#f59e0b", soft: "#FEF3C7", softText: "#B45309", emoji: "☀️" },
  { solid: "#8b5cf6", soft: "#EDE9FE", softText: "#6D28D9", emoji: "💜" },
  { solid: "#06b6d4", soft: "#CFFAFE", softText: "#0E7490", emoji: "🌊" },
  { solid: "#f97316", soft: "#FFEDD5", softText: "#C2410C", emoji: "🔥" },
  { solid: "#ec4899", soft: "#FCE7F3", softText: "#BE185D", emoji: "🌸" },
  { solid: "#84cc16", soft: "#ECFCCB", softText: "#4D7C0F", emoji: "⚽" },
];

const DAY_EMOJI = ["🌙", "🌱", "🌊", "☀️", "🌈", "🎉", "⚽"];

function dayLabel(iso: string) {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short" });
  } catch {
    return iso.slice(5);
  }
}

function Card({
  title,
  icon,
  iconColor,
  right,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  iconColor: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleRow}>
          <Text style={{ color: iconColor }}>{icon}</Text>
          <Text style={[styles.cardTitle, { color: c.text }]}>{title}</Text>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function RevenueRainbow({ data }: { data: Array<[string, number]> }) {
  const { colors: c, isDark } = useTheme();
  const max = Math.max(1, ...data.map(([, v]) => v));
  const total = data.reduce((s, [, v]) => s + v, 0);
  const best = data.length > 0 ? data.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;

  if (data.length === 0) {
    return (
      <Card title="Money garden 🌱" icon={<TrendingUp size={16} />} iconColor="#10b981">
        <Text style={[styles.empty, { backgroundColor: isDark ? "#1E293B" : "#F1F5F9", color: c.textFaint }]}>
          No earnings yet — accept requests and watch this garden bloom! 💰
        </Text>
      </Card>
    );
  }

  return (
    <Card
      title="Money garden 🌱"
      icon={<TrendingUp size={16} />}
      iconColor="#10b981"
      right={
        <View style={[styles.totalPill, { backgroundColor: "rgba(16,185,129,0.15)" }]}>
          <Text style={styles.totalPillText}>
            {formatNPR(total)} in {data.length} day{data.length > 1 ? "s" : ""}
          </Text>
        </View>
      }
    >
      {best ? (
        <Text style={[styles.sub, { color: c.textMuted }]}>
          🏆 Best day: {dayLabel(best[0])} with {formatNPR(best[1])} — keep that energy!
        </Text>
      ) : null}
      <View style={styles.barRow}>
        {data.map(([day, val], i) => {
          const col = RAINBOW[i % RAINBOW.length];
          const pct = Math.max(8, (val / max) * 100);
          return (
            <View key={day} style={styles.barCol}>
              <Text style={[styles.barValue, { color: isDark ? col.softText : col.softText }]}>
                {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
              </Text>
              <View
                style={[
                  styles.bar,
                  {
                    height: `${pct}%`,
                    backgroundColor: col.solid,
                  },
                ]}
                accessibilityLabel={`${dayLabel(day)}: ${formatNPR(val)}`}
              >
                <Text style={styles.barEmoji}>{col.emoji}</Text>
              </View>
              <Text style={[styles.barDay, { color: c.textMuted }]}>
                {dayLabel(day)}
                <Text style={{ color: c.textFaint }}>{`\n${day.slice(5)}`}</Text>
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function BookingDonut({
  counts,
}: {
  counts: { pending: number; confirmed: number; completed: number; cancelled: number; rejected: number };
}) {
  const { colors: c, isDark } = useTheme();
  const segments = useMemo(() => {
    const total =
      counts.pending + counts.confirmed + counts.completed + counts.cancelled + counts.rejected;
    if (total === 0) return [] as Array<{
      label: string;
      value: number;
      color: string;
      emoji: string;
      pct: number;
    }>;
    const defs = [
      { label: "Waiting for you", value: counts.pending, color: "#f59e0b", emoji: "⏳" },
      { label: "Confirmed", value: counts.confirmed, color: "#10b981", emoji: "✅" },
      { label: "Played & happy", value: counts.completed, color: "#8b5cf6", emoji: "🎉" },
      { label: "Cancelled", value: counts.cancelled, color: "#94a3b8", emoji: "💤" },
      { label: "Declined", value: counts.rejected, color: "#ef4444", emoji: "🙏" },
    ].filter((d) => d.value > 0);
    return defs.map((d) => ({
      ...d,
      pct: Math.round((d.value / total) * 100),
    }));
  }, [counts]);

  const total = segments.reduce((s, x) => s + x.value, 0);

  return (
    <Card title="Booking rainbow 🍩" icon={<PieChart size={16} />} iconColor="#8b5cf6">
      {segments.length === 0 ? (
        <Text style={[styles.empty, { backgroundColor: isDark ? "#1E293B" : "#F1F5F9", color: c.textFaint }]}>
          Your booking story starts here — every slice is a happy player! 🌈
        </Text>
      ) : (
        <View style={styles.donutRow}>
          <View style={styles.donutHole}>
            {/* Same conic-gradient segment maths as the web, drawn as SVG arcs. */}
            <Svg width={144} height={144} viewBox="0 0 100 100">
              <Circle
                cx={50}
                cy={50}
                r={40}
                stroke={isDark ? "#1E293B" : "#E2E8F0"}
                strokeWidth={14}
                fill="none"
              />
              {(() => {
                const sum = segments.reduce((s, x) => s + x.value, 0) || 1;
                const C = 2 * Math.PI * 40;
                let offset = 0;
                return segments.map((s) => {
                  const len = (s.value / sum) * C;
                  const el = (
                    <Circle
                      key={s.label}
                      cx={50}
                      cy={50}
                      r={40}
                      stroke={s.color}
                      strokeWidth={14}
                      fill="none"
                      strokeDasharray={`${len} ${C - len}`}
                      strokeDashoffset={-offset}
                      strokeLinecap="butt"
                      rotation={-90}
                      originX={50}
                      originY={50}
                    />
                  );
                  offset += len;
                  return el;
                });
              })()}
            </Svg>
            <View style={[styles.donutCenter, { backgroundColor: c.surface }]}>
              <Text style={[styles.donutTotal, { color: c.text }]}>{total}</Text>
              <Text style={[styles.donutCap, { color: c.textFaint }]}>bookings</Text>
            </View>
          </View>
          <View style={styles.legend}>
            {segments.map((s) => (
              <View key={s.label} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                <Text style={[styles.legendLabel, { color: c.textMuted }]} numberOfLines={1}>
                  {s.emoji} {s.label}
                </Text>
                <Text style={[styles.legendVal, { color: c.text }]}>
                  {s.value} ({s.pct}%)
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </Card>
  );
}

const METHOD_STYLE: Record<string, { color: string; bg: string; soft: string; emoji: string }> = {
  eSewa: { color: "#16a34a", bg: "rgba(16,185,129,0.15)", soft: "#047857", emoji: "💚" },
  Khalti: { color: "#9333ea", bg: "rgba(147,51,234,0.15)", soft: "#6D28D9", emoji: "💜" },
  "Cash at Venue": { color: "#d97706", bg: "rgba(217,119,6,0.15)", soft: "#B45309", emoji: "💵" },
};

export function PaymentParty({ byMethod }: { byMethod: Array<[string, number, number]> }) {
  const { colors: c, isDark: darkMode } = useTheme();
  const max = Math.max(1, ...byMethod.map(([, , amt]) => amt));

  return (
    <Card title="How friends pay 🎊" icon={<Wallet size={16} />} iconColor="#0ea5e9">
      {byMethod.length === 0 ? (
        <Text style={[styles.empty, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9", color: c.textFaint }]}>
          Payment stories will dance here soon! 💃
        </Text>
      ) : (
        <View style={{ gap: space[3] }}>
          {byMethod.map(([method, count, amt]) => {
            const s = METHOD_STYLE[method] ?? METHOD_STYLE["Cash at Venue"];
            return (
              <View key={method}>
                <View style={styles.payHead}>
                  <View style={[styles.payChip, { backgroundColor: s.bg }]}>
                    <Text style={[styles.payChipText, { color: s.soft }]}>
                      {s.emoji} {method} × {count}
                    </Text>
                  </View>
                  <Text style={[styles.payAmt, { color: c.text }]}>{formatNPR(amt)}</Text>
                </View>
                <View style={[styles.payTrack, { backgroundColor: darkMode ? "#1E293B" : "#F1F5F9" }]}>
                  <View
                    style={[
                      styles.payFill,
                      {
                        width: `${Math.max(6, (amt / max) * 100)}%`,
                        backgroundColor: s.color,
                      },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

export function PeakHours({ byHour }: { byHour: Array<[string, number]> }) {
  const { colors: c, isDark } = useTheme();
  const max = Math.max(1, ...byHour.map(([, n]) => n));

  return (
    <Card title="Busiest kickoff times 🔥" icon={<Flame size={16} />} iconColor="#f97316">
      {byHour.length === 0 ? (
        <Text style={[styles.empty, { backgroundColor: isDark ? "#1E293B" : "#F1F5F9", color: c.textFaint }]}>
          Rush hours will glow here once games roll in! ⚽
        </Text>
      ) : (
        <View style={styles.peakRow}>
          {byHour.map(([hour, n], i) => (
            <View key={hour} style={styles.peakCol}>
              <Text style={[styles.peakCount, { color: c.textMuted }]}>{n}×</Text>
              <View
                style={[
                  styles.peakBar,
                  {
                    height: `${Math.max(8, (n / max) * 100)}%`,
                    backgroundColor: "#f97316",
                    opacity: 0.55 + (n / max) * 0.45,
                  },
                ]}
                accessibilityLabel={`${hour}: ${n} bookings`}
              />
              <Text style={[styles.peakHour, { color: c.textFaint }]}>{hour}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={[styles.tip, { color: c.textMuted }]}>
        {DAY_EMOJI[new Date().getDay()]} Tip: evenings fill fastest — nudge players toward sunny
        morning slots for easy wins! ☀️
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[5],
  },
  cardHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
    marginBottom: space[2],
  },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  cardTitle: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  empty: {
    borderRadius: radius.xl,
    paddingHorizontal: space[4],
    paddingVertical: space[8],
    textAlign: "center",
    fontSize: fontSize.sm,
    overflow: "hidden",
  },
  totalPill: {
    borderRadius: radius.full,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  totalPillText: { color: "#047857", fontSize: fontSize.xs, fontWeight: "900" },
  sub: { fontSize: fontSize.xs, fontWeight: "700", marginBottom: space[2] },
  barRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[2],
    height: 192,
    marginTop: space[2],
  },
  barCol: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  barValue: { fontSize: fontSize["2xs"], fontWeight: "900" },
  bar: {
    width: "100%",
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 4,
    minHeight: 12,
  },
  barEmoji: { fontSize: fontSize.sm },
  barDay: { fontSize: 10, fontWeight: "800", textAlign: "center" },
  donutRow: { flexDirection: "row", alignItems: "center", gap: space[5], marginTop: space[2] },
  donutHole: {
    width: 144,
    height: 144,
    alignItems: "center",
    justifyContent: "center",
  },
  donutCenter: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  donutTotal: { fontSize: fontSize["2xl"], fontWeight: "900" },
  donutCap: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  legend: { flex: 1, minWidth: 0, gap: space[1.5] },
  legendRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendLabel: { flex: 1, minWidth: 0, fontSize: fontSize.xs, fontWeight: "700" },
  legendVal: { fontSize: fontSize.xs, fontWeight: "800" },
  payHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  payChip: { borderRadius: radius.full, paddingHorizontal: space[2.5], paddingVertical: space[1] },
  payChipText: { fontSize: fontSize.xs, fontWeight: "900" },
  payAmt: { fontSize: fontSize.xs, fontWeight: "800" },
  payTrack: {
    height: 12,
    borderRadius: radius.full,
    marginTop: space[1.5],
    overflow: "hidden",
  },
  payFill: { height: "100%", borderRadius: radius.full },
  peakRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[1.5],
    height: 144,
    marginTop: space[2],
  },
  peakCol: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end", gap: 2 },
  peakCount: { fontSize: 10, fontWeight: "800" },
  peakBar: { width: "100%", borderRadius: radius.lg, minHeight: 10 },
  peakHour: { fontSize: 9, fontWeight: "700" },
  tip: { marginTop: space[2], fontSize: fontSize.xs, lineHeight: 16, fontWeight: "600" },
});
