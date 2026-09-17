import { db } from "@/db";
import { courts, tournamentTeams, tournaments, venues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { leagueDetail } from "@/lib/league-store";
import {
  LEAGUE_DESCRIPTION_MAX,
  LEAGUE_FORMATS,
  LEAGUE_RULES_MAX,
  LEAGUE_STATUSES,
  LEAGUE_VISIBILITIES,
  TEAM_APPROVED,
  depositPercentError,
  refundPercentError,
} from "@/lib/league";
import {
  firstError,
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

export const dynamic = "force-dynamic";

/**
 * GET /api/tournaments/[id] — one league, in full 🏆
 *
 * The response is deliberately shaped by *who is asking*: the host gets the
 * pending requests, the ledger and every fixture; a squad in the league gets the
 * table, the fixtures and its own money row; a stranger gets only what a public
 * listing is allowed to show. The filtering happens in `league-store`, so this
 * handler stays a one-liner and no route can accidentally widen it.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leagueId = Number(id);
    if (!Number.isInteger(leagueId) || leagueId <= 0)
      return Response.json({ error: "Invalid league 🛡️" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const viewerId = Number(searchParams.get("viewerId") ?? 0) || 0;

    const detail = await leagueDetail(leagueId, viewerId);
    if (!detail) return Response.json({ error: "That league no longer exists 🛡️" }, { status: 404 });
    return Response.json({ league: detail });
  } catch (e) {
    console.error(`[/api/tournaments/[id] GET] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/tournaments/[id] — the host edits the deal ✍️
 *
 * Size, money, dates, format, visibility and status all live here. The two
 * guards that matter: only the host may patch, and the squad cap can never be
 * lowered below the squads already admitted — a league can't shrink out from
 * under a team that paid to be in it.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leagueId = Number(id);
    const body = await req.json().catch(() => ({}));
    const hostId = Number(body.hostId);

    if (!Number.isInteger(leagueId) || leagueId <= 0)
      return Response.json({ error: "Invalid league 🛡️" }, { status: 400 });

    const current = (await db.select().from(tournaments).where(eq(tournaments.id, leagueId)))[0];
    if (!current) return Response.json({ error: "That league no longer exists 🛡️" }, { status: 404 });
    if (current.hostId !== hostId)
      return Response.json({ error: "Only the host can change the league 👑" }, { status: 403 });

    const entries = await db
      .select()
      .from(tournamentTeams)
      .where(eq(tournamentTeams.tournamentId, leagueId));
    const approved = entries.filter((e) => e.status === TEAM_APPROVED).length;

    const name = body.name === undefined ? current.name : String(body.name).trim();
    const format = body.format === undefined ? current.format : String(body.format);
    const maxTeams = body.maxTeams === undefined ? current.maxTeams : Number(body.maxTeams);
    const entryFee = body.entryFee === undefined ? current.entryFee : Number(body.entryFee);
    const depositPercent =
      body.depositPercent === undefined ? current.depositPercent : Number(body.depositPercent);
    const refundPercent =
      body.refundPercent === undefined ? current.refundPercent : Number(body.refundPercent);
    const prizePool = body.prizePool === undefined ? current.prizePool : Number(body.prizePool);
    const prizeBreakdown =
      body.prizeBreakdown === undefined ? current.prizeBreakdown : String(body.prizeBreakdown).trim();
    const startsAt = body.startsAt === undefined ? current.startsAt : String(body.startsAt).trim();
    const endsAt = body.endsAt === undefined ? current.endsAt : String(body.endsAt).trim();
    const closesAt = body.closesAt === undefined ? current.closesAt : String(body.closesAt).trim();
    const matchDays = body.matchDays === undefined ? current.matchDays : String(body.matchDays).trim();
    const visibility = body.visibility === undefined ? current.visibility : String(body.visibility);
    const status = body.status === undefined ? current.status : String(body.status);
    const description =
      body.description === undefined ? current.description : String(body.description).trim();
    const rules = body.rules === undefined ? current.rules : String(body.rules).trim();
    const contactPhone =
      body.contactPhone === undefined ? current.contactPhone : String(body.contactPhone).trim();
    const bannerUrl = body.bannerUrl === undefined ? current.bannerUrl : String(body.bannerUrl);
    const venueId = body.venueId === undefined ? current.venueId : Number(body.venueId) || null;
    const courtId = body.courtId === undefined ? current.courtId : Number(body.courtId) || null;

    const venue = venueId
      ? (await db.select().from(venues).where(eq(venues.id, venueId)))[0]
      : null;
    const court = courtId ? (await db.select().from(courts).where(eq(courts.id, courtId)))[0] : null;

    const err = firstError(
      validateLeagueName(name),
      venue ? null : "Pick the ground this league plays on 🏟️",
      (LEAGUE_FORMATS as readonly string[]).includes(format)
        ? null
        : `Format must be one of ${LEAGUE_FORMATS.join(", ")} 🥅`,
      validateMaxTeams(maxTeams),
      maxTeams < approved
        ? `${approved} squads are already in — the league can't be smaller than that 👥`
        : null,
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
      (LEAGUE_STATUSES as readonly string[]).includes(status)
        ? null
        : "Unknown league status 🏷️",
      validateLeagueText(description, { label: "Description", max: LEAGUE_DESCRIPTION_MAX }),
      validateLeagueText(rules, { label: "Rules", max: LEAGUE_RULES_MAX }),
      validatePhone(contactPhone, { required: false }),
      court && venue && court.venueId !== venue.id
        ? "That pitch isn't at the ground you picked 🥅"
        : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    const updated = await db
      .update(tournaments)
      .set({
        name,
        venueId,
        courtId,
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
        status,
        description,
        rules,
        contactPhone,
        bannerUrl: bannerUrl.slice(0, 2000000),
      })
      .where(eq(tournaments.id, leagueId))
      .returning();

    return Response.json({ league: updated[0] });
  } catch (e) {
    console.error(`[/api/tournaments/[id] PATCH] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
