"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Wallet } from "lucide-react";
import { formatNPR } from "@/lib/futsal";
import { apiFetch } from "@/lib/api";

type Line = {
  id: number;
  amount: number;
  method?: string;
  label?: string;
  note?: string;
  reference?: string;
  voidedAt: string | null;
};

type Summary = {
  totals: {
    courtPrice: number;
    extrasTotal: number;
    owed: number;
    paid: number;
    balance: number;
    surplus: number;
    byMethod: Record<string, number>;
    settled: boolean;
  };
  payments: Line[];
  extras: Line[];
};

/**
 * What the player has actually paid, and how 🧾
 *
 * The owner records a game's money in parts — some by eSewa, some by Khalti,
 * some in cash at the counter — and adds the water on afterwards. The player
 * should be able to see that same breakdown rather than just a "paid" badge, so
 * this reads the same ledger the owner's desk writes to.
 *
 * Fetched on demand: a bookings list can be long, and most cards never get
 * opened.
 */
export function BookingPaymentSummary({ bookingId }: { bookingId: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || data) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/bookings/${bookingId}/ledger`);
      const body = await res.json();
      if (!res.ok) setError(String(body.error ?? "Couldn't load the payment details 🙏"));
      else setData(body as Summary);
    } catch {
      setError("Couldn't load the payment details 🙏");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2.5 rounded-xl border border-stone-200 dark:border-white/10">
      <button
        onClick={() => void toggle()}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-black text-stone-600 transition hover:bg-stone-50 dark:text-slate-300 dark:hover:bg-white/5"
      >
        <span className="flex items-center gap-1.5">
          <Wallet className="h-3.5 w-3.5" /> Payment details
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {open && (
        <div className="border-t border-stone-100 px-3.5 py-3 dark:border-white/5">
          {loading && (
            <p className="flex items-center gap-2 text-xs font-bold text-stone-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
          )}
          {error && <p className="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}
          {data && (
            <>
              <dl className="space-y-1 text-xs font-bold text-stone-500 dark:text-slate-400">
                <div className="flex justify-between">
                  <dt>Court fee</dt>
                  <dd>{formatNPR(data.totals.courtPrice)}</dd>
                </div>
                {data.totals.extrasTotal > 0 && (
                  <div className="flex justify-between">
                    <dt>Extras</dt>
                    <dd>+ {formatNPR(data.totals.extrasTotal)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-stone-100 pt-1 text-stone-900 dark:border-white/10 dark:text-slate-100">
                  <dt>Total</dt>
                  <dd className="font-black">{formatNPR(data.totals.owed)}</dd>
                </div>
                <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
                  <dt>Paid</dt>
                  <dd className="font-black">{formatNPR(data.totals.paid)}</dd>
                </div>
              </dl>

              {data.totals.balance > 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  ⏳ {formatNPR(data.totals.balance)} still to pay
                </p>
              )}
              {data.totals.surplus > 0 && (
                <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-[11px] font-black text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                  💵 You paid {formatNPR(data.totals.surplus)} more than owed — the venue owes you the
                  change
                </p>
              )}

              {data.payments.filter((p) => !p.voidedAt).length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {data.payments
                    .filter((p) => !p.voidedAt)
                    .map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 text-[11px] font-bold text-stone-500 dark:text-slate-400"
                      >
                        <span className="min-w-0 truncate">
                          {p.method}
                          {p.reference ? (
                            <span className="text-stone-400"> • {p.reference.slice(0, 14)}</span>
                          ) : p.note ? (
                            <span className="text-stone-400"> — {p.note}</span>
                          ) : (
                            ""
                          )}
                        </span>
                        <span className="shrink-0 font-black text-stone-700 dark:text-slate-200">
                          {formatNPR(p.amount)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}

              {data.extras.filter((x) => !x.voidedAt).length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-stone-100 pt-2 dark:border-white/5">
                  {data.extras
                    .filter((x) => !x.voidedAt)
                    .map((x) => (
                      <li
                        key={x.id}
                        className="flex items-center justify-between gap-2 text-[11px] font-bold text-stone-500 dark:text-slate-400"
                      >
                        <span className="min-w-0 truncate">{x.label}</span>
                        <span className="shrink-0 font-black text-stone-700 dark:text-slate-200">
                          {formatNPR(x.amount)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}

              {data.payments.filter((p) => !p.voidedAt).length === 0 && (
                <p className="mt-2 text-[11px] font-bold text-stone-400">
                  Nothing recorded as paid yet.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
