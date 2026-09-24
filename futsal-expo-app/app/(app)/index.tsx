import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  ArrowRight,
  CalendarCheck,
  ChevronRight,
  CreditCard,
  Heart,
  MapPin,
  MessageCircleHeart,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MatchCard, VenueCard } from "@/components/cards";
import { PageContainer, ResponsiveGrid } from "@/components/layout";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { fetchMatches, fetchStats, fetchVenues } from "@/api";
import { formatNPR } from "@/lib/futsal";
import { validateSearch } from "@/lib/validation";
import { useBreakpoints } from "@/lib/responsive";
import type { Match, SiteStats, Venue } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Home — a port of the web app's app/page.tsx.
 *
 * Same sections in the same order with the same copy: hero, search, trust line,
 * stat tiles, featured venues, how-it-works, open matches, community panel,
 * footer.
 *
 * Deliberate omissions, both decorative and neither representable without extra
 * native modules:
 *  - the blurred colour blobs behind the hero (CSS blur filters)
 *  - the infinite marquee strip (a CSS keyframe animation)
 *  - the desktop-only hero photo column (hidden below `lg` on web too, so a
 *    phone never showed it)
 * The gradient headline is rendered in the gradient's start colour rather than
 * clipped to a gradient, which RN text cannot do natively.
 */
