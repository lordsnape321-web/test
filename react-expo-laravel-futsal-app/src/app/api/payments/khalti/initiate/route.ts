import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookingTeamPayments, bookings, courts, venues, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { gamePlayed } from "@/lib/futsal";
import { getKhaltiConfig, getAppOrigin, makeKhaltiOrderId, khaltiInitiate } from "@/lib/payments";

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
    if (teamPayment && teamPayment.paymentMethod !== "Khalti")
      return Response.json({ error: "Choose Khalti for this team share first 💳" }, { status: 400 });
    if (!teamPayment && booking.paymentMethod !== "Khalti") {
      return Response.json({ error: "This booking is not a Khalti payment 💳" }, { status: 400 });
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
    const amountNpr = teamPayment
      ? Number(teamPayment.amountDue || 0)
      : payingAdvance
        ? Number(booking.advancePaymentAmount || 0)
        : payingDeposit
          ? Number(booking.depositAmount || 0)
          : Math.max(0, Number(booking.totalPrice || 0) - Number(booking.paidAmount || 0));
    if (!Number.isFinite(amountNpr) || amountNpr < 10) {
      return Response.json(
        { error: "Khalti needs at least Rs. 10 (1000 paisa) 💰" },
        { status: 400 }
      );
    }

    const courtRows = await db.select().from(courts).where(eq(courts.id, booking.courtId));
    const venueRows = courtRows[0]
      ? await db.select().from(venues).where(eq(venues.id, courtRows[0].venueId))
      : [];
    const userRows = await db.select().from(users).where(eq(users.id, teamPayment?.userId ?? booking.userId));
    const venueName = venueRows[0]?.name ?? "Futsal Court";
    const customer = userRows[0];

    const cfg = getKhaltiConfig();
    const origin = getAppOrigin(req.url, req);
    const orderId = `${makeKhaltiOrderId(booking.id)}${teamPayment ? `-TP-${teamPayment.id}` : ""}`;
    const returnUrl = `${origin}/payment/khalti/callback?bookingId=${booking.id}${teamPayment ? `&teamPaymentId=${teamPayment.id}` : ""}`;
    const amountPaisa = Math.round(amountNpr * 100);

    // No secret configured -> local test simulator (fully functional demo).
    if (!cfg.secretKey) {
      const mockPidx = `mock-${orderId}`;
      if (teamPayment) {
        await db
          .update(bookingTeamPayments)
          .set({ khaltiPidx: mockPidx })
          .where(eq(bookingTeamPayments.id, teamPayment.id));
      } else {
        await db
          .update(bookings)
          .set({ khaltiPidx: mockPidx })
          .where(eq(bookings.id, booking.id));
      }
      const mockUrl = `${origin}/payment/khalti/mock?pidx=${encodeURIComponent(
        mockPidx
      )}&bookingId=${booking.id}&amount=${amountNpr}${teamPayment ? `&teamPaymentId=${teamPayment.id}&userId=${teamPayment.userId}` : ""}`;
      return Response.json({
        mock: true,
        pidx: mockPidx,
        payment_url: mockUrl,
        amount: amountNpr,
        bookingId: booking.id,
        teamPaymentId: teamPayment?.id ?? null,
        venueName,
        isDeposit: !teamPayment && booking.depositRequired,
        isAdvance: !teamPayment && booking.advancePaymentRequired,
        testHint: "Sandbox simulator — no KHALTI_SECRET_KEY set. Add your Khalti test key to hit the real test-pay page.",
      });
    }

    try {
      const init = await khaltiInitiate({
        secretKey: cfg.secretKey,
        initiateUrl: cfg.initiateUrl,
        returnUrl,
        websiteUrl: origin,
        amountPaisa,
        orderId,
        orderName: `Futsal booking #FN-${booking.id} at ${venueName}`,
        customerName: booking.bookerName || customer?.name || "Futsal Player",
        customerEmail: customer?.email || "player@futsal.np",
        customerPhone: (booking.bookerPhone || customer?.phone || "9800000000").replace(/\D/g, "").slice(-10) || "9800000000",
      });
      if (teamPayment) {
        await db.update(bookingTeamPayments).set({ khaltiPidx: init.pidx }).where(eq(bookingTeamPayments.id, teamPayment.id));
      } else {
        await db.update(bookings).set({ khaltiPidx: init.pidx }).where(eq(bookings.id, booking.id));
      }
      return Response.json({
        mock: false,
        pidx: init.pidx,
        payment_url: init.payment_url,
        amount: amountNpr,
        bookingId: booking.id,
        teamPaymentId: teamPayment?.id ?? null,
        venueName,
        isDeposit: !teamPayment && booking.depositRequired,
        isAdvance: !teamPayment && booking.advancePaymentRequired,
        testHint: "Khalti sandbox: use test ID 9800000001 / MPIN 1111 / OTP 987654",
      });
    } catch (e) {
      // If Khalti sandbox is unreachable / key invalid, fall back to simulator so demo never breaks.
      const mockPidx = `mock-${orderId}`;
      if (teamPayment) {
        await db.update(bookingTeamPayments).set({ khaltiPidx: mockPidx }).where(eq(bookingTeamPayments.id, teamPayment.id));
      } else {
        await db.update(bookings).set({ khaltiPidx: mockPidx }).where(eq(bookings.id, booking.id));
      }
      const mockUrl = `${origin}/payment/khalti/mock?pidx=${encodeURIComponent(
        mockPidx
      )}&bookingId=${booking.id}&amount=${amountNpr}${teamPayment ? `&teamPaymentId=${teamPayment.id}&userId=${teamPayment.userId}` : ""}&fallback=${encodeURIComponent(
        e instanceof Error ? e.message : "khalti-error"
      )}`;
      return Response.json({
        mock: true,
        fallback: true,
        fallbackError: e instanceof Error ? e.message : String(e),
        pidx: mockPidx,
        payment_url: mockUrl,
        amount: amountNpr,
        bookingId: booking.id,
        teamPaymentId: teamPayment?.id ?? null,
        venueName,
        isDeposit: !teamPayment && booking.depositRequired,
        isAdvance: !teamPayment && booking.advancePaymentRequired,
        testHint: "Khalti sandbox unreachable — using local simulator so you can still test.",
      });
    }
  } catch (e) {
    console.error(`[/api/payments/khalti/initiate POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
