"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck, MapPin, Clock, XCircle, QrCode, Wallet, LogIn, Lock, Globe, Hourglass, PartyPopper, ReceiptText, Star, Gift, Ticket, Shield, Swords } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { ReceiptUploader, ReceiptViewer, isOnlineMethod } from "@/components/ReceiptUploader";
import { StarInput } from "@/components/Reviews";
import { PlayerRatingBadge } from "@/components/PlayerRating";
import { BookingPaymentSummary } from "@/components/BookingPaymentSummary";
import { TeamPaymentDetails } from "@/components/TeamPaymentDetails";
import { formatNPR, formatTime12, prettyDate, gamePlayed } from "@/lib/futsal";
import { hoursUntilGame, type PlayerStats } from "@/lib/loyalty";
import { validateMessage } from "@/lib/validation";
import { apiFetch } from "@/lib/api";

type Booking = {
  id: number;
  courtId: number;
  userId: number;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  visibility: string;
  playersNeeded: number;
  ourCrew: number;
  openSpots: number;
  /** Squad this booking was made for; "" = individual booking. */
  teamId: number | null;
  teamName: string;
  receiptUrl: string;
  isFreePlay: boolean;
  promoCode: string;
  discountAmount: number;
  priceBeforeDiscount: number;
  depositRequired: boolean;
  depositAmount: number;
  depositStatus: string;
  paidAmount: number;
  gatewayTxnId: string;
  advancePaymentRequired: boolean;
  advancePaymentAmount: number;
  advancePaymentStatus: string;
  advancePaymentRequestedAt: string | null;
  amountReceived?: number;
  amountReceivable?: number;
  advanceReceivedAmount?: number;
  advanceReceivableAmount?: number;
  paymentSummary?: {
    courtPrice: number;
    extrasTotal: number;
    owed: number;
    received: number;
    receivable: number;
    surplus: number;
    byMethod: Record<string, number>;
    advanceRequested: number;
    advanceReceived: number;
    advanceReceivable: number;
  };
  teamPayments: Array<{
    id: number;
    teamId: number;
    userId: number;
    payerName?: string;
    amountDue: number;
    paymentMethod: string;
    paymentStatus: string;
    paidAmount: number;
    gatewayTxnId: string;
  }>;
  paymentRequests: Array<{
    id: number;
    requestedBy: number;
    requesterName: string;
    payerId: number;
    payerName: string;
    amountDue: number;
    purpose: string;
    note: string;
    paymentMethod: string;
    status: string;
    paidAmount: number;
    createdAt: string | null;
    paidAt: string | null;
  }>;
  teamPlayers: Array<{ id: number; name: string; role: string }>;

  /** Present on competition bookings — who we played and the score so far. */
  competition: {
    opponentTeamId: number | null;
    opponentName: string;
    leagueId: number | null;
    leagueName: string;
    homeScore: number | null;
    awayScore: number | null;
    scoreStatus: string;
    scoreUpdatedAt?: string | null;
    competitionStatus?: string;
    paymentMode?: "split" | "loser_pays" | string;
    paymentLabel?: string;
    opponentCaptainId?: number | null;
    isOpponentCaptain?: boolean;
  } | null;
  court?: { name: string; format: string };
  venue?: { id: number; name: string; address: string; imageUrl: string };
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

function paymentStatusLabel(status: string) {
  return String(status || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paymentMethodLabel(method: string) {
  if (method === "Cash at Venue") return "Cash at venue";
  if (method === "Free Play 🎁") return "Free play";
  return method || "Not selected";
}

export default function BookingsPage() {
  const { user, loading: authLoading } = useUser();
  const [bookings, setBookings] = useState<Booking[]>([]);
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
  // My reviews, one per venue — POST /api/reviews updates a row in place, so
  // this is what each venue's card edits rather than adds to.
  const [myReviews, setMyReviews] = useState<MyReview[]>([]);
  const [cancelError, setCancelError] = useState("");
  const [paying, setPaying] = useState<number | null>(null);
  const [payError, setPayError] = useState("");
  const [competitionDecision, setCompetitionDecision] = useState<number | null>(null);
  const [teamMethodFor, setTeamMethodFor] = useState<number | null>(null);
  const [teamMethod, setTeamMethod] = useState("eSewa");
  const [teamSaving, setTeamSaving] = useState<number | null>(null);
  const [advanceSaving, setAdvanceSaving] = useState<number | null>(null);
  const [moneyRequestFor, setMoneyRequestFor] = useState<number | null>(null);
  const [moneyRequestPayers, setMoneyRequestPayers] = useState<Record<number, number[]>>({});
  const [moneyRequestAmount, setMoneyRequestAmount] = useState<Record<number, string>>({});
  const [moneyRequestNote, setMoneyRequestNote] = useState<Record<number, string>>({});
  const [moneyRequestSaving, setMoneyRequestSaving] = useState<number | null>(null);

  const load = async (uid: number) => {
    const res = await apiFetch(`/api/bookings?userId=${uid}`);
    const data = await res.json();
    setBookings(data.bookings ?? []);
    try {
      const rRes = await apiFetch(`/api/reviews?userId=${uid}`);
      const rData = await rRes.json();
      setMyReviews((rData.reviews ?? []) as MyReview[]);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      try {
        await apiFetch("/api/seed", { method: "POST" });
        if (user) await load(user.id);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // The opposition captain and the requesting captain may have My Bookings
  // open in different browser tabs/devices. There is no client-owned status to
  // trust here: poll the database-backed feed while this screen is mounted so
  // an accept/decline appears for the other captain without a manual refresh.
  useEffect(() => {
    if (!user?.id) return;
    let stopped = false;
    const refreshFeed = async () => {
      try {
        const res = await apiFetch(`/api/bookings?userId=${user.id}&_=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok || stopped) return;
        const data = await res.json();
        if (!stopped) setBookings(data.bookings ?? []);
      } catch {
        // Keep the last confirmed feed visible during a transient poll failure.
      }
    };
    const timer = window.setInterval(() => void refreshFeed(), 4000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [user?.id]);

  const today = new Date().toISOString().slice(0, 10);
  const gone = (s: string) => s === "cancelled" || s === "rejected";
  /** My one review at a venue, if I've written one. */
  const myReviewAt = (venueId?: number) =>
    myReviews.find((r) => r.venueId === venueId) ?? null;

  const filtered = useMemo(() => {
    if (tab === "cancelled") return bookings.filter((b) => gone(b.status));
    // "Played" lists only games that actually happened. A request that was
    // never confirmed was never a game, however far back its date is.
    if (tab === "past") return bookings.filter(played);
    return bookings.filter((b) => !gone(b.status) && !played(b) && b.date >= today);
  }, [bookings, tab, today]);

  const pendingCount = bookings.filter((b) => b.status === "pending" && b.date >= today).length;
  const opponentRequestCount = bookings.filter(
    (b) => b.competition?.competitionStatus === "pending" && b.competition.isOpponentCaptain,
  ).length;
  const totalSpent = bookings
    .filter((b) => !gone(b.status))
    .reduce((s, b) => s + b.totalPrice, 0);

  async function saveReceipt(id: number, receiptUrl: string) {
    setUploading(true);
    try {
      await apiFetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptUrl }),
      });
      if (user) await load(user.id);
      setUploadFor(null);
    } finally {
      setUploading(false);
    }
  }

  async function payNow(b: Booking) {
    setPaying(b.id);
    setPayError("");
    setCancelError("");
    try {
      if (b.paymentMethod === "eSewa") {
        const init = await apiFetch("/api/payments/esewa/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: b.id, userId: user?.id }),
        });
        const jd = await init.json();
        if (!init.ok) throw new Error(jd.error || "eSewa init failed");
        if (jd.mockUrl) {
          window.location.assign(String(jd.mockUrl));
          return;
        }
        const form = document.createElement("form");
        form.method = "POST";
        form.action = jd.url;
        for (const [k, v] of Object.entries(jd.fields as Record<string, string>)) {
          const inp = document.createElement("input");
          inp.type = "hidden";
          inp.name = k;
          inp.value = String(v);
          form.appendChild(inp);
        }
        document.body.appendChild(form);
        form.submit();
        return;
      }
      if (b.paymentMethod === "Khalti") {
        const init = await apiFetch("/api/payments/khalti/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: b.id, userId: user?.id }),
        });
        const jd = await init.json();
        if (!init.ok) throw new Error(jd.error || "Khalti init failed");
        window.location.assign(String(jd.payment_url));
        return;
      }
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Payment failed");
      setPaying(null);
    }
  }

  async function payAdvanceWith(b: Booking, method: "eSewa" | "Khalti") {
    if (!user || b.advancePaymentStatus === "paid") return;
    setAdvanceSaving(b.id);
    setPayError("");
    try {
      const res = await apiFetch(`/api/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: method, actor: "player", actorId: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Choose an online payment method first");
      await load(user.id);
      await payNow({ ...b, paymentMethod: method });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Could not open the advance payment");
    } finally {
      setAdvanceSaving(null);
    }
  }

  async function requestTeamMoney(b: Booking) {
    if (!user || !b.teamId || b.userId !== user.id) return;
    const payerIds = moneyRequestPayers[b.id] ?? [];
    const amount = Number(moneyRequestAmount[b.id] ?? 0);
    if (payerIds.length === 0 || !Number.isInteger(amount) || amount < 10) {
      setPayError("Select at least one teammate and enter at least Rs. 10 from each player.");
      return;
    }
    setMoneyRequestSaving(b.id);
    setPayError("");
    try {
      const res = await apiFetch(`/api/bookings/${b.id}/payment-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requesterId: user.id,
          payerIds,
          amount,
          purpose: b.advancePaymentRequired && b.advancePaymentStatus !== "paid" ? "advance" : "booking",
          note: moneyRequestNote[b.id] ?? "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send the payment requests");
      setMoneyRequestFor(null);
      setMoneyRequestPayers((current) => ({ ...current, [b.id]: [] }));
      setMoneyRequestAmount((current) => ({ ...current, [b.id]: "" }));
      setMoneyRequestNote((current) => ({ ...current, [b.id]: "" }));
      await load(user.id);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Could not send the payment requests");
    } finally {
      setMoneyRequestSaving(null);
    }
  }

  async function payRequestedMoney(
    b: Booking,
    request: Booking["paymentRequests"][number],
    method: "eSewa" | "Khalti",
  ) {
    if (!user || request.status !== "pending") return;
    setPaying(b.id);
    setPayError("");
    try {
      const choice = await apiFetch(`/api/bookings/${b.id}/payment-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, paymentMethod: method }),
      });
      const choiceData = await choice.json().catch(() => ({}));
      if (!choice.ok) throw new Error(choiceData.error || "Could not choose the payment method");
      const endpoint = method === "eSewa" ? "/api/payments/esewa/initiate" : "/api/payments/khalti/initiate";
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: b.id, paymentRequestId: request.id, userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the payment");
      if (method === "eSewa") {
        if (data.mockUrl) {
          window.location.assign(String(data.mockUrl));
          return;
        }
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.url;
        for (const [key, value] of Object.entries(data.fields as Record<string, string>)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = String(value);
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
        return;
      }
      window.location.assign(String(data.payment_url));
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Could not start the payment");
      setPaying(null);
    }
  }

  async function saveTeamMethod(b: Booking) {
    if (!user || !b.teamId || teamMethodFor !== b.id) return;
    setTeamSaving(b.id);
    setPayError("");
    try {
      const res = await apiFetch(`/api/bookings/${b.id}/team-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, paymentMethod: teamMethod }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save the team payment method");
      setTeamMethodFor(null);
      await load(user.id);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Couldn't save the team payment method");
    } finally {
      setTeamSaving(null);
    }
  }

  async function payTeamShare(b: Booking, share: Booking["teamPayments"][number]) {
    if (!user || share.paymentStatus === "paid" || !["eSewa", "Khalti"].includes(share.paymentMethod)) return;
    setPaying(b.id);
    setPayError("");
    try {
      const endpoint = share.paymentMethod === "eSewa" ? "/api/payments/esewa/initiate" : "/api/payments/khalti/initiate";
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: b.id, teamPaymentId: share.id, userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start team payment");
      if (share.paymentMethod === "eSewa") {
        if (data.mockUrl) {
          window.location.assign(String(data.mockUrl));
          return;
        }
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.url;
        for (const [key, value] of Object.entries(data.fields as Record<string, string>)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = String(value);
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
        return;
      }
      window.location.assign(String(data.payment_url));
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Team payment failed");
      setPaying(null);
    }
  }

  function needsOnlinePay(b: Booking) {
    if (gone(b.status)) return false;
    // Competition money is held back until the opposition captain accepts.
    if (b.competition?.competitionStatus === "pending") return false;
    // Played games are locked — the money is settled at the venue, not here.
    if (played(b)) return false;
    if (b.isFreePlay && b.totalPrice === 0) return false;
    // Owner-requested advances have dedicated gateway controls below. Once
    // verified, the remaining balance is intentionally payable at the venue.
    if (b.advancePaymentRequired) return false;
    if (b.paymentMethod !== "eSewa" && b.paymentMethod !== "Khalti") return false;
    return b.paymentStatus === "pending" || (b.depositRequired && b.depositStatus === "pending");
  }

  function payLabel(b: Booking) {
    if (b.advancePaymentRequired && b.advancePaymentStatus !== "paid") {
      return `Pay ${formatNPR(b.advancePaymentAmount)} advance 💳`;
    }
    if (b.depositRequired && b.depositStatus !== "paid") {
      return `Pay ${formatNPR(b.depositAmount)} deposit 🛡️`;
    }
    return `Pay ${formatNPR(Math.max(0, b.totalPrice - b.paidAmount))} balance 💳`;
  }

  async function submitReview(b: Booking) {
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
      const res = await apiFetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId: b.venue.id,
          userId: user.id,
          bookingId: b.id,
          rating: reviewStars,
          message: reviewMsg.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setReviewFor(null);
      setReviewMsg("");
      setReviewStars(5);
      if (user) await load(user.id);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "Couldn't post");
    } finally {
      setReviewSaving(false);
    }
  }

  /**
   * Can this card open the review box? The game has to be played, and a player
   * keeps one review per venue: an unreviewed venue starts it, and any *other*
   * played game here updates the one that's already there.
   */
  function reviewable(b: Booking) {
    if (gone(b.status) || !played(b)) return false;
    const mine = myReviewAt(b.venue?.id);
    if (!mine) return true;
    return mine.bookingId !== b.id;
  }

  async function cancel(b: Booking) {
    if (!confirm("Cancel this booking? The venue will be told straight away — and it dings your reliability stars ⭐.")) return;
    setCancelling(b.id);
    setCancelError("");
    try {
      const res = await apiFetch(`/api/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled", actor: "player", actorId: user?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCancelError(data.error || "Couldn't cancel");
        return;
      }
      if (user) await load(user.id);
    } finally {
      setCancelling(null);
    }
  }

  async function decideCompetition(b: Booking, action: "accept" | "decline") {
    if (!user || !b.competition?.isOpponentCaptain) return;
    setCompetitionDecision(b.id);
    try {
      const res = await apiFetch(`/api/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitionAction: action, actorId: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't update the competition request.");
      const nextStatus = String(data.competitionStatus ?? data.booking?.competitionStatus ?? "");
      // Paint the confirmed server response immediately, then re-read the
      // enriched feed. This removes the stale "opponent pending" badge before
      // the next poll and keeps the local card aligned with the database.
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
      await load(user.id);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Couldn't update the competition request.");
    } finally {
      setCompetitionDecision(null);
    }
  }

  const statusBadge = (s: string) =>
    s === "pending"
      ? "bg-amber-400 text-amber-950"
      : s === "cancelled" || s === "rejected"
        ? "bg-red-500 text-white"
        : s === "completed"
          ? "bg-white text-stone-700 dark:bg-white/10 dark:text-slate-200"
          : "bg-emerald-500 text-white";

  if (!authLoading && !user) {
    return (
      <main className="turf-pattern grid min-h-screen place-items-center px-4 py-12">
        <div className="w-full max-w-md rounded-[2rem] border border-[#F0E3CC] bg-white p-8 text-center shadow-lg dark:border-white/10 dark:bg-slate-900">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-600 shadow-md">
            <CalendarCheck className="h-8 w-8 text-white" />
          </span>
          <h1 className="mt-4 text-2xl font-black text-stone-900 dark:text-slate-100">Your games live here ⚽</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-500 dark:text-slate-400">
            Log in to see upcoming kickabouts, receipts and venue passes. Takes
            10 seconds — promise!
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white shadow-md"
            >
              <LogIn className="h-4 w-4" /> Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-2xl border border-stone-200 py-3 text-sm font-black text-stone-700 dark:border-white/10 dark:text-slate-200"
            >
              Join free
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="turf-pattern min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-orange-500 dark:text-orange-400">
          <PartyPopper className="h-3.5 w-3.5 shrink-0" />
          <span className="no-scrollbar min-w-0 max-w-full overflow-x-auto whitespace-nowrap">
            {user?.name ?? "Player"}&apos;s game diary
          </span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black text-stone-900 dark:text-slate-100">My games</h1>
          {bookings[0]?.playerStats && <PlayerRatingBadge stats={bookings[0].playerStats} />}
        </div>

        {cancelError && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {cancelError}
          </div>
        )}
        {payError && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            💳 {payError}
          </div>
        )}

        {pendingCount > 0 && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <Hourglass className="h-5 w-5 shrink-0 animate-pulse text-amber-600 dark:text-amber-400" />
            <p className="text-[13px] font-bold text-amber-800 dark:text-amber-200">
              {opponentRequestCount > 0
                ? `${opponentRequestCount} competition request${opponentRequestCount > 1 ? "s" : ""} need your accept or decline. The venue owner stays out until you decide.`
                : `${pendingCount} game${pendingCount > 1 ? "s" : ""} waiting for a friendly thumbs-up from the venue — we'll ping you the moment they confirm!`}
            </p>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { l: "Coming up", v: bookings.filter((b) => !gone(b.status) && !played(b) && b.date >= today).length, icon: CalendarCheck, tone: "emerald" },
            { l: "Memories made", v: bookings.filter(played).length, icon: Clock, tone: "sky" },
            { l: "Invested in fun", v: formatNPR(totalSpent), icon: Wallet, tone: "violet" },
          ].map((s) => {
            const Icon = s.icon;
            const tone =
              s.tone === "emerald"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                : s.tone === "sky"
                  ? "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                  : "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300";
            return (
              <div
                key={s.l}
                className={`min-w-0 rounded-2xl border border-[#F0E3CC] bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-slate-900 sm:p-4 ${s.l === "Invested in fun" ? "col-span-2 sm:col-span-1" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-lg font-black leading-tight text-stone-900 dark:text-slate-100">{s.v}</p>
                    <p className="mt-0.5 break-words text-[10px] font-black uppercase leading-tight tracking-[0.12em] text-stone-400 dark:text-slate-500">{s.l}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex w-full gap-1 rounded-2xl border border-[#F0E3CC] bg-white p-1 shadow-sm dark:border-white/10 dark:bg-slate-900">
          {(["upcoming", "past", "cancelled"] as const).map((t) => {
            const label = t === "upcoming" ? "Coming up" : t === "past" ? "Played" : "Cancelled";
            const count = t === "upcoming"
              ? bookings.filter((b) => !gone(b.status) && !played(b) && b.date >= today).length
              : t === "past"
                ? bookings.filter(played).length
                : bookings.filter((b) => gone(b.status)).length;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[12px] font-black transition ${
                  tab === t
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-stone-500 hover:bg-orange-50 dark:text-slate-400 dark:hover:bg-white/5"
                }`}
              >
                <span className="truncate">{label}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${tab === t ? "bg-white/20 text-white" : "bg-stone-100 text-stone-500 dark:bg-white/10 dark:text-slate-400"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="mt-5 space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-3xl bg-white dark:bg-slate-900" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-stone-300 bg-white p-12 text-center dark:border-white/20 dark:bg-slate-900">
            <CalendarCheck className="mx-auto h-10 w-10 text-stone-300 dark:text-slate-600" />
            <h3 className="mt-3 text-lg font-extrabold text-stone-900 dark:text-slate-100">
              {tab === "upcoming" ? "No games yet — let's fix that! ⚽" : "Nothing here yet"}
            </h3>
            <p className="mt-1 text-sm text-stone-500 dark:text-slate-400">
              {tab === "upcoming" ? "Your next great memory is one tap away." : "Your history will show up here."}
            </p>
            <Link
              href="/venues"
              className="mt-4 inline-block rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-black text-white shadow-md"
            >
              Find a court near me
            </Link>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {filtered.map((b) => {
              const isPublic = b.visibility === "public";
              const isPending = b.status === "pending";
              const competitionPending = b.competition?.competitionStatus === "pending";
              const competitionDeclined =
                b.competition?.competitionStatus === "declined" ||
                b.competition?.competitionStatus === "cancelled";
              const canDecideCompetition = Boolean(
                b.status === "pending" && competitionPending && b.competition?.isOpponentCaptain,
              );
              const isPlayed = played(b);
              const mine = myReviewAt(b.venue?.id);
              const myTeamShare = user ? b.teamPayments?.find((share) => share.userId === user.id) : undefined;
              const receivedRequests = user
                ? b.paymentRequests.filter((request) => request.payerId === user.id && request.status === "pending")
                : [];
              const canRequestTeamMoney = Boolean(user && b.teamId && b.userId === user.id && !gone(b.status) && !isPlayed);
              return (
              <div
                key={b.id}
                className="min-w-0 overflow-hidden rounded-3xl border border-[#F0E3CC] bg-white shadow-[0_10px_30px_rgba(180,120,60,0.08)] dark:border-white/10 dark:bg-slate-900"
              >
                <div className="flex flex-col sm:flex-row">
                  <div className="relative h-28 sm:h-auto sm:w-36 sm:shrink-0">
                    <img
                      src={b.venue?.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <span
                      className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-black uppercase shadow ${statusBadge(b.status)}`}
                    >
                      {isPlayed
                        ? "🔒 Played"
                        : b.status === "pending"
                          ? canDecideCompetition
                            ? "🆚 Decision needed"
                            : competitionPending
                              ? "🆚 Waiting for opposition"
                              : "⏳ Waiting for venue"
                          : b.status === "confirmed"
                            ? "✓ Confirmed"
                            : b.status}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 max-w-full">
                        <div className="no-scrollbar max-w-full overflow-x-auto">
                          <h3 className="w-max min-w-full whitespace-nowrap text-base font-extrabold leading-tight text-stone-900 dark:text-slate-100">{b.venue?.name ?? "Venue"}</h3>
                        </div>
                        <div className="no-scrollbar mt-0.5 max-w-full overflow-x-auto">
                          <p className="w-max whitespace-nowrap text-xs leading-relaxed text-stone-500 dark:text-slate-400">
                            {b.court?.name ?? "Court"} • {b.court?.format ?? ""}
                          </p>
                        </div>
                      </div>
                      <span className="max-w-full shrink-0 text-right">
                        {b.discountAmount > 0 && b.priceBeforeDiscount > b.totalPrice && (
                          <span className="block text-xs font-bold text-stone-400 line-through dark:text-slate-500">
                            {formatNPR(b.priceBeforeDiscount)}
                          </span>
                        )}
                        <span className="block text-lg font-black text-emerald-700 dark:text-emerald-300">
                          {b.totalPrice === 0 ? "FREE 🎁" : formatNPR(b.totalPrice)}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center justify-end gap-1.5 text-[11px] font-bold text-stone-400 dark:text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Wallet className="h-3 w-3" /> Payment: {paymentMethodLabel(b.paymentMethod)}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                            b.paymentStatus === "paid"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                              : b.paymentStatus === "pending"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                                : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"
                          }`}>
                            {paymentStatusLabel(b.paymentStatus)}
                          </span>
                        </span>
                      </span>
                    </div>
                    <div className="mt-3 flex min-w-0 flex-wrap items-start gap-x-4 gap-y-1.5 border-b border-stone-100 pb-3 text-[12px] font-bold leading-relaxed text-stone-500 dark:border-white/5 dark:text-slate-400">
                      <span className="flex items-start gap-1.5">
                        <CalendarCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {prettyDate(b.date)} · {formatTime12(b.startTime)}–{formatTime12(b.endTime || b.startTime)}
                      </span>
                      <span className="flex min-w-0 items-start gap-1.5 break-words">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span className="break-words">{b.venue?.address || "Venue address unavailable"}</span>
                      </span>
                    </div>
                    {b.advancePaymentRequired && b.advancePaymentStatus !== "paid" && (
                      <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-black leading-relaxed text-sky-800 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200">
                        💳 Venue advance {formatNPR(b.advancePaymentAmount)} needs attention — open payment actions below.
                      </p>
                    )}
                    {canDecideCompetition && (
                      <p className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] font-black leading-relaxed text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200">
                        🆚 Opposition decision needed — open booking actions to accept or decline.
                      </p>
                    )}
                    <details className="group mt-3 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50/70 dark:border-white/10 dark:bg-white/[0.03]">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-xs font-black text-stone-700 marker:hidden dark:text-slate-200">
                        <span>Payment, team &amp; booking actions</span>
                        <span className="text-[11px] font-bold text-stone-400 transition group-open:rotate-180 dark:text-slate-500">⌄</span>
                      </summary>
                      <div className="border-t border-stone-200 px-3.5 pb-3.5 dark:border-white/10">
                    {/* The badge above only says "paid" — this shows how it was
                        actually paid, since a game is often part eSewa, part
                        Khalti, part cash, with the water added on afterwards. */}
                    {b.totalPrice > 0 && <BookingPaymentSummary bookingId={b.id} />}
                    {b.advancePaymentRequired && (
                      <div className="mt-2.5 rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-xs font-bold leading-relaxed text-sky-800 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>💳 Venue advance requested: {formatNPR(b.advancePaymentAmount)}</span>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${b.advancePaymentStatus === "paid" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
                            {b.advancePaymentStatus === "paid" ? "Verified" : "Awaiting payment"}
                          </span>
                        </div>
                        {b.advancePaymentStatus === "paid" ? (
                          <p className="mt-1.5 text-[11px] font-semibold text-sky-800/80 dark:text-sky-200/80">
                            Advance verified. Remaining balance {formatNPR(Math.max(0, b.totalPrice - b.paidAmount))} may be paid at the venue.
                          </p>
                        ) : (
                          <>
                            <p className="mt-1.5 text-[11px] font-semibold text-sky-800/80 dark:text-sky-200/80">
                              Pay this requested amount within one hour of the owner&apos;s request. Only eSewa or Khalti can satisfy the advance; Cash at Venue is not available for it.
                              {b.advancePaymentRequestedAt ? ` Requested ${new Date(b.advancePaymentRequestedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(["eSewa", "Khalti"] as const).map((method) => (
                                <button
                                  key={method}
                                  type="button"
                                  onClick={() => void payAdvanceWith(b, method)}
                                  disabled={advanceSaving === b.id || gone(b.status)}
                                  className={`rounded-full px-3 py-1.5 text-[11px] font-black text-white shadow-sm disabled:opacity-50 ${method === "eSewa" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-purple-600 hover:bg-purple-700"}`}
                                >
                                  {advanceSaving === b.id ? "Opening…" : `Pay advance with ${method}`}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {b.teamName && b.teamPayments?.length > 0 && myTeamShare && (
                      <div className="mt-2.5 rounded-2xl border border-sky-200 bg-sky-50/80 p-3.5 dark:border-sky-500/25 dark:bg-sky-500/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-black text-sky-900 dark:text-sky-100">👥 {b.teamName} payment</p>
                          <span className="text-xs font-black text-sky-700 dark:text-sky-200">Your share {formatNPR(myTeamShare.amountDue)}</span>
                        </div>
                        <p className="mt-1 text-[11px] font-semibold leading-relaxed text-sky-800/80 dark:text-sky-200/80">
                          Each selected team member pays an equal server-calculated share. Your choice and confirmed gateway payment are saved to the booking ledger.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-[11px] font-black text-sky-800 dark:bg-white/10 dark:text-sky-100">
                            Payment: {paymentMethodLabel(myTeamShare.paymentMethod)}
                            <span className="rounded-full bg-sky-600/15 px-2 py-0.5 text-[10px] uppercase text-sky-700 dark:text-sky-200">
                              {paymentStatusLabel(myTeamShare.paymentStatus)}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setTeamMethodFor(teamMethodFor === b.id ? null : b.id);
                              setTeamMethod(myTeamShare.paymentMethod || "eSewa");
                            }}
                            disabled={myTeamShare.paymentStatus === "paid" || gone(b.status)}
                            className="rounded-full border border-sky-300 bg-white px-3 py-1.5 text-[11px] font-black text-sky-800 shadow-sm dark:border-sky-400/40 dark:bg-slate-900 dark:text-sky-100"
                          >
                            {myTeamShare.paymentMethod ? "Change method" : "Choose payment method"}
                          </button>
                          {myTeamShare.paymentStatus !== "paid" && ["eSewa", "Khalti"].includes(myTeamShare.paymentMethod) && (
                            <button
                              type="button"
                              onClick={() => void payTeamShare(b, myTeamShare)}
                              disabled={paying === b.id}
                              className="rounded-full bg-sky-600 px-3 py-1.5 text-[11px] font-black text-white shadow-sm disabled:opacity-50"
                            >
                              {paying === b.id ? "Opening…" : `Pay share via ${myTeamShare.paymentMethod}`}
                            </button>
                          )}
                        </div>
                        {teamMethodFor === b.id && (
                          <div className="mt-3 rounded-xl border border-sky-200 bg-white/80 p-3 dark:border-sky-400/25 dark:bg-slate-950/40">
                            <p className="text-[11px] font-black text-sky-900 dark:text-sky-100">How will you pay your share?</p>
                            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                              {["eSewa", "Khalti", "Cash at Venue"].filter((method) => !(b.advancePaymentRequired && b.advancePaymentStatus !== "paid" && method === "Cash at Venue")).map((method) => (
                                <button
                                  key={method}
                                  type="button"
                                  onClick={() => setTeamMethod(method)}
                                  className={`rounded-xl border px-3 py-2 text-[11px] font-black ${teamMethod === method ? "border-sky-600 bg-sky-600 text-white" : "border-sky-200 bg-white text-sky-800 dark:border-white/10 dark:bg-slate-900 dark:text-sky-100"}`}
                                >
                                  {method}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => void saveTeamMethod(b)}
                              disabled={teamSaving === b.id}
                              className="mt-2 w-full rounded-xl bg-sky-600 py-2 text-xs font-black text-white disabled:opacity-50"
                            >
                              {teamSaving === b.id ? "Saving…" : "Save payment choice"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {b.teamId && b.userId === user?.id && (
                      <TeamPaymentDetails
                        teamName={b.teamName}
                        players={b.teamPlayers}
                        shares={b.teamPayments}
                        requests={b.paymentRequests}
                      />
                    )}
                    {receivedRequests.map((request) => (
                      <div key={request.id} className="mt-2.5 rounded-2xl border border-violet-200 bg-violet-50 px-3.5 py-3 dark:border-violet-500/25 dark:bg-violet-500/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-black text-violet-900 dark:text-violet-100">💸 {request.requesterName} asked you to pay {formatNPR(request.amountDue)}</p>
                          <span className="rounded-full bg-violet-500/15 px-2 py-1 text-[10px] font-black uppercase text-violet-700 dark:text-violet-200">{request.purpose === "advance" ? "Venue advance" : "Team payment"}</span>
                        </div>
                        {request.note && <p className="mt-1 text-[11px] font-semibold text-violet-800/80 dark:text-violet-200/80">{request.note}</p>}
                        <p className="mt-1 text-[11px] font-semibold text-violet-800/80 dark:text-violet-200/80">Pay the requested amount directly to the venue owner. Cash at Venue is not available for this request.</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(["eSewa", "Khalti"] as const).map((method) => (
                            <button
                              key={method}
                              type="button"
                              onClick={() => void payRequestedMoney(b, request, method)}
                              disabled={paying === b.id || gone(b.status)}
                              className={`rounded-full px-3 py-1.5 text-[11px] font-black text-white shadow-sm disabled:opacity-50 ${method === "eSewa" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-purple-600 hover:bg-purple-700"}`}
                            >
                              {paying === b.id ? "Opening…" : `Pay with ${method}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {canRequestTeamMoney && (
                      <div className="mt-2.5 rounded-2xl border border-orange-200 bg-orange-50/70 p-3.5 dark:border-orange-500/25 dark:bg-orange-500/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-black text-orange-900 dark:text-orange-100">👥 Ask a teammate to pay the venue owner</p>
                          <button
                            type="button"
                            onClick={() => setMoneyRequestFor(moneyRequestFor === b.id ? null : b.id)}
                            className="rounded-full border border-orange-300 bg-white px-3 py-1.5 text-[11px] font-black text-orange-800 dark:border-orange-400/40 dark:bg-slate-900 dark:text-orange-100"
                          >
                            {moneyRequestFor === b.id ? "Close" : "Request money"}
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] font-semibold leading-relaxed text-orange-800/80 dark:text-orange-100/80">
                          Choose one player and an exact amount. Their verified eSewa or Khalti payment is recorded against this booking and team ledger.
                        </p>
                        {moneyRequestFor === b.id && (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <div className="rounded-xl border border-orange-200 bg-white p-2 dark:border-white/10 dark:bg-slate-950 sm:col-span-2">
                              <p className="px-1 pb-1 text-[10px] font-black uppercase tracking-wide text-orange-800 dark:text-orange-200">Select teammates</p>
                              <div className="flex flex-wrap gap-2">
                                {b.teamPlayers.filter((player) => player.id !== user?.id).map((player) => {
                                  const selected = (moneyRequestPayers[b.id] ?? []).includes(player.id);
                                  return (
                                    <button
                                      key={player.id}
                                      type="button"
                                      onClick={() => setMoneyRequestPayers((current) => {
                                        const selectedIds = current[b.id] ?? [];
                                        return { ...current, [b.id]: selected ? selectedIds.filter((id) => id !== player.id) : [...selectedIds, player.id] };
                                      })}
                                      className={`rounded-full border px-3 py-1.5 text-[11px] font-black ${selected ? "border-orange-600 bg-orange-600 text-white" : "border-orange-200 bg-orange-50 text-orange-800 dark:border-white/10 dark:bg-slate-900 dark:text-orange-100"}`}
                                    >
                                      {selected ? "✓ " : ""}{player.name}{player.role ? ` · ${player.role}` : ""}
                                    </button>
                                  );
                                })}
                              </div>
                              <p className="mt-2 px-1 text-[10px] font-semibold text-orange-700/80 dark:text-orange-100/80">The amount below is requested from each selected player. They will each receive a direct-pay notification.</p>
                            </div>
                            <input
                              inputMode="decimal"
                              min="10"
                              value={moneyRequestAmount[b.id] ?? ""}
                              onChange={(event) => setMoneyRequestAmount((current) => ({ ...current, [b.id]: event.target.value }))}
                              placeholder="Amount from each player (NPR)"
                              className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-bold text-stone-700 placeholder:text-stone-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                            />
                            <input
                              value={moneyRequestNote[b.id] ?? ""}
                              onChange={(event) => setMoneyRequestNote((current) => ({ ...current, [b.id]: event.target.value }))}
                              placeholder="Optional note"
                              maxLength={200}
                              className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-bold text-stone-700 placeholder:text-stone-400 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 sm:col-span-2"
                            />
                            <button
                              type="button"
                              onClick={() => void requestTeamMoney(b)}
                              disabled={moneyRequestSaving === b.id}
                              className="rounded-xl bg-orange-600 px-3 py-2 text-xs font-black text-white shadow-sm disabled:opacity-50 sm:col-span-2"
                            >
                              {moneyRequestSaving === b.id ? "Sending…" : "Send payment request"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {isPending && !competitionPending && (
                      <p className="mt-2.5 rounded-xl bg-amber-50 px-3.5 py-2 text-xs font-bold leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                        Your request is with the venue — lovely humans are reviewing it
                        now. We&apos;ll let you know right away! 💛
                      </p>
                    )}
                    {b.status === "rejected" && (
                      <p className="mt-2.5 rounded-xl bg-red-50 px-3.5 py-2 text-xs font-bold leading-relaxed text-red-500 dark:bg-red-500/10 dark:text-red-400">
                        {b.competition?.competitionStatus === "declined"
                          ? "The opposition captain declined this competition request, so the venue owner was not notified."
                          : "Oh no — the venue was fully packed for this slot. Pick another time, we believe in you! 🙏"}
                      </p>
                    )}
                    <div className="mt-3 flex min-w-0 flex-wrap gap-x-5 gap-y-1.5 text-[13px] font-semibold leading-relaxed text-stone-600 dark:text-slate-300">
                      <span className="flex items-center gap-1.5">
                        <CalendarCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> {prettyDate(b.date)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        {formatTime12(b.startTime)} – {formatTime12(b.endTime || b.startTime)}
                      </span>
                      <span className="flex min-w-0 items-start gap-1.5 break-words">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span className="break-words">{b.venue?.address}</span>
                      </span>
                    </div>
                    {b.competition && (
                      <div className="mt-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-500/25 dark:bg-indigo-500/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-[12px] font-black text-indigo-800 dark:text-indigo-200">
                            <Swords className="h-3.5 w-3.5" />
                            {b.teamName || "Your squad"} vs {b.competition.opponentName}
                          </span>
                          <span
                            className={`rounded-full px-3 py-1 text-[11px] font-black ${
                              competitionDeclined
                                ? "bg-red-500/15 text-red-600 dark:text-red-300"
                                : b.competition.scoreStatus === "recorded"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                  : "bg-white text-indigo-700 dark:bg-white/10 dark:text-indigo-200"
                            }`}
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
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] font-semibold leading-relaxed text-indigo-700 dark:text-indigo-300">
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
                          {b.competition.leagueId ? (
                            <>
                              {" "}
                              <Link
                                href={`/leagues/${b.competition.leagueId}`}
                                className="font-black underline decoration-indigo-400/50 underline-offset-2"
                              >
                                Open the league
                              </Link>
                            </>
                          ) : null}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-black text-indigo-800 dark:text-indigo-200">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white/75 px-2.5 py-1.5 dark:border-indigo-400/25 dark:bg-white/10">
                            <Wallet className="h-3.5 w-3.5" />
                            {b.competition.paymentLabel ??
                              (b.competition.paymentMode === "loser_pays"
                                ? "Losing squad pays"
                                : "Fair split between both squads")}
                          </span>
                          {b.competition.paymentMode === "loser_pays" && (
                            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300">
                              The result decides who pays.
                            </span>
                          )}
                        </div>
                        {canDecideCompetition && (
                          <div className="mt-3 rounded-2xl border border-indigo-200 bg-white/80 p-3.5 shadow-sm dark:border-indigo-400/25 dark:bg-slate-950/45">
                            <p className="text-[11px] font-bold leading-relaxed text-indigo-700 dark:text-indigo-200">
                              Accept this fixture to release it to the venue owner. Declining keeps it out of the owner&apos;s actionable bookings.
                            </p>
                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <button
                                type="button"
                                onClick={() => void decideCompetition(b, "accept")}
                                disabled={competitionDecision === b.id}
                                aria-busy={competitionDecision === b.id}
                                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-55 dark:focus:ring-offset-slate-950"
                              >
                                {competitionDecision === b.id ? "Saving…" : "✓ Accept request"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void decideCompetition(b, "decline")}
                                disabled={competitionDecision === b.id}
                                aria-busy={competitionDecision === b.id}
                                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-xs font-black text-red-700 shadow-sm transition hover:border-red-400 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-55 dark:border-red-400/45 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20 dark:focus:ring-offset-slate-950"
                              >
                                {competitionDecision === b.id ? "Saving…" : "× Decline request"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {/*
                      Who's coming lives on the competition screen (/matches),
                      not here: a booking card is the player's own diary entry,
                      and once the game is played "who's coming" is a question
                      with no answer left.
                    */}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 dark:border-white/5">
                      <span className="rounded-full bg-stone-100 px-3 py-1.5 font-mono text-[11px] font-bold text-stone-500 dark:bg-white/10 dark:text-slate-400">
                        #FN-{b.id}
                      </span>
                      {isPublic ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1.5 text-[11px] font-black text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                          <Globe className="h-3.5 w-3.5" /> Open game
                        </span>
                      ) : b.competition ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-indigo-500/15 px-3 py-1.5 text-[11px] font-black text-indigo-700 dark:text-indigo-300">
                          <Swords className="h-3.5 w-3.5" /> Competition
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-500 dark:bg-white/10 dark:text-slate-400">
                          <Lock className="h-3.5 w-3.5" /> Just us
                        </span>
                      )}
                      {isPlayed ? (
                        <span
                          title="The game is over — this booking can't be changed any more"
                          className="flex items-center gap-1.5 rounded-full bg-stone-200 px-3 py-1.5 text-[11px] font-black text-stone-600 dark:bg-white/15 dark:text-slate-300"
                        >
                          <Lock className="h-3.5 w-3.5" /> Game played • locked
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-500 dark:bg-white/10 dark:text-slate-400">
                          <QrCode className="h-3.5 w-3.5" /> Show at court
                        </span>
                      )}
                      {b.teamName && (
                        <span className="flex items-center gap-1.5 rounded-full bg-sky-500/15 px-3 py-1.5 text-[11px] font-black text-sky-700 dark:text-sky-300">
                          <Shield className="h-3.5 w-3.5" /> {b.teamName}
                        </span>
                      )}
                      {b.isFreePlay && (
                        <span className="flex items-center gap-1.5 rounded-full bg-violet-500/15 px-3 py-1.5 text-[11px] font-black text-violet-700 dark:text-violet-300">
                          <Gift className="h-3.5 w-3.5" /> Free hour used 🎁
                        </span>
                      )}
                      {b.promoCode && b.discountAmount > 0 && (
                        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-[11px] font-black text-emerald-700 dark:text-emerald-300">
                          <Ticket className="h-3.5 w-3.5" /> {b.promoCode} saved {formatNPR(b.discountAmount)}
                        </span>
                      )}
                      {mine?.bookingId === b.id && (
                        <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1.5 text-[11px] font-black text-amber-700 dark:text-amber-300">
                          <Star className="h-3.5 w-3.5 fill-current" /> Reviewed
                        </span>
                      )}
                      {b.depositRequired && (
                        <span
                          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black ${
                            b.depositStatus === "paid"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                              : b.depositStatus === "forfeited"
                                ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                          }`}
                        >
                          🛡️ Deposit {formatNPR(b.depositAmount)} • {b.depositStatus === "paid" ? "paid ✓" : b.depositStatus}
                        </span>
                      )}
                      {b.paidAmount > 0 && (
                        <span className="flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1.5 text-[11px] font-black text-sky-700 dark:text-sky-300">
                          💰 {formatNPR(b.paidAmount)} verified{b.gatewayTxnId ? ` • ${b.gatewayTxnId.slice(0, 12)}` : ""}
                        </span>
                      )}
                      {needsOnlinePay(b) && (
                        <button
                          onClick={() => payNow(b)}
                          disabled={paying === b.id}
                          className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[11px] font-black text-white shadow transition disabled:opacity-50 ${
                            b.paymentMethod === "eSewa" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-purple-600 hover:bg-purple-700"
                          }`}
                        >
                          <Wallet className="h-3.5 w-3.5" />
                          {paying === b.id ? "Opening…" : `${payLabel(b)} using ${b.paymentMethod}`}
                        </button>
                      )}
                      {isOnlineMethod(b.paymentMethod) && !gone(b.status) && b.competition?.competitionStatus !== "pending" && (
                        b.receiptUrl ? (
                          <button
                            onClick={() => setViewReceipt(b.receiptUrl)}
                            className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300"
                          >
                            <ReceiptText className="h-3.5 w-3.5" /> Receipt ✓
                          </button>
                        ) : (
                          !isPlayed && (
                          <button
                            onClick={() => setUploadFor(uploadFor === b.id ? null : b.id)}
                            className="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1.5 text-[11px] font-black text-orange-700 transition hover:bg-orange-200 dark:bg-orange-500/15 dark:text-orange-300"
                          >
                            <ReceiptText className="h-3.5 w-3.5" /> Add receipt 🧾
                          </button>
                          )
                        )
                      )}
                      {tab === "upcoming" && !isPlayed && !b.competition?.isOpponentCaptain && (
                        <button
                          onClick={() => cancel(b)}
                          disabled={cancelling === b.id}
                          title="Free cancellation closes 6h before kickoff"
                          className="ml-auto flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-[11px] font-black text-red-500 transition hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          {cancelling === b.id ? "Cancelling…" : "Can't make it"}
                        </button>
                      )}
                      {reviewable(b) && (
                        <button
                          onClick={() => {
                            if (reviewFor === b.id) {
                              setReviewFor(null);
                              return;
                            }
                            // Updating starts from what I already wrote at this
                            // venue, so the old text isn't lost by accident.
                            setReviewStars(mine?.rating ?? 5);
                            setReviewMsg(mine?.message ?? "");
                            setReviewFor(b.id);
                            setReviewError("");
                          }}
                          className="flex items-center gap-1.5 rounded-full bg-amber-400 px-4 py-1.5 text-[11px] font-black text-amber-950 transition hover:bg-amber-300"
                        >
                          <Star className="h-3.5 w-3.5 fill-current" />
                          {reviewFor === b.id ? "Close" : mine ? "Update review ⭐" : "Review ⭐"}
                        </button>
                      )}
                    </div>
                    {reviewFor === b.id && (
                      <div className="mt-3 space-y-2.5 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/25 dark:bg-amber-500/5">
                        <p className="text-xs font-black text-stone-700 dark:text-slate-200">
                          {mine
                            ? `Update your review of ${b.venue?.name} — it replaces the old one, you keep just the one ⭐`
                            : `How was ${b.venue?.name}? ⭐`}
                        </p>
                        <StarInput value={reviewStars} onChange={setReviewStars} />
                        <textarea
                          value={reviewMsg}
                          onChange={(e) => {
                            setReviewMsg(e.target.value);
                            setReviewError("");
                          }}
                          rows={2}
                          maxLength={1000}
                          placeholder="Turf, vibe, staff… help future players! ⚽"
                          className="w-full resize-none rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm font-semibold placeholder:text-stone-400 focus:border-amber-400 focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:placeholder:text-slate-500"
                        />
                        <p className="text-[11px] text-stone-400">{reviewMsg.trim().length}/1000 • min 3 characters 💬</p>
                        {reviewError && (
                          <p className="text-[11px] font-bold text-red-500">{reviewError}</p>
                        )}
                        <button
                          onClick={() => submitReview(b)}
                          disabled={reviewSaving}
                          className="w-full rounded-2xl bg-amber-400 py-2.5 text-sm font-black text-amber-950 transition hover:bg-amber-300 disabled:opacity-50"
                        >
                          {reviewSaving ? "Saving…" : mine ? "Update review 💛" : "Post review 💛"}
                        </button>
                      </div>
                    )}
                    {uploadFor === b.id && (
                      <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-500/25 dark:bg-orange-500/5">
                        <p className="mb-2 text-[11px] font-bold text-stone-500 dark:text-slate-400">
                          Paid via {b.paymentMethod}? Attach your screenshot — it speeds up approval! ⚡
                        </p>
                        <ReceiptUploader
                          value=""
                          compact
                          onChange={(url) => url && saveReceipt(b.id, url)}
                        />
                        {uploading && (
                          <p className="mt-1.5 text-[11px] font-bold text-orange-600">Saving…</p>
                        )}
                      </div>
                    )}
                      </div>
                    </details>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
      {viewReceipt && (
        <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt(null)} />
      )}
    </main>
  );
}
