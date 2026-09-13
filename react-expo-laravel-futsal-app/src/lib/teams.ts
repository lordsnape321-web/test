/**
 * Pure team helpers — no database, no React, nothing that can throw on bad
 * input. Anything touching Postgres lives in `team-store.ts`, mirroring the
 * `promos.ts` / `promo-store.ts` split.
 */

export const TEAM_CODE_MIN = 3;
export const TEAM_CODE_MAX = 20;

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
