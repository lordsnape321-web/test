import Slider from "@react-native-community/slider";
import { Picker } from "@/components/ThemedPicker";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  CalendarDays,
  Check,
  HandHeart,
  MapPin,
  Minus,
  Plus,
  Trophy,
  X,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { LeagueBrowser } from "@/components/LeagueBrowser";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { createMatch, fetchMatches, fetchVenues, joinMatch, leaveMatch } from "@/api";
import { formatNPR, formatTime12, prettyDate, timeSlots, todayISO } from "@/lib/futsal";
import {
  firstError,
  validateDateISO,
  validateMessage,
  validateMoney,
  validateTimeHM,
  validateTitle,
} from "@/lib/validation";
import { useBreakpoints } from "@/lib/responsive";
import type { Match, Venue } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Games looking for you — a port of the web app's app/matches/page.tsx.
 *
 * Same header copy, same level filter (including the rule that a specific level
 * still shows "All Levels" games, because those welcome everyone), same card
 * anatomy, same join/leave toggle and the same create-game validation chain.
 *
 * Two deliberate deviations, both forced by the platform:
 *  - The web version keeps the open/leagues toggle in the query string so it is
 *    shareable. A tab screen has no URL, so it lives in state here.
 *  - `<input type="date|time">` has no RN equivalent, so day and time use the
 *    chip pickers the booking flow already uses.
 */

const LEVEL_OPTIONS = [
  { name: "Beginner", emoji: "🌱" },
  { name: "Intermediate", emoji: "⚡" },
  { name: "Advanced", emoji: "🔥" },
];

const FILTERS = ["All", "Beginner", "Intermediate", "Advanced"] as const;

function filterLabel(f: string) {
  if (f === "All") return "🌍 Everyone";
  if (f === "Beginner") return "🌱 Beginner";
  if (f === "Intermediate") return "⚡ Intermediate";
  return "🔥 Advanced";
}

