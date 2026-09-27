"use client";
import { ThemedSelect } from "@/components/ThemedSelect";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  Camera,
  Check,
  Loader2,
  MapPin,
  Shuffle,
  Trash2,
  Trophy,
} from "lucide-react";
import type { LeagueDetail, LeagueMatchRow } from "@/lib/league-store";
import { LEAGUE_ROUNDS, leagueDateLabel, leagueModeLabel, modeHasBracket } from "@/lib/league";
import { formatTime12, initials } from "@/lib/futsal";
import { apiFetch } from "@/lib/api";

/**
 * Fixtures & results ⚽
 *
 * The host writes the calendar (or lets the button draw a round robin) and taps
 * in the score after each game; everybody in the league reads it. A result
 * recorded here is the same result that shows on the squads' profiles and moves
 * the table above — there is only one place a score lives.
 */
export function LeagueFixtures({
  league,
  hostId,
  isHost,
  onChanged,
  onOpenAlbum,
}: {
  league: LeagueDetail;
  hostId: number;
  isHost: boolean;
  onChanged: () => void;
  onOpenAlbum?: (matchId: number) => void;
}) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [homeTeamId, setHomeTeamId] = useState("");
  const [awayTeamId, setAwayTeamId] = useState("");
  const [round, setRound] = useState<string>(LEAGUE_ROUNDS[0]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [scores, setScores] = useState<Record<number, { home: string; away: string }>>({});

  const squads = league.teams;
  const modeInfo = leagueModeLabel(league.mode);
  const drawLabel = modeHasBracket(league.mode)
    ? league.mode === "group_knockout"
      ? "Draw groups + bracket"
      : "Draw the bracket"
    : "Draw the round robin";
  const { upcoming, results } = useMemo(() => {
    const played = league.matches.filter((m) => m.homeScore !== null && m.awayScore !== null);
    const rest = league.matches.filter((m) => m.homeScore === null || m.awayScore === null);
    return {
      results: [...played].sort((a, b) => String(b.date).localeCompare(String(a.date))),
      upcoming: [...rest].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    };
  }, [league.matches]);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMsg("");
    setErr("");
    try {
      const res = await apiFetch(`/api/tournaments/${league.id}/matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error ?? "That didn't work 🙏"));
      setMsg(String(data.message ?? "Saved ✅"));
      setShowAdd(false);
      setHomeTeamId("");
      setAwayTeamId("");
      setDate("");
      setStartTime("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  function scoreValue(m: LeagueMatchRow, side: "home" | "away") {
    const local = scores[m.id];
    if (local) return local[side];
    const v = side === "home" ? m.homeScore : m.awayScore;
    return v === null ? "" : String(v);
  }

  return (
    <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          <Trophy className="h-3.5 w-3.5" /> Fixtures &amp; results
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
            {modeInfo.emoji} {modeInfo.label}
          </span>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-black text-stone-500 dark:bg-white/10 dark:text-slate-300">
            {league.playedMatches}/{league.totalMatches || 0} played
          </span>
        </h2>
        {isHost && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => void post({ action: "generate" }, "generate")}
              disabled={busy !== "" || squads.length < 2}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-300 px-3.5 py-2 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
            >
              {busy === "generate" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Shuffle className="h-3.5 w-3.5" />
              )}
              {drawLabel}
            </button>
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-[11px] font-black text-white transition hover:bg-emerald-700"
            >
              <CalendarPlus className="h-3.5 w-3.5" /> Add a fixture
            </button>
          </div>
        )}
      </div>

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

      {isHost && showAdd && (
        <div className="mt-3 grid gap-2 rounded-2xl border border-[#F0E3CC] bg-[#FFF6E9] p-3 dark:border-white/10 dark:bg-white/5 sm:grid-cols-2">
          {/* A squad can't play itself, so each list hides whoever is already
              picked on the other side — the server refuses it too, but the
              option shouldn't have been there to click. */}
          <ThemedSelect
            value={homeTeamId}
            onChange={(e) => setHomeTeamId(e.target.value)}
            className="rounded-xl border border-[#F0E3CC] bg-white px-3 py-2 text-xs font-bold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">Home squad…</option>
            {squads
              .filter((s) => String(s.teamId) !== awayTeamId)
              .map((s) => (
                <option key={s.teamId} value={s.teamId}>
                  {s.name}
                </option>
              ))}
          </ThemedSelect>
          <ThemedSelect
            value={awayTeamId}
            onChange={(e) => setAwayTeamId(e.target.value)}
            className="rounded-xl border border-[#F0E3CC] bg-white px-3 py-2 text-xs font-bold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="">Away squad…</option>
            {squads
              .filter((s) => String(s.teamId) !== homeTeamId)
              .map((s) => (
                <option key={s.teamId} value={s.teamId}>
                  {s.name}
                </option>
              ))}
          </ThemedSelect>
          <ThemedSelect
            value={round}
            onChange={(e) => setRound(e.target.value)}
            className="rounded-xl border border-[#F0E3CC] bg-white px-3 py-2 text-xs font-bold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
          >
            {LEAGUE_ROUNDS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </ThemedSelect>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-[#F0E3CC] bg-white px-3 py-2 text-xs font-bold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            />
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-xl border border-[#F0E3CC] bg-white px-3 py-2 text-xs font-bold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <button
            onClick={() =>
              void post(
                {
                  action: "create",
                  homeTeamId: Number(homeTeamId),
                  awayTeamId: Number(awayTeamId),
                  round,
                  date,
                  startTime,
                },
                "create"
              )
            }
            disabled={busy !== "" || !homeTeamId || !awayTeamId || homeTeamId === awayTeamId}
            className="rounded-xl bg-stone-900 px-4 py-2.5 text-xs font-black text-white transition hover:bg-stone-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 sm:col-span-2"
          >
            {busy === "create"
              ? "Adding…"
              : homeTeamId && homeTeamId === awayTeamId
                ? "Pick two different squads 🙂"
                : "Add fixture 📅"}
          </button>
        </div>
      )}

      {league.matches.length === 0 && (
        <p className="mt-3 rounded-2xl border border-dashed border-stone-300 px-4 py-6 text-center text-xs font-bold text-stone-400 dark:border-white/10 dark:text-slate-500">
          No fixtures yet.{" "}
          {isHost
            ? league.mode === "knockout"
              ? "Draw the bracket and every round appears, byes included."
              : league.mode === "group_knockout"
                ? "Draw the groups and the bracket — the knockout fills itself as the groups finish."
                : "Draw the round robin and every squad plays every other once."
            : "The host will publish the calendar soon."}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {upcoming.map((m) => (
          <li key={m.id} className="rounded-2xl border border-[#F0E3CC] p-3 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-orange-500 dark:text-orange-400">
                  {m.round} • {leagueDateLabel(m.date)}
                  {m.startTime ? ` • ${formatTime12(m.startTime)}` : ""}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-black text-stone-900 dark:text-slate-100">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="grid h-6 w-6 place-items-center rounded-lg text-[9px] font-black text-white"
                      style={{ background: m.homeLogoColor }}
                    >
                      {initials(m.homeTeamName)}
                    </span>
                    {m.homeTeamName}
                  </span>
                  <span className="text-stone-400">vs</span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="grid h-6 w-6 place-items-center rounded-lg text-[9px] font-black text-white"
                      style={{ background: m.awayLogoColor }}
                    >
                      {initials(m.awayTeamName)}
                    </span>
                    {m.awayTeamName}
                  </span>
                </p>
                {m.notes && (
                  <p className="mt-1 text-[11px] font-semibold text-stone-400 dark:text-slate-500">
                    {m.notes}
                  </p>
                )}
              </div>
              {!isHost && (
                <span className="rounded-full bg-[#FFF6E9] px-3 py-1.5 text-[10px] font-black text-stone-500 dark:bg-white/5 dark:text-slate-400">
                  Awaiting kickoff
                </span>
              )}
            </div>

            {isHost && m.bracketRound > 0 && (m.homeTeamId === 0 || m.awayTeamId === 0) && (
              <p className="mt-2 rounded-xl bg-stone-50 px-3 py-2 text-[11px] font-bold text-stone-400 dark:bg-white/5 dark:text-slate-500">
                ⏳ Waiting on the game before it — the squad lands here as soon as that result is in.
              </p>
            )}

            {isHost && m.bracketRound > 0 && m.homeTeamId > 0 && m.awayTeamId > 0 && (
              <ScheduleRow
                match={m}
                busy={busy === `schedule-${m.id}`}
                onSave={(date, startTime) =>
                  void post({ action: "schedule", matchId: m.id, date, startTime }, `schedule-${m.id}`)
                }
              />
            )}

            {isHost && m.homeTeamId > 0 && m.awayTeamId > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={scoreValue(m, "home")}
                  onChange={(e) =>
                    setScores((p) => ({
                      ...p,
                      [m.id]: { home: e.target.value, away: p[m.id]?.away ?? scoreValue(m, "away") },
                    }))
                  }
                  placeholder="0"
                  className="w-14 rounded-xl border border-[#F0E3CC] px-2 py-1.5 text-center text-sm font-black dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                />
                <span className="text-xs font-black text-stone-400">–</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={scoreValue(m, "away")}
                  onChange={(e) =>
                    setScores((p) => ({
                      ...p,
                      [m.id]: { home: p[m.id]?.home ?? scoreValue(m, "home"), away: e.target.value },
                    }))
                  }
                  placeholder="0"
                  className="w-14 rounded-xl border border-[#F0E3CC] px-2 py-1.5 text-center text-sm font-black dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  onClick={() =>
                    void post(
                      {
                        action: "score",
                        matchId: m.id,
                        homeScore: scoreValue(m, "home") === "" ? "" : Number(scoreValue(m, "home")),
                        awayScore: scoreValue(m, "away") === "" ? "" : Number(scoreValue(m, "away")),
                      },
                      `score-${m.id}`
                    )
                  }
                  disabled={busy !== ""}
                  className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-2 text-[11px] font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy === `score-${m.id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save score
                </button>
                <button
                  onClick={() => void post({ action: "delete", matchId: m.id }, `del-${m.id}`)}
                  disabled={busy !== ""}
                  className="rounded-xl border border-stone-200 px-3 py-2 text-[11px] font-black text-stone-500 transition hover:bg-stone-100 dark:border-white/10 dark:text-slate-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                {onOpenAlbum && (
                  <button
                    onClick={() => onOpenAlbum(m.id)}
                    className="flex items-center gap-1 rounded-xl border border-stone-200 px-3 py-2 text-[11px] font-black text-stone-500 transition hover:bg-stone-100 dark:border-white/10 dark:text-slate-400"
                  >
                    <Camera className="h-3.5 w-3.5" /> Photos
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {results.length > 0 && (
        <>
          <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-stone-400 dark:text-slate-500">
            Results
          </p>
          <ul className="mt-2 space-y-2">
            {results.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#FFF6E9] px-3.5 py-2.5 dark:bg-white/5"
              >
                <span className="flex flex-wrap items-center gap-2 text-sm font-bold text-stone-800 dark:text-slate-100">
                  <span
                    className={`${
                      Number(m.homeScore) > Number(m.awayScore) ? "font-black text-emerald-700 dark:text-emerald-300" : ""
                    }`}
                  >
                    {m.homeTeamName}
                  </span>
                  <span className="rounded-lg bg-white px-2.5 py-1 text-sm font-black text-stone-900 shadow-sm dark:bg-slate-900 dark:text-slate-100">
                    {m.homeScore}–{m.awayScore}
                  </span>
                  <span
                    className={`${
                      Number(m.awayScore) > Number(m.homeScore) ? "font-black text-emerald-700 dark:text-emerald-300" : ""
                    }`}
                  >
                    {m.awayTeamName}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-stone-400 dark:text-slate-500">
                    {m.round} • {leagueDateLabel(m.date)}
                  </span>
                  {isHost && (
                    <button
                      onClick={() => void post({ action: "score", matchId: m.id, homeScore: "", awayScore: "" }, `clear-${m.id}`)}
                      disabled={busy !== ""}
                      title="Clear the score (a mistake)"
                      className="rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-black text-stone-500 transition hover:bg-white dark:border-white/10 dark:text-slate-400"
                    >
                      Fix
                    </button>
                  )}
                  {onOpenAlbum && m.mediaCount > 0 && (
                    <button
                      onClick={() => onOpenAlbum(m.id)}
                      className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-black text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-emerald-300"
                    >
                      <Camera className="h-3 w-3" /> {m.mediaCount}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {league.venueName && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-stone-400 dark:text-slate-500">
          <MapPin className="h-3 w-3" /> All fixtures at{" "}
          <Link href={`/venues/${league.venueId}`} className="underline hover:text-emerald-600">
            {league.venueName}
          </Link>
          {league.matchDays ? ` • ${league.matchDays}` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * A kick-off time for one bracket game ⏰
 *
 * A drawn bracket arrives with the shape but no clock — the host decides which
 * round plays on which Saturday, and can do it before the slots are full, so
 * "Semi-final 2, Sunday 9 AM" can be on the fixture list while it still reads
 * "Winner Group A".
 */
function ScheduleRow({
  match,
  busy,
  onSave,
}: {
  match: LeagueMatchRow;
  busy: boolean;
  onSave: (date: string, startTime: string) => void;
}) {
  const [date, setDate] = useState(match.date);
  const [startTime, setStartTime] = useState(match.startTime);
  const changed = date !== match.date || startTime !== match.startTime;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-xl border border-[#F0E3CC] px-2 py-1 text-[11px] font-bold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
      />
      <input
        type="time"
        value={startTime}
        onChange={(e) => setStartTime(e.target.value)}
        className="rounded-xl border border-[#F0E3CC] px-2 py-1 text-[11px] font-bold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
      />
      <button
        onClick={() => onSave(date, startTime)}
        disabled={busy || !changed || (!date && !startTime)}
        className="rounded-xl border border-stone-200 px-3 py-1 text-[11px] font-black text-stone-600 transition hover:bg-stone-100 disabled:opacity-40 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
      >
        {busy ? "Saving…" : changed ? "Set kick-off 📅" : "Kick-off set ✓"}
      </button>
    </div>
  );
}
