import { and, eq } from "drizzle-orm";
import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookingPaymentRequests, bookings, teamMembers, teams, users, courts, venues } from "@/db/schema";
import { expireOverdueAdvanceRequests, advancePaymentDeadline } from "@/lib/advance-payment";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import { sendNotification } from "@/lib/notify";

export const dynamic = "force-dynamic";

const METHODS = ["eSewa", "Khalti"] as const;
const PURPOSES = ["advance", "booking"] as const;

type PaymentMethod = (typeof METHODS)[number];
type PaymentPurpose = (typeof PURPOSES)[number];

async function loadBooking(bookingId: number) {
  const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  const booking = rows[0];
  if (!booking) return null;
  const court = (await db.select().from(courts).where(eq(courts.id, booking.courtId)))[0];
  const venue = court
    ? (await db.select().from(venues).where(eq(venues.id, court.venueId)))[0]
    : undefined;
  const team = booking.teamId
    ? (await db.select().from(teams).where(eq(teams.id, booking.teamId)))[0]
    : undefined;
  return { booking, court, venue, team };
}

function rowView(row: typeof bookingPaymentRequests.$inferSelect, people: Array<typeof users.$inferSelect>) {
  return {
    id: row.id,
    bookingId: row.bookingId,
    requestedBy: row.requestedBy,
    requesterName: people.find((person) => person.id === row.requestedBy)?.name ?? "Captain",
    payerId: row.payerId,
    payerName: people.find((person) => person.id === row.payerId)?.name ?? "Player",
    amountDue: row.amountDue,
    purpose: row.purpose,
    note: row.note,
    paymentMethod: row.paymentMethod,
    status: row.status,
    paidAmount: row.paidAmount,
    gatewayTxnId: row.gatewayTxnId,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
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
    if (!Number.isInteger(bookingId) || bookingId <= 0 || !Number.isInteger(viewerId) || viewerId <= 0) {
      return Response.json({ error: "Invalid booking or player 🔒" }, { status: 400 });
    }
    const loaded = await loadBooking(bookingId);
    if (!loaded) return Response.json({ error: "Booking not found" }, { status: 404 });
    const { booking } = loaded;
    const member = booking.teamId
      ? await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, booking.teamId), eq(teamMembers.userId, viewerId)))
      : [];
    if (booking.userId !== viewerId && member.length === 0) {
      return Response.json({ error: "Only this booking team can view its payment requests 🔒" }, { status: 403 });
    }
    const rows = await db.select().from(bookingPaymentRequests).where(eq(bookingPaymentRequests.bookingId, bookingId));
    const people = await db.select().from(users);
    return Response.json({ paymentRequests: rows.map((row) => rowView(row, people)) });
  } catch (e) {
    console.error("[/api/bookings/[id]/payment-requests GET] failed:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/** A captain directs one exact online payment request to one teammate. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureCompetitionBookingColumns();
    await expireOverdueAdvanceRequests();
    const bookingId = Number((await params).id);
    const body = await req.json().catch(() => ({}));
    const requesterId = Number(body.requesterId ?? 0);
    const rawPayerIds: unknown[] = Array.isArray(body.payerIds) ? body.payerIds : [body.payerId];
    const payerIds: number[] = Array.from(
      new Set<number>(
        rawPayerIds
          .map((value: unknown) => Number(value))
          .filter((value): value is number => Number.isInteger(value) && value > 0),
      ),
    );
    const amount = Number(body.amount ?? 0);
    const purpose = String(body.purpose ?? "booking") as PaymentPurpose;
    const note = String(body.note ?? "").trim().slice(0, 240);
    if (!Number.isInteger(bookingId) || bookingId <= 0 || !Number.isInteger(requesterId) || requesterId <= 0 || payerIds.length === 0) {
      return Response.json({ error: "Pick a valid booking and at least one player 🔒" }, { status: 400 });
    }
    if (payerIds.length > 30) {
      return Response.json({ error: "You can request money from at most 30 teammates at once" }, { status: 400 });
    }
    if (!Number.isInteger(amount) || amount < 10) {
      return Response.json({ error: "Payment requests must be at least Rs. 10 💰" }, { status: 400 });
    }
    if (!PURPOSES.includes(purpose)) return Response.json({ error: "Pick a valid payment purpose" }, { status: 400 });

    const loaded = await loadBooking(bookingId);
    if (!loaded) return Response.json({ error: "Booking not found" }, { status: 404 });
    const { booking, team, venue, court } = loaded;
    if (!booking.teamId || !team) return Response.json({ error: "Only team bookings can request teammate payments" }, { status: 400 });
    if (booking.status === "cancelled" || booking.status === "rejected" || booking.status === "completed") {
      return Response.json({ error: "This booking is no longer collecting payments" }, { status: 409 });
    }
    if (booking.visibility === "competition" && booking.competitionStatus === "pending") {
      return Response.json({ error: "Payment requests open after the opposition captain accepts this competition request 🆚" }, { status: 409 });
    }
    if (team.captainId !== requesterId || booking.userId !== requesterId) {
      return Response.json({ error: "Only the captain who made this booking can request teammate money 👑" }, { status: 403 });
    }
    if (payerIds.includes(requesterId)) return Response.json({ error: "Choose teammates other than the captain" }, { status: 400 });
    const payerMembers = await db.select().from(teamMembers).where(eq(teamMembers.teamId, booking.teamId));
    const teamPlayerIds = new Set(payerMembers.map((member) => member.userId));
    if (payerIds.some((payerId) => !teamPlayerIds.has(payerId))) {
      return Response.json({ error: "Every selected player must be on this booking's team 🔒" }, { status: 403 });
    }

    const target = purpose === "advance" ? Number(booking.advancePaymentAmount || 0) : Number(booking.totalPrice || 0);
    if (purpose === "advance" && (!booking.advancePaymentRequired || booking.advancePaymentStatus === "paid")) {
      return Response.json({ error: "This booking has no unpaid venue advance" }, { status: 409 });
    }
    if (purpose === "booking" && booking.advancePaymentRequired && booking.advancePaymentStatus !== "paid") {
      return Response.json({ error: "Request the venue advance first; the remaining booking amount opens after it is paid" }, { status: 409 });
    }
    const existing = await db.select().from(bookingPaymentRequests).where(and(eq(bookingPaymentRequests.bookingId, booking.id), eq(bookingPaymentRequests.status, "pending")));
    const pendingForPurpose = existing
      .filter((row) => row.purpose === purpose)
      .reduce((sum, row) => sum + Number(row.amountDue || 0), 0);
    const paid = Math.max(0, Number(booking.paidAmount || 0));
    const remaining = Math.max(0, target - paid - pendingForPurpose);
    const totalRequested = amount * payerIds.length;
    if (totalRequested > remaining) {
      return Response.json({ error: `Only ${formatNPR(remaining)} remains available. ${formatNPR(amount)} per selected player would request ${formatNPR(totalRequested)}.` }, { status: 400 });
    }
    const duplicate = existing.some((row) => row.purpose === purpose && payerIds.includes(row.payerId));
    if (duplicate) {
      return Response.json({ error: "One or more selected players already have a pending request for this booking" }, { status: 409 });
    }

    const inserted = await db
      .insert(bookingPaymentRequests)
      .values(payerIds.map((payerId) => ({
        bookingId: booking.id,
        requestedBy: requesterId,
        payerId,
        amountDue: amount,
        purpose,
        note,
        status: "pending",
      })))
      .returning();
    const people = await db.select().from(users);
    const requester = people.find((person) => person.id === requesterId)?.name ?? "Your captain";
    const when = `${prettyDate(booking.date)} at ${formatTime12(booking.startTime)}`;
    const deadline = purpose === "advance" ? advancePaymentDeadline(booking.advancePaymentRequestedAt) : null;
    await Promise.all(inserted.map((request) => sendNotification({
      userId: request.payerId,
      type: "payment",
      title: `💳 ${requester} asked you to pay ${formatNPR(amount)}`,
      message: `${requester} asked you to pay ${formatNPR(amount)} directly to ${venue?.name ?? "the venue"} for ${court?.name ?? "the court"} on ${when}. Choose eSewa or Khalti; the verified payment goes into booking #FN-${booking.id}.${purpose === "advance" && deadline ? ` Pay before ${deadline.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} — the booking cancels one hour after the venue's advance request.` : ""}${note ? ` Note: ${note}` : ""}`,
      link: "/bookings",
    })));
    if (venue?.ownerId) {
      await sendNotification({
        userId: venue.ownerId,
        type: "payment",
        title: `💳 Team payment request — ${venue.name}`,
        message: `${requester} asked ${inserted.length} teammate${inserted.length === 1 ? "" : "s"} for ${formatNPR(amount)} each toward booking #FN-${booking.id}. Their selected players have been notified; verified money will appear in the booking ledger.`,
        link: "/admin/requests",
      });
    }
    const views = inserted.map((request) => rowView(request, people));
    return Response.json({ paymentRequest: views[0], paymentRequests: views }, { status: 201 });
  } catch (e) {
    console.error("[/api/bookings/[id]/payment-requests POST] failed:", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
