import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bookingPaymentRequests, bookings, courts, venues } from "@/db/schema";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import { sendNotification } from "@/lib/notify";

/** A player gets one hour from the owner's advance request to pay it. */
export const ADVANCE_PAYMENT_WINDOW_MS = 60 * 60 * 1000;

export function advancePaymentDeadline(requestedAt: Date | string | null | undefined) {
  if (!requestedAt) return null;
  const value = requestedAt instanceof Date ? requestedAt.getTime() : Date.parse(String(requestedAt));
  return Number.isFinite(value) ? new Date(value + ADVANCE_PAYMENT_WINDOW_MS) : null;
}

/**
 * Expire overdue owner advances in the database. The app has no separate
 * scheduler, so feed/payment requests call this before reading or mutating a
 * booking. The conditional update makes it safe when two devices arrive at
 * the one-hour boundary together.
 */
export async function expireOverdueAdvanceRequests() {
  const rows = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "pending"), eq(bookings.advancePaymentRequired, true), eq(bookings.advancePaymentStatus, "pending")));
  const now = Date.now();
  let expired = 0;

  for (const booking of rows) {
    const deadline = advancePaymentDeadline(booking.advancePaymentRequestedAt);
    if (!deadline || deadline.getTime() > now) continue;

    const updated = await db
      .update(bookings)
      .set({ status: "cancelled", advancePaymentStatus: "expired" })
      .where(
        and(
          eq(bookings.id, booking.id),
          eq(bookings.status, "pending"),
          eq(bookings.advancePaymentStatus, "pending"),
        ),
      )
      .returning();
    if (!updated[0]) continue;
    await db
      .update(bookingPaymentRequests)
      .set({ status: "expired" })
      .where(
        and(
          eq(bookingPaymentRequests.bookingId, booking.id),
          eq(bookingPaymentRequests.purpose, "advance"),
          eq(bookingPaymentRequests.status, "pending"),
        ),
      );
    expired += 1;

    try {
      const court = (await db.select().from(courts).where(eq(courts.id, booking.courtId)))[0];
      const venue = court
        ? (await db.select().from(venues).where(eq(venues.id, court.venueId)))[0]
        : undefined;
      const when = `${prettyDate(booking.date)} at ${formatTime12(booking.startTime)}`;
      await sendNotification({
        userId: booking.userId,
        type: "booking_cancelled",
        title: `⌛ Booking cancelled — advance not received`,
        message: `${venue?.name ?? "The venue"} did not receive the requested ${formatNPR(booking.advancePaymentAmount)} advance within one hour for ${when}, so booking #FN-${booking.id} was cancelled automatically.`,
        link: "/bookings",
      });
      if (venue?.ownerId) {
        await sendNotification({
          userId: venue.ownerId,
          type: "booking_cancelled",
          title: `⌛ Advance window expired — booking #FN-${booking.id}`,
          message: `The player did not pay the ${formatNPR(booking.advancePaymentAmount)} advance within one hour, so the pending request was cancelled and the slot is free again.`,
          link: "/admin/requests",
        });
      }
    } catch {
      // The booking cancellation is already durable; notification delivery is
      // best-effort and the next feed still shows the cancelled status.
    }
  }
  return expired;
}
