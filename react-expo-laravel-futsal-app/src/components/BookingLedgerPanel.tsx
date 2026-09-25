"use client";
import { ThemedSelect } from "@/components/ThemedSelect";

import { useEffect, useState } from "react";
import { Loader2, Plus, RotateCcw, Trash2, Wallet, CheckCheck, Lock, ReceiptText } from "lucide-react";
import { formatNPR } from "@/lib/futsal";
import { formatWindowLeft } from "@/lib/booking-ledger";
import { apiFetch } from "@/lib/api";

type ExtraLine = {
  id: number;
  label: string;
  amount: number;
  voidedAt: string | null;
  createdAt: string | null;
};

type PaymentLine = {
  id: number;
  amount: number;
  method: string;
  note: string;
  source: string;
  /** Gateway transaction id, present when the money came in online. */
  reference: string;
  voidedAt: string | null;
  createdAt: string | null;
};

type Ledger = {
  bookingId: number;
  status: string;
  paymentStatus: string;
  courtPrice: number;
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
  window: { settled: boolean; editable: boolean; msLeft: number; locksAt: number | null };
  editWindowMs: number;
  settledAt: string | null;
  settledBy: number | null;
  acceptedMethods: string[];
  defaultExtraFee: number;
  defaultExtraFeeNote: string;
  extras: ExtraLine[];
  payments: PaymentLine[];
};

/**
 * The owner's payment desk for one booking 💸
 *
 * Replaces the old one-click "mark paid". A game is rarely settled in one lump —
 * part arrives by eSewa, part by Khalti, part in cash at the counter — and the
 * final total isn't known until the players have bought their water. So this
 * records each instalment and each add-on as its own line, shows what is still
 * owed as it goes, and only then lets the owner settle.
 *
 * Settling starts a five-minute correction window for the inevitable mistyped
 * amount; after that the ledger locks and the panel says so.
 */
