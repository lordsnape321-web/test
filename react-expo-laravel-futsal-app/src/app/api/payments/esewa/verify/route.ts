import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookingPaymentRequests, bookingTeamPayments, bookings, courts, venues } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  getEsewaConfig,
  decodeEsewaData,
  verifyEsewaSignature,
  parseBookingIdFromEsewaUuid,
  esewaStatusCheck,
} from "@/lib/payments";
import { sendNotification } from "@/lib/notify";
import { recordGatewayPayment } from "@/lib/ledger-record";
import { formatNPR } from "@/lib/futsal";
import { expireOverdueAdvanceRequests } from "@/lib/advance-payment";

export const dynamic = "force-dynamic";

function teamPaymentIdFromUuid(uuid: string) {
  const match = /-TP-(\d+)(?:-|$)/.exec(uuid);
  return match ? Number(match[1]) : null;
}

/** Update the member share and the aggregate booking without making the UI
 * pretend a gateway payment happened. Every successful share also gets the
 * normal append-only booking ledger row. */
async function recordTeamEsewaPayment(
  booking: typeof bookings.$inferSelect,
  teamPayment: typeof bookingTeamPayments.$inferSelect,
  amount: number,
  reference: string,
  note: string,
) {
  if (teamPayment.paymentStatus === "paid") return teamPayment;
  const updatedRows = await db
    .update(bookingTeamPayments)
    .set({
      paymentStatus: "paid",
      paidAmount: amount,
      gatewayTxnId: reference.slice(0, 100),
    })
    .where(eq(bookingTeamPayments.id, teamPayment.id))
    .returning();
  const updatedTeamPayment = updatedRows[0] ?? teamPayment;
  await recordGatewayPayment({
    bookingId: booking.id,
    amount,
    method: "eSewa",
    reference,
    userId: teamPayment.userId,
    note,
  });

  const allShares = await db
    .select()
    .from(bookingTeamPayments)
    .where(eq(bookingTeamPayments.bookingId, booking.id));
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
        title: `💰 Team eSewa share verified — ${venue.name}`,
        message: `${booking.bookerName || "A team member"} paid ${formatNPR(amount)} via eSewa for team booking #FN-${booking.id}. ${formatNPR(paidTotal)} of ${formatNPR(booking.totalPrice)} is now in the ledger.`,
        link: "/admin/bookings",
      });
    }
    await sendNotification({
      userId: teamPayment.userId,
      type: "payment",
      title: "✅ Team share paid",
      message: `Your ${formatNPR(amount)} eSewa share for booking #FN-${booking.id} is confirmed and recorded in the booking ledger.`,
      link: "/bookings",
    });
  } catch {}
  return updatedTeamPayment;
}

