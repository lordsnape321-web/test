import { db, ensureCompetitionBookingColumns } from "@/db";
import { bookings, openMatches, courts, teams, venues, vouchers, users } from "@/db/schema";
import { prettyDate, formatTime12, formatNPR, gamePlayed } from "@/lib/futsal";
import { monthKey, hoursUntilGame, CANCEL_CUTOFF_HOURS, LOYALTY_TARGET, TRUST_START, TRUST_COMPLETE_BOOST, TRUST_CANCEL_PENALTY, trustAfterComplete, trustAfterCancel, trustLabel } from "@/lib/loyalty";
import { sendNotification } from "@/lib/notify";
import { and, eq } from "drizzle-orm";
import { recordFor } from "@/lib/league";
import { validateScore } from "@/lib/validation";
import { settleWindow, SETTLE_EDIT_WINDOW_MS } from "@/lib/booking-ledger";

export const dynamic = "force-dynamic";

async function venueOf(booking: { courtId: number }) {
  const courtRows = await db.select().from(courts).where(eq(courts.id, booking.courtId));
  const court = courtRows[0];
  if (!court) return { court: null, venue: null };
  const venueRows = await db.select().from(venues).where(eq(venues.id, court.venueId));
  return { court, venue: venueRows[0] ?? null };
}

// After a game counts toward loyalty, check if a free hour is earned.
async function checkLoyalty(userId: number, venueId: number, venueName: string) {
  const month = monthKey();
  const userBookings = await db.select().from(bookings).where(eq(bookings.userId, userId));
  const allCourts = await db.select().from(courts);
  const mineHere = userBookings.filter((b) => {
    if (b.status !== "confirmed" && b.status !== "completed") return false;
    if (b.isFreePlay) return false;
    const c = allCourts.find((x) => x.id === b.courtId);
    if (!c || c.venueId !== venueId) return false;
    try {
      const d = new Date((b.createdAt as Date) ?? new Date());
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === month;
    } catch {
      return false;
    }
  });
  const count = mineHere.length;
  const existing = await db
    .select()
    .from(vouchers)
    .where(and(eq(vouchers.userId, userId), eq(vouchers.venueId, venueId), eq(vouchers.month, month)));
  const earned = Math.floor(count / LOYALTY_TARGET);
  if (earned > existing.length) {
    const code = `FREE-${venueId}-${month.replace("-", "")}-${existing.length + 1}`;
    await db.insert(vouchers).values({
      userId,
      venueId,
      month,
      code,
      status: "active",
    });
    await sendNotification({
      userId,
      type: "free_play",
      title: `🎁 FREE HOUR earned at ${venueName}!`,
      message: `You played ${count} games there this month — loyal legend! 🏆 Your free 1-hour voucher (${code}) is ready. Use it on your next booking!`,
      link: "/profile",
    });
    return { earned: true, count, code };
  }
  // Milestone nudges at 4 and 6.
  if ((count === 4 || count === 6) && earned === existing.length) {
    await sendNotification({
      userId,
      type: "info",
      title: `🔥 ${LOYALTY_TARGET - count} more for a FREE hour at ${venueName}`,
      message: `You've played ${count}/${LOYALTY_TARGET} games there this month. Keep going — a free hour is close! ⚽`,
      link: "/profile",
    });
  }
  return { earned: false, count };
}

const VALID_STATUS = ["pending", "confirmed", "completed", "cancelled", "rejected"];
const VALID_PAY_STATUS = ["pending", "paid", "deposit_paid"];
const VALID_PAY_METHOD = ["eSewa", "Khalti", "Cash at Venue", "Free Play 🎁"];
const VALID_DEPOSIT_STATUS = ["none", "pending", "paid", "forfeited", "refunded"];

async function adjustTrust(userId: number, kind: "complete" | "cancel") {
  try {
    const rows = await db.select().from(users).where(eq(users.id, userId));
    const current = rows[0] ? (((rows[0] as { trustScore?: number }).trustScore ?? TRUST_START) as number) : TRUST_START;
    const next = kind === "complete" ? trustAfterComplete(current) : trustAfterCancel(current);
    await db.update(users).set({ trustScore: next }).where(eq(users.id, userId));
    return { before: current, after: next };
  } catch {
    return null;
  }
}

