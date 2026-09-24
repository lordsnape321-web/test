import { db } from "@/db";
import { bookings, courts, venues } from "@/db/schema";
import { eq } from "drizzle-orm";
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
    if (booking.paymentMethod !== "eSewa") {
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
    if (booking.paymentStatus === "paid" || booking.paymentStatus === "deposit_paid") {
      return Response.json({ error: "Already paid ✅", booking }, { status: 400 });
    }
    const amount = booking.depositRequired
      ? Number(booking.depositAmount || 0)
      : Number(booking.totalPrice || 0);
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
    const transactionUuid = makeEsewaUuid(booking.id);

    await db
      .update(bookings)
      .set({ esewaUuid: transactionUuid, gatewayTxnId: "" })
      .where(eq(bookings.id, booking.id));

    const successUrl = `${origin}/payment/esewa/success?bookingId=${booking.id}`;
    const failureUrl = `${origin}/payment/esewa/failure?bookingId=${booking.id}`;
    const fields = buildEsewaFields({
      amount,
      transactionUuid,
      productCode: cfg.productCode,
      secretKey: cfg.secretKey,
      successUrl,
      failureUrl,
    });

    const mockUrl = `${origin}/payment/esewa/mock?bookingId=${booking.id}&amount=${amount}&uuid=${encodeURIComponent(transactionUuid)}`;
    return Response.json({
      url: cfg.formUrl,
      fields,
      amount,
      bookingId: booking.id,
      transactionUuid,
      venueName,
      isDeposit: booking.depositRequired,
      testMode: true,
      mockUrl,
      testHint: "eSewa UAT: use ID 9806800001 / password 123456 / MPIN 1122 / token 123456",
    });
  } catch (e) {
    console.error(`[/api/payments/esewa/initiate POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
