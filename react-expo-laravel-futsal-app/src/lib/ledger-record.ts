import { db } from "@/db";
import { bookingPayments } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Writes an online payment into the booking ledger 📒
 *
 * The gateway handlers already set `booking.paidAmount` and `paymentStatus`, but
 * that says nothing about *which medium* the money came by — and the payment
 * desk derives everything from the ledger, not from those columns. Without this,
 * a booking paid in full by eSewa shows up on the desk as "nothing received",
 * which is exactly the confusion the ledger exists to prevent.
 *
 * Idempotent on the gateway's transaction id: a replayed verify callback (they
 * do get replayed) must not conjure a second instalment out of one payment.
 */
export async function recordGatewayPayment(input: {
  bookingId: number;
  amount: number;
  method: string;
  reference: string;
  userId?: number;
  note?: string;
}): Promise<{ recorded: boolean; duplicate: boolean }> {
  const amount = Math.max(0, Math.round(Number(input.amount) || 0));
  const reference = String(input.reference ?? "").slice(0, 100);
  if (!input.bookingId || amount <= 0 || !reference) return { recorded: false, duplicate: false };

  const existing = await db
    .select({ id: bookingPayments.id })
    .from(bookingPayments)
    .where(and(eq(bookingPayments.bookingId, input.bookingId), eq(bookingPayments.reference, reference)));
  if (existing.length > 0) return { recorded: false, duplicate: true };

  await db.insert(bookingPayments).values({
    bookingId: input.bookingId,
    amount,
    method: String(input.method),
    note: String(input.note ?? "").slice(0, 200),
    source: "gateway",
    reference,
    recordedBy: Number(input.userId ?? 0),
  });
  return { recorded: true, duplicate: false };
}
