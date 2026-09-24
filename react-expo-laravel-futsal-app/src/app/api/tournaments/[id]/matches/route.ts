import { db } from "@/db";
import { bookings, teams, tournamentMatches, tournaments, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import {
  buildBracket,
  groupLabel,
  groupQualifiers,
  knockoutFromGroups,
  loserOf,
  makeGroups,
  modeHasBracket,
  modeHasGroups,
  parseGroupRef,
  parseMatchRef,
  recordFor,
  standingsFor,
  winnerOf,
  type BracketMatch,
  type BracketSlot,
} from "@/lib/league";
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
  /** 0 for a league or group game; 1..n inside a knockout bracket. */
  bracketRound: number;
  slot: number;
  homeFrom: string;
  awayFrom: string;
  homeLabel: string;
  awayLabel: string;
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
    // An empty bracket slot is named by where its squad comes from, so a card
    // reads "Bye 🎟️" or "Winner Group A" rather than a meaningless "Squad".
    const nameOf = (id2: number, label: string) =>
      squads.find((s) => s.teamId === id2)?.name ?? (label || "TBD");

    const matches: FixturePayload[] = rows
      .sort(
        (a, b) =>
          a.bracketRound - b.bracketRound ||
          a.slot - b.slot ||
          String(a.date).localeCompare(String(b.date)) ||
          a.id - b.id
      )
      .map((m) => ({
        id: m.id,
        round: m.round,
        bracketRound: m.bracketRound,
        slot: m.slot,
        homeFrom: m.homeFrom,
        awayFrom: m.awayFrom,
        homeLabel: m.homeLabel,
        awayLabel: m.awayLabel,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        homeTeamName: nameOf(m.homeTeamId, m.homeLabel),
        awayTeamName: nameOf(m.awayTeamId, m.awayLabel),
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
      // The page picks its renderer from this: a table for a league, a bracket
      // for a knockout, both for groups + knockout.
      mode: access.tournament.mode,
      thirdPlace: access.tournament.thirdPlace,
      groupSize: access.tournament.groupSize,
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

        /* ------------------------------------------- knockout / groups draw */
        if (modeHasBracket(league.mode)) {
          // A bracket is drawn once, whole. Drawing it again over a half-played
          // one would strand slots wired to games that no longer exist, so the
          // host clears the fixture book first if the shape was wrong.
          if (existing.length > 0)
            return Response.json(
              {
                error:
                  "This bracket is already drawn 🥊 Remove the fixtures first if the draw needs doing again.",
              },
              { status: 409 }
            );

          const teamIds = squads.map((x) => x.teamId);
          let slots: BracketSlot[];
          let created = 0;
          let summary = "";

          if (modeHasGroups(league.mode)) {
            const groups = makeGroups(teamIds, league.groupSize);
            if (groups.length < 2)
              return Response.json(
                {
                  error: `Groups of ${league.groupSize} need at least two groups — let a couple more squads in, or drop the group size 🎯`,
                },
                { status: 409 }
              );
            // The group stage is a mini league inside each group.
            for (let g = 0; g < groups.length; g++) {
              for (let i = 0; i < groups[g].length; i++) {
                for (let j = i + 1; j < groups[g].length; j++) {
                  await db.insert(tournamentMatches).values({
                    tournamentId: leagueId,
                    round: groupLabel(g),
                    homeTeamId: groups[g][i],
                    awayTeamId: groups[g][j],
                    date: "",
                    startTime: "",
                    courtId: league.courtId || null,
                    updatedBy: hostId,
                  });
                  created += 1;
                }
              }
            }
            // ...and the knockout stage is created empty, waiting on the tables.
            slots = knockoutFromGroups(groups.length, { thirdPlace: league.thirdPlace });
            summary = `${groups.length} groups of ${groups.map((g) => g.length).join("/")} — top two of each go through`;
          } else {
            slots = buildBracket(teamIds, { thirdPlace: league.thirdPlace });
            const byes = slots.filter(
              (x) => x.roundIndex === 1 && (x.homeTeamId === 0 || x.awayTeamId === 0)
            ).length;
            summary = `a knockout bracket for ${teamIds.length} squads${
              byes > 0 ? ` — top ${byes} seed${byes === 1 ? "" : "s"} get${byes === 1 ? "s" : ""} a bye` : ""
            }`;
          }

          for (const slot of slots) {
            await db.insert(tournamentMatches).values({
              tournamentId: leagueId,
              round: slot.round,
              bracketRound: slot.roundIndex,
              slot: slot.slot,
              homeTeamId: slot.homeTeamId,
              awayTeamId: slot.awayTeamId,
              homeFrom: slot.homeFrom,
              awayFrom: slot.awayFrom,
              homeLabel: slot.homeLabel,
              awayLabel: slot.awayLabel,
              date: "",
              startTime: "",
              courtId: league.courtId || null,
              updatedBy: hostId,
            });
            created += 1;
          }

          // Byes and already-decided group tables fill their slots at once.
          await advanceBracket(leagueId);

          await db
            .update(tournaments)
            .set({ status: league.status === "registration" ? "ongoing" : league.status })
            .where(eq(tournaments.id, leagueId));
          for (const s of squads) {
            await sendNotification({
              userId: s.captainId,
              type: "league",
              title: `📅 The draw is out — ${league.name}`,
              message: `${created} ${created === 1 ? "game" : "games"} drawn — ${summary}. Open the league page to see your route to the final.`,
              link: hostLink,
            });
          }
          return Response.json({
            ok: true,
            created,
            message: `${created} fixtures drawn — ${summary} 🗓️`,
          });
        }

        /* ------------------------------------------------ round robin draw */
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
              courtId: league.courtId || null,
              updatedBy: hostId,
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

      // A bracket game can't be level: the winner is who goes through, so a
      // draw would leave the next round with an empty slot nobody can fill.
      // The host counts the penalties and enters the shootout score.
      if (played && match.bracketRound > 0 && homeScore === awayScore)
        return Response.json(
          {
            error:
              "A knockout game needs a winner — count the penalties and enter the shootout score 🥊",
          },
          { status: 400 }
        );

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
      let advanced = 0;
      let championName = "";
      if (played) {
        await markOngoing();
        // A result in a bracket or a finished group table sends somebody
        // through — the next round fills itself instead of waiting on the host.
        advanced = await advanceBracket(leagueId);
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

        // Winning the final makes a squad champion — say so, once.
        if (match.bracketRound > 0 && match.round === "Final") {
          const championId = winnerOf({
            bracketRound: match.bracketRound,
            slot: match.slot,
            homeTeamId: match.homeTeamId,
            awayTeamId: match.awayTeamId,
            homeFrom: match.homeFrom,
            awayFrom: match.awayFrom,
            homeScore,
            awayScore,
            status: "played",
          });
          const champion = squads.find((x) => x.teamId === championId);
          if (champion) {
            championName = champion.name;
            await sendNotification({
              userId: champion.captainId,
              type: "league",
              title: `🏆 ${champion.name} won ${league.name}!`,
              message: `Champions! The final is yours — ${homeName} ${homeScore}–${awayScore} ${awayName}. Tell the host where to send the trophy 🎉`,
              link: hostLink,
            });
          }
        }
      }

      return Response.json({
        ok: true,
        advanced,
        champion: championName,
        message: played
          ? `Result saved — ${homeScore}–${awayScore} ⚽${
              championName
                ? ` — ${championName} are champions 🏆`
                : advanced > 0
                  ? ` • ${advanced} bracket ${advanced === 1 ? "slot" : "slots"} filled`
                  : ""
            }`
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
      // Pulling one game out of a bracket leaves the round after it wired to
      // nothing, so a bracket is redrawn whole rather than edited a game at a time.
      if (match.bracketRound > 0)
        return Response.json(
          {
            error:
              "That game is part of the bracket 🥊 Delete the whole draw and generate it again if the shape is wrong.",
          },
          { status: 409 }
        );

      await db.delete(tournamentMatches).where(eq(tournamentMatches.id, matchId));
      return Response.json({ ok: true, message: "Fixture removed 🗑️" });
    }

    /* -------------------------------------------------------- schedule */
    if (action === "schedule") {
      // A drawn bracket arrives without times: the host knows which round plays
      // on which Saturday, and this is where they say so — including on a slot
      // that is still "Winner Group A", because the slot exists already.
      const matchId = Number(body.matchId);
      const match = (
        await db.select().from(tournamentMatches).where(eq(tournamentMatches.id, matchId))
      )[0];
      if (!match || match.tournamentId !== leagueId)
        return Response.json({ error: "That fixture isn't in this league 🛡️" }, { status: 404 });

      const date = String(body.date ?? "").trim();
      const startTime = String(body.startTime ?? "").trim();
      if (!date && !startTime)
        return Response.json({ error: "Pick a day or a kick-off time to save 📅" }, { status: 400 });
      const err = firstError(
        date ? validateDateISO(date, { label: "Fixture date", allowPast: true }) : null,
        startTime ? validateTimeHM(startTime, "Kick-off time") : null
      );
      if (err) return Response.json({ error: err }, { status: 400 });

      const updated = (
        await db
          .update(tournamentMatches)
          .set({
            ...(date ? { date } : {}),
            ...(startTime ? { startTime } : {}),
            ...(body.courtId === undefined ? {} : { courtId: Number(body.courtId) || null }),
            updatedBy: hostId,
            updatedAt: new Date(),
          })
          .where(eq(tournamentMatches.id, matchId))
          .returning()
      )[0];

      return Response.json({
        ok: true,
        match: updated,
        message: date
          ? `${match.round} set for ${prettyDate(date)}${startTime ? ` at ${formatTime12(startTime)}` : ""} 📅`
          : "Kick-off time saved 📅",
      });
    }

    /* ---------------------------------------------------------- advance */
    if (action === "advance") {
      if (!modeHasBracket(league.mode))
        return Response.json(
          { error: "This league has no bracket to fill — it's a round robin 🔄" },
          { status: 400 }
        );
      const advanced = await advanceBracket(leagueId);
      return Response.json({
        ok: true,
        advanced,
        message:
          advanced > 0
            ? `${advanced} bracket ${advanced === 1 ? "slot" : "slots"} filled 🥊`
            : "Nothing to fill yet — the bracket moves when a game is decided ⏳",
      });
    }

    return Response.json(
      { error: "Unknown action — try create, generate, schedule, advance, score or delete 📖" },
      { status: 400 }
    );
  } catch (e) {
    console.error(`[/api/tournaments/[id]/matches POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * Fill the bracket 🥊
 *
 * Every empty slot in a knockout says where its squad will come from: the
 * winner of round 1 slot 0, the loser of the second semi-final, or the runner-up
 * of group C. This reads the fixtures, answers whichever of those questions the
 * results can now answer, and writes the squad into the slot. It is idempotent —
 * running it twice changes nothing the second time — so it can be called after
 * every result, and on a fresh draw, where byes and finished groups have
 * something to say straight away.
 *
 * A group only sends anybody through once *all* of its games are played: with a
 * game left, the top two could still change, and a slot filled early would be
 * wrong in a way nobody would notice until the final.
 */
async function advanceBracket(leagueId: number): Promise<number> {
  const rows = await db
    .select()
    .from(tournamentMatches)
    .where(eq(tournamentMatches.tournamentId, leagueId));

  const asBracket = (m: (typeof rows)[number]): BracketMatch => ({
    bracketRound: m.bracketRound,
    slot: m.slot,
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeFrom: m.homeFrom,
    awayFrom: m.awayFrom,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    status: m.status,
  });

  // Group tables, but only for groups whose fixtures are all in.
  const allTeams = await db.select().from(teams);
  const groupTables = new Map<string, number[]>();
  const groupRounds = [...new Set(rows.filter((m) => /^Group /.test(m.round)).map((m) => m.round))];
  for (const round of groupRounds) {
    const fixtures = rows.filter((m) => m.round === round);
    if (fixtures.length === 0) continue;
    if (fixtures.some((m) => m.homeScore === null || m.awayScore === null)) continue;
    const ids = [...new Set(fixtures.flatMap((m) => [m.homeTeamId, m.awayTeamId]))];
    const likes = ids.map((id) => {
      const t = allTeams.find((x) => x.id === id);
      return {
        teamId: id,
        name: t?.name ?? "Squad",
        logoColor: t?.logoColor ?? "#16a34a",
        teamCode: t?.teamCode ?? "",
      };
    });
    const { winners } = groupQualifiers(likes, fixtures.map(asBracket));
    // winners[0] is the group winner, winners[1] the runner-up.
    groupTables.set(round, winners);
  }
  const groupsByIndex = new Map<number, number[]>();
  for (const round of groupRounds) {
    const letter = round.replace("Group ", "");
    const index = letter.charCodeAt(0) - "A".charCodeAt(0);
    const table = groupTables.get(round);
    if (index >= 0 && table) groupsByIndex.set(index + 1, table);
  }

  const resolve = (ref: string): number => {
    if (!ref) return 0;
    const matchRef = parseMatchRef(ref);
    if (matchRef) {
      const source = rows.find(
        (m) => m.bracketRound === matchRef.round && m.slot === matchRef.slot
      );
      if (!source) return 0;
      return matchRef.outcome === "W" ? winnerOf(asBracket(source)) : loserOf(asBracket(source));
    }
    const groupRef = parseGroupRef(ref);
    if (groupRef) {
      const table = groupsByIndex.get(groupRef.group);
      if (!table) return 0;
      return groupRef.place === "W" ? table[0] ?? 0 : table[1] ?? 0;
    }
    return 0;
  };

  let filled = 0;
  for (const m of rows) {
    if (m.bracketRound <= 0) continue;
    const changes: { homeTeamId?: number; awayTeamId?: number } = {};
    if (m.homeTeamId === 0 && m.homeFrom) {
      const teamId = resolve(m.homeFrom);
      if (teamId > 0 && teamId !== m.awayTeamId) changes.homeTeamId = teamId;
    }
    if (m.awayTeamId === 0 && m.awayFrom) {
      const teamId = resolve(m.awayFrom);
      if (teamId > 0 && teamId !== m.homeTeamId) changes.awayTeamId = teamId;
    }
    if (Object.keys(changes).length > 0) {
      await db
        .update(tournamentMatches)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(tournamentMatches.id, m.id));
      filled += 1;
    }
  }
  return filled;
}
