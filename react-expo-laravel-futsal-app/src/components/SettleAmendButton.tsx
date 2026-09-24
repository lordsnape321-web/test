"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Lock } from "lucide-react";
import { settleWindow, formatWindowLeft } from "@/lib/booking-ledger";

/**
 * The Amend control for a settled booking row.
 *
 * The countdown owns its own one-second clock on purpose. When the clock lived
 * on the bookings page, every tick re-rendered the whole table — every row,
 * every badge — once a second. Keeping it here means only rows that are
 * actually inside a correction window re-render at all.
 *
 * The clock also stops itself once the window closes: there is nothing left to
 * count down, so leaving the interval running would just burn renders forever.
 */
export function SettleAmendButton({
  settledAt,
  onOpen,
}: {
  settledAt: string | null;
  onOpen: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const win = settleWindow(settledAt, now);

  useEffect(() => {
    // Nothing to tick for a booking that was never settled.
    if (!win.settled) return;
    const t = setInterval(() => {
      setNow(Date.now());
      // Stop once it locks; the button has become a static pill.
      if (Date.now() >= (win.locksAt ?? Infinity)) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [win.settled, win.locksAt]);

  if (!win.settled) return null;

  if (!win.editable) {
    return (
      <span
        title="Settled and locked — the 5-minute correction window has closed"
        className="flex h-8 items-center gap-1 rounded-full bg-slate-200 px-3 text-[11px] font-black text-slate-500 dark:bg-slate-700 dark:text-slate-300"
      >
        <Lock className="h-3.5 w-3.5 shrink-0" /> Locked
      </span>
    );
  }

  return (
    <button
      onClick={onOpen}
      title={`Amend this settled payment — locks in ${formatWindowLeft(win.msLeft)}`}
      className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-amber-500 px-3 text-[11px] font-black text-white transition hover:bg-amber-600"
    >
      <RotateCcw className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">Amend</span>
      {/*
        tabular-nums + a fixed min-width: without them "4:32" and "4:09" are
        different pixel widths in a proportional font, so the button resized
        every second and shoved the rest of the row sideways.
      */}
      <span className="min-w-[2.6ch] text-right tabular-nums">
        {formatWindowLeft(win.msLeft)}
      </span>
    </button>
  );
}
