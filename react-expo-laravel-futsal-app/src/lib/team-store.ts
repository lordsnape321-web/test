import { db } from "@/db";
import {
  matchJoins,
  openMatches,
  reviews,
  teamInvites,
  teamMembers,
  teamRequests,
  teams,
  users,
  venues,
} from "@/db/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  JOIN_REQUEST_DAILY_LIMIT,
  REOPENABLE_REQUEST_STATUSES,
  REQUEST_PENDING,
  TEAM_INVITE_DAILY_LIMIT,
  makeQuota,
  normalizeTeamCode,
  startOfQuotaDay,
  type Quota,
} from "./teams";

/**
 * A team as the booking flow needs it: enough to render a chip and to sync the
 * crew size to the real squad. See `findTeamForUser` for the server-side
 * authority check that decides whether a booking may claim a team.
 */
export type UserTeam = {
  id: number;
  name: string;
  teamCode: string;
  memberCount: number;
  logoColor: string;
  level: string;
  /** "captain" | "player" — lets the UI flag the squads you lead. */
  role: string;
  /**
   * Extra context for the public player dossier (`/players/{id}`): a captain
   * deciding on a request can see what the applicant is already part of. The
   * booking chip ignores these, so widening the shape costs nothing there.
   */
  motto: string;
  description: string;
  maxPlayers: number;
  wins: number;
  draws: number;
  losses: number;
  homeGround: string;
  lookingForPlayers: boolean;
};

/** A roster row: the member plus everything the captain panel renders. */
export type RosterMember = {
  userId: number;
  name: string;
  email: string;
  avatarColor: string;
  avatarUrl: string;
  position: string;
  level: string;
  role: string;
  isCaptain: boolean;
  joinedAt: Date | null;
};

/** A join request with the requester's profile attached. */
export type JoinRequest = {
  id: number;
  teamId: number;
  userId: number;
  name: string;
  email: string;
  avatarColor: string;
  avatarUrl: string;
  position: string;
  level: string;
  message: string;
  status: string;
  createdAt: Date | null;
};

/**
 * Every team `userId` belongs to: squads you captain first, then alphabetical.
 * Returns [] for a player in no team, which is what makes the booking flow fall
 * back to an individual booking instead of showing an empty picker.
 *
 * `role` is derived from `teams.captainId` rather than the membership row, so the
 * two can never disagree about who leads the squad.
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
      teamCode: t.teamCode ?? "",
      memberCount: allMembers.filter((x) => x.teamId === t.id).length,
      logoColor: t.logoColor,
      level: t.level,
      role: t.captainId === userId ? "captain" : "player",
      motto: t.motto,
      description: t.description ?? "",
      maxPlayers: t.maxPlayers,
      wins: t.wins,
      draws: t.draws,
      losses: t.losses,
      homeGround: t.homeGround,
      lookingForPlayers: t.lookingForPlayers,
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

/** Is this code already taken? `excludeTeamId` lets a team keep its own code. */
export async function teamCodeTaken(
  code: unknown,
  excludeTeamId = 0
): Promise<boolean> {
  const t = normalizeTeamCode(code);
  if (!t) return false;
  // Compared after normalising both sides, so a legacy or hand-seeded row stored
  // in a different case still blocks the duplicate. Teams are few by nature.
  const rows = await db
    .select({ id: teams.id, teamCode: teams.teamCode })
    .from(teams);
  return rows.some(
    (r) => r.id !== excludeTeamId && normalizeTeamCode(r.teamCode ?? "") === t
  );
}

/** Look a team up by its unique code — what the search box uses. */
export async function findTeamByCode(
  code: unknown
): Promise<typeof teams.$inferSelect | null> {
  const t = normalizeTeamCode(code);
  if (!t) return null;
  const rows = await db.select().from(teams);
  return rows.find((r) => normalizeTeamCode(r.teamCode ?? "") === t) ?? null;
}

