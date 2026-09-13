import { db } from "@/db";
import { teamMembers, teamRequests, teams, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import { isCaptain, isMember, teamRoster } from "@/lib/team-store";

export const dynamic = "force-dynamic";

/**
 * GET — the roster. Public, so anyone can see who plays for a squad, but the
 * members' email addresses only go to the captain (`?captainId=N`, verified
 * server-side): contact details are for running the team, not for scraping.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = Number(id);
    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ roster: [], error: "Invalid team 🛡️" }, { status: 400 });
    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team)
      return Response.json({ roster: [], error: "Team not found 🛡️" }, { status: 404 });
    const viewerId = Number(new URL(req.url).searchParams.get("viewerId") ?? 0);
    const forCaptain =
      Number.isInteger(viewerId) && viewerId > 0 && (await isCaptain(teamId, viewerId));
    const roster = await teamRoster(teamId);
    return Response.json({
      roster: forCaptain
        ? roster
        : roster.map((m) => ({ ...m, email: "" })),
      team: {
        id: team.id,
        name: team.name,
        teamCode: team.teamCode ?? "",
        captainId: team.captainId,
        maxPlayers: team.maxPlayers,
        memberCount: roster.length,
      },
    });
  } catch (e) {
    console.error(`[/api/teams/[id]/members GET] failed:`, e);
    return Response.json({ roster: [], error: String(e) }, { status: 500 });
  }
}

/**
 * POST — the captain adds a player straight to the roster 👑
 *
 * The direct path, for the friend standing next to you: no request, no waiting.
 * Only the captain can do it, and the squad size limit still applies.
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
    const userId = Number(body.userId);

    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Pick a player to add 👥" }, { status: 400 });
    if (!(await isCaptain(teamId, captainId)))
      return Response.json({ error: "Only the captain can add members 👑" }, { status: 403 });

    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team)
      return Response.json({ error: "Team not found 🛡️" }, { status: 404 });
    const person = (await db.select().from(users).where(eq(users.id, userId)))[0];
    if (!person)
      return Response.json({ error: "That player doesn't exist 🔒" }, { status: 404 });

    if (await isMember(teamId, userId))
      return Response.json(
        { ok: true, alreadyMember: true, message: `${person.name} is already in the squad 🛡️` },
        { status: 200 }
      );

    const roster = await teamRoster(teamId);
    if (roster.length >= team.maxPlayers)
      return Response.json(
        {
          error: `Your squad is full (${roster.length}/${team.maxPlayers}) — raise the team size first 👥`,
          reason: "squad_full",
        },
        { status: 409 }
      );

    await db.insert(teamMembers).values({ teamId, userId, role: "player" });
    // A direct add settles any request they had filed, so it can't be accepted twice.
    await db
      .delete(teamRequests)
      .where(
        and(
          eq(teamRequests.teamId, teamId),
          eq(teamRequests.userId, userId),
          eq(teamRequests.status, "pending")
        )
      );
    await sendNotification({
      userId,
      type: "team",
      title: `🛡️ ${person.name}, you're in ${team.name}!`,
      message: `The captain added you to ${team.name} (${team.teamCode ?? "no code"}). Choose them under "Just our gang" when you book a court ⚽`,
      link: "/teams",
    });

    return Response.json({ ok: true, memberAdded: true, roster: await teamRoster(teamId) }, { status: 201 });
  } catch (e) {
    console.error(`[/api/teams/[id]/members POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * DELETE — the captain removes a member. ?captainId= is who is acting,
 * ?userId= who is being removed.
 *
 * The captain cannot remove themselves: a team always has exactly one captain,
 * so they transfer the armband first (PATCH /api/teams/[id] with `newCaptainId`).
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = Number(id);
    const { searchParams } = new URL(req.url);
    const captainId = Number(searchParams.get("captainId") ?? 0);
    const userId = Number(searchParams.get("userId") ?? 0);

    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Pick a player to remove 👥" }, { status: 400 });
    if (!(await isCaptain(teamId, captainId)))
      return Response.json({ error: "Only the captain can remove members 👑" }, { status: 403 });
    if (userId === captainId)
      return Response.json(
        {
          error:
            "You can't remove yourself while you're captain 👑 — hand the armband to another member first.",
          reason: "captain_cannot_self_remove",
        },
        { status: 409 }
      );

    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team)
      return Response.json({ error: "Team not found 🛡️" }, { status: 404 });
    if (!(await isMember(teamId, userId)))
      return Response.json({ error: "That player isn't in your squad 🛡️" }, { status: 404 });

    const rows = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    for (const r of rows) await db.delete(teamMembers).where(eq(teamMembers.id, r.id));
    await db
      .delete(teamRequests)
      .where(
        and(eq(teamRequests.teamId, teamId), eq(teamRequests.userId, userId))
      );

    const person = (await db.select().from(users).where(eq(users.id, userId)))[0];
    await sendNotification({
      userId,
      type: "team",
      title: `🛡️ You're no longer in ${team.name}`,
      message: `The captain removed you from ${team.name}. If that looks like a mistake, ask them to add you back or request to join again from the Teams page.`,
      link: "/teams",
    });

    return Response.json({
      ok: true,
      removed: userId,
      removedName: person?.name ?? "",
      roster: await teamRoster(teamId),
    });
  } catch (e) {
    console.error(`[/api/teams/[id]/members DELETE] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
