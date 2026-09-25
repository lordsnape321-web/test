import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookingPaymentRequests, bookingTeamPayments, bookings, courts, venues } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getKhaltiConfig, khaltiLookup } from "@/lib/payments";
import { sendNotification } from "@/lib/notify";
import { recordGatewayPayment } from "@/lib/ledger-record";
import { formatNPR } from "@/lib/futsal";
import { expireOverdueAdvanceRequests, recordDirectedTeamSharePayment } from "@/lib/advance-payment";

export const dynamic = "force-dynamic";

function teamPaymentIdFromOrder(orderId: string) {
  const match = /-TP-(\d+)(?:-|$)/.exec(orderId);
  return match ? Number(match[1]) : null;
}

function paymentRequestIdFromOrder(orderId: string) {
  const match = /-PR-(\d+)(?:-|$)/.exec(orderId);
  return match ? Number(match[1]) : null;
}

async function recordTeamKhaltiPayment(
  booking: typeof bookings.$inferSelect,
  teamPayment: typeof bookingTeamPayments.$inferSelect,
  amount: number,
  reference: string,
  note: string,
) {
  if (teamPayment.paymentStatus === "paid") return teamPayment;
  const updatedRows = await db
    .update(bookingTeamPayments)
    .set({ paymentStatus: "paid", paidAmount: amount, gatewayTxnId: reference.slice(0, 100) })
    .where(eq(bookingTeamPayments.id, teamPayment.id))
    .returning();
  const updatedTeamPayment = updatedRows[0] ?? teamPayment;
  await recordGatewayPayment({
    bookingId: booking.id,
    amount,
    method: "Khalti",
    reference,
    userId: teamPayment.userId,
    note,
  });
  const allShares = await db.select().from(bookingTeamPayments).where(eq(bookingTeamPayments.bookingId, booking.id));
  const paidTotal = allShares.reduce((sum, share) => sum + Number(share.paidAmount || 0), 0);
  const advancePaid = booking.advancePaymentRequired && paidTotal >= Number(booking.advancePaymentAmount || 0);
  await db
    .update(bookings)
    .set({
      paidAmount: paidTotal,
      paymentStatus:
        paidTotal >= booking.totalPrice
          ? "paid"
          : booking.depositRequired && paidTotal >= Number(booking.depositAmount || 0)
            ? "deposit_paid"
            : "pending",
      depositStatus:
        booking.depositRequired && paidTotal >= Number(booking.depositAmount || 0) ? "paid" : booking.depositStatus,
      advancePaymentStatus: booking.advancePaymentRequired ? (advancePaid ? "paid" : "pending") : "none",
      paymentMethod: advancePaid && paidTotal < booking.totalPrice ? "Cash at Venue" : booking.paymentMethod,
      gatewayTxnId: reference.slice(0, 100),
    })
    .where(eq(bookings.id, booking.id));
  try {
    const courtRows = await db.select().from(courts).where(eq(courts.id, booking.courtId));
    const venueRows = courtRows[0]
      ? await db.select().from(venues).where(eq(venues.id, courtRows[0].venueId))
      : [];
    const venue = venueRows[0];
    if (venue?.ownerId) {
      await sendNotification({
        userId: venue.ownerId,
        type: "payment",
        title: `💰 Team Khalti share verified — ${venue.name}`,
        message: `${booking.bookerName || "A team member"} paid ${formatNPR(amount)} via Khalti for team booking #FN-${booking.id}. ${formatNPR(paidTotal)} of ${formatNPR(booking.totalPrice)} is now in the ledger.`,
        link: "/admin/bookings",
      });
    }
    await sendNotification({
      userId: teamPayment.userId,
      type: "payment",
      title: "✅ Team share paid",
      message: `Your ${formatNPR(amount)} Khalti share for booking #FN-${booking.id} is confirmed and recorded in the booking ledger.`,
      link: "/bookings",
    });
  } catch {}
  return updatedTeamPayment;
}

