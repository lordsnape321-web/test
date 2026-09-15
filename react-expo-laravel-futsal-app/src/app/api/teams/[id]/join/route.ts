import { db } from "@/db";
import { teamMembers, teamRequests, teams, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import { validateJoinMessage } from "@/lib/validation";
import {
  isCaptain,
  isMember,
  joinRequestQuota,
  myPendingInvite,
  myPendingRequest,
  teamRoster,
} from "@/lib/team-store";
import {
  REOPENABLE_REQUEST_STATUSES,
  REQUEST_CANCELLED,
  REQUEST_PENDING,
  quotaExhausted,
  quotaResetsAt,
} from "@/lib/teams";

export const dynamic = "force-dynamic";

/**
 * POST — ask to join 🛡️
 *
 * Joining is no longer instant. This files a request that the captain accepts or
 * declines, which is what makes "the captain manages the team" real: the roster
 * only changes because the captain decided it should.
 *
 * The cap is the other half of the deal: a player may ask `JOIN_REQUEST_DAILY_LIMIT`
 * squads per day, which is plenty to find a team and enough to stop a bot from
 * carpet-bombing every captain on the platform with the same message.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = Number(id);
    const body = await req.json().catch(() => ({}));
    const userId = Number(body.userId);
    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Login to join a team 🔒" }, { status: 400 });

    const message = String(body.message ?? "").trim();
    const mErr = validateJoinMessage(message);
    if (mErr) return Response.json({ error: mErr }, { status: 400 });

    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team)
      return Response.json({ error: "Team not found 🛡️" }, { status: 404 });

    if (await isMember(teamId, userId))
      return Response.json(
        { ok: true, alreadyMember: true, message: "You're already in this squad 🛡️" },
        { status: 200 }
      );

    const roster = await teamRoster(teamId);
    if (roster.length >= team.maxPlayers)
      return Response.json(
        {
          error: `This squad is full (${roster.length}/${team.maxPlayers}) — the captain would need to raise the limit first 👥`,
        },
        { status: 409 }
      );

    if (await myPendingRequest(teamId, userId))
      return Response.json(
        { error: "You've already asked to join — the captain hasn't decided yet ⏳" },
        { status: 409 }
      );

    // An invitation from this very squad is a better offer than a request: the
    // captain already wants them, so the answer belongs in the invite, not in a
    // second queue the captain then has to reconcile.
    const invite = await myPendingInvite(teamId, userId);
    if (invite)
      return Response.json(
        {
          error: `${team.name} already invited you — accept the invite instead of asking 🎉`,
          reason: "invited",
          inviteId: invite.id,
        },
        { status: 409 }
      );

    const quota = await joinRequestQuota(userId);
    if (quotaExhausted(quota))
      return Response.json(
        {
          error: `That's ${quota.used} join requests today — players can ask ${quota.limit} squads a day. Your pending asks are still with their captains, and the count resets after midnight 🌙`,
          reason: "daily_limit",
          quota,
          resetsAt: quotaResetsAt(),
        },
        { status: 429 }
      );

    // A declined or withdrawn ask may be made again; reuse that row so a player's
    // history with the squad stays one row rather than piling up duplicates.
    const prior = await db
      .select()
      .from(teamRequests)
      .where(and(eq(teamRequests.teamId, teamId), eq(teamRequests.userId, userId)));
    const reopen = prior.find((r) => REOPENABLE_REQUEST_STATUSES.includes(r.status));
    if (reopen) {
      await db
        .update(teamRequests)
        .set({
          status: REQUEST_PENDING,
          message,
          createdAt: new Date(),
          decidedAt: null,
          decidedBy: null,
        })
        .where(eq(teamRequests.id, reopen.id));
    } else {
      await db
        .insert(teamRequests)
        .values({ teamId, userId, message, status: REQUEST_PENDING });
    }

    const requester = (await db.select().from(users).where(eq(users.id, userId)))[0];
    if (team.captainId && team.captainId !== userId) {
      await sendNotification({
        userId: team.captainId,
        type: "team",
        title: `🛡️ ${requester?.name ?? "A player"} asked to join ${team.name}`,
        message: `${requester?.name ?? "A player"} (${requester?.level ?? "—"} • ${requester?.position ?? "—"}) wants to join${message ? ` — "${message}"` : ""}. Accept or decline from your team panel.`,
        link: "/teams",
      });
    }

    return Response.json(
      {
        ok: true,
        status: REQUEST_PENDING,
        message: `Request sent — ${team.name}'s captain will review it 🛡️`,
        // So the page can update "2 of 5 asks left today" without another fetch.
        quota: { ...quota, used: quota.used + 1, left: Math.max(0, quota.left - 1) },
      },
      { status: 201 }
    );
  } catch (e) {
    console.error(`[/api/teams/[id]/join POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * DELETE — leave the squad, or withdraw a pending request.
 *
 * A captain cannot leave: a team always has exactly one captain, so they must
 * hand the armband to another member first (PATCH /api/teams/[id] with
 * `newCaptainId`). That invariant is the whole point of the rule.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = Number(id);
    const { searchParams } = new URL(req.url);
    const userId = Number(searchParams.get("userId"));
    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Login required 🔒" }, { status: 400 });

    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team)
      return Response.json({ error: "Team not found 🛡️" }, { status: 404 });

    if (await isMember(teamId, userId)) {
      if (await isCaptain(teamId, userId)) {
        const others = (await teamRoster(teamId)).filter((m) => m.userId !== userId);
        return Response.json(
          {
            error:
              others.length > 0
                ? `You're the captain of ${team.name} 👑 — hand the armband to another member first, then you can step away. A team always has exactly one captain.`
                : `You're the captain and only member of ${team.name} 👑 — a team always has exactly one captain, so there's nobody to hand it to yet.`,
            reason: "captain_must_transfer",
          },
          { status: 409 }
        );
      }
      const rows = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
      for (const r of rows) {
        await db.delete(teamMembers).where(eq(teamMembers.id, r.id));
      }
      // Clear any stale requests too, so re-joining later starts clean.
      await db
        .delete(teamRequests)
        .where(
          and(
            eq(teamRequests.teamId, teamId),
            eq(teamRequests.userId, userId),
            eq(teamRequests.status, REQUEST_PENDING)
          )
        );
      return Response.json({ ok: true, left: true });
    }

    const pending = await myPendingRequest(teamId, userId);
    if (pending) {
      await db
        .update(teamRequests)
        .set({ status: REQUEST_CANCELLED, decidedAt: new Date(), decidedBy: userId })
        .where(eq(teamRequests.id, pending.id));
      return Response.json({ ok: true, cancelled: true });
    }

    return Response.json(
      { error: "You're not in this team and have no pending request 🛡️" },
      { status: 404 }
    );
  } catch (e) {
    console.error(`[/api/teams/[id]/join DELETE] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
