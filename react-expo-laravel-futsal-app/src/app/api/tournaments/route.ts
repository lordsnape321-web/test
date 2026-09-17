import { db } from "@/db";
import { courts, tournaments, users, venues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listLeagues } from "@/lib/league-store";
import {
  LEAGUE_FORMATS,
  LEAGUE_MAX_ENTRY_FEE,
  LEAGUE_VISIBILITIES,
  depositPercentError,
  refundPercentError,
} from "@/lib/league";
import {
  firstError,
  validateDateISO,
  validateEntryFee,
  validateLeagueDates,
  validateLeagueName,
  validateLeagueText,
  validateMatchDays,
  validateMaxTeams,
  validatePhone,
  validatePrizeBreakdown,
  validatePrizePool,
} from "@/lib/validation";
import { LEAGUE_DESCRIPTION_MAX, LEAGUE_RULES_MAX } from "@/lib/league";

export const dynamic = "force-dynamic";

/**
 * GET /api/tournaments — the league board 🏆
 *
 * Public leagues, plus any private league this viewer has a right to see (they
 * host it, or one of their squads was invited or admitted). `viewerId` is what
 * keeps a private league private; without it, only open listings come back.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const viewerId = Number(searchParams.get("viewerId") ?? 0) || 0;
    const hostId = Number(searchParams.get("hostId") ?? 0) || 0;
    const venueId = Number(searchParams.get("venueId") ?? 0) || 0;
    const status = String(searchParams.get("status") ?? "").trim();
    const q = String(searchParams.get("q") ?? "").trim().slice(0, 60);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 60) || 60));

    const leagues = await listLeagues({ viewerId, hostId, venueId, status, q, limit });
    return Response.json({ leagues });
  } catch (e) {
    console.error(`[/api/tournaments GET] failed:`, e);
    return Response.json({ leagues: [], error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/tournaments — host a league 🎉
 *
 * Any logged-in player *or* venue owner can run one; `hostRole` is recorded so
 * the console can label it, but it grants no extra powers. What a host does get
 * is the whole control room: entries, the ledger, the fixture list and the
 * album, all gated on `hostId === userId` in the routes that touch them.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const hostId = Number(body.hostId);
    if (!Number.isInteger(hostId) || hostId <= 0)
      return Response.json({ error: "Log in to host a league 🔒" }, { status: 400 });

    const host = (await db.select().from(users).where(eq(users.id, hostId)))[0];
    if (!host) return Response.json({ error: "That account no longer exists 🔒" }, { status: 404 });

    const name = String(body.name ?? "").trim();
    const venueId = Number(body.venueId);
    const courtId = Number(body.courtId) || 0;
    const format = String(body.format ?? "5v5");
    const maxTeams = Number(body.maxTeams);
    const entryFee = body.entryFee === "" || body.entryFee === undefined ? 0 : Number(body.entryFee);
    const depositPercent = Number(body.depositPercent ?? 25);
    const refundPercent = Number(body.refundPercent ?? 10);
    const prizePool = body.prizePool === "" || body.prizePool === undefined ? 0 : Number(body.prizePool);
    const prizeBreakdown = String(body.prizeBreakdown ?? "").trim();
    const startsAt = String(body.startsAt ?? "").trim();
    const endsAt = String(body.endsAt ?? "").trim();
    const closesAt = String(body.closesAt ?? "").trim();
    const matchDays = String(body.matchDays ?? "").trim();
    const visibility = String(body.visibility ?? "public");
    const description = String(body.description ?? "").trim();
    const rules = String(body.rules ?? "").trim();
    const contactPhone = String(body.contactPhone ?? "").trim();
    const bannerUrl = String(body.bannerUrl ?? "");

    const venue = (await db.select().from(venues).where(eq(venues.id, venueId)))[0];
    const err = firstError(
      validateLeagueName(name),
      venue ? null : "Pick the ground this league plays on 🏟️",
      (LEAGUE_FORMATS as readonly string[]).includes(format)
        ? null
        : `Format must be one of ${LEAGUE_FORMATS.join(", ")} 🥅`,
      validateMaxTeams(maxTeams),
      validateEntryFee(entryFee),
      depositPercentError(depositPercent),
      refundPercentError(refundPercent),
      validatePrizePool(prizePool),
      validatePrizeBreakdown(prizeBreakdown),
      validateLeagueDates(startsAt, endsAt, closesAt),
      validateMatchDays(matchDays),
      (LEAGUE_VISIBILITIES as readonly string[]).includes(visibility)
        ? null
        : "Visibility must be public or private 🔒",
      validateLeagueText(description, { label: "Description", max: LEAGUE_DESCRIPTION_MAX }),
      validateLeagueText(rules, { label: "Rules", max: LEAGUE_RULES_MAX }),
      // A phone number is how a captain reaches the host on match day, so a
      // bad one is worse than none — but it stays optional.
      validatePhone(contactPhone, { required: false }),
      entryFee > LEAGUE_MAX_ENTRY_FEE ? "Entry fee is too high 💰" : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    if (courtId > 0) {
      const court = (await db.select().from(courts).where(eq(courts.id, courtId)))[0];
      if (!court || court.venueId !== venue.id)
        return Response.json({ error: "That pitch isn't at the ground you picked 🥅" }, { status: 400 });
    }

    const rows = await db
      .insert(tournaments)
      .values({
        name,
        hostId,
        hostRole: venue.ownerId === hostId ? "owner" : "player",
        venueId: venue.id,
        courtId: courtId > 0 ? courtId : null,
        format,
        maxTeams,
        entryFee,
        depositPercent,
        refundPercent,
        prizePool,
        prizeBreakdown,
        startsAt,
        endsAt,
        closesAt,
        matchDays,
        visibility,
        status: "registration",
        description,
        rules,
        contactPhone,
        bannerUrl: bannerUrl.slice(0, 2000000),
      })
      .returning();

    return Response.json({ league: rows[0] }, { status: 201 });
  } catch (e) {
    console.error(`[/api/tournaments POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
