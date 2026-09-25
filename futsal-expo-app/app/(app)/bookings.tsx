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
import {
  chooseBookingTeamPayment,
  decideCompetitionBooking,
  fetchBookings,
  fetchReviews,
  fetchUserStats,
  patchBooking,
  postReview,
} from "@/api";
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
  const [competitionDecision, setCompetitionDecision] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamMethodFor, setTeamMethodFor] = useState<number | null>(null);
  const [teamMethod, setTeamMethod] = useState<"eSewa" | "Khalti" | "Cash at Venue">("eSewa");
  const [teamSaving, setTeamSaving] = useState<number | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!user) return;
    try {
      setLoadError(null);
      const [list, stats] = await Promise.all([
        fetchBookings({ userId: user.id, refresh }),
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
      let active = true;
      (async () => {
        // Do not block the diary on demo-data seeding. The booking API is the
        // source of truth and a slow seed endpoint used to make this screen look
        // frozen while the user was trying to review a game.
        if (user) await load();
        else setLoading(false);
      })();
      // Keep both captains' feeds synchronized while this screen is focused.
      // The server response is always authoritative; this is only a refresh
      // loop, never a local status mutation.
      const timer = user
        ? setInterval(() => {
            if (active) void load(true);
          }, 4000)
        : null;
      return () => {
        active = false;
        if (timer) clearInterval(timer);
      };
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
  const competitionRequestCount = bookings.filter(
    (b) =>
      b.status === "pending" &&
      b.date >= today &&
      b.competition?.competitionStatus === "pending" &&
      b.competition.isOpponentCaptain,
  ).length;
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
    const amount = Math.max(0, b.advancePaymentRequired && b.advancePaymentStatus !== "paid"
      ? b.advancePaymentAmount ?? 0
      : b.depositRequired && b.depositStatus !== "paid"
        ? b.depositAmount ?? 0
        : b.totalPrice - b.paidAmount);
    const path = method === "eSewa"
      ? `/payment/esewa/mock?bookingId=${b.id}&amount=${encodeURIComponent(String(amount))}`
      : `/payment/khalti/mock?bookingId=${b.id}&amount=${encodeURIComponent(String(amount))}&pidx=mock-pidx`;
    setPaying(null);
    router.push(path as never);
  }

  async function saveTeamMethod(b: DiaryBooking) {
    if (!user || !b.teamId || teamMethodFor !== b.id) return;
    setTeamSaving(b.id);
    try {
      await chooseBookingTeamPayment(b.id, user.id, teamMethod);
      setTeamMethodFor(null);
      await load();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Couldn't save the team payment method");
    } finally {
      setTeamSaving(null);
    }
  }

  function payTeamShare(b: DiaryBooking, share: NonNullable<DiaryBooking["teamPayments"]>[number]) {
    if (share.paymentStatus === "paid" || !["eSewa", "Khalti"].includes(share.paymentMethod)) return;
    setPaying(b.id);
    const gateway = share.paymentMethod === "eSewa" ? "esewa" : "khalti";
    const query = gateway === "esewa"
      ? `/payment/esewa/mock?bookingId=${b.id}&amount=${encodeURIComponent(String(share.amountDue))}&teamPaymentId=${share.id}&userId=${user?.id ?? 0}`
      : `/payment/khalti/mock?bookingId=${b.id}&amount=${encodeURIComponent(String(share.amountDue))}&teamPaymentId=${share.id}&userId=${user?.id ?? 0}&pidx=mock-team-${share.id}`;
    setPaying(null);
    router.push(query as never);
  }

  function needsOnlinePay(b: DiaryBooking) {
    if (gone(b.status)) return false;
    // The bill is not payable until the opposition captain releases the
    // competition request. Payment must follow the durable decision, not a
    // locally hidden button.
    if (b.competition?.competitionStatus === "pending") return false;
    if (played(b)) return false;
    if (b.isFreePlay && b.totalPrice === 0) return false;
    const m = String(b.paymentMethod ?? "");
    if (m !== "eSewa" && m !== "Khalti") return false;
  /** Specs may say "pending" before wallet capture; treat like unpaid. */
  return (
    (b.advancePaymentRequired && b.advancePaymentStatus !== "paid") ||
    b.paymentStatus === "unpaid" ||
    b.paymentStatus === "pending" ||
    (!!b.depositRequired && b.depositStatus !== "paid")
  );
  }

  function payLabel(b: DiaryBooking) {
    if (b.advancePaymentRequired && b.advancePaymentStatus !== "paid") {
      return `Pay ${formatNPR(b.advancePaymentAmount ?? 0)} advance 💳`;
    }
    if (b.depositRequired && b.depositStatus !== "paid") {
      return `Pay ${formatNPR(b.depositAmount ?? 0)} deposit 🛡️`;
    }
    return `Pay ${formatNPR(Math.max(0, b.totalPrice - b.paidAmount))} balance 💳`;
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
                await patchBooking(b.id, { status: "cancelled", actor: "player", actorId: user?.id });
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

  async function decideCompetition(b: DiaryBooking, action: "accept" | "decline") {
    if (!user || !b.competition?.isOpponentCaptain) return;
    setCompetitionDecision(b.id);
    setLoadError(null);
    try {
      const result = await decideCompetitionBooking(b.id, user.id, action);
      const nextStatus = String(result.competitionStatus ?? result.booking?.competitionStatus ?? "");
      if (nextStatus) {
        setBookings((current) =>
          current.map((row) =>
            row.id !== b.id
              ? row
              : {
                  ...row,
                  status: action === "decline" ? "rejected" : row.status,
                  competition: row.competition
                    ? { ...row.competition, competitionStatus: nextStatus }
                    : row.competition,
                },
          ),
        );
      }
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't update the competition request.");
    } finally {
      setCompetitionDecision(null);
    }
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
              {competitionRequestCount > 0
                ? `${competitionRequestCount} competition request${competitionRequestCount > 1 ? "s" : ""} need your accept or decline. The venue owner stays out until you decide.`
                : `${pendingCount} game${pendingCount > 1 ? "s" : ""} waiting for a friendly thumbs-up from the venue — we'll ping you the moment they confirm!`}
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
              teamShare={user ? b.teamPayments?.find((share) => share.userId === user.id) ?? null : null}
              teamMethodOpen={teamMethodFor === b.id}
              teamMethod={teamMethod}
              teamSaving={teamSaving === b.id}
              onOpenTeamMethod={() => {
                const share = b.teamPayments?.find((item) => item.userId === user?.id);
                setTeamMethodFor(teamMethodFor === b.id ? null : b.id);
                setTeamMethod((share?.paymentMethod as "eSewa" | "Khalti" | "Cash at Venue") || "eSewa");
              }}
              onTeamMethodChange={setTeamMethod}
              onSaveTeamMethod={() => void saveTeamMethod(b)}
              onPayTeamShare={() => {
                const share = b.teamPayments?.find((item) => item.userId === user?.id);
                if (share) payTeamShare(b, share);
              }}
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
              competitionActing={competitionDecision === b.id}
              onCompetitionAction={(action) => void decideCompetition(b, action)}
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
  teamShare,
  teamMethodOpen,
  teamMethod,
  teamSaving,
  onOpenTeamMethod,
  onTeamMethodChange,
  onSaveTeamMethod,
  onPayTeamShare,
  payLabel,
  onOpenReceipt,
  onToggleUpload,
  onSaveReceipt,
  onToggleReview,
  onReviewStars,
  onReviewMsg,
  onSubmitReview,
  onOpenBooking,
  competitionActing,
  onCompetitionAction,
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
  teamShare: NonNullable<DiaryBooking["teamPayments"]>[number] | null;
  teamMethodOpen: boolean;
  teamMethod: "eSewa" | "Khalti" | "Cash at Venue";
  teamSaving: boolean;
  onOpenTeamMethod: () => void;
  onTeamMethodChange: (method: "eSewa" | "Khalti" | "Cash at Venue") => void;
  onSaveTeamMethod: () => void;
  onPayTeamShare: () => void;
  payLabel: string;
  onOpenReceipt: () => void;
  onToggleUpload: () => void;
  onSaveReceipt: (url: string) => void;
  onToggleReview: () => void;
  onReviewStars: (n: number) => void;
  onReviewMsg: (t: string) => void;
  onSubmitReview: () => void;
  onOpenBooking: () => void;
  competitionActing: boolean;
  onCompetitionAction: (action: "accept" | "decline") => void;
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
  const competitionPending = b.competition?.competitionStatus === "pending";
  const competitionDeclined =
    b.competition?.competitionStatus === "declined" ||
    b.competition?.competitionStatus === "cancelled";
  const canDecideCompetition = Boolean(
    b.status === "pending" && competitionPending && b.competition?.isOpponentCaptain,
  );

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
          {b.advancePaymentRequired ? (
            <Text style={[styles.note, { backgroundColor: isDark ? "rgba(14,165,233,0.12)" : "#F0F9FF", color: isDark ? "#BAE6FD" : "#075985", borderColor: isDark ? "rgba(56,189,248,0.25)" : "#BAE6FD" }]}>
              💳 Venue advance: {formatNPR(b.advancePaymentAmount ?? 0)} • {b.advancePaymentStatus === "paid" ? "paid and verified ✓" : "payment requested — use the gateway button below"}
            </Text>
          ) : null}
          {b.teamName && teamShare ? (
            <View style={[styles.teamPaymentCard, { backgroundColor: isDark ? "rgba(14,165,233,0.12)" : "#F0F9FF", borderColor: isDark ? "rgba(56,189,248,0.25)" : "#BAE6FD" }]}>
              <View style={styles.teamPaymentHead}>
                <View style={styles.grow}>
                  <Text style={[styles.teamPaymentTitle, { color: isDark ? "#BAE6FD" : "#075985" }]}>👥 {b.teamName} payment</Text>
                  <Text style={[styles.teamPaymentHint, { color: muted }]}>Your equal server-calculated share: {formatNPR(teamShare.amountDue)}. The confirmed payment goes into the booking ledger.</Text>
                </View>
                <Text style={[styles.teamPaymentStatus, { color: teamShare.paymentStatus === "paid" ? "#047857" : muted }]}>{teamShare.paymentStatus === "paid" ? `Paid via ${teamShare.paymentMethod}` : teamShare.paymentMethod ? `Method: ${teamShare.paymentMethod}` : "Choose method"}</Text>
              </View>
              <View style={styles.teamPaymentActions}>
                <Pressable onPress={onOpenTeamMethod} disabled={teamShare.paymentStatus === "paid" || isGone} style={[styles.chip, { backgroundColor: surface, borderWidth: 1, borderColor: border }]}>
                  <Text style={[styles.chipText, { color: text }]}>{teamShare.paymentMethod ? "Change method" : "Choose payment method"}</Text>
                </Pressable>
                {teamShare.paymentStatus !== "paid" && ["eSewa", "Khalti"].includes(teamShare.paymentMethod) ? (
                  <Pressable onPress={onPayTeamShare} disabled={paying} style={[styles.payBtn, { backgroundColor: "#0284C7", opacity: paying ? 0.5 : 1 }]}>
                    <Wallet size={14} color="#FFFFFF" /><Text style={styles.payBtnText}>Pay share via {teamShare.paymentMethod}</Text>
                  </Pressable>
                ) : null}
              </View>
              {teamMethodOpen ? (
                <View style={[styles.teamMethodBox, { backgroundColor: surface, borderColor: border }]}>
                  <Text style={[styles.teamMethodTitle, { color: text }]}>How will you pay your share?</Text>
                  <View style={styles.teamMethodChoices}>
                    {(["eSewa", "Khalti", "Cash at Venue"] as const).map((choice) => (
                      <Pressable key={choice} onPress={() => onTeamMethodChange(choice)} style={[styles.teamMethodChoice, { backgroundColor: teamMethod === choice ? "#0284C7" : surface, borderColor: teamMethod === choice ? "#0284C7" : border }]}>
                        <Text style={[styles.chipText, { color: teamMethod === choice ? "#FFFFFF" : text }]}>{choice}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable onPress={onSaveTeamMethod} disabled={teamSaving} style={[styles.teamSave, { opacity: teamSaving ? 0.5 : 1 }]}>
                    <Text style={styles.teamSaveText}>{teamSaving ? "Saving…" : "Save payment choice"}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {b.status === "pending" && b.competition?.competitionStatus !== "pending" ? (
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
              {b.competition?.competitionStatus === "declined"
                ? "The opposition captain declined this competition request, so the venue owner was not notified."
                : "Oh no — the venue was fully packed for this slot. Pick another time, we believe in you! 🙏"}
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
                      backgroundColor: competitionDeclined
                        ? "rgba(239,68,68,0.14)"
                        : b.competition.scoreStatus === "recorded"
                          ? "rgba(16,185,129,0.15)"
                          : isDark
                            ? "rgba(255,255,255,0.10)"
                            : "#FFFFFF",
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: competitionDeclined
                        ? "#DC2626"
                        : b.competition.scoreStatus === "recorded"
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
                    {competitionDeclined
                      ? "request declined"
                      : competitionPending
                        ? canDecideCompetition
                          ? "decision needed"
                          : "opponent pending"
                        : b.competition.scoreStatus === "recorded"
                          ? `⚽ ${b.competition.homeScore}–${b.competition.awayScore}`
                          : "score pending"}
                  </Text>
                </View>
              </View>
              <Text style={styles.compBody}>
                {competitionDeclined
                  ? "The opposition captain declined this request, so it was not sent to the venue owner."
                  : competitionPending
                    ? canDecideCompetition
                      ? "Your explicit decision is required. The venue owner will only be notified if you accept."
                      : "Waiting for the opposition captain to accept before the venue can review this request."
                    : b.competition.scoreStatus === "recorded"
                      ? "The venue owner recorded this result — it counts on both squads' profiles."
                      : "The venue owner records the final score after kick-off — it then counts on both squads' profiles."}
                {b.competition.leagueName ? ` 🏆 Counts towards ${b.competition.leagueName}.` : ""}
                {b.competition.leagueId ? " Open the league (from Matches → Leagues)." : ""}
              </Text>
              <View
                style={[
                  styles.competitionPaymentPill,
                  {
                    backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.7)",
                    borderColor: isDark ? "rgba(129,140,248,0.3)" : "rgba(99,102,241,0.25)",
                  },
                ]}
              >
                <Wallet size={13} color={isDark ? "#C7D2FE" : "#4338CA"} />
                <Text style={[styles.competitionPaymentText, { color: isDark ? "#C7D2FE" : "#4338CA" }]}>
                  {b.competition.paymentLabel ??
                    (b.competition.paymentMode === "loser_pays"
                      ? "Losing squad pays"
                      : "Fair split between both squads")}
                </Text>
              </View>
              {b.competition.paymentMode === "loser_pays" ? (
                <Text style={styles.competitionPaymentHint}>The result decides who pays.</Text>
              ) : null}
              {canDecideCompetition ? (
                  <View
                    style={[
                      styles.competitionDecisionBox,
                      {
                        backgroundColor: isDark ? "rgba(15,23,42,0.72)" : "rgba(255,255,255,0.82)",
                        borderColor: isDark ? "rgba(129,140,248,0.28)" : "#C7D2FE",
                      },
                    ]}
                  >
                    <Text style={[styles.competitionDecisionHint, { color: isDark ? "#C7D2FE" : "#3730A3" }]}>
                    Accept this fixture to release it to the venue owner. Declining keeps it out of
                    the owner's actionable bookings.
                  </Text>
                  <View style={styles.competitionDecisionRow}>
                    <Pressable
                      onPress={() => onCompetitionAction("accept")}
                      disabled={competitionActing}
                      style={[styles.competitionAccept, { opacity: competitionActing ? 0.55 : 1 }]}
                    >
                      {competitionActing ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : null}
                      <Text style={styles.competitionAcceptText}>
                        {competitionActing ? "Saving…" : "✓ Accept request"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onCompetitionAction("decline")}
                      disabled={competitionActing}
                      style={[styles.competitionDecline, { opacity: competitionActing ? 0.55 : 1 }]}
                    >
                      <Text style={styles.competitionDeclineText}>× Decline request</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
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
            {isOnlineMethod(method) && !isGone && b.competition?.competitionStatus !== "pending" ? (
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
            {tab === "upcoming" && !isPlayed && !b.competition?.isOpponentCaptain ? (
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
  teamPaymentCard: { marginTop: space[2.5], borderRadius: radius["2xl"], borderWidth: 1, padding: space[3.5], gap: space[2] },
  teamPaymentHead: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  teamPaymentTitle: { fontSize: fontSize.sm, fontWeight: "900" },
  teamPaymentHint: { fontSize: 11, lineHeight: 16, fontWeight: "600", marginTop: 2 },
  teamPaymentStatus: { fontSize: 10, fontWeight: "900", textAlign: "right" },
  teamPaymentActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  teamMethodBox: { borderWidth: 1, borderRadius: radius.xl, padding: space[3], gap: space[2] },
  teamMethodTitle: { fontSize: fontSize.xs, fontWeight: "900" },
  teamMethodChoices: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  teamMethodChoice: { borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: space[3], paddingVertical: space[2] },
  teamSave: { borderRadius: radius.xl, backgroundColor: "#0369A1", minHeight: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: space[3] },
  teamSaveText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
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
  competitionPaymentPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: space[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.25)",
    backgroundColor: "rgba(255,255,255,0.7)",
    paddingHorizontal: space[3],
    paddingVertical: space[1.5],
  },
  competitionPaymentText: { color: "#4338CA", fontSize: fontSize.xs, fontWeight: "900" },
  competitionPaymentHint: { marginTop: 3, color: "#6366F1", fontSize: 10, fontWeight: "700" },
  competitionDecisionBox: {
    marginTop: space[3],
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space[3],
  },
  competitionDecisionHint: { fontSize: fontSize.xs, lineHeight: 16, fontWeight: "700" },
  competitionDecisionRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[3] },
  competitionAccept: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.xl,
    backgroundColor: colors.emerald600,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingHorizontal: space[3],
  },
  competitionAcceptText: { color: "#FFFFFF", fontSize: fontSize.xs, fontWeight: "900" },
  competitionDecline: {
    minHeight: 40,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[4],
  },
  competitionDeclineText: { color: "#B91C1C", fontSize: fontSize.xs, fontWeight: "900" },
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
