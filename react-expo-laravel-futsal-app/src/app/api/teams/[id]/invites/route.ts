import { db } from "@/db";
import { teamInvites, teamRequests, teams, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import {
  findInvite,
  isCaptain,
  isMember,
  myPendingInvite,
  reopenableInvite,
  teamInviteQuota,
  teamRoster,
  teamSentInvites,
} from "@/lib/team-store";
import {
  REQUEST_CANCELLED,
  REQUEST_PENDING,
  canBeInvitedToTeam,
  invitableRoleError,
  quotaExhausted,
  quotaResetsAt,
} from "@/lib/teams";
import { validateInviteMessage } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * GET — the invites this squad has sent 👑
 *
 * Captain-gated, like the join-request queue: a player's answer is theirs to
 * make, and nobody else gets to watch it pending. `?status=all` includes the
 * answered ones so the panel can show history, and the daily quota rides along
 * because the panel has to say "2 of 5 left" without a second round trip.
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
      return Response.json({ invites: [], error: "Invalid team 🛡️" }, { status: 400 });
    if (!(await isCaptain(teamId, captainId)))
      return Response.json(
        { invites: [], error: "Only the captain can see sent invites 👑" },
        { status: 403 }
      );

    const raw = searchParams.get("status");
    const status = raw === "all" || raw === "" ? "" : (raw ?? REQUEST_PENDING);
    const [invites, quota] = await Promise.all([
      teamSentInvites(teamId, status),
      teamInviteQuota(teamId),
    ]);
    return Response.json({ invites, quota });
  } catch (e) {
    console.error(`[/api/teams/[id]/invites GET] failed:`, e);
    return Response.json({ invites: [], error: String(e) }, { status: 500 });
  }
}

