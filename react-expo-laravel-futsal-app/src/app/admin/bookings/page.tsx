"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, Check, X, ReceiptText, Gift, Ticket, Shield, Swords, Trophy } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { OwnerGuard } from "@/components/OwnerGuard";
import { ReceiptViewer } from "@/components/ReceiptUploader";
import { PlayerRatingBadge } from "@/components/PlayerRating";
import type { PlayerStats } from "@/lib/loyalty";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import { BookingLedgerPanel } from "@/components/BookingLedgerPanel";
import { SettleAmendButton } from "@/components/SettleAmendButton";
import { apiFetch } from "@/lib/api";

type Booking = {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  totalPrice: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  bookerName: string;
  bookerPhone: string;
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
  /**
   * When the owner marked this settled. Drives the correction window: the row
   * can be amended for `SETTLE_EDIT_WINDOW_MS` after this, then it locks.
   */
  settledAt: string | null;
  court?: { id: number; name: string };
  venue?: { id: number; name: string };
  user?: { name: string };
  playerStats?: PlayerStats;
  /** "private" | "public" | "competition" — see /api/bookings. */
  visibility: string;
  /**
   * Present on competition bookings: the two squads and the result the venue
   * owner is the only person allowed to write (PATCH with `actorId`).
   */
  competition: {
    opponentTeamId: number | null;
    opponentName: string;
    leagueId: number | null;
    leagueName: string;
    homeScore: number | null;
    awayScore: number | null;
    scoreStatus: string;
  } | null;
};

const FILTERS = ["all", "today", "pending", "confirmed", "completed", "cancelled", "rejected"];

