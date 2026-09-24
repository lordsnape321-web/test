import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  ArrowRight,
  CalendarCheck,
  ChevronRight,
  Clock,
  CreditCard,
  Heart,
  MapPin,
  MessageCircleHeart,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Users,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Picker } from "@react-native-picker/picker";
import {
  Animated,
  Easing,
  Image,
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
import { fetchMatches, fetchStats, fetchVenues, seedDemo } from "@/api";
import { CITY_OPTIONS, formatNPR } from "@/lib/futsal";
import { validateSearch } from "@/lib/validation";
import { useBreakpoints } from "@/lib/responsive";
import type { Match, SiteStats, Venue } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

const MARQUEE_ITEMS = [
  "⚽ Everyone's welcome here",
  "🤝 Come alone, leave with friends",
  "🔥 Weekend games & laughter",
  "💳 Pay your way — eSewa • Khalti",
  "🏆 Friendly matches daily",
  "👥 Bring your whole crew",
] as const;

/**
 * Home — a port of the web app's app/page.tsx.
 *
 * Same sections in the same order with the same copy: hero, search, trust line,
 * stat tiles, featured venues, how-it-works, open matches, community panel,
 * footer.
 *
 * Platform-native equivalents replace only rendering primitives that do not exist
 * in React Native: the global TurfBackdrop supplies the shared solid player
 * background, and the hero marquee is a bounded text rail.
 */
export default function HomeScreen() {
  const { colors: c, isDark } = useTheme();
  const { user, isOwner } = useAuth();
  const router = useRouter();
  const bp = useBreakpoints();
  const primaryText = isDark ? colors.emerald400 : colors.emerald600;
  const orangeText = isDark ? colors.orange400 : colors.orange500;
  const h2Size = bp.sm ? 30 : 24;
  const marqueeX = useRef(new Animated.Value(0)).current;
  const [marqueeGroupWidth, setMarqueeGroupWidth] = useState(0);

  useEffect(() => {
    if (!marqueeGroupWidth) return;
    marqueeX.setValue(0);
    const loop = Animated.loop(
      Animated.timing(marqueeX, {
        toValue: -(marqueeGroupWidth + space[8]),
        duration: 28000,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [marqueeGroupWidth, marqueeX]);

  const [venues, setVenues] = useState<Venue[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [q, setQ] = useState("");
  const [searchError, setSearchError] = useState("");
  const [city, setCity] = useState("All Cities");
  const [cityTouched, setCityTouched] = useState(false);
  const [loading, setLoading] = useState(true);

  const homeCity = user?.defaultCity ?? "All Cities";

  useEffect(() => {
    if (!cityTouched && CITY_OPTIONS.includes(homeCity)) setCity(homeCity);
  }, [cityTouched, homeCity]);

  useEffect(() => {
    (async () => {
      try {
        await seedDemo();
        const [v, m, s] = await Promise.all([fetchVenues(), fetchMatches(), fetchStats()]);
        setVenues(v);
        setMatches(m.slice(0, 3));
        setStats(s);
      } catch {
        // Keep the marketing shell usable while the API is offline.
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
    router.push({ pathname: "/venues", params: { q: q.trim(), city } });
  }, [city, q, router]);

  const statTiles = [
    { n: `${stats?.venues ?? "—"}`, l: "Courts near you" },
    { n: `${stats?.players ?? "—"}+`, l: "Happy players" },
    { n: `${stats?.bookings ?? "—"}+`, l: "Games played" },
    { n: `${stats?.openMatches ?? "—"}`, l: "Open games" },
  ];
  const statRows = bp.sm ? [statTiles] : [statTiles.slice(0, 2), statTiles.slice(2)];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={[]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: bp.gutter, paddingBottom: 0 }]}>
        <PageContainer padded={false}>
        {/* ── HERO ─────────────────────────────────────────────────── */}
        <View style={[styles.heroGrid, bp.lg ? styles.heroGridWide : null]}>
          <View style={[styles.heroCopy, bp.lg ? styles.heroCopyWide : null]}>
        <View style={[styles.heroBadge, { backgroundColor: c.surface, borderColor: isDark ? "rgba(249,115,22,0.30)" : "#FED7AA" }]}>
          <Sparkles size={14} color={orangeText} />
          <Text style={[styles.heroBadgeText, { color: isDark ? colors.slate200 : colors.stone700 }]} numberOfLines={2}>
            {user
              ? `Welcome back, ${user.name.split(" ")[0]}! Your game misses you ⚽`
              : "Nepal's friendliest futsal family ⚽"}
          </Text>
        </View>

        <Text style={[styles.h1, { color: isDark ? "#F8FAFC" : c.text, fontSize: bp.lg ? 58 : bp.sm ? 48 : 36, lineHeight: bp.lg ? 62 : bp.sm ? 52 : 40 }]}>
          Grab your friends.{" "}
          <Text style={{ color: primaryText }}>Tonight we play.</Text>
        </Text>

        <Text style={[styles.lede, { color: isDark ? colors.slate400 : colors.stone600 }]}>
          {stats?.venues ?? 6}+ cosy neighbourhood courts, honest prices, and a community that
          saves you a spot — even if you come alone. Book in a minute, pay your way, and just show
          up to have fun.
        </Text>

        {/* Search */}
        <View style={[styles.searchCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.searchFormRow, bp.sm ? styles.searchFormRowWide : null]}>
            <View style={[styles.searchField, bp.sm ? styles.searchFieldWide : null, { backgroundColor: c.inset }]}>
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
            <View style={[styles.searchField, styles.cityField, bp.sm ? styles.cityFieldWide : null, { backgroundColor: c.inset }]}>
              <MapPin size={16} color={c.textFaint} />
              <Picker
                selectedValue={city}
                onValueChange={(next) => {
                  setCity(String(next));
                  setCityTouched(true);
                }}
                style={[styles.cityPicker, { color: c.text }]}
                dropdownIconColor={c.textMuted}
              >
                {CITY_OPTIONS.map((option) => (
                  <Picker.Item key={option} label={option === homeCity && option !== "All Cities" ? `${option} 🏠` : option} value={option} />
                ))}
              </Picker>
            </View>
            <Pressable
              onPress={submitSearch}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.searchButton,
                bp.sm ? styles.searchButtonWide : null,
                { backgroundColor: colors.emerald600, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.searchButtonText}>Find my court</Text>
            </Pressable>
          </View>
          {searchError ? <Text style={styles.searchError}>{searchError}</Text> : null}
        </View>
        {user && homeCity !== "All Cities" ? (
          <Text style={[styles.homeCityHint, { color: c.textFaint }]}>🏠 Searching in your home city <Text style={{ color: c.textMuted, fontWeight: "800" }}>{homeCity}</Text> — <Text onPress={() => router.push("/profile")} style={{ color: c.textMuted, fontWeight: "800", textDecorationLine: "underline" }}>change it</Text></Text>
        ) : null}

        {/* Trust line */}
        <View style={styles.trustRow}>
          <TrustItem icon={ShieldCheck} color={primaryText} text="Real humans confirm every booking" />
          <TrustItem icon={CreditCard} color={primaryText} text="eSewa • Khalti (Test) • Cash" />
          <TrustItem icon={Heart} color={orangeText} text="Free cancellation with a smile" />
        </View>

        {/* Stats — a 2×2 matrix on phones, four cells in one row from sm up */}
        <View style={styles.statGrid}>
          {statRows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.statRow}>
              {row.map((s) => (
                <View
                  key={s.l}
                  style={[styles.statTile, { backgroundColor: c.surface, borderColor: c.border }]}
                >
                  <Text style={[styles.statValue, { color: c.text }]}>{s.n}</Text>
                  <Text style={[styles.statLabel, { color: c.textFaint }]}>{s.l}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
          </View>
          {bp.lg ? <HeroVisual /> : null}
        </View>

        <View style={[styles.marquee, { marginHorizontal: -bp.gutter, backgroundColor: isDark ? "#064E3B" : colors.emerald700, borderColor: isDark ? "#022C22" : "#065F46" }]}>
          <View style={styles.marqueeViewport}>
            <Animated.View style={[styles.marqueeTrack, { transform: [{ translateX: marqueeX }] }]}>
              {[0, 1].map((copy) => (
                <View
                  key={copy}
                  onLayout={copy === 0 ? (event) => setMarqueeGroupWidth(event.nativeEvent.layout.width) : undefined}
                  style={styles.marqueeGroup}
                >
                  {MARQUEE_ITEMS.map((item) => (
                    <Text key={`${copy}-${item}`} style={styles.marqueeText} numberOfLines={1}>
                      {item}
                    </Text>
                  ))}
                </View>
              ))}
            </Animated.View>
          </View>
        </View>

        {/* ── FEATURED VENUES ──────────────────────────────────────── */}
        <View style={styles.sectionHead}>
          <View style={styles.grow}>
            <Text style={[styles.kicker, { color: orangeText }]}>Neighbourhood favourites</Text>
            <Text style={[styles.h2, { color: c.text, fontSize: h2Size }]}>Courts our players love</Text>
            <Text style={[styles.sectionSub, { color: c.textMuted }]}>
              Hand-picked, honestly priced, always welcoming.
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/venues")}
            accessibilityRole="button"
            style={[styles.ghostButton, { backgroundColor: c.surface, borderColor: isDark ? c.border : colors.stone200 }]}
          >
            <Text style={[styles.ghostButtonText, { color: isDark ? colors.slate200 : colors.stone700 }]}>See all</Text>
            <ChevronRight size={16} color={isDark ? colors.slate200 : colors.stone700} />
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
              backgroundColor: isDark ? "rgba(15,23,42,0.40)" : "rgba(255,255,255,0.60)",
              borderColor: c.border,
              marginHorizontal: -bp.gutter,
              paddingHorizontal: bp.gutter,
            },
          ]}
        >
          <Text style={[styles.kicker, styles.center, { color: orangeText }]}>Easy as chatting with a friend</Text>
          <Text style={[styles.h2, styles.center, { color: c.text, fontSize: h2Size }]}>From sofa to kickoff in 3 steps</Text>
          <View style={[styles.stepsGrid, bp.md ? styles.stepsGridWide : null]}>
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
                    flex: bp.md ? 1 : undefined,
                  },
                ]}
              >
                <Text style={[styles.stepNumber, { color: isDark ? "rgba(255,255,255,0.05)" : colors.stone100 }]}>{s.step}</Text>
                <View style={[styles.stepIcon, { backgroundColor: s.bg }]}>
                  <s.icon size={24} color={s.fg} strokeWidth={2.5} />
                </View>
                <Text style={[styles.stepTitle, { color: c.text }]}>{s.title}</Text>
                <Text style={[styles.stepText, { color: c.textMuted }]}>{s.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── OPEN MATCHES ─────────────────────────────────────────── */}
        <View style={styles.sectionHead}>
          <View style={styles.grow}>
            <View style={styles.kickerRow}>
              <Zap size={14} color={orangeText} />
              <Text style={[styles.kicker, { color: orangeText }]}>Flying solo? Jump in!</Text>
            </View>
            <Text style={[styles.h2, { color: c.text, fontSize: h2Size }]}>Friendly games this week</Text>
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
          <ResponsiveGrid columns={bp.md ? 3 : 1}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.skeleton, { backgroundColor: c.surface, height: 256, marginBottom: 0 }]} />
            ))}
          </ResponsiveGrid>
        ) : (
          <ResponsiveGrid columns={bp.md ? 3 : 1}>
            {matches.map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
          </ResponsiveGrid>
        )}

        {/* ── COMMUNITY ────────────────────────────────────────────── */}
        <View
          style={[
            styles.community,
            {
              backgroundColor: isDark ? "#022C22" : "#065F46",
              padding: bp.sm ? space[12] : space[8],
            },
          ]}
        >
          <View style={[styles.communityGrid, bp.lg ? styles.communityGridWide : null]}>
            <View style={styles.communityCopy}>
          <View style={[styles.communityPill]}>
            <Trophy size={14} color="#FCD34D" />
            <Text style={styles.communityPillText}>THE FAMILY LEAGUE • SEASON 4</Text>
          </View>
          <Text style={[styles.communityTitle, { fontSize: bp.sm ? 36 : 30, lineHeight: bp.sm ? 40 : 36 }]}>
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
              <Text style={[styles.communityPrimaryText, { color: isOwner ? "#022C22" : "#065F46" }]}>
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
            </View>

            <View style={styles.testimonials}>
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
            </View>
          </View>
        </View>

        {/* ── FOOTER ───────────────────────────────────────────────── */}
        <View
          style={[
            styles.footer,
            {
              borderColor: c.border,
              marginHorizontal: -bp.gutter,
              paddingHorizontal: bp.gutter,
              backgroundColor: isDark ? "rgba(2,6,23,0.70)" : "rgba(255,255,255,0.70)",
              flexDirection: bp.sm ? "row" : "column",
              justifyContent: bp.sm ? "space-between" : "center",
            },
          ]}
        >
          <Text style={[styles.footerBrand, { color: c.text }]}>
            Futsal<Text style={{ color: primaryText }}>Nepal</Text>
            <Text style={{ color: c.textFaint, fontWeight: "500" }}>
              {" "}
              — made with 💚 for players, by players
            </Text>
          </Text>
          <View style={[styles.footerLinks, bp.sm ? styles.footerLinksWide : null]}>
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

