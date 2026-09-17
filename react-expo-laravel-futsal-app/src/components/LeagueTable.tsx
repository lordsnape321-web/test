"use client";

import { Trophy, Medal, Target } from "lucide-react";
import type { StandingRow } from "@/lib/league";
import { initials } from "@/lib/futsal";
import Link from "next/link";

/**
 * The league table 📊
 *
 * Real results only: a fixture without a score is a fixture, not a row, so a
 * table that appears here is one somebody actually earned. `form` carries the
 * last five results — the first thing anyone looks at after the points column.
 */
export function LeagueTable({
  standings,
  highlightTeamIds = [],
  emptyHint = "The table fills up as results come in.",
}: {
  standings: StandingRow[];
  highlightTeamIds?: number[];
  emptyHint?: string;
}) {
  if (standings.length === 0)
    return (
      <p className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-xs font-bold text-stone-400 dark:border-white/10 dark:text-stone-500">
        {emptyHint}
      </p>
    );

  return (
    <div className="overflow-hidden rounded-2xl border border-[#F0E3CC] dark:border-white/10">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead className="bg-emerald-700 text-[10px] font-black uppercase tracking-wider text-emerald-50">
            <tr>
              <th className="px-3 py-2.5">#</th>
              <th className="px-2 py-2.5">Squad</th>
              <th className="px-2 py-2.5 text-center">P</th>
              <th className="px-2 py-2.5 text-center">W</th>
              <th className="px-2 py-2.5 text-center">D</th>
              <th className="px-2 py-2.5 text-center">L</th>
              <th className="px-2 py-2.5 text-center">GF</th>
              <th className="px-2 py-2.5 text-center">GA</th>
              <th className="px-2 py-2.5 text-center">GD</th>
              <th className="px-3 py-2.5 text-center">Pts</th>
              <th className="px-3 py-2.5">Form</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white dark:divide-white/5 dark:bg-stone-900">
            {standings.map((row, i) => {
              const mine = highlightTeamIds.includes(row.teamId);
              return (
                <tr
                  key={row.teamId}
                  className={mine ? "bg-emerald-50/70 dark:bg-emerald-500/10" : ""}
                >
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      {i === 0 ? (
                        <Trophy className="h-3.5 w-3.5 text-amber-500" />
                      ) : i === 1 ? (
                        <Medal className="h-3.5 w-3.5 text-stone-400" />
                      ) : i === 2 ? (
                        <Medal className="h-3.5 w-3.5 text-orange-400" />
                      ) : null}
                      <span className="text-xs font-black text-stone-500 dark:text-stone-400">
                        {i + 1}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <Link
                      href={`/teams/${row.teamId}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[10px] font-black text-white shadow"
                        style={{ background: row.logoColor }}
                      >
                        {initials(row.name)}
                      </span>
                      <span className="truncate text-xs font-bold text-stone-800 dark:text-stone-100">
                        {row.name}
                        {mine && (
                          <span className="ml-1.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black text-white">
                            YOU
                          </span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-center text-xs font-bold text-stone-600 dark:text-stone-300">
                    {row.played}
                  </td>
                  <td className="px-2 py-2 text-center text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {row.won}
                  </td>
                  <td className="px-2 py-2 text-center text-xs font-bold text-stone-500 dark:text-stone-400">
                    {row.drawn}
                  </td>
                  <td className="px-2 py-2 text-center text-xs font-bold text-red-500">{row.lost}</td>
                  <td className="px-2 py-2 text-center text-xs font-bold text-stone-600 dark:text-stone-300">
                    {row.goalsFor}
                  </td>
                  <td className="px-2 py-2 text-center text-xs font-bold text-stone-600 dark:text-stone-300">
                    {row.goalsAgainst}
                  </td>
                  <td className="px-2 py-2 text-center text-xs font-bold text-stone-600 dark:text-stone-300">
                    {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      {row.points}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex gap-1">
                      {row.form.length === 0 && (
                        <span className="text-[10px] font-bold text-stone-300 dark:text-stone-600">
                          —
                        </span>
                      )}
                      {row.form.map((f, k) => (
                        <span
                          key={k}
                          title={f === "W" ? "Won" : f === "D" ? "Drew" : "Lost"}
                          className={`grid h-4 w-4 place-items-center rounded text-[9px] font-black text-white ${
                            f === "W" ? "bg-emerald-600" : f === "D" ? "bg-stone-400" : "bg-red-500"
                          }`}
                        >
                          {f}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The prize split, rendered as the host wrote it — a list, not a paragraph. */
export function PrizeBreakdown({
  lines,
  prizePool,
}: {
  lines: Array<{ place: string; prize: string }>;
  prizePool: number;
}) {
  if (lines.length === 0 && prizePool <= 0) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 dark:border-amber-500/25 dark:from-amber-500/10 dark:to-orange-500/10">
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
        <Target className="h-3.5 w-3.5" /> Prize pool
      </p>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm font-bold text-stone-600 dark:text-stone-300">
          Bragging rights and a trophy 🏆
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {lines.map((l, i) => (
            <li
              key={`${l.place}-${i}`}
              className="flex items-baseline justify-between gap-3 border-b border-amber-200/60 pb-1 text-sm last:border-0 dark:border-amber-500/20"
            >
              <span className="font-black text-stone-700 dark:text-stone-200">{l.place}</span>
              <span className="font-bold text-amber-800 dark:text-amber-300">{l.prize}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
