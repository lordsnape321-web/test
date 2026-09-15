import { db } from "@/db";
import { bookings, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { playerRating } from "@/lib/loyalty";
import {
  isCaptain,
  isMember,
  joinRequestsFromUser,
  playerInvites,
  playerMatchActivity,
  playerReviews,
  teamInviteQuota,
  teamRoster,
  teamsForUser,
} from "@/lib/team-store";
import { canBeInvitedToTeam } from "@/lib/teams";

export const dynamic = "force-dynamic";

/**
 * GET — the public dossier of one player 👤
 *
 * Built for the decision a captain actually has to make: a join request or an
 * invitation is one line of text in a panel, so `/players/{id}` gathers what is
 * otherwise scattered across four screens — who they play as, how reliable they
 * are with a booked court, which squads they are already in, and what they ask
 * of other captains.
 *
 * Deliberately narrow on purpose:
 *   • no email, no phone, no booking details — this endpoint is readable by any
 *     signed-in account, so it returns only what a player volunteers to the
 *     community (their profile, their teams, their reviews).
 *   • the request/invite history is filtered to the *viewer's own* squads. What
 *     someone asked another captain is none of anybody else's business.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = Number(id);
    const viewerId = Number(new URL(req.url).searchParams.get("viewerId") ?? 0);
    const hasViewer = Number.isInteger(viewerId) && viewerId > 0;
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Invalid player 👤" }, { status: 400 });

    const rows = await db.select().from(users).where(eq(users.id, userId));
    const found = rows[0];
    if (!found)
      return Response.json({ error: "No such player 👤" }, { status: 404 });

    // Reliability is derived the same way the player's own profile computes it,
    // so a captain and an applicant are never looking at different numbers.
    const history = await db.select().from(bookings).where(eq(bookings.userId, userId));
    const stats = playerRating(
      history.map((b) => ({ status: b.status, createdAt: b.createdAt })),
      new Date(),
      found.trustScore
    );

    const [teams, requests, invites, reviews, matches] = await Promise.all([
      teamsForUser(userId),
      joinRequestsFromUser(userId),
      playerInvites(userId, ""),
      playerReviews(userId),
      playerMatchActivity(userId),
    ]);

    // Anything the viewer is a party to, in one queue: what this player asked of
    // a squad the viewer runs, and what that squad has asked of them.
    const myQueue: Array<{
      kind: "request" | "invite";
      id: number;
      teamId: number;
      teamName: string;
      teamCode: string;
      logoColor: string;
      message: string;
      status: string;
      createdAt: Date | null;
      decidedAt: Date | null;
    }> = [];
    const captainOptions: Array<{
      teamId: number;
      name: string;
      teamCode: string;
      logoColor: string;
      level: string;
      memberCount: number;
      maxPlayers: number;
      squadFull: boolean;
      invitesLeftToday: number;
      isMember: boolean;
      hasPendingRequest: boolean;
      hasPendingInvite: boolean;
    }> = [];

    if (hasViewer && viewerId !== userId) {
      const myTeams = await teamsForUser(viewerId);
      const ledIds = myTeams.filter((t) => t.role === "captain").map((t) => t.id);
      for (const teamId of ledIds) {
        // Double-check on the row itself: `teamsForUser` derives the role from
        // `teams.captain_id`, and this is the one place where guessing wrong
        // would hand a stranger another captain's inbox.
        if (!(await isCaptain(teamId, viewerId))) continue;
        const led = myTeams.find((t) => t.id === teamId);
        if (!led) continue;
        const teamRequestsForMe = requests.filter((r) => r.teamId === teamId);
        const teamInvitesForMe = invites.filter((i) => i.teamId === teamId);
        const roster = await teamRoster(teamId);
        const quota = await teamInviteQuota(teamId);
        const pendingRequest = teamRequestsForMe.find((r) => r.status === "pending");
        const pendingInvite = teamInvitesForMe.find((i) => i.status === "pending");
        captainOptions.push({
          teamId,
          name: led.name,
          teamCode: led.teamCode,
          logoColor: led.logoColor,
          level: led.level,
          memberCount: roster.length,
          maxPlayers: led.maxPlayers,
          squadFull: roster.length >= led.maxPlayers,
          invitesLeftToday: quota.left,
          isMember: roster.some((m) => m.userId === userId),
          hasPendingRequest: !!pendingRequest,
          hasPendingInvite: !!pendingInvite,
        });
        type QueueRow = {
          id: number;
          message: string;
          status: string;
          createdAt: Date | null;
          decidedAt: Date | null;
        };
        const push = (row: QueueRow, kind: "request" | "invite") =>
          myQueue.push({
            kind,
            id: row.id,
            teamId,
            teamName: led.name,
            teamCode: led.teamCode,
            logoColor: led.logoColor,
            message: row.message,
            status: row.status,
            createdAt: row.createdAt,
            decidedAt: row.decidedAt,
          });
        for (const r of teamRequestsForMe) push(r, "request");
        for (const i of teamInvitesForMe) push(i, "invite");
      }
      myQueue.sort(
        (a, b) =>
          (b.createdAt ?? new Date(0)).getTime() - (a.createdAt ?? new Date(0)).getTime()
      );
    }

    const isSelf = hasViewer && viewerId === userId;
    return Response.json({
      player: {
        id: found.id,
        name: found.name,
        avatarColor: found.avatarColor,
        avatarUrl: found.avatarUrl,
        role: found.role,
        level: found.level,
        position: found.position,
        defaultCity: found.defaultCity,
        matchesPlayed: found.matchesPlayed,
        trustScore: found.trustScore,
        memberSince: found.createdAt,
      },
      // Whether this account could ever be added to a squad at all: owners and
      // staff are not recruitable, and the page says so instead of offering a
      // button that would only fail.
      invitable: canBeInvitedToTeam(found.role),
      // `playerRating` also derives booking-only fields (payment method, deposit
      // rules) that a public dossier has no business showing, so the reliability
      // numbers are copied out and the rest is dropped.
      stats: {
        completed: stats.completed,
        cancelled: stats.cancelled,
        confirmed: stats.confirmed,
        pending: stats.pending,
        total: stats.total,
        rating: stats.rating,
        label: stats.label,
        emoji: stats.emoji,
        cancelsThisMonth: stats.cancelsThisMonth,
        blocked: stats.blocked,
        trustScore: stats.trustScore,
        trustLabel: stats.trustLabel,
        trustEmoji: stats.trustEmoji,
        depositRequired: stats.depositRequired,
        depositReason: stats.depositReason,
      },
      teams,
      reviews,
      matches,
      myQueue,
      captainOptions,
      viewer: hasViewer
        ? {
            id: viewerId,
            isSelf,
            // True when there is something for this viewer to decide, which is
            // what turns the "Answer" card on or off.
            hasSomethingToDecide: myQueue.some((q) => q.status === "pending"),
            leadsAnyTeam: captainOptions.length > 0,
          }
        : null,
    });
  } catch (e) {
    console.error(`[/api/players/[id] GET] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
