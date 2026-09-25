"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { formatNPR } from "@/lib/futsal";

export type TeamPaymentDetailPlayer = {
  id: number;
  name: string;
  role?: string;
};

export type TeamPaymentDetailShare = {
  id: number;
  userId: number;
  payerName?: string;
  amountDue: number;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  paidAmount?: number;
  gatewayTxnId?: string | null;
};

export type TeamPaymentDetailRequest = {
  id: number;
  requesterName: string;
  payerId: number;
  payerName: string;
  amountDue: number;
  purpose: string;
  note?: string | null;
  paymentMethod?: string | null;
  status?: string | null;
  paidAmount?: number;
  gatewayTxnId?: string | null;
};

function methodLabel(method?: string | null) {
  if (method === "Cash at Venue") return "Cash at venue";
  if (method === "Free Play 🎁") return "Free play";
  return method || "Not selected";
}

function statusLabel(status?: string | null) {
  return String(status || "pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Captain-only breakdown of the team's payment choices. It is deliberately
 * collapsed on the booking card so the normal diary stays compact, while the
 * captain can open one authoritative section to see every teammate, requested
 * amount, selected method, gateway status, and remaining share.
 */
export function TeamPaymentDetails({
  teamName,
  players,
  shares,
  requests,
}: {
  teamName?: string;
  players: TeamPaymentDetailPlayer[];
  shares: TeamPaymentDetailShare[];
  requests: TeamPaymentDetailRequest[];
}) {
  const [open, setOpen] = useState(false);
  if (players.length === 0 && shares.length === 0 && requests.length === 0) return null;

  const received = shares.reduce((sum, share) => sum + Math.max(0, Number(share.paidAmount) || 0), 0);
  const due = shares.reduce((sum, share) => sum + Math.max(0, Number(share.amountDue) || 0), 0);
  const pendingRequests = requests.filter((request) => request.status === "pending").length;

  return (
    <div className="mt-2.5 rounded-2xl border border-indigo-200 bg-indigo-50/70 dark:border-indigo-500/25 dark:bg-indigo-500/10">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-black text-indigo-950 dark:text-indigo-100">
              {teamName || "Team"} payment details
            </span>
            <span className="mt-0.5 block text-[11px] font-semibold text-indigo-800/75 dark:text-indigo-200/75">
              {formatNPR(received)} received of {formatNPR(due)} · {pendingRequests} open request{pendingRequests === 1 ? "" : "s"}
            </span>
          </span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-indigo-500" /> : <ChevronDown className="h-4 w-4 shrink-0 text-indigo-500" />}
      </button>

      {open && (
        <div className="border-t border-indigo-200/70 px-3.5 py-3 dark:border-indigo-500/20">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-700 dark:text-indigo-300">
            How each player chose to pay
          </p>
          <div className="mt-2 space-y-2">
            {players.map((player) => {
              const share = shares.find((item) => item.userId === player.id);
              const paid = Math.max(0, Number(share?.paidAmount) || 0);
              const amount = Math.max(0, Number(share?.amountDue) || 0);
              const remaining = Math.max(0, amount - paid);
              return (
                <div key={player.id} className="rounded-xl border border-indigo-100 bg-white/80 px-3 py-2.5 dark:border-white/10 dark:bg-slate-950/35">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-black text-stone-900 dark:text-slate-100">
                      {player.name}{player.role === "captain" ? " · captain" : ""}
                    </span>
                    {share ? (
                      <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${share.paymentStatus === "paid" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
                        {statusLabel(share.paymentStatus)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-500/10 px-2 py-1 text-[10px] font-black uppercase text-slate-500">No share</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-stone-500 dark:text-slate-400">
                    <span>Due {formatNPR(amount)}</span>
                    <span>Paid {formatNPR(paid)}</span>
                    {remaining > 0 && <span className="font-black text-amber-700 dark:text-amber-300">Remaining {formatNPR(remaining)}</span>}
                    <span>Method: {methodLabel(share?.paymentMethod)}</span>
                  </div>
                  {share?.gatewayTxnId && <p className="mt-1 text-[10px] font-semibold text-stone-400 dark:text-slate-500">Gateway reference: {share.gatewayTxnId.slice(0, 18)}</p>}
                </div>
              );
            })}
          </div>

          {requests.length > 0 && (
            <>
              <p className="mt-4 text-[10px] font-black uppercase tracking-[0.14em] text-indigo-700 dark:text-indigo-300">Directed requests</p>
              <div className="mt-2 space-y-2">
                {requests.map((request) => (
                  <div key={request.id} className="rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2.5 dark:border-violet-500/20 dark:bg-violet-500/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-black text-violet-950 dark:text-violet-100">
                        {request.requesterName} → {request.payerName}: {formatNPR(request.amountDue)}
                      </span>
                      <span className="rounded-full bg-violet-500/15 px-2 py-1 text-[10px] font-black uppercase text-violet-700 dark:text-violet-200">{statusLabel(request.status)}</span>
                    </div>
                    <p className="mt-1 text-[10px] font-semibold text-violet-800/75 dark:text-violet-200/75">
                      {request.purpose === "advance" ? "Venue advance" : "Team booking"} · {methodLabel(request.paymentMethod)} · Paid {formatNPR(request.paidAmount ?? 0)}
                    </p>
                    {request.note && <p className="mt-1 text-[10px] font-semibold text-violet-800/70 dark:text-violet-200/70">Note: {request.note}</p>}
                    {request.gatewayTxnId && <p className="mt-1 text-[10px] font-semibold text-violet-700/65 dark:text-violet-200/65">Gateway reference: {request.gatewayTxnId.slice(0, 18)}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
