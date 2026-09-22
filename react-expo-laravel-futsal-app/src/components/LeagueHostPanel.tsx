"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Banknote,
  Check,
  Coins,
  Crown,
  Eye,
  Loader2,
  Send,
  Settings,
  ShieldCheck,
  Trophy,
  UserX,
  X,
} from "lucide-react";
import type { LeagueDetail } from "@/lib/league-store";
import {
  TEAM_APPROVED,
  TEAM_INVITED,
  TEAM_REQUESTED,
  clampAmountInput,
  entryStatusLabel,
} from "@/lib/league";
import { formatNPR } from "@/lib/futsal";
import { timeAgo } from "./NotificationBell";
import { PaymentLine } from "./LeagueCard";
import { ReceiptViewer } from "./ReceiptUploader";

type TeamOption = { id: number; name: string; teamCode: string; captainName: string };

/**
 * The host's control room 👑
 *
 * Whoever hosts — a player or a venue owner — runs the league from exactly this
 * panel: the entry desk (requests, invitations, the deposit gate), the ledger
 * (who has paid what, cash recorded by hand), and the settings door.
 */
export function LeagueHostPanel({
  league,
  hostId,
  onChanged,
  onEdit,
}: {
  league: LeagueDetail;
  hostId: number;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviteMatches, setInviteMatches] = useState<TeamOption[]>([]);
  const [recordFor, setRecordFor] = useState<number | null>(null);
  const [viewReceipt, setViewReceipt] = useState("");
  const [cashAmount, setCashAmount] = useState("");

  const entries = league.allTeams;
  const pending = useMemo(
    () => entries.filter((e) => e.status === TEAM_REQUESTED || e.status === TEAM_INVITED),
    [entries]
  );
  const admitted = useMemo(() => entries.filter((e) => e.status === TEAM_APPROVED), [entries]);
  const settled = useMemo(
    () => admitted.reduce((sum, e) => sum + e.paidAmount, 0),
    [admitted]
  );
  const refunded = useMemo(
    () => entries.reduce((sum, e) => sum + e.refundedAmount, 0),
    [entries]
  );
  const full = admitted.length >= league.maxTeams;

  async function act(label: string, body: Record<string, unknown>, url = `/api/tournaments/${league.id}/teams`) {
    setBusy(label);
    setMsg("");
    setErr("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data.error ?? "That didn't work 🙏"));
      setMsg(String(data.message ?? "Done ✅"));
      setRecordFor(null);
      setCashAmount("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  async function searchTeams() {
    const q = inviteCode.trim();
    if (!q) return;
    try {
      const res = await fetch(`/api/teams?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setInviteMatches(
        ((data.teams ?? []) as Array<{ id: number; name: string; teamCode: string; captainName: string }>)
          .filter((t) => !entries.some((e) => e.teamId === t.id && e.status === TEAM_APPROVED))
          .slice(0, 6)
          .map((t) => ({ id: t.id, name: t.name, teamCode: t.teamCode, captainName: t.captainName }))
      );
    } catch {
      setInviteMatches([]);
    }
  }

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------------- money row */}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { l: "In the till", v: formatNPR(settled), i: Banknote },
          { l: "Refunded out", v: formatNPR(refunded), i: Coins },
          { l: "Prize pool", v: formatNPR(league.prizePool), i: Trophy },
          { l: "Squads", v: `${admitted.length}/${league.maxTeams}`, i: BadgeCheck },
        ].map((s) => (
          <div
            key={s.l}
            className="rounded-2xl border border-[#F0E3CC] bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-slate-900"
          >
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-stone-400 dark:text-slate-500">
              <s.i className="h-3 w-3" /> {s.l}
            </p>
            <p className="mt-1 text-lg font-black text-stone-900 dark:text-slate-100">{s.v}</p>
          </div>
        ))}
      </div>

      {(msg || err) && (
        <p
          className={`rounded-2xl px-4 py-3 text-xs font-bold ${
            err
              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          }`}
        >
          {err || msg}
        </p>
      )}

      {/* ------------------------------------------------------- entry desk */}
      <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
            <Crown className="h-3.5 w-3.5" /> Entry desk
            {pending.length > 0 && (
              <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] text-white">
                {pending.length} waiting
              </span>
            )}
          </h2>
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-xl border border-stone-200 px-3.5 py-2 text-[11px] font-black text-stone-600 transition hover:bg-stone-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            <Settings className="h-3.5 w-3.5" /> League settings
          </button>
        </div>

        {pending.length === 0 ? (
          <p className="mt-3 text-xs font-semibold text-stone-400 dark:text-slate-500">
            No squad is waiting. Requests land here the moment a captain asks, and invitations land in
            their notifications the moment you send one.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {pending.map((e) => {
              const label = entryStatusLabel(e.status);
              const gate = e.payment.depositMet;
              return (
                <li
                  key={e.teamId}
                  className="rounded-2xl border border-[#F0E3CC] p-3 dark:border-white/10"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-stone-900 dark:text-slate-100">
                        <Link href={`/teams/${e.teamId}`} className="hover:underline">
                          {e.name}
                        </Link>{" "}
                        <span className="font-mono text-[10px] font-bold text-stone-400">
                          {e.teamCode}
                        </span>
                      </p>
                      <p className="text-[11px] font-bold text-stone-500 dark:text-slate-400">
                        {label.emoji} {label.label} • {e.captainName} • {e.memberCount} players •{" "}
                        {e.createdAt ? timeAgo(e.createdAt) : ""}
                      </p>
                      {e.message && (
                        <p className="mt-1 line-clamp-2 text-[11px] italic text-stone-500 dark:text-slate-400">
                          “{e.message}”
                        </p>
                      )}
                      <p className="mt-1">
                        <PaymentLine
                          entryFee={league.entryFee}
                          paidAmount={e.paidAmount}
                          refundedAmount={e.refundedAmount}
                          depositPercent={league.depositPercent}
                          refundPercent={league.refundPercent}
                          locked={e.payment.locked}
                        />
                      </p>
                      {/* How they're paying, and the proof if they attached any —
                          which is what a host looks at before tapping Approve. */}
                      {(e.payMethod || e.receiptUrl) && (
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-stone-500 dark:text-slate-400">
                          {e.payMethod && (
                            <span className="rounded-lg bg-stone-100 px-2 py-0.5 font-black text-stone-600 dark:bg-white/10 dark:text-slate-300">
                              {e.payMethod === "eSewa" ? "💚" : e.payMethod === "Khalti" ? "💜" : "💵"} {e.payMethod}
                            </span>
                          )}
                          {e.receiptUrl && (
                            <button
                              onClick={() => setViewReceipt(e.receiptUrl)}
                              className="flex items-center gap-1 rounded-lg border border-emerald-300 px-2 py-0.5 font-black text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300"
                            >
                              <Eye className="h-3 w-3" /> Payment screenshot
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => void act(`approve-${e.teamId}`, { action: "approve", teamId: e.teamId })}
                        disabled={busy !== ""}
                        title={
                          gate
                            ? "Let them in"
                            : `Deposit of ${formatNPR(e.payment.deposit)} hasn't arrived yet`
                        }
                        className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-[11px] font-black text-white transition disabled:opacity-50 ${
                          gate ? "bg-emerald-600 hover:bg-emerald-700" : "bg-stone-400"
                        }`}
                      >
                        {busy === `approve-${e.teamId}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        {e.status === TEAM_REQUESTED ? "Approve" : "Accept entry"}
                      </button>
                      <button
                        onClick={() =>
                          setRecordFor(recordFor === e.teamId ? null : e.teamId)
                        }
                        className="flex items-center gap-1 rounded-xl border border-stone-200 px-3.5 py-2 text-[11px] font-black text-stone-600 transition hover:bg-stone-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                      >
                        <Banknote className="h-3.5 w-3.5" /> Record cash
                      </button>
                      <button
                        onClick={() => void act(`reject-${e.teamId}`, { action: "reject", teamId: e.teamId })}
                        disabled={busy !== ""}
                        className="flex items-center gap-1 rounded-xl border border-red-200 px-3.5 py-2 text-[11px] font-black text-red-500 transition hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
                      >
                        <X className="h-3.5 w-3.5" /> {e.status === TEAM_INVITED ? "Cancel invite" : "Decline"}
                      </button>
                    </div>
                  </div>

                  {recordFor === e.teamId && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-[#FFF6E9] p-2.5 dark:bg-white/5">
                      {/* Capped at what this squad still owes: a host counting
                          cash shouldn't be able to key in more than the entry
                          fee, because the ledger and the refund maths both
                          believe this number. */}
                      <input
                        type="number"
                        min={1}
                        max={Math.max(0, e.payment.due)}
                        value={cashAmount}
                        onChange={(ev) => setCashAmount(clampAmountInput(ev.target.value, e.payment.due))}
                        placeholder={`Up to ${formatNPR(Math.max(0, e.payment.due))} owed`}
                        className="min-w-[10rem] flex-1 rounded-xl border border-[#F0E3CC] bg-white px-3 py-2 text-xs font-semibold dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                      />
                      <span className="text-[10px] font-black uppercase tracking-wider text-stone-400 dark:text-slate-500">
                        {formatNPR(Math.max(0, e.payment.due))} owed of {formatNPR(league.entryFee)}
                      </span>
                      <button
                        onClick={() =>
                          void act(
                            `record-${e.teamId}`,
                            {
                              action: "record",
                              teamId: e.teamId,
                              amount:
                                Number(clampAmountInput(cashAmount, e.payment.due)) || e.payment.deposit,
                              method: "Cash at Venue",
                            },
                            `/api/tournaments/${league.id}/payments`
                          )
                        }
                        disabled={busy !== ""}
                        className="rounded-xl bg-stone-900 px-4 py-2 text-[11px] font-black text-white transition hover:bg-stone-800 dark:bg-white dark:text-slate-900"
                      >
                        {busy === `record-${e.teamId}` ? "Saving…" : "Record it"}
                      </button>
                      <button
                        onClick={() =>
                          void act(
                            `record-${e.teamId}`,
                            {
                              action: "record",
                              teamId: e.teamId,
                              amount: e.payment.due || e.payment.deposit,
                              method: "Cash at Venue",
                            },
                            `/api/tournaments/${league.id}/payments`
                          )
                        }
                        disabled={busy !== ""}
                        className="rounded-xl border border-stone-200 px-3.5 py-2 text-[11px] font-black text-stone-600 dark:border-white/10 dark:text-slate-300"
                      >
                        Full {formatNPR(e.payment.due || e.payment.deposit)}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* ------------------------------------------------------- invitations */}
        <div className="mt-4 rounded-2xl border border-dashed border-emerald-300 p-3.5 dark:border-emerald-500/30">
          <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
            <Send className="h-3.5 w-3.5" /> Invite a squad
          </p>
          <p className="mt-1 text-[11px] font-semibold text-stone-500 dark:text-slate-400">
            Search by the squad's code or name. A private league can only be entered this way — and
            paying the deposit is how the invited captain accepts.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void searchTeams();
                }
              }}
              placeholder="CHARGERS-4X7K"
              className="min-w-[12rem] flex-1 rounded-xl border border-[#F0E3CC] bg-[#FFFDF7] px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            />
            <button
              onClick={() => void searchTeams()}
              className="rounded-xl bg-stone-900 px-4 py-2 text-[11px] font-black text-white transition hover:bg-stone-800 dark:bg-white dark:text-slate-900"
            >
              Find
            </button>
          </div>
          {inviteMatches.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {inviteMatches.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 dark:bg-slate-950"
                >
                  <span className="text-xs font-bold text-stone-800 dark:text-slate-100">
                    {t.name} <span className="font-mono text-[10px] text-stone-400">{t.teamCode}</span>
                    <span className="ml-1 text-[10px] font-semibold text-stone-400">
                      captain {t.captainName}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <input
                      value={inviteNote}
                      onChange={(e) => setInviteNote(e.target.value)}
                      placeholder="Note (optional)"
                      className="w-32 rounded-lg border border-[#F0E3CC] px-2 py-1 text-[10px] dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <button
                      onClick={() =>
                        void act(`invite-${t.id}`, { action: "invite", teamId: t.id, message: inviteNote })
                      }
                      disabled={busy !== "" || full}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {full ? "Full" : "Invite"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- squad ledger */}
      <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" /> Squads &amp; payments
        </h2>
        <ul className="mt-3 space-y-2">
          {entries.map((e) => {
            const label = entryStatusLabel(e.status);
            return (
              <li
                key={e.teamId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#F0E3CC] px-3.5 py-2.5 dark:border-white/10"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-stone-900 dark:text-slate-100">
                    {e.name}
                    <span className="ml-2 text-[11px] font-black text-stone-400">
                      {label.emoji} {label.label}
                    </span>
                  </p>
                  <PaymentLine
                    entryFee={league.entryFee}
                    paidAmount={e.paidAmount}
                    refundedAmount={e.refundedAmount}
                    depositPercent={league.depositPercent}
                    refundPercent={league.refundPercent}
                    locked={e.payment.locked}
                  />
                  {e.payment.locked && (
                    <span className="mt-0.5 block text-[10px] font-semibold text-stone-400 dark:text-slate-500">
                      🔒 They&apos;ve played — nothing is refundable on the way out.
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {e.status === TEAM_APPROVED && (
                    <button
                      onClick={() =>
                        void act(`withdraw-${e.teamId}`, {
                          action: "withdraw",
                          hostId,
                          teamId: e.teamId,
                        })
                      }
                      disabled={busy !== ""}
                      className="flex items-center gap-1 rounded-xl border border-stone-200 px-3 py-1.5 text-[10px] font-black text-stone-500 transition hover:bg-stone-100 dark:border-white/10 dark:text-slate-400"
                    >
                      <UserX className="h-3 w-3" />
                      {/* A squad that has played can be taken out, but their money
                          stays — the refund died at the first kick-off. */}
                      {e.payment.locked
                        ? "Remove (no refund)"
                        : `Remove & refund ${league.refundPercent}%`}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ------------------------------------------------------------- ledger */}
      <div className="rounded-3xl border border-[#F0E3CC] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          <Banknote className="h-3.5 w-3.5" /> Ledger
        </h2>
        {league.payments.length === 0 ? (
          <p className="mt-3 text-xs font-semibold text-stone-400 dark:text-slate-500">
            Nothing has moved yet. Every eSewa/Khalti payment a captain makes lands here, and so does
            every rupee of cash you record.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-100 dark:divide-white/5">
            {league.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-stone-800 dark:text-slate-100">
                    {p.teamName}{" "}
                    <span className="font-semibold text-stone-400">
                      {p.kind === "entry" ? "paid in" : p.kind === "refund" ? "refunded" : "prize"}
                    </span>
                  </span>
                  <span className="block text-[10px] font-semibold text-stone-400 dark:text-slate-500">
                    {p.method}
                    {p.reference ? ` • ${p.reference}` : ""} • {p.createdAt ? timeAgo(p.createdAt) : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-sm font-black ${
                    p.kind === "entry"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-orange-500 dark:text-orange-400"
                  }`}
                >
                  {p.kind === "entry" ? "+" : "−"}
                  {formatNPR(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewReceipt && <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt("")} />}
    </div>
  );
}
