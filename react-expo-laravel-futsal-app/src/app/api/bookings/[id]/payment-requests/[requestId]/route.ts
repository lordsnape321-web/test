import { and, eq } from "drizzle-orm";
import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookingPaymentRequests, bookings, users } from "@/db/schema";
import { expireOverdueAdvanceRequests } from "@/lib/advance-payment";

export const dynamic = "force-dynamic";

const METHODS = ["eSewa", "Khalti"] as const;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  try {
    await ensureCompetitionBookingColumns();
    await expireOverdueAdvanceRequests();
    const { id, requestId: rawRequestId } = await params;
    const bookingId = Number(id);
    const requestId = Number(rawRequestId);
    const body = await req.json().catch(() => ({}));
    const userId = Number(body.userId ?? 0);
    if (!Number.isInteger(bookingId) || bookingId <= 0 || !Number.isInteger(requestId) || requestId <= 0 || !Number.isInteger(userId) || userId <= 0) {
      return Response.json({ error: "Invalid payment request 🔒" }, { status: 400 });
    }
    const requestRows = await db.select().from(bookingPaymentRequests).where(and(eq(bookingPaymentRequests.id, requestId), eq(bookingPaymentRequests.bookingId, bookingId)));
    const request = requestRows[0];
    if (!request) return Response.json({ error: "Payment request not found" }, { status: 404 });
    const bookingRows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const booking = bookingRows[0];
    if (!booking) return Response.json({ error: "Booking not found" }, { status: 404 });
    if (request.status !== "pending") return Response.json({ error: "This payment request is no longer pending", paymentRequest: request }, { status: 409 });

    if (body.action === "cancel") {
      if (request.requestedBy !== userId) return Response.json({ error: "Only the requesting captain can cancel this request 🔒" }, { status: 403 });
      const updated = await db.update(bookingPaymentRequests).set({ status: "cancelled" }).where(and(eq(bookingPaymentRequests.id, request.id), eq(bookingPaymentRequests.status, "pending"))).returning();
      return Response.json({ paymentRequest: updated[0] ?? request });
    }

    if (request.payerId !== userId) return Response.json({ error: "Only the requested player can choose the payment method 🔒" }, { status: 403 });
    const method = String(body.paymentMethod ?? "");
    if (!METHODS.includes(method as (typeof METHODS)[number])) {
      return Response.json({ error: "Direct teammate payments use eSewa or Khalti only 💳" }, { status: 400 });
    }
    if (booking.status === "cancelled" || booking.status === "rejected") return Response.json({ error: "This booking is no longer active" }, { status: 409 });
    const updated = await db
      .update(bookingPaymentRequests)
      .set({ paymentMethod: method })
      .where(and(eq(bookingPaymentRequests.id, request.id), eq(bookingPaymentRequests.status, "pending")))
      .returning();
    const people = await db.select().from(users);
    return Response.json({
      paymentRequest: updated[0] ?? request,
      payerName: people.find((person) => person.id === userId)?.name ?? "Player",
    });
  } catch (e) {
    console.error("[/api/bookings/[id]/payment-requests/[requestId] PATCH] failed:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