export default function OwnerBookingsPage() {
  const { user } = useUser();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [venues, setVenues] = useState<Array<{ id: number; ownerId: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [viewReceipt, setViewReceipt] = useState<string | null>(null);
  const [scoreFor, setScoreFor] = useState<Booking | null>(null);
  const [homeInput, setHomeInput] = useState("");
  const [awayInput, setAwayInput] = useState("");
  const [savingScore, setSavingScore] = useState(false);
  const [scoreError, setScoreError] = useState("");
  /** Which booking's payment desk is open — see `BookingLedgerPanel`. */
  const [ledgerFor, setLedgerFor] = useState<Booking | null>(null);

  const load = async () => {
    const [bRes, vRes] = await Promise.all([
      apiFetch("/api/bookings"),
      apiFetch("/api/venues"),
    ]);
    const b = await bRes.json();
    const v = await vRes.json();
    setBookings(b.bookings ?? []);
    setVenues(v.venues ?? []);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const myVenueIds = useMemo(
    () => new Set(venues.filter((v) => user && v.ownerId === user.id).map((v) => v.id)),
    [venues, user]
  );

  const filtered = useMemo(() => {
    const mine = bookings.filter((b) => b.venue && myVenueIds.has(b.venue.id));
    if (filter === "all") return mine;
    if (filter === "today") {
      const t = new Date().toISOString().slice(0, 10);
      return mine.filter((b) => b.date === t);
    }
    return mine.filter((b) => b.status === filter);
  }, [bookings, myVenueIds, filter]);

  async function setStatus(id: number, status: string, actor: string = "owner") {
    await apiFetch(`/api/bookings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, actor }),
    });
    load();
  }

  function openScore(b: Booking) {
    setScoreFor(b);
    setHomeInput(b.competition?.homeScore === null || b.competition?.homeScore === undefined ? "" : String(b.competition.homeScore));
    setAwayInput(b.competition?.awayScore === null || b.competition?.awayScore === undefined ? "" : String(b.competition.awayScore));
    setScoreError("");
  }

  /**
   * Writes the final score of a competition game. `actorId` is the venue owner
   * — the server rejects anyone else, and refuses a half-filled result, so both
   * boxes are sent together (or both empty to clear a mistake).
   */
  async function saveScore() {
    if (!scoreFor || !user) return;
    const home = homeInput.trim();
    const away = awayInput.trim();
    if ((home === "") !== (away === "")) {
      setScoreError("Both scores or neither — a 1–? result isn't a result ⚽");
      return;
    }
    setSavingScore(true);
    setScoreError("");
    try {
      const res = await apiFetch(`/api/bookings/${scoreFor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeScore: home === "" ? "" : Number(home),
          awayScore: away === "" ? "" : Number(away),
          actorId: user.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the score");
      setScoreFor(null);
      load();
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : "Could not save the score");
    } finally {
      setSavingScore(false);
    }
  }

  const statusStyle = (s: string) =>
    s === "pending"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      : s === "confirmed"
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        : s === "completed"
          ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
          : "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400";

  return (
    <OwnerGuard>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <CalendarCheck className="h-6 w-6" /> All bookings
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Every booking across your venues — collect payments, complete games.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-[11px] font-black uppercase transition ${
              filter === f ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-white text-slate-500 shadow-sm hover:text-slate-900 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-4 h-64 animate-pulse rounded-2xl bg-white dark:bg-slate-900" />
      ) : filtered.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-bold text-slate-400 dark:text-slate-500">No bookings in this view.</p>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-500">
                  <th className="px-5 py-3 font-black">ID</th>
                  <th className="px-3 py-3 font-black">Player</th>
                  <th className="px-3 py-3 font-black">Venue / Court</th>
                  <th className="px-3 py-3 font-black">Slot</th>
                  <th className="px-3 py-3 font-black">Amount</th>
                  <th className="px-3 py-3 font-black">Payment</th>
                  <th className="px-3 py-3 font-black">Status</th>
                  <th className="px-5 py-3 text-right font-black">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtered.map((b) => (
                  <tr key={b.id} className="transition hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-3 font-mono font-bold">#FN-{b.id}</td>
                    <td className="px-3 py-3 font-bold">
                      {b.bookerName || b.user?.name}
                      {b.isFreePlay && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-black text-violet-700 dark:text-violet-300">
                          <Gift className="h-2.5 w-2.5" /> FREE
                        </span>
                      )}
                      {b.teamName && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-black text-sky-700 dark:text-sky-300">
                          <Shield className="h-2.5 w-2.5" /> {b.teamName}
                        </span>
                      )}
                      {b.competition && (
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-black text-indigo-700 dark:text-indigo-300">
                            <Swords className="h-2.5 w-2.5" /> vs {b.competition.opponentName || "opponent"}
                          </span>
                          {b.competition.leagueName && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-black text-amber-700 dark:text-amber-300">
                              <Trophy className="h-2.5 w-2.5" /> {b.competition.leagueName}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-black ${
                              b.competition.scoreStatus === "recorded"
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-slate-500/15 text-slate-600 dark:text-slate-300"
                            }`}
                          >
                            {b.competition.scoreStatus === "recorded"
                              ? `⚽ ${b.competition.homeScore}–${b.competition.awayScore}`
                              : "score due"}
                          </span>
                        </span>
                      )}
                      <span className="mt-1 block">
                        {b.playerStats && <PlayerRatingBadge stats={b.playerStats} size="sm" />}
                      </span>
                      <span className="block text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                        {b.bookerPhone}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-500 dark:text-slate-400">
                      <span className="block font-bold text-slate-900 dark:text-slate-100">{b.venue?.name}</span>
                      {b.court?.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-500 dark:text-slate-400">
                      {prettyDate(b.date)}
                      <span className="block text-xs">
                        {formatTime12(b.startTime)} – {formatTime12(b.endTime || b.startTime)}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-black">
                      {b.discountAmount > 0 && b.priceBeforeDiscount > b.totalPrice && (
                        <span className="block text-[11px] font-bold text-slate-400 line-through dark:text-slate-500">
                          {formatNPR(b.priceBeforeDiscount)}
                        </span>
                      )}
                      {formatNPR(b.totalPrice)}
                      <span className="block text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                        {b.paymentMethod}
                      </span>
                      {b.promoCode && b.discountAmount > 0 && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:text-emerald-300">
                          <Ticket className="h-3 w-3" /> {b.promoCode} −{formatNPR(b.discountAmount)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {b.paymentStatus === "paid" ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                          PAID ✓ {b.gatewayTxnId ? `• ${b.gatewayTxnId.slice(0, 10)}` : ""}
                        </span>
                      ) : b.paymentStatus === "deposit_paid" ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          🛡️ DEPOSIT {formatNPR(b.depositAmount)} ✓
                        </span>
                      ) : (
                        // Not a one-click "paid" any more: a game is usually
                        // settled in parts (some eSewa, some Khalti, some cash)
                        // and the extras land during the match, so this opens
                        // the ledger where each instalment is recorded.
                        <button
                          onClick={() => setLedgerFor(b)}
                          title="Record payments and extra charges"
                          className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-700 transition hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25"
                        >
                          💰 Collect
                        </button>
                      )}
                      {b.depositRequired && (
                        <span className="mt-1 block text-[10px] font-bold text-slate-400">
                          Deposit {b.depositStatus}
                          {b.paidAmount > 0 ? ` • ${formatNPR(b.paidAmount)} in` : ""}
                        </span>
                      )}
                      {b.receiptUrl && (
                        <button
                          onClick={() => setViewReceipt(b.receiptUrl)}
                          title="View payment receipt"
                          className="mt-1.5 flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-black text-sky-700 transition hover:bg-sky-500/25 dark:text-sky-300"
                        >
                          <ReceiptText className="h-3.5 w-3.5" /> Receipt
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${statusStyle(b.status)}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        {/* Amending a settled game must not require opening the
                            payment desk first: the owner needs to see from the
                            list, at a glance, which ones are still fixable and
                            how long is left. The countdown owns its own clock
                            so ticking it doesn't re-render the whole table. */}
                        <SettleAmendButton
                          settledAt={b.settledAt}
                          onOpen={() => setLedgerFor(b)}
                        />
                        {b.status === "pending" && (
                          <>
                            <button
                              onClick={() => setStatus(b.id, "confirmed")}
                              title="Accept"
                              className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setStatus(b.id, "rejected")}
                              title="Decline"
                              className="grid h-8 w-8 place-items-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/25"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {b.competition && (
                          <button
                            onClick={() => openScore(b)}
                            title={
                              b.competition.scoreStatus === "recorded"
                                ? "Fix the recorded score"
                                : "Record the final score"
                            }
                            className={`grid h-8 w-8 place-items-center rounded-full text-white transition ${
                              b.competition.scoreStatus === "recorded"
                                ? "bg-emerald-500 hover:bg-emerald-600"
                                : "bg-indigo-500 hover:bg-indigo-600"
                            }`}
                          >
                            <Swords className="h-4 w-4" />
                          </button>
                        )}
                        {b.status === "confirmed" && (
                          <button
                            onClick={() => setStatus(b.id, "completed")}
                            title="Complete"
                            className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        {(b.status === "confirmed" || b.status === "pending") && (
                          <button
                            onClick={() => setStatus(b.id, "cancelled")}
                            title="Cancel"
                            className="grid h-8 w-8 place-items-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/25"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {viewReceipt && (
        <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt(null)} />
      )}

      {/* Score desk — competition games only, venue owner only. */}
      {scoreFor && scoreFor.competition && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-slate-100">
              <Swords className="h-5 w-5 text-indigo-500" /> Record the final score
            </h3>
            <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {scoreFor.teamName || "Home squad"} vs {scoreFor.competition.opponentName || "opponent"} •{" "}
              {prettyDate(scoreFor.date)} {formatTime12(scoreFor.startTime)}
              {scoreFor.competition.leagueName ? ` • 🏆 ${scoreFor.competition.leagueName}` : ""}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">
                  🏠 {scoreFor.teamName || "Home"}
                </span>
                <input
                  value={homeInput}
                  onChange={(e) => setHomeInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                  inputMode="numeric"
                  placeholder="—"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-center text-2xl font-black text-slate-900 focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">
                  🚩 {scoreFor.competition.opponentName || "Away"}
                </span>
                <input
                  value={awayInput}
                  onChange={(e) => setAwayInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                  inputMode="numeric"
                  placeholder="—"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-center text-2xl font-black text-slate-900 focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
            </div>
            <p className="mt-3 rounded-xl bg-indigo-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
              Both squads&apos; profiles update the moment you save
              {scoreFor.competition.leagueName ? ", and the league table follows" : ""}. Wrong
              score? Reopen this and fix it — clearing both boxes puts it back to &quot;awaiting&quot;.
            </p>
            {scoreError && (
              <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {scoreError}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setScoreFor(null)}
                className="rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={saveScore}
                disabled={savingScore}
                className="rounded-xl bg-indigo-600 py-3 text-sm font-black text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingScore ? "Saving…" : "Save result"}
              </button>
            </div>
          </div>
        </div>
      )}

      {ledgerFor && (
        <BookingLedgerPanel
          bookingId={ledgerFor.id}
          bookingLabel={`${prettyDate(ledgerFor.date)} • ${formatTime12(ledgerFor.startTime)} • ${
            ledgerFor.venue?.name ?? "Venue"
          } • ${formatNPR(ledgerFor.totalPrice)}`}
          ownerId={user?.id ?? 0}
          onClose={() => setLedgerFor(null)}
          onSettled={load}
        />
      )}
    </OwnerGuard>
  );
}
