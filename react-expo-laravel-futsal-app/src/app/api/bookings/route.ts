import { db, ensureCompetitionBookingColumns } from "@/db";
import {
  bookings,
  courts,
  venues,
  users,
  openMatches,
  matchJoins,
  vouchers,
  promos,
  teams,
  tournamentTeams,
  tournaments,
  teamMembers,
  bookingTeamPayments,
  bookingPaymentRequests,
  bookingPayments,
  bookingExtras,
} from "@/db/schema";
import { formatNPR, prettyDate, formatTime12, rangesOverlap, addHours } from "@/lib/futsal";
import { playerRating, CANCEL_LIMIT_PER_MONTH, depositDecision, depositAmountFor, parsePayments, ONLINE_PAYMENTS, TRUST_START } from "@/lib/loyalty";
import { checkPromo, normalizePromoCode } from "@/lib/promos";
import { promoUsage } from "@/lib/promo-store";
import { findTeamForUser } from "@/lib/team-store";
import { ledgerTotals } from "@/lib/booking-ledger";
import { validateTitle, validateNotes, validatePhone, validateCrew, validateTotalPlayers, validateDateISO, validateTimeHM, validateHours, validateCustomPrice, validateTeamId, firstError } from "@/lib/validation";
import { sendNotification } from "@/lib/notify";
import { expireOverdueAdvanceRequests } from "@/lib/advance-payment";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PAY_METHODS = ["eSewa", "Khalti", "Cash at Venue", "Free Play 🎁"];