/**
 * Search by code (exact or prefix) or by name (substring). Codes match first so
 * typing a full code always lands on that exact squad.
 */
export async function searchTeams(query: unknown, limit = 20) {
  const q = String(query ?? "").trim();
  const all = await db.select().from(teams);
  const members = await db.select().from(teamMembers);
  const code = normalizeTeamCode(q);

  const hits = q
    ? all.filter((t) => {
        const tc = normalizeTeamCode(t.teamCode ?? "");
        return (
          (code && (tc === code || tc.startsWith(code))) ||
          t.name.toLowerCase().includes(q.toLowerCase())
        );
      })
    : all;

  // Exact code match wins, then name matches, everything else keeps its order.
  const rank = (t: typeof teams.$inferSelect) => {
    const tc = normalizeTeamCode(t.teamCode ?? "");
    if (code && tc === code) return 0;
    if (code && tc.startsWith(code)) return 1;
    return 2;
  };

  return [...hits]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit))
    .map((t) => ({
      ...t,
      teamCode: t.teamCode ?? "",
      memberCount: members.filter((m) => m.teamId === t.id).length,
    }));
}

/** Pending-request counts for a batch of teams, so cards can badge them. */
export async function pendingRequestCounts(
  teamIds: number[]
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (teamIds.length === 0) return out;
  const rows = await db
    .select()
    .from(teamRequests)
    .where(
      and(inArray(teamRequests.teamId, teamIds), eq(teamRequests.status, REQUEST_PENDING))
    );
  for (const r of rows) out.set(r.teamId, (out.get(r.teamId) ?? 0) + 1);
  return out;
}

/** Only the captain manages a squad — the gate every mutation goes through. */
export async function isCaptain(teamId: number, userId: number): Promise<boolean> {
  if (!Number.isInteger(teamId) || teamId <= 0) return false;
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const rows = await db.select().from(teams).where(eq(teams.id, teamId));
  return rows[0]?.captainId === userId;
}

/** The full roster with profiles, captain first. */
export async function teamRoster(teamId: number): Promise<RosterMember[]> {
  if (!Number.isInteger(teamId) || teamId <= 0) return [];
  const teamRows = await db.select().from(teams).where(eq(teams.id, teamId));
  const team = teamRows[0];
  if (!team) return [];
  const memberships = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));
  if (memberships.length === 0) return [];
  const people = await db
    .select()
    .from(users)
    .where(inArray(users.id, memberships.map((m) => m.userId)));

  return memberships
    .map((m) => {
      const u = people.find((p) => p.id === m.userId);
      if (!u) return null;
      const captain = team.captainId === u.id;
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        avatarColor: u.avatarColor,
        avatarUrl: u.avatarUrl,
        position: u.position,
        level: u.level,
        // Derived from teams.captainId so the roster can never show two captains.
        role: captain ? "captain" : "player",
        isCaptain: captain,
        joinedAt: m.joinedAt,
      } satisfies RosterMember;
    })
    .filter((x): x is RosterMember => x !== null)
    .sort(
      (a, b) =>
        Number(b.isCaptain) - Number(a.isCaptain) || a.name.localeCompare(b.name)
    );
}

/** Join requests for a team. Defaults to the pending ones the captain must act on. */
export async function teamJoinRequests(
  teamId: number,
  status: string = REQUEST_PENDING
): Promise<JoinRequest[]> {
  if (!Number.isInteger(teamId) || teamId <= 0) return [];
  const rows = await db
    .select()
    .from(teamRequests)
    .where(
      status
        ? and(eq(teamRequests.teamId, teamId), eq(teamRequests.status, status))
        : eq(teamRequests.teamId, teamId)
    );
  if (rows.length === 0) return [];
  const people = await db
    .select()
    .from(users)
    .where(inArray(users.id, rows.map((r) => r.userId)));

  return rows
    .map((r) => {
      const u = people.find((p) => p.id === r.userId);
      if (!u) return null;
      return {
        id: r.id,
        teamId: r.teamId,
        userId: r.userId,
        name: u.name,
        email: u.email,
        avatarColor: u.avatarColor,
        avatarUrl: u.avatarUrl,
        position: u.position,
        level: u.level,
        message: r.message,
        status: r.status,
        createdAt: r.createdAt,
      } satisfies JoinRequest;
    })
    .filter((x): x is JoinRequest => x !== null)
    .sort((a, b) => (a.createdAt ?? new Date(0)).getTime() - (b.createdAt ?? new Date(0)).getTime());
}

