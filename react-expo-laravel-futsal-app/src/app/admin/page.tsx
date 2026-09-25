"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Banknote,
  CalendarCheck,
  Building2,
  Inbox,
  ArrowRight,
  Check,
  X,
  Clock,
  Trophy,
  Swords,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { OwnerGuard } from "@/components/OwnerGuard";
import {
  RevenueRainbow,
  BookingDonut,
  PaymentParty,
  PeakHours,
} from "@/components/OwnerCharts";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import { apiFetch } from "@/lib/api";

type Venue = {
  id: number;
  name: string;
  ownerId: number | null;
  courts: Array<{ id: number; isActive: boolean; pricePerHour: number }>;
  courtCount: number;
  imageUrl: string;
};

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
  visibility: string;
  court?: { id: number; name: string };
  venue?: { id: number; name: string };
  /** Present on competition bookings — the venue owner writes the score. */
  competition?: {
    opponentName: string;
    leagueName: string;
    homeScore: number | null;
    awayScore: number | null;
    scoreStatus: string;
    competitionStatus?: string;
  } | null;
};

export default function OwnerOverviewPage() {
  const { user } = useUser();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  /** Competition games at this owner's grounds that still need the final score. */
  const awaitingScores = useMemo(
    () =>
      bookings.filter(
        (b) =>
          b.visibility === "competition" &&
          b.competition &&
          b.competition.competitionStatus !== "pending" &&
          b.competition.competitionStatus !== "declined" &&
          b.competition.competitionStatus !== "cancelled" &&
          b.competition.scoreStatus !== "recorded"
      ),
    [bookings]
  );

  const load = async () => {
    const [vRes, bRes] = await Promise.all([
      apiFetch("/api/venues"),
      apiFetch("/api/bookings"),
    ]);
    const v = await vRes.json();
    const b = await bRes.json();
    setVenues(v.venues ?? []);
    setBookings(b.bookings ?? []);
  };

  useEffect(() => {
    (async () => {
      try {
        await apiFetch("/api/seed", { method: "POST" });
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const myVenues = useMemo(
    () => venues.filter((v) => user && v.ownerId === user.id),
    [venues, user]
  );
  const myVenueIds = useMemo(() => new Set(myVenues.map((v) => v.id)), [myVenues]);
  const myBookings = useMemo(
    () =>
      bookings
        .filter((b) => b.venue && myVenueIds.has(b.venue.id))
        .filter(
          (b) =>
            b.visibility !== "competition" ||
            b.competition?.competitionStatus === "accepted" ||
            !b.competition?.competitionStatus ||
            b.competition.competitionStatus === "none",
        ),
    [bookings, myVenueIds]
  );

  const pending = myBookings.filter((b) => b.status === "pending");
  const confirmed = myBookings.filter((b) => b.status === "confirmed");
  const revenue = myBookings
    .filter((b) => b.status === "confirmed" || b.status === "completed")
    .reduce((s, b) => s + b.totalPrice, 0);
  const today = new Date().toISOString().slice(0, 10);
  const todaysGames = myBookings.filter(
    (b) => b.date === today && (b.status === "confirmed" || b.status === "pending")
  );
  const myCourts = myVenues.flatMap((v) => v.courts);

  const revenueByDay = useMemo(() => {
    const map = new Map<string, number>();
    myBookings
      .filter((b) => b.status === "confirmed" || b.status === "completed")
      .forEach((b) => map.set(b.date, (map.get(b.date) ?? 0) + b.totalPrice));
    return [...map.entries()].sort().slice(-7);
  }, [myBookings]);

  const statusCounts = useMemo(
    () => ({
      pending: myBookings.filter((b) => b.status === "pending").length,
      confirmed: myBookings.filter((b) => b.status === "confirmed").length,
      completed: myBookings.filter((b) => b.status === "completed").length,
      cancelled: myBookings.filter((b) => b.status === "cancelled").length,
      rejected: myBookings.filter((b) => b.status === "rejected").length,
    }),
    [myBookings]
  );

  const payByMethod = useMemo(() => {
    const map = new Map<string, { n: number; amt: number }>();
    myBookings
      .filter((b) => b.status === "confirmed" || b.status === "completed")
      .forEach((b) => {
        const cur = map.get(b.paymentMethod) ?? { n: 0, amt: 0 };
        cur.n += 1;
        cur.amt += b.totalPrice;
        map.set(b.paymentMethod, cur);
      });
    return [...map.entries()]
      .map(([m, v]): [string, number, number] => [m, v.n, v.amt])
      .sort((a, b) => b[2] - a[2]);
  }, [myBookings]);

  const peakHours = useMemo(() => {
    const map = new Map<string, number>();
    myBookings
      .filter((b) => b.status !== "cancelled" && b.status !== "rejected")
      .forEach((b) => {
        const hr = b.startTime ? b.startTime.slice(0, 5) : "?";
        map.set(hr, (map.get(hr) ?? 0) + 1);
      });
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, 10) as Array<[string, number]>;
  }, [myBookings]);

  async function decide(id: number, ok: boolean) {
    setActing(id);
    try {
      await apiFetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: ok ? "confirmed" : "rejected", actor: "owner", actorId: user?.id }),
      });
      await load();
    } finally {
      setActing(null);
    }
  }

  return (
    <OwnerGuard>
      {loading ? (
        <div className="space-y-4">
          <div className="h-10 w-64 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-white dark:bg-slate-900" />
            ))}
          </div>
        </div>
      ) : myVenues.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <Building2 className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
          <h2 className="mt-4 text-xl font-black">Welcome to Owner Studio 🎉</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
            List your first futsal arena to start receiving booking requests,
            tracking revenue and managing courts.
          </p>
          <Link
            href="/admin/venues"
            className="mt-5 inline-block rounded-xl bg-slate-900 px-6 py-3 text-sm font-black text-white dark:bg-white dark:text-slate-900"
          >
            + List my first venue
          </Link>
        </div>
      ) : (
        <div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">
              Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {user?.name.split(" ")[0]} 👋
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Here&apos;s what&apos;s happening across your {myVenues.length} venue
              {myVenues.length !== 1 ? "s" : ""} today.
            </p>
          </div>

          {/* KPIs */}
          <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              {
                icon: Inbox,
                label: "Pending requests",
                value: String(pending.length),
                sub: "need your decision",
                hot: pending.length > 0,
                href: "/admin/requests",
              },
              {
                icon: Banknote,
                label: "Revenue",
                value: formatNPR(revenue),
                sub: `${confirmed.length} confirmed bookings`,
                href: "/admin/bookings",
              },
              {
                icon: CalendarCheck,
                label: "Today's games",
                value: String(todaysGames.length),
                sub: "scheduled for today",
                href: "/admin/bookings",
              },
              {
                icon: Building2,
                label: "Venues / Courts",
                value: `${myVenues.length} / ${myCourts.length}`,
                sub: `${myCourts.filter((c) => c.isActive).length} courts live`,
                href: "/admin/venues",
              },
            ].map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className={`group rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md dark:bg-slate-900 ${
                  k.hot ? "border-orange-300 ring-1 ring-orange-300 dark:border-orange-500/50 dark:ring-orange-500/50" : "border-slate-200 dark:border-slate-800"
                }`}
              >
                <span
                  className={`grid h-10 w-10 place-items-center rounded-xl ${
                    k.hot ? "bg-orange-500 text-white" : "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  }`}
                >
                  <k.icon className="h-5 w-5" />
                </span>
                <p className="mt-3 truncate text-2xl font-black tracking-tight">{k.value}</p>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {k.label}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {k.sub}
                  <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                </p>
              </Link>
            ))}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {/* Pending requests preview */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
                  <Clock className="h-4 w-4 text-orange-500" />
                  Awaiting your approval
                </h2>
                <Link href="/admin/requests" className="text-xs font-black text-orange-600 hover:text-orange-500 dark:text-orange-400">
                  View all →
                </Link>
              </div>
              {pending.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">
                  No pending requests. New bookings from players will appear here. ✅
                </p>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {pending.slice(0, 4).map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-extrabold">
                          {b.bookerName || "Player"} • {formatNPR(b.totalPrice)}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {b.venue?.name} • {b.court?.name} • {prettyDate(b.date)} {formatTime12(b.startTime)}
                        </p>
                      </div>
                      <button
                        onClick={() => decide(b.id, true)}
                        disabled={acting === b.id}
                        className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:opacity-50"
                        title="Accept"
                      >
                        <Check className="h-4 w-4" strokeWidth={3} />
                      </button>
                      <button
                        onClick={() => decide(b.id, false)}
                        disabled={acting === b.id}
                        className="grid h-9 w-9 place-items-center rounded-xl bg-red-100 text-red-600 transition hover:bg-red-200 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/25"
                        title="Decline"
                      >
                        <X className="h-4 w-4" strokeWidth={3} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <RevenueRainbow data={revenueByDay} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <BookingDonut counts={statusCounts} />
            <PaymentParty byMethod={payByMethod} />
            <PeakHours byHour={peakHours} />
          </div>

          {/* Venues strip */}
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wider">My venues</h2>
              <Link href="/admin/venues" className="text-xs font-black text-orange-600 hover:text-orange-500 dark:text-orange-400">
                Manage →
              </Link>
            </div>
            <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto pb-1">
              {myVenues.map((v) => (
                <Link
                  key={v.id}
                  href="/admin/venues"
                  className="flex w-64 shrink-0 items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-slate-600"
                >
                  <img src={v.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold">{v.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {v.courtCount} courts • {v.courts.filter((c) => c.isActive).length} live
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>

          {/* Leagues & competition — hosting is open to players too, so this is
              the owner's way in: run one at your ground, or settle the results
              the squads are waiting on. */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Link
              href="/admin/leagues"
              className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-500/40"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
                <Trophy className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-black text-slate-900 dark:text-slate-100">
                  Host a league at your ground
                </span>
                <span className="mt-0.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Size it, set the entry fee and prize pool, then invite squads or take requests.
                  Photos and results live on the league page.
                </span>
              </span>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-emerald-500" />
            </Link>
            <Link
              href="/admin/bookings"
              className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/40"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white">
                <Swords className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-black text-slate-900 dark:text-slate-100">
                  Competition score desk
                </span>
                <span className="mt-0.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {awaitingScores.length > 0
                    ? `${awaitingScores.length} result${awaitingScores.length === 1 ? "" : "s"} waiting — ${awaitingScores
                        .slice(0, 2)
                        .map((b) => `${b.bookerName} vs ${b.competition?.opponentName ?? "opponent"}`)
                        .join(", ")}${awaitingScores.length > 2 ? "…" : ""}`
                    : "When two squads book a competition game, you record the score and it lands on both their profiles."}
                </span>
              </span>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-indigo-500" />
            </Link>
          </div>
        </div>
      )}
    </OwnerGuard>
  );
}
