import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowRight, BadgeCheck, Clock, MapPin, Star, Users, Zap } from "lucide-react-native";
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { useTheme } from "@/context/ThemeContext";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import type { Match, Venue } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * VenueCard and MatchCard — 1:1 ports of the web app's components/cards.tsx.
 *
 * Layout, copy, badge wording and colour choices follow the original. Where CSS
 * cannot be expressed directly the nearest RN equivalent is used:
 *   - `bg-gradient-to-t from-black/50` -> LinearGradient bottom-to-top
 *   - `hover:-translate-y-1` / `card-glow` -> pressed opacity (no hover on touch)
 *   - `-space-x-2` avatar stack -> negative marginLeft
 *
 * The cards take the canonical API types rather than re-declaring local copies.
 * The earlier local shapes drifted from what the routes actually return — they
 * required `imageUrl: string` and `chargeMode?: string` where the API sends
 * `string | null` — and every call site needed an `as never` cast to compile.
 * The aliases below keep the original names working.
 */

export type VenueWithCourts = Venue;
export type MatchItem = Match;

export function VenueCard({ v }: { v: VenueWithCourts }) {
  const { colors: c } = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/venues/${v.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.venueCard,
        { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <View style={styles.venueImageWrap}>
        {v.imageUrl ? (
          <Image source={{ uri: v.imageUrl }} style={styles.venueImage} resizeMode="cover" />
        ) : (
          <View style={[styles.venueImage, { backgroundColor: colors.stone200 }]} />
        )}
        {/* from-black/50 via-transparent to-transparent, bottom to top */}
        <LinearGradient
          colors={["rgba(0,0,0,0.5)", "rgba(0,0,0,0)", "rgba(0,0,0,0)"]}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />

        {v.isFeatured ? (
          <View style={[styles.badge, styles.badgeFeatured]}>
            <Zap size={12} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.badgeFeaturedText}>Loved by players</Text>
          </View>
        ) : null}

        <View style={[styles.badge, styles.badgeRating, { backgroundColor: c.surface }]}>
          <Star size={12} color={colors.amber400} fill={colors.amber400} />
          <Text style={[styles.badgeRatingText, { color: c.text }]}>
            {v.rating.toFixed(1)}
            <Text style={{ color: c.textFaint, fontWeight: "500" }}> ({v.totalReviews})</Text>
          </Text>
        </View>

        <View style={[styles.badge, styles.badgePrice, { backgroundColor: c.surface }]}>
          <Text style={[styles.badgePriceText, { color: c.activeText }]}>
            From {formatNPR(v.minPrice)}/hr
          </Text>
        </View>
      </View>

      <View style={styles.venueBody}>
        <Text style={[styles.venueName, { color: c.text }]} numberOfLines={1}>
          {v.name}
        </Text>
        <View style={styles.venueAddressRow}>
          <MapPin size={14} color={c.textMuted} />
          <Text style={[styles.venueAddress, { color: c.textMuted }]} numberOfLines={1}>
            {v.address} • {v.city}
          </Text>
        </View>

        <View style={[styles.venueFooter, { borderTopColor: c.border }]}>
          <View style={styles.venueStat}>
            <Users size={14} color={c.textMuted} />
            <Text style={[styles.venueStatText, { color: c.textMuted }]}>
              {v.courtCount} courts
            </Text>
          </View>
          <View style={styles.venueStat}>
            <Clock size={14} color={c.textMuted} />
            <Text style={[styles.venueStatText, { color: c.textMuted }]}>
              {v.openingHour}:00 – {v.closingHour}:00
            </Text>
          </View>
          <View style={styles.venueStat}>
            <Text style={[styles.venueStatText, { color: colors.emerald600, fontWeight: "900" }]}>
              Book
            </Text>
            <ArrowRight size={14} color={colors.emerald600} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export function MatchCard({ m }: { m: MatchItem }) {
  const { colors: c } = useTheme();
  const router = useRouter();

  const pct = Math.round((m.joinedCount / Math.max(1, m.maxPlayers)) * 100);
  const full = m.spotsLeft === 0;
  const crew = m.crewSize ?? 1;
  const others = m.otherJoined ?? Math.max(0, m.joinedCount - crew);

  return (
    <View style={[styles.matchCard, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.matchHead}>
        <View style={styles.grow}>
          <Text style={[styles.matchTitle, { color: c.text }]}>{m.title}</Text>
          <Text style={[styles.matchSub, { color: c.textMuted }]}>
            hosted by {m.organizer?.name ?? "a friend"} •{" "}
            {m.level === "All Levels" ? "🌍 Anyone welcome" : `🎯 ${m.level}`}
          </Text>
          <Text style={[styles.matchCrew, { color: c.textFaint }]}>
            👥 {crew} crew • 🙋 {others} joined
          </Text>

          <View style={styles.matchChips}>
            {m.bookingId ? (
              <View style={[styles.chip, { backgroundColor: c.activeSoft }]}>
                <BadgeCheck size={12} color={c.activeText} />
                <Text style={[styles.chipText, { color: c.activeText }]}>
                  Court already sorted
                </Text>
              </View>
            ) : null}
            {m.chargeMode === "custom" ? (
              <View style={[styles.chip, { backgroundColor: "rgba(139,92,246,0.15)" }]}>
                <Text style={[styles.chipText, { color: colors.violet700 }]}>
                  ✨ Custom {formatNPR(m.pricePerPlayer)}
                </Text>
              </View>
            ) : (
              <View style={[styles.chip, { backgroundColor: "rgba(14,165,233,0.10)" }]}>
                <Text style={[styles.chipText, { color: colors.sky700 }]}>🤝 Fair split</Text>
              </View>
            )}
          </View>
        </View>

        <View
          style={[
            styles.spotsBadge,
            { backgroundColor: full ? colors.red100 : colors.orange100 },
          ]}
        >
          <Text
            style={[styles.spotsBadgeText, { color: full ? colors.red600 : colors.orange700 }]}
          >
            {full ? "Full house" : `${m.spotsLeft} spots left`}
          </Text>
        </View>
      </View>

      {/* Date / Time / Share tiles */}
      <View style={styles.tileRow}>
        <View style={[styles.tile, { backgroundColor: c.inset }]}>
          <Text style={[styles.tileLabel, { color: c.textFaint }]}>Date</Text>
          <Text style={[styles.tileValue, { color: c.text }]} numberOfLines={1}>
            {prettyDate(m.date)}
          </Text>
        </View>
        <View style={[styles.tile, { backgroundColor: c.inset }]}>
          <Text style={[styles.tileLabel, { color: c.textFaint }]}>Time</Text>
          <Text style={[styles.tileValue, { color: c.text }]} numberOfLines={1}>
            {formatTime12(m.startTime)}
          </Text>
        </View>
        <View style={[styles.tile, { backgroundColor: c.activeSoft }]}>
          <Text style={[styles.tileLabel, { color: c.textFaint }]}>Share</Text>
          <Text style={[styles.tileValue, { color: c.activeText }]} numberOfLines={1}>
            {formatNPR(m.pricePerPlayer)}
          </Text>
        </View>
      </View>

      <View style={styles.matchVenueRow}>
        <MapPin size={14} color={c.textMuted} />
        <Text style={[styles.matchVenue, { color: c.textMuted }]} numberOfLines={1}>
          {m.venue?.name ?? ""} — {m.venue?.address ?? ""}
        </Text>
      </View>

      {/* Progress */}
      <View style={styles.progressHead}>
        <Text style={[styles.progressLabel, { color: c.textMuted }]}>
          {m.joinedCount}/{m.maxPlayers} friends in
        </Text>
        <Text style={[styles.progressLabel, { color: colors.emerald600 }]}>{pct}% full</Text>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: c.inset }]}>
        <LinearGradient
          colors={[colors.emerald500, colors.orange400]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.progressFill, { width: `${Math.min(100, pct)}%` }]}
        />
      </View>

      <View style={styles.matchFooter}>
        <View style={styles.avatarStack}>
          {(m.players ?? []).slice(0, 5).map((p, i) => (
            <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
              <Avatar
                user={{ name: p.name, avatarColor: p.avatarColor, avatarUrl: p.avatarUrl }}
                size={28}
                ring={{ width: 2, color: c.surface }}
              />
            </View>
          ))}
          {m.joinedCount > 5 ? (
            <View
              style={[
                styles.moreAvatar,
                { marginLeft: -8, backgroundColor: c.inset, borderColor: c.surface },
              ]}
            >
              <Text style={[styles.moreAvatarText, { color: c.textMuted }]}>
                +{m.joinedCount - 5}
              </Text>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={() => router.push("/matches")}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.viewButton,
            { backgroundColor: colors.emerald600, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.viewButtonText}>View</Text>
          <ArrowRight size={14} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },

  /* ── VenueCard ─────────────────────────────────────────────────────── */
  venueCard: {
    borderWidth: 1,
    borderRadius: radius["3xl"],
    overflow: "hidden",
    marginBottom: space[4],
  },
  venueImageWrap: { height: 192, backgroundColor: colors.stone200 },
  venueImage: { width: "100%", height: "100%" },
  badge: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeFeatured: {
    left: 12,
    top: 12,
    backgroundColor: colors.orange500,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  badgeFeaturedText: {
    color: "#FFFFFF",
    fontSize: fontSize["2xs"],
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  badgeRating: { right: 12, top: 12 },
  badgeRatingText: { fontSize: fontSize.sm, fontWeight: "700" },
  badgePrice: { left: 12, bottom: 12 },
  badgePriceText: { fontSize: fontSize.xs, fontWeight: "700" },

  venueBody: { padding: space[4] },
  venueName: { fontSize: fontSize.md, fontWeight: "800" },
  venueAddressRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  venueAddress: { fontSize: fontSize.sm, flex: 1 },
  venueFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    marginTop: space[3],
    paddingTop: space[3],
  },
  venueStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  venueStatText: { fontSize: fontSize.sm, fontWeight: "600" },

  /* ── MatchCard ─────────────────────────────────────────────────────── */
  matchCard: {
    borderWidth: 1,
    borderRadius: radius["3xl"],
    padding: space[5],
    marginBottom: space[4],
  },
  matchHead: { flexDirection: "row", justifyContent: "space-between", gap: space[3] },
  matchTitle: { fontSize: fontSize.md, fontWeight: "800", lineHeight: 20 },
  matchSub: { fontSize: fontSize.sm, color: colors.stone500, marginTop: 4 },
  matchCrew: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 4 },
  matchChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: { fontSize: fontSize["2xs"], fontWeight: "900" },
  spotsBadge: {
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  spotsBadgeText: {
    fontSize: fontSize["2xs"],
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  tileRow: { flexDirection: "row", gap: space[2], marginTop: space[3] },
  tile: {
    flex: 1,
    borderRadius: radius["2xl"],
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  tileLabel: {
    fontSize: fontSize["2xs"],
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  tileValue: { fontSize: fontSize.sm, fontWeight: "800", marginTop: 2 },

  matchVenueRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  matchVenue: { fontSize: fontSize.sm, flex: 1 },

  progressHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: space[3],
  },
  progressLabel: { fontSize: fontSize.xs, fontWeight: "700" },
  progressTrack: {
    height: 8,
    borderRadius: radius.full,
    overflow: "hidden",
    marginTop: 6,
  },
  progressFill: { height: "100%", borderRadius: radius.full },

  matchFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space[3],
  },
  avatarStack: { flexDirection: "row", alignItems: "center" },
  moreAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  moreAvatarText: { fontSize: fontSize["2xs"], fontWeight: "900" },
  viewButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    minHeight: 36,
  },
  viewButtonText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
});
