import { db } from "@/db";
import { teamMembers, teamRequests, teams } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import { isCaptain, isMember, teamJoinRequests, teamRoster } from "@/lib/team-store";
import { REQUEST_ACCEPTED, REQUEST_DECLINED, REQUEST_PENDING } from "@/lib/teams";

export const dynamic = "force-dynamic";

/**
 * GET — the captain's join-request queue 👑
 *
 * Captain-gated: nobody else sees who has asked to join. `?status=all` returns
 * the decided ones too, which is what the panel's history list uses.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = Number(id);
    const { searchParams } = new URL(req.url);
    const captainId = Number(searchParams.get("captainId") ?? 0);
    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ requests: [], error: "Invalid team 🛡️" }, { status: 400 });
    if (!(await isCaptain(teamId, captainId)))
      return Response.json(
        { requests: [], error: "Only the captain can see join requests 👑" },
        { status: 403 }
      );

    const raw = searchParams.get("status");
    const status = raw === "all" || raw === "" ? "" : (raw ?? REQUEST_PENDING);
    const requests = await teamJoinRequests(teamId, status);
    return Response.json({ requests });
  } catch (e) {
    console.error(`[/api/teams/[id]/requests GET] failed:`, e);
    return Response.json({ requests: [], error: String(e) }, { status: 500 });
  }
}

/**
 * POST — accept or decline one request.
 *
 * Accepting is the only way a request becomes a roster row, and it re-checks the
 * squad size at decision time rather than trusting the count from when the
 * player asked.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = Number(id);
    const body = await req.json().catch(() => ({}));
    const captainId = Number(body.captainId);
    const requestId = Number(body.requestId);
    const action = String(body.action ?? "");

    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });
    if (!Number.isInteger(requestId) || requestId <= 0)
      return Response.json({ error: "Invalid request 🛡️" }, { status: 400 });
    if (action !== "accept" && action !== "decline")
      return Response.json({ error: "Choose accept or decline 🛡️" }, { status: 400 });
    if (!(await isCaptain(teamId, captainId)))
      return Response.json(
        { error: "Only the captain can decide join requests 👑" },
        { status: 403 }
      );

    const request = (
      await db
        .select()
        .from(teamRequests)
        .where(and(eq(teamRequests.id, requestId), eq(teamRequests.teamId, teamId)))
    )[0];
    if (!request)
      return Response.json({ error: "That request no longer exists 🛡️" }, { status: 404 });
    if (request.status !== REQUEST_PENDING)
      return Response.json(
        { error: `That request was already ${request.status} ⏳` },
        { status: 409 }
      );

    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team)
      return Response.json({ error: "Team not found 🛡️" }, { status: 404 });

    const decided = await db
      .update(teamRequests)
      .set({
        status: action === "accept" ? REQUEST_ACCEPTED : REQUEST_DECLINED,
        decidedAt: new Date(),
        decidedBy: captainId,
      })
      .where(eq(teamRequests.id, requestId))
      .returning();

    if (action === "decline") {
      await sendNotification({
        userId: request.userId,
        type: "team",
        title: `🛡️ ${team.name} couldn't take you this time`,
        message: `${team.captainId === captainId ? "The captain" : "The captain"} declined your request to join ${team.name}. Nothing personal — squads stay small on purpose. You're welcome to ask again later or find another team.`,
        // The squad page — the player can read the team properly and,
        // if they were turned down, ask again from there.
        link: `/teams/${team.id}`,
      });
      return Response.json({ ok: true, action, request: decided[0], memberAdded: false });
    }

    // Accept: they may already have been added directly by the captain.
    if (await isMember(teamId, request.userId)) {
      return Response.json({
        ok: true,
        action,
        request: decided[0],
        memberAdded: false,
        message: "They were already on the roster 🛡️",
      });
    }
    const roster = await teamRoster(teamId);
    if (roster.length >= team.maxPlayers)
      return Response.json(
        {
          error: `Your squad is full (${roster.length}/${team.maxPlayers}) — raise the team size before accepting 👥`,
          reason: "squad_full",
        },
        { status: 409 }
      );

    await db.insert(teamMembers).values({
      teamId,
      userId: request.userId,
      role: "player",
    });
    await sendNotification({
      userId: request.userId,
      type: "team",
      title: `🎉 You're in ${team.name}!`,
      message: `The captain accepted your request — you're officially part of ${team.name} (${team.teamCode ?? "no code"}). Pick "Just our gang" and choose them when you book a court 🛡️`,
      // Straight to the squad page, so the first thing a new member reads is who
      // they'll be playing with.
      link: `/teams/${team.id}`,
    });

    return Response.json({ ok: true, action, request: decided[0], memberAdded: true });
  } catch (e) {
    console.error(`[/api/teams/[id]/requests POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
