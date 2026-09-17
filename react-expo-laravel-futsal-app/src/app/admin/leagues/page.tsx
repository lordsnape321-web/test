"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Trophy,
  Plus,
  ArrowRight,
  Swords,
  Lock,
  Globe,
  Banknote,
  Users,
  CalendarClock,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { OwnerGuard } from "@/components/OwnerGuard";
import { LeagueCard } from "@/components/LeagueCard";
import { LeagueForm } from "@/components/LeagueForm";
import type { LeagueSummary } from "@/lib/league-store";
import { formatNPR } from "@/lib/futsal";

type Booking = {
  id: number;
  date: string;
  startTime: string;
  venue?: { id: number; name: string };
  teamName: string;
  visibility: string;
  competition: {
    opponentName: string;
    leagueName: string;
    homeScore: number | null;
    awayScore: number | null;
    scoreStatus: string;
  } | null;
};

/**
 * Owner Studio → Leagues 🏆
 *
 * The owner's side of a tournament: the leagues they run at their grounds, what
 * each of them has taken in, and the results they still owe the two squads who
 * played. Hosting is not an owner-only privilege any more — a player can host
 * too — so this page is a console, not a gate: it lists what *this* account
 * hosts and links straight into the control room.
 */
export default function OwnerLeaguesPage() {
  const { user } = useUser();
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [venues, setVenues] = useState<Array<{ id: number; ownerId: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [lRes, bRes, vRes] = await Promise.all([
      fetch(`/api/tournaments?viewerId=${user.id}&limit=100`),
      fetch("/api/bookings"),
      fetch("/api/venues"),
    ]);
    const l = await lRes.json().catch(() => ({}));
    const b = await bRes.json().catch(() => ({}));
    const v = await vRes.json().catch(() => ({}));
    setLeagues((l.leagues ?? []) as LeagueSummary[]);
    setBookings((b.bookings ?? []) as Booking[]);
    setVenues((v.venues ?? []) as Array<{ id: number; ownerId: number | null }>);
  }, [user]);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const myVenueIds = useMemo(
    () => new Set(venues.filter((v) => v.ownerId === user?.id).map((v) => v.id)),
    [venues, user]
  );

  /** Leagues this account hosts — the ones with a control room to open. */
  const hosted = useMemo(() => leagues.filter((l) => l.hostId === user?.id), [leagues, user]);
  /** Leagues where this account only plays (a squad of theirs holds a place). */
  const playing = useMemo(
    () => leagues.filter((l) => l.hostId !== user?.id && (l.viewer?.myTeams ?? []).length > 0),
    [leagues, user]
  );

  /** Competition games at this owner's grounds that still need a final score. */
  const awaiting = useMemo(
    () =>
      bookings.filter(
        (b) =>
          b.competition &&
          b.competition.scoreStatus !== "recorded" &&
          b.venue &&
          myVenueIds.has(b.venue.id)
      ),
    [bookings, myVenueIds]
  );

  const stats = useMemo(() => {
    const squads = hosted.reduce((sum, l) => sum + l.approvedTeams, 0);
    const pools = hosted.reduce((sum, l) => sum + l.prizePool, 0);
    const fixtures = hosted.reduce((sum, l) => sum + l.playedMatches, 0);
    return { squads, pools, fixtures };
  }, [hosted]);

  return (
    <OwnerGuard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <Trophy className="h-6 w-6" /> Leagues
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Tournaments on your grounds — entries, money, fixtures and results. Anyone can host,
            and you don&apos;t have to own the ground to do it.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-black text-white shadow transition hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" /> Host a league
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Leagues hosted", v: hosted.length, icon: Trophy },
          { l: "Squads entered", v: stats.squads, icon: Users },
          { l: "Fixtures played", v: stats.fixtures, icon: CalendarClock },
          { l: "Prize pools", v: stats.pools > 0 ? formatNPR(stats.pools) : "—", icon: Banknote },
        ].map((s) => (
          <div
            key={s.l}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <s.icon className="h-4 w-4 text-emerald-600" />
            <p className="mt-2 text-xl font-black text-slate-900 dark:text-slate-100">{s.v}</p>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {s.l}
            </p>
          </div>
        ))}
      </div>

      {/* Score desk — the one thing a host owes a squad after the whistle. */}
      {awaiting.length > 0 && (
        <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-500/25 dark:bg-indigo-500/5">
          <p className="flex items-center gap-2 text-sm font-black text-indigo-800 dark:text-indigo-300">
            <Swords className="h-4 w-4" /> {awaiting.length} competition result
            {awaiting.length === 1 ? "" : "s"} still to record
          </p>
          <ul className="mt-2 space-y-1.5">
            {awaiting.slice(0, 3).map((b) => (
              <li key={b.id} className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                #{b.id} • {b.teamName || "Squad"} vs {b.competition?.opponentName || "opponent"} at{" "}
                {b.venue?.name ?? "your ground"}
                {b.competition?.leagueName ? ` • 🏆 ${b.competition.leagueName}` : ""}
              </li>
            ))}
          </ul>
          <Link
            href="/admin/bookings"
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-2 text-xs font-black text-white transition hover:bg-indigo-700"
          >
            Open the score desk <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {loading ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-3xl bg-white dark:bg-slate-900"
            />
          ))}
        </div>
      ) : (
        <>
          <h2 className="mt-6 text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Leagues you host
          </h2>
          {hosted.length === 0 ? (
            <div className="mt-3 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
              <p className="text-sm font-black text-slate-700 dark:text-slate-200">
                You aren&apos;t hosting a league yet 🏆
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs font-semibold text-slate-400 dark:text-slate-500">
                Pick a ground, size it (4–32 squads), set the entry fee and prize pool, then send
                invitations — or leave it public so teams can request a place.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-black text-white transition hover:bg-emerald-700"
              >
                <Plus className="h-3.5 w-3.5" /> Host your first league
              </button>
            </div>
          ) : (
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {hosted.map((l) => (
                <div key={l.id}>
                  <LeagueCard league={l} />
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400 dark:text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      {l.visibility === "private" ? (
                        <>
                          <Lock className="h-3 w-3" /> Private
                        </>
                      ) : (
                        <>
                          <Globe className="h-3 w-3" /> Public
                        </>
                      )}
                    </span>
                    <span>•</span>
                    <span>{l.approvedTeams}/{l.maxTeams} squads</span>
                    {l.pendingTeams > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-amber-600 dark:text-amber-400">
                          {l.pendingTeams} waiting on you
                        </span>
                      </>
                    )}
                    <Link
                      href={`/leagues/${l.id}`}
                      className="ml-auto inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
                    >
                      Control room <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          {playing.length > 0 && (
            <>
              <h2 className="mt-8 text-xs font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Leagues your squads play in
              </h2>
              <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {playing.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/leagues/${l.id}`}
                      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-500/40"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
                        <Trophy className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">
                          {l.name}
                        </span>
                        <span className="block truncate text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                          {l.format} • {l.approvedTeams}/{l.maxTeams} squads •{" "}
                          {(l.viewer?.myTeams ?? []).map((m) => m.teamName).join(", ")}
                        </span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {user && (
        <LeagueForm
          open={showForm}
          onClose={() => setShowForm(false)}
          hostId={user.id}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </OwnerGuard>
  );
}
