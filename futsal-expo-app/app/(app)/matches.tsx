import Slider from "@react-native-community/slider";
import { Picker } from "@/components/ThemedPicker";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  CalendarDays,
  Check,
  HandHeart,
  Hourglass,
  MapPin,
  Minus,
  Plus,
  Trophy,
  Wallet,
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
import {
  createMatch,
  decideMatchJoin,
  fetchMatches,
  fetchVenues,
  joinMatch,
  leaveMatch,
  payMatchJoin,
} from "@/api";
import { formatNPR, formatTime12, prettyDate, timeSlots, todayISO } from "@/lib/futsal";
import {
  ANY_POSITION,
  JOIN_PENDING,
  MAX_POSITIONS,
  POSITIONS,
  POSITION_EMOJI,
  advanceAmount,
  normalizePositions,
  positionFor,
} from "@/lib/open-games";
import type { Position } from "@/lib/open-games";
import {
  firstError,
  validateDateISO,
  validateMessage,
  validateMoney,
  validateTimeHM,
  validateTitle,
} from "@/lib/validation";
import { useBreakpoints } from "@/lib/responsive";
import type { Match, MatchJoinRequest, Venue } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/**
 * Games looking for you — a port of the web app's app/matches/page.tsx.
 *
 * Same header copy, same level filter (including the rule that a specific level
 * still shows "All Levels" games, because those welcome everyone), same card
 * anatomy and the same create-game validation chain.
 *
 * One deliberate change from the web version, and it is the point of the
 * screen: **taking a spot is a request.** There is no "Count me in" button,
 * because a host who posts a game is the one deciding who plays in it — the
 * same two-sided agreement a squad uses. A player asks (naming the position
 * they are filling, and optionally paying their share up front, which settles
 * it by itself), and the host answers with accept, decline, or "pay me first".
 *
 * Other deviations, both forced by the platform:
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
  const [deciding, setDeciding] = useState<string | null>(null);
  const [asking, setAsking] = useState<Match | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // `userId` is what brings back the viewer's own request on each game, and a
  // host's queue of players waiting on them.
  const load = useCallback(async () => {
    const [m, v] = await Promise.all([fetchMatches(user?.id), fetchVenues()]);
    setMatches(m);
    setVenues(v);
  }, [user?.id]);

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

  /**
   * The one button a player gets. Opening the sheet is the whole interaction —
   * nothing is sent to the host until they choose a spot and press send.
   */
  function askToPlay(m: Match) {
    if (!user) {
      router.push("/login");
      return;
    }
    setError("");
    setNotice("");
    setAsking(m);
  }

  /** Withdraw a pending request, or give a settled spot back. */
  async function toggleJoin(m: Match) {
    if (!user) return;
    setJoining(m.id);
    setError("");
    try {
      const res = await leaveMatch(m.id, user.id);
      setNotice(String(res.message ?? "Done"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setJoining(null);
    }
  }

  /** The host answers: accept, decline, or ask for the share up front. */
  async function decide(m: Match, request: MatchJoinRequest, action: "accept" | "decline" | "askPayment") {
    if (!user) return;
    const key = `${m.id}-${request.id}-${action}`;
    setDeciding(key);
    setError("");
    try {
      const res = await decideMatchJoin(m.id, {
        organizerId: user.id,
        joinId: request.id,
        action,
      });
      setNotice(String(res.message ?? (action === "accept" ? `${request.name} is in 🎉` : "Saved")));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setDeciding(null);
    }
  }

  /** The host asked for the share — paying settles the request on its own. */
  async function payShare(m: Match) {
    if (!user) return;
    const requestId = m.viewer?.requestId;
    if (!requestId) return;
    setDeciding(`pay-${m.id}`);
    setError("");
    try {
      const res = await payMatchJoin(m.id, {
        userId: user.id,
        joinId: requestId,
        amount: m.pricePerPlayer,
        payMethod: "eSewa",
      });
      setNotice(String(res.message ?? "You're in 🎉"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setDeciding(null);
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
          <Text style={[styles.eyebrow, { color: c.accent }]}>
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

        {error ? <Text style={[styles.errorText, { color: c.dangerText }]}>{error}</Text> : null}
        {notice ? <Text style={[styles.noticeText, { color: c.activeText }]}>{notice}</Text> : null}

        {tab === "leagues" ? (
          <View style={styles.leagueBrowserWrap}>
            <LeagueBrowser />
          </View>
        ) : (
          <>
            {/* Level filter */}
            <View style={[styles.levelFilterCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.levelFilterHeader}>
                <View style={styles.levelFilterCopy}>
                  <Text style={[styles.levelFilterTitle, { color: c.text }]}>Find your level</Text>
                  <Text style={[styles.levelFilterHint, { color: c.textFaint }]}>Anyone welcome games always stay visible.</Text>
                </View>
                <Text style={[styles.levelFilterCount, { color: c.textFaint }]}>{filtered.length} games</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                contentContainerStyle={styles.levelFilterRail}
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
                        styles.levelFilterButton,
                        active
                          ? { backgroundColor: c.primary, borderColor: c.primary }
                          : { backgroundColor: c.inset, borderColor: c.border },
                      ]}
                    >
                      <Text style={[styles.levelFilterEmoji, { backgroundColor: active ? "rgba(255,255,255,0.20)" : c.surface }]}>
                        {f === "All" ? "🌍" : f === "Beginner" ? "🌱" : f === "Intermediate" ? "⚡" : "🔥"}
                      </Text>
                      <View style={styles.levelFilterButtonCopy}>
                        <Text numberOfLines={1} style={[styles.levelFilterButtonTitle, { color: active ? c.primaryText : c.text }]}>{f === "All" ? "Everyone" : f}</Text>
                        <Text numberOfLines={1} style={[styles.levelFilterButtonHint, { color: active ? c.primaryText : c.textFaint }]}>{f === "All" ? "All games" : f === "Beginner" ? "Easy-going" : f === "Intermediate" ? "Balanced" : "High intensity"}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <Text style={[styles.tip, { color: c.textFaint }]}>
              Tip: choosing a level also shows “Anyone welcome” games — they're open to you too! 💛
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
                  deciding={deciding}
                  onAsk={() => askToPlay(m)}
                  onToggle={() => toggleJoin(m)}
                  onDecide={decide}
                  onPay={() => payShare(m)}
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

      <AskToPlaySheet
        match={asking}
        onClose={() => setAsking(null)}
        onSent={async (message) => {
          setAsking(null);
          setNotice(message);
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
  deciding,
  onAsk,
  onToggle,
  onDecide,
  onPay,
}: {
  m: Match;
  joining: boolean;
  deciding: string | null;
  onAsk: () => void;
  onToggle: () => void;
  onDecide: (m: Match, r: MatchJoinRequest, a: "accept" | "decline" | "askPayment") => void;
  onPay: () => void;
}) {
  const { colors: c, isDark } = useTheme();
  const { user } = useAuth();

  const viewer = m.viewer ?? null;
  const isHost = viewer?.isHost ?? false;
  const already = viewer?.isIn ?? false;
  const pending = viewer?.requestStatus === JOIN_PENDING;
  // A request holds no spot, so a game with one still being answered is not
  // full — otherwise the last free slot would vanish behind a pending ask.
  const full = m.spotsLeft === 0 && !already && !pending;
  const pct = Math.round((m.joinedCount / Math.max(1, m.maxPlayers)) * 100);
  const crew = m.crewSize ?? 1;
  const others = m.otherJoined ?? Math.max(0, m.joinedCount - crew);
  const isCustom = (m.chargeMode ?? (m.bookingId ? "split" : "custom")) === "custom";
  const needed = m.positionsNeeded ?? [];
  const queue = (m.requests ?? []).filter((r) => r.status === JOIN_PENDING);

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
            {needed.length > 0 ? (
              <View style={[styles.chip, { backgroundColor: c.warningBg }]}>
                <Text style={[styles.chipText, { color: c.warningText }]}>
                  🧤 Needs {needed.map((p) => POSITION_EMOJI[p as Position] ?? "").join("")} {needed.join(" + ")}
                </Text>
              </View>
            ) : (
              <View style={[styles.chip, { backgroundColor: c.activeSoft }]}>
                <Text style={[styles.chipText, { color: c.activeText }]}>
                  🌍 Anyone welcome
                </Text>
              </View>
            )}
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
                { backgroundColor: isCustom ? c.activeSoft : c.infoBg },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isCustom ? c.activeText : c.infoText,
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
              backgroundColor: full ? c.dangerBg : c.warningBg,
            },
          ]}
        >
          <Text
            style={[
              styles.spotsText,
              { color: full ? c.dangerText : c.warningText },
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

      {/* A request is not a seat: it says so, and it never eats a spot. */}
      {pending ? (
        <View style={[styles.requestNote, { backgroundColor: c.warningBg, borderColor: c.warningText }]}>
          <Hourglass size={14} color={c.warningText} />
          <Text style={[styles.requestNoteText, { color: c.warningText }]}>
            Asked to play{viewer?.position ? ` as ${viewer.position}` : ""}
            {viewer && viewer.paidAmount > 0
              ? ` • you paid ${formatNPR(viewer.paidAmount)} up front`
              : ""}
            {viewer?.paymentRequested ? " • the host asked for your share" : ""}
            {" — waiting on "}
            {m.organizer?.name ?? "the host"}.
          </Text>
        </View>
      ) : null}

      {/* The host's queue — the thing a "Count me in" button used to skip. */}
      {isHost && queue.length > 0 ? (
        <View style={[styles.queueBox, { borderColor: c.border, backgroundColor: isDark ? "rgba(255,255,255,0.04)" : colors.stone50 }]}>
          <Text style={[styles.queueTitle, { color: c.textMuted }]}>
            <HandHeart size={13} color={c.textMuted} /> Players waiting on you • {queue.length}
          </Text>
          {queue.map((r) => (
            <View key={r.id} style={[styles.queueRow, { borderColor: c.border }]}>
              <Avatar
                user={{ name: r.name, avatarColor: r.avatarColor, avatarUrl: r.avatarUrl }}
                size={32}
              />
              <View style={styles.grow}>
                <Text style={[styles.queueName, { color: c.text }]} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={[styles.queueMeta, { color: c.textFaint }]} numberOfLines={1}>
                  {r.level} • {r.playerPosition}
                  {r.slot && r.slot !== ANY_POSITION ? ` • for ${r.slot}` : ""}
                </Text>
                {r.message ? (
                  <Text style={[styles.queueMsg, { color: c.textMuted }]} numberOfLines={2}>
                    “{r.message}”
                  </Text>
                ) : null}
                <Text
                  style={[
                    styles.queuePay,
                    { color: r.paid ? c.activeText : c.textFaint },
                  ]}
                >
                  {r.paid ? `💰 ${r.paymentSummary}` : `⏳ ${r.paymentSummary}`}
                </Text>
              </View>
              <View style={styles.queueActions}>
                <Pressable
                  onPress={() => onDecide(m, r, "accept")}
                  disabled={deciding === `${m.id}-${r.id}-accept` || full}
                  accessibilityRole="button"
                  style={[
                    styles.queueAccept,
                    (deciding === `${m.id}-${r.id}-accept` || full) && { opacity: 0.5 },
                  ]}
                >
                  <Check size={13} color="#FFFFFF" strokeWidth={3} />
                  <Text style={styles.queueAcceptText}>
                    {r.paid ? "In" : "Accept"}
                  </Text>
                </Pressable>
                {!r.paid ? (
                  <Pressable
                    onPress={() => onDecide(m, r, "askPayment")}
                    disabled={deciding === `${m.id}-${r.id}-askPayment`}
                    accessibilityRole="button"
                    style={[
                      styles.queueGhost,
                      { borderColor: c.border },
                      deciding === `${m.id}-${r.id}-askPayment` && { opacity: 0.5 },
                    ]}
                  >
                    <Wallet size={12} color={c.textMuted} />
                    <Text style={[styles.queueGhostText, { color: c.textMuted }]}>
                      {r.paymentRequested ? "Asked" : "Ask Rs"}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => onDecide(m, r, "decline")}
                  disabled={deciding === `${m.id}-${r.id}-decline`}
                  accessibilityRole="button"
                  style={[
                    styles.queueGhost,
                    { borderColor: c.border },
                    deciding === `${m.id}-${r.id}-decline` && { opacity: 0.5 },
                  ]}
                >
                  <X size={12} color={c.textMuted} />
                  <Text style={[styles.queueGhostText, { color: c.textMuted }]}>Pass</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {isHost ? (
        <View style={[styles.hostBar, { backgroundColor: c.inset }]}>
          <Text style={[styles.hostBarText, { color: c.textMuted }]}>
            {queue.length > 0
              ? `${queue.length} player${queue.length === 1 ? "" : "s"} waiting on your answer 👑`
              : "You're hosting — nobody is waiting on you right now 🎉"}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={already || pending ? onToggle : onAsk}
          disabled={joining || full}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.joinButton,
            already || pending
              ? {
                  backgroundColor: already ? c.dangerBg : c.warningBg,
                  borderWidth: 1,
                  borderColor: already ? c.dangerBorder : c.warningText,
                }
              : full
                ? { backgroundColor: c.inset }
                : { backgroundColor: c.primary },
            (joining || full) && !already && !pending ? { opacity: 0.6 } : null,
            pressed ? { opacity: 0.85 } : null,
          ]}
        >
          {already ? (
            <Text style={[styles.joinText, { color: c.dangerText }]}>
              You're in — can't make it? Give your spot back
            </Text>
          ) : pending ? (
            <>
              <Hourglass size={16} color={c.warningText} />
              <Text style={[styles.joinText, { color: c.warningText }]}>
                {joining ? "Withdrawing…" : "Request pending — tap to withdraw"}
              </Text>
            </>
          ) : full ? (
            <Text style={[styles.joinText, { color: c.textFaint }]}>This one's full</Text>
          ) : (
            <>
              <HandHeart size={16} color={c.primaryText} strokeWidth={2.5} />
              <Text style={[styles.joinText, { color: c.primaryText }]}>
                {joining ? "Sending…" : `Ask to play • ${formatNPR(m.pricePerPlayer)} each`}
              </Text>
            </>
          )}
        </Pressable>
      )}

      {/* The host asked for the share. Rendered beside the button rather than
          inside it: nesting one pressable in another makes which one wins the
          tap a matter of layout order, and this one has to. */}
      {pending && viewer?.paymentRequested ? (
        <Pressable
          onPress={onPay}
          disabled={deciding === `pay-${m.id}`}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.joinButton,
            { backgroundColor: c.primary, marginTop: space[2], opacity: deciding === `pay-${m.id}` ? 0.6 : pressed ? 0.85 : 1 },
          ]}
        >
          <Wallet size={16} color={c.primaryText} strokeWidth={2.5} />
          <Text style={[styles.joinText, { color: c.primaryText }]}>
            {deciding === `pay-${m.id}`
              ? "Paying…"
              : `Host asked for ${formatNPR(m.pricePerPlayer)} — pay & you're in`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ── Ask to play ─────────────────────────────────────────────────────────── */

/**
 * The sheet behind "Ask to play".
 *
 * It asks the two questions the host would want answered — which spot are you
 * filling, and can you make it — plus whether the player wants to put their
 * share in up front. Paying is the one thing that settles a request without the
 * host tapping anything, and the copy says so plainly rather than hiding it.
 */
function AskToPlaySheet({
  match,
  onClose,
  onSent,
}: {
  match: Match | null;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const { colors: c, isDark } = useTheme();
  const { user } = useAuth();

  const [position, setPosition] = useState("");
  const [note, setNote] = useState("");
  const [payUpFront, setPayUpFront] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");

  const needed = match?.positionsNeeded ?? [];
  const share = match?.pricePerPlayer ?? 0;
  // A game that named no positions accepts anything, so there is nothing to ask.
  const amount = advanceAmount(share, share, payUpFront);

  useEffect(() => {
    if (!match) return;
    setPosition(needed[0] ?? ANY_POSITION);
    setNote("");
    setPayUpFront(false);
    setFormError("");
  }, [match, needed.join(",")]);

  async function send() {
    if (!match || !user) return;
    const errs: string[] = [];

    if (note.trim()) {
      const nErr = validateMessage(note.trim(), { min: 3, max: 300, label: "Note", required: false });
      if (nErr) errs.push(nErr);
    }

    if (errs.length > 0) {
      setFormError(firstError(...errs) ?? "Please check that note 🙏");
      return;
    }

    setSending(true);
    setFormError("");
    try {
      const res = await joinMatch(match.id, {
        userId: user.id,
        position: positionFor(needed, position),
        message: note.trim(),
        payInAdvance: payUpFront,
        paidAmount: amount,
        payMethod: "eSewa",
      });
      onSent(String(res.message ?? "Request sent ⏳"));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not send that request 🙏");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={match !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { backgroundColor: c.scrim }]}>
        <View style={[styles.modalSheet, { backgroundColor: c.surface, borderColor: c.border, shadowColor: c.shadow }]}>
          <View style={styles.modalHead}>
            <View style={styles.grow}>
              <Text style={[styles.modalTitle, { color: c.text }]}>Ask to play ⚽</Text>
              <Text style={[styles.modalSub, { color: c.textMuted }]}>
                {match?.title} • {formatNPR(share)} each
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton} accessibilityRole="button">
              <X size={18} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            {/* The host decides who plays. Say so before they type anything. */}
            <View style={[styles.sayNoBox, { backgroundColor: c.infoBg, borderColor: c.border }]}>
              <Text style={[styles.sayNoText, { color: c.infoText }]}>
                🛡️ {match?.organizer?.name ?? "The host"} answers every request — nobody is on the
                pitch until they say yes.
              </Text>
            </View>

            <Text style={[styles.label, { color: c.textFaint }]}>
              {needed.length > 0 ? "Which spot are you filling? 🧤" : "Where do you play? 🌍"}
            </Text>
            <View style={styles.posRow}>
              {(needed.length > 0 ? needed : [...POSITIONS]).map((p) => {
                const on = position === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setPosition(p)}
                    accessibilityState={{ selected: on }}
                    style={[
                      styles.posChip,
                      on
                        ? { backgroundColor: c.primary, borderColor: c.primary }
                        : { borderColor: c.border, backgroundColor: c.surface },
                    ]}
                  >
                    <Text style={styles.posEmoji}>{POSITION_EMOJI[p as Position] ?? "🙋"}</Text>
                    <Text style={[styles.posName, { color: on ? c.primaryText : c.text }]}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
            {needed.length > 0 ? (
              <Pressable
                onPress={() => setPosition(ANY_POSITION)}
                accessibilityState={{ selected: position === ANY_POSITION }}
                style={[
                  styles.anyRow,
                  { borderColor: c.border },
                  position === ANY_POSITION && { backgroundColor: c.activeSoft, borderColor: c.activeText },
                ]}
              >
                <Text style={[styles.anyText, { color: position === ANY_POSITION ? c.activeText : c.textMuted }]}>
                  🙋 I'm flexible — any spot they'll give me
                </Text>
              </Pressable>
            ) : null}
            <Text style={[styles.hint, { color: c.textFaint }]}>
              {needed.length > 0
                ? `They're short of ${needed.join(" and ")} — but the host can still say yes to any spot.`
                : "This game is open to everyone, so pick whatever suits."}
            </Text>

            <Text style={[styles.label, { color: c.textFaint }]}>Say hello (optional) 💬</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={300}
              placeholder="A line about how you play, or when you can make it"
              placeholderTextColor={c.textFaint}
              style={[
                styles.input,
                styles.textarea,
                { color: c.text, borderColor: c.border, backgroundColor: isDark ? "rgba(255,255,255,0.05)" : colors.stone50 },
              ]}
            />

            {/* Money in advance — the one shortcut, stated honestly. */}
            <Pressable
              onPress={() => setPayUpFront((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: payUpFront }}
              style={[
                styles.chargeBox,
                {
                  borderColor: payUpFront ? colors.emerald500 : "rgba(139,92,246,0.25)",
                  backgroundColor: payUpFront ? c.activeSoft : "transparent",
                },
              ]}
            >
              <View style={styles.welcomeRow}>
                <View style={styles.grow}>
                  <Text style={[styles.chargeLabel, { color: payUpFront ? c.activeText : isDark ? colors.violet300 : colors.violet700 }]}>
                    💰 Pay my {formatNPR(share)} share now
                  </Text>
                  <Text style={[styles.hint, { color: c.textMuted }]}>
                    {payUpFront
                      ? "You're in the moment this lands — no waiting on a reply."
                      : "Money in front of the host is a commitment, so it puts you straight in. You can also ask first and pay later."}
                  </Text>
                </View>
                <View
                  style={[
                    styles.tick,
                    { borderColor: payUpFront ? colors.emerald500 : c.border, backgroundColor: payUpFront ? colors.emerald500 : "transparent" },
                  ]}
                >
                  {payUpFront ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
                </View>
              </View>
            </Pressable>

            {formError ? (
              <Text style={styles.formError}>{formError}</Text>
            ) : null}

            <Pressable
              onPress={send}
              disabled={sending}
              accessibilityRole="button"
              style={[styles.submitButton, { backgroundColor: c.primary, opacity: sending ? 0.6 : 1 }]}
            >
              <HandHeart size={16} color={c.primaryText} strokeWidth={2.5} />
              <Text style={[styles.submitText, { color: c.primaryText }]}>
                {sending
                  ? "Sending…"
                  : payUpFront
                    ? `Pay ${formatNPR(amount)} & join`
                    : "Send my request"}
              </Text>
            </Pressable>
            <Text style={[styles.hint, { color: c.textFaint, textAlign: "center" }]}>
              No money moves unless you tick the box. Until the host answers, you are on nobody's
              team but your own.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
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
  // The spots this game is short of. Empty is the default and means anyone.
  const [positions, setPositions] = useState<string[]>([]);
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

  function togglePosition(name: string) {
    setPositions((prev) => {
      if (prev.includes(name)) return prev.filter((p) => p !== name);
      // A pitch has four spots. Asking for a fifth is a shopping list, not a
      // game, so the picker stops rather than accepting an impossible ask.
      if (prev.length >= MAX_POSITIONS) return prev;
      return [...prev, name];
    });
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
        positionsNeeded: normalizePositions(positions),
      });
      setTitle("");
      setDesc("");
      setWelcomeLevels([]);
      setWelcomeMode("any");
      setPositions([]);
      onCreated();
    } catch {
      setFormError("Could not share your game — try again 🙏");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { backgroundColor: c.scrim }]}>
        <View style={[styles.modalSheet, { backgroundColor: c.surface, borderColor: c.border, shadowColor: c.shadow }]}>
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
                  borderColor: fieldErrors.title ? c.dangerText : c.border,
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
                accessibilityRole="button"
                accessibilityState={{ selected: welcomeMode === "any" }}
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
                accessibilityRole="button"
                accessibilityState={{ selected: welcomeMode === "specific" }}
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

            {/* Spots you're short of — the reason a host gets to answer at all. */}
            <Text style={[styles.label, { color: c.textFaint }]}>
              Anyone can ask to play — but who do you need? 🧤
            </Text>
            <View style={styles.posRow}>
              {POSITIONS.map((p) => {
                const on = positions.includes(p);
                const capped = !on && positions.length >= MAX_POSITIONS;
                return (
                  <Pressable
                    key={p}
                    onPress={() => togglePosition(p)}
                    disabled={capped}
                    accessibilityState={{ selected: on, disabled: capped }}
                    style={[
                      styles.posChip,
                      on
                        ? { backgroundColor: colors.orange500, borderColor: colors.orange500 }
                        : { borderColor: c.border, backgroundColor: c.surface },
                      capped && { opacity: 0.4 },
                    ]}
                  >
                    <Text style={styles.posEmoji}>{POSITION_EMOJI[p]}</Text>
                    <Text style={[styles.posName, { color: on ? "#FFFFFF" : c.text }]}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.hint, { color: c.textFaint }]}>
              {positions.length === 0
                ? "Pick none and anyone can ask for a spot — you'll still decide who plays. 🌍"
                : `You'll see people asking for ${positions.join(" and ")}. You can still say yes to any spot.`}
            </Text>

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
  leagueBrowserWrap: { marginTop: space[4] },

  levelFilterCard: { marginTop: space[5], borderRadius: radius["2xl"], borderWidth: 1, padding: space[2.5] },
  levelFilterHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], paddingHorizontal: space[1], paddingBottom: space[2.5] },
  levelFilterCopy: { flex: 1, minWidth: 0 },
  levelFilterTitle: { fontSize: fontSize.xs, fontWeight: "900" },
  levelFilterHint: { fontSize: 10, fontWeight: "600", marginTop: 1 },
  levelFilterCount: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
  levelFilterRail: { gap: space[2], paddingRight: space[2] },
  levelFilterButton: { minHeight: 58, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: space[2], borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: space[2.5], paddingVertical: space[2] },
  levelFilterEmoji: { width: 30, height: 30, borderRadius: radius.lg, textAlign: "center", textAlignVertical: "center", fontSize: 15, overflow: "hidden" },
  levelFilterButtonCopy: { flexShrink: 0 },
  levelFilterButtonTitle: { fontSize: 11, fontWeight: "900", lineHeight: 14 },
  levelFilterButtonHint: { fontSize: 9, fontWeight: "600", lineHeight: 12, marginTop: 2 },
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
  noticeText: {
    marginTop: space[3],
    fontSize: fontSize.sm,
    fontWeight: "700",
    backgroundColor: colors.emerald50,
    color: colors.emerald700,
    borderRadius: radius.xl,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  requestNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    marginTop: space[3],
  },
  requestNoteText: { flex: 1, fontSize: fontSize.xs, fontWeight: "700", lineHeight: 16 },

  queueBox: { borderWidth: 1, borderRadius: radius["2xl"], padding: space[3], marginTop: space[3], gap: space[2] },
  queueTitle: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  queueRow: { flexDirection: "row", alignItems: "center", gap: space[2], borderTopWidth: 1, paddingTop: space[2] },
  queueName: { fontSize: fontSize.sm, fontWeight: "800" },
  queueMeta: { fontSize: 10, fontWeight: "700", marginTop: 1 },
  queueMsg: { fontSize: fontSize.xs, fontStyle: "italic", marginTop: 2, lineHeight: 15 },
  queuePay: { fontSize: 10, fontWeight: "900", marginTop: 3 },
  queueActions: { gap: 4, alignItems: "flex-end" },
  queueAccept: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.emerald600,
    borderRadius: radius.lg,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  queueAcceptText: { fontSize: 10, fontWeight: "900", color: "#FFFFFF" },
  queueGhost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  queueGhostText: { fontSize: 9, fontWeight: "900" },
  hostBar: { borderRadius: radius["2xl"], padding: space[3], marginTop: space[4] },
  hostBarText: { fontSize: fontSize.xs, fontWeight: "700", textAlign: "center" },

  sayNoBox: { borderWidth: 1, borderRadius: radius.xl, padding: space[3], marginTop: space[4] },
  sayNoText: { fontSize: fontSize.xs, fontWeight: "700", lineHeight: 16 },
  hint: { fontSize: fontSize.xs, fontWeight: "600", color: colors.stone500, marginTop: 6, lineHeight: 16 },
  posRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  posChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  posEmoji: { fontSize: 12 },
  posName: { fontSize: fontSize.xs, fontWeight: "800" },
  anyRow: { borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: 12, paddingVertical: 9, marginTop: 6 },
  anyText: { fontSize: fontSize.xs, fontWeight: "700" },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },

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
  welcomeBox: { flex: 1, minWidth: 0, minHeight: 68, borderRadius: radius.xl, borderWidth: 1, padding: 10, justifyContent: "center" },
  welcomeTitle: { fontSize: fontSize.base, fontWeight: "900", lineHeight: 19 },
  welcomeSub: { fontSize: fontSize.xs, lineHeight: 15, marginTop: 2 },
  levelRow: { flexDirection: "row", gap: space[2], marginTop: space[2] },
  levelBox: {
    flex: 1,
    minWidth: 0,
    minHeight: 66,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: space[2],
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  levelEmoji: { fontSize: fontSize.lg, lineHeight: 22 },
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
