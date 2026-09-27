/**
 * Open games — who gets to play, and who decides. The mirror image of
 * `laravel/app/Support/OpenGames.php`; the two are edited together.
 *
 * Taking a spot is a request, not a fact. The host answers, exactly the way a
 * captain answers a squad request, and the host's own crew is the one exception
 * because it is already theirs. Money offered up front is a commitment, so it
 * settles a request by default — but it never gets a spot on a game that is
 * already full, and a host can still accept someone who sent nothing.
 */

/** The spots a futsal game actually has. */
export const POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward"] as const;
export type Position = (typeof POSITIONS)[number];

/** "Anyone welcome" — what a game with no `positionsNeeded` is asking for. */
export const ANY_POSITION = "Any position";

export const JOIN_ACCEPTED = "accepted" as const;
/** Asked, waiting for the host. Holds no spot. */
export const JOIN_PENDING = "pending" as const;
export const JOIN_DECLINED = "declined" as const;
export const JOIN_CANCELLED = "cancelled" as const;

export type JoinStatus =
  | typeof JOIN_ACCEPTED
  | typeof JOIN_PENDING
  | typeof JOIN_DECLINED
  | typeof JOIN_CANCELLED;

/** How many positions a host may ask for — a pitch, not a shopping list. */
export const MAX_POSITIONS = 4;

/** A payment in advance is a share, so it can never exceed the share. */
export const MAX_ADVANCE = 20000;

/** Short labels for the position picker, so it is not four bare nouns. */
export const POSITION_EMOJI: Record<Position, string> = {
  Goalkeeper: "🧤",
  Defender: "🛡️",
  Midfielder: "⚙️",
  Forward: "⚡",
};

/**
 * Normalise a picked list of positions. Unknown entries are dropped, and an
 * empty result means "anyone welcome" — which is the default, so a host is never
 * forced to choose.
 */
export function normalizePositions(raw: unknown): Position[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const out: Position[] = [];

  for (const item of list) {
    const name = String(item ?? "").trim();
    if (!name || name.toLowerCase() === "any" || name.toLowerCase() === "anyone") continue;

    const known = POSITIONS.find((p) => p.toLowerCase() === name.toLowerCase());
    if (known && !out.includes(known)) out.push(known);
    if (out.length >= MAX_POSITIONS) break;
  }

  return out;
}

/**
 * The spot a request is for. A game that named no positions takes anyone and
 * records it as `Any position`; a game that did name them can still be sent a
 * request for a spot it did not ask for, and the host decides that.
 */
export function positionFor(
  positionsNeeded: string[] | undefined | null,
  wanted: unknown,
): Position | typeof ANY_POSITION | "" {
  const name = String(wanted ?? "").trim();
  if (name) {
    const known = POSITIONS.find((p) => p.toLowerCase() === name.toLowerCase());
    if (known) return known;
  }

  return positionsNeeded && positionsNeeded.length > 0 ? "" : ANY_POSITION;
}

/** How much money in advance is being offered, clamped to the share. */
export function advanceAmount(offered: unknown, share: number, wantsToPay: boolean): number {
  if (!wantsToPay) return 0;

  let amount = Number(offered);
  if (!Number.isFinite(amount) || amount <= 0) amount = share; // ticked with no figure = my share

  return Math.max(0, Math.min(Math.floor(amount), share, MAX_ADVANCE));
}

/**
 * Money in front of the host is a commitment, so it accepts the request. The
 * whole of the "accept by default if paid" rule: it fires on a positive amount
 * and nothing else.
 */
export function autoAccepts(paidAmount: number): boolean {
  return paidAmount > 0;
}
