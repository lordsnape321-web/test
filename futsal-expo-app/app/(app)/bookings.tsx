import { useFocusEffect, useRouter } from "expo-router";
import {
  CalendarCheck,
  ChevronRight,
  Clock,
  Gift,
  Globe,
  Hourglass,
  Lock,
  LogIn,
  MapPin,
  PartyPopper,
  QrCode,
  ReceiptText,
  Shield,
  Star,
  Swords,
  Ticket,
  Wallet,
  XCircle,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchBookings, fetchReviews, fetchUserStats, patchBooking, postReview } from "@/api";
import { BookingPaymentSummary } from "@/components/BookingPaymentSummary";
import { PlayerRatingBadge } from "@/components/PlayerRating";
import { ReceiptUploader, ReceiptViewer, isOnlineMethod } from "@/components/ReceiptUploader";
import { StarInput } from "@/components/Reviews";
import { Button, Notice, Pill, Spinner } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { hoursUntilGame, type PlayerStats } from "@/lib/loyalty";
import { formatNPR, formatTime12, gamePlayed, prettyDate } from "@/lib/futsal";
import { validateMessage } from "@/lib/validation";
import type { Booking } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

/** Extended booking shape — the list route also sends these convenience fields. */
type DiaryBooking = Booking & {
  playerStats?: PlayerStats;
};

/** My one review at a venue (POST /api/reviews keeps it to a single row). */
type MyReview = {
  id: number;
  venueId: number;
  bookingId: number | null;
  rating: number;
  message: string;
};

/**
 * Did this game actually happen? Completed, or confirmed with the end time
 * behind us — never a pending or rejected request. A played game is locked:
 * nothing on its card can be changed any more.
 */
const played = (b: {
  status: string;
  date: string;
  startTime: string;
  endTime: string;
}) => b.status !== "cancelled" && b.status !== "rejected" && gamePlayed(b);

/**
 * My games — a 1:1 port of the web app's app/bookings/page.tsx.
 *
 * Same three tabs (Coming up / Played / Cancelled), same KPI strip, same
 * pending banner, same per-card actions: pay, attach receipt, cancel, review,
 * and the ledger-backed payment summary. Web-only affordances (confirm(),
 * window.location form post to the gateway) become Alert and the shared
 * mockApprove verify path used by the booking detail screen.
 */
