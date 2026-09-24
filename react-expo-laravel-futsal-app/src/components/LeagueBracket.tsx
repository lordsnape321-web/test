"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Loader2, RefreshCw, Swords, Trophy } from "lucide-react";
import type { LeagueDetail, LeagueMatchRow } from "@/lib/league-store";
import { leagueDateLabel, standingsFor } from "@/lib/league";
import { formatTime12 } from "@/lib/futsal";
import { apiFetch } from "@/lib/api";

/**
 * The bracket 🥊
 *
 * Knockout leagues don't have a table — they have a shape, and the shape is the
 * thing a captain wants to look at: who do we play, and who is waiting in the
 * next round. Rounds run left to right, each slot naming the squad in it or,
 * while the game before it is still to be played, *where* that squad will come
 * from ("Winner Group A", "Bye 🎟️").
 *
 * This component only reads. Scores and kick-off times are entered in the
 * fixture list below, and the next round fills itself the moment a result is
 * recorded — see `advanceBracket` in `/api/tournaments/[id]/matches`.
 */
export function LeagueBracket({
  league,
  hostId,
  isHost,
  onChanged,
}: {
  league: LeagueDetail;
  hostId: number;
  isHost: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const bracketMatches = league.matches.filter((m) => m.bracketRound > 0);

  // One column per knockout round, in order, third place last.
  const rounds = useMemo(() => {
    const byRound = new Map<number, LeagueMatchRow[]>();
    for (const m of bracketMatches) {
      const list = byRound.get(m.bracketRound) ?? [];
      list.push(m);
      byRound.set(m.bracketRound, list);
    }
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([roundIndex, rows]) => ({
        roundIndex,
        label: rows[0]?.round ?? "Round",
        rows: rows.slice().sort((a, b) => a.slot - b.slot),
      }));
  }, [bracketMatches]);

  // Groups + knockout: the group tables are the first stage, and they are what
  // the empty "Winner Group A" slots are waiting on.
  const groups = useMemo(() => {
    const groupRounds = [...new Set(league.matches.filter((m) => /^Group /.test(m.round)).map((m) => m.round))].sort();
    return groupRounds.map((round) => {
      const fixtures = league.matches.filter((m) => m.round === round);
      const ids = [...new Set(fixtures.flatMap((m) => [m.homeTeamId, m.awayTeamId]))];
      const likes = ids.map((id) => {
        const t = league.teams.find((x) => x.teamId === id);
        return {
          teamId: id,
          name: t?.name ?? "Squad",
          logoColor: t?.logoColor ?? "#16a34a",
          teamCode: t?.teamCode ?? "",
        };
      });
      const played = fixtures.filter((f) => f.homeScore !== null && f.awayScore !== null).length;
      return {
        round,
        table: standingsFor(likes, fixtures),
        done: fixtures.length > 0 && played === fixtures.length,
        played,
        total: fixtures.length,
      };
    });
  }, [league.matches, league.teams]);

  const waiting = bracketMatches.filter((m) => m.homeTeamId === 0 || m.awayTeamId === 0).length;

  async function fill() {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const res = await apiFetch(`/api/tournaments/${league.id}/matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId, action: "advance" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error ?? "That didn't work 🙏"));
      setMsg(String(data.message ?? "Bracket updated ✅"));
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy(false);
    }
  }

  if (bracketMatches.length === 0 && groups.length === 0) {
    return (
      <p className="mt-3 rounded-2xl border border-dashed border-stone-300 px-4 py-6 text-center text-xs font-bold text-stone-400 dark:border-white/10 dark:text-slate-500">
        {isHost
          ? "No bracket yet — draw it and the shape of the tournament appears here."
          : "The host hasn't drawn the bracket yet."}
      </p>
    );
  }

  return (
    <section className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-orange-600 dark:text-orange-400">
          <Swords className="h-3.5 w-3.5" /> The bracket
        </h2>
        {isHost && waiting > 0 && (
          <button
            onClick={() => void fill()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl border border-orange-200 px-3 py-1.5 text-[11px] font-black text-orange-700 transition hover:bg-orange-50 disabled:opacity-50 dark:border-orange-500/30 dark:text-orange-300 dark:hover:bg-orange-500/10"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Fill {waiting} empty {waiting === 1 ? "slot" : "slots"}
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] font-semibold text-stone-400 dark:text-slate-500">
        Win and you move right. A slot with no squad in it yet says where that squad will come
        from — it fills the moment the game before it is decided.
      </p>

      {(msg || err) && (
        <p
          className={`mt-3 rounded-2xl px-4 py-2.5 text-xs font-bold ${
            err
              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          }`}
        >
          {err || msg}
        </p>
      )}

      {groups.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.round} className="rounded-2xl border border-[#F0E3CC] p-3 dark:border-white/10">
              <p className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                {g.round}
                <span className="font-bold normal-case tracking-normal text-stone-400">
                  {g.done ? "✓ through to the bracket" : `${g.played}/${g.total} played`}
                </span>
              </p>
              <ul className="mt-2 space-y-1">
                {g.table.slice(0, 3).map((row, i) => (
                  <li key={row.teamId} className="flex items-center justify-between text-xs font-bold">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="grid h-4 w-4 shrink-0 place-items-center rounded text-[8px] font-black text-white"
                        style={{ background: row.logoColor }}
                      >
                        {i + 1}
                      </span>
                      <span className="truncate text-stone-800 dark:text-slate-200">{row.name}</span>
                    </span>
                    <span className="shrink-0 text-stone-400">
                      {row.played}p • {row.points}pts
                      {i < 2 && (
                        <span className="ml-1 font-black text-emerald-600 dark:text-emerald-400">→</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {rounds.length > 0 ? (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
          {rounds.map((round) => (
            <div key={round.roundIndex} className="min-w-[13rem] flex-1">
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-stone-400 dark:text-slate-500">
                {round.label}
              </p>
              <ul className="space-y-2">
                {round.rows.map((m) => (
                  <Slot key={m.id} match={m} isFinal={round.label === "Final"} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl bg-stone-50 px-4 py-6 text-center text-xs font-bold text-stone-400 dark:bg-white/5 dark:text-slate-500">
          The knockout stage appears once the groups are drawn.
        </p>
      )}
    </section>
  );
}

/** One game in the bracket: two lines, the winner in bold, empty slots named. */
function Slot({ match, isFinal }: { match: LeagueMatchRow; isFinal: boolean }) {
  const decided = match.homeScore !== null && match.awayScore !== null;
  const homeWon = decided && (match.homeScore ?? 0) > (match.awayScore ?? 0);
  const awayWon = decided && (match.awayScore ?? 0) > (match.homeScore ?? 0);
  const bye =
    (match.homeTeamId > 0 && match.awayTeamId === 0 && !match.awayFrom) ||
    (match.awayTeamId > 0 && match.homeTeamId === 0 && !match.homeFrom);

  return (
    <li
      className={`rounded-2xl border p-2.5 ${
        isFinal
          ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5"
          : "border-[#F0E3CC] dark:border-white/10"
      }`}
    >
      <p className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-stone-400">
        <span className="flex items-center gap-1">
          {isFinal && <Trophy className="h-3 w-3 text-amber-500" />}
          {leagueDateLabel(match.date)}
          {match.startTime ? ` • ${formatTime12(match.startTime)}` : " • TBC"}
        </span>
        {bye && <span className="font-bold normal-case tracking-normal text-emerald-600">bye</span>}
      </p>
      <Line
        name={match.homeTeamName}
        label={match.homeLabel}
        score={match.homeScore}
        won={homeWon}
        waiting={match.homeTeamId === 0}
      />
      <p className="my-0.5 flex items-center gap-1 text-[9px] font-black uppercase text-stone-300 dark:text-slate-600">
        <ArrowRight className="h-2.5 w-2.5" /> vs
      </p>
      <Line
        name={match.awayTeamName}
        label={match.awayLabel}
        score={match.awayScore}
        won={awayWon}
        waiting={match.awayTeamId === 0}
      />
    </li>
  );
}

function Line({
  name,
  label,
  score,
  won,
  waiting,
}: {
  name: string;
  label: string;
  score: number | null;
  won: boolean;
  waiting: boolean;
}) {
  return (
    <p className="flex items-center justify-between gap-2">
      <span
        className={`min-w-0 truncate text-xs ${
          waiting
            ? "italic text-stone-400 dark:text-slate-500"
            : won
              ? "font-black text-stone-900 dark:text-slate-100"
              : "font-bold text-stone-600 dark:text-slate-400"
        }`}
      >
        {waiting ? label || "TBD" : name}
      </span>
      <span className={`shrink-0 text-xs font-black ${won ? "text-emerald-600 dark:text-emerald-400" : "text-stone-400"}`}>
        {score ?? "–"}
      </span>
    </p>
  );
}
