import { db } from "@/db";
import {
  teamMembers,
  teams,
  tournamentMatches,
  tournamentPayments,
  tournamentTeams,
  tournaments,
  users,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import {
  TEAM_APPROVED,
  TEAM_CLOSED_STATUSES,
  TEAM_INVITED,
  TEAM_PENDING_STATUSES,
  TEAM_REJECTED,
  TEAM_REQUESTED,
  TEAM_WITHDRAWN,
  approvalCheck,
  depositFor,
  paymentState,
  refundFor,
} from "@/lib/league";
import { canBeInvitedToTeam } from "@/lib/teams";
import { leagueAccess, recalcTeamTotals } from "@/lib/league-store";
import { formatNPR } from "@/lib/futsal";
import { validateInviteMessage } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/tournaments/[id]/teams — who is in, and who is knocking 🚪
 *
 * Everybody in a public league can see the squads that are *in* — that's the
 * point of a league. Only the host sees the queue of requests and invitations
 * still open, because a squad asking to join hasn't agreed to anything yet.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leagueId = Number(id);
    if (!Number.isInteger(leagueId) || leagueId <= 0)
      return Response.json({ teams: [], error: "Invalid league 🛡️" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const userId = Number(searchParams.get("userId") ?? 0) || 0;
    const access = await leagueAccess(leagueId, userId);
    if (!access)
      return Response.json({ teams: [], error: "That league no longer exists 🛡️" }, { status: 404 });

    const allTeams = await db.select().from(teams);
    const allUsers = await db.select().from(users);
    const members = await db.select().from(teamMembers);

    const rows = access.rows
      .filter((r) => access.isHost || r.status === TEAM_APPROVED)
      .map((r) => {
        const team = allTeams.find((t) => t.id === r.teamId);
        return {
          teamId: r.teamId,
          name: team?.name ?? "Removed squad",
          teamCode: team?.teamCode ?? "",
          logoColor: team?.logoColor ?? "#16a34a",
          level: team?.level ?? "Intermediate",
          homeGround: team?.homeGround ?? "",
          captainId: team?.captainId ?? 0,
          captainName: allUsers.find((u) => u.id === team?.captainId)?.name ?? "",
          memberCount: members.filter((m) => m.teamId === r.teamId).length,
          status: r.status,
          message: r.message,
          paidAmount: r.paidAmount,
          refundedAmount: r.refundedAmount,
          payment: paymentState({
            entryFee: access.tournament.entryFee,
            paidAmount: r.paidAmount,
            refundedAmount: r.refundedAmount,
            depositPercent: access.tournament.depositPercent,
            refundPercent: access.tournament.refundPercent,
          }),
          createdAt: r.createdAt,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return Response.json({
      teams: rows,
      meta: {
        entryFee: access.tournament.entryFee,
        deposit: depositFor(access.tournament.entryFee, access.tournament.depositPercent),
        approved: rows.filter((r) => r.status === TEAM_APPROVED).length,
        maxTeams: access.tournament.maxTeams,
        isHost: access.isHost,
        visibility: access.tournament.visibility,
      },
    });
  } catch (e) {
    console.error(`[/api/tournaments/[id]/teams GET] failed:`, e);
    return Response.json({ teams: [], error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/tournaments/[id]/teams — the entry desk 🛡️
 *
 * Five actions, one per real conversation that happens between a host and a
 * captain:
 *
 * - `request`  — a captain asks to join a public league.
 * - `invite`   — the host asks a squad (the only door into a private league).
 * - `approve`  — the host lets a squad in. Gated on the deposit: a place in the
 *                league is held by money, not by a promise.
 * - `reject`   — the host says no, with the squad free to ask again later.
 * - `withdraw` — a squad (captain) or the host pulls out. 10% of what was paid
 *                goes back, the rest stays with the league — recorded in the
 *                ledger so the host's books still add up.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leagueId = Number(id);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (!Number.isInteger(leagueId) || leagueId <= 0)
      return Response.json({ error: "Invalid league 🛡️" }, { status: 400 });

    const league = (await db.select().from(tournaments).where(eq(tournaments.id, leagueId)))[0];
    if (!league) return Response.json({ error: "That league no longer exists 🛡️" }, { status: 404 });

    const teamId = Number(body.teamId);
    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team) return Response.json({ error: "Pick a squad first 🛡️" }, { status: 404 });

    const entries = await db
      .select()
      .from(tournamentTeams)
      .where(eq(tournamentTeams.tournamentId, leagueId));
    const row = entries.find((r) => r.teamId === teamId) ?? null;
    const approvedCount = entries.filter((r) => r.status === TEAM_APPROVED).length;
    const host = (await db.select().from(users).where(eq(users.id, league.hostId)))[0];
    const captain = (await db.select().from(users).where(eq(users.id, team.captainId)))[0];
    const hostLink = `/leagues/${leagueId}`;

    /* ---------------------------------------------------------- request */
    if (action === "request") {
      const userId = Number(body.userId);
      if (!userId || team.captainId !== userId)
        return Response.json(
          { error: "Only the captain can enter the squad 🛡️" },
          { status: 403 }
        );
      if (league.visibility === "private")
        return Response.json(
          {
            error:
              "This league is private — the host invites squads directly. Ask them for an invite and the door opens. 🔒",
          },
          { status: 403 }
        );
      if (league.status === "completed" || league.status === "cancelled")
        return Response.json(
          { error: `This league is ${league.status} — entries are closed 🏁` },
          { status: 409 }
        );
      if (row && TEAM_PENDING_STATUSES.includes(row.status as never))
        return Response.json(
          { error: `You've already asked to join ${league.name} — hang tight ⏳` },
          { status: 409 }
        );
      if (row && row.status === TEAM_APPROVED)
        return Response.json({ error: `${team.name} is already in this league ✅` }, { status: 409 });
      if (approvedCount >= league.maxTeams)
        return Response.json(
          { error: `The league is full (${approvedCount}/${league.maxTeams}) 👥 — ask the host to open more spots.` },
          { status: 409 }
        );

      const msgErr = validateInviteMessage(body.message);
      if (msgErr) return Response.json({ error: msgErr }, { status: 400 });

      await upsertEntry(leagueId, teamId, {
        status: TEAM_REQUESTED,
        requestedBy: userId,
        message: String(body.message ?? "").trim(),
        decidedBy: null,
        decidedAt: null,
      });

      await sendNotification({
        userId: league.hostId,
        type: "league",
        title: `🛡️ ${team.name} wants in — ${league.name}`,
        message: `${captain?.name ?? "The captain"} asked to join with ${team.name}. Open the league page to approve or decline — remember a place is held once the ${formatNPR(depositFor(league.entryFee, league.depositPercent))} deposit is in.`,
        link: hostLink,
      });

      return Response.json({
        ok: true,
        message: `Request sent to ${host?.name ?? "the host"} — you'll hear back soon 📨`,
      });
    }

    /* ----------------------------------------------------------- invite */
    if (action === "invite") {
      const hostId = Number(body.hostId);
      if (league.hostId !== hostId)
        return Response.json({ error: "Only the host can invite squads 👑" }, { status: 403 });
      if (league.status === "completed" || league.status === "cancelled")
        return Response.json({ error: "This league is over — no more invites 🏁" }, { status: 409 });
      if (!canBeInvitedToTeam(captain?.role ?? "player"))
        return Response.json(
          { error: "That captain runs a venue account — only player squads can enter a league 🏟️" },
          { status: 403 }
        );
      if (row && (row.status === TEAM_APPROVED || TEAM_PENDING_STATUSES.includes(row.status as never)))
        return Response.json(
          { error: `${team.name} is already ${row.status} in this league 📋` },
          { status: 409 }
        );
      if (approvedCount >= league.maxTeams)
        return Response.json(
          { error: `All ${league.maxTeams} spots are taken — widen the league first 👥` },
          { status: 409 }
        );

      const msgErr = validateInviteMessage(body.message);
      if (msgErr) return Response.json({ error: msgErr }, { status: 400 });

      await upsertEntry(leagueId, teamId, {
        status: TEAM_INVITED,
        requestedBy: hostId,
        message: String(body.message ?? "").trim(),
        decidedBy: null,
        decidedAt: null,
      });

      await sendNotification({
        userId: team.captainId,
        type: "league",
        title: `🏆 ${league.name} invited ${team.name}!`,
        message: `${host?.name ?? "The host"} invited you to a ${league.format} league at ${league.entryFee > 0 ? `Rs. ${league.entryFee} per squad` : "no entry fee"}. A place is locked when the deposit is paid — open the league to see the details.${body.message ? ` "${String(body.message).trim()}"` : ""}`,
        link: hostLink,
      });

      return Response.json({ ok: true, message: `Invite sent to ${team.name} 📨` });
    }

    /* ---------------------------------------------------------- approve */
    if (action === "approve") {
      const hostId = Number(body.hostId);
      if (league.hostId !== hostId)
        return Response.json({ error: "Only the host decides entries 👑" }, { status: 403 });
      if (!row) return Response.json({ error: "That squad hasn't asked to join 🛡️" }, { status: 404 });
      if (row.status === TEAM_APPROVED)
        return Response.json({ error: `${team.name} is already in ✅` }, { status: 409 });
      if (!TEAM_PENDING_STATUSES.includes(row.status as never))
        return Response.json({ error: "That entry is closed — invite them again 📨" }, { status: 409 });
      if (approvedCount >= league.maxTeams)
        return Response.json(
          { error: `The league is full (${approvedCount}/${league.maxTeams}) — widen it or decline someone 👥` },
          { status: 409 }
        );

      const gate = approvalCheck({
        entryFee: league.entryFee,
        paidAmount: row.paidAmount,
        depositPercent: league.depositPercent,
      });
      if (!gate.ok) return Response.json({ error: gate.reason, reason: "deposit_due" }, { status: 402 });

      await db
        .update(tournamentTeams)
        .set({ status: TEAM_APPROVED, decidedBy: hostId, decidedAt: new Date(), updatedAt: new Date() })
        .where(eq(tournamentTeams.id, row.id));

      await sendNotification({
        userId: team.captainId,
        type: "league",
        title: `🎉 ${team.name} is in ${league.name}!`,
        message: `${host?.name ?? "The host"} approved your entry. ${paymentState({ entryFee: league.entryFee, paidAmount: row.paidAmount, depositPercent: league.depositPercent }).due > 0 ? `Rs. ${paymentState({ entryFee: league.entryFee, paidAmount: row.paidAmount, depositPercent: league.depositPercent }).due} of the entry fee is still open — settle it when you can.` : "Entry fee settled — good luck!"} Fixtures and photos will show up on the league page.`,
        link: hostLink,
      });

      return Response.json({
        ok: true,
        message: `${team.name} is in the league 🎉`,
      });
    }

    /* ----------------------------------------------------------- reject */
    if (action === "reject") {
      const hostId = Number(body.hostId);
      if (league.hostId !== hostId)
        return Response.json({ error: "Only the host decides entries 👑" }, { status: 403 });
      if (!row) return Response.json({ error: "That squad hasn't asked to join 🛡️" }, { status: 404 });

      await db
        .update(tournamentTeams)
        .set({ status: TEAM_REJECTED, decidedBy: hostId, decidedAt: new Date(), updatedAt: new Date() })
        .where(eq(tournamentTeams.id, row.id));

      await sendNotification({
        userId: team.captainId,
        type: "league",
        title: `🚫 ${league.name} couldn't take ${team.name}`,
        message: `${host?.name ?? "The host"} declined the entry. Nothing is charged, and you're welcome to ask again if a spot opens up.`,
        link: hostLink,
      });

      return Response.json({ ok: true, message: `${team.name}'s request was declined 🚫` });
    }

    /* --------------------------------------------------------- withdraw */
    if (action === "withdraw") {
      const userId = Number(body.userId);
      const isHost = league.hostId === userId;
      const isCaptain = team.captainId === userId;
      if (!isHost && !isCaptain)
        return Response.json(
          { error: "Only the squad's captain or the host can withdraw an entry 🚪" },
          { status: 403 }
        );
      if (!row) return Response.json({ error: "That squad isn't in this league 🛡️" }, { status: 404 });
      if (row.status === TEAM_WITHDRAWN)
        return Response.json({ error: `${team.name} already withdrew 🏳️` }, { status: 409 });

      const refund = refundFor(row.paidAmount, league.refundPercent);
      if (refund > 0) {
        await db.insert(tournamentPayments).values({
          tournamentId: leagueId,
          teamId,
          userId: team.captainId,
          kind: "refund",
          amount: refund,
          method: "Host refund",
          reference: `${league.refundPercent}% back on withdrawal`,
          recordedBy: userId,
        });
      }
      await db
        .update(tournamentTeams)
        .set({
          status: TEAM_WITHDRAWN,
          decidedBy: userId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tournamentTeams.id, row.id));
      await recalcTeamTotals(leagueId, teamId);
      // A withdrawn squad's fixtures become history: drop the ones still to
      // be played so the table isn't left with games nobody will turn up for.
      const upcoming = await db
        .select()
        .from(tournamentMatches)
        .where(
          and(
            eq(tournamentMatches.tournamentId, leagueId),
            eq(tournamentMatches.status, "scheduled")
          )
        );
      for (const m of upcoming) {
        if (m.homeTeamId === teamId || m.awayTeamId === teamId) {
          await db
            .update(tournamentMatches)
            .set({ status: "void", notes: `${team.name} withdrew`, updatedBy: userId })
            .where(eq(tournamentMatches.id, m.id));
        }
      }

      const kept = Math.max(0, row.paidAmount - refund);
      await sendNotification({
        userId: league.hostId,
        type: "league",
        title: `🏳️ ${team.name} withdrew — ${league.name}`,
        message: `${isHost ? "You" : captain?.name ?? "The captain"} pulled ${team.name} out.${row.paidAmount > 0 ? ` ${formatNPR(refund)} returned (${league.refundPercent}% of ${formatNPR(row.paidAmount)}); ${formatNPR(kept)} stays with the league.` : ""} Their unplayed fixtures are voided.`,
        link: hostLink,
      });
      await sendNotification({
        userId: team.captainId,
        type: "league",
        title: `🏳️ ${team.name} is out of ${league.name}`,
        message: row.paidAmount > 0
          ? `${formatNPR(refund)} of the ${formatNPR(row.paidAmount)} you paid comes back — the rest is the league's, per the terms you agreed to when joining.`
          : "You're out of the league. Nothing to refund.",
        link: hostLink,
      });

      return Response.json({
        ok: true,
        refund,
        message:
          refund > 0
            ? `Withdrawn — ${formatNPR(refund)} refunded (${league.refundPercent}% of what was paid) ↩️`
            : "Withdrawn from the league 🏳️",
      });
    }

    /* -------------------------------------------------------------- nope */
    return Response.json(
      { error: "Unknown action — try request, invite, approve, reject or withdraw 🛡️" },
      { status: 400 }
    );
  } catch (e) {
    console.error(`[/api/tournaments/[id]/teams POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/** One squad, one league, one row — re-asking reopens it instead of duplicating. */
async function upsertEntry(
  tournamentId: number,
  teamId: number,
  values: {
    status: string;
    requestedBy: number;
    message: string;
    decidedBy: number | null;
    decidedAt: Date | null;
  }
) {
  const existing = (
    await db
      .select()
      .from(tournamentTeams)
      .where(
        and(eq(tournamentTeams.tournamentId, tournamentId), eq(tournamentTeams.teamId, teamId))
      )
  )[0];

  if (!existing) {
    await db.insert(tournamentTeams).values({ tournamentId, teamId, ...values });
    return;
  }
  // A squad that was declined may ask again; a withdrawn squad may come back.
  if (TEAM_CLOSED_STATUSES.includes(existing.status as never) || existing.status === TEAM_WITHDRAWN) {
    await db
      .update(tournamentTeams)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(tournamentTeams.id, existing.id));
  }
}