/** This player's own pending request for a team, if they have one. */
export async function myPendingRequest(
  teamId: number,
  userId: number
): Promise<typeof teamRequests.$inferSelect | null> {
  if (!Number.isInteger(teamId) || teamId <= 0) return null;
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const rows = await db
    .select()
    .from(teamRequests)
    .where(
      and(
        eq(teamRequests.teamId, teamId),
        eq(teamRequests.userId, userId),
        eq(teamRequests.status, REQUEST_PENDING)
      )
    );
  return rows[0] ?? null;
}

/** Is this player already on the roster? */
export async function isMember(teamId: number, userId: number): Promise<boolean> {
  if (!Number.isInteger(teamId) || teamId <= 0) return false;
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const rows = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Hand the armband over, keeping the "exactly one captain" invariant in a single
 * place: the new captain must already be on the roster, `teams.captainId` moves,
 * and the membership roles follow it. Returns the updated team, or null when the
 * target is not a member (which is the caller's 400).
 */
export async function transferCaptaincy(teamId: number, newCaptainId: number) {
  const teamRows = await db.select().from(teams).where(eq(teams.id, teamId));
  const team = teamRows[0];
  if (!team) return null;
  if (!(await isMember(teamId, newCaptainId))) return null;
  if (team.captainId === newCaptainId) return team;

  await db.update(teams).set({ captainId: newCaptainId }).where(eq(teams.id, teamId));
  // Demote everyone, then promote the new captain — never two, never zero.
  await db
    .update(teamMembers)
    .set({ role: "player" })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "captain")));
  await db
    .update(teamMembers)
    .set({ role: "captain" })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, newCaptainId)));

  const after = await db.select().from(teams).where(eq(teams.id, teamId));
  return after[0] ?? null;
}

/* ------------------------------------------------------------------ invites */

/**
 * An invite as both panels render it: the squad, the player, and who asked.
 * `email` is filled only for the captain's own view, mirroring the roster rule —
 * contact details are for running a team, not for scraping.
 */
export type TeamInviteRow = {
  id: number;
  teamId: number;
  teamName: string;
  teamCode: string;
  teamLogoColor: string;
  teamLevel: string;
  maxPlayers: number;
  memberCount: number;
  squadFull: boolean;
  userId: number;
  name: string;
  email: string;
  avatarColor: string;
  avatarUrl: string;
  position: string;
  level: string;
  invitedBy: number;
  captainName: string;
  message: string;
  status: string;
  createdAt: Date | null;
  decidedAt: Date | null;
};

/**
 * How many players this squad has invited today. Per team rather than per
 * captain, so leading two squads does not quietly double the cap of either, and
 * a second captain of the same squad cannot get around it either — the limit
 * belongs to the team.
 */
export async function teamInviteQuota(teamId: number): Promise<Quota> {
  if (!Number.isInteger(teamId) || teamId <= 0)
    return makeQuota(0, TEAM_INVITE_DAILY_LIMIT);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(teamInvites)
    .where(
      and(eq(teamInvites.teamId, teamId), gte(teamInvites.createdAt, startOfQuotaDay()))
    );
  return makeQuota(rows[0]?.n ?? 0, TEAM_INVITE_DAILY_LIMIT);
}

