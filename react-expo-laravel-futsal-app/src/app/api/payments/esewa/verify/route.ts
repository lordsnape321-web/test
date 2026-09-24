import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookings, courts, venues } from "@/db/schema";
import { eq } from "drizzle-orm";
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

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureCompetitionBookingColumns();
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
      if (mBooking.visibility === "competition" && mBooking.competitionStatus === "pending") {
        return Response.json(
          { error: "Payment opens after the opposition captain accepts this competition request 🆚" },
          { status: 409 }
        );
      }
      const paidAmount = mBooking.depositRequired
        ? Number(mBooking.depositAmount || 0)
        : Number(mBooking.totalPrice || 0);
      // Deterministic on purpose: this id is also the ledger's idempotency key,
      // so a replayed verify callback can't turn one payment into two
      // instalments. Deposit and balance stay distinguishable.
      const mockTxn = `MOCK-ESEWA-${mBooking.id}${mBooking.depositRequired ? "-DEP" : ""}`.slice(0, 100);
      const patch: Partial<typeof bookings.$inferInsert> = {
        gatewayTxnId: mockTxn,
        paidAmount,
      };
      if (mBooking.depositRequired) {
        patch.paymentStatus = "deposit_paid";
        patch.depositStatus = "paid";
      } else {
        patch.paymentStatus = "paid";
      }
      const updated = await db.update(bookings).set(patch).where(eq(bookings.id, mBooking.id)).returning();
      // The ledger is the source of truth for which medium paid what, so an
      // online payment has to land there too — not just in `paidAmount`.
      await recordGatewayPayment({
        bookingId: mBooking.id,
        amount: paidAmount,
        method: "eSewa",
        reference: mockTxn,
        userId: mBooking.userId,
        note: "eSewa simulator",
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
            title: `💰 eSewa ${mBooking.depositRequired ? "deposit" : "payment"} verified — ${venue.name}`,
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
    if (!bookingId) return Response.json({ error: "Can't link payment to booking" }, { status: 400 });

    const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const booking = rows[0];
    if (!booking) return Response.json({ error: "Booking not found" }, { status: 404 });
    if (booking.visibility === "competition" && booking.competitionStatus === "pending") {
      return Response.json(
        { error: "Payment opens after the opposition captain accepts this competition request 🆚" },
        { status: 409 }
      );
    }
    if (booking.esewaUuid && booking.esewaUuid !== uuid) {
      return Response.json(
        { error: "Transaction doesn't match this booking — please start payment again 🔄" },
        { status: 400 }
      );
    }

    const expectedAmount = booking.depositRequired
      ? Number(booking.depositAmount || 0)
      : Number(booking.totalPrice || 0);
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

    const txnCode = String(payload.transaction_code || "");
    const patch: Partial<typeof bookings.$inferInsert> = {
      gatewayTxnId: txnCode.slice(0, 100),
      paidAmount: Math.round(paidTotal),
    };
    if (booking.depositRequired) {
      patch.paymentStatus = "deposit_paid";
      patch.depositStatus = "paid";
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
          title: `💰 eSewa ${booking.depositRequired ? "deposit" : "payment"} verified — ${venue.name}`,
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
