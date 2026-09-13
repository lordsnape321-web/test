import { db } from "@/db";
import { bookings, courts, venues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getKhaltiConfig, khaltiLookup } from "@/lib/payments";
import { sendNotification } from "@/lib/notify";
import { formatNPR } from "@/lib/futsal";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
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
    if (booking.khaltiPidx && booking.khaltiPidx !== pidx) {
      return Response.json(
        { error: "Payment session doesn't match this booking — start again 🔄" },
        { status: 400 }
      );
    }

    const cfg = getKhaltiConfig();
    const isMock = pidx.startsWith("mock-") || !cfg.secretKey;

    if (isMock) {
      if (!mockApprove) {
        return Response.json({ ok: false, error: "Mock payment not approved" }, { status: 400 });
      }
      const paidAmount = booking.depositRequired
        ? Number(booking.depositAmount || 0)
        : Number(booking.totalPrice || 0);
      const patch: Partial<typeof bookings.$inferInsert> = {
        gatewayTxnId: `MOCK-${pidx.slice(0, 24)}`.slice(0, 100),
        paidAmount,
      };
      if (booking.depositRequired) {
        patch.paymentStatus = "deposit_paid";
        patch.depositStatus = "paid";
      } else {
        patch.paymentStatus = "paid";
      }
      const updated = await db.update(bookings).set(patch).where(eq(bookings.id, booking.id)).returning();
      return Response.json({ ok: true, mock: true, booking: updated[0], transactionId: patch.gatewayTxnId });
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
    const patch: Partial<typeof bookings.$inferInsert> = {
      gatewayTxnId: String(lookup.transaction_id || pidx).slice(0, 100),
      paidAmount:
        paidNpr ??
        (booking.depositRequired ? Number(booking.depositAmount || 0) : Number(booking.totalPrice || 0)),
    };
    if (booking.depositRequired) {
      patch.paymentStatus = "deposit_paid";
      patch.depositStatus = "paid";
    } else {
      patch.paymentStatus = "paid";
    }
    const updated = await db.update(bookings).set(patch).where(eq(bookings.id, booking.id)).returning();

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
          title: `💰 Khalti ${booking.depositRequired ? "deposit" : "payment"} verified — ${venue.name}`,
          message: `${booking.bookerName || "Player"} paid ${formatNPR(Number(patch.paidAmount || 0))} via Khalti test (txn ${String(lookup.transaction_id || pidx).slice(0, 20)}). Booking #FN-${booking.id}.`,
          link: "/admin/bookings",
        });
      }
    } catch {}

    return Response.json({ ok: true, booking: updated[0], transactionId: lookup.transaction_id, lookup });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
