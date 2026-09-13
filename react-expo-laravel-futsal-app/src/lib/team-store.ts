import { db } from "@/db";
import { teamMembers, teams } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * A team as the booking flow needs it: enough to render a chip and to sync the
 * crew size to the real squad. See `findTeamForUser` for the server-side
 * authority check that decides whether a booking may claim a team.
 */
export type UserTeam = {
  id: number;
  name: string;
  memberCount: number;
  logoColor: string;
  level: string;
  /** "captain" | "player" — lets the UI flag the squads you lead. */
  role: string;
};

/**
 * Every team `userId` belongs to: squads you captain first, then alphabetical.
 * Returns [] for a player in no team, which is what makes the booking flow fall
 * back to an individual booking instead of showing an empty picker.
 */
export async function teamsForUser(userId: number): Promise<UserTeam[]> {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const mine = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  if (mine.length === 0) return [];

  const allTeams = await db.select().from(teams);
  const allMembers = await db.select().from(teamMembers);

  const out: UserTeam[] = [];
  for (const m of mine) {
    const t = allTeams.find((x) => x.id === m.teamId);
    // A membership row whose team is gone contributes nothing.
    if (!t) continue;
    out.push({
      id: t.id,
      name: t.name,
      memberCount: allMembers.filter((x) => x.teamId === t.id).length,
      logoColor: t.logoColor,
      level: t.level,
      role: m.role,
    });
  }

  return out.sort((a, b) => {
    const notCaptain = (x: UserTeam) => (x.role === "captain" ? 0 : 1);
    return notCaptain(a) - notCaptain(b) || a.name.localeCompare(b.name);
  });
}

/**
 * Authority check for POST /api/bookings: resolves the team only when `userId`
 * is genuinely a member, so a hand-edited request cannot attach a booking to a
 * squad the player has nothing to do with. The returned `name` is what gets
 * snapshotted onto the booking — never the client-supplied label.
 */
export async function findTeamForUser(
  teamId: number,
  userId: number
): Promise<{ id: number; name: string } | null> {
  if (!Number.isInteger(teamId) || teamId <= 0) return null;
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const rows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teams.id, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}