/** How many squads this player has asked to join today. */
export async function joinRequestQuota(userId: number): Promise<Quota> {
  if (!Number.isInteger(userId) || userId <= 0)
    return makeQuota(0, JOIN_REQUEST_DAILY_LIMIT);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(teamRequests)
    .where(
      and(eq(teamRequests.userId, userId), gte(teamRequests.createdAt, startOfQuotaDay()))
    );
  return makeQuota(rows[0]?.n ?? 0, JOIN_REQUEST_DAILY_LIMIT);
}

/** The player's pending invite from this squad, if there is one. */
export async function myPendingInvite(
  teamId: number,
  userId: number
): Promise<typeof teamInvites.$inferSelect | null> {
  if (!Number.isInteger(teamId) || teamId <= 0) return null;
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const rows = await db
    .select()
    .from(teamInvites)
    .where(
      and(
        eq(teamInvites.teamId, teamId),
        eq(teamInvites.userId, userId),
        eq(teamInvites.status, REQUEST_PENDING)
      )
    );
  return rows[0] ?? null;
}

/**
 * A declined or withdrawn invite is reopened in place instead of stacking a
 * duplicate row per attempt — the same trick `teamRequests` uses, so a player's
 * history with a squad stays one row. An `accepted` row is history and is left
 * alone; a fresh one is created beside it.
 */
export async function reopenableInvite(
  teamId: number,
  userId: number
): Promise<typeof teamInvites.$inferSelect | null> {
  const rows = await db
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.teamId, teamId), eq(teamInvites.userId, userId)));
  return rows.find((r) => REOPENABLE_REQUEST_STATUSES.includes(r.status)) ?? null;
}

export async function findInvite(inviteId: number) {
  if (!Number.isInteger(inviteId) || inviteId <= 0) return null;
  const rows = await db.select().from(teamInvites).where(eq(teamInvites.id, inviteId));
  return rows[0] ?? null;
}

/** Joins the rows a panel needs into one flat shape — used by both invite lists. */
async function decorateInvites(
  rows: Array<typeof teamInvites.$inferSelect>,
  opts: { forCaptain: boolean }
): Promise<TeamInviteRow[]> {
  if (rows.length === 0) return [];
  const allTeams = await db.select().from(teams);
  const allMembers = await db.select().from(teamMembers);
  const people = await db
    .select()
    .from(users)
    .where(inArray(users.id, rows.flatMap((r) => [r.userId, r.invitedBy])));

  const out: TeamInviteRow[] = [];
  for (const r of rows) {
    const t = allTeams.find((x) => x.id === r.teamId);
    // An invite whose team has been deleted contributes nothing.
    if (!t) continue;
    const u = people.find((p) => p.id === r.userId);
    if (!u) continue;
    const memberCount = allMembers.filter((m) => m.teamId === t.id).length;
    out.push({
      id: r.id,
      teamId: t.id,
      teamName: t.name,
      teamCode: t.teamCode ?? "",
      teamLogoColor: t.logoColor,
      teamLevel: t.level,
      maxPlayers: t.maxPlayers,
      memberCount,
      squadFull: memberCount >= t.maxPlayers,
      userId: u.id,
      name: u.name,
      email: opts.forCaptain ? u.email : "",
      avatarColor: u.avatarColor,
      avatarUrl: u.avatarUrl,
      position: u.position,
      level: u.level,
      invitedBy: r.invitedBy,
      captainName: people.find((p) => p.id === r.invitedBy)?.name ?? "The captain",
      message: r.message,
      status: r.status,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
    });
  }
  // Oldest ask first, so nobody waits behind the queue-jumper.
  return out.sort(
    (a, b) =>
      (a.createdAt ?? new Date(0)).getTime() - (b.createdAt ?? new Date(0)).getTime()
  );
}

/** The captain's sent invites for one squad (pending by default). */
export async function teamSentInvites(
  teamId: number,
  status: string = REQUEST_PENDING
): Promise<TeamInviteRow[]> {
  if (!Number.isInteger(teamId) || teamId <= 0) return [];
  const rows = await db
    .select()
    .from(teamInvites)
    .where(
      status
        ? and(eq(teamInvites.teamId, teamId), eq(teamInvites.status, status))
        : eq(teamInvites.teamId, teamId)
    );
  return decorateInvites(rows, { forCaptain: true });
}

