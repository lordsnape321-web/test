"use client";

import { useEffect, useMemo, useState } from "react";
import { Inbox, Check, X, Phone, Globe, Lock, Wallet, ReceiptText, Gift, Ticket, Shield, Swords } from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { OwnerGuard } from "@/components/OwnerGuard";
import { ReceiptViewer } from "@/components/ReceiptUploader";
import { PlayerRatingBadge } from "@/components/PlayerRating";
import type { PlayerStats } from "@/lib/loyalty";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import { apiFetch } from "@/lib/api";

type Booking = {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  bookerName: string;
  bookerPhone: string;
  notes: string;
  visibility: string;
  playersNeeded: number;
  ourCrew: number;
  openSpots: number;
  /** Squad this booking was made for; "" = individual booking. */
  teamId: number | null;
  teamName: string;
  advancePaymentRequired: boolean;
  advancePaymentAmount: number;
  advancePaymentStatus: string;
  /** Competition games carry the opponent and the score the owner will write. */
  competition?: {
    opponentName: string;
    leagueName: string;
    homeScore: number | null;
    awayScore: number | null;
    scoreStatus: string;
    scoreUpdatedAt?: string | null;
    competitionStatus?: string;
  } | null;
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
  createdAt: string | null;
  court?: { id: number; name: string; format: string };
  venue?: { id: number; name: string; imageUrl: string };
  playerStats?: PlayerStats;
};