function HeroVisual() {
  const { colors: c, isDark } = useTheme();
  const overlay = isDark ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.95)";
  const overlayText = c.text;
  const overlayMuted = c.textMuted;
  const floatY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: -10, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(floatY, { toValue: 0, duration: 2500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [floatY]);

  const floatStyle = { transform: [{ translateY: floatY }] };

  return (
    <View style={styles.heroVisual}>
      <Animated.View
        style={[
          styles.heroPhotoFrame,
          { borderColor: isDark ? colors.slate900 : colors.white },
          floatStyle,
        ]}
      >
        <Image
          source={{
            uri: "https://images.unsplash.com/photo-1574629810360-7efbbe195018?q=80&w=1200&auto=format&fit=crop",
          }}
          accessibilityLabel="Friends playing futsal together"
          style={styles.heroPhoto}
          resizeMode="cover"
        />
        <LinearGradient
          colors={["rgba(0,0,0,0.5)", "rgba(0,0,0,0)"]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={[styles.bookingOverlay, { backgroundColor: overlay }]}>
          <View style={[styles.bookingIcon, { backgroundColor: colors.emerald600 }]}>
            <CalendarCheck size={20} color="#FFFFFF" />
          </View>
          <View style={styles.bookingCopy}>
            <Text style={[styles.bookingTitle, { color: overlayText }]} numberOfLines={1}>
              Saturday with the gang 🎉
            </Text>
            <Text style={[styles.bookingMeta, { color: overlayMuted }]} numberOfLines={1}>
              Arena A • Today • 7:00 PM • 5v5
            </Text>
          </View>
          <View style={[styles.bookingStatus, { backgroundColor: isDark ? "rgba(16,185,129,0.15)" : colors.emerald100 }]}>
            <Text style={[styles.bookingStatusText, { color: isDark ? colors.emerald300 : colors.emerald700 }]}>YOU&apos;RE IN ✓</Text>
          </View>
        </View>

        <View style={styles.heroBottomCards}>
          <View style={[styles.heroSlotCard, { backgroundColor: overlay }]}>
            <View style={styles.heroMiniLabel}>
              <Clock size={14} color={overlayMuted} />
              <Text style={[styles.heroMiniLabelText, { color: overlayMuted }]}>NEXT FREE SLOT</Text>
            </View>
            <Text style={[styles.heroSlotTitle, { color: overlayText }]}>Today, 8 PM</Text>
            <Text style={[styles.heroSlotPrice, { color: isDark ? colors.emerald400 : colors.emerald600 }]}>{formatNPR(2000)}/hr</Text>
          </View>
          <View style={styles.heroJoinCard}>
            <View style={styles.heroMiniLabel}>
              <Zap size={14} color={colors.orange100} />
              <Text style={[styles.heroMiniLabelText, { color: colors.orange100 }]}>JOIN US TONIGHT</Text>
            </View>
            <Text style={styles.heroJoinTitle}>Friday Night Game — 5 friendly spots left</Text>
          </View>
        </View>
      </Animated.View>

      <Animated.View style={[styles.ratingBadge, floatStyle, { backgroundColor: overlay, borderColor: isDark ? c.border : "rgba(255,255,255,0.6)" }]}>
        <View style={[styles.ratingIcon, { backgroundColor: isDark ? "rgba(245,158,11,0.15)" : "#FEF3C7" }]}>
          <Star size={20} color={colors.amber400} fill={colors.amber400} />
        </View>
        <View style={styles.ratingCopy}>
          <Text style={[styles.ratingTitle, { color: overlayText }]}>4.8 / 5.0</Text>
          <Text style={[styles.ratingMeta, { color: overlayMuted }]} numberOfLines={1}>from 2,400+ happy players</Text>
        </View>
      </Animated.View>
    </View>
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
  content: { paddingTop: space[10], paddingBottom: space[12] },

  /* hero */
  heroGrid: { gap: space[10], paddingBottom: space[12], position: "relative", overflow: "hidden" },
  heroGridWide: { flexDirection: "row", alignItems: "center", gap: space[10] },
  heroCopy: { alignSelf: "stretch" },
  heroCopyWide: { flex: 1, minWidth: 0, alignSelf: "auto" },
  heroVisual: { flex: 1, minWidth: 0, position: "relative" },
  heroPhotoFrame: {
    height: 520,
    width: "100%",
    borderWidth: 4,
    borderRadius: 32,
    overflow: "hidden",
    shadowColor: "rgb(180,120,60)",
    shadowOpacity: 0.25,
    shadowRadius: 35,
    shadowOffset: { width: 0, height: 20 },
    elevation: 8,
  },
  heroPhoto: { width: "100%", height: "100%" },
  bookingOverlay: {
    position: "absolute",
    left: 20,
    right: 20,
    top: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radius["2xl"],
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  bookingIcon: { width: 40, height: 40, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  bookingCopy: { flex: 1, minWidth: 0 },
  bookingTitle: { fontSize: fontSize.xs, fontWeight: "900" },
  bookingMeta: { fontSize: fontSize["2xs"], marginTop: 3 },
  bookingStatus: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  bookingStatusText: { fontSize: fontSize["2xs"], fontWeight: "900" },
  heroBottomCards: { position: "absolute", left: 20, right: 20, bottom: 20, flexDirection: "row", gap: space[3] },
  heroSlotCard: { flex: 1, borderRadius: radius["2xl"], padding: 14, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  heroJoinCard: { flex: 1, borderRadius: radius["2xl"], padding: 14, backgroundColor: colors.orange500, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  heroMiniLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroMiniLabelText: { fontSize: fontSize["2xs"], fontWeight: "900" },
  heroSlotTitle: { fontSize: fontSize.lg, fontWeight: "900", marginTop: 4 },
  heroSlotPrice: { fontSize: fontSize.xs, fontWeight: "900", marginTop: 2 },
  heroJoinTitle: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900", lineHeight: 17, marginTop: 4 },
  ratingBadge: { position: "absolute", left: 20, top: 226, flexDirection: "row", alignItems: "center", gap: 10, maxWidth: "88%", borderWidth: 1, borderRadius: radius["2xl"], padding: 12, paddingRight: 20, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  ratingIcon: { width: 40, height: 40, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  ratingCopy: { minWidth: 0 },
  ratingTitle: { fontSize: fontSize.base, fontWeight: "900" },
  ratingMeta: { fontSize: fontSize["2xs"], marginTop: 2 },
  marquee: { backgroundColor: colors.emerald700, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#065F46", paddingVertical: space[3], paddingHorizontal: space[4] },
  marqueeViewport: { overflow: "hidden" },
  marqueeTrack: { flexDirection: "row", alignSelf: "flex-start", gap: space[8] },
  marqueeGroup: { flexDirection: "row", alignItems: "center", gap: space[8], flexShrink: 0 },
  marqueeText: { color: colors.emerald50, fontSize: fontSize.xs, fontWeight: "900", letterSpacing: 1.2, flexShrink: 0 },
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
    width: "100%",
    minWidth: 0,
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[2],
    marginTop: space[6],
    shadowColor: "rgb(180,120,60)",
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  searchFormRow: { width: "100%", alignItems: "stretch", gap: space[2] },
  searchFormRowWide: { flexDirection: "row", alignItems: "stretch" },
  searchField: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius["2xl"],
    paddingHorizontal: space[4],
    minHeight: 48,
  },
  searchFieldWide: { flex: 1, width: 0 },
  searchInput: { flex: 1, minWidth: 0, height: 48, fontSize: fontSize.base, fontWeight: "600", paddingVertical: 0 },
  cityField: { paddingRight: space[2] },
  cityFieldWide: { width: 176, marginTop: 0 },
  cityPicker: { flex: 1, minWidth: 0, height: 48, fontSize: fontSize.base, fontWeight: "600", padding: 0 },
  homeCityHint: { fontSize: fontSize.xs, fontWeight: "700", marginTop: space[2] },
  searchButton: {
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space[3],
  },
  searchButtonWide: { marginTop: 0, paddingHorizontal: space[6] },
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
  statGrid: { gap: space[2], marginTop: space[6] },
  statRow: { flexDirection: "row", gap: space[2] },
  statTile: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    paddingHorizontal: space[2],
    paddingVertical: space[3],
    alignItems: "center",
    shadowColor: "rgba(120,80,40,0.18)",
    shadowOpacity: 0.18,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
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
    marginBottom: space[6],
  },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  kicker: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2.4,
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
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: space[12],
    marginTop: space[12],
  },
  stepsGrid: { gap: space[4], marginTop: space[8] },
  stepsGridWide: { flexDirection: "row" },
  stepCard: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[6],
    overflow: "hidden",
    shadowColor: "rgba(120,80,40,0.18)",
    shadowOpacity: 0.18,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  stepNumber: {
    position: "absolute",
    right: -8,
    top: -16,
    fontSize: 88,
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
  stepText: { fontSize: fontSize.base, lineHeight: 23, marginTop: 6 },

  /* community */
  community: {
    borderRadius: 32,
    padding: space[8],
    marginTop: space[12],
    overflow: "hidden",
    position: "relative",
  },
  communityGrid: { gap: space[8] },
  communityGridWide: { flexDirection: "row", alignItems: "center", gap: space[8] },
  communityCopy: { flex: 1, minWidth: 0 },
  testimonials: { flex: 1, minWidth: 0, gap: space[3] },

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
  communityPillText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FDE68A" },
  communityTitle: {
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 36,
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
  footer: { borderTopWidth: 1, marginTop: space[12], paddingTop: space[8], paddingBottom: space[8], alignItems: "center" },
  footerBrand: { fontSize: fontSize.base, fontWeight: "700", textAlign: "center" },
  footerLinks: { flexDirection: "row", gap: space[5], marginTop: space[4] },
  footerLinksWide: { marginTop: 0 },
  footerLink: { fontSize: fontSize.sm, fontWeight: "700" },
});