export default function MatchesScreen() {
  const { colors: c } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  // The web keeps the toggle in `?tab=leagues` (settings, the old /leagues
  // redirect, shared links). Native carries that as a route param; the state
  // below stays the source of truth after mount, same as before.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<"open" | "leagues">(
    tabParam === "leagues" ? "leagues" : "open",
  );
  useEffect(() => {
    // Keep deep links and back/forward navigation authoritative. Without the
    // open fallback, returning from `?tab=leagues` left the wrong toggle active.
    setTab(tabParam === "leagues" ? "leagues" : "open");
  }, [tabParam]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("All");
  const [joining, setJoining] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [m, v] = await Promise.all([fetchMatches(), fetchVenues()]);
    setMatches(m);
    setVenues(v);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // Loading the live matches directly keeps the navigation responsive; a
        // demo seed is optional data setup, not a prerequisite for this screen.
        await load();
      } catch {
        // Keep the filters and empty state usable while the API is offline.
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  // Same predicate as the web version.
  const filtered = matches.filter((m) => {
    if (filter === "All") return true;
    if (filter === "All Levels") return m.level === "All Levels";
    return m.level === "All Levels" || m.level.includes(filter);
  });

  async function toggleJoin(m: Match) {
    if (!user) {
      router.push("/login");
      return;
    }
    const already = (m.players ?? []).some((p) => p.id === user.id);
    setJoining(m.id);
    setError("");
    try {
      if (already) await leaveMatch(m.id, user.id);
      else await joinMatch(m.id, user.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setJoining(null);
    }
  }

  const bp = useBreakpoints();
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: bp.gutter,
            maxWidth: bp.contentMax,
            width: "100%",
            alignSelf: "center",
          },
        ]}
      >
        {/* Header */}
        <View style={styles.eyebrowRow}>
          {tab === "leagues" ? (
            <Trophy size={14} color={colors.orange500} />
          ) : (
            <HandHeart size={14} color={colors.orange500} />
          )}
          <Text style={styles.eyebrow}>
            {tab === "leagues" ? "League matches" : "Come as you are"}
          </Text>
        </View>
        <Text style={[styles.h1, { color: c.text }]}>
          {tab === "leagues" ? "Leagues and tournaments" : "Games looking for you"}
        </Text>
        <Text style={[styles.subtitle, { color: c.textMuted }]}>
          {tab === "leagues"
            ? "Squad football with a real table — enter, pay the deposit, play the fixtures, climb."
            : `${matches.length} friendly games this week • everyone gets a warm welcome`}
        </Text>

        {tab === "open" ? (
          <Pressable
            onPress={() => (user ? setShowCreate(true) : router.push("/login"))}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.startButton,
              { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Plus size={16} color={c.primaryText} strokeWidth={3} />
            <Text style={[styles.startButtonText, { color: c.primaryText }]}>Start a game</Text>
          </Pressable>
        ) : null}

        {/* Open ⇄ Leagues toggle */}
        <View
          style={[styles.toggleRow, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          {(
            [
              { id: "open", label: "Open games", icon: Zap },
              { id: "leagues", label: "League matches", icon: Trophy },
            ] as const
          ).map((t) => {
            const active = tab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setTab(t.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[
                  styles.toggleButton,
                  active ? { backgroundColor: c.primary } : null,
                ]}
              >
                <t.icon size={16} color={active ? c.primaryText : c.textMuted} strokeWidth={2.5} />
                <Text
                  style={[styles.toggleText, { color: active ? c.primaryText : c.textMuted }]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {tab === "leagues" ? (
          <LeagueBrowser />
        ) : (
          <>
            {/* Level filter */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterRail}
              contentContainerStyle={styles.filterRailContent}
            >
              {FILTERS.map((f) => {
                const active = filter === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.filterPill,
                      active
                        ? { backgroundColor: c.primary }
                        : { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 },
                    ]}
                  >
                    <Text style={[styles.filterPillText, { color: active ? c.primaryText : c.textMuted }]}>
                      {filterLabel(f)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={[styles.tip, { color: c.textFaint }]}>
              Tip: level filters also show “Anyone welcome” games — they're open to you too! 💛
            </Text>

            {!loading && filtered.length === 0 ? (
              <View style={[styles.empty, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Zap size={40} color={c.textFaint} />
                <Text style={[styles.emptyTitle, { color: c.text }]}>Quiet here for now</Text>
                <Text style={[styles.emptyBody, { color: c.textMuted }]}>
                  Be the first to start a game — friends will follow!
                </Text>
              </View>
            ) : (
              filtered.map((m) => (
                <OpenMatchCard
                  key={m.id}
                  m={m}
                  joining={joining === m.id}
                  onToggle={() => toggleJoin(m)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      <CreateGameModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        venues={venues}
        onCreated={async () => {
          setShowCreate(false);
          await load();
        }}
      />
    </SafeAreaView>
  );
}

/* ── Open match card ─────────────────────────────────────────────────────── */

function OpenMatchCard({
  m,
  joining,
  onToggle,
}: {
  m: Match;
  joining: boolean;
  onToggle: () => void;
}) {
  const { colors: c, isDark } = useTheme();
  const { user } = useAuth();

  const already = (m.players ?? []).some((p) => p.id === user?.id);
  const full = m.spotsLeft === 0 && !already;
  const pct = Math.round((m.joinedCount / Math.max(1, m.maxPlayers)) * 100);
  const crew = m.crewSize ?? 1;
  const others = m.otherJoined ?? Math.max(0, m.joinedCount - crew);
  const isCustom = (m.chargeMode ?? (m.bookingId ? "split" : "custom")) === "custom";

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.cardHead}>
        <View style={styles.grow}>
          <Text style={[styles.cardTitle, { color: c.text }]}>{m.title}</Text>
          <Text style={[styles.cardSub, { color: c.textMuted }]}>
            hosted with 💚 by {m.organizer?.name ?? "a friend"} •{" "}
            {m.level === "All Levels" ? "🌍 Anyone welcome" : `🎯 ${m.level}`}
          </Text>
          <Text style={[styles.cardCrew, { color: c.textFaint }]}>
            👥 {crew} crew • 🙋 {others} joined from outside
          </Text>
          <View style={styles.chips}>
            {m.bookingId ? (
              <View style={[styles.chip, { backgroundColor: c.activeSoft }]}>
                <Text style={[styles.chipText, { color: c.activeText }]}>
                  ✓ Court already sorted
                </Text>
              </View>
            ) : null}
            <View
              style={[
                styles.chip,
                { backgroundColor: isCustom ? "rgba(139,92,246,0.15)" : "rgba(14,165,233,0.10)" },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isCustom
                      ? isDark
                        ? colors.violet300
                        : colors.violet700
                      : isDark
                        ? colors.sky300
                        : colors.sky700,
                  },
                ]}
              >
                {isCustom ? `✨ Custom ${formatNPR(m.pricePerPlayer)}` : "🤝 Fair split"}
              </Text>
            </View>
          </View>
        </View>
        <View
          style={[
            styles.spots,
            {
              backgroundColor: full
                ? isDark
                  ? "rgba(255,255,255,0.10)"
                  : colors.stone200
                : isDark
                  ? "rgba(249,115,22,0.15)"
                  : colors.orange100,
            },
          ]}
        >
          <Text
            style={[
              styles.spotsText,
              { color: full ? c.textFaint : isDark ? colors.orange300 : colors.orange700 },
            ]}
          >
            {full ? "Full house" : `${m.spotsLeft} left`}
          </Text>
        </View>
      </View>

      {m.description ? (
        <Text style={[styles.desc, { color: c.textMuted }]}>{m.description}</Text>
      ) : null}

      <View style={styles.metaBlock}>
        <View style={styles.metaRow}>
          <MapPin size={16} color={c.primary} />
          <Text style={[styles.metaText, { color: c.textMuted }]}>
            {m.venue?.name} — {m.venue?.address}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <CalendarDays size={16} color={c.primary} />
          <Text style={[styles.metaText, { color: c.textMuted }]}>
            {prettyDate(m.date)} • {formatTime12(m.startTime)} –{" "}
            {formatTime12(m.endTime || m.startTime)}
          </Text>
          <Text style={[styles.metaPrice, { color: c.activeText }]}>
            {formatNPR(m.pricePerPlayer)} each
          </Text>
        </View>
      </View>

      <View style={[styles.track, { backgroundColor: c.inset }]}>
        <LinearGradient
          colors={[colors.emerald500, colors.orange400]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, { width: `${Math.min(100, pct)}%` }]}
        />
      </View>

      <View style={styles.peopleRow}>
        <View style={styles.stack}>
          {(m.players ?? []).slice(0, 6).map((p, i) => (
            <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
              <Avatar
                user={{ name: p.name, avatarColor: p.avatarColor, avatarUrl: p.avatarUrl }}
                size={32}
                ring={{ width: 2, color: c.surface }}
              />
            </View>
          ))}
          {m.joinedCount > 6 ? (
            <View
              style={[styles.more, { marginLeft: -8, backgroundColor: c.inset, borderColor: c.surface }]}
            >
              <Text style={[styles.moreText, { color: c.textMuted }]}>+{m.joinedCount - 6}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.count, { color: c.textMuted }]}>
          {m.joinedCount}/{m.maxPlayers} in • {m.spotsLeft} open 🙋
        </Text>
      </View>

      <Pressable
        onPress={onToggle}
        disabled={joining || full}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.joinButton,
          already
            ? {
                backgroundColor: isDark ? "rgba(239,68,68,0.12)" : colors.red50,
                borderWidth: 1,
                borderColor: isDark ? "rgba(248,113,113,0.35)" : colors.red200,
              }
            : full
              ? { backgroundColor: c.inset }
              : { backgroundColor: c.primary },
          (joining || full) && !already ? { opacity: 0.6 } : null,
          pressed ? { opacity: 0.85 } : null,
        ]}
      >
        {already ? (
          <Text style={[styles.joinText, { color: isDark ? colors.red400 : colors.red500 }]}>
            Can't make it — leave game
          </Text>
        ) : full ? (
          <Text style={[styles.joinText, { color: c.textFaint }]}>This one's full</Text>
        ) : (
          <>
            <Check size={16} color={c.primaryText} strokeWidth={3} />
            <Text style={[styles.joinText, { color: c.primaryText }]}>
              {joining ? "Saving your spot…" : `Count me in • ${formatNPR(m.pricePerPlayer)}`}
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

/* ── Create game modal ───────────────────────────────────────────────────── */

function CreateGameModal({
  visible,
  onClose,
  venues,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  venues: Venue[];
  onCreated: () => void;
}) {
  const { colors: c, isDark } = useTheme();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [venueId, setVenueId] = useState("");
  const [date, setDate] = useState(todayISO(1));
  const [start, setStart] = useState("18:00");
  const [price, setPrice] = useState(200);
  const [ourCrew, setOurCrew] = useState(5);
  const [openSpots, setOpenSpots] = useState(5);
  const [welcomeMode, setWelcomeMode] = useState<"any" | "specific">("any");
  const [welcomeLevels, setWelcomeLevels] = useState<string[]>([]);
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const days = Array.from({ length: 14 }, (_, i) => todayISO(i));
  const slots = timeSlots(6, 23);
  const totalPlayers = ourCrew + openSpots;
  const levelString =
    welcomeMode === "any" || welcomeLevels.length === 0
      ? "All Levels"
      : welcomeLevels.join(" + ");

  function toggleLevel(name: string) {
    setWelcomeLevels((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name],
    );
  }

  async function submit() {
    if (!user) return;
    const vid = venueId || (venues[0] ? String(venues[0].id) : "");
    if (!vid) {
      setFormError("Pick a venue first 🏟️");
      return;
    }

    // Identical validation chain to the web version.
    const errs: Record<string, string> = {};
    const tErr = validateTitle(title, { min: 3, max: 60, label: "Game title" });
    if (tErr) errs.title = tErr;
    const dErr = validateDateISO(date, { label: "Game day", maxDaysAhead: 60 });
    if (dErr) errs.date = dErr;
    const sErr = validateTimeHM(start, "Start time");
    if (sErr) errs.start = sErr;
    const pErr = validateMoney(price, { min: 0, max: 2000, label: "Price per friend" });
    if (pErr) errs.price = pErr;
    if (desc.trim()) {
      const mErr = validateMessage(desc.trim(), {
        min: 3,
        max: 500,
        label: "Note",
        required: false,
      });
      if (mErr) errs.desc = mErr;
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setFormError(firstError(...Object.values(errs)) ?? "Please fix the highlighted fields 🙏");
      return;
    }
    if (openSpots < 1) {
      setFormError("Open at least 1 spot for others 🙋");
      return;
    }
    if (totalPlayers < 4 || totalPlayers > 22) {
      setFormError("Total players must be between 4 and 22 🤝");
      return;
    }
    if (welcomeMode === "specific" && welcomeLevels.length === 0) {
      setFormError("Pick at least one level — or choose Anyone 🌍");
      return;
    }

    setFieldErrors({});
    setCreating(true);
    setFormError("");
    try {
      const [h] = start.split(":").map(Number);
      const venue = venues.find((v) => v.id === Number(vid));
      await createMatch({
        title,
        venueId: Number(vid),
        courtId: venue?.courts?.[0]?.id,
        organizerId: user.id,
        date,
        startTime: start,
        endTime: `${String(h + 1).padStart(2, "0")}:00`,
        pricePerPlayer: price,
        maxPlayers: totalPlayers,
        crewSize: ourCrew,
        openSpots,
        chargeMode: "custom",
        level: levelString,
        description:
          desc.trim() ||
          `👥 ${ourCrew} from our crew • 🙋 ${openSpots} open for you! Come join the fun 🤝`,
      });
      setTitle("");
      setDesc("");
      setWelcomeLevels([]);
      setWelcomeMode("any");
      onCreated();
    } catch {
      setFormError("Could not share your game — try again 🙏");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: c.surface }]}>
          <View style={styles.modalHead}>
            <View style={styles.grow}>
              <Text style={[styles.modalTitle, { color: c.text }]}>Start a friendly game ⚽</Text>
              <Text style={[styles.modalSub, { color: c.textMuted }]}>
                Your crew + open spots — we'll help fill the rest.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[styles.closeButton, { backgroundColor: c.inset }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={[styles.label, { color: c.textFaint }]}>
              Give your game a fun name
            </Text>
            <TextInput
              value={title}
              onChangeText={(t) => {
                setTitle(t);
                setFieldErrors((p) => ({ ...p, title: "" }));
              }}
              placeholder="e.g. Saturday Laughs & Goals ⚡"
              placeholderTextColor={c.textFaint}
              maxLength={60}
              style={[
                styles.input,
                {
                  backgroundColor: c.inset,
                  color: c.text,
                  borderColor: fieldErrors.title ? colors.red400 : c.border,
                },
              ]}
            />
            {fieldErrors.title ? (
              <Text style={styles.fieldError}>{fieldErrors.title}</Text>
            ) : null}

            <Text style={[styles.label, { color: c.textFaint }]}>Where?</Text>
            <View style={[styles.pickerBox, { backgroundColor: c.inset, borderColor: c.border }]}>
              <Picker
                selectedValue={venueId || (venues[0] ? String(venues[0].id) : "")}
                onValueChange={setVenueId}
                style={{ color: c.text }}
                dropdownIconColor={c.textMuted}
              >
                {venues.map((v) => (
                  <Picker.Item key={v.id} label={v.name} value={String(v.id)} />
                ))}
              </Picker>
            </View>

            <Text style={[styles.label, { color: c.textFaint }]}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {days.map((d) => {
                const active = d === date;
                return (
                  <Pressable
                    key={d}
                    onPress={() => {
                      setDate(d);
                      setFieldErrors((p) => ({ ...p, date: "" }));
                    }}
                    style={[
                      styles.dayChip,
                      active
                        ? { backgroundColor: c.primary }
                        : { backgroundColor: c.inset, borderColor: c.border, borderWidth: 1 },
                    ]}
                  >
                    <Text style={{ color: active ? c.primaryText : c.textMuted, fontSize: fontSize.sm, fontWeight: "700" }}>
                      {prettyDate(d)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {fieldErrors.date ? <Text style={styles.fieldError}>{fieldErrors.date}</Text> : null}

            <Text style={[styles.label, { color: c.textFaint }]}>Time</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {slots.map((s) => {
                const active = s === start;
                return (
                  <Pressable
                    key={s}
                    onPress={() => {
                      setStart(s);
                      setFieldErrors((p) => ({ ...p, start: "" }));
                    }}
                    style={[
                      styles.dayChip,
                      active
                        ? { backgroundColor: c.primary }
                        : { backgroundColor: c.inset, borderColor: c.border, borderWidth: 1 },
                    ]}
                  >
                    <Text style={{ color: active ? c.primaryText : c.textMuted, fontSize: fontSize.sm, fontWeight: "700" }}>
                      {formatTime12(s)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {fieldErrors.start ? <Text style={styles.fieldError}>{fieldErrors.start}</Text> : null}

            {/* Crew / open spots */}
            <View style={styles.counterRow}>
              <View style={[styles.counter, { borderColor: c.border }]}>
                <Text style={[styles.counterLabel, { color: c.text }]}>👥 Our crew</Text>
                <View style={styles.counterControls}>
                  <Pressable
                    onPress={() => setOurCrew((v) => Math.max(1, v - 1))}
                    accessibilityLabel="Fewer crew"
                    style={[styles.counterBtn, { borderColor: c.border }]}
                  >
                    <Minus size={16} color={c.text} />
                  </Pressable>
                  <Text style={[styles.counterValue, { color: c.text }]}>{ourCrew}</Text>
                  <Pressable
                    onPress={() => setOurCrew((v) => Math.min(21, v + 1))}
                    accessibilityLabel="More crew"
                    style={[styles.counterBtn, { backgroundColor: c.primary }]}
                  >
                    <Plus size={16} color="#FFFFFF" />
                  </Pressable>
                </View>
              </View>
              <View
                style={[
                  styles.counter,
                  {
                    borderColor: isDark ? "rgba(249,115,22,0.45)" : colors.orange300,
                    backgroundColor: isDark ? "rgba(249,115,22,0.10)" : colors.orange50,
                  },
                ]}
              >
                <Text style={[styles.counterLabel, { color: isDark ? colors.orange300 : colors.orange700 }]}>🙋 Open spots</Text>
                <View style={styles.counterControls}>
                  <Pressable
                    onPress={() => setOpenSpots((v) => Math.max(1, v - 1))}
                    accessibilityLabel="Fewer open spots"
                    style={[styles.counterBtn, { borderColor: isDark ? "rgba(249,115,22,0.45)" : colors.orange300 }]}
                  >
                    <Minus size={16} color={isDark ? colors.orange300 : colors.orange600} />
                  </Pressable>
                  <Text style={[styles.counterValue, { color: isDark ? colors.orange300 : colors.orange600 }]}>{openSpots}</Text>
                  <Pressable
                    onPress={() => setOpenSpots((v) => Math.min(21, v + 1))}
                    accessibilityLabel="More open spots"
                    style={[styles.counterBtn, { backgroundColor: colors.orange500 }]}
                  >
                    <Plus size={16} color="#FFFFFF" />
                  </Pressable>
                </View>
              </View>
            </View>
            <Text style={[styles.totalLine, { color: c.textMuted }]}>
              {totalPlayers} total •{" "}
              {totalPlayers >= 4 && totalPlayers <= 22 ? "perfect! ✓" : "needs 4–22 ⚠️"}
            </Text>

            {/* Who's welcome */}
            <Text style={[styles.label, { color: c.textFaint }]}>Who's welcome? 💛</Text>
            <View style={styles.welcomeRow}>
              <Pressable
                onPress={() => setWelcomeMode("any")}
                style={[
                  styles.welcomeBox,
                  {
                    borderColor: welcomeMode === "any" ? colors.emerald500 : c.border,
                    backgroundColor: welcomeMode === "any" ? c.activeSoft : c.surface,
                  },
                ]}
              >
                <Text style={[styles.welcomeTitle, { color: c.text }]}>🌍 Anyone!</Text>
                <Text style={[styles.welcomeSub, { color: c.textMuted }]}>All levels, max fun</Text>
              </Pressable>
              <Pressable
                onPress={() => setWelcomeMode("specific")}
                style={[
                  styles.welcomeBox,
                  {
                    borderColor: welcomeMode === "specific" ? colors.orange400 : c.border,
                    backgroundColor: welcomeMode === "specific"
                      ? isDark
                        ? "rgba(249,115,22,0.10)"
                        : colors.orange50
                      : c.surface,
                  },
                ]}
              >
                <Text style={[styles.welcomeTitle, { color: c.text }]}>🎯 Specific</Text>
                <Text style={[styles.welcomeSub, { color: c.textMuted }]}>Pick levels below</Text>
              </Pressable>
            </View>
            {welcomeMode === "specific" ? (
              <View style={styles.levelRow}>
                {LEVEL_OPTIONS.map((l) => {
                  const on = welcomeLevels.includes(l.name);
                  return (
                    <Pressable
                      key={l.name}
                      onPress={() => toggleLevel(l.name)}
                      accessibilityState={{ selected: on }}
                      style={[
                        styles.levelBox,
                        on
                          ? { backgroundColor: colors.orange500, borderColor: colors.orange500 }
                          : { borderColor: c.border },
                      ]}
                    >
                      <Text style={styles.levelEmoji}>{l.emoji}</Text>
                      <Text
                        style={[styles.levelName, { color: on ? "#FFFFFF" : c.text }]}
                      >
                        {l.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {/* Custom charge */}
            <View style={[styles.chargeBox, { borderColor: "rgba(139,92,246,0.25)" }]}>
              <Text style={[styles.chargeLabel, { color: isDark ? colors.violet300 : colors.violet700 }]}>✨ Custom charge per joiner</Text>
              <View style={styles.chargeInputRow}>
                <Text style={[styles.chargePrefix, { color: c.textFaint }]}>Rs.</Text>
                <TextInput
                  value={String(price)}
                  onChangeText={(t) => {
                    setPrice(Number(t.replace(/[^0-9]/g, "")) || 0);
                    setFieldErrors((p) => ({ ...p, price: "" }));
                  }}
                  keyboardType="number-pad"
                  style={[styles.chargeInput, { color: c.text, backgroundColor: c.inset }]}
                />
              </View>
              <Slider
                minimumValue={0}
                maximumValue={500}
                step={10}
                value={Math.min(500, price)}
                onValueChange={setPrice}
                minimumTrackTintColor={colors.violet500}
                maximumTrackTintColor={c.border}
                thumbTintColor={colors.violet500}
              />
              <View style={styles.priceChips}>
                {[0, 100, 150, 200, 300].map((v) => (
                  <Pressable
                    key={v}
                    onPress={() => setPrice(v)}
                    style={[
                      styles.priceChip,
                      price === v
                        ? { backgroundColor: colors.violet500 }
                        : { backgroundColor: c.inset },
                    ]}
                  >
                    <Text
                      style={[styles.priceChipText, { color: price === v ? "#FFFFFF" : c.textMuted }]}
                    >
                      {v === 0 ? "🎉 Free" : `Rs. ${v}`}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {fieldErrors.price ? (
                <Text style={styles.fieldError}>{fieldErrors.price}</Text>
              ) : (
                <Text style={[styles.chargeHint, { color: c.textMuted }]}>
                  {price === 0
                    ? "🎉 Generous! Joiners play free — your crew covers the court."
                    : `🙋 ${openSpots} joiners × ${formatNPR(price)} = ${formatNPR(price * openSpots)} toward the court.`}
                </Text>
              )}
            </View>

            <Text style={[styles.label, { color: c.textFaint }]}>A warm note for joiners</Text>
            <TextInput
              value={desc}
              onChangeText={(t) => {
                setDesc(t);
                setFieldErrors((p) => ({ ...p, desc: "" }));
              }}
              placeholder="Beginners welcome, we laugh a lot, bibs ready…"
              placeholderTextColor={c.textFaint}
              maxLength={500}
              multiline
              style={[
                styles.input,
                styles.textarea,
                {
                  backgroundColor: c.inset,
                  color: c.text,
                  borderColor: fieldErrors.desc ? colors.red400 : c.border,
                },
              ]}
            />
            {fieldErrors.desc ? <Text style={styles.fieldError}>{fieldErrors.desc}</Text> : null}

            {formError ? (
              <Text
                style={[
                  styles.formError,
                  {
                    color: isDark ? colors.red400 : colors.red600,
                    backgroundColor: isDark ? "rgba(239,68,68,0.12)" : colors.red50,
                  },
                ]}
              >
                {formError}
              </Text>
            ) : null}

            <Pressable
              onPress={submit}
              disabled={creating || !title}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.submitButton,
                { backgroundColor: c.primary },
                creating || !title ? { opacity: 0.4 } : null,
                pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <Text style={[styles.submitText, { color: c.primaryText }]}>
                {creating ? "Inviting everyone…" : "Share my game 🎉"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1 },
  content: { padding: space[4], paddingBottom: space[12] },

  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.6,
    color: colors.orange500,
  },
  h1: { fontSize: fontSize["3xl"], fontWeight: "900", marginTop: 4 },
  subtitle: { fontSize: fontSize.base, color: colors.stone500, marginTop: 4 },

  startButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
    marginTop: space[4],
  },
  startButtonText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },

  toggleRow: {
    flexDirection: "row",
    gap: 4,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: 4,
    marginTop: space[5],
  },
  toggleButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius.xl,
    paddingVertical: 10,
    paddingHorizontal: space[3],
  },
  toggleText: { fontSize: fontSize.base, fontWeight: "900" },

  errorText: { marginTop: space[3], fontSize: fontSize.sm, fontWeight: "700", color: colors.red500 },

  filterRail: { flexGrow: 0, marginTop: space[5] },
  filterRailContent: { gap: space[2], paddingRight: space[4] },
  filterPill: {
    borderRadius: radius.full,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    minHeight: 36,
    justifyContent: "center",
  },
  filterPillText: { fontSize: fontSize.sm, fontWeight: "900" },
  tip: { fontSize: fontSize.xs, fontWeight: "600", marginTop: 6 },

  empty: {
    marginTop: space[6],
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[12],
    alignItems: "center",
  },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: "800", marginTop: space[3] },
  emptyBody: { fontSize: fontSize.base, color: colors.stone500, marginTop: 4, textAlign: "center" },

  /* card */
  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[5],
    marginTop: space[4],
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[3] },
  cardTitle: { fontSize: fontSize.lg, fontWeight: "800" },
  cardSub: { fontSize: fontSize.sm, color: colors.stone500, marginTop: 2 },
  cardCrew: { fontSize: fontSize.xs, fontWeight: "700", marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: fontSize["2xs"], fontWeight: "900" },
  spots: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  spotsText: { fontSize: fontSize["2xs"], fontWeight: "900", textTransform: "uppercase" },

  desc: { fontSize: 13, lineHeight: 19, marginTop: space[2] },
  metaBlock: { marginTop: space[3], gap: 6 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: space[2] },
  metaText: { fontSize: 13, fontWeight: "600", flex: 1 },
  metaPrice: { fontSize: 13, fontWeight: "900", marginLeft: "auto", flexShrink: 0 },

  track: { height: 8, borderRadius: radius.full, overflow: "hidden", marginTop: space[3] },
  fill: { height: "100%", borderRadius: radius.full },

  peopleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
    marginTop: space[2],
  },
  stack: { flexDirection: "row", alignItems: "center" },
  more: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: { fontSize: fontSize["2xs"], fontWeight: "900" },
  count: { fontSize: fontSize.sm, fontWeight: "700", flexShrink: 1, textAlign: "right" },

  joinButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius["2xl"],
    paddingVertical: space[3],
    marginTop: space[4],
  },
  joinText: { fontSize: fontSize.base, fontWeight: "900" },

  /* modal */
  modalBackdrop: { flex: 1, backgroundColor: "rgba(28,25,23,0.5)", justifyContent: "flex-end" },
  modalSheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: "92%",
    padding: space[4],
  },
  modalHead: { flexDirection: "row", alignItems: "center", gap: space[3] },
  modalTitle: { fontSize: fontSize.xl, fontWeight: "900" },
  modalSub: { fontSize: fontSize.sm, color: colors.stone500 },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  modalBody: { marginTop: space[4] },

  label: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
    marginTop: space[3],
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.base,
    fontWeight: "600",
  },
  textarea: { minHeight: 64, textAlignVertical: "top" },
  fieldError: { fontSize: fontSize.xs, fontWeight: "700", color: colors.red500, marginTop: 4 },
  formError: {
    fontSize: fontSize.sm,
    fontWeight: "700",
    color: colors.red600,
    backgroundColor: colors.red50,
    borderRadius: radius.xl,
    padding: space[3],
    marginTop: space[3],
  },

  pickerBox: { borderWidth: 1, borderRadius: radius.xl, overflow: "hidden" },

  dayChip: {
    borderRadius: radius.full,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    marginRight: space[2],
    minHeight: 36,
    justifyContent: "center",
  },

  counterRow: { flexDirection: "row", flexWrap: "wrap", gap: space[3], marginTop: space[3] },
  counter: { flexGrow: 1, flexBasis: 130, minWidth: 0, borderRadius: radius["2xl"], borderWidth: 1, padding: space[3] },
  counterLabel: { fontSize: fontSize.sm, fontWeight: "900" },
  counterControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space[2],
  },
  counterBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  counterValue: { fontSize: fontSize["3xl"], fontWeight: "900" },
  totalLine: { fontSize: fontSize.sm, fontWeight: "700", textAlign: "center", marginTop: space[2] },

  welcomeRow: { flexDirection: "row", gap: space[2] },
  welcomeBox: { flex: 1, borderRadius: radius.xl, borderWidth: 1, padding: 10 },
  welcomeTitle: { fontSize: fontSize.base, fontWeight: "900" },
  welcomeSub: { fontSize: fontSize.xs, color: colors.stone500 },
  levelRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[2] },
  levelBox: {
    flexGrow: 1,
    flexBasis: 88,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: space[2],
    paddingHorizontal: 6,
    alignItems: "center",
  },
  levelEmoji: { fontSize: fontSize.lg },
  levelName: { fontSize: fontSize["2xs"], fontWeight: "900", textAlign: "center", lineHeight: 13 },

  chargeBox: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: 14,
    marginTop: space[3],
  },
  chargeLabel: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: colors.violet500,
  },
  chargeInputRow: { flexDirection: "row", alignItems: "center", gap: space[2], marginTop: 4 },
  chargePrefix: { fontSize: fontSize.base, fontWeight: "900" },
  chargeInput: {
    flex: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.xl,
    fontWeight: "900",
  },
  priceChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  priceChip: { borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  priceChipText: { fontSize: fontSize.xs, fontWeight: "900" },
  chargeHint: { fontSize: fontSize.xs, color: colors.stone500, marginTop: 6 },

  submitButton: {
    borderRadius: radius["2xl"],
    paddingVertical: 14,
    alignItems: "center",
    marginTop: space[4],
    marginBottom: space[6],
  },
  submitText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },
});