/**
 * POST — invite a player 📨
 *
 * This replaces the old "captain adds a player" write. Nothing lands on the
 * roster here: a `team_invites` row is filed and the *player* decides, which is
 * the other half of the consent rule the join-request queue already enforced.
 * `TEAM_INVITE_DAILY_LIMIT` invitations per calendar day keep the panel a
 * recruiting tool rather than a cold-inbox machine.
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
    const message = String(body.message ?? "").trim();

    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Pick a player to invite 👥" }, { status: 400 });
    const mErr = validateInviteMessage(message);
    if (mErr) return Response.json({ error: mErr }, { status: 400 });
    if (!(await isCaptain(teamId, captainId)))
      return Response.json(
        { error: "Only the captain can invite players 👑" },
        { status: 403 }
      );

    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team)
      return Response.json({ error: "Team not found 🛡️" }, { status: 404 });

    const person = (await db.select().from(users).where(eq(users.id, userId)))[0];
    if (!person)
      return Response.json({ error: "That player doesn't exist 🔒" }, { status: 404 });

    // Server-side, not just a filtered list: a squad is made of players, and the
    // owner/admin accounts on this platform have a different job.
    if (!canBeInvitedToTeam(person.role))
      return Response.json(
        {
          error: invitableRoleError(person.role, person.name),
          reason: "not_invitable",
        },
        { status: 403 }
      );

    if (await isMember(teamId, userId))
      return Response.json(
        {
          ok: true,
          alreadyMember: true,
          message: `${person.name} is already in the squad 🛡️`,
        },
        { status: 200 }
      );

    const roster = await teamRoster(teamId);
    if (roster.length >= team.maxPlayers)
      return Response.json(
        {
          error: `Your squad is full (${roster.length}/${team.maxPlayers}) — raise the team size before inviting 👥`,
          reason: "squad_full",
        },
        { status: 409 }
      );

    // They already asked to join: the captain should answer that, not double up.
    const asked = (
      await db
        .select()
        .from(teamRequests)
        .where(
          and(
            eq(teamRequests.teamId, teamId),
            eq(teamRequests.userId, userId),
            eq(teamRequests.status, REQUEST_PENDING)
          )
        )
    )[0];
    if (asked)
      return Response.json(
        {
          error: `${person.name} already asked to join — accept or decline it in your join requests instead of inviting 🛡️`,
          reason: "already_requested",
          requestId: asked.id,
        },
        { status: 409 }
      );

    if (await myPendingInvite(teamId, userId))
      return Response.json(
        {
          ok: true,
          alreadyInvited: true,
          message: `${person.name} already has an invite waiting — give them a moment to answer ⏳`,
          quota: await teamInviteQuota(teamId),
        },
        { status: 200 }
      );

    const quota = await teamInviteQuota(teamId);
    if (quotaExhausted(quota))
      return Response.json(
        {
          error: `That's ${quota.used} invites for ${team.name} today — the limit is ${quota.limit} a day. Try again after midnight 🌙`,
          reason: "daily_limit",
          quota,
          resetsAt: quotaResetsAt(),
        },
        { status: 429 }
      );

    const reopen = await reopenableInvite(teamId, userId);
    if (reopen) {
      await db
        .update(teamInvites)
        .set({
          status: REQUEST_PENDING,
          message,
          invitedBy: captainId,
          createdAt: new Date(),
          decidedAt: null,
          decidedBy: null,
        })
        .where(eq(teamInvites.id, reopen.id));
    } else {
      await db
        .insert(teamInvites)
        .values({ teamId, userId, invitedBy: captainId, message, status: REQUEST_PENDING });
    }

    await sendNotification({
      userId,
      type: "team",
      title: `📨 ${team.name} invited you`,
      message: `You're wanted in ${team.name} (${team.teamCode ?? "no code"})${
        team.homeGround ? ` at ${team.homeGround}` : ""
      }. ${
        message ? `They wrote: "${message}". ` : ""
      }Accept to join the squad, or decline — nothing changes until you answer.`,
      // The squad's own page: full description, the record and every name already
      // in it, which is what makes an invitation answerable.
      link: `/teams/${teamId}`,
    });

    return Response.json(
      {
        ok: true,
        invited: true,
        message: `Invite sent to ${person.name} — they'll decide 📨`,
        quota: { ...quota, used: quota.used + 1, left: Math.max(0, quota.left - 1) },
      },
      { status: 201 }
    );
  } catch (e) {
    console.error(`[/api/teams/[id]/invites POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * DELETE — take an invitation back.
 *
 * Only a pending invite can be withdrawn, and only by the captain who owns the
 * squad. It is recorded as `cancelled` rather than deleted so the player's
 * history with the squad stays one honest row.
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
    const inviteId = Number(searchParams.get("inviteId") ?? 0);
    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });
    if (!Number.isInteger(inviteId) || inviteId <= 0)
      return Response.json({ error: "Invalid invite 📨" }, { status: 400 });
    if (!(await isCaptain(teamId, captainId)))
      return Response.json(
        { error: "Only the captain can withdraw an invite 👑" },
        { status: 403 }
      );

    const invite = await findInvite(inviteId);
    if (!invite || invite.teamId !== teamId)
      return Response.json({ error: "That invite no longer exists 📨" }, { status: 404 });
    if (invite.status !== REQUEST_PENDING)
      return Response.json(
        { error: `That invite was already ${invite.status} ⏳` },
        { status: 409 }
      );

    await db
      .update(teamInvites)
      .set({
        status: REQUEST_CANCELLED,
        decidedAt: new Date(),
        decidedBy: captainId,
      })
      .where(eq(teamInvites.id, inviteId));

    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    await sendNotification({
      userId: invite.userId,
      type: "team",
      title: `📨 Invite from ${team?.name ?? "a team"} was withdrawn`,
      message: `The captain took back the invitation to ${
        team?.name ?? "the squad"
      }. If you still want in, ask to join from the Teams page.`,
      link: teamId ? `/teams/${teamId}` : "/teams",
    });

    return Response.json({
      ok: true,
      cancelled: true,
      invites: await teamSentInvites(teamId),
      quota: await teamInviteQuota(teamId),
    });
  } catch (e) {
    console.error(`[/api/teams/[id]/invites DELETE] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