export function BookingLedgerPanel({
  bookingId,
  bookingLabel,
  ownerId,
  onClose,
  onSettled,
}: {
  bookingId: number;
  bookingLabel: string;
  ownerId: number;
  onClose: () => void;
  onSettled?: () => void;
}) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // Instalment form
  const [method, setMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  // Extra charge form
  const [extraLabel, setExtraLabel] = useState("");
  const [extraAmount, setExtraAmount] = useState("");

  // Ticks so the correction countdown is visible without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // One fetch on open. The form seeds itself off the venue's defaults using
  // functional updates, so the effect doesn't depend on the fields it fills —
  // depending on them would re-run the load every time the owner types.
  useEffect(() => {
    let dead = false;
    apiFetch(`/api/bookings/${bookingId}/ledger`)
      .then(async (res) => {
        const data = await res.json();
        if (dead) return;
        if (!res.ok) {
          setError(String(data.error ?? "Couldn't load the ledger 🙏"));
          return;
        }
        const led = data as Ledger;
        setLedger(led);
        setMethod((m) => m || (led.acceptedMethods[0] ?? ""));
        setExtraLabel((l) => l || led.defaultExtraFeeNote || "");
        setExtraAmount((a) => a || (led.defaultExtraFee ? String(led.defaultExtraFee) : ""));
      })
      .catch(() => {
        if (!dead) setError("Couldn't load the ledger 🙏");
      });
    return () => {
      dead = true;
    };
  }, [bookingId]);

  async function act(body: Record<string, unknown>) {
    setBusy(String(body.action));
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/api/bookings/${bookingId}/ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, actorId: ownerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data.error ?? "That didn't work 🙏"));
        return;
      }
      if (data.ledger) setLedger(data.ledger as Ledger);
      if (data.message) setNotice(String(data.message));
      // Both directions change what the bookings list renders: settling opens
      // the correction window (and the row's Amend button), and undoing it
      // closes it again and puts the payment status back. Refresh on both, or
      // the row keeps showing a countdown for a state that no longer exists.
      if (body.action === "settle" || body.action === "unsettle") onSettled?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100";
  const labelCls = "mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400";

  if (!ledger) {
    return (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-3xl bg-white p-8 text-center dark:bg-slate-900">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
          {error && <p className="mt-3 text-sm font-bold text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  const { totals, window: win } = ledger;
  const locked = win.settled && !win.editable;
  const locksIn = win.settled && win.editable ? Math.max(0, win.locksAt! - now) : 0;
  const methods = Object.entries(totals.byMethod);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="my-6 w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-black tracking-tight">
              <Wallet className="h-5 w-5" /> Payments
            </h3>
            <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {bookingLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        {/* ------------------------------------------------------- the totals */}
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
            <span>Court fee</span>
            <span>{formatNPR(totals.courtPrice)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
            <span>Extra charges</span>
            <span>{totals.extrasTotal > 0 ? `+ ${formatNPR(totals.extrasTotal)}` : "—"}</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-black dark:border-slate-700">
            <span>Total owed</span>
            <span>{formatNPR(totals.owed)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm font-black text-emerald-600 dark:text-emerald-400">
            <span>Received</span>
            <span>{formatNPR(totals.paid)}</span>
          </div>
          {totals.balance > 0 && (
            <div className="mt-2 rounded-xl bg-amber-100 px-3 py-2 text-xs font-black text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              ⏳ {formatNPR(totals.balance)} still to collect
            </div>
          )}
          {totals.surplus > 0 && (
            <div className="mt-2 rounded-xl bg-sky-100 px-3 py-2 text-xs font-black text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
              💵 They&apos;ve paid {formatNPR(totals.surplus)} more than owed — hand the change back
            </div>
          )}
          {totals.balance === 0 && totals.paid > 0 && (
            <div className="mt-2 rounded-xl bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
              ✅ Fully paid
            </div>
          )}
          {methods.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {methods.map(([m, v]) => (
                <span
                  key={m}
                  className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
                >
                  {m} • {formatNPR(v)}
                </span>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-3 rounded-2xl bg-emerald-50 px-3.5 py-2.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            {notice}
          </p>
        )}

        {locked && (
          <p className="mt-3 flex items-start gap-2 rounded-2xl bg-slate-100 px-3.5 py-2.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Settled {ledger.settledAt ? new Date(ledger.settledAt).toLocaleString() : ""} — the
            correction window closed, so this ledger is locked. That&apos;s what makes the day&apos;s
            takings trustworthy.
          </p>
        )}

        {/* ---------------------------------------------------- instalments */}
        <div className="mt-4">
          <p className={labelCls}>Instalments ({totals.paid > 0 ? formatNPR(totals.paid) : "none yet"})</p>
          {ledger.payments.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-400 dark:bg-slate-800/60">
              Nothing recorded yet. Add each part as it comes in.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {ledger.payments.map((p) => (
                <li
                  key={p.id}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${
                    p.voidedAt
                      ? "border-slate-100 bg-slate-50 text-slate-400 line-through dark:border-slate-800 dark:bg-slate-800/40"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {p.method}
                    {p.reference ? (
                      <span className="text-slate-400"> • {p.reference.slice(0, 18)}</span>
                    ) : p.note ? (
                      <span className="text-slate-400"> — {p.note}</span>
                    ) : (
                      ""
                    )}
                  </span>
                  <span className="shrink-0 font-black">{formatNPR(p.amount)}</span>
                  {!p.voidedAt && !locked && (
                    <button
                      onClick={() => void act({ action: "voidPayment", paymentId: p.id })}
                      disabled={busy === "voidPayment"}
                      title="Undo this instalment"
                      className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {p.voidedAt && <span className="shrink-0 text-[10px] font-black">undone</span>}
                </li>
              ))}
            </ul>
          )}

          {!locked && (
            <div className="mt-2 grid grid-cols-[1fr_5.5rem] gap-2">
              <div className="grid grid-cols-2 gap-2">
                <ThemedSelect value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                  {ledger.acceptedMethods.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </ThemedSelect>
                <input
                  type="number"
                  min={1}
                  step={50}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={totals.balance > 0 ? String(totals.balance) : "Amount"}
                  className={inputCls}
                />
              </div>
              <button
                onClick={() => {
                  void act({ action: "addPayment", method, amount: Number(amount), note });
                  setAmount("");
                  setNote("");
                }}
                disabled={busy === "addPayment" || !amount}
                title="Record this instalment"
                className="flex items-center justify-center gap-1 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-white hover:bg-emerald-600 disabled:opacity-40"
              >
                {busy === "addPayment" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add
              </button>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note (optional) — e.g. handed over at the counter"
                className={`${inputCls} col-span-2`}
              />
            </div>
          )}
        </div>

        {/* ------------------------------------------------- extra charges */}
        <div className="mt-4">
          <p className={labelCls}>Extra charges</p>
          <p className="mb-1.5 text-[11px] leading-relaxed text-slate-400">
            The court fee is taken in advance; the water and spare balls aren&apos;t. Add them as the
            game goes and the total owed follows.
          </p>
          {ledger.extras.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-400 dark:bg-slate-800/60">
              No extras yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {ledger.extras.map((x) => (
                <li
                  key={x.id}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${
                    x.voidedAt
                      ? "border-slate-100 bg-slate-50 text-slate-400 line-through dark:border-slate-800 dark:bg-slate-800/40"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{x.label}</span>
                  <span className="shrink-0 font-black">{formatNPR(x.amount)}</span>
                  {!x.voidedAt && !locked && (
                    <button
                      onClick={() => void act({ action: "voidExtra", extraId: x.id })}
                      disabled={busy === "voidExtra"}
                      title="Remove this extra charge"
                      className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {x.voidedAt && <span className="shrink-0 text-[10px] font-black">removed</span>}
                </li>
              ))}
            </ul>
          )}

          {!locked && (
            <div className="mt-2 grid grid-cols-[1fr_5.5rem_3.5rem] gap-2">
              <input
                value={extraLabel}
                onChange={(e) => setExtraLabel(e.target.value)}
                placeholder="Water x10"
                className={inputCls}
              />
              <input
                type="number"
                min={1}
                step={10}
                value={extraAmount}
                onChange={(e) => setExtraAmount(e.target.value)}
                placeholder="Rs."
                className={inputCls}
              />
              <button
                onClick={() => {
                  void act({ action: "addExtra", label: extraLabel, amount: Number(extraAmount) });
                  setExtraAmount(ledger.defaultExtraFee ? String(ledger.defaultExtraFee) : "");
                }}
                disabled={busy === "addExtra" || !extraLabel.trim() || !extraAmount}
                title="Add this extra charge"
                className="flex items-center justify-center rounded-xl bg-slate-900 px-2 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-900"
              >
                {busy === "addExtra" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
          {ledger.defaultExtraFee > 0 && !locked && (
            <p className="mt-1 text-[10px] font-bold text-slate-400">
              Your venue&apos;s usual add-on is {formatNPR(ledger.defaultExtraFee)}
              {ledger.defaultExtraFeeNote ? ` for "${ledger.defaultExtraFeeNote}"` : ""} — prefilled above.
            </p>
          )}
        </div>

        {/* -------------------------------------------------------- settle */}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          {!win.settled ? (
            <button
              onClick={() => void act({ action: "settle" })}
              disabled={busy === "settle" || totals.paid <= 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-black text-white transition hover:bg-emerald-600 disabled:opacity-40"
            >
              {busy === "settle" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="h-4 w-4" />
              )}
              {totals.paid <= 0
                ? "Record a payment first"
                : totals.balance > 0
                  ? `Settle with ${formatNPR(totals.balance)} still owed`
                  : "Mark settled ✅"}
            </button>
          ) : win.editable ? (
            <div className="space-y-2">
              <p className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-100 px-3 py-2.5 text-xs font-black text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                <ReceiptText className="h-3.5 w-3.5" />
                Settled — editable for {formatWindowLeft(locksIn)} more, then it locks
              </p>
              <button
                onClick={() => void act({ action: "unsettle" })}
                disabled={busy === "unsettle"}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" /> Undo settlement
              </button>
            </div>
          ) : (
            <p className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-3 text-xs font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <Lock className="h-3.5 w-3.5" /> Settled and locked 🔒
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