export default function HomeScreen() {
  const { colors: c, isDark } = useTheme();
  const { user, isOwner } = useAuth();
  const router = useRouter();
  const bp = useBreakpoints();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [q, setQ] = useState("");
  const [searchError, setSearchError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [v, m, s] = await Promise.all([fetchVenues(), fetchMatches(), fetchStats()]);
        setVenues(v);
        setMatches(m.slice(0, 3));
        setStats(s);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const featured = venues.filter((v) => v.isFeatured).slice(0, 3);
  const showVenues = (featured.length > 0 ? featured : venues).slice(0, 3);

  const submitSearch = useCallback(() => {
    const err = validateSearch(q, { max: 60 });
    if (err) {
      setSearchError(err);
      return;
    }
    setSearchError("");
    router.push({ pathname: "/venues", params: { q: q.trim() } });
  }, [q, router]);

  const statTiles = [
    { n: `${stats?.venues ?? "—"}`, l: "Courts near you" },
    { n: `${stats?.players ?? "—"}+`, l: "Happy players" },
    { n: `${stats?.bookings ?? "—"}+`, l: "Games played" },
    { n: `${stats?.openMatches ?? "—"}`, l: "Open games" },
  ];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: bp.gutter }]}>
        <PageContainer padded={false}>
        {/* ── HERO ─────────────────────────────────────────────────── */}
        <View style={[styles.heroBadge, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Sparkles size={14} color={colors.orange500} />
          <Text style={[styles.heroBadgeText, { color: c.text }]} numberOfLines={2}>
            {user
              ? `Welcome back, ${user.name.split(" ")[0]}! Your game misses you ⚽`
              : "Nepal's friendliest futsal family ⚽"}
          </Text>
        </View>

        <Text style={[styles.h1, { color: c.text }]}>
          Grab your friends.{" "}
          <Text style={{ color: colors.emerald600 }}>Tonight we play.</Text>
        </Text>

        <Text style={[styles.lede, { color: c.textMuted }]}>
          {stats?.venues ?? 6}+ cosy neighbourhood courts, honest prices, and a community that
          saves you a spot — even if you come alone. Book in a minute, pay your way, and just show
          up to have fun.
        </Text>

        {/* Search */}
        <View style={[styles.searchCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.searchField, { backgroundColor: c.inset }]}>
            <Search size={16} color={c.textFaint} />
            <TextInput
              value={q}
              onChangeText={(t) => {
                setQ(t);
                setSearchError(validateSearch(t, { max: 60 }) ?? "");
              }}
              onSubmitEditing={submitSearch}
              placeholder="Where do you want to play? (e.g. Chabahil)"
              placeholderTextColor={c.textFaint}
              maxLength={60}
              autoCorrect={false}
              returnKeyType="search"
              style={[styles.searchInput, { color: c.text }]}
            />
          </View>
          <Pressable
            onPress={submitSearch}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.searchButton,
              { backgroundColor: colors.emerald600, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.searchButtonText}>Find my court</Text>
          </Pressable>
          {searchError ? <Text style={styles.searchError}>{searchError}</Text> : null}
        </View>

        {/* Trust line */}
        <View style={styles.trustRow}>
          <TrustItem icon={ShieldCheck} color={colors.emerald600} text="Real humans confirm every booking" />
          <TrustItem icon={CreditCard} color={colors.emerald600} text="eSewa • Khalti (Test) • Cash" />
          <TrustItem icon={Heart} color={colors.orange500} text="Free cancellation with a smile" />
        </View>

        {/* Stats — grid-cols-2 sm:grid-cols-4 */}
        <View style={styles.statGrid}>
          {statTiles.map((s) => (
            <View
              key={s.l}
              style={[
                styles.statTile,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  flexBasis: `${100 / bp.statColumns}%`,
                  maxWidth: `${100 / bp.statColumns}%`,
                },
              ]}
            >
              <Text style={[styles.statValue, { color: c.text }]}>{s.n}</Text>
              <Text style={[styles.statLabel, { color: c.textFaint }]}>{s.l}</Text>
            </View>
          ))}
        </View>

        {/* ── FEATURED VENUES ──────────────────────────────────────── */}
        <View style={styles.sectionHead}>
          <View style={styles.grow}>
            <Text style={styles.kicker}>Neighbourhood favourites</Text>
            <Text style={[styles.h2, { color: c.text }]}>Courts our players love</Text>
            <Text style={[styles.sectionSub, { color: c.textMuted }]}>
              Hand-picked, honestly priced, always welcoming.
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/venues")}
            accessibilityRole="button"
            style={[styles.ghostButton, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <Text style={[styles.ghostButtonText, { color: c.text }]}>See all</Text>
            <ChevronRight size={16} color={c.text} />
          </Pressable>
        </View>

        {loading ? (
          <ResponsiveGrid>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.skeleton, { backgroundColor: c.surface, marginBottom: 0 }]} />
            ))}
          </ResponsiveGrid>
        ) : (
          <ResponsiveGrid>
            {showVenues.map((v) => (
              <VenueCard key={v.id} v={v} />
            ))}
          </ResponsiveGrid>
        )}

        {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
        <View
          style={[
            styles.howWrap,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              flexDirection: "row",
              flexWrap: "wrap",
              columnGap: space[3],
            },
          ]}
        >
          <Text style={[styles.kicker, styles.center]}>Easy as chatting with a friend</Text>
          <Text style={[styles.h2, styles.center, { color: c.text }]}>
            From sofa to kickoff in 3 steps
          </Text>
          {[
            {
              icon: Search,
              step: "01",
              title: "Find your spot",
              text: "Browse nearby courts with real photos, honest prices and reviews from players like you.",
              bg: isDark ? "rgba(16,185,129,0.15)" : colors.emerald100,
              fg: isDark ? colors.emerald300 : colors.emerald700,
            },
            {
              icon: CalendarCheck,
              step: "02",
              title: "Book in a minute",
              text: "Pick a time that suits, pay with eSewa, Khalti or cash — the venue confirms personally.",
              bg: isDark ? "rgba(249,115,22,0.15)" : colors.orange100,
              fg: isDark ? colors.orange300 : colors.orange600,
            },
            {
              icon: Users,
              step: "03",
              title: "Show up & play",
              text: "Bring your energy (or come solo!). Make friends, join weekly games and feel at home.",
              bg: isDark ? "rgba(245,158,11,0.15)" : "#FEF3C7",
              fg: isDark ? "#FCD34D" : "#B45309",
            },
          ].map((s) => (
            <View
              key={s.step}
              style={[
                styles.stepCard,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  // lg:grid-cols-3 — three equal steps on wide screens
                  flexBasis: bp.lg ? "32%" : "100%",
                  maxWidth: bp.lg ? "32%" : "100%",
                },
              ]}
            >
              <Text style={[styles.stepNumber, { color: c.inset }]}>{s.step}</Text>
              <View style={[styles.stepIcon, { backgroundColor: s.bg }]}>
                <s.icon size={24} color={s.fg} strokeWidth={2.5} />
              </View>
              <Text style={[styles.stepTitle, { color: c.text }]}>{s.title}</Text>
              <Text style={[styles.stepText, { color: c.textMuted }]}>{s.text}</Text>
            </View>
          ))}
        </View>

        {/* ── OPEN MATCHES ─────────────────────────────────────────── */}
        <View style={styles.sectionHead}>
          <View style={styles.grow}>
            <View style={styles.kickerRow}>
              <Zap size={14} color={colors.orange500} />
              <Text style={styles.kicker}>Flying solo? Jump in!</Text>
            </View>
            <Text style={[styles.h2, { color: c.text }]}>Friendly games this week</Text>
            <Text style={[styles.sectionSub, { color: c.textMuted }]}>
              No team needed — just bring yourself, we'll handle the rest.
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/matches")}
            accessibilityRole="button"
            style={[styles.solidButton, { backgroundColor: colors.emerald600 }]}
          >
            <Text style={styles.solidButtonText}>Join a game</Text>
            <ArrowRight size={16} color="#FFFFFF" />
          </Pressable>
        </View>

        {loading ? (
          <ResponsiveGrid>
            {[0, 1].map((i) => (
              <View key={i} style={[styles.skeleton, { backgroundColor: c.surface, marginBottom: 0 }]} />
            ))}
          </ResponsiveGrid>
        ) : (
          <ResponsiveGrid>
            {matches.map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
          </ResponsiveGrid>
        )}

        {/* ── COMMUNITY ────────────────────────────────────────────── */}
        <LinearGradient
          colors={[colors.emerald700, "#064E3B"]}
          style={styles.community}
        >
          <View style={[styles.communityPill]}>
            <Trophy size={14} color="#FCD34D" />
            <Text style={styles.communityPillText}>THE FAMILY LEAGUE • SEASON 4</Text>
          </View>
          <Text style={styles.communityTitle}>
            Got a crew? Play together, laugh together, win together.
          </Text>
          <Text style={styles.communityBody}>
            Start your team in seconds, track your journey, and join weekend tournaments across
            Kathmandu, Lalitpur & Pokhara. Winners take home Rs. 1,00,000 — and bragging rights
            forever. 😄
          </Text>
          <View style={styles.communityButtons}>
            <Pressable
              onPress={() => router.push(isOwner ? "/admin" : "/teams")}
              accessibilityRole="button"
              style={[styles.communityPrimary, { backgroundColor: isOwner ? colors.amber400 : "#FFFFFF" }]}
            >
              <Text style={[styles.communityPrimaryText, { color: isOwner ? "#052E16" : colors.emerald700 }]}>
                {isOwner ? "Open owner dashboard 👑" : "Start your team"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.push("/venues")}
              accessibilityRole="button"
              style={styles.communitySecondary}
            >
              <Play size={16} color="#FFFFFF" />
              <Text style={styles.communitySecondaryText}>Book a kickabout</Text>
            </Pressable>
          </View>

          {[
            {
              q: "Came alone on a Friday, left with 9 new friends. Best decision ever!",
              n: "Aarav S. • Striker, Kathmandu",
            },
            {
              q: "Booking takes a minute and the venue uncle always greets us by name. Feels like home.",
              n: "Bikash T. • Midfielder, Lalitpur",
            },
            {
              q: "Our office team plays every Wednesday now. Zero stress, pure joy.",
              n: "Priya M. • Captain, Pokhara",
            },
          ].map((t) => (
            <View key={t.n} style={styles.testimonial}>
              <View style={styles.testimonialRow}>
                <MessageCircleHeart size={16} color={colors.amber300} />
                <Text style={styles.testimonialQuote}>“{t.q}”</Text>
              </View>
              <Text style={styles.testimonialName}>{t.n}</Text>
            </View>
          ))}
        </LinearGradient>

        {/* ── FOOTER ───────────────────────────────────────────────── */}
        <View style={[styles.footer, { borderColor: c.border }]}>
          <Text style={[styles.footerBrand, { color: c.text }]}>
            Futsal<Text style={{ color: colors.emerald600 }}>Nepal</Text>
            <Text style={{ color: c.textFaint, fontWeight: "500" }}>
              {" "}
              — made with 💚 for players, by players
            </Text>
          </Text>
          <View style={styles.footerLinks}>
            {[
              { label: "Courts", to: "/venues" },
              { label: "Games", to: "/matches" },
              { label: "Teams", to: "/teams" },
              { label: "Join us", to: "/signup" },
            ].map((l) => (
              <Pressable key={l.label} onPress={() => router.push(l.to as never)}>
                <Text style={[styles.footerLink, { color: c.textMuted }]}>{l.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

function TrustItem({
  icon: Icon,
  color,
  text,
}: {
  icon: typeof Heart;
  color: string;
  text: string;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={styles.trustItem}>
      <Icon size={16} color={color} />
      <Text style={[styles.trustText, { color: c.textMuted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1 },
  center: { textAlign: "center" },
  content: { padding: space[4], paddingBottom: space[12] },

  /* hero */
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    alignSelf: "flex-start",
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  heroBadgeText: { fontSize: fontSize.sm, fontWeight: "700", flexShrink: 1 },
  h1: { fontSize: 34, fontWeight: "900", lineHeight: 38, letterSpacing: -0.8, marginTop: space[5] },
  lede: { fontSize: fontSize.md, lineHeight: 22, marginTop: space[4] },

  /* search */
  searchCard: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[2],
    marginTop: space[6],
  },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: fontSize.base, fontWeight: "600", paddingVertical: 0 },
  searchButton: {
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space[3],
    marginTop: space[2],
  },
  searchButtonText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },
  searchError: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    color: colors.red500,
    paddingHorizontal: space[2],
    paddingTop: 4,
  },

  /* trust */
  trustRow: { flexDirection: "row", flexWrap: "wrap", gap: space[4], marginTop: space[5] },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  trustText: { fontSize: fontSize.sm, fontWeight: "600" },

  /* stats */
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[6] },
  statTile: {
    flexGrow: 1,
    flexBasis: "47%",
    borderRadius: radius["2xl"],
    borderWidth: 1,
    paddingHorizontal: space[2],
    paddingVertical: space[3],
    alignItems: "center",
  },
  statValue: { fontSize: fontSize["2xl"], fontWeight: "900" },
  statLabel: {
    fontSize: fontSize["2xs"],
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    textAlign: "center",
  },

  /* sections */
  sectionHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: space[3],
    marginTop: space[12],
    marginBottom: space[4],
  },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  kicker: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.6,
    color: colors.orange500,
  },
  h2: { fontSize: fontSize["3xl"], fontWeight: "900", marginTop: 4 },
  sectionSub: { fontSize: fontSize.base, marginTop: 4 },

  ghostButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  ghostButtonText: { fontSize: fontSize.sm, fontWeight: "900" },
  solidButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  solidButtonText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },

  skeleton: { height: 288, borderRadius: radius["3xl"], marginBottom: space[4] },

  /* how it works */
  howWrap: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[5],
    marginTop: space[10],
  },
  stepCard: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[5],
    marginTop: space[3],
    overflow: "hidden",
  },
  stepNumber: {
    position: "absolute",
    right: -4,
    top: -14,
    fontSize: 76,
    fontWeight: "900",
  },
  stepIcon: {
    width: 48,
    height: 48,
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  stepTitle: { fontSize: fontSize.xl, fontWeight: "800", marginTop: space[4] },
  stepText: { fontSize: fontSize.base, lineHeight: 20, marginTop: 6 },

  /* community */
  community: {
    borderRadius: 32,
    padding: space[8],
    marginTop: space[10],
  },
  communityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    alignSelf: "flex-start",
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  communityPillText: { fontSize: fontSize.sm, fontWeight: "900", color: colors.amber300 },
  communityTitle: {
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 32,
    color: "#FFFFFF",
    marginTop: space[4],
  },
  communityBody: {
    fontSize: fontSize.base,
    lineHeight: 21,
    color: "rgba(209,250,229,0.8)",
    marginTop: space[3],
  },
  communityButtons: { flexDirection: "row", flexWrap: "wrap", gap: space[3], marginTop: space[6] },
  communityPrimary: {
    borderRadius: radius["2xl"],
    paddingHorizontal: space[6],
    paddingVertical: space[3],
  },
  communityPrimaryText: { fontSize: fontSize.base, fontWeight: "900" },
  communitySecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    paddingHorizontal: space[6],
    paddingVertical: space[3],
  },
  communitySecondaryText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },

  testimonial: {
    borderRadius: radius["2xl"],
    backgroundColor: "rgba(255,255,255,0.10)",
    padding: space[4],
    marginTop: space[3],
  },
  testimonialRow: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  testimonialQuote: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: "600",
    lineHeight: 20,
    color: "#FFFFFF",
  },
  testimonialName: {
    fontSize: fontSize.sm,
    fontWeight: "700",
    color: "rgba(167,243,208,0.7)",
    marginTop: 6,
    paddingLeft: 24,
  },

  /* footer */
  footer: { borderTopWidth: 1, marginTop: space[10], paddingTop: space[8], alignItems: "center" },
  footerBrand: { fontSize: fontSize.base, fontWeight: "700", textAlign: "center" },
  footerLinks: { flexDirection: "row", gap: space[5], marginTop: space[4] },
  footerLink: { fontSize: fontSize.sm, fontWeight: "700" },
});
