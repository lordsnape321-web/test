import { db } from "@/db";
import { bookings, courts, venues, users, openMatches, matchJoins, vouchers } from "@/db/schema";
import { formatNPR, prettyDate, formatTime12, rangesOverlap, addHours } from "@/lib/futsal";
import { playerRating, CANCEL_LIMIT_PER_MONTH, depositDecision, depositAmountFor, parsePayments, ONLINE_PAYMENTS, TRUST_START } from "@/lib/loyalty";
import { validateTitle, validateNotes, validatePhone, validateCrew, validateTotalPlayers, validateDateISO, validateTimeHM, validateHours, validateCustomPrice, firstError } from "@/lib/validation";
import { sendNotification } from "@/lib/notify";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PAY_METHODS = ["eSewa", "Khalti", "Cash at Venue", "Free Play 🎁"];

export async function GET(req: Request) {
  try {
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
    if (userId) rows = rows.filter((r) => r.userId === Number(userId));
    if (courtId) rows = rows.filter((r) => r.courtId === Number(courtId));
    if (date) rows = rows.filter((r) => r.date === date);
    if (status) rows = rows.filter((r) => r.status === status);

    const allCourts = await db.select().from(courts);
    const allVenues = await db.select().from(venues);
    const allUsers = await db.select().from(users);
    const allMatches = await db.select().from(openMatches);
    const allJoins = await db.select().from(matchJoins);

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
      return {
        ...b,
        court,
        venue,
        user,
        playerStats: stats,
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
      };
    });

    return Response.json({ bookings: enriched });
  } catch (e) {
    return Response.json({ bookings: [], error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
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

    const visibility: "private" | "public" =
      body.visibility === "public" ? "public" : "private";

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

    // Custom charge validation (public only).
    const chargeMode: "split" | "custom" = body.chargeMode === "custom" ? "custom" : "split";
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
    const totalPrice = useFreePlay ? Math.max(0, fullPrice - rate) : fullPrice;

    // Payment method must be one the venue accepts (free-play covers all = no payment needed).
    let payMethod = String(body.paymentMethod ?? venuePayments[0] ?? "eSewa");
    const isFreeCovered = useFreePlay && totalPrice === 0;
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
        receiptUrl: String(body.receiptUrl ?? "").slice(0, 2000000),
        isFreePlay: useFreePlay,
        voucherId,
        chargeMode: visibility === "public" ? chargeMode : "split",
        customPricePerPlayer: visibility === "public" && chargeMode === "custom" ? customPrice : 0,
        depositRequired,
        depositAmount,
        depositStatus: depositRequired ? "pending" : "none",
      })
      .returning();

    const booking = inserted[0];

    if (useFreePlay && voucherId) {
      await db
        .update(vouchers)
        .set({ status: "used", usedBookingId: booking.id })
        .where(eq(vouchers.id, voucherId));
    }

    if (venue?.ownerId) {
      await sendNotification({
        userId: venue.ownerId,
        type: "booking_request",
        title: `📩 New booking request — ${venue.name}`,
        message: `${booking.bookerName || "A player"} (${stats.emoji} ${stats.rating}★ ${stats.label}, trust ${bookerTrust}/100) requested ${court?.name ?? "a court"} on ${prettyDate(booking.date)} at ${formatTime12(booking.startTime)} (${hours} hr, ${formatNPR(booking.totalPrice)}${useFreePlay ? `, 🎁 FREE HOUR ${voucherCode}` : ""}${depositRequired ? `, 🛡️ ${depDecision.percent}% deposit ${formatNPR(depositAmount)} due via test gateway (non-refundable)` : ""}). Tap to accept or decline.`,
        link: "/admin/requests",
      });
    }
    if (depositRequired) {
      await sendNotification({
        userId: Number(userId),
        type: "payment",
        title: `🛡️ Deposit due — ${venue?.name ?? "your game"}`,
        message: `Fair-play shield: pay ${formatNPR(depositAmount)} (${depDecision.percent}%) upfront via eSewa/Khalti test to lock this booking. It's non-refundable if you cancel — show up and your trust climbs! 💪`,
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
              ? `👥 ${ourCrew} from our crew • 🙋 ${openSpots} open for you! Host set a custom ${formatNPR(perPlayer)} per joiner — listing goes live once the venue accepts! 🤝`
              : `👥 ${ourCrew} from our crew • 🙋 ${openSpots} open for you! Court requested by the host — listing goes live once the venue accepts. Split ${formatNPR(perPlayer)} each! 🤝`),
        })
        .returning();
      match = matchRows[0];
      await db.insert(matchJoins).values({
        matchId: match.id,
        userId: Number(userId),
      });
    }

    return Response.json({ booking, match, freePlayUsed: useFreePlay, depositRequired, depositAmount, depositPercent: depDecision.percent }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
