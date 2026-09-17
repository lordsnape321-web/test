"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Coins,
  Crown,
  Filter,
  Globe,
  Lock,
  Plus,
  Search,
  Shield,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { LeagueCard } from "@/components/LeagueCard";
import { LeagueForm } from "@/components/LeagueForm";
import type { LeagueSummary } from "@/lib/league-store";
import { formatNPR } from "@/lib/futsal";
import { validateSearch } from "@/lib/validation";

/**
 * Leagues 🏆
 *
 * The listing half of the tournament layer: every public league on the platform,
 * plus the private ones *this* account has a right to see. Hosting is open to
 * players and venue owners alike — the button is right there next to the search.
 */
export default function LeaguesPage() {
  const { user, isOwner } = useUser();
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<"all" | "mine" | "hosting" | "open">("all");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments${user ? `?viewerId=${user.id}&limit=100` : "?limit=100"}`);
      const data = await res.json().catch(() => ({}));
      setLeagues(data.leagues ?? []);
    } catch {
      setLeagues([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = leagues;
    if (needle)
      rows = rows.filter((l) =>
        `${l.name} ${l.venueName} ${l.venueCity} ${l.format} ${l.hostName}`.toLowerCase().includes(needle)
      );
    if (filter === "mine") rows = rows.filter((l) => (l.viewer?.myTeams.length ?? 0) > 0);
    if (filter === "hosting") rows = rows.filter((l) => l.viewer?.isHost);
    if (filter === "open") rows = rows.filter((l) => l.status === "registration" && l.approvedTeams < l.maxTeams);
    return rows;
  }, [leagues, q, filter]);

  const stats = useMemo(() => {
    const playing = leagues.reduce((s, l) => s + l.approvedTeams, 0);
    const pool = leagues.reduce((s, l) => s + l.prizePool, 0);
    return { count: leagues.length, playing, pool };
  }, [leagues]);

  return (
    <main className="turf-pattern min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-emerald-700 via-emerald-800 to-stone-900 p-6 sm:p-9">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-amber-300/20 blur-[80px]" />
          <div className="relative flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-xl">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-[11px] font-black text-amber-200">
                <Trophy className="h-3.5 w-3.5" /> LEAGUES & TOURNAMENTS
              </span>
              <h1 className="mt-3 text-3xl font-black leading-tight text-white sm:text-4xl">
                One ground. Many squads. A table that actually means something.
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-emerald-100/85">
                Enter your squad, pay the deposit to lock your place, play the fixtures and watch the
                results land on your team profile. Hosting is open to players and venue owners alike.
              </p>
              <div className="mt-4 flex flex-wrap gap-4 text-[11px] font-bold text-emerald-100/80">
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> {stats.playing} squads entered
                </span>
                <span className="flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5" /> {stats.count} leagues
                </span>
                <span className="flex items-center gap-1.5">
                  <Coins className="h-3.5 w-3.5" /> {formatNPR(stats.pool)} in prize pools
                </span>
              </div>
            </div>
            <button
              onClick={() => (user ? setShowForm(true) : (window.location.href = "/login"))}
              className="flex items-center gap-2 rounded-2xl bg-amber-400 px-5 py-3.5 text-sm font-black text-emerald-950 shadow-lg transition hover:bg-amber-300"
            >
              <Plus className="h-4 w-4" strokeWidth={3} /> Host a league
            </button>
          </div>
        </div>

        {notice && (
          <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            {notice}
          </p>
        )}

        {/* Controls */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[15rem] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const err = validateSearch(draft, { max: 60 });
                  if (err) {
                    setNotice(err);
                    return;
                  }
                  setNotice("");
                  setQ(draft);
                }
              }}
              placeholder="Search leagues, grounds or hosts…"
              className="w-full rounded-2xl border border-[#F0E3CC] bg-white py-3 pl-10 pr-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-stone-900 dark:text-stone-100"
            />
          </div>
          <button
            onClick={() => {
              const err = validateSearch(draft, { max: 60 });
              if (err) {
                setNotice(err);
                return;
              }
              setNotice("");
              setQ(draft);
            }}
            className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-black text-white transition hover:bg-stone-800 dark:bg-white dark:text-stone-900"
          >
            Search
          </button>
          <div className="flex items-center gap-1 rounded-2xl border border-[#F0E3CC] bg-white p-1 dark:border-white/10 dark:bg-stone-900">
            <Filter className="ml-2 h-3.5 w-3.5 text-stone-400" />
            {(
              [
                { id: "all", label: "All" },
                { id: "open", label: "Taking entries" },
                { id: "mine", label: "My squads" },
                { id: "hosting", label: "I host" },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-xl px-3 py-2 text-[11px] font-black transition ${
                  filter === f.id
                    ? "bg-emerald-600 text-white"
                    : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/5"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hosting blurb for owners */}
        {isOwner && (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-xs font-bold text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300">
            <Crown className="h-3.5 w-3.5" /> Running a venue? You can host leagues at your own ground
            straight from the Owner Studio — same tools, same table.
            <Link href="/admin/leagues" className="underline">
              Open Owner Studio → Leagues
            </Link>
          </p>
        )}

        {/* Listing */}
        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-80 animate-pulse rounded-3xl bg-white dark:bg-stone-900" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-stone-300 bg-white p-10 text-center dark:border-white/10 dark:bg-stone-900">
            <p className="text-sm font-black text-stone-700 dark:text-stone-200">
              {q ? `No leagues match “${q}”` : "No leagues here yet"}
            </p>
            <p className="mt-1 text-xs font-semibold text-stone-400 dark:text-stone-500">
              {q
                ? "Try the ground's name, or clear the search."
                : "Be the first to host one — it takes about two minutes. 🏆"}
            </p>
            {user && (
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" /> Host a league
              </button>
            )}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((l) => (
              <LeagueCard key={l.id} league={l} />
            ))}
          </div>
        )}

        {/* How it works */}
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Shield,
              title: "Deposit holds the place",
              text: "A squad pays at least 25% of the entry fee to be counted in. Back out and 10% of what was paid returns — the rest stays with the league.",
            },
            {
              icon: Users,
              title: "Invite or request",
              text: "Public leagues take join requests from captains. Private ones are invitation-only — invisible to everyone else.",
            },
            {
              icon: Trophy,
              title: "Results are the table",
              text: "The host enters the score after each game. It moves the table and lands on both squads' profiles automatically.",
            },
            {
              icon: Lock,
              title: "Photos stay inside",
              text: "Upload from your phone or paste a Drive link. Only the host and the squads that played see the pictures.",
            },
          ].map((s) => (
            <div
              key={s.title}
              className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-stone-900"
            >
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <s.icon className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-black text-stone-900 dark:text-stone-100">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-stone-500 dark:text-stone-400">{s.text}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] font-bold text-stone-400 dark:text-stone-500">
          <Globe className="h-3.5 w-3.5" /> Public leagues are listed for everyone •{" "}
          <Sparkles className="h-3.5 w-3.5" /> private ones only for the squads invited
        </p>
      </div>

      {user && (
        <LeagueForm
          open={showForm}
          onClose={() => setShowForm(false)}
          hostId={user.id}
          onSaved={(id) => {
            setShowForm(false);
            if (id) window.location.href = `/leagues/${id}`;
            else void load();
          }}
        />
      )}
    </main>
  );
}
