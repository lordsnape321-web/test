"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Coins,
  Crown,
  Lock,
  MapPin,
  Shield,
  Trophy,
  Users,
} from "lucide-react";
import type { LeagueSummary } from "@/lib/league-store";
import {
  leagueModeLabel,
  leagueStatusLabel,
  leagueVisibilityLabel,
  paymentState,
} from "@/lib/league";
import { formatNPR, initials, prettyDate } from "@/lib/futsal";

/**
 * A league on a card 🏆
 *
 * Everything a captain asks before entering, in the order they ask it: where is
 * it, how many squads, what does it cost up front, what's the prize, and am I
 * already in? The deposit line is deliberately loud — "pay Rs. 1,500 to lock
 * your place" is the deal, and a captain who finds that out after saying yes to
 * their squad is a captain who feels tricked.
 */
export function LeagueCard({ league, compact = false }: { league: LeagueSummary; compact?: boolean }) {
  const status = leagueStatusLabel(league.status);
  const visibility = leagueVisibilityLabel(league.visibility);
  const mode = leagueModeLabel(league.mode);
  const spotsLeft = Math.max(0, league.maxTeams - league.approvedTeams);
  const mine = league.viewer?.myTeams ?? [];
  const leading = mine.find((m) => m.status === "approved") ?? mine[0];
  const isHost = league.viewer?.isHost ?? false;

  return (
    <div
      className={`group flex flex-col overflow-hidden rounded-3xl border border-[#F0E3CC] bg-white shadow-[0_10px_30px_rgba(180,120,60,0.08)] transition hover:border-emerald-300 dark:border-white/10 dark:bg-stone-900 dark:hover:border-emerald-500/50 ${
        compact ? "w-[300px] shrink-0 sm:w-[340px]" : ""
      }`}
    >
      <div className="relative h-32 shrink-0 overflow-hidden">
        {league.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- host-supplied data URLs and external albums
          <img src={league.bannerUrl} alt={league.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-emerald-600 via-emerald-700 to-stone-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-black text-stone-800 backdrop-blur dark:bg-stone-900/90 dark:text-stone-100">
            {status.emoji} {status.label}
          </span>
          {/* How a winner gets decided, before the price does — a knockout
              reads completely differently to a captain than a round robin. */}
          <span className="rounded-full bg-orange-400/95 px-2.5 py-1 text-[10px] font-black text-orange-950 backdrop-blur">
            {mode.emoji} {mode.label}
          </span>
          {league.visibility === "private" && (
            <span className="flex items-center gap-1 rounded-full bg-stone-900/85 px-2.5 py-1 text-[10px] font-black text-amber-200 backdrop-blur">
              <Lock className="h-3 w-3" /> Private
            </span>
          )}
          {isHost && (
            <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-black text-amber-950">
              <Crown className="h-3 w-3" /> You host
            </span>
          )}
        </div>
        <div className="absolute inset-x-3 bottom-2.5">
          <h3 className="truncate text-base font-black text-white drop-shadow">{league.name}</h3>
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-white/85">
            <MapPin className="h-3 w-3" /> {league.venueName}
            {league.venueCity ? ` • ${league.venueCity}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {/* Three cells of ~80px on a phone: `min-w-0` + `truncate` keeps a big
            prize pool ("Rs. 1,00,000") from blowing the card wider than the
            viewport, which is what pushed the whole leagues grid sideways. */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="min-w-0 rounded-xl bg-[#FFF6E9] px-1 py-2 dark:bg-white/5">
            <p className="truncate text-sm font-black text-stone-900 dark:text-stone-100">
              {league.approvedTeams}/{league.maxTeams}
            </p>
            <p className="text-[10px] font-bold uppercase leading-tight tracking-wider text-stone-400">Squads</p>
          </div>
          <div className="min-w-0 rounded-xl bg-[#FFF6E9] px-1 py-2 dark:bg-white/5">
            <p className="truncate text-sm font-black text-stone-900 dark:text-stone-100">{league.format}</p>
            <p className="text-[10px] font-bold uppercase leading-tight tracking-wider text-stone-400">Format</p>
          </div>
          <div className="min-w-0 rounded-xl bg-[#FFF6E9] px-1 py-2 dark:bg-white/5">
            <p className="truncate text-[13px] font-black text-stone-900 sm:text-sm dark:text-stone-100">
              {league.prizePool > 0 ? formatNPR(league.prizePool) : "Cup"}
            </p>
            <p className="text-[10px] font-bold uppercase leading-tight tracking-wider text-stone-400">Prize</p>
          </div>
        </div>

        <div className="mt-3 space-y-1.5 text-xs font-semibold text-stone-500 dark:text-stone-400">
          <p className="flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            {league.entryFee > 0 ? (
              <>
                {formatNPR(league.entryFee)} per squad •{" "}
                <span className="font-black text-stone-700 dark:text-stone-200">
                  {formatNPR(league.deposit)} to lock a place
                </span>
              </>
            ) : (
              <>Free entry — just turn up 🎟️</>
            )}
          </p>
          <p className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Starts {prettyDate(league.startsAt)}
            {league.matchDays ? ` • ${league.matchDays}` : ""}
          </p>
          <p className="flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            {league.playedMatches} of {league.totalMatches || "—"} fixtures played • hosted by{" "}
            {league.hostName}
            {league.hostRole === "owner" ? " 🏟️" : ""}
          </p>
          {league.entryFee > 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-stone-400 dark:text-stone-500">
              <Shield className="h-3 w-3" /> Back out and {league.refundPercent}% of what you paid comes
              back
            </p>
          )}
        </div>

        {/* My squad's own line — the one thing this viewer actually cares about. */}
        {leading && (
          <p
            className={`mt-3 rounded-xl px-3 py-2 text-[11px] font-bold ${
              leading.status === "approved"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> {leading.teamName}:{" "}
              {leading.payment.emoji} {leading.payment.label}
            </span>
            {leading.status !== "approved" && (
              <span className="mt-0.5 block text-[10px] font-black uppercase tracking-wider">
                {leading.status === "invited"
                  ? "You've been invited"
                  : leading.status === "requested"
                    ? "Waiting on the host"
                    : leading.status}
              </span>
            )}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <span className="text-[11px] font-bold text-stone-400 dark:text-stone-500">
            {isHost
              ? league.pendingTeams > 0
                ? `${league.pendingTeams} waiting on you`
                : "Your control room"
              : spotsLeft > 0
                ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`
                : "Full"}
          </span>
          <Link
            href={`/leagues/${league.id}`}
            className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black text-white transition hover:bg-emerald-700"
          >
            Open league <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Initials bubble reused by league rows so a squad reads the same everywhere. */
export function LeagueTeamChip({
  name,
  logoColor,
  teamCode,
  href,
}: {
  name: string;
  logoColor: string;
  teamCode?: string;
  href?: string;
}) {
  const body = (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[10px] font-black text-white shadow"
        style={{ background: logoColor }}
      >
        {initials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-bold text-stone-800 dark:text-stone-100">
          {name}
        </span>
        {teamCode && (
          <span className="block truncate font-mono text-[10px] font-bold text-stone-400 dark:text-stone-500">
            {teamCode}
          </span>
        )}
      </span>
    </span>
  );
  return href ? (
    <Link href={href} className="min-w-0 hover:underline">
      {body}
    </Link>
  ) : (
    body
  );
}

/** "Rs. 1,500 of Rs. 6,000 in" — one line, used in the host console and the squad panel. */
export function PaymentLine({
  entryFee,
  paidAmount,
  refundedAmount,
  depositPercent,
  refundPercent,
  locked,
}: {
  entryFee: number;
  paidAmount: number;
  refundedAmount?: number;
  depositPercent?: number;
  refundPercent?: number;
  /** Set once the squad has played — their money is the league's from here on. */
  locked?: boolean;
}) {
  const state = paymentState({ entryFee, paidAmount, refundedAmount, depositPercent, refundPercent });
  return (
    <span className="text-[11px] font-bold text-stone-500 dark:text-stone-400">
      {state.emoji} {entryFee > 0 ? `${formatNPR(state.paid)} of ${formatNPR(entryFee)}` : "Free entry"}
      {entryFee > 0 && state.deposit > 0 && !state.depositMet
        ? ` • deposit ${formatNPR(state.deposit)}`
        : ""}
      {entryFee > 0 && state.due > 0 && state.depositMet ? ` • ${formatNPR(state.due)} to settle` : ""}
      {locked ? " • 🔒 locked in" : ""}
    </span>
  );
}
