import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookings, bookingTeamPayments, courts, venues } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { gamePlayed } from "@/lib/futsal";
import {
  getEsewaConfig,
  getAppOrigin,
  makeEsewaUuid,
  buildEsewaFields,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureCompetitionBookingColumns();
    const body = await req.json();
    const bookingId = Number(body.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return Response.json({ error: "Invalid booking 📋" }, { status: 400 });
    }
    const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const booking = rows[0];
    if (!booking) return Response.json({ error: "Booking not found" }, { status: 404 });
    if (booking.visibility === "competition" && booking.competitionStatus === "pending") {
      return Response.json(
        { error: "Payment opens after the opposition captain accepts this competition request 🆚" },
        { status: 409 }
      );
    }
    const teamPaymentId = Number(body.teamPaymentId ?? 0) || null;
    const requestedUserId = Number(body.userId ?? 0) || null;
    const teamPayment = teamPaymentId
      ? (await db
          .select()
          .from(bookingTeamPayments)
          .where(and(eq(bookingTeamPayments.id, teamPaymentId), eq(bookingTeamPayments.bookingId, booking.id))))[0]
      : null;
    if (teamPaymentId && (!teamPayment || (requestedUserId && teamPayment.userId !== requestedUserId)))
      return Response.json({ error: "That team payment does not belong to this booking or player 🔒" }, { status: 403 });
    if (teamPayment && teamPayment.paymentMethod !== "eSewa") {
      return Response.json({ error: "Choose eSewa for this team share first 💳" }, { status: 400 });
    }
    if (!teamPayment && booking.paymentMethod !== "eSewa") {
      return Response.json({ error: "This booking is not an eSewa payment 💳" }, { status: 400 });
    }
    if (gamePlayed(booking)) {
      return Response.json(
        {
          error:
            "That game is already played 🔒 — the booking is locked, so payment can't be started for it now.",
        },
        { status: 409 }
      );
    }
    if (teamPayment && teamPayment.paymentStatus === "paid")
      return Response.json({ error: "This team share is already paid ✅", teamPayment }, { status: 400 });
    const payingAdvance = !teamPayment && booking.advancePaymentRequired && booking.advancePaymentStatus !== "paid";
    const payingDeposit = !teamPayment && !payingAdvance && booking.depositRequired && booking.depositStatus !== "paid";
    if (!teamPayment && booking.paymentStatus === "paid") {
      return Response.json({ error: "Already paid ✅", booking }, { status: 400 });
    }
    const amount = teamPayment
      ? Number(teamPayment.amountDue || 0)
      : payingAdvance
        ? Number(booking.advancePaymentAmount || 0)
        : payingDeposit
          ? Number(booking.depositAmount || 0)
          : Math.max(0, Number(booking.totalPrice || 0) - Number(booking.paidAmount || 0));
    if (!Number.isFinite(amount) || amount < 10) {
      return Response.json(
        { error: "Amount too small for eSewa test (min Rs. 10) 💰" },
        { status: 400 }
      );
    }

    const courtRows = await db.select().from(courts).where(eq(courts.id, booking.courtId));
    const court = courtRows[0];
    const venueRows = court
      ? await db.select().from(venues).where(eq(venues.id, court.venueId))
      : [];
    const venueName = venueRows[0]?.name ?? "Futsal";

    const cfg = getEsewaConfig();
    const origin = getAppOrigin(req.url, req);
    const transactionUuid = `${makeEsewaUuid(booking.id)}${teamPayment ? `-TP-${teamPayment.id}` : ""}`;

    if (teamPayment) {
      await db
        .update(bookingTeamPayments)
        .set({ esewaUuid: transactionUuid, gatewayTxnId: "" })
        .where(eq(bookingTeamPayments.id, teamPayment.id));
    } else {
      await db
        .update(bookings)
        .set({ esewaUuid: transactionUuid, gatewayTxnId: "" })
        .where(eq(bookings.id, booking.id));
    }

    const successUrl = `${origin}/payment/esewa/success?bookingId=${booking.id}${teamPayment ? `&teamPaymentId=${teamPayment.id}` : ""}`;
    const failureUrl = `${origin}/payment/esewa/failure?bookingId=${booking.id}${teamPayment ? `&teamPaymentId=${teamPayment.id}` : ""}`;
    const fields = buildEsewaFields({
      amount,
      transactionUuid,
      productCode: cfg.productCode,
      secretKey: cfg.secretKey,
      successUrl,
      failureUrl,
    });

    const mockUrl = `${origin}/payment/esewa/mock?bookingId=${booking.id}&amount=${amount}&uuid=${encodeURIComponent(transactionUuid)}${teamPayment ? `&teamPaymentId=${teamPayment.id}&userId=${teamPayment.userId}` : ""}`;
    return Response.json({
      url: cfg.formUrl,
      fields,
      amount,
      bookingId: booking.id,
      teamPaymentId: teamPayment?.id ?? null,
      transactionUuid,
      venueName,
      isDeposit: !teamPayment && booking.depositRequired,
      isAdvance: !teamPayment && booking.advancePaymentRequired,
      testMode: true,
      mockUrl,
      testHint: "eSewa UAT: use ID 9806800001 / password 123456 / MPIN 1122 / token 123456",
    });
  } catch (e) {
    console.error(`[/api/payments/esewa/initiate POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
