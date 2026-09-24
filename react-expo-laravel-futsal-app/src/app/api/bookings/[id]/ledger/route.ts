import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookings, courts, venues, bookingPayments, bookingExtras } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parsePayments } from "@/lib/loyalty";
import { sendNotification } from "@/lib/notify";
import { formatNPR } from "@/lib/futsal";
import {
  ledgerTotals,
  settleWindow,
  validateExtraLine,
  validateInstalment,
  LEDGER_METHODS,
  SETTLE_EDIT_WINDOW_MS,
} from "@/lib/booking-ledger";

export const dynamic = "force-dynamic";

/** Court → venue, so ownership and the accepted mediums can be resolved. */
async function venueOf(courtId: number) {
  const courtRows = await db.select().from(courts).where(eq(courts.id, courtId));
  const court = courtRows[0];
  if (!court) return { court: null, venue: null };
  const venueRows = await db.select().from(venues).where(eq(venues.id, court.venueId));
  return { court, venue: venueRows[0] ?? null };
}

async function loadLedger(bookingId: number) {
  const [payments, extras] = await Promise.all([
    db.select().from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId)),
    db.select().from(bookingExtras).where(eq(bookingExtras.bookingId, bookingId)),
  ]);
  return { payments, extras };
}

/** Everything the payments panel needs in one shape. */
async function payload(booking: typeof bookings.$inferSelect) {
  const { payments, extras } = await loadLedger(booking.id);
  const { venue } = await venueOf(booking.courtId);
  const totals = ledgerTotals({
    courtPrice: booking.totalPrice,
    extras,
    payments,
    settled: Boolean(booking.settledAt),
  });
  return {
    bookingId: booking.id,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    courtPrice: booking.totalPrice,
    totals,
    window: settleWindow(booking.settledAt),
    editWindowMs: SETTLE_EDIT_WINDOW_MS,
    settledAt: booking.settledAt,
    settledBy: booking.settledBy,
    acceptedMethods: parsePayments(venue?.acceptedPayments).filter((m) =>
      (LEDGER_METHODS as readonly string[]).includes(m)
    ),
    defaultExtraFee: venue?.defaultExtraFee ?? 0,
    defaultExtraFeeNote: venue?.defaultExtraFeeNote ?? "",
    extras: extras.map((e) => ({
      id: e.id,
      label: e.label,
      amount: e.amount,
      recordedBy: e.recordedBy,
      voidedAt: e.voidedAt,
      createdAt: e.createdAt,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      note: p.note,
      source: p.source,
      // The gateway's transaction id, so an online instalment can be tied back
      // to eSewa/Khalti when the day is reconciled.
      reference: p.reference,
      recordedBy: p.recordedBy,
      voidedAt: p.voidedAt,
      createdAt: p.createdAt,
    })),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCompetitionBookingColumns();
    const { id } = await params;
    const bookingId = Number(id);
    if (!Number.isInteger(bookingId) || bookingId <= 0)
      return Response.json({ error: "Invalid booking 📋" }, { status: 400 });
    const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const booking = rows[0];
    if (!booking) return Response.json({ error: "Booking not found" }, { status: 404 });
    return Response.json(await payload(booking));
  } catch (e) {
    console.error(`[/api/bookings/[id]/ledger GET] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

const ACTIONS = [
  "addPayment",
  "voidPayment",
  "addExtra",
  "voidExtra",
  "settle",
  "unsettle",
] as const;

/**
 * The venue owner's side of a booking's money 💸
 *
 * Everything here is owner-only: a player pays through the gateway or hands cash
 * over at the desk, and the owner is the one who writes it down. Each action is
 * its own row in the ledger rather than an overwrite of `paidAmount`, so the
 * split across eSewa / Khalti / cash is recoverable later, and corrections are
 * voids rather than deletions.
 *
 * Once settled, the ledger stays open for `SETTLE_EDIT_WINDOW_MS` so a mistyped
 * amount can be fixed, then every mutation below is refused with 409.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCompetitionBookingColumns();
    const { id } = await params;
    const bookingId = Number(id);
    if (!Number.isInteger(bookingId) || bookingId <= 0)
      return Response.json({ error: "Invalid booking 📋" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    if (!(ACTIONS as readonly string[]).includes(action))
      return Response.json(
        { error: `Unknown ledger action — pick ${ACTIONS.join(", ")} 📋` },
        { status: 400 }
      );

    const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const booking = rows[0];
    if (!booking) return Response.json({ error: "Booking not found" }, { status: 404 });

    const { venue } = await venueOf(booking.courtId);
    const actorId = Number(body.actorId ?? 0);
    if (!venue?.ownerId || actorId !== venue.ownerId)
      return Response.json(
        { error: "Only the venue owner can change what a booking owes 🔒" },
        { status: 403 }
      );

    // The correction window. Unsettled bookings are always editable; a settled
    // one is editable for five minutes and then it is the venue's record.
    const win = settleWindow(booking.settledAt);
    const locked = win.settled && !win.editable;
    if (locked && action !== "unsettle")
      return Response.json(
        {
          error: `This booking was settled more than ${SETTLE_EDIT_WINDOW_MS / 60000} minutes ago — the ledger is locked so the day's takings stay trustworthy 🔒`,
          reason: "ledger_locked",
          settledAt: booking.settledAt,
        },
        { status: 409 }
      );

    const accepted = parsePayments(venue.acceptedPayments).filter((m) =>
      (LEDGER_METHODS as readonly string[]).includes(m)
    );

    /* ---------------------------------------------------------- addPayment */
    if (action === "addPayment") {
      const err = validateInstalment(body.amount, body.method, { allowed: accepted });
      if (err) return Response.json({ error: err }, { status: 400 });
      const note = String(body.note ?? "").slice(0, 200);
      await db.insert(bookingPayments).values({
        bookingId,
        amount: Number(body.amount),
        method: String(body.method),
        note,
        source: "owner",
        recordedBy: actorId,
      });
      const next = await payload(booking);
      const stillOwed = next.totals.balance;
      if (stillOwed === 0 && !booking.settledAt) {
        // Fully covered — say so, but don't settle it for the owner. Extras can
        // still be added after the whistle, so settling stays their call.
      }
      return Response.json({
        ok: true,
        ledger: next,
        message:
          stillOwed > 0
            ? `Recorded ${formatNPR(Number(body.amount))} by ${body.method} — ${formatNPR(stillOwed)} left to collect 💰`
            : next.totals.surplus > 0
              ? `Recorded ${formatNPR(Number(body.amount))} by ${body.method} — that's ${formatNPR(next.totals.surplus)} more than owed, so there's change to hand back 💰`
              : `Recorded ${formatNPR(Number(body.amount))} by ${body.method} — this booking is fully paid ✅`,
      });
    }

    /* --------------------------------------------------------- voidPayment */
    if (action === "voidPayment") {
      const paymentId = Number(body.paymentId ?? 0);
      if (!Number.isInteger(paymentId) || paymentId <= 0)
        return Response.json({ error: "Which payment should be undone? 💰" }, { status: 400 });
      const found = await db
        .select()
        .from(bookingPayments)
        .where(eq(bookingPayments.id, paymentId));
      const row = found[0];
      if (!row || row.bookingId !== bookingId)
        return Response.json({ error: "That payment isn't on this booking 💰" }, { status: 404 });
      if (row.voidedAt)
        return Response.json(
          { ok: true, alreadyVoided: true, ledger: await payload(booking) },
          { status: 200 }
        );
      // Voided, not deleted — the row stays so the audit trail is complete.
      await db
        .update(bookingPayments)
        .set({ voidedAt: new Date(), voidedBy: actorId })
        .where(eq(bookingPayments.id, paymentId));
      const next = await payload(booking);
      return Response.json({
        ok: true,
        ledger: next,
        message: `Undid that ${formatNPR(row.amount)} ${row.method} entry — the row stays in the history, struck through 🔁`,
      });
    }

    /* ------------------------------------------------------------- addExtra */
    if (action === "addExtra") {
      const err = validateExtraLine(body.label, body.amount);
      if (err) return Response.json({ error: err }, { status: 400 });
      await db.insert(bookingExtras).values({
        bookingId,
        label: String(body.label).trim(),
        amount: Number(body.amount),
        recordedBy: actorId,
      });
      const next = await payload(booking);
      return Response.json({
        ok: true,
        ledger: next,
        message: `Added "${String(body.label).trim()}" for ${formatNPR(Number(body.amount))} — the booking now comes to ${formatNPR(next.totals.owed)} 🧾`,
      });
    }

    /* ------------------------------------------------------------ voidExtra */
    if (action === "voidExtra") {
      const extraId = Number(body.extraId ?? 0);
      if (!Number.isInteger(extraId) || extraId <= 0)
        return Response.json({ error: "Which extra charge should be removed? 🧾" }, { status: 400 });
      const found = await db.select().from(bookingExtras).where(eq(bookingExtras.id, extraId));
      const row = found[0];
      if (!row || row.bookingId !== bookingId)
        return Response.json({ error: "That extra charge isn't on this booking 🧾" }, { status: 404 });
      if (row.voidedAt)
        return Response.json(
          { ok: true, alreadyVoided: true, ledger: await payload(booking) },
          { status: 200 }
        );
      await db
        .update(bookingExtras)
        .set({ voidedAt: new Date(), voidedBy: actorId })
        .where(eq(bookingExtras.id, extraId));
      const next = await payload(booking);
      return Response.json({
        ok: true,
        ledger: next,
        message: `Removed "${row.label}" — the line stays in the history, struck through 🔁`,
      });
    }

    /* -------------------------------------------------------------- settle */
    if (action === "settle") {
      const next0 = await payload(booking);
      if (booking.settledAt)
        return Response.json(
          { ok: true, alreadySettled: true, ledger: next0 },
          { status: 200 }
        );
      if (next0.totals.paid <= 0)
        return Response.json(
          { error: "Nothing has been recorded as paid yet — add the instalments first 💰" },
          { status: 400 }
        );
      const settledAt = new Date();
      await db
        .update(bookings)
        .set({
          settledAt,
          settledBy: actorId,
          paidAmount: next0.totals.paid,
          paymentStatus: "paid",
        })
        .where(eq(bookings.id, bookingId));
      await sendNotification({
        userId: booking.userId,
        type: "payment",
        title: "Payment settled ✅",
        message: `${formatNPR(next0.totals.paid)} received for your game${
          next0.totals.surplus > 0 ? ` — ${formatNPR(next0.totals.surplus)} change is due back to you` : ""
        }.`,
        link: "/bookings",
      });
      // Re-read rather than spreading `booking`: that object still carries the
      // pre-settlement paymentStatus, and echoing it would make the panel show
      // "pending" over a booking the database has just marked paid.
      const settledRows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      const next = await payload(settledRows[0]);
      return Response.json({
        ok: true,
        ledger: next,
        editWindowMs: SETTLE_EDIT_WINDOW_MS,
        message: `Marked settled — ${formatNPR(next0.totals.paid)} across ${Object.keys(next0.totals.byMethod).join(", ")}. You have ${SETTLE_EDIT_WINDOW_MS / 60000} minutes to fix a mistake before it locks 🔒`,
      });
    }

    /* ------------------------------------------------------------ unsettle */
    // Reopening is only ever for the correction window: once it has lapsed the
    // `locked` check above already refused it.
    if (action === "unsettle") {
      if (!booking.settledAt)
        return Response.json(
          { ok: true, ledger: await payload(booking) },
          { status: 200 }
        );
      if (!win.editable)
        return Response.json(
          {
            error: `The correction window closed ${SETTLE_EDIT_WINDOW_MS / 60000} minutes after settling — this booking's ledger is final 🔒`,
            reason: "ledger_locked",
          },
          { status: 409 }
        );
      await db
        .update(bookings)
        .set({ settledAt: null, settledBy: null })
        .where(eq(bookings.id, bookingId));
      const reopenedRows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      const next = await payload(reopenedRows[0]);
      return Response.json({
        ok: true,
        ledger: next,
        message: "Settlement undone — the ledger is open again while you sort it out 🔁",
      });
    }

    return Response.json({ error: "Unhandled action 📋" }, { status: 400 });
  } catch (e) {
    console.error(`[/api/bookings/[id]/ledger POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
