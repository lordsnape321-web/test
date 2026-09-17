"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  Coins,
  Crown,
  Info,
  Lock,
  MapPin,
  Phone,
  Shield,
  Trophy,
  Users,
} from "lucide-react";
import { useUser } from "@/components/UserProvider";
import { LeagueForm } from "@/components/LeagueForm";
import { LeagueTable, PrizeBreakdown } from "@/components/LeagueTable";
import { LeagueFixtures } from "@/components/LeagueFixtures";
import { LeagueAlbum } from "@/components/LeagueAlbum";
import { LeagueHostPanel } from "@/components/LeagueHostPanel";
import { LeagueSquadPanel } from "@/components/LeagueSquadPanel";
import type { LeagueDetail } from "@/lib/league-store";
import { leagueStatusLabel, leagueVisibilityLabel } from "@/lib/league";
import { formatNPR, prettyDate } from "@/lib/futsal";

/**
 * One league, in full 🏆
 *
 * The page reads differently depending on who is looking at it: a visitor gets
 * the pitch (ground, size, terms, prize split, table and results), a captain
 * also gets their squad's entry panel, and the host gets the whole control room
 * — entries, ledger, fixtures and the album. All three are the same page and the
 * same data; only what the server sent differs.
 */
export default function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useUser();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [focusMatch, setFocusMatch] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments/${id}${user ? `?viewerId=${user.id}` : ""}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error ?? "Couldn't load that league 🙏"));
      setLeague(data.league as LeagueDetail);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that league 🙏");
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (focusMatch) {
      document.getElementById("album")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focusMatch]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#FFF9F0] dark:bg-stone-950">
        <div className="mx-auto max-w-7xl animate-pulse px-4 py-8 sm:px-6">
          <div className="h-64 rounded-[2rem] bg-white dark:bg-stone-900" />
          <div className="mt-4 h-40 rounded-3xl bg-white dark:bg-stone-900" />
        </div>
      </main>
    );
  }

  if (error || !league) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#FFF9F0] px-4 dark:bg-stone-950">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-black text-stone-900 dark:text-stone-100">
            {error || "That league has moved on 🏆"}
          </h1>
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
            Private leagues only open for the squads in them — if you were invited, log in with the
            captain&apos;s account and try again.
          </p>
          <Link
            href="/leagues"
            className="mt-4 inline-flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white"
          >
            <ArrowLeft className="h-4 w-4" /> All leagues
          </Link>
        </div>
      </main>
    );
  }

  const status = leagueStatusLabel(league.status);
  const visibility = leagueVisibilityLabel(league.visibility);
  const isHost = league.viewer?.isHost ?? false;
  const myTeamIds = league.viewer?.myTeams.map((t) => t.teamId) ?? [];
  const spotsLeft = Math.max(0, league.maxTeams - league.approvedTeams);
  const closed = league.status === "completed" || league.status === "cancelled";

  return (
    <main className="turf-pattern min-h-screen">
      {/* Cover */}
      <div className="relative h-60 sm:h-72">
        {league.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- host-supplied banner (data URL or album link)
          <img src={league.bannerUrl} alt={league.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-emerald-700 via-emerald-800 to-stone-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/20" />
        <div className="absolute inset-x-0 top-0 mx-auto max-w-7xl px-4 pt-5 sm:px-6">
          <Link
            href="/leagues"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-2 text-xs font-black text-stone-800 shadow backdrop-blur transition hover:bg-white dark:bg-stone-900/90 dark:text-stone-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All leagues
          </Link>
        </div>
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-7xl px-4 pb-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-black text-stone-800 shadow backdrop-blur dark:bg-stone-900/90 dark:text-stone-100">
              {status.emoji} {status.label}
            </span>
            <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-stone-700 shadow backdrop-blur dark:bg-stone-900/90 dark:text-stone-200">
              {league.format} • {league.approvedTeams}/{league.maxTeams} squads
            </span>
            <span className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-stone-700 shadow backdrop-blur dark:bg-stone-900/90 dark:text-stone-200">
              {visibility.emoji} {visibility.label}
            </span>
            {isHost && (
              <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-black text-amber-950 shadow">
                <Crown className="h-3 w-3" /> You host this
              </span>
            )}
          </div>
          <h1 className="mt-2 text-3xl font-black text-white drop-shadow sm:text-4xl">{league.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />{" "}
              {league.venueId ? (
                <Link href={`/venues/${league.venueId}`} className="underline">
                  {league.venueName}
                </Link>
              ) : (
                league.venueName
              )}
              {league.courtName ? ` • ${league.courtName}` : ""}
            </span>
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" /> Starts {prettyDate(league.startsAt)}
              {league.endsAt ? ` • ends ${prettyDate(league.endsAt)}` : ""}
            </span>
            <span className="flex items-center gap-1.5">
              <Crown className="h-4 w-4" /> Hosted by {league.hostName}
              {league.hostRole === "owner" ? " (venue owner)" : ""}
            </span>
          </p>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          {/* Terms */}
          <section className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-stone-900">
            <h2 className="text-xs font-black uppercase tracking-widest text-orange-500 dark:text-orange-400">
              The deal
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-[#FFF6E9] p-3.5 dark:bg-white/5">
                <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-stone-400">
                  <Coins className="h-3 w-3" /> Entry fee
                </p>
                <p className="mt-1 text-lg font-black text-stone-900 dark:text-stone-100">
                  {league.entryFee > 0 ? formatNPR(league.entryFee) : "Free"}
                </p>
                {league.entryFee > 0 && (
                  <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    {formatNPR(league.deposit)} deposit locks the place
                  </p>
                )}
              </div>
              <div className="rounded-2xl bg-[#FFF6E9] p-3.5 dark:bg-white/5">
                <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-stone-400">
                  <Shield className="h-3 w-3" /> Back out
                </p>
                <p className="mt-1 text-lg font-black text-stone-900 dark:text-stone-100">
                  {league.refundPercent}% back
                </p>
                <p className="text-[11px] font-bold text-stone-500 dark:text-stone-400">
                  of what the squad paid — the rest stays with the league
                </p>
              </div>
              <div className="rounded-2xl bg-[#FFF6E9] p-3.5 dark:bg-white/5">
                <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-stone-400">
                  <Users className="h-3 w-3" /> Squads
                </p>
                <p className="mt-1 text-lg font-black text-stone-900 dark:text-stone-100">
                  {league.approvedTeams}/{league.maxTeams}
                </p>
                <p className="text-[11px] font-bold text-stone-500 dark:text-stone-400">
                  {spotsLeft > 0 && !closed
                    ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`
                    : "League full"}
                  {league.closesAt && !closed ? ` • entries close ${prettyDate(league.closesAt)}` : ""}
                </p>
              </div>
            </div>

            {league.description && (
              <p className="mt-3 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
                {league.description}
              </p>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <PrizeBreakdown lines={league.prizeLines} prizePool={league.prizePool} />
              {league.rules && (
                <div className="rounded-2xl border border-[#F0E3CC] p-4 dark:border-white/10">
                  <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-stone-500 dark:text-stone-400">
                    <Info className="h-3.5 w-3.5" /> Rules
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-stone-600 dark:text-stone-400">
                    {league.rules}
                  </p>
                </div>
              )}
            </div>
            {league.matchDays && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-stone-400 dark:text-stone-500">
                <CalendarDays className="h-3.5 w-3.5" /> {league.matchDays}
                {league.contactPhone ? (
                  <>
                    {" "}
                    • <Phone className="h-3.5 w-3.5" /> {league.contactPhone}
                  </>
                ) : null}
              </p>
            )}
          </section>

          {/* Table */}
          <section className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-stone-900">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              <Trophy className="h-3.5 w-3.5" /> League table
            </h2>
            <div className="mt-3">
              {league.viewer?.canSeeInside || league.visibility === "public" ? (
                <LeagueTable standings={league.standings} highlightTeamIds={myTeamIds} />
              ) : (
                <p className="flex items-center gap-2 rounded-2xl border border-dashed border-amber-300 px-4 py-6 text-xs font-bold text-amber-700 dark:border-amber-500/30 dark:text-amber-300">
                  <Lock className="h-3.5 w-3.5" /> The table is inside the league — ask the host for an
                  invitation.
                </p>
              )}
            </div>
          </section>

          {/* Fixtures */}
          {league.viewer?.canSeeInside || league.visibility === "public" ? (
            <LeagueFixtures
              league={league}
              hostId={user?.id ?? 0}
              isHost={isHost}
              onChanged={load}
              onOpenAlbum={(mid) => setFocusMatch(mid)}
            />
          ) : (
            <section className="rounded-3xl border border-[#F0E3CC] bg-white p-5 text-xs font-bold text-stone-500 shadow-sm dark:border-white/10 dark:bg-stone-900 dark:text-stone-400">
              Fixtures and results are visible to the squads in this league.
            </section>
          )}

          {/* Album */}
          <LeagueAlbum
            league={league}
            hostId={user?.id ?? 0}
            isHost={isHost}
            focusMatchId={focusMatch}
            onChanged={load}
          />
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          {isHost && user && (
            <LeagueHostPanel
              league={league}
              hostId={user.id}
              onChanged={load}
              onEdit={() => setEditing(true)}
            />
          )}

          {user && !isHost && <LeagueSquadPanel league={league} viewerId={user.id} onChanged={load} />}

          {!user && (
            <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-stone-900">
              <p className="text-sm font-black text-stone-900 dark:text-stone-100">
                Want a place in this league?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                Log in as the captain of your squad, ask to join (or accept the invitation the host
                sent you), and pay the deposit to lock it in.
              </p>
              <Link
                href="/login"
                className="mt-3 inline-flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white"
              >
                Log in to enter
              </Link>
            </div>
          )}

          {/* Squad list */}
          <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-stone-900">
            <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              <Users className="h-3.5 w-3.5" /> Squads in the league
            </h2>
            {league.teams.length === 0 ? (
              <p className="mt-3 text-xs font-semibold text-stone-400 dark:text-stone-500">
                No squad has been admitted yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {league.teams.map((t) => (
                  <li key={t.teamId} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/teams/${t.teamId}`}
                      className="flex min-w-0 items-center gap-2 hover:underline"
                    >
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[10px] font-black text-white shadow"
                        style={{ background: t.logoColor }}
                      >
                        {t.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-bold text-stone-800 dark:text-stone-100">
                          {t.name}
                        </span>
                        <span className="block truncate font-mono text-[10px] font-bold text-stone-400">
                          {t.teamCode}
                        </span>
                      </span>
                    </Link>
                    {myTeamIds.includes(t.teamId) && (
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-black text-white">
                        YOURS
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* The host's private extras: everyone, admitted or not. */}
          {isHost && league.allTeams.some((t) => t.status !== "approved") && (
            <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50/60 p-5 dark:border-amber-500/30 dark:bg-amber-500/5">
              <p className="text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
                Behind the scenes
              </p>
              <ul className="mt-2 space-y-1.5">
                {league.allTeams
                  .filter((t) => t.status !== "approved")
                  .map((t) => (
                    <li key={t.teamId} className="text-[11px] font-bold text-stone-600 dark:text-stone-300">
                      {t.name}: {t.status}
                      {t.paidAmount > 0 ? ` • ${formatNPR(t.paidAmount)} in` : ""}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 text-[11px] font-semibold leading-relaxed text-stone-500 shadow-sm dark:border-white/10 dark:bg-stone-900 dark:text-stone-400">
            <p className="flex items-center gap-1.5 font-black uppercase tracking-widest text-stone-400 dark:text-stone-500">
              <Camera className="h-3 w-3" /> Photos &amp; privacy
            </p>
            <p className="mt-2">
              Photos are for the host and the squads that played. The host uploads from their phone or
              pastes an external album link — nothing here is public.
            </p>
          </div>
        </aside>
      </div>

      {user && (
        <LeagueForm
          open={editing}
          onClose={() => setEditing(false)}
          hostId={user.id}
          initial={league}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </main>
  );
}
