import { db } from "@/db";
import { bookings, openMatches, courts, teams, venues, vouchers, users } from "@/db/schema";
import { prettyDate, formatTime12, formatNPR, gamePlayed } from "@/lib/futsal";
import { monthKey, hoursUntilGame, CANCEL_CUTOFF_HOURS, LOYALTY_TARGET, TRUST_START, TRUST_COMPLETE_BOOST, TRUST_CANCEL_PENALTY, trustAfterComplete, trustAfterCancel, trustLabel } from "@/lib/loyalty";
import { sendNotification } from "@/lib/notify";
import { and, eq } from "drizzle-orm";
import { recordFor } from "@/lib/league";
import { validateScore } from "@/lib/validation";

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    // Scoring a competition game is handled first and returns on its own: it
    // changes nothing else about the booking.
    const scoreResponse = await applyCompetitionScore(prev, body);
    if (scoreResponse) return scoreResponse;

    const actor = body.actor === "owner" ? "owner" : "player";

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
        if (venue?.ownerId) {
          await sendNotification({
            userId: venue.ownerId,
            type: "booking_cancelled",
            title: `🚫 Booking cancelled — ${next.bookerName || "Player"}`,
            message: `${court?.name ?? "Court"} on ${when} was cancelled by the player. The slot is free again.${hadDeposit ? ` Non-refundable deposit kept: ${formatNPR(depAmt)} 🛡️` : ""}`,
            link: "/admin/bookings",
          });
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
      .set({ status: "cancelled" })
      .where(eq(bookings.id, Number(id)));
    await db
      .update(openMatches)
      .set({ status: "cancelled" })
      .where(eq(openMatches.bookingId, Number(id)));
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
      await sendNotification({
        userId: team.captainId,
        type: "competition",
        title: `⚽ Result in — ${line}`,
        message: `${venue.name} recorded the final score. ${team.name} is now ${rec.won}W • ${rec.drawn}D • ${rec.lost}L (${rec.points} pts) in competition games — the record shows on your team profile. Send the host your photos for the album 📸`,
        link: `/teams/${team.id}`,
      });
    }
  }

  return Response.json({ booking: withScore, scored });
}