export async function GET(req: Request) {
  try {
    await ensureCompetitionBookingColumns();
    await expireOverdueAdvanceRequests();
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const courtId = searchParams.get("courtId");
    const date = searchParams.get("date");
    const status = searchParams.get("status");

    if (userId && (!Number.isInteger(Number(userId)) || Number(userId) <= 0))
      return Response.json({ bookings: [], error: "Invalid player 🔒" }, { status: 400 });
    if (courtId && (!Number.isInteger(Number(courtId)) || Number(courtId) <= 0))
      return Response.json({ bookings: [], error: "Invalid court ⚽" }, { status: 400 });
    if (date) {
      const dErr = validateDateISO(date, { label: "Date", allowPast: true });
      if (dErr) return Response.json({ bookings: [], error: dErr }, { status: 400 });
    }

    const allRows = await db
      .select()
      .from(bookings)
      .orderBy(desc(bookings.createdAt));

    let rows = [...allRows];
    if (!userId) {
      // The owner/admin collection must not expose an actionable competition
      // request before consent. The requester/captain inbox query below keeps
      // pending rows available only to the two relevant players.
      rows = rows.filter(
        (r) => r.visibility !== "competition" || r.competitionStatus !== "pending",
      );
    }
    if (courtId) rows = rows.filter((r) => r.courtId === Number(courtId));
    if (date) rows = rows.filter((r) => r.date === date);
    if (status) rows = rows.filter((r) => r.status === status);

    const allCourts = await db.select().from(courts);
    const allVenues = await db.select().from(venues);
    const allUsers = await db.select().from(users);
    const allMatches = await db.select().from(openMatches);
    const allJoins = await db.select().from(matchJoins);
    const allTeamMembers = await db.select().from(teamMembers);
    const allTeamPayments = await db.select().from(bookingTeamPayments);
    const allPaymentRequests = await db.select().from(bookingPaymentRequests);
    // The owner and captain need the same authoritative figures as the payment
    // ledger: gateway payments, venue instalments, and extras must not be
    // reconstructed from the denormalised booking.paidAmount field.
    const allLedgerPayments = await db.select().from(bookingPayments);
    const allBookingExtras = await db.select().from(bookingExtras);
    // Competition context: the opposing squad's name and the league it belongs
    // to, so a card renders the fixture instead of a bare time slot.
    const allUsersTeams = await db.select().from(teams);
    const allTournaments = await db.select().from(tournaments);
    if (userId) {
      const viewerId = Number(userId);
      // The opposition captain must see incoming competition requests even
      // though they are not the player who created the booking. This is a
      // database-backed inbox query, not a client-side copy of the request.
      rows = rows.filter(
        (r) =>
          r.userId === viewerId ||
          (r.teamId != null &&
            allTeamMembers.some((member) => member.teamId === r.teamId && member.userId === viewerId)) ||
          (r.visibility === "competition" &&
            allUsersTeams.some(
              (team) => team.id === r.opponentTeamId && team.captainId === viewerId
            ))
      );
    }

    const enriched = rows.map((b) => {
      const court = allCourts.find((c) => c.id === b.courtId);
      const venue = allVenues.find((v) => v.id === court?.venueId);
      const user = allUsers.find((u) => u.id === b.userId);
      const history = allRows
        .filter((r) => r.userId === b.userId)
        .map((r) => ({ status: r.status, createdAt: r.createdAt }));
      const tScore = (user as { trustScore?: number } | undefined)?.trustScore ?? TRUST_START;
      const stats = playerRating(history, new Date(), tScore);
      const linked =
        b.visibility === "public"
          ? allMatches.find(
              (m) => m.bookingId === b.id && m.status !== "cancelled"
            )
          : undefined;
      let joinedCount = 0;
      let spotsLeft = 0;
      let otherJoined = 0;
      let crewSize = b.ourCrew ?? 1;
      if (linked) {
        const jm = allJoins.filter((j) => j.matchId === linked.id);
        crewSize = linked.crewSize ?? b.ourCrew ?? 1;
        otherJoined = jm.filter((j) => j.userId !== linked.organizerId).length;
        joinedCount = crewSize + otherJoined;
        spotsLeft = Math.max(0, linked.maxPlayers - joinedCount);
      }
      // Competition bookings carry the other squad's name so a booking card can
      // say "vs Chargers 3–2" without a second round trip.
      const opponent = b.opponentTeamId
        ? allUsersTeams.find((t) => t.id === b.opponentTeamId)
        : undefined;
      const league = b.tournamentId
        ? allTournaments.find((t) => t.id === b.tournamentId)
        : undefined;
      const bookingPaymentsForRow = allLedgerPayments.filter((payment) => payment.bookingId === b.id);
      const bookingExtrasForRow = allBookingExtras.filter((extra) => extra.bookingId === b.id);
      const totals = ledgerTotals({
        courtPrice: b.totalPrice,
        extras: bookingExtrasForRow,
        payments: bookingPaymentsForRow,
        settled: Boolean(b.settledAt),
      });
      const advanceReceivedAmount =
        b.advancePaymentRequired && b.advancePaymentStatus === "paid"
          ? Math.min(Math.max(0, Number(b.advancePaymentAmount) || 0), totals.paid)
          : 0;
      const bookingIsClosed = b.status === "cancelled" || b.status === "rejected";
      const advanceReceivableAmount =
        !bookingIsClosed &&
        b.advancePaymentRequired &&
        b.advancePaymentStatus !== "paid" &&
        b.advancePaymentStatus !== "expired"
          ? Math.max(0, Number(b.advancePaymentAmount) || 0)
          : 0;
      const paymentSummary = {
        courtPrice: totals.courtPrice,
        extrasTotal: totals.extrasTotal,
        owed: totals.owed,
        received: totals.paid,
        receivable: totals.balance,
        surplus: totals.surplus,
        byMethod: totals.byMethod,
        advanceRequested: b.advancePaymentRequired ? Math.max(0, Number(b.advancePaymentAmount) || 0) : 0,
        advanceReceived: advanceReceivedAmount,
        advanceReceivable: advanceReceivableAmount,
      };
      // Older cancelled rows predate the cancellation-money columns. Enrich
      // them from the authoritative ledger so they are still understandable;
      // new cancellations persist this snapshot in the PATCH/DELETE path.
      const cancellationReceivedAmount =
        b.status === "cancelled" || b.status === "rejected"
          ? Math.max(0, Number(b.cancellationReceivedAmount) || 0, totals.paid)
          : Math.max(0, Number(b.cancellationReceivedAmount) || 0);
      const cancellationMoneyStatus =
        (b.status === "cancelled" || b.status === "rejected") && cancellationReceivedAmount > 0 && b.cancellationMoneyStatus === "none"
          ? "review"
          : b.cancellationMoneyStatus;
      return {
        ...b,
        court,
        venue,
        user,
        playerStats: stats,
        paymentSummary,
        amountReceived: paymentSummary.received,
        amountReceivable: paymentSummary.receivable,
        advanceReceivedAmount: paymentSummary.advanceReceived,
        advanceReceivableAmount: paymentSummary.advanceReceivable,
        cancellationMoneyStatus,
        cancellationReceivedAmount,
        cancellationRefundedAmount: Math.max(0, Number(b.cancellationRefundedAmount) || 0),
        competition:
          b.visibility === "competition"
            ? {
                opponentTeamId: b.opponentTeamId,
                opponentName: opponent?.name ?? "",
                leagueId: b.tournamentId,
                leagueName: league?.name ?? "",
                homeScore: b.homeScore,
                awayScore: b.awayScore,
                scoreStatus: b.scoreStatus,
                scoreUpdatedAt: b.scoreUpdatedAt,
                competitionStatus: b.competitionStatus,
                paymentMode:
                  b.competitionPaymentPolicy === "loser_pays" ? "loser_pays" : "split",
                paymentLabel:
                  b.competitionPaymentPolicy === "loser_pays"
                    ? "Losing squad pays"
                    : "Fair split between both squads",
                opponentCaptainId: opponent?.captainId ?? null,
                isOpponentCaptain:
                  Boolean(userId) && opponent?.captainId === Number(userId),
              }
            : null,
        linkedMatch: linked
          ? {
              id: linked.id,
              title: linked.title,
              status: linked.status,
              joinedCount,
              otherJoined,
              crewSize,
              maxPlayers: linked.maxPlayers,
              spotsLeft,
              pricePerPlayer: linked.pricePerPlayer,
              chargeMode: (linked as { chargeMode?: string }).chargeMode ?? "split",
            }
          : null,
        teamPayments: b.teamId
          ? allTeamPayments
              .filter((payment) => payment.bookingId === b.id)
              .map((payment) => ({
                id: payment.id,
                teamId: payment.teamId,
                userId: payment.userId,
                payerName: allUsers.find((person) => person.id === payment.userId)?.name ?? "Player",
                amountDue: payment.amountDue,
                paymentMethod: payment.paymentMethod,
                paymentStatus: payment.paymentStatus,
                paidAmount: payment.paidAmount,
                gatewayTxnId: payment.gatewayTxnId,
              }))
          : [],
        paymentRequests: allPaymentRequests
          .filter((request) => request.bookingId === b.id)
          .map((request) => ({
            id: request.id,
            requestedBy: request.requestedBy,
            requesterName: allUsers.find((person) => person.id === request.requestedBy)?.name ?? "Captain",
            payerId: request.payerId,
            payerName: allUsers.find((person) => person.id === request.payerId)?.name ?? "Player",
            amountDue: request.amountDue,
            purpose: request.purpose,
            note: request.note,
            paymentMethod: request.paymentMethod,
            status: request.status,
            paidAmount: request.paidAmount,
            gatewayTxnId: request.gatewayTxnId,
            createdAt: request.createdAt,
            paidAt: request.paidAt,
          })),
        teamPlayers: b.teamId
          ? allTeamMembers
              .filter((member) => member.teamId === b.teamId)
              .map((member) => ({
                id: member.userId,
                name: allUsers.find((person) => person.id === member.userId)?.name ?? "Player",
                role: allUsersTeams.find((team) => team.id === b.teamId)?.captainId === member.userId ? "captain" : "player",
              }))
          : [],
      };
    });

    return Response.json(
      { bookings: enriched },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (e) {
    console.error(`[/api/bookings GET] failed:`, e);
    return Response.json({ bookings: [], error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureCompetitionBookingColumns();
    const body = await req.json();
    const { courtId, userId, date, startTime, endTime, durationHours } = body;

    const baseErr = firstError(
      !Number.isInteger(Number(courtId)) || Number(courtId) <= 0 ? "Pick a valid court ⚽" : null,
      !Number.isInteger(Number(userId)) || Number(userId) <= 0 ? "Login to book 🔒" : null,
      validateDateISO(String(date ?? ""), { label: "Game day", maxDaysAhead: 60 }),
      validateTimeHM(String(startTime ?? ""), "Start time"),
      validateHours(durationHours ?? 1),
      body.bookerPhone ? validatePhone(String(body.bookerPhone), { required: false }) : null,
      body.notes ? validateNotes(String(body.notes)) : null,
      body.paymentMethod && !PAY_METHODS.includes(String(body.paymentMethod)) ? "Pick a valid payment method 💳" : null
    );
    if (baseErr) return Response.json({ error: baseErr }, { status: 400 });

    const hours = Number(durationHours ?? 1);
    const reqEnd = String(endTime ?? addHours(String(startTime), hours));
    const timeErr = validateTimeHM(reqEnd, "End time");
    if (timeErr) return Response.json({ error: timeErr }, { status: 400 });

    const myHistory = await db.select().from(bookings).where(eq(bookings.userId, Number(userId)));
    const bookerRows = await db.select().from(users).where(eq(users.id, Number(userId)));
    const bookerTrust = bookerRows[0] ? ((bookerRows[0] as { trustScore?: number }).trustScore ?? TRUST_START) : TRUST_START;
    const stats = playerRating(
      myHistory.map((r) => ({ status: r.status, createdAt: r.createdAt })),
      new Date(),
      bookerTrust
    );
    if (stats.blocked) {
      return Response.json(
        {
          error: `Whoa, slow down! 🛑 You've cancelled ${stats.cancelsThisMonth} games this month (limit ${CANCEL_LIMIT_PER_MONTH}). Venues need reliable players — your booking power returns next month. Your rating: ${stats.rating}★`,
        },
        { status: 403 }
      );
    }

    /*
     * Three kinds of game now, not two:
     *
     * - "private"     — the crew's own game, nobody else's business.
     * - "public"      — an open invite; the rest of the slots get filled.
     * - "competition" — a *competitive* fixture between two squads (a league
     *                   round or a friendly both sides are counting). It stores
     *                   the opponent, waits to be scored by the venue owner,
     *                   and the result lands on both squads' records.
     */
    const visibility: "private" | "public" | "competition" =
      body.visibility === "public"
        ? "public"
        : body.visibility === "competition"
          ? "competition"
          : "private";

    let ourCrew = Math.max(1, Number(body.ourCrew ?? 1) || 1);
    let openSpots = Math.max(0, Number(body.openSpots ?? 0) || 0);
    if (visibility === "public") {
      if (!body.ourCrew && !body.openSpots && body.playersNeeded) {
        const total = Math.min(22, Math.max(4, Number(body.playersNeeded) || 10));
        ourCrew = Math.max(1, Math.min(total - 1, Math.ceil(total / 2)));
        openSpots = total - ourCrew;
      }
      const crewErr = firstError(
        validateCrew(ourCrew, { min: 1, max: 21, label: "Our crew" }),
        validateCrew(openSpots, { min: 1, max: 21, label: "Open spots" })
      );
      if (crewErr) return Response.json({ error: crewErr }, { status: 400 });
      ourCrew = Math.min(21, Math.max(1, ourCrew));
      openSpots = Math.min(21, Math.max(1, openSpots));
    } else {
      // Private and competition games aren't advertised, so there is nothing
      // to split with strangers and no spots to open.
      openSpots = 0;
      ourCrew = 1;
    }
    const playersNeeded =
      visibility === "public"
        ? Math.min(22, Math.max(4, ourCrew + openSpots))
        : 0;
    if (visibility === "public") {
      const tErr = validateTotalPlayers(ourCrew + openSpots);
      if (tErr) return Response.json({ error: tErr }, { status: 400 });
      if (ourCrew + openSpots !== playersNeeded) {
        openSpots = Math.max(1, playersNeeded - ourCrew);
      }
    }

    // Keep public/open pricing semantics on `charge_mode`; competition policy
    // has its own nullable column so a public booking's custom per-player price
    // can never be confused with loser-pays. The legacy migration backfills
    // existing competition rows before new requests reach this path.
    const competitionPaymentPolicy: "split" | "loser_pays" | null =
      visibility === "competition"
        ? body.competitionPaymentMode === "loser_pays"
          ? "loser_pays"
          : "split"
        : null;
    const chargeMode: "split" | "custom" =
      body.chargeMode === "custom" && visibility === "public" ? "custom" : "split";
    let customPrice = 0;
    if (visibility === "public" && chargeMode === "custom") {
      const cErr = validateCustomPrice(body.customPricePerPlayer, { total: 0, openSpots, max: 10000 });
      if (cErr) return Response.json({ error: cErr }, { status: 400 });
      customPrice = Number(body.customPricePerPlayer);
    }

    if (visibility === "public" && body.matchTitle && String(body.matchTitle).trim()) {
      const tErr = validateTitle(String(body.matchTitle), { min: 3, max: 60, label: "Game title" });
      if (tErr) return Response.json({ error: tErr }, { status: 400 });
    }
    if (visibility === "public" && body.level) {
      const allowed = ["All Levels", "Beginner", "Intermediate", "Advanced"];
      const parts = String(body.level).split("+").map((s: string) => s.trim()).filter(Boolean);
      if (String(body.level) !== "All Levels" && (parts.length === 0 || !parts.every((p: string) => allowed.includes(p))))
        return Response.json({ error: "Pick valid levels 🌍🎯" }, { status: 400 });
    }

    const existing = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.courtId, Number(courtId)), eq(bookings.date, String(date))));
    const clash = existing.find(
      (b) =>
        b.status !== "cancelled" &&
        b.status !== "rejected" &&
        rangesOverlap(String(startTime), reqEnd, b.startTime, b.endTime || b.startTime)
    );
    if (clash) {
      return Response.json(
        { error: `Those hours overlap another game (${formatTime12(clash.startTime)}–${formatTime12(clash.endTime || clash.startTime)}). Try a free block! 🙏` },
        { status: 409 }
      );
    }

    const courtRows = await db
      .select()
      .from(courts)
      .where(eq(courts.id, Number(courtId)));
    const court = courtRows[0];
    if (!court) return Response.json({ error: "Court not found ⚽" }, { status: 404 });
    // A retired court is off the books — its row stays for history, but nobody
    // can put a new game on it.
    if (court.deletedAt)
      return Response.json(
        { error: "That court has been retired and isn't taking bookings any more 🪦" },
        { status: 409 }
      );
    const hourNum = parseInt(String(startTime).split(":")[0], 10);
    const isMorning = hourNum < 12;
    const rate = isMorning ? court.priceMorning : court.pricePerHour;

    const venueRows = await db.select().from(venues).where(eq(venues.id, court.venueId));
    const venue = venueRows[0];
    const venuePayments = parsePayments((venue as { acceptedPayments?: string } | undefined)?.acceptedPayments);
    const venueDepositPercent = Math.min(
      100,
      Math.max(0, Number((venue as { depositPercent?: number } | undefined)?.depositPercent ?? 30))
    );

    let useFreePlay = false;
    let voucherId: number | null = null;
    let voucherCode = "";
    if (body.useFreePlay && venue) {
      const mine = await db.select().from(vouchers).where(eq(vouchers.userId, Number(userId)));
      const valid = mine.find((v) => v.venueId === venue.id && v.status === "active");
      if (!valid) {
        return Response.json(
          { error: "No free-play voucher for this futsal yet — play 7 games in a month to earn one! 🎁" },
          { status: 400 }
        );
      }
      useFreePlay = true;
      voucherId = valid.id;
      voucherCode = valid.code;
    }

    const fullPrice = rate * hours;
    const priceAfterVoucher = useFreePlay ? Math.max(0, fullPrice - rate) : fullPrice;

    // Squad 🛡️ — a booking can be made on behalf of one of the player's teams,
    // which is the point of picking "Just our gang". Membership is verified here
    // rather than trusted from the client, and the name is snapshotted from the
    // row we just read so the booking keeps its label if the team is renamed or
    // deleted later. No teamId means an individual booking — which is also what
    // a player in no team gets, since the picker is never shown to them.
    const teamErr = validateTeamId(body.teamId);
    if (teamErr) return Response.json({ error: teamErr }, { status: 400 });
    let teamId: number | null = null;
    let teamName = "";
    const wantedTeam = Number(body.teamId ?? 0);
    if (wantedTeam > 0) {
      const team = await findTeamForUser(wantedTeam, Number(userId));
      if (!team)
        return Response.json(
          { error: "That isn't one of your teams — pick another, or book just for yourself 🛡️" },
          { status: 400 }
        );
      teamId = team.id;
      teamName = team.name;
    }

    /*
     * Competition bookings 🏆 — two squads, one court, a score to come.
     *
     * The squad side is already verified above (it has to be one of the
     * booker's). The opponent is checked against the real team list, and when
     * the game is part of a league, *both* squads must actually be in that
     * league — otherwise "league fixture" would just be a label anyone could
     * type on a Sunday kickabout.
     */
    let opponentTeamId: number | null = null;
    let opponentName = "";
    let tournamentId: number | null = null;
    let tournamentName = "";
    let scoreStatus = "none";
    if (visibility === "competition") {
      if (!teamId)
        return Response.json(
          {
            error:
              "Pick which of your squads is playing — a competition game needs your team on it 🛡️",
          },
          { status: 400 }
        );
      const wantedOpponent = Number(body.opponentTeamId ?? 0);
      if (!Number.isInteger(wantedOpponent) || wantedOpponent <= 0)
        return Response.json({ error: "Pick the squad you're playing against 🆚" }, { status: 400 });
      if (wantedOpponent === teamId)
        return Response.json({ error: "A squad can't play itself 🙂" }, { status: 400 });

      const opponent = (await db.select().from(teams).where(eq(teams.id, wantedOpponent)))[0];
      if (!opponent)
        return Response.json({ error: "That opponent squad doesn't exist 🆚" }, { status: 400 });
      opponentTeamId = opponent.id;
      opponentName = opponent.name;

      const wantedLeague = Number(body.tournamentId ?? 0);
      if (wantedLeague > 0) {
        const league = (
          await db.select().from(tournaments).where(eq(tournaments.id, wantedLeague))
        )[0];
        if (!league)
          return Response.json({ error: "That league no longer exists 🏆" }, { status: 400 });
        const entries = await db
          .select()
          .from(tournamentTeams)
          .where(eq(tournamentTeams.tournamentId, wantedLeague));
        const inLeague = (id: number) =>
          entries.some((e) => e.teamId === id && e.status === "approved");
        if (!inLeague(teamId) || !inLeague(wantedOpponent))
          return Response.json(
            {
              error: `${league.name} runs only fixtures between squads that are in it — both teams need an approved place first 🏆`,
            },
            { status: 400 }
          );
        tournamentId = league.id;
        tournamentName = league.name;
      }
      // Keep the score lifecycle at "awaiting" while the separate
      // `competitionStatus` column holds the opposition-consent gate. The venue
      // has not received an actionable request until that gate is accepted.
      scoreStatus = "awaiting";
    }

    // Promo code 🎟️ — owner-created discount with an expiry date and usage limits.
    // It applies to what's left after any loyalty free hour, and is re-checked here
    // (never trusting the client's maths) right before the booking is written.
    let promoId: number | null = null;
    let promoCode = "";
    let discountAmount = 0;
    let promoMessage = "";
    const wantedCode = normalizePromoCode(body.promoCode);
    if (wantedCode) {
      if (!venue) return Response.json({ error: "Venue not found 📍" }, { status: 404 });
      if (priceAfterVoucher <= 0)
        return Response.json(
          { error: "Your FREE hour already covers this game — no promo code needed 🎁", promoError: "nothing_to_discount" },
          { status: 400 }
        );
      const venuePromos = await db.select().from(promos).where(eq(promos.venueId, venue.id));
      const found = venuePromos.find((p) => p.code === wantedCode) ?? null;
      const promoUsed = found ? await promoUsage([found.id]) : new Map();
      const usedSoFar = found ? promoUsed.get(found.id) : undefined;
      const check = checkPromo({
        promo: found,
        code: wantedCode,
        venueName: venue.name,
        subtotal: priceAfterVoucher,
        usedCount: usedSoFar?.used ?? 0,
        userUsedCount: usedSoFar?.byUser.get(Number(userId)) ?? 0,
      });
      if (!check.ok || !found)
        return Response.json(
          { error: check.ok ? "That promo code isn't available right now 🎟️" : check.error, promoError: check.ok ? "unavailable" : check.reason },
          { status: 400 }
        );
      promoId = found.id;
      promoCode = found.code;
      discountAmount = check.discount;
      promoMessage = check.message;
    }

    const totalPrice = Math.max(0, priceAfterVoucher - discountAmount);

    // Payment method must be one the venue accepts (nothing left to pay = no payment needed).
    let payMethod = String(body.paymentMethod ?? venuePayments[0] ?? "eSewa");
    const isFreeCovered = totalPrice === 0;
    if (isFreeCovered) {
      payMethod = "Free Play 🎁";
    } else if (!venuePayments.includes(payMethod)) {
      return Response.json(
        { error: `This venue accepts ${venuePayments.join(", ")} only — please pick one of those 💳` },
        { status: 400 }
      );
    }

    // Fair-play deposit for risky players (skipped when free hour covers all).
    const depDecision = isFreeCovered || venueDepositPercent <= 0
      ? { required: false, percent: venueDepositPercent, reason: "" }
      : depositDecision(
          { rating: stats.rating, total: stats.total, cancelsThisMonth: stats.cancelsThisMonth },
          bookerTrust,
          venueDepositPercent
        );
    const depositRequired = depDecision.required && totalPrice > 0;
    const depositAmount = depositRequired ? depositAmountFor(totalPrice, depDecision.percent) : 0;
    if (depositRequired) {
      const venueOnline = venuePayments.filter((m) => ONLINE_PAYMENTS.includes(m));
      if (venueOnline.length > 0 && !ONLINE_PAYMENTS.includes(payMethod)) {
        return Response.json(
          { error: `Fair-play shield 🛡️ — your trust needs a ${depDecision.percent}% upfront deposit (${formatNPR(depositAmount)}), so please pay online via test gateway (${venueOnline.join(", ")}). Cash can't hold a deposit 🙂` },
          { status: 400 }
        );
      }
      // Deposit is collected via eSewa/Khalti test gateway AFTER booking is created.
    }

    // Online payments start as pending — gateway verification flips them to paid.
    // Cash stays pending until the venue collects it.
    const paymentStatus = isFreeCovered ? "paid" : "pending";

    const inserted = await db
      .insert(bookings)
      .values({
        courtId: Number(courtId),
        userId: Number(userId),
        date: String(date),
        startTime: String(startTime),
        endTime: reqEnd,
        durationHours: hours,
        totalPrice,
        status: "pending",
        paymentStatus,
        paymentMethod: payMethod,
        bookerName: String(body.bookerName ?? "").trim().slice(0, 60),
        bookerPhone: String(body.bookerPhone ?? "").trim().slice(0, 20),
        notes: String(body.notes ?? "").trim().slice(0, 500),
        visibility,
        playersNeeded,
        ourCrew,
        openSpots,
        teamId,
        teamName,
        receiptUrl: String(body.receiptUrl ?? "").slice(0, 2000000),
        isFreePlay: useFreePlay,
        voucherId,
        promoId,
        promoCode,
        priceBeforeDiscount: priceAfterVoucher,
        discountAmount,
        tournamentId,
        opponentTeamId,
        scoreStatus,
        competitionStatus: visibility === "competition" ? "pending" : "none",
        competitionPaymentPolicy,
        // `chargeMode` stays reserved for public/open booking pricing. A
        // competition row always receives the normal split value here; its
        // actual policy is stored in competitionPaymentPolicy above.
        chargeMode,
        customPricePerPlayer: visibility === "public" && chargeMode === "custom" ? customPrice : 0,
        depositRequired,
        depositAmount,
        depositStatus: depositRequired ? "pending" : "none",
      })
      .returning();

    const booking = inserted[0];

    // A private "Just our gang" booking is a shared obligation, not one
    // mysterious charge on the captain's card. Snapshot one equal, rounded
    // share for every current team member so each person can choose eSewa,
    // Khalti, or cash and the ledger can reconcile the booking as a whole.
    let teamPaymentRows: Array<{ id: number; userId: number; amountDue: number }> = [];
    if (visibility === "private" && teamId) {
      const roster = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));
      const memberIds = Array.from(new Set(roster.map((member) => member.userId)));
      if (!memberIds.includes(Number(userId))) memberIds.push(Number(userId));
      const baseShare = memberIds.length > 0 ? Math.floor(totalPrice / memberIds.length) : totalPrice;
      let remainder = Math.max(0, totalPrice - baseShare * memberIds.length);
      teamPaymentRows = await db
        .insert(bookingTeamPayments)
        .values(
          memberIds.map((memberId) => {
            const amountDue = baseShare + (remainder-- > 0 ? 1 : 0);
            return {
              bookingId: booking.id,
              teamId,
              userId: memberId,
              amountDue,
              paymentMethod: memberId === Number(userId) ? payMethod : "",
              paymentStatus: amountDue === 0 ? "paid" : "pending",
              paidAmount: amountDue === 0 ? 0 : 0,
            };
          }),
        )
        .returning({ id: bookingTeamPayments.id, userId: bookingTeamPayments.userId, amountDue: bookingTeamPayments.amountDue });

      const teamMessage = `${teamName} booking at ${venue?.name ?? "the venue"} on ${prettyDate(booking.date)} at ${formatTime12(booking.startTime)} is ready. Your equal share is ${formatNPR(teamPaymentRows.find((row) => row.userId === Number(userId))?.amountDue ?? 0)} — choose eSewa, Khalti, or cash from My Bookings. Each member's confirmed payment is added to the booking ledger. ⚽`;
      for (const memberId of memberIds) {
        await sendNotification({
          userId: memberId,
          type: "payment",
          title: `👥 Team payment requested — ${teamName}`,
          message: teamMessage,
          link: "/bookings",
        });
      }
    }

    if (useFreePlay && voucherId) {
      await db
        .update(vouchers)
        .set({ status: "used", usedBookingId: booking.id })
        .where(eq(vouchers.id, voucherId));
    }

    // A regular booking can go straight to the venue owner. A competition
    // booking is different: the opposition captain must consent first. Do not
    // leak it into Owner Studio until that captain accepts it.
    if (venue?.ownerId && !opponentTeamId) {
      await sendNotification({
        userId: venue.ownerId,
        type: "booking_request",
        title: `📩 New booking request — ${venue.name}`,
        message: `${booking.bookerName || "A player"} (${stats.emoji} ${stats.rating}★ ${stats.label}, trust ${bookerTrust}/100) requested ${court?.name ?? "a court"} on ${prettyDate(booking.date)} at ${formatTime12(booking.startTime)} (${hours} hr, ${formatNPR(booking.totalPrice)}${useFreePlay ? `, 🎁 FREE HOUR ${voucherCode}` : ""}${promoId ? `, 🎟️ ${promoCode} −${formatNPR(discountAmount)} (was ${formatNPR(priceAfterVoucher)})` : ""}${teamId ? `, 👥 squad ${teamName}` : ""}${depositRequired ? `, 🛡️ ${depDecision.percent}% deposit ${formatNPR(depositAmount)} due via test gateway (non-refundable)` : ""}). Tap to accept or decline.`,
        link: "/admin/requests",
      });
      // Heads-up when this redemption fills the code's cap.
      if (promoId) {
        const promoRows = await db.select().from(promos).where(eq(promos.id, promoId));
        const limit = Math.max(0, Number(promoRows[0]?.usageLimit ?? 0));
        const usedNow = (await promoUsage([promoId])).get(promoId)?.used ?? 0;
        if (limit > 0 && usedNow >= limit) {
          await sendNotification({
            userId: venue.ownerId,
            type: "promo",
            title: `🏁 ${promoCode} is fully redeemed`,
            message: `Your promo ${promoCode} at ${venue.name} just hit its ${limit}-booking cap, so players can't use it any more. ${formatNPR(booking.discountAmount)} off this one. Extend the limit or launch a fresh code from My Venues → Promos 🎟️`,
            link: "/admin/venues",
          });
        }
      }
    }
    if (depositRequired) {
      await sendNotification({
        userId: Number(userId),
        type: "payment",
        title: `🛡️ Deposit due — ${venue?.name ?? "your game"}`,
        message:
          visibility === "competition"
            ? `Fair-play shield: ${formatNPR(depositAmount)} (${depDecision.percent}%) deposit will open after the opposition captain accepts this competition request. It's non-refundable if you cancel — show up and your trust climbs! 💪`
            : `Fair-play shield: pay ${formatNPR(depositAmount)} (${depDecision.percent}%) upfront via eSewa/Khalti test to lock this booking. It's non-refundable if you cancel — show up and your trust climbs! 💪`,
        link: "/bookings",
      });
    }

    let match = null;
    if (visibility === "public") {
      const venueName = venue?.name ?? "Futsal Court";
      const title =
        String(body.matchTitle ?? "").trim() || `⚡ Open game at ${venueName}`;
      const autoPer = playersNeeded > 0 ? Math.round(booking.totalPrice / playersNeeded) : 0;
      const perPlayer = chargeMode === "custom" ? customPrice : Math.max(0, autoPer);
      // Name the squad on the public listing when the host booked for a team,
      // so joiners know which crew they'd be walking into.
      const crewLine = teamId
        ? `🛡️ ${teamName} • 👥 ${ourCrew} from the squad`
        : `👥 ${ourCrew} from our crew`;
      const matchRows = await db
        .insert(openMatches)
        .values({
          title,
          venueId: court ? court.venueId : 0,
          courtId: Number(courtId),
          organizerId: Number(userId),
          bookingId: booking.id,
          date: String(date),
          startTime: String(startTime),
          endTime: reqEnd,
          pricePerPlayer: perPlayer,
          maxPlayers: playersNeeded,
          crewSize: ourCrew,
          level: String(body.level ?? "All Levels"),
          status: "pending",
          chargeMode,
          description:
            String(body.matchDescription ?? "").trim() ||
            (chargeMode === "custom"
              ? `${crewLine} • 🙋 ${openSpots} open for you! Host set a custom ${formatNPR(perPlayer)} per joiner — listing goes live once the venue accepts! 🤝`
              : `${crewLine} • 🙋 ${openSpots} open for you! Court requested by the host — listing goes live once the venue accepts. Split ${formatNPR(perPlayer)} each! 🤝`),
        })
        .returning();
      match = matchRows[0];
      await db.insert(matchJoins).values({
        matchId: match.id,
        userId: Number(userId),
      });
    }

    // Competition game: the selected opposition captain receives the request,
    // but the venue owner must not hear about it until that captain accepts.
    if (opponentTeamId) {
      const opponent = (await db.select().from(teams).where(eq(teams.id, opponentTeamId)))[0];
      await sendNotification({
        userId: opponent?.captainId ?? 0,
        type: "info",
        title: `🆚 Competition request — ${teamName} vs ${opponentName}`,
        message: `${booking.bookerName || "The other captain"} requested ${court?.name ?? "a court"} at ${venue?.name ?? "the venue"} for ${prettyDate(booking.date)} at ${formatTime12(booking.startTime)}.${tournamentName ? ` It counts towards ${tournamentName}.` : ""} Payment policy: ${competitionPaymentPolicy === "loser_pays" ? "the losing squad pays" : "fair split between both squads"}. Open My Bookings to accept or decline. The venue owner is only notified after you accept. ⚽`,
        link: "/bookings",
      });
    }

    return Response.json(
      {
        booking,
        match,
        freePlayUsed: useFreePlay,
        competition: opponentTeamId
          ? {
              opponentId: opponentTeamId,
              opponentName,
              leagueId: tournamentId,
              leagueName: tournamentName,
              paymentMode: competitionPaymentPolicy,
            }
          : null,
        depositRequired,
        depositAmount,
        depositPercent: depDecision.percent,
        promo: promoId
          ? { id: promoId, code: promoCode, discount: discountAmount, message: promoMessage }
          : null,
        team: teamId
          ? {
              id: teamId,
              name: teamName,
              payments: teamPaymentRows,
            }
          : null,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error(`[/api/bookings POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