async function recordRequestedKhaltiPayment(
  booking: typeof bookings.$inferSelect,
  request: typeof bookingPaymentRequests.$inferSelect,
  amount: number,
  reference: string,
) {
  if (request.status === "paid") return request;
  const updatedRequest = (await db
    .update(bookingPaymentRequests)
    .set({ status: "paid", paidAmount: amount, gatewayTxnId: reference.slice(0, 100), paidAt: new Date() })
    .where(and(eq(bookingPaymentRequests.id, request.id), eq(bookingPaymentRequests.status, "pending")))
    .returning())[0];
  if (!updatedRequest) return request;
  const newPaid = Math.min(booking.totalPrice, Number(booking.paidAmount || 0) + amount);
  const advancePaid = booking.advancePaymentRequired && newPaid >= Number(booking.advancePaymentAmount || 0);
  await db.update(bookings).set({
    gatewayTxnId: reference.slice(0, 100),
    paidAmount: newPaid,
    paymentStatus: newPaid >= booking.totalPrice ? "paid" : "pending",
    advancePaymentStatus: booking.advancePaymentRequired ? (advancePaid ? "paid" : "pending") : "none",
    paymentMethod: request.purpose === "advance" && newPaid < booking.totalPrice ? "Cash at Venue" : booking.paymentMethod,
  }).where(eq(bookings.id, booking.id));
  await recordGatewayPayment({
    bookingId: booking.id,
    amount,
    method: "Khalti",
    reference,
    userId: request.payerId,
    note: `Khalti teammate ${request.purpose} payment`,
  });
  await recordDirectedTeamSharePayment({
    bookingId: booking.id,
    payerId: request.payerId,
    amount,
    reference,
  });
  try {
    const courtRows = await db.select().from(courts).where(eq(courts.id, booking.courtId));
    const venue = courtRows[0]
      ? (await db.select().from(venues).where(eq(venues.id, courtRows[0].venueId)))[0]
      : undefined;
    if (venue?.ownerId) {
      await sendNotification({
        userId: venue.ownerId,
        type: "payment",
        title: `💰 Teammate Khalti payment received — ${venue.name}`,
        message: `A teammate paid ${formatNPR(amount)} directly to ${venue.name} for booking #FN-${booking.id}. The captain's requested ${request.purpose} amount is now in the ledger.`,
        link: "/admin/bookings",
      });
    }
    await sendNotification({
      userId: request.requestedBy,
      type: "payment",
      title: "✅ Teammate payment received",
      message: `Your teammate paid ${formatNPR(amount)} via Khalti for booking #FN-${booking.id}. The venue has the money in its booking ledger.`,
      link: "/bookings",
    });
  } catch {}
  return updatedRequest;
}

