import { db } from "@/db";
import { teamInvites, teamMembers, teamRequests, teams, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import {
  findInvite,
  isMember,
  joinRequestQuota,
  playerInvites,
  teamRoster,
} from "@/lib/team-store";
import {
  REQUEST_ACCEPTED,
  REQUEST_CANCELLED,
  REQUEST_DECLINED,
  REQUEST_PENDING,
} from "@/lib/teams";

export const dynamic = "force-dynamic";

/**
 * GET — every invitation waiting on this player 📨
 *
 * The mirror of `GET /api/teams/{id}/requests`: that one is the captain's queue,
 * this one is the player's. Only the invitee's own rows are ever returned, and
 * `quota` is how many more squads they may ask to join today, so the Teams page
 * can say so up front instead of letting the fifth tap fail.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = Number(searchParams.get("userId") ?? 0);
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json(
        { invites: [], error: "Login to see your invites 🔒" },
        { status: 400 }
      );
    const raw = searchParams.get("status");
    const status = raw === "all" || raw === "" ? "" : (raw ?? REQUEST_PENDING);
    const [invites, quota] = await Promise.all([
      playerInvites(userId, status),
      joinRequestQuota(userId),
    ]);
    return Response.json({ invites, quota });
  } catch (e) {
    console.error(`[/api/team-invites GET] failed:`, e);
    return Response.json({ invites: [], error: String(e) }, { status: 500 });
  }
}

/**
 * POST — answer an invitation ✅❌
 *
 * The invited player is the only one who can act, and the roster row is created
 * here — never when the captain sent the invite. That is the whole point: consent
 * is what turns an invitation into a membership.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = Number(body.userId);
    const inviteId = Number(body.inviteId);
    const action = String(body.action ?? "");

    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Login to answer invites 🔒" }, { status: 400 });
    if (!Number.isInteger(inviteId) || inviteId <= 0)
      return Response.json({ error: "Invalid invite 📨" }, { status: 400 });
    if (action !== "accept" && action !== "decline")
      return Response.json({ error: "Accept or decline the invite 📨" }, { status: 400 });

    const invite = await findInvite(inviteId);
    // Theirs or nobody's — an invite addressed to someone else is not a 403 with
    // extra detail, it just does not exist as far as this account is concerned.
    if (!invite || invite.userId !== userId)
      return Response.json({ error: "That invite no longer exists 📨" }, { status: 404 });
    if (invite.status !== REQUEST_PENDING)
      return Response.json(
        { error: `You already ${invite.status === REQUEST_ACCEPTED ? "joined" : "answered"} that invite ⏳` },
        { status: 409 }
      );

    const team = (await db.select().from(teams).where(eq(teams.id, invite.teamId)))[0];
    const player = (await db.select().from(users).where(eq(users.id, userId)))[0];
    if (!team) {
      // The squad went away while the invite was pending; settle the row so the
      // list stops offering an answer that can never be acted on.
      await db
        .update(teamInvites)
        .set({ status: REQUEST_CANCELLED, decidedAt: new Date(), decidedBy: userId })
        .where(eq(teamInvites.id, invite.id));
      return Response.json(
        { error: "That squad no longer exists 🛡️", reason: "team_gone" },
        { status: 404 }
      );
    }

    if (action === "decline") {
      await db
        .update(teamInvites)
        .set({ status: REQUEST_DECLINED, decidedAt: new Date(), decidedBy: userId })
        .where(eq(teamInvites.id, invite.id));
      await sendNotification({
        userId: invite.invitedBy,
        type: "team",
        title: `📨 ${player?.name ?? "A player"} declined your invite`,
        message: `${player?.name ?? "They"} said no thanks to ${team.name}. No harm done — you can invite someone else, or wait for a request to come to you.`,
        link: "/teams",
      });
      return Response.json({
        ok: true,
        action,
        declined: true,
        message: `You declined the invite from ${team.name}`,
      });
    }

    // Accepting is where the real checks belong, at the moment of the answer.
    if (await isMember(team.id, userId)) {
      await db
        .update(teamInvites)
        .set({ status: REQUEST_ACCEPTED, decidedAt: new Date(), decidedBy: userId })
        .where(eq(teamInvites.id, invite.id));
      return Response.json({
        ok: true,
        action,
        alreadyMember: true,
        memberAdded: false,
        message: `You're already in ${team.name} 🛡️`,
      });
    }
    const roster = await teamRoster(team.id);
    if (roster.length >= team.maxPlayers)
      return Response.json(
        {
          error: `${team.name} is full (${roster.length}/${team.maxPlayers}) — ask the captain to raise the team size, then accept again 👥`,
          reason: "squad_full",
        },
        { status: 409 }
      );

    await db.insert(teamMembers).values({ teamId: team.id, userId, role: "player" });
    await db
      .update(teamInvites)
      .set({ status: REQUEST_ACCEPTED, decidedAt: new Date(), decidedBy: userId })
      .where(eq(teamInvites.id, invite.id));
    // An accepted invite settles any join request they had filed for the same
    // squad, so the captain is never asked to approve the same player twice.
    await db
      .delete(teamRequests)
      .where(
        and(
          eq(teamRequests.teamId, team.id),
          eq(teamRequests.userId, userId),
          eq(teamRequests.status, REQUEST_PENDING)
        )
      );

    await sendNotification({
      userId: invite.invitedBy,
      type: "team",
      title: `🎉 ${player?.name ?? "A player"} said yes to ${team.name}`,
      message: `${player?.name ?? "They"} accepted your invite and is on the roster — ${
        roster.length + 1
      }/${team.maxPlayers} in the squad now. Pick them as your team when you book a court ⚽`,
      link: "/teams",
    });
    await sendNotification({
      userId,
      type: "team",
      title: `🛡️ You're in ${team.name}!`,
      message: `You accepted the invitation from ${team.name} (${
        team.teamCode ?? "no code"
      }). Choose them under "Just our gang" next time you book a court ⚽`,
      link: "/teams",
    });

    return Response.json({
      ok: true,
      action,
      memberAdded: true,
      roster: await teamRoster(team.id),
      message: `You're in ${team.name} 🎉`,
    });
  } catch (e) {
    console.error(`[/api/team-invites POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
