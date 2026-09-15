import { db } from "@/db";
import { teams, teamMembers, users, venues } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  firstError,
  validateMessage,
  validateTeamCode,
  validateTeamDescription,
  validateTitle,
} from "@/lib/validation";
import { normalizeTeamCode, suggestTeamCode } from "@/lib/teams";
import {
  joinRequestQuota,
  myPendingInvite,
  myPendingRequest,
  pendingInviteCounts,
  pendingRequestCounts,
  searchTeams,
  teamCodeTaken,
  teamInviteQuota,
  teamsForUser,
} from "@/lib/team-store";
import type { Quota } from "@/lib/teams";

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
    const pendingInvites = await pendingInviteCounts(base.map((t) => t.id));

    // Invite slots are per squad, so they are looked up only for the squads this
    // viewer actually captains — a player browsing sees no quota numbers at all.
    const captainedIds = base.filter((t) => t.captainId === viewerId).map((t) => t.id);
    const inviteQuotas = new Map<number, Quota>();
    await Promise.all(
      captainedIds.map(async (id) => {
        inviteQuotas.set(id, await teamInviteQuota(id));
      })
    );
    const viewerQuota = hasViewer ? await joinRequestQuota(viewerId) : null;

    const enriched = await Promise.all(
      base.map(async (t) => {
        const tm = members.filter((m) => m.teamId === t.id);
        const players = tm
          .map((m) => allUsers.find((u) => u.id === m.userId))
          .filter(Boolean);
        const captain = allUsers.find((u) => u.id === t.captainId);
        const mine = tm.some((m) => m.userId === viewerId);
        const request = hasViewer && !mine ? await myPendingRequest(t.id, viewerId) : null;
        // An open invitation outranks a request: it is the squad asking the
        // player, and the card's buttons change from "ask" to "say yes".
        const invite = hasViewer && !mine ? await myPendingInvite(t.id, viewerId) : null;
        const leads = t.captainId === viewerId;
        return {
          ...t,
          teamCode: t.teamCode ?? "",
          memberCount: tm.length,
          players,
          captainName: captain?.name ?? "—",
          // Only the captain needs to see how many requests are waiting.
          pendingRequests: leads ? (pending.get(t.id) ?? 0) : 0,
          // …and how many invitations they have out with no answer yet.
          pendingInvites: leads ? (pendingInvites.get(t.id) ?? 0) : 0,
          invitesLeftToday: leads ? (inviteQuotas.get(t.id)?.left ?? 0) : 0,
          // Per-viewer state so the card can render the right button.
          viewer: hasViewer
            ? {
                isMember: mine,
                isCaptain: leads,
                requestStatus: request?.status ?? null,
                requestId: request?.id ?? null,
                inviteStatus: invite?.status ?? null,
                inviteId: invite?.id ?? null,
              }
            : null,
        };
      })
    );
    return Response.json({
      teams: enriched,
      query: q,
      // The player's side of the daily cap, so /teams can warn before the fifth
      // tap rather than after it.
      quota: viewerQuota,
    });
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
    const description = String(body.description ?? "").trim();
    const captainId = Number(body.captainId);
    // Home turf is chosen from venues on the platform, never typed free-hand.
    const homeVenueId = Number(body.homeVenueId ?? 0) || 0;

    const err = firstError(
      validateTitle(name, { min: 3, max: 50, label: "Team name" }),
      motto
        ? validateMessage(motto, { min: 3, max: 120, label: "Motto", required: false })
        : null,
      validateTeamDescription(description),
      // Blank is allowed: the create form promises "leave it blank and we'll
      // generate one", so the code is derived from the name below instead of the
      // request bouncing with a 400.
      body.teamCode === undefined || String(body.teamCode).trim() === ""
        ? null
        : validateTeamCode(body.teamCode),
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

    let teamCode = normalizeTeamCode(body.teamCode);
    if (teamCode && (await teamCodeTaken(teamCode)))
      return Response.json(
        {
          error: `Code "${teamCode}" is already taken — try another so your squad is easy to find 🛡️`,
          codeError: "taken",
        },
        { status: 409 }
      );
    if (!teamCode) {
      // `suggestTeamCode` appends four random characters, so a few retries settle
      // any collision with a squad that drew the same tail.
      for (let i = 0; i < 8 && !teamCode; i++) {
        const guess = suggestTeamCode(name);
        teamCode = (await teamCodeTaken(guess)) ? "" : guess;
      }
      if (!teamCode)
        return Response.json(
          {
            error: "Every code we tried for that name is taken — type your own 🛡️",
            codeError: "taken",
          },
          { status: 409 }
        );
    }

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
        description,
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