export async function POST(req: Request) {
  try {
    await ensureCompetitionBookingColumns();
    await expireOverdueAdvanceRequests();
    const body = await req.json();
    const pidx = String(body.pidx ?? "").trim();
    const bookingId = Number(body.bookingId ?? 0) || null;
    const mockApprove = body.mockApprove === true;
    if (!pidx) return Response.json({ error: "Missing pidx" }, { status: 400 });

    const rows = bookingId
      ? await db.select().from(bookings).where(eq(bookings.id, bookingId))
      : await db.select().from(bookings);
    let booking = rows[0];
    if (!bookingId) {
      const found = rows.find((b) => b.khaltiPidx === pidx);
      if (!found) return Response.json({ error: "Booking not found for pidx" }, { status: 404 });
      booking = found;
    }
    if (!booking) return Response.json({ error: "Booking not found" }, { status: 404 });
    if (booking.status === "cancelled" || booking.status === "rejected")
      return Response.json({ error: "This booking is no longer active" }, { status: 409 });
    const teamPaymentId = Number(body.teamPaymentId ?? 0) || teamPaymentIdFromOrder(String(body.order_id ?? ""));
    const paymentRequestId = Number(body.paymentRequestId ?? 0) || paymentRequestIdFromOrder(String(body.order_id ?? ""));
    const teamPayment = teamPaymentId
      ? (await db
          .select()
          .from(bookingTeamPayments)
          .where(and(eq(bookingTeamPayments.id, teamPaymentId), eq(bookingTeamPayments.bookingId, booking.id))))[0]
      : null;
    const paymentRequest = paymentRequestId
      ? (await db
          .select()
          .from(bookingPaymentRequests)
          .where(and(eq(bookingPaymentRequests.id, paymentRequestId), eq(bookingPaymentRequests.bookingId, booking.id))))[0]
      : null;
    if (teamPaymentId && !teamPayment)
      return Response.json({ error: "Team payment not found" }, { status: 404 });
    if (paymentRequestId && !paymentRequest)
      return Response.json({ error: "Payment request not found" }, { status: 404 });
    const payerId = Number(body.userId ?? 0) || null;
    if (paymentRequest && (!payerId || paymentRequest.payerId !== payerId))
      return Response.json({ error: "Only the requested player can complete this payment 🔒" }, { status: 403 });
    if (teamPayment && paymentRequest)
      return Response.json({ error: "Choose one payment target at a time" }, { status: 400 });
    if (paymentRequest && paymentRequest.status !== "pending")
      return Response.json({ error: "This payment request is no longer pending" }, { status: 409 });
    if (paymentRequest && paymentRequest.paymentMethod !== "Khalti")
      return Response.json({ error: "Choose Khalti for this payment request first 💳" }, { status: 400 });
    if (teamPayment && teamPayment.paymentMethod !== "Khalti")
      return Response.json({ error: "Choose Khalti for this team share first 💳" }, { status: 400 });
    if (teamPayment && teamPayment.paymentStatus === "paid")
      return Response.json({ ok: true, booking, teamPayment, transactionId: teamPayment.gatewayTxnId });
    if (booking.visibility === "competition" && booking.competitionStatus === "pending") {
      return Response.json(
        { error: "Payment opens after the opposition captain accepts this competition request 🆚" },
        { status: 409 }
      );
    }
    if (!teamPayment && !paymentRequest && booking.khaltiPidx && booking.khaltiPidx !== pidx) {
      return Response.json(
        { error: "Payment session doesn't match this booking — start again 🔄" },
        { status: 400 }
      );
    }
    if (teamPayment && teamPayment.khaltiPidx && teamPayment.khaltiPidx !== pidx) {
      return Response.json(
        { error: "Payment session doesn't match this team share — start again 🔄" },
        { status: 400 }
      );
    }
    if (paymentRequest && paymentRequest.khaltiPidx && paymentRequest.khaltiPidx !== pidx) {
      return Response.json(
        { error: "Payment session doesn't match this teammate request — start again 🔄" },
        { status: 400 }
      );
    }

    const cfg = getKhaltiConfig();
    const isMock = pidx.startsWith("mock-") || !cfg.secretKey;

    if (isMock) {
      if (!mockApprove) {
        return Response.json({ ok: false, error: "Mock payment not approved" }, { status: 400 });
      }
      const payingAdvance = !teamPayment && !paymentRequest && booking.advancePaymentRequired && booking.advancePaymentStatus !== "paid";
      const payingDeposit = !teamPayment && !paymentRequest && !payingAdvance && booking.depositRequired && booking.depositStatus !== "paid";
      const paidAmount = paymentRequest
        ? Number(paymentRequest.amountDue || 0)
        : teamPayment
          ? Number(teamPayment.amountDue || 0)
          : payingAdvance
          ? Number(booking.advancePaymentAmount || 0)
          : payingDeposit
            ? Number(booking.depositAmount || 0)
            : Math.max(0, Number(booking.totalPrice || 0) - Number(booking.paidAmount || 0));
      const reference = `MOCK-${pidx.slice(0, 24)}`.slice(0, 100);
      if (paymentRequest) {
        const paidRequest = await recordRequestedKhaltiPayment(booking, paymentRequest, paidAmount, reference);
        const refreshed = await db.select().from(bookings).where(eq(bookings.id, booking.id));
        return Response.json({ ok: true, mock: true, booking: refreshed[0], paymentRequest: paidRequest, transactionId: reference });
      }
      if (teamPayment) {
        const paidTeam = await recordTeamKhaltiPayment(booking, teamPayment, paidAmount, reference, "Khalti simulator");
        const refreshed = await db.select().from(bookings).where(eq(bookings.id, booking.id));
        return Response.json({ ok: true, mock: true, booking: refreshed[0], teamPayment: paidTeam, transactionId: reference });
      }
      const newPaid = Math.min(booking.totalPrice, Number(booking.paidAmount || 0) + paidAmount);
      const patch: Partial<typeof bookings.$inferInsert> = {
        gatewayTxnId: reference,
        paidAmount: newPaid,
        advancePaymentStatus: payingAdvance ? "paid" : booking.advancePaymentStatus,
        paymentMethod: payingAdvance && newPaid < booking.totalPrice ? "Cash at Venue" : booking.paymentMethod,
        depositStatus:
          booking.depositRequired && newPaid >= Number(booking.depositAmount || 0)
            ? "paid"
            : booking.depositStatus,
      };
      if (payingDeposit) {
        patch.paymentStatus = newPaid >= booking.totalPrice ? "paid" : "deposit_paid";
        patch.depositStatus = "paid";
      } else if (newPaid < booking.totalPrice) {
        patch.paymentStatus = "pending";
      } else {
        patch.paymentStatus = "paid";
      }
      const updated = await db.update(bookings).set(patch).where(eq(bookings.id, booking.id)).returning();
      await recordGatewayPayment({
        bookingId: booking.id,
        amount: paidAmount,
        method: "Khalti",
        reference,
        userId: booking.userId,
        note: booking.advancePaymentRequired ? "Khalti advance simulator" : "Khalti simulator",
      });
      return Response.json({ ok: true, mock: true, booking: updated[0], transactionId: reference });
    }

    // Real sandbox lookup.
    const lookup = await khaltiLookup({ secretKey: cfg.secretKey, lookupUrl: cfg.lookupUrl, pidx });
    const status = String(lookup.status || "");
    if (status !== "Completed") {
      return Response.json(
        { ok: false, status, error: `Khalti says: ${status || "not completed"}` },
        { status: 400 }
      );
    }
    const paidPaisa = Number(lookup.total_amount || 0);
    const paidNpr = paidPaisa > 0 ? Math.round(paidPaisa / 100) : undefined;
    const reference = String(lookup.transaction_id || pidx).slice(0, 100);
    const payingAdvance = !teamPayment && !paymentRequest && booking.advancePaymentRequired && booking.advancePaymentStatus !== "paid";
    const payingDeposit = !teamPayment && !paymentRequest && !payingAdvance && booking.depositRequired && booking.depositStatus !== "paid";
    const expectedAmount = paymentRequest
      ? Number(paymentRequest.amountDue || 0)
      : teamPayment
        ? Number(teamPayment.amountDue || 0)
        : payingAdvance
        ? Number(booking.advancePaymentAmount || 0)
        : payingDeposit
          ? Number(booking.depositAmount || 0)
          : Math.max(0, Number(booking.totalPrice || 0) - Number(booking.paidAmount || 0));
    if (paidNpr !== undefined && Math.abs(paidNpr - expectedAmount) > 0)
      return Response.json({ error: `Amount mismatch: paid ${paidNpr}, expected ${expectedAmount} 💳` }, { status: 400 });
    const resolvedAmount = paidNpr ?? expectedAmount;
    if (paymentRequest) {
      const paidRequest = await recordRequestedKhaltiPayment(booking, paymentRequest, resolvedAmount, reference);
      const refreshed = await db.select().from(bookings).where(eq(bookings.id, booking.id));
      return Response.json({ ok: true, booking: refreshed[0], paymentRequest: paidRequest, transactionId: reference, lookup });
    }
    if (teamPayment) {
      const paidTeam = await recordTeamKhaltiPayment(booking, teamPayment, resolvedAmount, reference, "Khalti");
      const refreshed = await db.select().from(bookings).where(eq(bookings.id, booking.id));
      return Response.json({ ok: true, booking: refreshed[0], teamPayment: paidTeam, transactionId: reference, lookup });
    }
    const newPaid = Math.min(booking.totalPrice, Number(booking.paidAmount || 0) + resolvedAmount);
    const patch: Partial<typeof bookings.$inferInsert> = {
      gatewayTxnId: reference,
      paidAmount: newPaid,
      advancePaymentStatus: payingAdvance ? "paid" : booking.advancePaymentStatus,
      paymentMethod: payingAdvance && newPaid < booking.totalPrice ? "Cash at Venue" : booking.paymentMethod,
      depositStatus:
        booking.depositRequired && newPaid >= Number(booking.depositAmount || 0)
          ? "paid"
          : booking.depositStatus,
    };
    if (payingDeposit) {
      patch.paymentStatus = newPaid >= booking.totalPrice ? "paid" : "deposit_paid";
      patch.depositStatus = "paid";
    } else if (newPaid < booking.totalPrice) {
      patch.paymentStatus = "pending";
    } else {
      patch.paymentStatus = "paid";
    }
    const updated = await db.update(bookings).set(patch).where(eq(bookings.id, booking.id)).returning();
    await recordGatewayPayment({
      bookingId: booking.id,
      amount: Number(patch.paidAmount || 0),
      method: "Khalti",
      reference: String(patch.gatewayTxnId || pidx),
      userId: booking.userId,
      note: "Khalti",
    });

    try {
      const courtRows = await db.select().from(courts).where(eq(courts.id, booking.courtId));
      const venueRows = courtRows[0]
        ? await db.select().from(venues).where(eq(venues.id, courtRows[0].venueId))
        : [];
      const venue = venueRows[0];
      if (venue?.ownerId) {
        await sendNotification({
          userId: venue.ownerId,
          type: "payment",
          title: `💰 Khalti ${payingDeposit ? "deposit" : payingAdvance ? "advance" : "balance"} verified — ${venue.name}`,
          message: `${booking.bookerName || "Player"} paid ${formatNPR(Number(patch.paidAmount || 0))} via Khalti test (txn ${String(lookup.transaction_id || pidx).slice(0, 20)}). Booking #FN-${booking.id}.`,
          link: "/admin/bookings",
        });
      }
    } catch {}

    return Response.json({ ok: true, booking: updated[0], transactionId: lookup.transaction_id, lookup });
  } catch (e) {
    console.error(`[/api/payments/khalti/verify POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