/**
 * Release (or reject) a competition booking only through the selected
 * opposition captain's authenticated identity. The conditional update is the
 * one-time gate: two replayed accept calls cannot both notify the venue owner.
 */
async function handleCompetitionDecision(
  prev: typeof bookings.$inferSelect,
  body: Record<string, unknown>
): Promise<Response | null> {
  const action = String(body.competitionAction ?? "");
  if (!action) return null;
  if (action !== "accept" && action !== "decline")
    return Response.json({ error: "Pick accept or decline for this competition request 🆚" }, { status: 400 });
  if (prev.visibility !== "competition" || !prev.opponentTeamId)
    return Response.json({ error: "Only competition bookings have an opposition request 🆚" }, { status: 400 });
  if (prev.status !== "pending" || prev.competitionStatus !== "pending")
    return Response.json(
      { error: "This competition request has already been decided or cancelled.", competitionStatus: prev.competitionStatus },
      { status: 409 }
    );

  const actorId = Number(body.actorId ?? 0);
  const [actorUser] = Number.isInteger(actorId) && actorId > 0
    ? await db.select().from(users).where(eq(users.id, actorId))
    : [];
  const opponent = (await db.select().from(teams).where(eq(teams.id, prev.opponentTeamId)))[0];
  if (!actorUser || !opponent || opponent.captainId !== actorId)
    return Response.json({ error: "Only the selected opposition captain can decide this request 🔒" }, { status: 403 });

  const { court, venue } = await venueOf(prev);
  const decisionAt = new Date();
  const nextRows = await db
    .update(bookings)
    .set(
      action === "accept"
        ? {
            competitionStatus: "accepted",
            competitionRespondedBy: actorId,
            competitionRespondedAt: decisionAt,
            scoreStatus: "awaiting",
          }
        : {
            competitionStatus: "declined",
            competitionRespondedBy: actorId,
            competitionRespondedAt: decisionAt,
            scoreStatus: "none",
            status: "rejected",
          }
    )
    .where(
      and(
        eq(bookings.id, prev.id),
        eq(bookings.status, "pending"),
        eq(bookings.competitionStatus, "pending"),
      )
    )
    .returning();
  const next = nextRows[0];
  if (!next)
    return Response.json(
      { error: "This competition request was decided by someone else. Refresh your bookings.", competitionStatus: "decided" },
      { status: 409 }
    );

  const when = `${prettyDate(next.date)} at ${formatTime12(next.startTime)}`;
  const where = venue?.name ?? "the venue";
  const opponentName = opponent.name;
  const fixture = `${next.teamName || "Home squad"} vs ${opponentName}`;

  if (action === "accept") {
    // This is the first and only point at which Owner Studio gets an actionable
    // competition booking request.
    if (venue?.ownerId) {
      await sendNotification({
        userId: venue.ownerId,
        type: "booking_request",
        title: `📩 Competition booking ready — ${where}`,
        message: `${fixture} was accepted by ${opponentName}'s captain. Payment policy: ${next.competitionPaymentPolicy === "loser_pays" ? "the losing squad pays" : "fair split between both squads"}. Review ${court?.name ?? "the court"} for ${when} (${formatNPR(next.totalPrice)}). Tap to accept or decline.`,
        link: "/admin/requests",
      });
    }
    await sendNotification({
      userId: next.userId,
      type: "info",
      title: `✅ ${opponentName} accepted your competition request`,
      message: `${fixture} at ${where} for ${when} is now with the venue owner for final approval. Payment policy: ${next.competitionPaymentPolicy === "loser_pays" ? "the losing squad pays" : "fair split between both squads"}.`,
      link: "/bookings",
    });
  } else {
    // The owner is intentionally not notified. The requester gets the outcome,
    // while the rejected row remains in history and cannot be booked into the
    // owner queue by a replayed client request.
    await sendNotification({
      userId: next.userId,
      type: "booking_rejected",
      title: `❌ ${opponentName} declined the competition request`,
      message: `${fixture} at ${where} for ${when} was declined by the opposition captain, so it was not sent to the venue owner.`,
      link: "/bookings",
    });
  }

  return Response.json({ booking: next, competitionStatus: next.competitionStatus });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCompetitionBookingColumns();
    const { id } = await params;
    const bookingId = Number(id);
    if (!Number.isInteger(bookingId) || bookingId <= 0)
      return Response.json({ error: "Invalid booking 📋" }, { status: 400 });
    const body = await req.json();

    if (body.status && !VALID_STATUS.includes(String(body.status)))
      return Response.json({ error: "Invalid booking status 📋" }, { status: 400 });
    if (body.paymentStatus && !VALID_PAY_STATUS.includes(String(body.paymentStatus)))
      return Response.json({ error: "Invalid payment status 💰" }, { status: 400 });
    if (body.paymentMethod && !VALID_PAY_METHOD.includes(String(body.paymentMethod)))
      return Response.json({ error: "Pick a valid payment method 💳" }, { status: 400 });
    if (body.actor && !["owner", "player"].includes(String(body.actor)))
      return Response.json({ error: "Invalid actor 👤" }, { status: 400 });
    if (body.receiptUrl !== undefined && typeof body.receiptUrl !== "string")
      return Response.json({ error: "Receipt must be an image 🧾" }, { status: 400 });
    if (body.depositStatus && !VALID_DEPOSIT_STATUS.includes(String(body.depositStatus)))
      return Response.json({ error: "Invalid deposit status 🛡️" }, { status: 400 });

    const current = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const prev = current[0];
    if (!prev) return Response.json({ error: "Booking not found" }, { status: 404 });

    // Owner-requested advance payment is deliberately separate from the
    // automatic fair-play deposit. The latter is calculated at booking time;
    // this is a venue decision that can be no advance, the full court total, or
    // a server-validated custom amount.
    if (body.advancePayment !== undefined || body.advancePaymentAmount !== undefined) {
      const { court, venue } = await venueOf(prev);
      const actorId = Number(body.actorId ?? 0);
      if (body.actor !== "owner" || !venue?.ownerId || actorId !== venue.ownerId)
        return Response.json({ error: "Only the venue owner can request an advance 🔒" }, { status: 403 });
      if (prev.advancePaymentStatus === "paid")
        return Response.json({ error: "This advance has already been paid and cannot be changed 🔒" }, { status: 409 });
      if (prev.paymentStatus === "paid" || prev.paidAmount >= prev.totalPrice)
        return Response.json({ error: "This booking is already paid in full, so no separate advance is needed ✅" }, { status: 409 });
      if (prev.visibility === "competition" && prev.competitionStatus === "pending")
        return Response.json({ error: "The opposition captain must accept this competition request before payment decisions open 🆚" }, { status: 409 });
      if (prev.status !== "pending" && prev.status !== "confirmed")
        return Response.json({ error: "Only an active booking request can carry an advance" }, { status: 409 });

      const choice = String(body.advancePayment ?? "custom");
      const requested =
        choice === "none"
          ? 0
          : choice === "full"
            ? prev.totalPrice
            : Number(body.advancePaymentAmount ?? 0);
      if (!Number.isInteger(requested) || requested < 0 || requested > prev.totalPrice)
        return Response.json({ error: "Advance must be zero or a whole-rupee amount no greater than the court total 💰" }, { status: 400 });
      if (choice === "custom" && requested <= 0)
        return Response.json({ error: "A custom advance must be greater than zero 💰" }, { status: 400 });
      if (choice === "full" && prev.totalPrice <= 0)
        return Response.json({ error: "A free booking does not need an advance 💚" }, { status: 400 });

      const status = requested > 0 ? "pending" : "none";
      const updated = await db
        .update(bookings)
        .set({
          advancePaymentRequired: requested > 0,
          advancePaymentAmount: requested,
          advancePaymentStatus: status,
          advancePaymentRequestedBy: venue.ownerId,
          advancePaymentRequestedAt: new Date(),
        })
        .where(eq(bookings.id, prev.id))
        .returning();
      const next = updated[0];
      const when = `${prettyDate(next.date)} at ${formatTime12(next.startTime)}`;
      if (requested > 0) {
        await sendNotification({
          userId: next.userId,
          type: "payment",
          title: `💳 Advance requested — ${venue.name}`,
          message: `${venue.name} asked you to pay ${formatNPR(requested)} in advance for ${court?.name ?? "your court"} on ${when}. Choose eSewa or Khalti from My Bookings; the verified payment will be added to the booking ledger.${requested === next.totalPrice ? " This is the full court amount." : ""}`,
          link: "/bookings",
        });
      } else {
        await sendNotification({
          userId: next.userId,
          type: "info",
          title: `✅ No advance required — ${venue.name}`,
          message: `The venue does not require an advance for ${court?.name ?? "your court"} on ${when}. Your normal payment choice remains unchanged.`,
          link: "/bookings",
        });
      }
      return Response.json({ booking: next, advancePaymentAmount: requested, advancePaymentStatus: status });
    }

    const competitionResponse = await handleCompetitionDecision(prev, body);
    if (competitionResponse) return competitionResponse;

    // Scoring a competition game is handled first and returns on its own: it
    // changes nothing else about the booking.
    const scoreResponse = await applyCompetitionScore(prev, body);
    if (scoreResponse) return scoreResponse;

    const actor = body.actor === "owner" ? "owner" : "player";

    if (
      prev.visibility === "competition" &&
      body.status === "cancelled" &&
      actor === "player" &&
      Number(body.actorId ?? 0) !== prev.userId
    ) {
      return Response.json({ error: "Only the competition booking player can cancel this request 🔒" }, { status: 403 });
    }
    if (
      prev.visibility === "competition" &&
      prev.competitionStatus === "accepted" &&
      (body.status === "confirmed" || body.status === "rejected")
    ) {
      const { venue } = await venueOf(prev);
      if (actor !== "owner" || Number(body.actorId ?? 0) !== venue?.ownerId) {
        return Response.json({ error: "Only the venue owner can decide this released competition booking 🔒" }, { status: 403 });
      }
    }

    // A venue decision must never bypass opposition consent. The only legal
    // transition out of this state is the authenticated captain action above.
    if (
      prev.visibility === "competition" &&
      prev.competitionStatus === "pending" &&
      (body.status === "confirmed" || body.status === "rejected")
    ) {
      return Response.json(
        { error: "Waiting for the opposition captain to accept this competition request first 🆚" },
        { status: 409 }
      );
    }
    if (
      prev.visibility === "competition" &&
      prev.competitionStatus === "pending" &&
      ["paymentStatus", "paymentMethod", "depositStatus", "receiptUrl"].some(
        (field) => body[field] !== undefined,
      )
    ) {
      return Response.json(
        { error: "Competition payment and receipts open only after the opposition captain accepts 🆚" },
        { status: 409 }
      );
    }

    /*
     * A played game is locked 🔒
     *
     * Once the whistle has gone the booking is history: a player can't cancel
     * it, re-price it, change how it was paid, or attach a receipt to it. The
     * UI hides those controls; this is the same rule enforced where it counts,
     * so a replayed request gets the same answer. The venue owner is exempt —
     * marking a game completed, settling a payment and recording a competition
     * score all happen *after* kickoff and are the owner's job.
     */
    if (actor === "player" && gamePlayed(prev)) {
      const PLAYER_EDITABLE = [
        "status",
        "paymentStatus",
        "paymentMethod",
        "depositStatus",
        "receiptUrl",
      ];
      const touching = PLAYER_EDITABLE.filter((k) => body[k] !== undefined);
      if (touching.length > 0) {
        return Response.json(
          {
            error:
              "That game is already played 🔒 — the booking is locked, so nothing on it can be changed now.",
          },
          { status: 409 }
        );
      }
    }

    /*
     * A settled booking is final 🔒
     *
     * The payment ledger refuses changes once the five-minute correction window
     * closes — but it isn't the only door onto these columns. Without this, an
     * owner could flip `paymentStatus` back to "pending" or rewrite the medium
     * through this route and quietly undo a settlement the ledger had locked,
     * which is exactly the trust the lock exists to give the day's takings.
     *
     * Inside the window these stay editable, so the correction path still works.
     */
    const win = settleWindow(prev.settledAt);
    if (win.settled && !win.editable) {
      const MONEY_FIELDS = ["paymentStatus", "paymentMethod", "depositStatus", "receiptUrl"];
      const touching = MONEY_FIELDS.filter((k) => body[k] !== undefined);
      if (touching.length > 0)
        return Response.json(
          {
            error: `This booking was settled more than ${SETTLE_EDIT_WINDOW_MS / 60000} minutes ago — its payment details are locked so the day's takings stay trustworthy 🔒`,
            reason: "ledger_locked",
            settledAt: prev.settledAt,
          },
          { status: 409 }
        );
    }

    // Fair-play: players can't cancel within 6h of the game.
    if (body.status === "cancelled" && prev.status !== "cancelled" && actor === "player") {
      const hrsLeft = hoursUntilGame(prev.date, prev.startTime);
      if (hrsLeft < CANCEL_CUTOFF_HOURS && hrsLeft > -48) {
        return Response.json(
          {
            error: `Too late to cancel 😢 — the game starts in ${hrsLeft < 0 ? "the past" : `${Math.max(0, Math.floor(hrsLeft))}h ${Math.round((hrsLeft % 1) * 60)}m`}. Free cancellation closes ${CANCEL_CUTOFF_HOURS}h before kickoff so venues aren't left hanging. Please call the venue directly! 📞`,
          },
          { status: 400 }
        );
      }
    }

    // A request that only carries a score (competition games) has nothing to
    // set here — and drizzle refuses an empty `set()`, so the write is skipped
    // rather than faked with a no-op column.
    const changes = {
      ...(body.status ? { status: body.status } : {}),
      ...(body.paymentStatus ? { paymentStatus: body.paymentStatus } : {}),
      ...(body.paymentMethod ? { paymentMethod: body.paymentMethod } : {}),
      ...(body.depositStatus ? { depositStatus: body.depositStatus } : {}),
      ...(body.receiptUrl !== undefined
        ? { receiptUrl: String(body.receiptUrl).slice(0, 2000000) }
        : {}),
      ...(body.status === "cancelled" &&
      prev.visibility === "competition" &&
      prev.competitionStatus === "pending"
        ? { competitionStatus: "cancelled" }
        : {}),
    };
    const updated = Object.keys(changes).length
      ? await db.update(bookings).set(changes).where(eq(bookings.id, bookingId)).returning()
      : [prev];
    const next = updated[0];
    const { court, venue } = await venueOf(next);
    const when = `${prettyDate(next.date)} at ${formatTime12(next.startTime)}`;
    const where = venue?.name ?? "the venue";

    // Owner ACCEPTS a pending request -> confirmed + listing goes live.
    if (body.status === "confirmed" && prev.status === "pending") {
      await db
        .update(openMatches)
        .set({ status: "open" })
        .where(eq(openMatches.bookingId, bookingId));
      await sendNotification({
        userId: next.userId,
        type: "booking_confirmed",
        title: `✅ Booking confirmed — ${where}`,
        message: `Your ${court?.name ?? "court"} booking for ${when} was accepted by the venue. See you on the turf!`,
        link: "/bookings",
      });
      if (venue) await checkLoyalty(next.userId, venue.id, venue.name);
    }

    // Owner marks game played -> loyalty counts again (completed also counts).
    if (body.status === "completed" && prev.status !== "completed") {
      if (venue) await checkLoyalty(next.userId, venue.id, venue.name);
      const trust = await adjustTrust(next.userId, "complete");
      const t = trust ? trustLabel(trust.after) : null;
      await sendNotification({
        userId: next.userId,
        type: "info",
        title: `🎉 Hope you had a blast at ${where}!`,
        message: `How was your game? Drop a quick review with stars + a message — it helps the venue and other players! ⭐${trust ? ` Trust ${trust.before} → ${trust.after} (+${TRUST_COMPLETE_BOOST}) ${t?.emoji} — keep showing up! 💪` : ""}`,
        link: "/bookings",
      });
    }

    // Owner DECLINES a pending request -> rejected + listing removed.
    if (body.status === "rejected") {
      await db
        .update(openMatches)
        .set({ status: "cancelled" })
        .where(eq(openMatches.bookingId, bookingId));
      await sendNotification({
        userId: next.userId,
        type: "booking_rejected",
        title: `❌ Booking declined — ${where}`,
        message: `Sorry, the venue couldn't accommodate your ${court?.name ?? "court"} request for ${when}. Please try another slot.`,
        link: "/bookings",
      });
    }

    // Player / owner cancels -> listing removed + other party notified.
    if (body.status === "cancelled" && prev.status !== "cancelled") {
      await db
        .update(openMatches)
        .set({ status: "cancelled" })
        .where(eq(openMatches.bookingId, bookingId));
      // If a free-play booking is cancelled, restore the voucher.
      if (prev.isFreePlay && prev.voucherId) {
        await db
          .update(vouchers)
          .set({ status: "active", usedBookingId: null })
          .where(eq(vouchers.id, prev.voucherId));
      }
      const cancelledByOwner = body.actor === "owner";
      const hadDeposit = (prev as { depositStatus?: string }).depositStatus === "paid" && ((prev as { depositAmount?: number }).depositAmount ?? 0) > 0;
      const depAmt = ((prev as { depositAmount?: number }).depositAmount ?? 0) as number;
      if (cancelledByOwner) {
        // Owner cancels: player did nothing wrong — refund the deposit, no trust hit.
        if (hadDeposit) {
          await db.update(bookings).set({ depositStatus: "refunded" }).where(eq(bookings.id, bookingId));
        }
        await sendNotification({
          userId: next.userId,
          type: "booking_cancelled",
          title: `🚫 Booking cancelled — ${where}`,
          message: `Your ${court?.name ?? "court"} booking for ${when} was cancelled by the venue.${hadDeposit ? ` Your ${formatNPR(depAmt)} deposit will be refunded 💸` : ""} No trust lost — not your fault! 💛`,
          link: "/bookings",
        });
      } else {
        const trust = await adjustTrust(next.userId, "cancel");
        if (hadDeposit) {
          await db.update(bookings).set({ depositStatus: "forfeited" }).where(eq(bookings.id, bookingId));
        }
        // A competition request that never reached the owner must stay out of
        // the owner's notification stream when the booker cancels it. Once the
        // captain has accepted, normal cancellation notices resume.
        if (
          venue?.ownerId &&
          !(prev.visibility === "competition" && prev.competitionStatus === "pending")
        ) {
          await sendNotification({
            userId: venue.ownerId,
            type: "booking_cancelled",
            title: `🚫 Booking cancelled — ${next.bookerName || "Player"}`,
            message: `${court?.name ?? "Court"} on ${when} was cancelled by the player. The slot is free again.${hadDeposit ? ` Non-refundable deposit kept: ${formatNPR(depAmt)} 🛡️` : ""}`,
            link: "/admin/bookings",
          });
        }
        if (prev.visibility === "competition" && prev.competitionStatus === "pending" && prev.opponentTeamId) {
          const opponent = (await db.select().from(teams).where(eq(teams.id, prev.opponentTeamId)))[0];
          if (opponent?.captainId) {
            await sendNotification({
              userId: opponent.captainId,
              type: "info",
              title: "🚫 Competition request cancelled",
              message: `${next.bookerName || "The other captain"} cancelled the ${opponent.name} fixture for ${when}. It no longer needs your decision.`,
              link: "/bookings",
            });
          }
        }
        await sendNotification({
          userId: next.userId,
          type: "booking_cancelled",
          title: `🚫 You cancelled — ${where}`,
          message: `Your ${court?.name ?? "court"} booking for ${when} is cancelled.${hadDeposit ? ` Your ${formatNPR(depAmt)} deposit is forfeited (non-refundable) 😢.` : ""} Heads up: 3+ cancels in a month pauses new bookings, and it lowers your reliability stars ⭐${trust ? ` Trust ${trust.before} → ${trust.after} (−${TRUST_CANCEL_PENALTY}).` : ""} Play on!`,
          link: "/bookings",
        });
      }
    }

    // Payment collected -> let the player know.
    if (body.paymentStatus === "paid" && prev.paymentStatus !== "paid") {
      await sendNotification({
        userId: next.userId,
        type: "payment",
        title: `💰 Payment received — ${where}`,
        message: `Your payment for ${court?.name ?? "court"} on ${when} is confirmed. Receipt available in My Bookings.`,
        link: "/bookings",
      });
    }
    if (body.paymentStatus === "deposit_paid" && prev.paymentStatus !== "deposit_paid") {
      await sendNotification({
        userId: next.userId,
        type: "payment",
        title: `🛡️ Deposit confirmed — ${where}`,
        message: `Your upfront deposit for ${court?.name ?? "court"} on ${when} is confirmed. Pay the rest at the venue — and show up to grow trust! 💪`,
        link: "/bookings",
      });
    }


    return Response.json({ booking: next });
  } catch (e) {
    console.error(`[/api/bookings/[id] PATCH] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureCompetitionBookingColumns();
    const { id } = await params;
    const rows = await db.select().from(bookings).where(eq(bookings.id, Number(id)));
    const prev = rows[0];
    if (!prev) return Response.json({ error: "Booking not found" }, { status: 404 });
    if (gamePlayed(prev)) {
      return Response.json(
        {
          error:
            "That game is already played 🔒 — the booking is locked and can't be cancelled.",
        },
        { status: 409 }
      );
    }
    await db
      .update(bookings)
      .set({
        status: "cancelled",
        ...(prev.visibility === "competition" && prev.competitionStatus === "pending"
          ? { competitionStatus: "cancelled" }
          : {}),
      })
      .where(eq(bookings.id, Number(id)));
    await db
      .update(openMatches)
      .set({ status: "cancelled" })
      .where(eq(openMatches.bookingId, Number(id)));
    if (prev.visibility === "competition" && prev.competitionStatus === "pending" && prev.opponentTeamId) {
      const opponent = (await db.select().from(teams).where(eq(teams.id, prev.opponentTeamId)))[0];
      if (opponent?.captainId) {
        await sendNotification({
          userId: opponent.captainId,
          type: "info",
          title: "🚫 Competition request cancelled",
          message: `The competition booking for ${prettyDate(prev.date)} at ${formatTime12(prev.startTime)} was cancelled. It no longer needs your decision.`,
          link: "/bookings",
        });
      }
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error(`[/api/bookings/[id] DELETE] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * Scoring a competition game 🏆
 *
 * A competition booking is the third kind of game: two squads, one court, and a
 * result that belongs on both their records. The booker can't score their own
 * game — that's the point of a competition — so the **venue owner** enters the
 * final score, because they're the one standing at the ground when the whistle
 * goes. The league host can also score it from the league's own console, which
 * writes to the same numbers.
 *
 * Returns a Response when this request is about scoring, or `null` when the
 * request is a normal status update and the caller should carry on.
 */
async function applyCompetitionScore(
  prev: typeof bookings.$inferSelect,
  body: Record<string, unknown>
): Promise<Response | null> {
  if (body.homeScore === undefined && body.awayScore === undefined) return null;
  if (prev.visibility !== "competition")
    return Response.json(
      { error: "Only competition games carry a score — this is a regular booking 🙂" },
      { status: 400 }
    );

  // Score corrections follow the same server-authoritative five-minute
  // settlement window as payment corrections. Before settlement the owner may
  // record/update the result; once settlement has been locked, changing the
  // score would also change the competitive record and loser-pays outcome.
  const scoreWindow = settleWindow(prev.settledAt);
  if (scoreWindow.settled && !scoreWindow.editable)
    return Response.json(
      {
        error: `This competition score is locked — the ${SETTLE_EDIT_WINDOW_MS / 60000}-minute correction window has closed 🔒`,
        reason: "score_locked",
        settledAt: prev.settledAt,
      },
      { status: 409 }
    );
  if (prev.competitionStatus === "pending")
    return Response.json(
      { error: "The opposition captain must accept this competition before a result can be recorded 🆚" },
      { status: 409 }
    );
  if (prev.competitionStatus === "declined" || prev.competitionStatus === "cancelled")
    return Response.json({ error: "A declined competition request has no result to record." }, { status: 409 });

  const { venue } = await venueOf(prev);
  const actorId = Number(body.actorId ?? 0);
  if (!venue || actorId !== venue.ownerId)
    return Response.json(
      {
        error: venue
          ? `Only ${venue.name}'s owner can record this result 👑`
          : "Only the venue owner can record this result 👑",
      },
      { status: 403 }
    );

  const scoreErr =
    validateScore(body.homeScore, "Your squad's score") ??
    validateScore(body.awayScore, "Opponent's score");
  if (scoreErr) return Response.json({ error: scoreErr }, { status: 400 });
  // "" is how the UI clears a box; null is how JSON says the same thing. Both
  // mean "no result yet", so neither may sneak through as a 0.
  const blank = (v: unknown) => v === "" || v === null || v === undefined;
  const home = blank(body.homeScore) ? null : Number(body.homeScore);
  const away = blank(body.awayScore) ? null : Number(body.awayScore);
  if ((home === null) !== (away === null))
    return Response.json(
      { error: "Both scores or neither — a 1–? result isn't a result ⚽" },
      { status: 400 }
    );

  const scored = home !== null && away !== null;
  const updated = await db
    .update(bookings)
    .set({
      homeScore: home,
      awayScore: away,
      scoreStatus: scored ? "recorded" : "awaiting",
      scoreUpdatedBy: actorId,
      scoreUpdatedAt: new Date(),
    })
    .where(eq(bookings.id, prev.id))
    .returning();
  const withScore = updated[0];

  if (scored) {
    const allBookings = await db.select().from(bookings);
    const squads = [] as Array<typeof teams.$inferSelect>;
    for (const id of [withScore.teamId, withScore.opponentTeamId]) {
      if (!id) continue;
      const row = (await db.select().from(teams).where(eq(teams.id, id)))[0];
      if (row) squads.push(row);
    }
    const line = `${squads[0]?.name ?? "Home"} ${home}–${away} ${squads[1]?.name ?? "Away"}`;

    for (const team of squads) {
      // Each squad's competitive record: league fixtures its host scored, plus
      // every competition booking that already has a result.
      const history = allBookings
        .filter(
          (b) =>
            b.visibility === "competition" &&
            (b.teamId === team.id || b.opponentTeamId === team.id) &&
            b.homeScore !== null &&
            b.awayScore !== null
        )
        .map((b) => ({
          homeTeamId: b.teamId ?? 0,
          awayTeamId: b.opponentTeamId ?? 0,
          homeScore: b.homeScore,
          awayScore: b.awayScore,
          status: "played",
        }));
      const rec = recordFor(team.id, history);
      const paymentOutcome =
        prev.competitionPaymentPolicy === "loser_pays"
          ? home === away
            ? "It was a draw, so the court bill falls back to a fair split."
            : team.id === (home! < away! ? prev.teamId : prev.opponentTeamId)
              ? "Your squad is the losing side, so the saved policy assigns the court bill to you."
              : "Your squad won, so the saved policy assigns the court bill to the opposition."
          : "The saved policy is a fair split between both squads.";
      await sendNotification({
        userId: team.captainId,
        type: "competition",
        title: `⚽ Result in — ${line}`,
        message: `${venue.name} recorded the final score. ${team.name} is now ${rec.won}W • ${rec.drawn}D • ${rec.lost}L (${rec.points} pts) in competition games — the record shows on your team profile. ${paymentOutcome} Send the host your photos for the album 📸`,
        link: `/teams/${team.id}`,
      });
    }
  }

  return Response.json({ booking: withScore, scored });
}
