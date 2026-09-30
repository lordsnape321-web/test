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
