import { db } from "@/db";
import { teams, users, venues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import {
  validateMessage,
  validateTeamCode,
  validateTeamDescription,
  validateTitle,
} from "@/lib/validation";
import {
  isCaptain,
  isMember,
  myPendingInvite,
  myPendingRequest,
  teamCodeTaken,
  teamInviteQuota,
  teamJoinRequests,
  teamRoster,
  teamSentInvites,
  transferCaptaincy,
} from "@/lib/team-store";
import { REQUEST_PENDING, normalizeTeamCode } from "@/lib/teams";
import { teamCompetitionProfile } from "@/lib/league-store";

export const dynamic = "force-dynamic";

const LEVELS = ["Beginner", "Intermediate", "Advanced"];

/**
 * GET — one squad in full 👤
 *
 * The list endpoint answers "which squads match?"; this one answers "tell me
 * about this squad", which is what a player weighing an invitation — or a
 * stranger who found a code — actually needs: the description, the record, the
 * whole roster, and their own relationship to the team so the buttons are honest.
 *
 * The captain-only extras (the request queue, the sent invitations, today's
 * invite quota) are attached only when `viewerId` really is the captain, checked
 * server-side, so nobody can read a rival's inbox by asking nicely.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = Number(id);
    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });

    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team) return Response.json({ error: "Team not found 🛡️" }, { status: 404 });

    const viewerId = Number(new URL(req.url).searchParams.get("viewerId") ?? 0);
    const hasViewer = Number.isInteger(viewerId) && viewerId > 0;
    const leads = hasViewer && (await isCaptain(teamId, viewerId));
    const mine = hasViewer ? await isMember(teamId, viewerId) : false;

    const [roster, captainRow, request, invite, competition] = await Promise.all([
      teamRoster(teamId),
      db.select().from(users).where(eq(users.id, team.captainId)),
      hasViewer && !mine ? myPendingRequest(teamId, viewerId) : Promise.resolve(null),
      hasViewer && !mine ? myPendingInvite(teamId, viewerId) : Promise.resolve(null),
      // League & competition record 🏆 — the fixtures this squad played under a
      // host's eye, plus the competition games a venue owner scored. Public on
      // purpose: a record a squad earned is part of who they are.
      teamCompetitionProfile(teamId),
    ]);

    const wins = team.wins;
    const played = team.wins + team.losses + team.draws;
    const body: Record<string, unknown> = {
      team: {
        ...team,
        teamCode: team.teamCode ?? "",
        memberCount: roster.length,
        captainName: captainRow[0]?.name ?? "—",
        winRate: played > 0 ? Math.round((wins / played) * 100) : 0,
        gamesPlayed: played,
      },
      roster: leads
        ? roster
        // Contact details stay with the captain, as on the panel.
        : roster.map((m) => ({ ...m, email: "" })),
      competition,
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

    if (leads) {
      const [pending, answered, invites, quota] = await Promise.all([
        teamJoinRequests(teamId),
        teamJoinRequests(teamId, ""),
        teamSentInvites(teamId, ""),
        teamInviteQuota(teamId),
      ]);
      body.captain = {
        pendingRequests: pending,
        requestHistory: answered.filter((r) => r.status !== REQUEST_PENDING).slice(-8),
        invites,
        quota,
      };
    }

    return Response.json(body);
  } catch (e) {
    console.error(`[/api/teams/[id] GET] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}


/**
 * PATCH — the captain edits their squad 👑
 *
 * Every field is optional; only what is sent is changed. `newCaptainId` hands the
 * armband to another member, which is the only way captaincy moves — and the only
 * way a captain can later step away, since a team must always have exactly one.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const teamId = Number(id);
    const body = await req.json().catch(() => ({}));
    const actorId = Number(body.captainId ?? 0);

    if (!Number.isInteger(teamId) || teamId <= 0)
      return Response.json({ error: "Invalid team 🛡️" }, { status: 400 });
    if (!(await isCaptain(teamId, actorId)))
      return Response.json(
        { error: "Only the captain can edit this team 👑" },
        { status: 403 }
      );

    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team)
      return Response.json({ error: "Team not found 🛡️" }, { status: 404 });

    const patch: Partial<typeof teams.$inferInsert> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      const nErr = validateTitle(name, { min: 3, max: 50, label: "Team name" });
      if (nErr) return Response.json({ error: nErr }, { status: 400 });
      patch.name = name;
    }
    if (body.motto !== undefined) {
      const motto = String(body.motto).trim();
      const mErr = validateMessage(motto, {
        min: 3,
        max: 120,
        label: "Motto",
        required: false,
      });
      if (mErr) return Response.json({ error: mErr }, { status: 400 });
      patch.motto = motto;
    }
    if (body.description !== undefined) {
      // "About us" is optional, but never blank-by-accident: an all-whitespace
      // edit clears the description, which is a legitimate thing to want.
      const description = String(body.description).trim();
      const dErr = validateTeamDescription(description);
      if (dErr) return Response.json({ error: dErr }, { status: 400 });
      patch.description = description;
    }
    if (body.level !== undefined) {
      if (!LEVELS.includes(String(body.level)))
        return Response.json({ error: "Pick a valid level 🌱⚡🔥" }, { status: 400 });
      patch.level = String(body.level);
    }
    if (body.logoColor !== undefined) {
      const c = String(body.logoColor).trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(c))
        return Response.json({ error: "Pick a valid colour 🎨" }, { status: 400 });
      patch.logoColor = c;
    }
    if (body.lookingForPlayers !== undefined)
      patch.lookingForPlayers = Boolean(body.lookingForPlayers);

    if (body.maxPlayers !== undefined) {
      const maxPlayers = Number(body.maxPlayers);
      if (!Number.isInteger(maxPlayers) || maxPlayers < 4 || maxPlayers > 30)
        return Response.json(
          { error: "Team size must be 4–30 players 👥" },
          { status: 400 }
        );
      const rosterSize = (await teamRoster(teamId)).length;
      if (maxPlayers < rosterSize)
        return Response.json(
          {
            error: `You already have ${rosterSize} members — the limit can't be lower than that 👥`,
          },
          { status: 400 }
        );
      patch.maxPlayers = maxPlayers;
    }

    // Home turf is picked from venues on the platform, never typed free-hand.
    if (body.homeVenueId !== undefined) {
      const homeVenueId = Number(body.homeVenueId ?? 0) || 0;
      if (homeVenueId === 0) {
        patch.homeVenueId = null;
        patch.homeGround = "";
      } else {
        const venue = (
          await db.select().from(venues).where(eq(venues.id, homeVenueId))
        )[0];
        if (!venue)
          return Response.json(
            { error: "Pick a home turf from the venues on this platform 📍" },
            { status: 400 }
          );
        patch.homeVenueId = venue.id;
        patch.homeGround = venue.name;
      }
    }

    if (body.teamCode !== undefined) {
      const cErr = validateTeamCode(body.teamCode);
      if (cErr) return Response.json({ error: cErr }, { status: 400 });
      const teamCode = normalizeTeamCode(body.teamCode);
      if (teamCode !== normalizeTeamCode(team.teamCode ?? "")) {
        if (await teamCodeTaken(teamCode, teamId))
          return Response.json(
            {
              error: `Code "${teamCode}" is already taken — try another 🛡️`,
              codeError: "taken",
            },
            { status: 409 }
          );
        patch.teamCode = teamCode;
      }
    }

    const newCaptainId = Number(body.newCaptainId ?? 0);
    if (newCaptainId > 0 && newCaptainId !== team.captainId) {
      // Must already be on the roster — you can't hand a team to a stranger.
      const target = (await db.select().from(users).where(eq(users.id, newCaptainId)))[0];
      if (!target)
        return Response.json({ error: "That player doesn't exist 🔒" }, { status: 400 });
      const transferred = await transferCaptaincy(teamId, newCaptainId);
      if (!transferred)
        return Response.json(
          {
            error: `${target.name} isn't a member of your squad — add them first, then hand over the armband 👑`,
            reason: "not_a_member",
          },
          { status: 400 }
        );
      await sendNotification({
        userId: newCaptainId,
        type: "team",
        title: `👑 You captain ${transferred.name} now`,
        message: `You took over as captain of ${transferred.name} (${transferred.teamCode ?? "no code"}). You can accept join requests, add or remove members, and edit the team details.`,
        link: "/teams",
      });
      await sendNotification({
        userId: actorId,
        type: "team",
        title: `🛡️ Armband handed over`,
        message: `${target.name} is the new captain of ${transferred.name}. You're still a member — you can now step away from the team if you want.`,
        link: "/teams",
      });
    }

    if (Object.keys(patch).length === 0 && newCaptainId <= 0)
      return Response.json({ error: "Nothing to update 🛡️" }, { status: 400 });

    let updated = team;
    if (Object.keys(patch).length > 0) {
      const rows = await db
        .update(teams)
        .set(patch)
        .where(eq(teams.id, teamId))
        .returning();
      updated = rows[0] ?? team;
    } else if (newCaptainId > 0) {
      updated = (await db.select().from(teams).where(eq(teams.id, teamId)))[0] ?? team;
    }

    return Response.json({ team: updated, roster: await teamRoster(teamId) });
  } catch (e) {
    console.error(`[/api/teams/[id] PATCH] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
