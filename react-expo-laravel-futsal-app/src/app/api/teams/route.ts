import { db } from "@/db";
import { teams, teamMembers, users, venues } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  firstError,
  validateMessage,
  validateTeamCode,
  validateTitle,
} from "@/lib/validation";
import { normalizeTeamCode } from "@/lib/teams";
import {
  myPendingRequest,
  pendingRequestCounts,
  searchTeams,
  teamCodeTaken,
  teamsForUser,
} from "@/lib/team-store";

export const dynamic = "force-dynamic";

const LEVELS = ["Beginner", "Intermediate", "Advanced"];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // ?userId=N returns just that player's squads — the shape the booking flow's
    // team picker needs (id/name/memberCount/logoColor/role), without shipping
    // every team and every roster in the database.
    const userId = Number(searchParams.get("userId") ?? 0);
    if (Number.isInteger(userId) && userId > 0) {
      return Response.json({ teams: await teamsForUser(userId) });
    }

    // ?q= / ?code= searches by unique code or by name — how a player finds a
    // squad a friend read them the code for.
    const q = String(searchParams.get("q") ?? searchParams.get("code") ?? "").trim();
    const viewerId = Number(searchParams.get("viewerId") ?? 0);
    const hasViewer = Number.isInteger(viewerId) && viewerId > 0;

    const base = q ? await searchTeams(q, 50) : await db.select().from(teams);
    const members = await db.select().from(teamMembers);
    const allUsers = await db.select().from(users);
    const pending = await pendingRequestCounts(base.map((t) => t.id));

    const enriched = await Promise.all(
      base.map(async (t) => {
        const tm = members.filter((m) => m.teamId === t.id);
        const players = tm
          .map((m) => allUsers.find((u) => u.id === m.userId))
          .filter(Boolean);
        const captain = allUsers.find((u) => u.id === t.captainId);
        const mine = tm.some((m) => m.userId === viewerId);
        const request = hasViewer && !mine ? await myPendingRequest(t.id, viewerId) : null;
        return {
          ...t,
          teamCode: t.teamCode ?? "",
          memberCount: tm.length,
          players,
          captainName: captain?.name ?? "—",
          // Only the captain needs to see how many requests are waiting.
          pendingRequests: t.captainId === viewerId ? (pending.get(t.id) ?? 0) : 0,
          // Per-viewer state so the card can render the right button.
          viewer: hasViewer
            ? {
                isMember: mine,
                isCaptain: t.captainId === viewerId,
                requestStatus: request?.status ?? null,
                requestId: request?.id ?? null,
              }
            : null,
        };
      })
    );
    return Response.json({ teams: enriched, query: q });
  } catch (e) {
    console.error(`[/api/teams GET] failed:`, e);
    return Response.json({ teams: [], error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name ?? "").trim();
    const motto = String(body.motto ?? "").trim();
    const captainId = Number(body.captainId);
    // Home turf is chosen from venues on the platform, never typed free-hand.
    const homeVenueId = Number(body.homeVenueId ?? 0) || 0;

    const err = firstError(
      validateTitle(name, { min: 3, max: 50, label: "Team name" }),
      motto
        ? validateMessage(motto, { min: 3, max: 120, label: "Motto", required: false })
        : null,
      validateTeamCode(body.teamCode),
      !Number.isInteger(captainId) || captainId <= 0 ? "Login to start a team 🔒" : null,
      body.level && !LEVELS.includes(String(body.level)) ? "Pick a valid level 🌱⚡🔥" : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    const maxPlayers = Number(body.maxPlayers ?? 12);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 4 || maxPlayers > 30)
      return Response.json({ error: "Team size must be 4–30 players 👥" }, { status: 400 });

    // The captain has to be a real account — and there is exactly one of them.
    const captainRows = await db.select().from(users).where(eq(users.id, captainId));
    if (captainRows.length === 0)
      return Response.json({ error: "Login to start a team 🔒" }, { status: 400 });

    const teamCode = normalizeTeamCode(body.teamCode);
    if (await teamCodeTaken(teamCode))
      return Response.json(
        {
          error: `Code "${teamCode}" is already taken — try another so your squad is easy to find 🛡️`,
          codeError: "taken",
        },
        { status: 409 }
      );

    let homeGround = "";
    let venueId: number | null = null;
    if (homeVenueId > 0) {
      const venueRows = await db.select().from(venues).where(eq(venues.id, homeVenueId));
      if (venueRows.length === 0)
        return Response.json(
          { error: "Pick a home turf from the venues on this platform 📍" },
          { status: 400 }
        );
      // Snapshot the name so the card keeps rendering if the venue changes.
      venueId = venueRows[0].id;
      homeGround = venueRows[0].name;
    }

    const inserted = await db
      .insert(teams)
      .values({
        name,
        motto,
        teamCode,
        captainId,
        maxPlayers,
        level: body.level ?? "Intermediate",
        logoColor: body.logoColor ?? "#16a34a",
        homeVenueId: venueId,
        homeGround,
        lookingForPlayers: body.lookingForPlayers ?? true,
      })
      .returning();
    // One membership row, one captain: the founder. Nobody else starts as
    // captain, and nothing in the API can create a second one.
    await db.insert(teamMembers).values({
      teamId: inserted[0].id,
      userId: captainId,
      role: "captain",
    });
    return Response.json({ team: inserted[0] }, { status: 201 });
  } catch (e) {
    console.error(`[/api/teams POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