export default function BookingsScreen() {
  const { colors: c, isDark } = useTheme();
  const { user, ready } = useAuth();
  const router = useRouter();

  const [bookings, setBookings] = useState<DiaryBooking[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"upcoming" | "past" | "cancelled">("upcoming");
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [viewReceipt, setViewReceipt] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reviewFor, setReviewFor] = useState<number | null>(null);
  const [reviewStars, setReviewStars] = useState(5);
  const [reviewMsg, setReviewMsg] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [myReviews, setMyReviews] = useState<MyReview[]>([]);
  const [cancelError, setCancelError] = useState("");
  const [paying, setPaying] = useState<number | null>(null);
  const [payError, setPayError] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoadError(null);
      const [list, stats] = await Promise.all([
        fetchBookings({ userId: user.id }),
        fetchUserStats(user.id).catch(() => null),
      ]);
      setBookings(list);
      setPlayerStats(
        (list as DiaryBooking[]).find((b) => b.playerStats)?.playerStats ?? stats,
      );
      try {
        const mine = await fetchReviews({ userId: user.id });
        setMyReviews(
          mine.map((r) => ({
            id: r.id,
            venueId: r.venueId,
            bookingId: r.bookingId,
            rating: r.rating,
            message: r.message,
          })),
        );
      } catch {
        /* reviews are secondary — keep the diary usable */
      }
    } catch (e) {
      setLoadError(
        e instanceof Error ? `Could not load bookings. ${e.message}` : "Could not load bookings.",
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        // Do not block the diary on demo-data seeding. The booking API is the
        // source of truth and a slow seed endpoint used to make this screen look
        // frozen while the user was trying to review a game.
        if (user) await load();
        else setLoading(false);
      })();
    }, [user, load]),
  );

  const today = new Date().toISOString().slice(0, 10);
  const gone = (s: string) => s === "cancelled" || s === "rejected";
  const myReviewAt = (venueId?: number) =>
    myReviews.find((r) => r.venueId === venueId) ?? null;

  const filtered = useMemo(() => {
    if (tab === "cancelled") return bookings.filter((b) => gone(b.status));
    if (tab === "past") return bookings.filter(played);
    return bookings.filter((b) => !gone(b.status) && !played(b) && b.date >= today);
  }, [bookings, tab, today]);

  const pendingCount = bookings.filter((b) => b.status === "pending" && b.date >= today).length;
  const totalSpent = bookings
    .filter((b) => !gone(b.status))
    .reduce((s, b) => s + b.totalPrice, 0);

  async function saveReceipt(id: number, receiptUrl: string) {
    setUploading(true);
    try {
      await patchBooking(id, { receiptUrl });
      await load();
      setUploadFor(null);
    } catch (e) {
      Alert.alert("Couldn't save receipt", e instanceof Error ? e.message : "Try again");
    } finally {
      setUploading(false);
    }
  }

  /**
   * Pay via a gateway.
   *
   * The web app opens a hidden form / redirect into the eSewa or Khalti test
   * page. React Native has no popup, so against the sandbox gateways the app
   * posts verify with mockApprove — the identical server path (signature check
   * skipped, ledger row appended, statuses updated).
   */
  function payNow(b: DiaryBooking) {
    setPaying(b.id);
    setPayError("");
    setCancelError("");
    const method = String(b.paymentMethod ?? "");
    const amount = Math.max(0, b.depositRequired && b.depositStatus !== "paid" ? b.depositAmount ?? 0 : b.totalPrice - b.paidAmount);
    const path = method === "eSewa"
      ? `/payment/esewa/mock?bookingId=${b.id}&amount=${encodeURIComponent(String(amount))}`
      : `/payment/khalti/mock?bookingId=${b.id}&amount=${encodeURIComponent(String(amount))}&pidx=mock-pidx`;
    setPaying(null);
    router.push(path as never);
  }

  function needsOnlinePay(b: DiaryBooking) {
    if (gone(b.status)) return false;
    if (played(b)) return false;
    if (b.isFreePlay && b.totalPrice === 0) return false;
    const m = String(b.paymentMethod ?? "");
    if (m !== "eSewa" && m !== "Khalti") return false;
  /** Specs may say "pending" before wallet capture; treat like unpaid. */
  return (
    b.paymentStatus === "unpaid" ||
    b.paymentStatus === "pending" ||
    (!!b.depositRequired && b.depositStatus !== "paid")
  );
  }

  function payLabel(b: DiaryBooking) {
    if (b.depositRequired && b.depositStatus !== "paid") {
      return `Pay ${formatNPR(b.depositAmount ?? 0)} deposit 🛡️`;
    }
    return `Pay ${formatNPR(b.totalPrice)} now 💳`;
  }

  async function submitReview(b: DiaryBooking) {
    if (!user || !b.venue?.id) return;
    const vErr = validateMessage(reviewMsg.trim(), { min: 3, max: 1000, label: "Review" });
    if (vErr) {
      setReviewError(vErr);
      return;
    }
    if (reviewStars < 1 || reviewStars > 5) {
      setReviewError("Tap 1–5 stars ⭐");
      return;
    }
    setReviewSaving(true);
    setReviewError("");
    try {
      await postReview({
        venueId: b.venue.id,
        userId: user.id,
        bookingId: b.id,
        rating: reviewStars,
        message: reviewMsg.trim(),
      });
      setReviewFor(null);
      setReviewMsg("");
      setReviewStars(5);
      await load();
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "Couldn't post");
    } finally {
      setReviewSaving(false);
    }
  }

  /**
   * A played game can always open the one-review-per-venue editor. The API
   * upserts that single review, so the same booking can be corrected later and
   * a later booking at the venue can update the existing review without creating
   * duplicates.
   */
  function reviewable(b: DiaryBooking) {
    return !gone(b.status) && played(b);
  }

  async function cancel(b: DiaryBooking) {
    Alert.alert(
      "Cancel this booking?",
      "The venue will be told straight away — and it dings your reliability stars ⭐.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel booking",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setCancelling(b.id);
              setCancelError("");
              try {
                await patchBooking(b.id, { status: "cancelled", actor: "player" });
                await load();
              } catch (e) {
                setCancelError(e instanceof Error ? e.message : "Couldn't cancel");
              } finally {
                setCancelling(null);
              }
            })();
          },
        },
      ],
    );
  }

  // Signed-out: the web page shows a "your games live here" card.
  if (ready && !user) {
    return (
      <SafeAreaView style={[styles.flex, styles.center, { backgroundColor: c.bg }]} edges={["top"]}>
        <View style={[styles.signedOutCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.signedOutIcon, { backgroundColor: colors.emerald600 }]}>
            <CalendarCheck size={32} color="#FFFFFF" />
          </View>
          <Text style={[styles.signedOutTitle, { color: c.text }]}>Your games live here ⚽</Text>
          <Text style={[styles.signedOutBody, { color: c.textMuted }]}>
            Log in to see upcoming kickabouts, receipts and venue passes. Takes 10 seconds —
            promise!
          </Text>
          <View style={styles.signedOutActions}>
            <Pressable
              onPress={() => router.push("/login")}
              style={[styles.signedOutBtn, { backgroundColor: colors.emerald600 }]}
            >
              <LogIn size={16} color="#FFFFFF" />
              <Text style={styles.signedOutBtnText}>Log in</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push("/signup")}
              style={[styles.signedOutBtn, { borderColor: c.border }]}
            >
              <Text style={[styles.signedOutBtnText, { color: c.text }]}>Join free</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: 16,
            maxWidth: 1280,
            width: "100%",
            alignSelf: "center",
          },
        ]}
      >
        <View style={styles.eyebrowRow}>
          <PartyPopper size={14} color={colors.orange500} />
          <Text style={styles.eyebrow}>{user?.name?.split(" ")[0]}'s game diary</Text>
        </View>
        <View style={styles.titleRow}>
          <Text style={[styles.h1, { color: c.text }]}>My games</Text>
          {playerStats ? (
            <View style={[styles.ratingSummary, { backgroundColor: c.surface, borderColor: c.border }]}>
              <PlayerRatingBadge stats={playerStats} size="sm" />
              <View style={styles.ratingSummaryCopy}>
                <Text style={[styles.ratingSummaryTitle, { color: c.text }]}>Reliability</Text>
                <Text style={[styles.ratingSummaryMeta, { color: c.textMuted }]}>
                  {playerStats.label} • {playerStats.completed} played • {playerStats.cancelled} cancelled
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {loadError ? <Notice message={loadError} /> : null}
        {cancelError ? <Notice message={cancelError} /> : null}
        {payError ? <Notice message={`💳 ${payError}`} /> : null}

        {pendingCount > 0 ? (
          <View style={[styles.pendingBanner, { borderColor: "#FDE68A", backgroundColor: isDark ? "rgba(245,158,11,0.10)" : "#FFFBEB" }]}>
            <Hourglass size={20} color={colors.amber400} />
            <Text style={styles.pendingText}>
              {pendingCount} game{pendingCount > 1 ? "s" : ""} waiting for a friendly thumbs-up
              from the venue — we'll ping you the moment they confirm!
            </Text>
          </View>
        ) : null}

        <View style={styles.kpiRow}>
          {[
            {
              l: "Coming up",
              v: String(bookings.filter((b) => !gone(b.status) && !played(b) && b.date >= today).length),
            },
            { l: "Memories made", v: String(bookings.filter(played).length) },
            { l: "Invested in fun", v: formatNPR(totalSpent) },
          ].map((s) => (
            <View key={s.l} style={[styles.kpi, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.kpiValue, { color: c.text }]} numberOfLines={1}>
                {s.v}
              </Text>
              <Text style={[styles.kpiLabel, { color: c.textFaint }]}>{s.l}</Text>
            </View>
          ))}
        </View>

        <View style={styles.tabRow}>
          {(["upcoming", "past", "cancelled"] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[
                styles.tabBtn,
                tab === t
                  ? styles.tabOn
                  : { backgroundColor: c.surface, borderColor: c.border },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === t }}
            >
              <Text style={[styles.tabText, tab === t ? styles.tabTextOn : { color: c.textMuted }]}>
                {t === "upcoming" ? "Coming up" : t === "past" ? "Played" : "Cancelled"}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <Spinner label="Loading your bookings…" />
        ) : filtered.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <CalendarCheck size={40} color={c.textFaint} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>
              {tab === "upcoming" ? "No games yet — let's fix that! ⚽" : "Nothing here yet"}
            </Text>
            <Text style={[styles.emptyBody, { color: c.textMuted }]}>
              {tab === "upcoming"
                ? "Your next great memory is one tap away."
                : "Your history will show up here."}
            </Text>
            {tab === "upcoming" ? (
              <Pressable
                onPress={() => router.push("/venues")}
                style={[styles.emptyBtn, { backgroundColor: colors.emerald600 }]}
              >
                <Text style={styles.emptyBtnText}>Find a court near me</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          filtered.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              tab={tab}
              mine={myReviewAt(b.venue?.id)}
              reviewable={reviewable(b)}
              cancelling={cancelling === b.id}
              paying={paying === b.id}
              uploadFor={uploadFor === b.id}
              uploading={uploading}
              reviewFor={reviewFor === b.id}
              reviewStars={reviewStars}
              reviewMsg={reviewMsg}
              reviewError={reviewError}
              reviewSaving={reviewSaving}
              onCancel={() => void cancel(b)}
              onPay={() => void payNow(b)}
              needsOnlinePay={needsOnlinePay(b)}
              payLabel={payLabel(b)}
              onOpenReceipt={() => setViewReceipt(b.receiptUrl ?? "")}
              onToggleUpload={() =>
                setUploadFor((u) => (u === b.id ? null : b.id))
              }
              onSaveReceipt={(url) => void saveReceipt(b.id, url)}
              onToggleReview={() => {
                if (reviewFor === b.id) {
                  setReviewFor(null);
                  return;
                }
                const mine = myReviewAt(b.venue?.id);
                setReviewStars(mine?.rating ?? 5);
                setReviewMsg(mine?.message ?? "");
                setReviewFor(b.id);
                setReviewError("");
              }}
              onReviewStars={setReviewStars}
              onReviewMsg={(t) => {
                setReviewMsg(t);
                setReviewError("");
              }}
              onSubmitReview={() => {
                const card = filtered.find((x) => x.id === b.id);
                if (card) void submitReview(card);
              }}
              onOpenBooking={() => router.push(`/booking/${b.id}`)}
              isDark={isDark}
              muted={c.textMuted}
              surface={c.surface}
              border={c.border}
              text={c.text}
            />
          ))
        )}
      </ScrollView>
      {viewReceipt ? <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt(null)} /> : null}
    </SafeAreaView>
  );
}

