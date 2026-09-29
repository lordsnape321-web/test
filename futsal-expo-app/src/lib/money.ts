import type { Booking } from "./types";
import { formatNPR } from "./futsal";

/**
 * What a booking actually owes, in one place.
 *
 * Both the list card and the full detail page derive their status word,
 * balance and pay amount from this, so the two can never disagree — which is
 * exactly what happened when each read a different source (the card read the
 * cached `paid_amount`/`payment_status` columns, the detail read the ledger).
 *
 * A team booking's obligation is the players' **shares**, and it does not
 * matter whether the money went to the captain or to the venue: both routes
 * settle the player. The venue ledger alone only says what the *venue's desk*
 * has received — a booking where everyone handed cash to the captain shows
 * "nothing received" there while every share is settled, and the card must
 * not say "Nothing paid yet" over a fully settled game.
 */
export type MoneyView = {
  received: number;
  balance: number;
  status: "paid" | "deposit_paid" | "pending";
  label: string;
};

export function moneyOf(b: Booking): MoneyView {
  const shares = b.teamPayments ?? [];

  if (shares.length > 0) {
    let collected = 0;
    let outstanding = 0;

    for (const s of shares) {
      const due = Math.max(0, Number(s.amountDue ?? 0));
      const paid = Math.min(due, Math.max(0, Number(s.paidAmount ?? 0)));
      collected += paid;
      outstanding += due - paid;
    }

    if (outstanding === 0) {
      return { received: collected, balance: 0, status: "paid", label: collected > 0 ? "Paid" : "Free — nothing to pay" };
    }

    if (collected > 0) {
      return {
        received: collected,
        balance: outstanding,
        status: "deposit_paid",
        label: `Part paid · ${formatNPR(outstanding)} left`,
      };
    }

    return { received: 0, balance: outstanding, status: "pending", label: "Nothing paid yet" };
  }

  // A solo booking's whole money story is the venue ledger, which the
  // presenter echoes as `paymentSummary`. Fall back to the cached columns
  // only if a response ever omits it.
  const summary = b.paymentSummary;
  const received = Math.max(0, Number(summary?.received ?? b.paidAmount ?? 0));
  const balance = Math.max(0, Number(summary?.receivable ?? b.totalPrice - received));

  if (balance === 0) {
    return { received, balance: 0, status: "paid", label: received > 0 ? "Paid" : "Free — nothing to pay" };
  }

  if (received > 0) {
    return {
      received,
      balance,
      status: "deposit_paid",
      label: `Deposit paid · ${formatNPR(balance)} left`,
    };
  }

  return { received: 0, balance, status: "pending", label: "Nothing paid yet" };
}
