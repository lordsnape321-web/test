const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  },
};
import { advanceOf } from "../src/lib/booking-advance";
import type { Booking } from "../src/lib/types";

const booking = {
  status: "pending", advancePaymentRequired: true, advancePaymentAmount: 900,
  advancePaymentStatus: "pending", paidAmount: 1800,
  paymentRequests: [
    { id: 1, purpose: "advance", amountDue: 300, status: "paid" },
    { id: 2, purpose: "advance", amountDue: 300, status: "pending" },
    { id: 3, purpose: "booking", amountDue: 100, status: "pending" },
  ],
} as Booking;

const partial = advanceOf(booking, 300);
assert.equal(partial.received, 300);
assert.equal(partial.remaining, 600);
assert.equal(partial.pending, 300);
assert.equal(partial.available, 300);
assert.equal(partial.active, true);
assert.equal(partial.requests.length, 2);
// Team collections cached as paid do not prove the venue received an advance.
assert.equal(advanceOf(booking, 0).remaining, 900);
assert.equal(advanceOf(booking, 0).active, true);
assert.equal(advanceOf(booking, 900).active, false);
assert.equal(advanceOf(booking, 1200).received, 900);
assert.equal(advanceOf({ ...booking, status: "cancelled" }, 300).active, false);
assert.equal(advanceOf({ ...booking, advancePaymentStatus: "expired" }, 300).active, false);
assert.equal(advanceOf({ ...booking, advancePaymentRequired: false }, 0).requested, 0);
console.log("PASS: advance progress, pending reservations, ledger source, paid/expired/cancelled states");
