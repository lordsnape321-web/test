import { db } from "@/db";
import { bookings, tournamentMatches, tournaments, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import { recordFor, standingsFor } from "@/lib/league";
import { formatTime12, prettyDate } from "@/lib/futsal";
import { approvedSquads, leagueAccess } from "@/lib/league-store";
import {
  firstError,
  validateDateISO,
  validateRound,
  validateScore,
  validateTimeHM,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

export type FixturePayload = {
  id: number;
  round: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  date: string;
  startTime: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  bookingId: number | null;
  notes: string;
};

/**
 * GET /api/tournaments/[id]/matches — fixtures, results and the table ⚽
 *
 * Only squads in the league (and the host) may read the fixture list of a
 * private league; in a public one the calendar is part of the pitch, so anyone
 * can look. Scores are what the squad's own profile counts, which is why this
 * route also hands back the freshly computed standings — one source, two views.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leagueId = Number(id);
    if (!Number.isInteger(leagueId) || leagueId <= 0)
      return Response.json({ matches: [], error: "Invalid league 🛡️" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const userId = Number(searchParams.get("userId") ?? 0) || 0;
    const access = await leagueAccess(leagueId, userId);
    if (!access)
      return Response.json({ matches: [], error: "That league no longer exists 🛡️" }, { status: 404 });

    const visible = access.isHost || access.canSeeInside || access.tournament.visibility === "public";
    if (!visible) return Response.json({ matches: [], locked: true });

    const squads = await approvedSquads(leagueId);
    const rows = await db
      .select()
      .from(tournamentMatches)
      .where(eq(tournamentMatches.tournamentId, leagueId));
    const nameOf = (id2: number) => squads.find((s) => s.teamId === id2)?.name ?? "Squad";

    const matches: FixturePayload[] = rows
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id)
      .map((m) => ({
        id: m.id,
        round: m.round,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        homeTeamName: nameOf(m.homeTeamId),
        awayTeamName: nameOf(m.awayTeamId),
        date: m.date,
        startTime: m.startTime,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        status: m.status,
        bookingId: m.bookingId,
        notes: m.notes,
      }));

    return Response.json({
      matches,
      standings: standingsFor(
        squads.map((s) => ({ teamId: s.teamId, name: s.name, logoColor: s.logoColor, teamCode: s.teamCode })),
        matches
      ),
      isHost: access.isHost,
      canManage: access.isHost,
    });
  } catch (e) {
    console.error(`[/api/tournaments/[id]/matches GET] failed:`, e);
    return Response.json({ matches: [], error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/tournaments/[id]/matches — the host's fixture book 📖
 *
 * - `create`   — one fixture between two squads of this league.
 * - `generate` — a single round robin for every squad in it. A league where
 *                every team plays every other is the format captains expect,
 *                and typing it out by hand is where hosts give up, so the
 *                button does the arithmetic (n × (n−1) ÷ 2 games).
 * - `score`    — record a result. The scores are the league's truth: they move
 *                the table *and* land on each squad's profile as its record.
 * - `delete`   — remove a fixture that was never played.
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
    const hostId = Number(body.hostId);

    if (!Number.isInteger(leagueId) || leagueId <= 0)
      return Response.json({ error: "Invalid league 🛡️" }, { status: 400 });

    const league = (await db.select().from(tournaments).where(eq(tournaments.id, leagueId)))[0];
    if (!league) return Response.json({ error: "That league no longer exists 🛡️" }, { status: 404 });
    if (league.hostId !== hostId)
      return Response.json(
        { error: "Only the host keeps the fixture book 👑" },
        { status: 403 }
      );

    const squads = await approvedSquads(leagueId);
    const squadIds = new Set(squads.map((s) => s.teamId));
    const hostLink = `/leagues/${leagueId}`;
    const host = (await db.select().from(users).where(eq(users.id, hostId)))[0];
    /**
     * A league stops being "taking entries" the moment it has a fixture on the
     * board — same flip the round-robin draw makes, so the badge on the board
     * never says "entries open" over a fixture that already kicked off.
     */
    const markOngoing = async () => {
      if (league.status !== "registration") return;
      await db
        .update(tournaments)
        .set({ status: "ongoing" })
        .where(eq(tournaments.id, leagueId));
    };

    /* ----------------------------------------------------------- create */
    if (action === "create" || action === "generate") {
      if (squads.length < 2)
        return Response.json(
          { error: "Two squads have to be in before there's anything to play 👥" },
          { status: 409 }
        );

      if (action === "generate") {
        const existing = await db
          .select()
          .from(tournamentMatches)
          .where(eq(tournamentMatches.tournamentId, leagueId));
        const seen = new Set(
          existing.map((m) => [m.homeTeamId, m.awayTeamId].sort((a, b) => a - b).join("-"))
        );
        let created = 0;
        for (let i = 0; i < squads.length; i++) {
          for (let j = i + 1; j < squads.length; j++) {
            const key = [squads[i].teamId, squads[j].teamId].sort((a, b) => a - b).join("-");
            if (seen.has(key)) continue;
            await db.insert(tournamentMatches).values({
              tournamentId: leagueId,
              round: "League",
              homeTeamId: squads[i].teamId,
              awayTeamId: squads[j].teamId,
              date: "",
              startTime: "",
            });
            created += 1;
          }
        }
        await db
          .update(tournaments)
          .set({ status: league.status === "registration" ? "ongoing" : league.status })
          .where(eq(tournaments.id, leagueId));
        for (const s of squads) {
          await sendNotification({
            userId: s.captainId,
            type: "league",
            title: `📅 Fixture list is out — ${league.name}`,
            message: `${created} round-robin ${created === 1 ? "game" : "games"} were drawn up. Open the league page to see who you play and when.`,
            link: hostLink,
          });
        }
        return Response.json({
          ok: true,
          created,
          message: created > 0 ? `${created} fixtures drawn 🗓️` : "Every pairing already exists ✅",
        });
      }

      const homeTeamId = Number(body.homeTeamId);
      const awayTeamId = Number(body.awayTeamId);
      if (!squadIds.has(homeTeamId) || !squadIds.has(awayTeamId))
        return Response.json(
          { error: "Both squads have to be in this league 🛡️" },
          { status: 400 }
        );
      if (homeTeamId === awayTeamId)
        return Response.json({ error: "A squad can't play itself 🙂" }, { status: 400 });

      const round = String(body.round ?? "League").trim() || "League";
      const date = String(body.date ?? "").trim();
      const startTime = String(body.startTime ?? "").trim();
      const notes = String(body.notes ?? "").trim().slice(0, 300);
      const err = firstError(
        validateRound(round),
        date ? validateDateISO(date, { label: "Fixture date", allowPast: true }) : null,
        startTime ? validateTimeHM(startTime, "Kick-off time") : null
      );
      if (err) return Response.json({ error: err }, { status: 400 });

      const rows = await db
        .insert(tournamentMatches)
        .values({
          tournamentId: leagueId,
          round,
          homeTeamId,
          awayTeamId,
          date,
          startTime,
          courtId: Number(body.courtId) || league.courtId || null,
          notes,
          updatedBy: hostId,
        })
        .returning();

      const when = date ? `${prettyDate(date)}${startTime ? ` at ${formatTime12(startTime)}` : ""}` : "a date to be confirmed";
      const homeName = squads.find((s) => s.teamId === homeTeamId)?.name ?? "Home";
      const awayName = squads.find((s) => s.teamId === awayTeamId)?.name ?? "Away";
      for (const teamId of [homeTeamId, awayTeamId]) {
        const captainId = squads.find((s) => s.teamId === teamId)?.captainId ?? 0;
        await sendNotification({
          userId: captainId,
          type: "league",
          title: `📅 New fixture — ${league.name}`,
          message: `${homeName} vs ${awayName} • ${when}. Turn up, play hard, and the host will record the result.`,
          link: hostLink,
        });
      }

      await markOngoing();
      return Response.json({ ok: true, match: rows[0], message: "Fixture added 📅" });
    }

    /* ------------------------------------------------------------ score */
    if (action === "score") {
      const matchId = Number(body.matchId);
      const match = (
        await db.select().from(tournamentMatches).where(eq(tournamentMatches.id, matchId))
      )[0];
      if (!match || match.tournamentId !== leagueId)
        return Response.json({ error: "That fixture isn't in this league 🛡️" }, { status: 404 });

      // "" and null both mean "clear the score" — neither may become a 0.
      const blank = (v: unknown) => v === "" || v === null || v === undefined;
      const homeScore = blank(body.homeScore) ? null : Number(body.homeScore);
      const awayScore = blank(body.awayScore) ? null : Number(body.awayScore);
      const err = firstError(
        validateScore(homeScore, `${squads.find((s) => s.teamId === match.homeTeamId)?.name ?? "Home"} score`),
        validateScore(awayScore, `${squads.find((s) => s.teamId === match.awayTeamId)?.name ?? "Away"} score`)
      );
      if (err) return Response.json({ error: err }, { status: 400 });
      if ((homeScore === null) !== (awayScore === null))
        return Response.json(
          { error: "Both scores or neither — a 3–? result isn't a result 🙂" },
          { status: 400 }
        );

      const played = homeScore !== null && awayScore !== null;
      await db
        .update(tournamentMatches)
        .set({
          homeScore,
          awayScore,
          status: played ? "played" : "scheduled",
          notes: body.notes === undefined ? match.notes : String(body.notes).slice(0, 300),
          updatedBy: hostId,
          updatedAt: new Date(),
        })
        .where(eq(tournamentMatches.id, matchId));

      // A fixture linked to a booking keeps the two in step, so the venue's
      // booking list and the league's table never show different results.
      if (match.bookingId && played) {
        await db
          .update(bookings)
          .set({
            homeScore,
            awayScore,
            scoreStatus: "recorded",
            scoreUpdatedBy: hostId,
            scoreUpdatedAt: new Date(),
          })
          .where(eq(bookings.id, match.bookingId));
      }
      if (played) {
        await markOngoing();
        const all = await db
          .select()
          .from(tournamentMatches)
          .where(eq(tournamentMatches.tournamentId, leagueId));
        const likes = all.map((m) => ({
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          status: m.status,
        }));
        const homeName = squads.find((s) => s.teamId === match.homeTeamId)?.name ?? "Home";
        const awayName = squads.find((s) => s.teamId === match.awayTeamId)?.name ?? "Away";
        for (const teamId of [match.homeTeamId, match.awayTeamId]) {
          const captainId = squads.find((s) => s.teamId === teamId)?.captainId ?? 0;
          const rec = recordFor(teamId, likes);
          await sendNotification({
            userId: captainId,
            type: "league",
            title: `⚽ ${homeName} ${homeScore}–${awayScore} ${awayName}`,
            message: `Result recorded by ${host?.name ?? "the host"}. ${squads.find((s) => s.teamId === teamId)?.name ?? "Your squad"} is now ${rec.won}W • ${rec.drawn}D • ${rec.lost}L (${rec.points} pts) in ${league.name}.`,
            link: hostLink,
          });
        }
      }

      return Response.json({
        ok: true,
        message: played
          ? `Result saved — ${homeScore}–${awayScore} ⚽`
          : "Score cleared — the fixture is unplayed again",
      });
    }

    /* ----------------------------------------------------------- delete */
    if (action === "delete") {
      const matchId = Number(body.matchId);
      const match = (
        await db.select().from(tournamentMatches).where(eq(tournamentMatches.id, matchId))
      )[0];
      if (!match || match.tournamentId !== leagueId)
        return Response.json({ error: "That fixture isn't in this league 🛡️" }, { status: 404 });
      if (match.status === "played")
        return Response.json(
          { error: "That game has a result — clear the score first if it was a mistake ⚽" },
          { status: 409 }
        );

      await db.delete(tournamentMatches).where(eq(tournamentMatches.id, matchId));
      return Response.json({ ok: true, message: "Fixture removed 🗑️" });
    }

    return Response.json(
      { error: "Unknown action — try create, generate, score or delete 📖" },
      { status: 400 }
    );
  } catch (e) {
    console.error(`[/api/tournaments/[id]/matches POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