export default function OwnerRequestsPage() {
  const { user } = useUser();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [venues, setVenues] = useState<Array<{ id: number; ownerId: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const [viewReceipt, setViewReceipt] = useState<string | null>(null);
  const [advanceChoice, setAdvanceChoice] = useState<Record<number, "none" | "full" | "custom">>({});
  const [advanceCustom, setAdvanceCustom] = useState<Record<number, string>>({});
  const [advanceSaving, setAdvanceSaving] = useState<number | null>(null);

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
  const mine = useMemo(
    () => bookings.filter((b) => b.venue && myVenueIds.has(b.venue.id)),
    [bookings, myVenueIds]
  );
  // A competition row stays out of the owner queue while the opposition
  // captain's durable consent is pending. Legacy competition rows have no
  // competitionStatus and retain their existing owner workflow.
  const releasedToOwner = (b: Booking) =>
    b.visibility !== "competition" ||
    b.competition?.competitionStatus === "accepted" ||
    !b.competition?.competitionStatus ||
    b.competition.competitionStatus === "none";
  const visibleToOwner = mine.filter(releasedToOwner);
  const pending = visibleToOwner.filter((b) => b.status === "pending");
  const decided = visibleToOwner.filter((b) => b.status === "confirmed" || b.status === "rejected");
  const list = tab === "pending" ? pending : decided;

  async function decide(id: number, ok: boolean) {
    if (!ok && !confirm("Decline this booking request? The player will be notified.")) return;
    setActing(id);
    try {
      const res = await apiFetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: ok ? "confirmed" : "rejected", actor: "owner", actorId: user?.id }),
      });
      if (!res.ok) throw new Error("failed");
      await load();
    } catch {
      alert("Something went wrong. Try again.");
    } finally {
      setActing(null);
    }
  }

  function choiceFor(b: Booking) {
    if (advanceChoice[b.id]) return advanceChoice[b.id];
    if (!b.advancePaymentRequired) return "none" as const;
    return b.advancePaymentAmount === b.totalPrice ? "full" as const : "custom" as const;
  }

  async function saveAdvance(b: Booking) {
    if (!user) return;
    const choice = choiceFor(b);
    const amount = choice === "custom" ? Number(advanceCustom[b.id] ?? b.advancePaymentAmount ?? 0) : undefined;
    setAdvanceSaving(b.id);
    try {
      const res = await apiFetch(`/api/bookings/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advancePayment: choice,
          ...(amount !== undefined ? { advancePaymentAmount: amount } : {}),
          actor: "owner",
          actorId: user.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save advance request");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't save advance request");
    } finally {
      setAdvanceSaving(null);
    }
  }

  return (
    <OwnerGuard>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <Inbox className="h-6 w-6" /> Booking requests
            {pending.length > 0 && (
              <span className="rounded-full bg-orange-500 px-2.5 py-1 text-xs font-black text-white">
                {pending.length} waiting
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Accept to confirm the slot (public match goes live) or decline to free it up.
          </p>
        </div>
        <div className="flex gap-2 rounded-xl bg-white p-1 shadow-sm dark:bg-slate-900">
          {(["pending", "decided"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-2 text-xs font-black uppercase tracking-wide transition ${
                tab === t ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {t === "pending" ? `Pending (${pending.length})` : `Decided (${decided.length})`}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-5 space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl bg-white dark:bg-slate-900" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <Inbox className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-3 text-lg font-extrabold">
            {tab === "pending" ? "Inbox zero 🎉" : "Nothing decided yet"}
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {tab === "pending"
              ? "When players book your courts, requests land here for approval."
              : "Accepted and declined requests will show up here."}
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {list.map((b) => (
            <div
              key={b.id}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                <img
                  src={b.venue?.imageUrl}
                  alt=""
                  className="h-28 w-full rounded-xl object-cover sm:h-24 sm:w-36 sm:shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-400 dark:text-slate-500">#FN-{b.id}</span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                        b.status === "pending"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                          : b.status === "confirmed"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
                      }`}
                    >
                      {b.status}
                    </span>
                    {b.competition ? (
                      <span className="flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-black text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                        <Swords className="h-3 w-3" /> Competition • you score it
                      </span>
                    ) : b.visibility === "public" ? (
                      <span className="flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-black text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                        <Globe className="h-3 w-3" /> Public • 👥{b.ourCrew ?? 0} + 🙋{b.openSpots ?? 0}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <Lock className="h-3 w-3" /> Private
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1.5 flex flex-wrap items-center gap-2 truncate text-base font-extrabold">
                    {b.bookerName || "Player"} — {b.venue?.name}
                    {b.playerStats && <PlayerRatingBadge stats={b.playerStats} size="sm" />}
                    {b.isFreePlay && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-black text-violet-700 dark:text-violet-300">
                        <Gift className="h-3 w-3" /> FREE HOUR 🎁
                      </span>
                    )}
                    {b.promoCode && b.discountAmount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:text-emerald-300">
                        <Ticket className="h-3 w-3" /> {b.promoCode} −{formatNPR(b.discountAmount)}
                      </span>
                    )}
                    {b.teamName && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-black text-sky-700 dark:text-sky-300">
                        <Shield className="h-3 w-3" /> {b.teamName}
                      </span>
                    )}
                    {b.competition && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-black text-indigo-700 dark:text-indigo-300">
                        🆚 vs {b.competition.opponentName || "opponent"}
                        {b.competition.leagueName ? ` • 🏆 ${b.competition.leagueName}` : ""}
                        {b.competition.scoreStatus === "recorded"
                          ? ` • ⚽ ${b.competition.homeScore}–${b.competition.awayScore}`
                          : " • score due"}
                      </span>
                    )}
                    {b.advancePaymentRequired && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-black text-sky-700 dark:text-sky-300">
                        💳 Advance {formatNPR(b.advancePaymentAmount)} • {b.advancePaymentStatus}
                      </span>
                    )}
                    {b.depositRequired && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${
                          b.depositStatus === "paid"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : b.depositStatus === "forfeited"
                              ? "bg-red-500/15 text-red-600 dark:text-red-400"
                              : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        🛡️ {formatNPR(b.depositAmount)} • {b.depositStatus}
                      </span>
                    )}
                    {(b.paymentStatus === "paid" || b.paymentStatus === "deposit_paid") && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-black text-sky-700 dark:text-sky-300">
                        ✓ {b.paymentMethod} verified{b.gatewayTxnId ? ` • ${b.gatewayTxnId.slice(0, 12)}` : ""}
                      </span>
                    )}
                  </h3>
                  {b.playerStats && (
                    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5 dark:border-violet-500/25 dark:bg-violet-500/10">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">Player trust profile</p>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-violet-900 dark:text-violet-100">
                        <span>{b.playerStats.rating.toFixed(1)}★ {b.playerStats.label}</span>
                        <span>⚽ {b.playerStats.completed} games played</span>
                        <span>↩ {b.playerStats.cancelled} cancellations all time</span>
                        <span>↩ {b.playerStats.cancelsThisMonth} this month</span>
                        <span>{b.playerStats.trustEmoji} Trust {b.playerStats.trustScore}/100 • {b.playerStats.trustLabel}</span>
                      </div>
                      <p className="mt-1 text-[10px] font-semibold text-violet-700/80 dark:text-violet-200/80">
                        {b.depositRequired ? `Fair-play deposit applies: ${formatNPR(b.depositAmount)} due (${b.playerStats.depositReason || "trust/deposit safeguard"}).` : "No automatic fair-play deposit is currently required."}
                      </p>
                    </div>
                  )}
                  <p className="mt-0.5 text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                    {b.court?.name} ({b.court?.format}) • {prettyDate(b.date)} •{" "}
                    {formatTime12(b.startTime)} – {formatTime12(b.endTime || b.startTime)} •{" "}
                    {b.durationHours} hr
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5" /> {b.bookerPhone || "—"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Wallet className="h-3.5 w-3.5" /> {b.paymentMethod} • {b.paymentStatus}
                    </span>
                    {b.receiptUrl ? (
                      <button
                        onClick={() => setViewReceipt(b.receiptUrl)}
                        className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-500/25 dark:text-emerald-300"
                      >
                        <ReceiptText className="h-3.5 w-3.5" /> View receipt 🧾
                      </button>
                    ) : (
                      b.paymentMethod !== "Cash at Venue" && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                          No receipt yet
                        </span>
                      )
                    )}
                    {b.notes && <span className="italic">“{b.notes}”</span>}
                  </div>
                  {tab === "pending" && b.status === "pending" && (
                    <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-500/25 dark:bg-sky-500/10">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-black text-sky-900 dark:text-sky-100">Request an advance</p>
                          <p className="mt-0.5 text-[11px] font-semibold text-sky-800/80 dark:text-sky-200/80">Separate from any automatic fair-play deposit. The player will be notified and must pay through the verified gateway.</p>
                        </div>
                        {b.advancePaymentRequired && <span className="rounded-full bg-sky-600 px-2.5 py-1 text-[10px] font-black text-white">{b.advancePaymentStatus} • {formatNPR(b.advancePaymentAmount)}</span>}
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                        {(["none", "full", "custom"] as const).map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            onClick={() => setAdvanceChoice((current) => ({ ...current, [b.id]: choice }))}
                            className={`rounded-xl border px-3 py-2 text-[11px] font-black ${choiceFor(b) === choice ? "border-sky-600 bg-sky-600 text-white" : "border-sky-200 bg-white text-sky-800 dark:border-white/10 dark:bg-slate-900 dark:text-sky-100"}`}
                          >
                            {choice === "none" ? "No advance" : choice === "full" ? `Full ${formatNPR(b.totalPrice)}` : "Custom amount"}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => void saveAdvance(b)}
                          disabled={advanceSaving === b.id}
                          className="rounded-xl bg-sky-700 px-3 py-2 text-[11px] font-black text-white disabled:opacity-50"
                        >
                          {advanceSaving === b.id ? "Saving…" : b.advancePaymentRequired ? "Update request" : "Save request"}
                        </button>
                      </div>
                      {choiceFor(b) === "custom" && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs font-black text-sky-900 dark:text-sky-100">Rs.</span>
                          <input
                            type="number"
                            min={1}
                            max={b.totalPrice}
                            value={advanceCustom[b.id] ?? (b.advancePaymentRequired && b.advancePaymentAmount < b.totalPrice ? b.advancePaymentAmount : "")}
                            onChange={(event) => setAdvanceCustom((current) => ({ ...current, [b.id]: event.target.value }))}
                            placeholder={`1–${b.totalPrice}`}
                            className="w-32 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-black text-sky-900 outline-none focus:border-sky-500 dark:border-white/10 dark:bg-slate-900 dark:text-sky-100"
                          />
                          <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-200">Maximum {formatNPR(b.totalPrice)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                  <p className="text-right text-xl font-black">
                    {b.discountAmount > 0 && b.priceBeforeDiscount > b.totalPrice && (
                      <span className="mr-1.5 text-xs font-bold text-slate-400 line-through dark:text-slate-500">
                        {formatNPR(b.priceBeforeDiscount)}
                      </span>
                    )}
                    {formatNPR(b.totalPrice)}
                  </p>
                  {tab === "pending" ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => decide(b.id, true)}
                        disabled={acting === b.id}
                        className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-white transition hover:bg-emerald-600 disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" strokeWidth={3} />
                        {acting === b.id ? "…" : "Accept"}
                      </button>
                      <button
                        onClick={() => decide(b.id, false)}
                        disabled={acting === b.id}
                        className="flex items-center gap-1.5 rounded-xl bg-red-100 px-4 py-2.5 text-xs font-black text-red-600 transition hover:bg-red-200 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/25"
                      >
                        <X className="h-4 w-4" strokeWidth={3} /> Decline
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs font-bold text-slate-400 dark:text-slate-500">
                      {b.createdAt ? new Date(b.createdAt).toLocaleDateString() : ""}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {viewReceipt && (
        <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt(null)} />
      )}
    </OwnerGuard>
  );
}
