"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Check,
  Coins,
  Loader2,
  Lock,
  LogOut,
  Send,
  ShieldCheck,
  Trophy,
  Wallet,
  X,
} from "lucide-react";
import type { LeagueDetail } from "@/lib/league-store";
import { TEAM_APPROVED, TEAM_INVITED, TEAM_REQUESTED, entryStatusLabel } from "@/lib/league";
import { formatNPR } from "@/lib/futsal";
import { PaymentLine } from "./LeagueCard";
import { ReceiptUploader, isOnlineMethod } from "./ReceiptUploader";

/** The three media a booking offers — a league entry is the same money. */
const LEAGUE_PAY_METHODS = ["eSewa", "Khalti", "Cash at Venue"];

type CaptainTeam = { id: number; name: string; logoColor: string; role: string };

/**
 * The captain's side of a league 🤝
 *
 * One panel per squad the viewer belongs to, with the single next action spelled
 * out: ask to join, accept an invitation by paying the deposit, settle what's
 * left, or leave and take the 10% back. The rules the server enforces are the
 * same ones written here — the panel just says them before you press anything.
 */
export function LeagueSquadPanel({
  league,
  viewerId,
  onChanged,
}: {
  league: LeagueDetail;
  viewerId: number;
  onChanged: () => void;
}) {
  const [myTeams, setMyTeams] = useState<CaptainTeam[]>([]);
  const [busy, setBusy] = useState("");
  // Which wallet the captain reaches for, per squad — the same choice a
  // booking asks for, and it sticks while they're on the page.
  const [methodByTeam, setMethodByTeam] = useState<Record<number, string>>({});
  const [receiptByTeam, setReceiptByTeam] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!viewerId) return;
    (async () => {
      try {
        const res = await fetch(`/api/teams?userId=${viewerId}`);
        const data = await res.json();
        setMyTeams(
          ((data.teams ?? []) as Array<{ id: number; name: string; logoColor: string; role: string }>).map(
            (t) => ({ id: t.id, name: t.name, logoColor: t.logoColor, role: t.role })
          )
        );
      } catch {
        setMyTeams([]);
      }
    })();
  }, [viewerId]);

  const entryByTeam = useMemo(() => {
    const map = new Map<number, LeagueDetail["viewer"] extends null ? never : NonNullable<LeagueDetail["viewer"]>["myTeams"][number]>();
    for (const m of league.viewer?.myTeams ?? []) map.set(m.teamId, m);
    return map;
  }, [league.viewer]);

  if (!viewerId) return null;

  const closed = league.status === "completed" || league.status === "cancelled";
  const full = league.approvedTeams >= league.maxTeams;

  async function act(label: string, body: Record<string, unknown>, url = `/api/tournaments/${league.id}/teams`) {
    setBusy(label);
    setMsg("");
    setErr("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error ?? "That didn't work 🙏"));
      setMsg(String(data.message ?? "Done ✅"));
      setNote("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  const methodFor = (teamId: number) => methodByTeam[teamId] ?? "eSewa";
  const receiptFor = (teamId: number) => receiptByTeam[teamId] ?? "";

  /**
   * Pay through the medium the captain picked 💳
   *
   * eSewa comes back as a form to post, Khalti as a URL to follow — exactly
   * what a booking does. Cash at venue moves no money here: the host records
   * it when they take it, and the screenshot is what bridges the gap.
   */
  async function pay(teamId: number, amount: number, settleAll: boolean) {
    const method = methodFor(teamId);
    if (!isOnlineMethod(method)) {
      setMsg("Hand the cash to the host at the ground and they'll mark it on your entry 💵");
      setErr("");
      return;
    }
    setBusy(`pay-${teamId}`);
    setMsg("");
    setErr("");
    try {
      const res = await fetch(`/api/tournaments/${league.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "initiate",
          userId: viewerId,
          teamId,
          amount,
          method,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error ?? "That didn't work 🙏"));

      if (method === "eSewa") {
        // The simulator is the one that works in a sandbox with no route to
        // rc-epay.esewa.com.np; the real checkout is a form-post away.
        window.location.href = String(data.mockUrl ?? data.url);
        return;
      }
      window.location.href = String(data.payment_url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
      setBusy("");
    }
  }

  /** Save the screenshot on its own, for cash payers and early transfers. */
  async function saveReceipt(teamId: number, dataUrl: string) {
    setReceiptByTeam((m) => ({ ...m, [teamId]: dataUrl }));
    await act(`receipt-${teamId}`, {
      action: "receipt",
      userId: viewerId,
      teamId,
      receiptUrl: dataUrl,
      payMethod: methodFor(teamId),
    }, `/api/tournaments/${league.id}/payments`);
  }

  const rows = myTeams
    .map((team) => ({ team, entry: entryByTeam.get(team.id) }))
    .filter(({ team }) => team.role === "captain" || entryByTeam.has(team.id));

  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 text-sm text-stone-500 shadow-sm dark:border-white/10 dark:bg-stone-900 dark:text-stone-400">
        You need to captain a squad to enter a league.{" "}
        <a href="/teams" className="font-black text-emerald-700 underline dark:text-emerald-400">
          Start or find a team
        </a>{" "}
        first.
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-stone-900">
      <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
        <Trophy className="h-3.5 w-3.5" /> Your squads in this league
      </h2>

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

      <ul className="mt-3 space-y-3">
        {rows.map(({ team, entry }) => {
          const isCaptain = team.role === "captain" || entry?.isCaptain;
          const label = entry ? entryStatusLabel(entry.status) : null;
          const due = entry ? entry.payment.due : league.entryFee;
          return (
            <li
              key={team.id}
              className="rounded-2xl border border-[#F0E3CC] p-3.5 dark:border-white/10"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid h-9 w-9 place-items-center rounded-xl text-[11px] font-black text-white shadow"
                    style={{ background: team.logoColor }}
                  >
                    {team.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-black text-stone-900 dark:text-stone-100">{team.name}</p>
                    <p className="text-[11px] font-bold text-stone-500 dark:text-stone-400">
                      {label ? `${label.emoji} ${label.label}` : "Not entered yet"}
                      {isCaptain ? "" : " • you're not the captain"}
                    </p>
                  </div>
                </div>
                {entry && (
                  <PaymentLine
                    entryFee={league.entryFee}
                    paidAmount={entry.paidAmount}
                    depositPercent={league.depositPercent}
                    refundPercent={league.refundPercent}
                  />
                )}
              </div>

              {/* ------------------------------------------------ pay your way */}
              {/* A squad joining a league picks a medium exactly like a player
                  booking a pitch does — same three, same wording. */}
              {isCaptain && !closed && league.entryFee > 0 && entry && entry.status !== "withdrawn" && (
                <div className="mt-3 rounded-2xl border border-[#F0E3CC] bg-[#FFFDF7] p-3 dark:border-white/10 dark:bg-white/5">
                  <p className="text-[10px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    Pay your way — {league.entryFee > 0 ? `${formatNPR(league.entryFee)} entry` : ""}
                    {entry.payment.due > 0 ? ` • ${formatNPR(entry.payment.due)} left` : " • settled"}
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {LEAGUE_PAY_METHODS.map((m) => {
                      const on = methodFor(team.id) === m;
                      return (
                        <button
                          key={m}
                          onClick={() => setMethodByTeam((map) => ({ ...map, [team.id]: m }))}
                          className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-extrabold transition ${
                            on
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                              : "border-stone-200 bg-stone-50 text-stone-500 dark:border-white/10 dark:bg-white/5 dark:text-stone-400"
                          }`}
                        >
                          <Wallet className="h-3.5 w-3.5" /> {m}
                          {m === "eSewa" ? " 💚" : m === "Khalti" ? " 💜" : " 💵"}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[11px] font-semibold text-stone-400 dark:text-stone-500">
                    {isOnlineMethod(methodFor(team.id))
                      ? `You'll be taken to the ${methodFor(team.id)} checkout — nothing is charged until you confirm there.`
                      : "Cash goes to the host at the ground. They mark it on your entry, so bring the exact amount."}
                  </p>
                  {entry.payment.due > 0 && (
                    <details className="mt-2 rounded-xl border border-stone-200 p-2.5 dark:border-white/10">
                      <summary className="cursor-pointer text-[11px] font-black text-stone-500 dark:text-stone-400">
                        {entry.payment.paid > 0 || receiptFor(team.id)
                          ? "Replace the payment screenshot 🧾"
                          : "Already paid? Attach a screenshot instead (optional) 🧾"}
                      </summary>
                      <div className="mt-2">
                        <ReceiptUploader
                          value={receiptFor(team.id)}
                          onChange={(dataUrl) => void saveReceipt(team.id, dataUrl)}
                          compact
                        />
                      </div>
                    </details>
                  )}
                </div>
              )}

              {isCaptain && !closed && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {/* Not entered yet: ask to join (public) or wait for an invite. */}
                  {!entry && league.visibility === "private" && (
                    <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">
                      <Lock className="h-3.5 w-3.5" /> Private league — the host has to invite this squad.
                    </p>
                  )}
                  {!entry && league.visibility === "public" && (
                    <>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Note to the host (optional)"
                        maxLength={200}
                        className="min-w-[12rem] flex-1 rounded-xl border border-[#F0E3CC] bg-[#FFFDF7] px-3 py-2 text-xs font-semibold text-stone-800 focus:border-emerald-500 focus:outline-none dark:border-white/10 dark:bg-stone-950 dark:text-stone-100"
                      />
                      <button
                        onClick={() => void act(`request-${team.id}`, { action: "request", userId: viewerId, teamId: team.id, message: note })}
                        disabled={busy !== "" || full || league.status === "completed"}
                        className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busy === `request-${team.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        {full ? "League is full" : "Request to join"}
                      </button>
                    </>
                  )}

                  {/* Invited: paying the deposit *is* accepting. */}
                  {entry?.status === TEAM_INVITED && (
                    <>
                      <button
                        onClick={() => void pay(team.id, entry.payment.deposit, false)}
                        disabled={busy !== "" || league.entryFee <= 0}
                        className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busy === `pay-${team.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        )}
                        {league.entryFee > 0
                          ? `Accept & pay ${formatNPR(entry.payment.deposit)} deposit`
                          : "Accept the invitation"}
                      </button>
                      <button
                        onClick={() => void act(`answer-${team.id}`, { action: "reject", hostId: viewerId, teamId: team.id }, `/api/tournaments/${league.id}/teams`)}
                        disabled={busy !== ""}
                        className="flex items-center gap-1.5 rounded-xl border border-stone-200 px-4 py-2 text-xs font-black text-stone-600 transition hover:bg-stone-100 dark:border-white/10 dark:text-stone-300"
                      >
                        <X className="h-3.5 w-3.5" /> Decline
                      </button>
                    </>
                  )}

                  {/* Asked, deposit still missing: this is the captain's move. */}
                  {entry?.status === TEAM_REQUESTED && !entry.payment.depositMet && league.entryFee > 0 && (
                    <button
                      onClick={() => void pay(team.id, entry.payment.deposit, false)}
                      disabled={busy !== ""}
                      className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white transition hover:bg-amber-600 disabled:opacity-50"
                    >
                      <Coins className="h-3.5 w-3.5" />
                      Pay {formatNPR(entry.payment.deposit)} deposit to lock the spot
                    </button>
                  )}

                  {/* In, but not settled: offer the rest (25% chunks or the lot). */}
                  {entry?.status === TEAM_APPROVED && due > 0 && (
                    <>
                      <button
                        onClick={() => void pay(team.id, due, true)}
                        disabled={busy !== ""}
                        className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Coins className="h-3.5 w-3.5" /> Pay the rest {formatNPR(due)}
                      </button>
                      <button
                        onClick={() => void pay(team.id, Math.min(due, Math.max(entry.payment.deposit, 500)), false)}
                        disabled={busy !== ""}
                        className="rounded-xl border border-stone-200 px-4 py-2 text-xs font-black text-stone-600 transition hover:bg-stone-100 dark:border-white/10 dark:text-stone-300"
                      >
                        Pay {formatNPR(Math.min(due, Math.max(entry.payment.deposit, 500)))}
                      </button>
                    </>
                  )}

                  {entry && entry.status !== "withdrawn" && entry.payment.locked && (
                    <span
                      title={entry.payment.lockReason}
                      className="flex items-center gap-1.5 rounded-xl bg-stone-200 px-4 py-2 text-xs font-black text-stone-600 dark:bg-white/10 dark:text-stone-300"
                    >
                      <Lock className="h-3.5 w-3.5" /> Entry locked — you&apos;ve played
                    </span>
                  )}
                  {entry && entry.status !== "withdrawn" && !entry.payment.locked && (
                    <button
                      onClick={() =>
                        void act(`withdraw-${team.id}`, { action: "withdraw", userId: viewerId, teamId: team.id })
                      }
                      disabled={busy !== ""}
                      className="flex items-center gap-1.5 rounded-xl border border-red-200 px-4 py-2 text-xs font-black text-red-500 transition hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      {entry.payment.paid > 0
                        ? `Withdraw (${formatNPR(entry.payment.refundable)} back)`
                        : "Withdraw"}
                    </button>
                  )}
                  {entry?.status === TEAM_APPROVED && due <= 0 && (
                    <span className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <Check className="h-3.5 w-3.5" /> Entry settled — see you on match day
                    </span>
                  )}
                </div>
              )}

              {entry && entry.payment.locked && entry.payment.paid > 0 && (
                <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-stone-100 px-3 py-2 text-[11px] font-bold text-stone-500 dark:bg-white/5 dark:text-stone-400">
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                  {entry.payment.lockReason} The {league.refundPercent}% refund closed when your
                  first match kicked off — the host has a pitch booked and a fixture list built
                  around you.
                </p>
              )}
              {entry && !entry.payment.locked && entry.payment.paid > 0 && (
                <p className="mt-2 text-[11px] font-semibold text-stone-400 dark:text-stone-500">
                  Backing out returns {formatNPR(entry.payment.refundable)} ({league.refundPercent}%
                  of what you paid) — the rest stays with the league. That closes once your first
                  match kicks off 🔒
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
