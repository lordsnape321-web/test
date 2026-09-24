import { useRouter } from "expo-router";
import {
  ArrowUpRight,
  CalendarDays,
  Coins,
  Crown,
  Lock,
  MapPin,
  Shield,
  Trophy,
  Users,
} from "lucide-react-native";
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/context/ThemeContext";
import {
  leagueModeLabel,
  leagueStatusLabel,
  leagueVisibilityLabel,
  paymentState,
} from "@/lib/league";
import { formatNPR, initials, prettyDate } from "@/lib/futsal";
import type { LeagueSummary } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * A league on a card 🏆 — a 1:1 port of the web app's components/LeagueCard.tsx.
 *
 * Everything a captain asks before entering, in the order they ask it: where is
 * it, how many squads, what does it cost up front, what's the prize, and am I
 * already in? The deposit line is deliberately loud — "pay Rs. 1,500 to lock
 * your place" is the deal, and a captain who finds that out after saying yes to
 * their squad is a captain who feels tricked.
 *
 * Tailwind → RN: the gradient banner overlay is a LinearGradient layered over
 * the image; hover lift/translate becomes pressed opacity (no hover on touch).
 */
export function LeagueCard({
  league,
  compact = false,
  onPress,
}: {
  league: LeagueSummary;
  compact?: boolean;
  /** Override navigation for scoped shells such as Owner Studio. */
  onPress?: () => void;
}) {
  const { colors: c, isDark } = useTheme();
  const router = useRouter();

  const status = leagueStatusLabel(league.status);
  const mode = leagueModeLabel(league.mode);
  const spotsLeft = Math.max(0, league.maxTeams - league.approvedTeams);
  const mine = league.viewer?.myTeams ?? [];
  const leading = mine.find((m) => m.status === "approved") ?? mine[0];
  const isHost = league.viewer?.isHost ?? false;

  return (
    <Pressable
      onPress={onPress ?? (() => router.push(`/leagues/${league.id}`))}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        compact && styles.compact,
        {
          backgroundColor: c.surface,
          borderColor: pressed ? colors.emerald300 : c.border,
          opacity: pressed ? 0.96 : 1,
        },
      ]}
    >
      <View style={styles.banner}>
        {league.bannerUrl ? (
          <Image source={{ uri: league.bannerUrl }} style={styles.bannerImg} resizeMode="cover" />
        ) : (
          <LinearGradient
            colors={["#059669", "#047857", "#0C0A09"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        {/* from-black/75 via-black/20 to-transparent, bottom to top */}
        <LinearGradient
          colors={["rgba(0,0,0,0.75)", "rgba(0,0,0,0.2)", "rgba(0,0,0,0)"]}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: isDark ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.92)" }]}>
            <Text style={[styles.badgeText, { color: isDark ? colors.slate100 : "#292524" }]}>
              {status.emoji} {status.label}
            </Text>
          </View>
          {/* How a winner gets decided, before the price does — a knockout
              reads completely differently to a captain than a round robin. */}
          <View style={[styles.badge, { backgroundColor: "rgba(251,146,60,0.95)" }]}>
            <Text style={[styles.badgeText, { color: "#431407" }]}>
              {mode.emoji} {mode.label}
            </Text>
          </View>
          {league.visibility === "private" ? (
            <View style={[styles.badge, styles.badgeRowInner, { backgroundColor: "rgba(28,25,23,0.85)" }]}>
              <Lock size={12} color="#FCD34D" />
              <Text style={[styles.badgeText, { color: "#FCD34D" }]}>Private</Text>
            </View>
          ) : null}
          {isHost ? (
            <View style={[styles.badge, styles.badgeRowInner, { backgroundColor: "#FBBF24" }]}>
              <Crown size={12} color="#422006" />
              <Text style={[styles.badgeText, { color: "#422006" }]}>You host</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.bannerText}>
          <Text style={styles.bannerTitle} numberOfLines={1}>
            {league.name}
          </Text>
          <View style={styles.bannerMeta}>
            <MapPin size={12} color="rgba(255,255,255,0.85)" />
            <Text style={styles.bannerMetaText} numberOfLines={1}>
              {league.venueName}
              {league.venueCity ? ` • ${league.venueCity}` : ""}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {/* Three cells of ~80px on a phone: flex + numberOfLines keeps a big
            prize pool ("Rs. 1,00,000") from blowing the card wide. */}
        <View style={styles.statRow}>
          {[
            { v: `${league.approvedTeams}/${league.maxTeams}`, l: "SQUADS" },
            { v: league.format, l: "FORMAT" },
            { v: league.prizePool > 0 ? formatNPR(league.prizePool) : "Cup", l: "PRIZE" },
          ].map((s) => (
            <View key={s.l} style={[styles.statCell, { backgroundColor: c.inset }]}>
              <Text style={[styles.statValue, { color: c.text }]} numberOfLines={1}>
                {s.v}
              </Text>
              <Text style={styles.statLabel}>{s.l}</Text>
            </View>
          ))}
        </View>

        <View style={styles.moneyBlock}>
          <View style={styles.metaLine}>
            <Coins size={14} color={colors.emerald600} />
            {league.entryFee > 0 ? (
              <Text style={[styles.metaText, { color: c.textMuted }]}>
                {formatNPR(league.entryFee)} per squad •{" "}
                <Text style={[styles.metaStrong, { color: c.text }]}>
                  {formatNPR(league.deposit)} to lock a place
                </Text>
              </Text>
            ) : (
              <Text style={[styles.metaText, { color: c.textMuted }]}>Free entry — just turn up 🎟️</Text>
            )}
          </View>
          <View style={styles.metaLine}>
            <CalendarDays size={14} color={colors.emerald600} />
            <Text style={[styles.metaText, { color: c.textMuted }]}>
              Starts {prettyDate(league.startsAt)}
              {league.matchDays ? ` • ${league.matchDays}` : ""}
            </Text>
          </View>
          <View style={styles.metaLine}>
            <Trophy size={14} color={colors.emerald600} />
            <Text style={[styles.metaText, { color: c.textMuted }]}>
              {league.playedMatches} of {league.totalMatches || "—"} fixtures played • hosted by{" "}
              {league.hostName}
              {league.hostRole === "owner" ? " 🏟️" : ""}
            </Text>
          </View>
          {league.entryFee > 0 ? (
            <View style={styles.metaLine}>
              <Shield size={12} color={c.textFaint} />
              <Text style={[styles.metaFine, { color: c.textFaint }]}>
                Back out and {league.refundPercent}% of what you paid comes back
              </Text>
            </View>
          ) : null}
        </View>

        {/* My squad's own line — the one thing this viewer actually cares about. */}
        {leading ? (
          <View
            style={[
              styles.myLine,
              {
                backgroundColor:
                  leading.status === "approved"
                    ? isDark
                      ? "rgba(16,185,129,0.10)"
                      : "#ECFDF5"
                      : isDark
                        ? "rgba(245,158,11,0.10)"
                        : "#FFFBEB",
              },
            ]}
          >
            <View style={styles.metaLine}>
              <Users size={14} color={leading.status === "approved" ? "#047857" : "#B45309"} />
              <Text
                style={[
                  styles.myLineText,
                  { color: leading.status === "approved" ? "#047857" : "#B45309" },
                ]}
              >
                {leading.teamName}: {leading.payment.emoji} {leading.payment.label}
              </Text>
            </View>
            {leading.status !== "approved" ? (
              <Text
                style={[
                  styles.myLineStatus,
                  { color: leading.status === "approved" ? "#047857" : "#B45309" },
                ]}
              >
                {leading.status === "invited"
                  ? "You've been invited"
                  : leading.status === "requested"
                    ? "Waiting on the host"
                    : leading.status}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={[styles.footerLeft, { color: c.textFaint }]}>
            {isHost
              ? league.pendingTeams > 0
                ? `${league.pendingTeams} waiting on you`
                : "Your control room"
              : spotsLeft > 0
                ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`
                : "Full"}
          </Text>
          <View style={styles.openBtn}>
            <Text style={styles.openBtnText}>Open league</Text>
            <ArrowUpRight size={14} color="#FFFFFF" />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** Initials bubble reused by league rows so a squad reads the same everywhere. */
export function LeagueTeamChip({
  name,
  logoColor,
  teamCode,
  onPress,
}: {
  name: string;
  logoColor: string;
  teamCode?: string;
  onPress?: () => void;
}) {
  const { colors: c } = useTheme();
  const body = (
    <View style={styles.chipRow}>
      <View style={[styles.chipAvatar, { backgroundColor: logoColor }]}>
        <Text style={styles.chipAvatarText}>{initials(name)}</Text>
      </View>
      <View style={styles.grow}>
        <Text style={[styles.chipName, { color: c.text }]} numberOfLines={1}>
          {name}
        </Text>
        {teamCode ? (
          <Text style={[styles.chipCode, { color: c.textFaint }]} numberOfLines={1}>
            {teamCode}
          </Text>
        ) : null}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  );
}

/** "Rs. 1,500 of Rs. 6,000 in" — one line, used in the host console and the squad panel. */
export function PaymentLine({
  entryFee,
  paidAmount,
  refundedAmount,
  depositPercent,
  refundPercent,
  locked,
}: {
  entryFee: number;
  paidAmount: number;
  refundedAmount?: number;
  depositPercent?: number;
  refundPercent?: number;
  /** Set once the squad has played — their money is the league's from here on. */
  locked?: boolean;
}) {
  const { colors: c } = useTheme();
  const state = paymentState({ entryFee, paidAmount, refundedAmount, depositPercent, refundPercent });
  return (
    <Text style={[styles.paymentLine, { color: c.textMuted }]}>
      {state.emoji} {entryFee > 0 ? `${formatNPR(state.paid)} of ${formatNPR(entryFee)}` : "Free entry"}
      {entryFee > 0 && state.deposit > 0 && !state.depositMet
        ? ` • deposit ${formatNPR(state.deposit)}`
        : ""}
      {entryFee > 0 && state.due > 0 && state.depositMet ? ` • ${formatNPR(state.due)} to settle` : ""}
      {locked ? " • 🔒 locked in" : ""}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "rgba(180,120,60,0.08)",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 30,
    elevation: 2,
  },
  compact: { width: 300, maxWidth: "100%", flexGrow: 0 },
  banner: { height: 128, position: "relative", justifyContent: "space-between" },
  bannerImg: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, width: "100%", height: "100%" },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    padding: space["3"],
    zIndex: 1,
  },
  badgeRowInner: { flexDirection: "row", alignItems: "center", gap: 4 },
  badge: {
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 10, fontWeight: "900" },
  bannerText: { paddingHorizontal: space["3"], paddingBottom: 10, zIndex: 1 },
  bannerTitle: {
    fontSize: fontSize.md,
    fontWeight: "900",
    color: "#FFFFFF",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  bannerMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  bannerMetaText: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.85)" },
  body: { padding: space["4"], flex: 1, justifyContent: "space-between", gap: space["3"] },
  statRow: { flexDirection: "row", gap: space["2"] },
  statCell: { flex: 1, minWidth: 0, borderRadius: radius.lg, paddingVertical: 8, paddingHorizontal: 4, alignItems: "center" },
  statValue: { fontSize: fontSize.base, fontWeight: "900" },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: "#A8A29E",
    marginTop: 1,
  },
  moneyBlock: { gap: 6 },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  metaText: { fontSize: fontSize.sm, fontWeight: "600", flexShrink: 1 },
  metaStrong: { fontWeight: "900" },
  metaFine: { fontSize: 11, fontWeight: "700", flexShrink: 1 },
  myLine: { borderRadius: radius.lg, paddingHorizontal: space["3"], paddingVertical: 8, gap: 2 },
  myLineText: { fontSize: 11, fontWeight: "700" },
  myLineStatus: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginLeft: 20,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space["2"],
    marginTop: space["2"],
  },
  footerLeft: { fontSize: 11, fontWeight: "700", flexShrink: 1 },
  openBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#059669",
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  openBtnText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FFFFFF" },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flex: 1 },
  chipAvatar: {
    width: 28,
    height: 28,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  chipAvatarText: { fontSize: 10, fontWeight: "900", color: "#FFFFFF" },
  grow: { flex: 1, minWidth: 0 },
  chipName: { fontSize: fontSize.sm, fontWeight: "700" },
  chipCode: { fontSize: 10, fontWeight: "700" },
  paymentLine: { fontSize: 11, fontWeight: "700" },
});
