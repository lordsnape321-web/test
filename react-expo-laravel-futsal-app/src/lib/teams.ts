/**
 * Pure team helpers — no database, no React, nothing that can throw on bad
 * input. Anything touching Postgres lives in `team-store.ts`, mirroring the
 * `promos.ts` / `promo-store.ts` split.
 */

export const TEAM_CODE_MIN = 3;
export const TEAM_CODE_MAX = 20;

/**
 * Cap on the squad's "about us" box. Long enough for training nights and who
 * pays for the court, short enough to render as two lines on a team card.
 */
export const TEAM_DESCRIPTION_MAX = 400;

/** A code other players can read out loud over the phone without ambiguity. */
const CODE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY3479";

export const TEAM_ROLES = ["captain", "player"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** Uppercase, no spaces, letters/numbers/dashes only — same rules as a promo code. */
export function normalizeTeamCode(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, TEAM_CODE_MAX);
}

/**
 * Derives a readable code from the team name plus a short tail, so "Chabahil
 * Chargers" becomes something like "CHABAHILCH-XK4P". The tail skips I, O, 0, 1
 * and 2 because they are the characters people mishear when reading a code aloud.
 */
export function suggestTeamCode(seedWord = "TEAM"): string {
  const word = normalizeTeamCode(seedWord).replace(/-/g, "").slice(0, 10) || "TEAM";
  let tail = "";
  for (let i = 0; i < 4; i++)
    tail += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `${word}-${tail}`.slice(0, TEAM_CODE_MAX);
}

/** The only status that means "asked, still waiting on the captain". */
export const REQUEST_PENDING = "pending";
export const REQUEST_ACCEPTED = "accepted";
export const REQUEST_DECLINED = "declined";
export const REQUEST_CANCELLED = "cancelled";

/** Declined and withdrawn requests may be made again; accepted ones must not. */
export const REOPENABLE_REQUEST_STATUSES = [REQUEST_DECLINED, REQUEST_CANCELLED];

/* ------------------------------------------------------------------ quotas */

/**
 * How many invitations a squad may send, and how many squads a player may ask,
 * in one day. Both caps are 5 on purpose: it is plenty for a real squad to
 * reshuffle itself, and one shared number is one rule to explain.
 *
 * Without them, consent is only polite — a captain could add the whole platform
 * to a roster by invitation, and a player could flood every captain with the
 * same note. Sending is what is counted; *answering* is always free, because
 * saying yes to someone who asked first should never cost you anything.
 */
export const TEAM_INVITE_DAILY_LIMIT = 5;
export const JOIN_REQUEST_DAILY_LIMIT = 5;

/**
 * A quota day is a calendar day on the server, not a rolling 24 hours: "5 a day,
 * resets at midnight" is something a user can reason about, whereas a sliding
 * window quietly means "your fifth request last night blocks you this morning".
 */
export function startOfQuotaDay(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The shape the API and both panels pass around: used, the cap, and what's left. */
export type Quota = {
  used: number;
  limit: number;
  left: number;
};

export function makeQuota(
  used: number,
  limit: number = JOIN_REQUEST_DAILY_LIMIT
): Quota {
  const n = Math.max(0, Math.trunc(Number(used) || 0));
  return { used: n, limit, left: Math.max(0, limit - n) };
}

export function quotaExhausted(quota: Quota): boolean {
  return quota.left <= 0;
}

/** When the day rolls over and the counter resets — shown to the user verbatim. */
export function quotaResetsAt(now: Date = new Date()): Date {
  const d = startOfQuotaDay(now);
  d.setDate(d.getDate() + 1);
  return d;
}

/* ---------------------------------------------------------------- eligibility */

/**
 * Roles that may be asked to join a squad. Only `player` accounts are eligible:
 * a venue owner exists to run courts and an admin to run the platform, so listing
 * them in the captain's invite search invites (sic) accidental adds, and a squad
 * full of staff accounts is not a futsal team. Enforced on the server, not just by
 * hiding rows, so a hand-crafted request cannot slot an owner into a roster.
 */
export const INVITABLE_ROLES = ["player"] as const;

export function canBeInvitedToTeam(role: unknown): boolean {
  const r = String(role ?? "")
    .trim()
    .toLowerCase();
  // Blank means "whatever signup defaults to", which is a player account.
  return r === "" || (INVITABLE_ROLES as readonly string[]).includes(r);
}

/** One-line reason a role is not invitable, or null when it is fine. */
export function invitableRoleError(role: unknown, name = "That account"): string | null {
  if (canBeInvitedToTeam(role)) return null;
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "owner")
    return `${name} runs a venue on this platform 🏟️ — only players can join a squad.`;
  return `${name} has a platform staff account 🔒 — only players can join a squad.`;
}


/** How the roster labels a role. */
export function teamRoleLabel(role: string): string {
  return role === "captain" ? "Captain" : "Player";
}

/**
 * A team always has exactly one captain: `teams.captainId` is the source of
 * truth and `teamMembers.role` mirrors it. This is what the API checks before
 * letting a captain leave or be removed — they must hand the armband over first.
 */
export function isCaptainRow(teamCaptainId: number, userId: number): boolean {
  return Number.isInteger(teamCaptainId) && teamCaptainId === userId;
}
