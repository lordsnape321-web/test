import type { Booking } from "./types";

/** The venue advance is separate from each player's full-game share. */
export function advanceOf(booking: Booking, venueReceived: number) {
  const requested = booking.advancePaymentRequired ? Math.max(0, booking.advancePaymentAmount ?? 0) : 0;
  const received = Math.min(requested, Math.max(0, venueReceived));
  const remaining = Math.max(0, requested - received);
  const active = !["cancelled", "rejected", "completed"].includes(booking.status)
    && booking.advancePaymentStatus !== "expired" && requested > 0 && remaining > 0;
  const requests = (booking.paymentRequests ?? []).filter((r) => r.purpose === "advance");
  const pending = requests.filter((r) => r.status === "pending").reduce((sum, r) => sum + r.amountDue, 0);
  return { requested, received, remaining, active, requests, pending, available: Math.max(0, remaining - pending) };
}

/**
 * What to ask one teammate for, and where their money should go.
 *
 * The purpose follows where the debt actually is: the venue advance while it is
 * unpaid, the venue balance while the desk is still short, and a reimbursement
 * to whoever already paid the venue once the desk is square. A reimbursement
 * can never open a gateway, so it must never be dressed up as a venue payment.
 */
export function askPlan(
  advanceRemaining: number,
  venueBalance: number,
  shareDue: number,
  sharePaid: number,
): { purpose: "advance" | "booking" | "reimbursement"; amount: number } {
  const purpose = advanceRemaining > 0 ? "advance" : venueBalance > 0 ? "booking" : "reimbursement";
  const share = Math.max(0, Math.round(shareDue - sharePaid));
  const amount = purpose === "advance"
    ? Math.max(10, Math.min(share || advanceRemaining, advanceRemaining))
    : share;
  return { purpose, amount };
}