async function recordRequestedEsewaPayment(
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
    method: "eSewa",
    reference,
    userId: request.payerId,
    note: `eSewa teammate ${request.purpose} payment`,
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
        title: `💰 Teammate eSewa payment received — ${venue.name}`,
        message: `A teammate paid ${formatNPR(amount)} directly to ${venue.name} for booking #FN-${booking.id}. The captain's requested ${request.purpose} amount is now in the ledger.`,
        link: "/admin/bookings",
      });
    }
    await sendNotification({
      userId: request.requestedBy,
      type: "payment",
      title: "✅ Teammate payment received",
      message: `Your teammate paid ${formatNPR(amount)} via eSewa for booking #FN-${booking.id}. The venue has the money in its booking ledger.`,
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
    const dataB64 = String(body.data ?? "").trim();
    const hintBookingId = Number(body.bookingId ?? 0) || null;
    const mockApprove = body.mockApprove === true;

    // Simulator fallback: lets users complete the flow when the real
    // eSewa test site is unreachable (e.g. "refused to connect").
    if (mockApprove) {
      if (!hintBookingId) return Response.json({ error: "Missing booking" }, { status: 400 });
      const mRows = await db.select().from(bookings).where(eq(bookings.id, hintBookingId));
      const mBooking = mRows[0];
      if (!mBooking) return Response.json({ error: "Booking not found" }, { status: 404 });
      if (mBooking.status === "cancelled" || mBooking.status === "rejected")
        return Response.json({ error: "This booking is no longer active" }, { status: 409 });
      const mockTeamPaymentId =
        Number(body.teamPaymentId ?? 0) || teamPaymentIdFromUuid(String(body.uuid ?? ""));
      const mockTeamPayment = mockTeamPaymentId
        ? (await db
            .select()
            .from(bookingTeamPayments)
            .where(and(eq(bookingTeamPayments.id, mockTeamPaymentId), eq(bookingTeamPayments.bookingId, mBooking.id))))[0]
        : null;
      const mockPaymentRequestId = Number(body.paymentRequestId ?? 0) || Number(/-PR-(\d+)/.exec(String(body.uuid ?? ""))?.[1] ?? 0) || null;
      const mockPaymentRequest = mockPaymentRequestId
        ? (await db
            .select()
            .from(bookingPaymentRequests)
            .where(and(eq(bookingPaymentRequests.id, mockPaymentRequestId), eq(bookingPaymentRequests.bookingId, mBooking.id))))[0]
        : null;
      if (mockTeamPaymentId && !mockTeamPayment)
        return Response.json({ error: "Team payment not found" }, { status: 404 });
      if (mockPaymentRequestId && !mockPaymentRequest)
        return Response.json({ error: "Payment request not found" }, { status: 404 });
      const mockPayerId = Number(body.userId ?? 0) || null;
      if (mockPaymentRequest && (!mockPayerId || mockPaymentRequest.payerId !== mockPayerId))
        return Response.json({ error: "Only the requested player can complete this payment 🔒" }, { status: 403 });
      if (mockPaymentRequest && mockPaymentRequest.status !== "pending")
        return Response.json({ error: "This payment request is no longer pending" }, { status: 409 });
      if (mockPaymentRequest && mockPaymentRequest.paymentMethod !== "eSewa")
        return Response.json({ error: "Choose eSewa for this payment request first 💳" }, { status: 400 });
      if (mockTeamPayment && mockPaymentRequest)
        return Response.json({ error: "Choose one payment target at a time" }, { status: 400 });
      if (mBooking.visibility === "competition" && mBooking.competitionStatus === "pending") {
        return Response.json(
          { error: "Payment opens after the opposition captain accepts this competition request 🆚" },
          { status: 409 }
        );
      }
      const payingAdvance = !mockTeamPayment && !mockPaymentRequest && mBooking.advancePaymentRequired && mBooking.advancePaymentStatus !== "paid";
      const payingDeposit = !mockTeamPayment && !mockPaymentRequest && !payingAdvance && mBooking.depositRequired && mBooking.depositStatus !== "paid";
      const paidAmount = mockPaymentRequest
        ? Number(mockPaymentRequest.amountDue || 0)
        : mockTeamPayment
          ? Number(mockTeamPayment.amountDue || 0)
          : payingAdvance
          ? Number(mBooking.advancePaymentAmount || 0)
          : payingDeposit
            ? Number(mBooking.depositAmount || 0)
            : Math.max(0, Number(mBooking.totalPrice || 0) - Number(mBooking.paidAmount || 0));
      // Deterministic on purpose: this id is also the ledger's idempotency key,
      // so a replayed verify callback can't turn one payment into two instalments.
      const mockTxn = `MOCK-ESEWA-${mBooking.id}${mockTeamPayment ? `-TP-${mockTeamPayment.id}` : mockPaymentRequest ? `-PR-${mockPaymentRequest.id}` : payingAdvance ? "-ADV" : payingDeposit ? "-DEP" : `-BAL-${mBooking.paidAmount}`}`.slice(0, 100);
      if (mockPaymentRequest) {
        const paidRequest = await recordRequestedEsewaPayment(mBooking, mockPaymentRequest, paidAmount, mockTxn);
        const refreshed = await db.select().from(bookings).where(eq(bookings.id, mBooking.id));
        return Response.json({ ok: true, mock: true, booking: refreshed[0], paymentRequest: paidRequest, transactionCode: mockTxn });
      }
      if (mockTeamPayment) {
        const paidTeam = await recordTeamEsewaPayment(mBooking, mockTeamPayment, paidAmount, mockTxn, "eSewa simulator");
        const refreshed = await db.select().from(bookings).where(eq(bookings.id, mBooking.id));
        return Response.json({ ok: true, mock: true, booking: refreshed[0], teamPayment: paidTeam, transactionCode: mockTxn });
      }
      const newPaid = Math.min(mBooking.totalPrice, Number(mBooking.paidAmount || 0) + paidAmount);
      const patch: Partial<typeof bookings.$inferInsert> = {
        gatewayTxnId: mockTxn,
        paidAmount: newPaid,
        advancePaymentStatus: payingAdvance ? "paid" : mBooking.advancePaymentStatus,
        paymentMethod: payingAdvance && newPaid < mBooking.totalPrice ? "Cash at Venue" : mBooking.paymentMethod,
        depositStatus:
          mBooking.depositRequired && newPaid >= Number(mBooking.depositAmount || 0)
            ? "paid"
            : mBooking.depositStatus,
      };
      if (payingDeposit) {
        patch.paymentStatus = newPaid >= mBooking.totalPrice ? "paid" : "deposit_paid";
        patch.depositStatus = "paid";
      } else if (newPaid < mBooking.totalPrice) {
        patch.paymentStatus = "pending";
      } else {
        patch.paymentStatus = "paid";
      }
      const updated = await db.update(bookings).set(patch).where(eq(bookings.id, mBooking.id)).returning();
      await recordGatewayPayment({
        bookingId: mBooking.id,
        amount: paidAmount,
        method: "eSewa",
        reference: mockTxn,
        userId: mBooking.userId,
        note: mBooking.advancePaymentRequired ? "eSewa advance simulator" : "eSewa simulator",
      });
      try {
        const courtRows = await db.select().from(courts).where(eq(courts.id, mBooking.courtId));
        const venueRows = courtRows[0]
          ? await db.select().from(venues).where(eq(venues.id, courtRows[0].venueId))
          : [];
        const venue = venueRows[0];
        if (venue?.ownerId) {
          await sendNotification({
            userId: venue.ownerId,
            type: "payment",
            title: `💰 eSewa ${payingDeposit ? "deposit" : payingAdvance ? "advance" : "balance"} verified — ${venue.name}`,
            message: `${mBooking.bookerName || "Player"} paid ${formatNPR(paidAmount)} via eSewa simulator (txn ${mockTxn}). Booking #FN-${mBooking.id}.`,
            link: "/admin/bookings",
          });
        }
      } catch {}
      return Response.json({ ok: true, mock: true, booking: updated[0], transactionCode: mockTxn });
    }

    if (!dataB64) return Response.json({ error: "Missing eSewa data" }, { status: 400 });

    let payload;
    try {
      payload = decodeEsewaData(dataB64);
    } catch {
      return Response.json({ error: "Invalid eSewa response — try again 🙏" }, { status: 400 });
    }

    const cfg = getEsewaConfig();
    const sigOk = verifyEsewaSignature(payload, cfg.secretKey);
    if (!sigOk) {
      return Response.json({ error: "eSewa signature mismatch — possible tampering 🛡️" }, { status: 400 });
    }

    const uuid = String(payload.transaction_uuid || "");
    const bookingId = hintBookingId || parseBookingIdFromEsewaUuid(uuid);
    const teamPaymentId = Number(body.teamPaymentId ?? 0) || teamPaymentIdFromUuid(uuid);
    const paymentRequestId = Number(body.paymentRequestId ?? 0) || Number(/-PR-(\d+)/.exec(uuid)?.[1] ?? 0) || null;
    if (!bookingId) return Response.json({ error: "Can't link payment to booking" }, { status: 400 });

    const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const booking = rows[0];
    if (!booking) return Response.json({ error: "Booking not found" }, { status: 404 });
    if (booking.status === "cancelled" || booking.status === "rejected")
      return Response.json({ error: "This booking is no longer active" }, { status: 409 });
    if (booking.visibility === "competition" && booking.competitionStatus === "pending") {
      return Response.json(
        { error: "Payment opens after the opposition captain accepts this competition request 🆚" },
        { status: 409 }
      );
    }
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
    if (paymentRequest && paymentRequest.paymentMethod !== "eSewa")
      return Response.json({ error: "Choose eSewa for this payment request first 💳" }, { status: 400 });
    if (!teamPayment && !paymentRequest && booking.esewaUuid && booking.esewaUuid !== uuid) {
      return Response.json(
        { error: "Transaction doesn't match this booking — please start payment again 🔄" },
        { status: 400 }
      );
    }

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
    const paidTotal = Number(String(payload.total_amount || "0").replace(/,/g, ""));
    if (Math.abs(paidTotal - expectedAmount) > 0.01) {
      return Response.json(
        { error: `Amount mismatch: paid ${paidTotal}, expected ${expectedAmount} 🛡️` },
        { status: 400 }
      );
    }

    if (String(payload.status || "").toUpperCase() !== "COMPLETE") {
      return Response.json(
        { ok: false, status: payload.status, error: "eSewa payment not completed" },
        { status: 400 }
      );
    }

    // Defence in depth: confirm with eSewa status API.
    try {
      const st = await esewaStatusCheck({
        statusUrl: cfg.statusUrl,
        productCode: cfg.productCode,
        transactionUuid: uuid,
        totalAmount: paidTotal,
      });
      const s = String(st.status || "").toUpperCase();
      if (s && s !== "COMPLETE") {
        return Response.json({ ok: false, status: s, error: `eSewa says: ${s}` }, { status: 400 });
      }
    } catch {
      // If status API is unreachable in sandbox, trust verified signature + COMPLETE.
    }

    const txnCode = String(payload.transaction_code || "") || uuid;
    if (paymentRequest) {
      const paidRequest = await recordRequestedEsewaPayment(booking, paymentRequest, Math.round(paidTotal), txnCode);
      const refreshed = await db.select().from(bookings).where(eq(bookings.id, booking.id));
      return Response.json({ ok: true, booking: refreshed[0], paymentRequest: paidRequest, transactionCode: txnCode });
    }
    if (teamPayment) {
      const paidTeam = await recordTeamEsewaPayment(
        booking,
        teamPayment,
        Math.round(paidTotal),
        txnCode,
        "eSewa",
      );
      const refreshed = await db.select().from(bookings).where(eq(bookings.id, booking.id));
      return Response.json({ ok: true, booking: refreshed[0], teamPayment: paidTeam, transactionCode: txnCode });
    }
    const newPaid = Math.min(booking.totalPrice, Number(booking.paidAmount || 0) + Math.round(paidTotal));
    const patch: Partial<typeof bookings.$inferInsert> = {
      gatewayTxnId: txnCode.slice(0, 100),
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
    const updated = await db.update(bookings).set(patch).where(eq(bookings.id, bookingId)).returning();
    await recordGatewayPayment({
      bookingId,
      amount: Number(patch.paidAmount || 0),
      method: "eSewa",
      reference: String(patch.gatewayTxnId || txnCode),
      userId: booking.userId,
      note: "eSewa",
    });

    // Notify owner.
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
          title: `💰 eSewa ${payingDeposit ? "deposit" : payingAdvance ? "advance" : "balance"} verified — ${venue.name}`,
          message: `${booking.bookerName || "Player"} paid ${formatNPR(Math.round(paidTotal))} via eSewa test (txn ${txnCode || uuid}). Booking #FN-${bookingId}.`,
          link: "/admin/bookings",
        });
      }
    } catch {}

    return Response.json({ ok: true, booking: updated[0], transactionCode: txnCode });
  } catch (e) {
    console.error(`[/api/payments/esewa/verify POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