/** Everything this player has been invited to (pending by default). */
export async function playerInvites(
  userId: number,
  status: string = REQUEST_PENDING
): Promise<TeamInviteRow[]> {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const rows = await db
    .select()
    .from(teamInvites)
    .where(
      status
        ? and(eq(teamInvites.userId, userId), eq(teamInvites.status, status))
        : eq(teamInvites.userId, userId)
    );
  return decorateInvites(rows, { forCaptain: false });
}

/**
 * Pending invites per squad, for the badge on the captain's own team card. The
 * list lives in the invite panel; the card only needs a number.
 */
export async function pendingInviteCounts(
  teamIds: number[]
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (teamIds.length === 0) return out;
  const rows = await db
    .select()
    .from(teamInvites)
    .where(
      and(inArray(teamInvites.teamId, teamIds), eq(teamInvites.status, REQUEST_PENDING))
    );
  for (const r of rows) out.set(r.teamId, (out.get(r.teamId) ?? 0) + 1);
  return out;
}

/**
 * Everything this player has asked for, newest first, with the squad attached.
 * The dossier page filters this to the squads the *viewer* captains, which is
 * what turns "someone asked to join" into "someone is asking, and here is why".
 */
export async function joinRequestsFromUser(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const rows = await db
    .select()
    .from(teamRequests)
    .where(eq(teamRequests.userId, userId));
  if (rows.length === 0) return [];
  const allTeams = await db.select().from(teams);
  return rows
    .map((r) => {
      const t = allTeams.find((x) => x.id === r.teamId);
      if (!t) return null;
      return {
        id: r.id,
        teamId: t.id,
        teamName: t.name,
        teamCode: t.teamCode ?? "",
        logoColor: t.logoColor,
        captainId: t.captainId,
        message: r.message,
        status: r.status,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort(
      (a, b) =>
        (b.createdAt ?? new Date(0)).getTime() - (a.createdAt ?? new Date(0)).getTime()
    );
}

/** A player's own venue reviews — public on the venue pages, so the dossier may show them. */
export async function playerReviews(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const rows = await db
    .select()
    .from(reviews)
    .where(eq(reviews.userId, userId));
  if (rows.length === 0) return [];
  const allVenues = await db.select().from(venues);
  return rows
    .map((r) => {
      const v = allVenues.find((x) => x.id === r.venueId);
      return {
        id: r.id,
        venueId: r.venueId,
        venueName: v?.name ?? "a venue",
        rating: r.rating,
        message: r.message,
        createdAt: r.createdAt,
      };
    })
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

/** Open matches this player organises or has joined, so a captain can see they show up. */
export async function playerMatchActivity(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0)
    return { organized: [], joined: [] };
  const allMatches = await db.select().from(openMatches);
  const allVenues = await db.select().from(venues);
  const joins = await db
    .select()
    .from(matchJoins)
    .where(eq(matchJoins.userId, userId));
  const joinedIds = new Set(joins.map((j) => j.matchId));
  const shape = (m: typeof openMatches.$inferSelect) => ({
    id: m.id,
    title: m.title,
    date: m.date,
    startTime: m.startTime,
    endTime: m.endTime,
    level: m.level,
    status: m.status,
    pricePerPlayer: m.pricePerPlayer,
    venueName: allVenues.find((v) => v.id === m.venueId)?.name ?? "",
  });
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (m: typeof openMatches.$inferSelect) =>
    m.date >= today && (m.status === "open" || m.status === "confirmed");
  return {
    organized: allMatches
      .filter((m) => m.organizerId === userId && upcoming(m))
      .map(shape),
    joined: allMatches
      .filter((m) => joinedIds.has(m.id) && upcoming(m))
      .map(shape),
  };
}
