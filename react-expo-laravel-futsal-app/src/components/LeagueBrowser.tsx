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
import { apiFetch } from "@/lib/api";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Taking entries" },
  { id: "mine", label: "My squads" },
  { id: "hosting", label: "I host" },
] as const;

type LeagueFilter = (typeof FILTERS)[number]["id"];

/**
 * League browser 🏆
 *
 * The whole leagues listing, lifted out of its own route so it can live *inside*
 * the Matches screen as the second half of the "Open games / League matches"
 * toggle. Leagues are matches with a table attached — asking a player to learn a
 * separate top-level tab for them was one tab too many, and on a phone the bottom
 * rail was already out of room.
 *
 * Everything a league needs is still here: search, the four filters, hosting, and
 * the private-league rules. `/leagues/[id]` remains the detail page; the old
 * `/leagues` index redirects to `/matches?tab=leagues` so every bookmark, seeded
 * notification link and shared URL keeps working.
 */
export function LeagueBrowser() {
  const { user, isOwner } = useUser();
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<LeagueFilter>("all");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/tournaments${user ? `?viewerId=${user.id}&limit=100` : "?limit=100"}`);
      const data = await res.json().catch(() => ({}));
      setLeagues(data.leagues ?? []);
    } catch {
      setLeagues([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // The request resolves asynchronously and owns its loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  function runSearch() {
    const err = validateSearch(draft, { max: 60 });
    if (err) {
      setNotice(err);
      return;
    }
    setNotice("");
    setQ(draft);
  }

  return (
    <div>
      {/* Intro band */}
      <div className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-emerald-700 via-emerald-800 to-stone-900 p-5 sm:rounded-[2rem] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-300/20 blur-[80px] sm:h-64 sm:w-64" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-5">
          <div className="min-w-0 max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-black text-amber-200">
              <Trophy className="h-3.5 w-3.5 shrink-0" /> LEAGUE MATCHES
            </span>
            <h2 className="mt-3 text-2xl font-black leading-tight text-white sm:text-3xl lg:text-4xl">
              One ground. Many squads. A table that actually means something.
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-emerald-100/85 sm:text-sm">
              Enter your squad, pay the deposit to lock your place, play the fixtures and watch the
              results land on your team profile. Hosting is open to players and venue owners alike.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-bold text-emerald-100/80">
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 shrink-0" /> {stats.playing} squads entered
              </span>
              <span className="flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 shrink-0" /> {stats.count} leagues
              </span>
              <span className="flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 shrink-0" /> {formatNPR(stats.pool)} in prize pools
              </span>
            </div>
          </div>
          <button
            onClick={() => (user ? setShowForm(true) : (window.location.href = "/login"))}
            className="flex w-full shrink-0 items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 py-3.5 text-sm font-black text-emerald-950 shadow-lg transition hover:bg-amber-300 sm:w-auto"
          >
            <Plus className="h-4 w-4 shrink-0" strokeWidth={3} /> Host a league
          </button>
        </div>
      </div>

      {notice && (
        <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          {notice}
        </p>
      )}

      {/* Controls: search is a task, filters are a single intentional control. */}
      <div className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="Search leagues, grounds or hosts…"
            aria-label="Search leagues"
            className="w-full rounded-2xl border border-[#F0E3CC] bg-white py-3.5 pl-10 pr-3 text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <button
          onClick={runSearch}
          className="rounded-2xl bg-stone-900 px-6 py-3.5 text-sm font-black text-white transition hover:bg-stone-800 dark:bg-white dark:text-slate-900"
        >
          Search
        </button>
      </div>
      <div className="mt-3 rounded-3xl border border-[#F0E3CC] bg-white p-2.5 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 px-1.5 pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Filter className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-black text-stone-800 dark:text-slate-100">Browse leagues</p>
              <p className="text-[11px] font-semibold text-stone-400 dark:text-slate-500">Choose one view — your place is remembered.</p>
            </div>
          </div>
          <span className="hidden shrink-0 text-[10px] font-black uppercase tracking-[0.12em] text-stone-400 sm:block dark:text-slate-500">{shown.length} shown</span>
        </div>
        <div className="no-scrollbar flex snap-x gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter leagues">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const hint = f.id === "all" ? "Every league" : f.id === "open" ? "Spaces available" : f.id === "mine" ? "Squads you joined" : "Your hosted boards";
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={active}
                className={`flex min-h-[3.75rem] w-max shrink-0 snap-start items-center gap-2 rounded-2xl border px-3 py-2 text-left transition ${
                  active
                    ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                    : "border-stone-100 bg-stone-50/80 text-stone-700 hover:border-emerald-200 hover:bg-emerald-50 dark:border-white/5 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:border-emerald-500/30 dark:hover:bg-emerald-500/10"
                }`}
              >
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black ${active ? "bg-white/20 text-white" : "bg-white text-emerald-700 dark:bg-white/10 dark:text-emerald-300"}`}>
                  {active ? "✓" : "•"}
                </span>
                <span className="min-w-0">
                  <span className="block whitespace-nowrap text-[11px] font-black leading-tight sm:text-xs">{f.label}</span>
                  <span className={`mt-0.5 block whitespace-nowrap text-[10px] font-semibold leading-tight ${active ? "text-emerald-50" : "text-stone-400 dark:text-slate-500"}`}>{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Hosting blurb for owners */}
      {isOwner && (
        <p className="mt-3 flex flex-wrap items-start gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-xs font-bold leading-relaxed text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300">
          <Crown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            Running a venue? You can host leagues at your own ground straight from the Owner Studio —
            same tools, same table. {" "}
            <Link href="/admin/leagues" className="underline">
              Open Owner Studio → Leagues
            </Link>
          </span>
        </p>
      )}

      {/* Listing */}
      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-80 animate-pulse rounded-3xl bg-white dark:bg-slate-900" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-stone-300 bg-white p-8 text-center dark:border-white/10 dark:bg-slate-900 sm:p-10">
          <p className="text-sm font-black text-stone-700 dark:text-slate-200">
            {q ? `No leagues match “${q}”` : "No leagues here yet"}
          </p>
          <p className="mt-1 text-xs font-semibold text-stone-400 dark:text-slate-500">
            {q
              ? "Try the ground's name, or clear the search."
              : "Be the first to host one — it takes about two minutes. 🏆"}
          </p>
          {q && (
            <button
              onClick={() => {
                setDraft("");
                setQ("");
                setNotice("");
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-stone-200 px-5 py-3 text-sm font-black text-stone-700 transition hover:bg-stone-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
            >
              Clear search
            </button>
          )}
          {user && !q && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4 shrink-0" /> Host a league
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
      <div className="mt-8 grid gap-3 sm:mt-10 sm:grid-cols-2 lg:grid-cols-4">
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
            className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900"
          >
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <s.icon className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm font-black text-stone-900 dark:text-slate-100">{s.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-stone-500 dark:text-slate-400">{s.text}</p>
          </div>
        ))}
      </div>

      <p className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-center text-[11px] font-bold text-stone-400 dark:text-slate-500">
        <Globe className="h-3.5 w-3.5 shrink-0" /> Public leagues are listed for everyone •{" "}
        <Sparkles className="h-3.5 w-3.5 shrink-0" /> private ones only for the squads invited
      </p>

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
    </div>
  );
}
