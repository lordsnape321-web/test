"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck, MapPin, Clock, XCircle, QrCode, Wallet, LogIn, Lock, Globe, ArrowRight, Hourglass, PartyPopper, ReceiptText, Star, Gift, Ticket, Shield, Swords } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { ReceiptUploader, ReceiptViewer, isOnlineMethod } from "@/components/ReceiptUploader";
import { StarInput } from "@/components/Reviews";
import { PlayerRatingBadge } from "@/components/PlayerRating";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import { hoursUntilGame, type PlayerStats } from "@/lib/loyalty";
import { validateMessage } from "@/lib/validation";

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
  /** Present on competition bookings — who we played and the score so far. */
  competition: {
    opponentTeamId: number | null;
    opponentName: string;
    leagueId: number | null;
    leagueName: string;
    homeScore: number | null;
    awayScore: number | null;
    scoreStatus: string;
  } | null;
  linkedMatch: {
    id: number;
    title: string;
    status: string;
    joinedCount: number;
    otherJoined: number;
    crewSize: number;
    maxPlayers: number;
    spotsLeft: number;
  } | null;
  court?: { name: string; format: string };
  venue?: { id: number; name: string; address: string; imageUrl: string };
  playerStats?: PlayerStats;
};

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
  const [reviewedIds, setReviewedIds] = useState<Set<number>>(new Set());
  const [cancelError, setCancelError] = useState("");
  const [paying, setPaying] = useState<number | null>(null);
  const [payError, setPayError] = useState("");

  const load = async (uid: number) => {
    const res = await fetch(`/api/bookings?userId=${uid}`);
    const data = await res.json();
    setBookings(data.bookings ?? []);
    try {
      const rRes = await fetch(`/api/reviews?userId=${uid}`);
      const rData = await rRes.json();
      setReviewedIds(new Set(((rData.reviews ?? []) as Array<{ bookingId: number | null }>).map((r) => r.bookingId).filter(Boolean) as number[]));
    } catch {}
  };

  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/seed", { method: "POST" });
        if (user) await load(user.id);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const today = new Date().toISOString().slice(0, 10);
  const gone = (s: string) => s === "cancelled" || s === "rejected";

  const filtered = useMemo(() => {
    if (tab === "cancelled") return bookings.filter((b) => gone(b.status));
    if (tab === "past")
      return bookings.filter((b) => !gone(b.status) && b.date < today);
    return bookings.filter((b) => !gone(b.status) && b.date >= today);
  }, [bookings, tab, today]);

  const pendingCount = bookings.filter((b) => b.status === "pending" && b.date >= today).length;
  const totalSpent = bookings
    .filter((b) => !gone(b.status))
    .reduce((s, b) => s + b.totalPrice, 0);

  async function saveReceipt(id: number, receiptUrl: string) {
    setUploading(true);
    try {
      await fetch(`/api/bookings/${id}`, {
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
        const init = await fetch("/api/payments/esewa/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: b.id }),
        });
        const jd = await init.json();
        if (!init.ok) throw new Error(jd.error || "eSewa init failed");
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
        const init = await fetch("/api/payments/khalti/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: b.id }),
        });
        const jd = await init.json();
        if (!init.ok) throw new Error(jd.error || "Khalti init failed");
        window.location.href = jd.payment_url;
        return;
      }
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Payment failed");
      setPaying(null);
    }
  }

  function needsOnlinePay(b: Booking) {
    if (gone(b.status)) return false;
    if (b.isFreePlay && b.totalPrice === 0) return false;
    if (b.paymentMethod !== "eSewa" && b.paymentMethod !== "Khalti") return false;
    return b.paymentStatus === "pending" || (b.depositRequired && b.depositStatus === "pending");
  }

  function payLabel(b: Booking) {
    if (b.depositRequired && b.depositStatus !== "paid") {
      return `Pay ${formatNPR(b.depositAmount)} deposit 🛡️`;
    }
    return `Pay ${formatNPR(b.totalPrice)} now 💳`;
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
      const res = await fetch("/api/reviews", {
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

  function reviewable(b: Booking) {
    if (gone(b.status)) return false;
    if (reviewedIds.has(b.id)) return false;
    if (b.status === "completed") return true;
    if (b.status !== "confirmed") return false;
    if (b.date < today) return true;
    if (b.date === today) {
      try {
        return new Date() > new Date(`${b.date}T${b.endTime || b.startTime}:00`);
      } catch {
        return false;
      }
    }
    return false;
  }

  async function cancel(b: Booking) {
    if (!confirm("Cancel this booking? The venue will be told straight away — and it dings your reliability stars ⭐.")) return;
    setCancelling(b.id);
    setCancelError("");
    try {
      const res = await fetch(`/api/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled", actor: "player" }),
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

  const statusBadge = (s: string) =>
    s === "pending"
      ? "bg-amber-400 text-amber-950"
      : s === "cancelled" || s === "rejected"
        ? "bg-red-500 text-white"
        : s === "completed"
          ? "bg-white text-stone-700 dark:bg-white/10 dark:text-stone-200"
          : "bg-emerald-500 text-white";

  if (!authLoading && !user) {
    return (
      <main className="turf-pattern grid min-h-screen place-items-center px-4 py-12">
        <div className="w-full max-w-md rounded-[2rem] border border-[#F0E3CC] bg-white p-8 text-center shadow-lg dark:border-white/10 dark:bg-stone-900">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-600 shadow-md">
            <CalendarCheck className="h-8 w-8 text-white" />
          </span>
          <h1 className="mt-4 text-2xl font-black text-stone-900 dark:text-stone-100">Your games live here ⚽</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
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
              className="rounded-2xl border border-stone-200 py-3 text-sm font-black text-stone-700 dark:border-white/10 dark:text-stone-200"
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
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-orange-500 dark:text-orange-400">
          <PartyPopper className="h-3.5 w-3.5" /> {user?.name?.split(" ")[0]}&apos;s game diary
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black text-stone-900 dark:text-stone-100">My games</h1>
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
              {pendingCount} game{pendingCount > 1 ? "s" : ""} waiting for a friendly
              thumbs-up from the venue — we&apos;ll ping you the moment they confirm!
            </p>
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { l: "Coming up", v: bookings.filter((b) => !gone(b.status) && b.date >= today).length },
            { l: "Memories made", v: bookings.filter((b) => !gone(b.status) && b.date < today).length },
            { l: "Invested in fun", v: formatNPR(totalSpent) },
          ].map((s) => (
            <div key={s.l} className="rounded-2xl border border-[#F0E3CC] bg-white px-3 py-3.5 text-center shadow-sm dark:border-white/10 dark:bg-stone-900">
              <p className="truncate text-lg font-black text-stone-900 sm:text-xl dark:text-stone-100">{s.v}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-500">{s.l}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          {(["upcoming", "past", "cancelled"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-2xl py-2.5 text-xs font-black uppercase tracking-wider transition sm:flex-none sm:px-6 ${
                tab === t ? "bg-emerald-600 text-white shadow-md" : "border border-stone-200 bg-white text-stone-600 shadow-sm dark:border-white/10 dark:bg-stone-900 dark:text-stone-300"
              }`}
            >
              {t === "upcoming" ? "Coming up" : t === "past" ? "Played" : "Cancelled"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-5 space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-3xl bg-white dark:bg-stone-900" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-stone-300 bg-white p-12 text-center dark:border-white/20 dark:bg-stone-900">
            <CalendarCheck className="mx-auto h-10 w-10 text-stone-300 dark:text-stone-600" />
            <h3 className="mt-3 text-lg font-extrabold text-stone-900 dark:text-stone-100">
              {tab === "upcoming" ? "No games yet — let's fix that! ⚽" : "Nothing here yet"}
            </h3>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
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
              return (
              <div
                key={b.id}
                className="overflow-hidden rounded-3xl border border-[#F0E3CC] bg-white shadow-[0_10px_30px_rgba(180,120,60,0.08)] dark:border-white/10 dark:bg-stone-900"
              >
                <div className="flex flex-col sm:flex-row">
                  <div className="relative h-36 sm:h-auto sm:w-52 sm:shrink-0">
                    <img
                      src={b.venue?.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <span
                      className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-black uppercase shadow ${statusBadge(b.status)}`}
                    >
                      {b.status === "pending" ? "⏳ Waiting for venue" : b.status === "confirmed" ? "✓ You're in!" : b.status}
                    </span>
                  </div>
                  <div className="flex-1 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-extrabold text-stone-900 dark:text-stone-100">{b.venue?.name}</h3>
                        <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                          {b.court?.name} • {b.court?.format}
                        </p>
                      </div>
                      <span className="text-right">
                        {b.discountAmount > 0 && b.priceBeforeDiscount > b.totalPrice && (
                          <span className="block text-xs font-bold text-stone-400 line-through dark:text-stone-500">
                            {formatNPR(b.priceBeforeDiscount)}
                          </span>
                        )}
                        <span className="block text-lg font-black text-emerald-700 dark:text-emerald-300">
                          {b.totalPrice === 0 ? "FREE 🎁" : formatNPR(b.totalPrice)}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] font-bold text-stone-400 dark:text-stone-500">
                          <Wallet className="h-3 w-3" /> {b.paymentMethod} • {b.paymentStatus}
                        </span>
                      </span>
                    </div>
                    {isPending && (
                      <p className="mt-2.5 rounded-xl bg-amber-50 px-3.5 py-2 text-xs font-bold leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                        Your request is with the venue — lovely humans are reviewing it
                        now. We&apos;ll let you know right away! 💛
                      </p>
                    )}
                    {b.status === "rejected" && (
                      <p className="mt-2.5 rounded-xl bg-red-50 px-3.5 py-2 text-xs font-bold leading-relaxed text-red-500 dark:bg-red-500/10 dark:text-red-400">
                        Oh no — the venue was fully packed for this slot. Pick another
                        time, we believe in you! 🙏
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] font-semibold text-stone-600 dark:text-stone-300">
                      <span className="flex items-center gap-1.5">
                        <CalendarCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> {prettyDate(b.date)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        {formatTime12(b.startTime)} – {formatTime12(b.endTime || b.startTime)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> {b.venue?.address}
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
                              b.competition.scoreStatus === "recorded"
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-white text-indigo-700 dark:bg-white/10 dark:text-indigo-200"
                            }`}
                          >
                            {b.competition.scoreStatus === "recorded"
                              ? `⚽ ${b.competition.homeScore}–${b.competition.awayScore}`
                              : "score pending"}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] font-semibold leading-relaxed text-indigo-700 dark:text-indigo-300">
                          {b.competition.scoreStatus === "recorded"
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
                      </div>
                    )}
                    {isPublic && b.linkedMatch && !gone(b.status) && (
                      <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/25 dark:bg-emerald-500/10">
                        <div className="flex items-center justify-between text-[11px] font-bold">
                          <span className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-200">
                            <Globe className="h-3.5 w-3.5" />
                            {b.linkedMatch.status === "open" ? (
                              <>👥 {b.linkedMatch.crewSize} crew • 🙋 {b.linkedMatch.otherJoined} joined • {b.linkedMatch.spotsLeft} open 🎉</>
                            ) : (
                              <>Invite for 👥 {b.ourCrew} + 🙋 {b.openSpots} goes out once confirmed ⌛</>
                            )}
                          </span>
                          {b.linkedMatch.status === "open" && (
                            <Link
                              href="/matches"
                              className="flex items-center gap-1 font-black text-emerald-700 hover:text-emerald-800 dark:text-emerald-300"
                            >
                              See who&apos;s coming <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          )}
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white dark:bg-white/10">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-orange-400"
                            style={{
                              width: `${Math.round((b.linkedMatch.joinedCount / Math.max(1, b.linkedMatch.maxPlayers)) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 dark:border-white/5">
                      <span className="rounded-full bg-stone-100 px-3 py-1.5 font-mono text-[11px] font-bold text-stone-500 dark:bg-white/10 dark:text-stone-400">
                        #FN-{b.id}
                      </span>
                      {isPublic ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1.5 text-[11px] font-black text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                          <Globe className="h-3.5 w-3.5" /> Open • 👥{b.ourCrew ?? 0}+🙋{b.openSpots ?? 0}
                        </span>
                      ) : b.competition ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-indigo-500/15 px-3 py-1.5 text-[11px] font-black text-indigo-700 dark:text-indigo-300">
                          <Swords className="h-3.5 w-3.5" /> Competition
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-500 dark:bg-white/10 dark:text-stone-400">
                          <Lock className="h-3.5 w-3.5" /> Just us
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-500 dark:bg-white/10 dark:text-stone-400">
                        <QrCode className="h-3.5 w-3.5" /> Show at court
                      </span>
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
                      {reviewedIds.has(b.id) && (
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
                          {paying === b.id ? "Opening…" : `${payLabel(b)} via ${b.paymentMethod} (Test)`}
                        </button>
                      )}
                      {isOnlineMethod(b.paymentMethod) && !gone(b.status) && (
                        b.receiptUrl ? (
                          <button
                            onClick={() => setViewReceipt(b.receiptUrl)}
                            className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300"
                          >
                            <ReceiptText className="h-3.5 w-3.5" /> Receipt ✓
                          </button>
                        ) : (
                          <button
                            onClick={() => setUploadFor(uploadFor === b.id ? null : b.id)}
                            className="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1.5 text-[11px] font-black text-orange-700 transition hover:bg-orange-200 dark:bg-orange-500/15 dark:text-orange-300"
                          >
                            <ReceiptText className="h-3.5 w-3.5" /> Add receipt 🧾
                          </button>
                        )
                      )}
                      {tab === "upcoming" && (
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
                            setReviewFor(reviewFor === b.id ? null : b.id);
                            setReviewError("");
                          }}
                          className="flex items-center gap-1.5 rounded-full bg-amber-400 px-4 py-1.5 text-[11px] font-black text-amber-950 transition hover:bg-amber-300"
                        >
                          <Star className="h-3.5 w-3.5 fill-current" />
                          {reviewFor === b.id ? "Close" : "Review ⭐"}
                        </button>
                      )}
                    </div>
                    {reviewFor === b.id && (
                      <div className="mt-3 space-y-2.5 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/25 dark:bg-amber-500/5">
                        <p className="text-xs font-black text-stone-700 dark:text-stone-200">
                          How was {b.venue?.name}? ⭐
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
                          className="w-full resize-none rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm font-semibold placeholder:text-stone-400 focus:border-amber-400 focus:outline-none dark:border-white/10 dark:bg-stone-950 dark:placeholder:text-stone-500"
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
                          {reviewSaving ? "Posting…" : "Post review 💛"}
                        </button>
                      </div>
                    )}
                    {uploadFor === b.id && (
                      <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-500/25 dark:bg-orange-500/5">
                        <p className="mb-2 text-[11px] font-bold text-stone-500 dark:text-stone-400">
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