function BookingCard({
  booking: b,
  tab,
  mine,
  reviewable,
  cancelling,
  paying,
  uploadFor,
  uploading,
  reviewFor,
  reviewStars,
  reviewMsg,
  reviewError,
  reviewSaving,
  onCancel,
  onPay,
  needsOnlinePay,
  payLabel,
  onOpenReceipt,
  onToggleUpload,
  onSaveReceipt,
  onToggleReview,
  onReviewStars,
  onReviewMsg,
  onSubmitReview,
  onOpenBooking,
  isDark,
  muted,
  surface,
  border,
  text,
}: {
  booking: DiaryBooking;
  tab: "upcoming" | "past" | "cancelled";
  mine: MyReview | null;
  reviewable: boolean;
  cancelling: boolean;
  paying: boolean;
  uploadFor: boolean;
  uploading: boolean;
  reviewFor: boolean;
  reviewStars: number;
  reviewMsg: string;
  reviewError: string;
  reviewSaving: boolean;
  onCancel: () => void;
  onPay: () => void;
  needsOnlinePay: boolean;
  payLabel: string;
  onOpenReceipt: () => void;
  onToggleUpload: () => void;
  onSaveReceipt: (url: string) => void;
  onToggleReview: () => void;
  onReviewStars: (n: number) => void;
  onReviewMsg: (t: string) => void;
  onSubmitReview: () => void;
  onOpenBooking: () => void;
  isDark: boolean;
  muted: string;
  surface: string;
  border: string;
  text: string;
}) {
  const isPublic = b.visibility === "public";
  const isPlayed = played(b);
  const isGone = b.status === "cancelled" || b.status === "rejected";
  const balance = b.totalPrice - b.paidAmount;
  const method = String(b.paymentMethod ?? "");

  const statusTone =
    b.status === "confirmed"
      ? "success"
      : b.status === "cancelled" || b.status === "rejected"
        ? "danger"
        : b.status === "completed"
          ? "info"
          : "warning";

  const payTone =
    b.paymentStatus === "paid"
      ? "success"
      : b.paymentStatus === "overpaid"
        ? "info"
        : b.paymentStatus === "deposit_paid"
          ? "warning"
          : "danger";

  return (
    <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
      <View style={styles.cardTop}>
        {b.venue?.imageUrl ? (
          <Image source={{ uri: b.venue.imageUrl }} style={styles.cardImg} />
        ) : (
          <View style={[styles.cardImg, { backgroundColor: muted + "33" }]} />
        )}
        <View style={styles.cardBody}>
          <View style={styles.cardHeadRow}>
            <View style={styles.grow}>
              <Text style={[styles.venueName, { color: text }]} numberOfLines={1}>
                {b.venue?.name ?? "Venue"}
              </Text>
              <Text style={[styles.meta, { color: muted }]} numberOfLines={1}>
                {b.court?.name ?? "Court"} • {b.court && "format" in b.court ? (b.court as { format?: string }).format : ""}
              </Text>
            </View>
            <View style={styles.moneyCol}>
              {b.discountAmount && b.priceBeforeDiscount && b.priceBeforeDiscount > b.totalPrice ? (
                <Text style={[styles.strike, { color: textFaint(muted) }]}>
                  {formatNPR(b.priceBeforeDiscount)}
                </Text>
              ) : null}
              <Text style={[styles.price, { color: isDark ? "#34D399" : "#047857" }]}>
                {b.totalPrice === 0 ? "FREE 🎁" : formatNPR(b.totalPrice)}
              </Text>
              <Text style={[styles.payMeta, { color: textFaint(muted) }]}>
                {method} • {b.paymentStatus}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={onOpenBooking}
            accessibilityRole="button"
            style={[styles.openBooking, { borderColor: border }]}
          >
            <Text style={[styles.openBookingText, { color: isDark ? "#6EE7B7" : colors.emerald700 }]}>
              View booking details
            </Text>
            <ChevronRight size={14} color={isDark ? "#6EE7B7" : colors.emerald700} />
          </Pressable>

          {b.totalPrice > 0 ? <BookingPaymentSummary bookingId={b.id} /> : null}

          {b.status === "pending" ? (
            <Text
              style={[
                styles.note,
                styles.noteAmber,
                isDark && {
                  backgroundColor: "rgba(245,158,11,0.12)",
                  color: "#FCD34D",
                },
              ]}
            >
              Your request is with the venue — lovely humans are reviewing it now. We'll let you
              know right away! 💛
            </Text>
          ) : null}
          {b.status === "rejected" ? (
            <Text style={[styles.note, styles.noteRed]}>
              Oh no — the venue was fully packed for this slot. Pick another time, we believe in
              you! 🙏
            </Text>
          ) : null}

          <View style={styles.detailRow}>
            <CalendarCheck size={16} color={colors.emerald600} />
            <Text style={[styles.detailText, { color: muted }]}>{prettyDate(b.date)}</Text>
            <Clock size={16} color={colors.emerald600} />
            <Text style={[styles.detailText, { color: muted }]}>
              {formatTime12(b.startTime)} – {formatTime12(b.endTime || b.startTime)}
            </Text>
            <MapPin size={16} color={colors.emerald600} />
            <Text style={[styles.detailText, { color: muted }]} numberOfLines={1}>
              {b.venue?.address ?? ""}
            </Text>
          </View>

          {b.competition ? (
            <View style={[styles.compCard, { borderColor: isDark ? "rgba(99,102,241,0.3)" : "#C7D2FE" }]}>
              <View style={styles.compHead}>
                <Text style={styles.compTitle}>
                  <Swords size={14} color="#4338CA" /> {b.teamName || "Your squad"} vs{" "}
                  {b.competition.opponentName}
                </Text>
                <View
                  style={[
                    styles.compScore,
                    {
                      backgroundColor:
                        b.competition.scoreStatus === "recorded"
                          ? "rgba(16,185,129,0.15)"
                          : isDark
                            ? "rgba(255,255,255,0.10)"
                            : "#FFFFFF",
                    },
                  ]}
                >
                  <Text
                    style={{
                      color:
                        b.competition.scoreStatus === "recorded"
                          ? isDark
                            ? "#34D399"
                            : "#047857"
                          : isDark
                            ? "#C7D2FE"
                            : "#4338CA",
                      fontSize: fontSize.xs,
                      fontWeight: "900",
                    }}
                  >
                    {b.competition.scoreStatus === "recorded"
                      ? `⚽ ${b.competition.homeScore}–${b.competition.awayScore}`
                      : "score pending"}
                  </Text>
                </View>
              </View>
              <Text style={styles.compBody}>
                {b.competition.scoreStatus === "recorded"
                  ? "The venue owner recorded this result — it counts on both squads' profiles."
                  : "The venue owner records the final score after kick-off — it then counts on both squads' profiles."}
                {b.competition.leagueName ? ` 🏆 Counts towards ${b.competition.leagueName}.` : ""}
                {b.competition.leagueId ? " Open the league (from Matches → Leagues)." : ""}
              </Text>
            </View>
          ) : null}

          <View style={styles.badgeRow}>
            <View style={[styles.idChip, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "#F5F5F4" }]}>
              <Text style={[styles.idChipText, { color: muted }]}>#FN-{b.id}</Text>
            </View>
            {isPublic ? (
              <View style={[styles.chip, { backgroundColor: isDark ? "rgba(249,115,22,0.15)" : "#FFEDD5" }]}>
                <Globe size={12} color="#C2410C" />
                <Text style={[styles.chipText, { color: "#C2410C" }]}>Open game</Text>
              </View>
            ) : b.competition ? (
              <View style={[styles.chip, { backgroundColor: "rgba(99,102,241,0.15)" }]}>
                <Swords size={12} color="#4338CA" />
                <Text style={[styles.chipText, { color: "#4338CA" }]}>Competition</Text>
              </View>
            ) : (
              <View style={[styles.chip, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "#F5F5F4" }]}>
                <Lock size={12} color={muted} />
                <Text style={[styles.chipText, { color: muted }]}>Just us</Text>
              </View>
            )}
            {isPlayed ? (
              <View style={[styles.chip, { backgroundColor: isDark ? "rgba(255,255,255,0.15)" : "#E7E5E4" }]}>
                <Lock size={12} color={muted} />
                <Text style={[styles.chipText, { color: muted }]}>Game played • locked</Text>
              </View>
            ) : (
              <View style={[styles.chip, { backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "#F5F5F4" }]}>
                <QrCode size={12} color={muted} />
                <Text style={[styles.chipText, { color: muted }]}>Show at court</Text>
              </View>
            )}
            {b.teamName ? (
              <View style={[styles.chip, { backgroundColor: "rgba(14,165,233,0.15)" }]}>
                <Shield size={12} color="#0369A1" />
                <Text style={[styles.chipText, { color: "#0369A1" }]}>{b.teamName}</Text>
              </View>
            ) : null}
            {b.isFreePlay ? (
              <View style={[styles.chip, { backgroundColor: "rgba(139,92,246,0.15)" }]}>
                <Gift size={12} color="#6D28D9" />
                <Text style={[styles.chipText, { color: "#6D28D9" }]}>Free hour used 🎁</Text>
              </View>
            ) : null}
            {b.promoCode && b.discountAmount ? (
              <View style={[styles.chip, { backgroundColor: "rgba(16,185,129,0.15)" }]}>
                <Ticket size={12} color="#047857" />
                <Text style={[styles.chipText, { color: "#047857" }]}>
                  {b.promoCode} saved {formatNPR(b.discountAmount)}
                </Text>
              </View>
            ) : null}
            {mine?.bookingId === b.id ? (
              <View style={[styles.chip, { backgroundColor: "rgba(245,158,11,0.15)" }]}>
                <Star size={12} color="#B45309" fill="#B45309" />
                <Text style={[styles.chipText, { color: "#B45309" }]}>Reviewed</Text>
              </View>
            ) : null}
            {b.depositRequired ? (
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor:
                      b.depositStatus === "paid"
                        ? "rgba(16,185,129,0.15)"
                        : b.depositStatus === "forfeited"
                          ? "rgba(239,68,68,0.15)"
                          : "rgba(245,158,11,0.15)",
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: "#B45309" }]}>
                  🛡️ Deposit {formatNPR(b.depositAmount ?? 0)} •{" "}
                  {b.depositStatus === "paid" ? "paid ✓" : b.depositStatus}
                </Text>
              </View>
            ) : null}
            {b.paidAmount > 0 ? (
              <View style={[styles.chip, { backgroundColor: "rgba(14,165,233,0.10)" }]}>
                <Text style={[styles.chipText, { color: "#0369A1" }]}>
                  💰 {formatNPR(b.paidAmount)} verified
                  {b.gatewayTxnId ? ` • ${b.gatewayTxnId.slice(0, 12)}` : ""}
                </Text>
              </View>
            ) : null}
            {needsOnlinePay ? (
              <Pressable
                onPress={onPay}
                disabled={paying}
                style={[
                  styles.payBtn,
                  {
                    backgroundColor: method === "eSewa" ? colors.emerald600 : "#9333EA",
                    opacity: paying ? 0.5 : 1,
                  },
                ]}
              >
                {paying ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Wallet size={14} color="#FFFFFF" />
                )}
                <Text style={styles.payBtnText}>
                  {paying ? "Opening…" : `${payLabel} via ${method} (Test)`}
                </Text>
              </Pressable>
            ) : null}
            {isOnlineMethod(method) && !isGone ? (
              b.receiptUrl ? (
                <Pressable onPress={onOpenReceipt} style={[styles.chip, { backgroundColor: "rgba(16,185,129,0.15)" }]}>
                  <ReceiptText size={12} color="#047857" />
                  <Text style={[styles.chipText, { color: "#047857" }]}>Receipt ✓</Text>
                </Pressable>
              ) : !isPlayed ? (
                <Pressable onPress={onToggleUpload} style={[styles.chip, { backgroundColor: isDark ? "rgba(249,115,22,0.15)" : "#FFEDD5" }]}>
                  <ReceiptText size={12} color="#C2410C" />
                  <Text style={[styles.chipText, { color: "#C2410C" }]}>Add receipt 🧾</Text>
                </Pressable>
              ) : null
            ) : null}
            {tab === "upcoming" && !isPlayed ? (
              <Pressable
                onPress={onCancel}
                disabled={cancelling}
                style={[styles.chip, styles.cancelChip, { opacity: cancelling ? 0.5 : 1 }]}
              >
                <XCircle size={12} color="#DC2626" />
                <Text style={[styles.chipText, { color: "#DC2626" }]}>
                  {cancelling ? "Cancelling…" : "Can't make it"}
                </Text>
              </Pressable>
            ) : null}
            {reviewable ? (
              <Pressable onPress={onToggleReview} style={[styles.chip, { backgroundColor: colors.amber400 }]}>
                <Star size={12} color="#78350F" fill="#78350F" />
                <Text style={[styles.chipText, { color: "#78350F" }]}>
                  {reviewFor
                    ? "Close"
                    : mine?.bookingId === b.id
                      ? "Edit review"
                      : mine
                        ? "Update review ⭐"
                        : "Review ⭐"}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {reviewFor ? (
            <View style={[styles.reviewForm, { borderColor: isDark ? "rgba(245,158,11,0.25)" : "#FDE68A" }]}>
              <Text style={[styles.reviewPrompt, { color: text }]}>
                {mine
                  ? `Update your review of ${b.venue?.name} — it replaces the old one, you keep just the one ⭐`
                  : `How was ${b.venue?.name}? ⭐`}
              </Text>
              <StarInput value={reviewStars} onChange={onReviewStars} />
              <TextInput
                value={reviewMsg}
                onChangeText={onReviewMsg}
                multiline
                maxLength={1000}
                placeholder="Turf, vibe, staff… help future players! ⚽"
                placeholderTextColor={muted}
                style={[styles.reviewInput, { backgroundColor: surface, borderColor: border, color: text }]}
              />
              <Text style={[styles.counter, { color: muted }]}>
                {reviewMsg.trim().length}/1000 • min 3 characters 💬
              </Text>
              {reviewError ? <Text style={styles.reviewErr}>{reviewError}</Text> : null}
              <Pressable
                onPress={onSubmitReview}
                disabled={reviewSaving}
                style={[styles.reviewSubmit, { opacity: reviewSaving ? 0.5 : 1 }]}
              >
                <Text style={styles.reviewSubmitText}>
                  {reviewSaving ? "Saving…" : mine ? "Update review 💛" : "Post review 💛"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {uploadFor ? (
            <View style={[styles.uploadBox, { borderColor: isDark ? "rgba(249,115,22,0.25)" : "#FED7AA" }]}>
              <Text style={[styles.uploadHint, { color: muted }]}>
                Paid via {method}? Attach your screenshot — it speeds up approval! ⚡
              </Text>
              <ReceiptUploader value="" compact onChange={(url) => url && onSaveReceipt(url)} />
              {uploading ? <Text style={styles.uploading}>Saving…</Text> : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function textFaint(muted: string) {
  return muted;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: space[4] },
  scroll: { padding: space[4], paddingBottom: space[16], gap: space[2] },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
    color: colors.orange500,
  },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3] },
  h1: { fontSize: fontSize["3xl"], fontWeight: "900" },
  ratingSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderWidth: 1,
    borderRadius: radius["2xl"],
    paddingHorizontal: space[2.5],
    paddingVertical: space[1.5],
    maxWidth: "100%",
  },
  ratingSummaryCopy: { minWidth: 0, flexShrink: 1 },
  ratingSummaryTitle: { fontSize: fontSize.xs, fontWeight: "900" },
  ratingSummaryMeta: { fontSize: fontSize["2xs"], fontWeight: "700", marginTop: 1 },

  pendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    marginTop: space[2],
  },
  pendingText: { flex: 1, fontSize: 13, fontWeight: "700", color: "#92400E", lineHeight: 18 },
  kpiRow: { flexDirection: "row", gap: space[2], marginTop: space[3] },
  kpi: {
    flex: 1,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[3.5],
    alignItems: "center",
  },
  kpiValue: { fontSize: fontSize.xl, fontWeight: "900" },
  kpiLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    textAlign: "center",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  tabRow: { flexDirection: "row", gap: space[2], marginTop: space[4] },
  tabBtn: {
    flex: 1,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    paddingVertical: space[2.5],
    alignItems: "center",
  },
  tabOn: { backgroundColor: colors.emerald600, borderColor: colors.emerald600 },
  tabText: { fontSize: fontSize.xs, fontWeight: "900", textTransform: "uppercase" },
  tabTextOn: { color: "#FFFFFF" },
  emptyCard: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[10],
    alignItems: "center",
    marginTop: space[4],
  },
  emptyTitle: { marginTop: space[3], fontSize: fontSize.base, fontWeight: "800", textAlign: "center" },
  emptyBody: { marginTop: space[1], fontSize: fontSize.sm, textAlign: "center" },
  emptyBtn: {
    marginTop: space[4],
    borderRadius: radius["2xl"],
    paddingHorizontal: space[6],
    paddingVertical: space[3],
  },
  emptyBtnText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    marginTop: space[3],
    overflow: "hidden",
  },
  cardTop: { flexDirection: "row" },
  cardImg: { width: 120, height: "100%", minHeight: 140 },
  cardBody: { flex: 1, minWidth: 0, padding: space[4] },
  cardHeadRow: { flexDirection: "row", gap: space[2], alignItems: "flex-start" },
  grow: { flex: 1, minWidth: 0 },
  venueName: { fontSize: fontSize.base, fontWeight: "800" },
  meta: { fontSize: fontSize.xs, marginTop: 2 },
  moneyCol: { alignItems: "flex-end" },
  openBooking: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: space[2],
    marginTop: space[2],
  },
  openBookingText: { fontSize: fontSize.xs, fontWeight: "900" },
  strike: { fontSize: fontSize.xs, textDecorationLine: "line-through" },
  price: { fontSize: fontSize.xl, fontWeight: "900" },
  payMeta: { fontSize: fontSize.xs, fontWeight: "700" },
  note: {
    marginTop: space[2.5],
    borderRadius: radius.xl,
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
    fontSize: fontSize.xs,
    lineHeight: 17,
    overflow: "hidden",
  },
  noteAmber: { backgroundColor: "#FFFBEB", color: "#B45309" },
  noteRed: { backgroundColor: "#FEF2F2", color: "#DC2626" },
  detailRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
    marginTop: space[3],
  },
  detailText: { fontSize: 13, fontWeight: "600", marginRight: space[2] },
  compCard: {
    marginTop: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    backgroundColor: "rgba(99,102,241,0.08)",
  },
  compHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  compTitle: { fontSize: fontSize.xs, fontWeight: "900", color: "#4338CA", flex: 1 },
  compScore: { borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[1] },
  compBody: { marginTop: space[1], fontSize: fontSize.xs, color: "#4338CA", lineHeight: 16 },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: "rgba(100,116,139,0.15)",
  },
  idChip: { borderRadius: radius.xl, paddingHorizontal: space[3], paddingVertical: space[1.5] },
  idChipText: { fontFamily: "monospace", fontSize: fontSize.xs, fontWeight: "700" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: space[3],
    paddingVertical: space[1.5],
  },
  chipText: { fontSize: fontSize.xs, fontWeight: "900" },
  cancelChip: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  payBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    paddingHorizontal: space[4],
    paddingVertical: space[1.5],
    minHeight: 32,
  },
  payBtnText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
  reviewForm: {
    marginTop: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[4],
    gap: space[2.5],
    backgroundColor: "rgba(254,243,199,0.5)",
  },
  reviewPrompt: { fontSize: fontSize.xs, fontWeight: "900" },
  reviewInput: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space[3.5],
    fontSize: fontSize.sm,
    minHeight: 64,
    textAlignVertical: "top",
  },
  counter: { fontSize: fontSize.xs },
  reviewErr: { fontSize: fontSize.xs, fontWeight: "700", color: "#EF4444" },
  reviewSubmit: {
    borderRadius: radius["2xl"],
    backgroundColor: colors.amber400,
    paddingVertical: space[2.5],
    alignItems: "center",
  },
  reviewSubmitText: { color: "#78350F", fontSize: fontSize.sm, fontWeight: "900" },
  uploadBox: {
    marginTop: space[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[3],
    backgroundColor: "rgba(255,247,237,0.6)",
  },
  uploadHint: { fontSize: fontSize.xs, marginBottom: space[2] },
  uploading: { fontSize: fontSize.xs, color: "#EA580C", marginTop: space[1.5], fontWeight: "700" },
  signedOutCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space[8],
    alignItems: "center",
  },
  signedOutIcon: {
    width: 64,
    height: 64,
    borderRadius: radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  signedOutTitle: { marginTop: space[4], fontSize: fontSize.xl, fontWeight: "900", textAlign: "center" },
  signedOutBody: { marginTop: space[2], fontSize: fontSize.sm, textAlign: "center", lineHeight: 19 },
  signedOutActions: { flexDirection: "row", gap: space[2], marginTop: space[6], alignSelf: "stretch" },
  signedOutBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: "transparent",
    paddingVertical: space[3],
    minHeight: 44,
  },
  signedOutBtnText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
});
