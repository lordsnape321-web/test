import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookingTeamPayments, bookings, courts, teamMembers, venues } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { parsePayments, ONLINE_PAYMENTS } from "@/lib/loyalty";
import { sendNotification } from "@/lib/notify";
import { formatNPR } from "@/lib/futsal";
import { expireOverdueAdvanceRequests } from "@/lib/advance-payment";

export const dynamic = "force-dynamic";

async function loadBooking(bookingId: number) {
  const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  const booking = rows[0];
  if (!booking) return null;
  const courtRows = await db.select().from(courts).where(eq(courts.id, booking.courtId));
  const court = courtRows[0];
  const venue = court
    ? (await db.select().from(venues).where(eq(venues.id, court.venueId)))[0]
    : undefined;
  return { booking, venue };
}

function responseRow(row: typeof bookingTeamPayments.$inferSelect) {
  return {
    id: row.id,
    bookingId: row.bookingId,
    teamId: row.teamId,
    userId: row.userId,
    amountDue: row.amountDue,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    paidAmount: row.paidAmount,
    gatewayTxnId: row.gatewayTxnId,
    esewaUuid: row.esewaUuid,
    khaltiPidx: row.khaltiPidx,
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureCompetitionBookingColumns();
    await expireOverdueAdvanceRequests();
    const bookingId = Number((await params).id);
    const viewerId = Number(new URL(req.url).searchParams.get("userId") ?? 0);
    if (!Number.isInteger(bookingId) || bookingId <= 0 || !Number.isInteger(viewerId) || viewerId <= 0)
      return Response.json({ error: "Invalid booking or player 🔒" }, { status: 400 });
    const loaded = await loadBooking(bookingId);
    if (!loaded?.booking) return Response.json({ error: "Booking not found" }, { status: 404 });
    const booking = loaded.booking;
    if (!booking.teamId) return Response.json({ teamPayments: [] });
    const member = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, booking.teamId), eq(teamMembers.userId, viewerId)));
    if (booking.userId !== viewerId && member.length === 0)
      return Response.json({ error: "This team payment is private to the booking squad 🔒" }, { status: 403 });
    const rows = await db
      .select()
      .from(bookingTeamPayments)
      .where(eq(bookingTeamPayments.bookingId, bookingId));
    return Response.json({ teamPayments: rows.map(responseRow) });
  } catch (e) {
    console.error("[/api/bookings/[id]/team-payments GET] failed:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/** Pick a durable payment method for this member's share. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureCompetitionBookingColumns();
    await expireOverdueAdvanceRequests();
    const bookingId = Number((await params).id);
    const body = await req.json().catch(() => ({}));
    const userId = Number(body.userId ?? 0);
    const method = String(body.paymentMethod ?? "").trim();
    if (!Number.isInteger(bookingId) || bookingId <= 0 || !Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Invalid booking or player 🔒" }, { status: 400 });
    if (!["eSewa", "Khalti", "Cash at Venue"].includes(method))
      return Response.json({ error: "Pick eSewa, Khalti, or Cash at Venue 💳" }, { status: 400 });

    const loaded = await loadBooking(bookingId);
    if (!loaded?.booking) return Response.json({ error: "Booking not found" }, { status: 404 });
    const { booking, venue } = loaded;
    if (!booking.teamId) return Response.json({ error: "This is not a team booking" }, { status: 400 });
    if (booking.status === "cancelled" || booking.status === "rejected")
      return Response.json({ error: "Cancelled bookings cannot collect team payments" }, { status: 409 });
    if (booking.visibility === "competition" && booking.competitionStatus === "pending")
      return Response.json({ error: "Team payment opens after the opposition captain accepts this competition request 🆚" }, { status: 409 });
    if (booking.advancePaymentRequired && booking.advancePaymentStatus !== "paid" && method === "Cash at Venue")
      return Response.json({ error: "Cash at Venue cannot satisfy an unpaid venue advance. Choose eSewa or Khalti first 💳" }, { status: 409 });
    const roster = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, booking.teamId), eq(teamMembers.userId, userId)));
    if (booking.userId !== userId && roster.length === 0)
      return Response.json({ error: "Only a member of this booking's team can choose a share method 🔒" }, { status: 403 });
    const accepted = parsePayments(venue?.acceptedPayments);
    if (!accepted.includes(method))
      return Response.json({ error: `This venue accepts ${accepted.join(", ")} only 💳` }, { status: 400 });

    const rows = await db
      .select()
      .from(bookingTeamPayments)
      .where(and(eq(bookingTeamPayments.bookingId, bookingId), eq(bookingTeamPayments.userId, userId)));
    const row = rows[0];
    if (!row) return Response.json({ error: "No team share was created for this player" }, { status: 404 });
    if (row.paymentStatus === "paid") return Response.json({ teamPayment: responseRow(row) });

    const updated = await db
      .update(bookingTeamPayments)
      .set({
        paymentMethod: method,
        paymentStatus: row.amountDue === 0 ? "paid" : "pending",
      })
      .where(eq(bookingTeamPayments.id, row.id))
      .returning();
    const next = updated[0];

    // Online gateway initiation is deliberately separate: this mutation only
    // records the member's choice. The gateway then verifies the exact stored
    // share and updates this same row plus the booking ledger.
    if (method === "Cash at Venue") {
      const ownerId = venue?.ownerId ?? 0;
      if (ownerId) {
        await sendNotification({
          userId: ownerId,
          type: "payment",
          title: "💵 Team member chose cash",
          message: `A team member selected Cash at Venue for ${formatNPR(row.amountDue)} on booking #FN-${bookingId}. Collect it at the desk and record it in the booking ledger.`,
          link: "/admin/requests",
        });
      }
    }
    return Response.json({ teamPayment: responseRow(next), online: ONLINE_PAYMENTS.includes(method) });
  } catch (e) {
    console.error("[/api/bookings/[id]/team-payments POST] failed:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
