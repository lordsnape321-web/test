/**
 * League rules & maths — pure, no database, no React.
 *
 * Everything here is a *rule* rather than a query: how much of an entry fee is
 * due up front, what a squad gets back when it walks away, how the table sorts,
 * what a "pay Rs. 2,500 to lock your spot" line should say. Keeping those out of
 * the route handlers means the listing, the console and the API all describe the
 * same deal in the same words — and it means the 25%/10% terms are testable
 * arithmetic instead of three copies of a number in a template string.
 *
 * Database work lives in `league-store.ts`, mirroring the `teams.ts` /
 * `team-store.ts` split.
 */

export const LEAGUE_MIN_TEAMS = 4;
export const LEAGUE_MAX_TEAMS = 32;
export const LEAGUE_FORMATS = ["5v5", "6v6", "7v7", "8v8", "11v11"] as const;
export const LEAGUE_VISIBILITIES = ["public", "private"] as const;
export const LEAGUE_STATUSES = [
  "registration",
  "ongoing",
  "completed",
  "cancelled",
] as const;

export const LEAGUE_NAME_MAX = 70;
export const LEAGUE_DESCRIPTION_MAX = 600;
export const LEAGUE_RULES_MAX = 800;
export const LEAGUE_PRIZE_BREAKDOWN_MAX = 400;
export const LEAGUE_MATCH_DAYS_MAX = 80;
export const LEAGUE_MAX_ENTRY_FEE = 200000;
export const LEAGUE_MAX_PRIZE_POOL = 2000000;

/**
 * The platform's floor and ceiling on the two money knobs.
 *
 * A host may ask for *more* than a quarter up front (a league with a big pitch
 * bill might demand half) and may return *less* than a tenth, but never the
 * other way round: the 25%/10% pair is the deal a captain is promised on the
 * listing, so it is a rule rather than a default.
 */
export const MIN_DEPOSIT_PERCENT = 25;
export const MAX_REFUND_PERCENT = 25;

export function depositPercentError(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isInteger(n)) return "Deposit must be a whole percentage 🔒";
  if (n < MIN_DEPOSIT_PERCENT)
    return `Ask for at least ${MIN_DEPOSIT_PERCENT}% up front — that's the commitment that holds a squad's place 🔒`;
  if (n > 100) return "Deposit can't be more than 100% of the entry fee 🔒";
  return null;
}

export function refundPercentError(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isInteger(n)) return "Refund must be a whole percentage ↩️";
  if (n < 0) return "Refund can't be negative ↩️";
  if (n > MAX_REFUND_PERCENT)
    return `A squad that backs out gets at most ${MAX_REFUND_PERCENT}% of what it paid back ↩️`;
  return null;
}

/* ------------------------------------------------------- competition shape */

/**
 * How the competition decides a winner 🏆
 *
 * - `round_robin`    — the league: every squad plays every other, the table
 *                      decides. What the app has always done.
 * - `knockout`       — a bracket: one loss and you are out, byes for the top
 *                      seeds when the entry list isn't a power of two.
 * - `group_knockout` — groups first (a mini league inside each), then the top
 *                      two of every group go into a bracket. The shape most
 *                      weekend futsal tournaments in Nepal actually run.
 */
export const LEAGUE_MODES = ["round_robin", "knockout", "group_knockout"] as const;
export type LeagueMode = (typeof LEAGUE_MODES)[number];

export function isLeagueMode(value: unknown): value is LeagueMode {
  return (LEAGUE_MODES as readonly string[]).includes(String(value ?? ""));
}

export function leagueModeError(value: unknown): string | null {
  if (isLeagueMode(value)) return null;
  return `Pick a competition type — ${LEAGUE_MODES.join(", ")} 🏆`;
}

export function leagueModeLabel(mode: string): { label: string; emoji: string; blurb: string } {
  switch (mode) {
    case "knockout":
      return {
        label: "Knockout",
        emoji: "🥊",
        blurb: "Bracket — win or go home, top seeds get byes",
      };
    case "group_knockout":
      return {
        label: "Groups + Knockout",
        emoji: "🎯",
        blurb: "Group stage, then the top two of each group go to a bracket",
      };
    default:
      return {
        label: "Round robin",
        emoji: "🔄",
        blurb: "League — every squad plays every other, the table decides",
      };
  }
}

/** Does this mode finish with a bracket? (Both knockout flavours do.) */
export function modeHasBracket(mode: string): boolean {
  return mode === "knockout" || mode === "group_knockout";
}

export const MIN_GROUP_SIZE = 2;
export const MAX_GROUP_SIZE = 8;

/**
 * Can this group setup actually run? A group of one plays nobody, and a league
 * too small for two groups is just a round robin with extra steps.
 */
export function groupSetupError(input: {
  mode: string;
  groupSize: number;
  maxTeams: number;
}): string | null {
  if (!modeHasGroups(input.mode)) return null;
  const size = Number(input.groupSize);
  if (!Number.isInteger(size) || size < MIN_GROUP_SIZE || size > MAX_GROUP_SIZE)
    return `Groups hold ${MIN_GROUP_SIZE}–${MAX_GROUP_SIZE} squads each 🎯`;
  if (Number(input.maxTeams) < 2 * MIN_GROUP_SIZE)
    return "Groups + knockout needs room for at least two groups of two 👥";
  return null;
}

/** Does this mode have a group stage? */
export function modeHasGroups(mode: string): boolean {
  return mode === "group_knockout";
}

/* ---------------------------------------------------------- bracket maths */

/**
 * Brackets want a power of two. Five squads enter a bracket of eight and the
 * top three seeds sit out round one — that's a bye, not a mistake, and the
 * maths below is what keeps it honest instead of hand-waved.
 */
export function bracketSizeFor(n: number): number {
  const teams = Math.max(2, Math.trunc(Number(n) || 0));
  let size = 2;
  while (size < teams) size *= 2;
  return size;
}

/** How many rounds a bracket of this size needs to reach a champion. */
export function bracketRoundsFor(size: number): number {
  let rounds = 0;
  let s = Math.max(2, size);
  while (s > 1) {
    s /= 2;
    rounds += 1;
  }
  return rounds;
}

/** What a round is called, by how many squads are still in it. */
export function knockoutRoundLabel(size: number, roundIndex: number): string {
  const inRound = Math.max(2, Math.round(size / 2 ** (Math.max(1, roundIndex) - 1)));
  if (inRound <= 2) return "Final";
  if (inRound === 4) return "Semi-final";
  if (inRound === 8) return "Quarter-final";
  return `Round of ${inRound}`;
}

/**
 * Bracket order for seeds 1..size, so seed 1 can only meet seed 2 in the final.
 * Eight squads come out 1-8, 4-5, 2-7, 3-6 — the standard draw, not a shuffle.
 */
export function seedOrder(size: number): number[] {
  const target = bracketSizeFor(size);
  let order = [1, 2];
  while (order.length < target) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const seed of order) next.push(seed, sum - seed);
    order = next;
  }
  return order;
}

/**
 * Where a result sends somebody. A slot that isn't filled by a real squad yet
 * carries one of these instead, and `advanceBracket` swaps it for a team id the
 * moment the game it points at is decided:
 *
 * - `W1-0` — the winner of round 1, slot 0
 * - `L2-1` — the loser of round 2, slot 1 (that's how a third-place game fills)
 * - `G2W`  — the winner of group 2
 * - `G2R`  — the runner-up of group 2
 */
export type SlotRef = string;

export function winnerRef(roundIndex: number, slot: number): SlotRef {
  return `W${roundIndex}-${slot}`;
}
export function loserRef(roundIndex: number, slot: number): SlotRef {
  return `L${roundIndex}-${slot}`;
}
export function groupWinnerRef(group: number): SlotRef {
  return `G${group}W`;
}
export function groupRunnerUpRef(group: number): SlotRef {
  return `G${group}R`;
}

/* ------------------------------------------------------- reading a bracket */

export type BracketMatch = {
  bracketRound: number;
  slot: number;
  homeTeamId: number;
  awayTeamId: number;
  homeFrom: string;
  awayFrom: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
};

/** A slot with a squad in it and nobody to play: that's a bye, not a fixture. */
export function isBye(m: BracketMatch): boolean {
  return (
    (m.homeTeamId > 0 && m.awayTeamId === 0 && !m.awayFrom) ||
    (m.awayTeamId > 0 && m.homeTeamId === 0 && !m.homeFrom)
  );
}

/**
 * Who is through from a bracket game — 0 while it's undecided.
 *
 * A played game sends the higher score through. A bye sends its only squad
 * through without kicking a ball, which is what lets a five-squad bracket of
 * eight work: seeds 1–3 walk into round two and the draw stays honest.
 * A level score returns 0 rather than guessing, because a knockout game has to
 * have a winner and the host decides it (penalties) rather than the code.
 */
export function winnerOf(m: BracketMatch): number {
  if (m.status === "void") return 0;
  if (m.homeScore !== null && m.awayScore !== null) {
    if (m.homeScore > m.awayScore) return m.homeTeamId;
    if (m.awayScore > m.homeScore) return m.awayTeamId;
    return 0;
  }
  if (m.homeTeamId > 0 && m.awayTeamId === 0 && !m.awayFrom) return m.homeTeamId;
  if (m.awayTeamId > 0 && m.homeTeamId === 0 && !m.homeFrom) return m.awayTeamId;
  return 0;
}

/** Who is out — used to fill a third-place game from the losing semi-finalists. */
export function loserOf(m: BracketMatch): number {
  if (m.status === "void") return 0;
  if (m.homeScore === null || m.awayScore === null) return 0;
  if (m.homeScore === m.awayScore) return 0;
  return m.homeScore > m.awayScore ? m.awayTeamId : m.homeTeamId;
}

/** Split "W2-1" / "L2-1" into the round and slot it points at; null if it isn't one. */
export function parseMatchRef(ref: string): { outcome: "W" | "L"; round: number; slot: number } | null {
  const m = /^([WL])(\d+)-(\d+)$/.exec(String(ref ?? "").trim());
  if (!m) return null;
  return { outcome: m[1] as "W" | "L", round: Number(m[2]), slot: Number(m[3]) };
}

/** Split "G2W" / "G2R" into the group it points at; null if it isn't one. */
export function parseGroupRef(ref: string): { group: number; place: "W" | "R" } | null {
  const m = /^G(\d+)([WR])$/.exec(String(ref ?? "").trim());
  if (!m) return null;
  return { group: Number(m[1]), place: m[2] as "W" | "R" };
}

/** "Group A" ... "Group Z", then "Group AA" if a host is running a monster. */
export function groupLabel(index: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (index < letters.length) return `Group ${letters[index]}`;
  return `Group ${letters[Math.floor(index / letters.length) - 1] ?? ""}${letters[index % letters.length]}`;
}

export type BracketSlot = {
  roundIndex: number;
  round: string;
  slot: number;
  homeTeamId: number;
  awayTeamId: number;
  homeFrom: SlotRef;
  awayFrom: SlotRef;
  /** What an empty slot says on the card: "Winner Group A", "TBD". */
  homeLabel: string;
  awayLabel: string;
};

/**
 * Draw a whole bracket 🥊
 *
 * Round one is filled with the squads in seed order — seeds past the entry list
 * become byes, which is simply an empty slot the opponent walks through. Every
 * later round is created empty, wired to the round before it with `W` refs, so
 * scoring a game is all it takes for a winner to appear in the next round.
 * With `thirdPlace`, one more empty game hangs off the two semi-final losers.
 */
export function buildBracket(
  teamIds: number[],
  options: { thirdPlace?: boolean; startIndex?: number } = {}
): BracketSlot[] {
  const ids = teamIds.filter((id) => Number(id) > 0);
  const size = bracketSizeFor(ids.length);
  const rounds = bracketRoundsFor(size);
  const start = Math.max(1, options.startIndex ?? 1);
  const seeds = seedOrder(size);
  const slots: BracketSlot[] = [];

  for (let r = 1; r <= rounds; r++) {
    const gamesInRound = size / 2 ** r;
    for (let slot = 0; slot < gamesInRound; slot++) {
      const prev = r - 1;
      const home =
        prev === 0
          ? { teamId: ids[seeds[slot * 2] - 1] ?? 0, from: "" as SlotRef, label: "Bye 🎟️" }
          : {
              teamId: 0,
              from: winnerRef(start + prev - 1, slot * 2),
              label: `Winner ${knockoutRoundLabel(size, start + prev - 1)} ${slot * 2 + 1}`,
            };
      const away =
        prev === 0
          ? { teamId: ids[seeds[slot * 2 + 1] - 1] ?? 0, from: "" as SlotRef, label: "Bye 🎟️" }
          : {
              teamId: 0,
              from: winnerRef(start + prev - 1, slot * 2 + 1),
              label: `Winner ${knockoutRoundLabel(size, start + prev - 1)} ${slot * 2 + 2}`,
            };
      slots.push({
        roundIndex: start + r - 1,
        round: knockoutRoundLabel(size, start + r - 1),
        slot,
        homeTeamId: home.teamId,
        awayTeamId: away.teamId,
        homeFrom: home.from,
        awayFrom: away.from,
        homeLabel: home.from ? home.label : home.teamId ? "" : "Bye 🎟️",
        awayLabel: away.from ? away.label : away.teamId ? "" : "Bye 🎟️",
      });
    }
  }

  if (options.thirdPlace && rounds >= 2) {
    const semi = start + rounds - 2;
    slots.push({
      roundIndex: start + rounds,
      round: "Third place",
      slot: 0,
      homeTeamId: 0,
      awayTeamId: 0,
      homeFrom: loserRef(semi, 0),
      awayFrom: loserRef(semi, 1),
      homeLabel: `Loser ${knockoutRoundLabel(size, semi)} 1`,
      awayLabel: `Loser ${knockoutRoundLabel(size, semi)} 2`,
    });
  }

  return slots;
}

/**
 * Split squads into groups 🎯 — seeded snake, so group A's top seed and group
 * B's top seed are the two strongest squads in the league, not two of them
 * landed in the same group by luck.
 */
export function makeGroups(teamIds: number[], groupSize = 4): number[][] {
  const ids = teamIds.filter((id) => Number(id) > 0);
  if (ids.length === 0) return [];
  const wanted = Math.min(Math.max(2, Math.trunc(groupSize) || 4), ids.length);
  let count = Math.max(2, Math.ceil(ids.length / wanted));
  // Never leave a group with a single squad — it would play nobody. `floor`,
  // not `ceil`: five squads across three groups is 2/2/1, and the one is the
  // squad that turns up on Saturday with no fixture.
  while (count > 2 && Math.floor(ids.length / count) < 2) count -= 1;
  const groups: number[][] = Array.from({ length: count }, () => []);
  ids.forEach((id, i) => {
    const row = Math.floor(i / count);
    const col = row % 2 === 0 ? i % count : count - 1 - (i % count);
    groups[col].push(id);
  });
  return groups.filter((g) => g.length >= 2);
}

/**
 * The knockout stage a group stage feeds: the top two of every group, seeded
 * 1A v 2B, 1B v 2A ... the way a real draw keeps group mates apart.
 */
export function knockoutFromGroups(
  groupCount: number,
  options: { thirdPlace?: boolean; startIndex?: number } = {}
): BracketSlot[] {
  const entrants = groupCount * 2;
  const size = bracketSizeFor(entrants);
  const rounds = bracketRoundsFor(size);
  const start = Math.max(1, options.startIndex ?? 1);
  const slots: BracketSlot[] = [];

  for (let r = 1; r <= rounds; r++) {
    const gamesInRound = size / 2 ** r;
    for (let slot = 0; slot < gamesInRound; slot++) {
      const entrantIndex = slot * 2;
      const home =
        r === 1
          ? { teamId: 0, from: groupRef(entrantIndex, "W", groupCount), label: groupRefLabel(entrantIndex, "W", groupCount) }
          : {
              teamId: 0,
              from: winnerRef(start + r - 2, slot * 2),
              label: `Winner ${knockoutRoundLabel(size, start + r - 2)} ${slot * 2 + 1}`,
            };
      const away =
        r === 1
          ? {
              teamId: 0,
              from: groupRef(entrantIndex + 1, "W", groupCount),
              label: groupRefLabel(entrantIndex + 1, "W", groupCount),
            }
          : {
              teamId: 0,
              from: winnerRef(start + r - 2, slot * 2 + 1),
              label: `Winner ${knockoutRoundLabel(size, start + r - 2)} ${slot * 2 + 2}`,
            };
      slots.push({
        roundIndex: start + r - 1,
        round: knockoutRoundLabel(size, start + r - 1),
        slot,
        homeTeamId: home.teamId,
        awayTeamId: away.teamId,
        homeFrom: home.from,
        awayFrom: away.from,
        homeLabel: home.label,
        awayLabel: away.label,
      });
    }
  }

  if (options.thirdPlace && rounds >= 2) {
    const semi = start + rounds - 2;
    slots.push({
      roundIndex: start + rounds,
      round: "Third place",
      slot: 0,
      homeTeamId: 0,
      awayTeamId: 0,
      homeFrom: loserRef(semi, 0),
      awayFrom: loserRef(semi, 1),
      homeLabel: `Loser ${knockoutRoundLabel(size, semi)} 1`,
      awayLabel: `Loser ${knockoutRoundLabel(size, semi)} 2`,
    });
  }

  return slots;
}

/** Entrant list for a groups-then-bracket draw: 1A, 2B, 1B, 2A, 1C, 2D, 1D, 2C ... */
function groupRef(index: number, place: "W" | "R", groupCount: number): SlotRef {
  const pair = Math.floor(index / 2);
  const flip = index % 2 === 1;
  const group = (pair + (flip ? 1 : 0)) % Math.max(1, groupCount);
  // Second place of the paired group; wraps when there's an odd number of groups.
  const place2 = place === "W" ? "R" : "W";
  const which = flip ? place2 : place;
  return which === "W" ? groupWinnerRef(group + 1) : groupRunnerUpRef(group + 1);
}

function groupRefLabel(index: number, place: "W" | "R", groupCount: number): string {
  const ref = groupRef(index, place, groupCount);
  const group = Number(ref.slice(1, -1));
  return ref.endsWith("W") ? `Winner ${groupLabel(group - 1)}` : `Runner-up ${groupLabel(group - 1)}`;
}

/**
 * Who goes through from a group 📈 — points, then goal difference, then goals
 * scored, then name. Reuses the league table so a group can never sort itself
 * differently from the table everybody is reading.
 */
export function groupQualifiers(
  group: Array<{ teamId: number; name: string; logoColor: string; teamCode: string }>,
  matches: MatchLike[]
): { winners: number[]; table: StandingRow[] } {
  const table = standingsFor(group, matches);
  return { winners: table.slice(0, 2).map((r) => r.teamId), table };
}

/** Rounds a fixture can belong to. "Friendly" covers non-league competition games. */
export const LEAGUE_ROUNDS = ["League", "Quarter-final", "Semi-final", "Final", "Friendly"] as const;

/**
 * The two numbers the whole money flow hangs on.
 *
 * 25% up front is the commitment: big enough that a squad that backs out has
 * cost the host something real (a fixture list rebuilt at short notice), small
 * enough that a captain can say yes on the group chat tonight. Of what was paid,
 * 10% comes back — the rest is the league's, which is exactly what makes the
 * deposit a deposit instead of a refundable booking.
 */
export const ENTRY_DEPOSIT_PERCENT = 25;
export const WITHDRAW_REFUND_PERCENT = 10;

/* ------------------------------------------------------------ squad states */

export const TEAM_REQUESTED = "requested";
export const TEAM_INVITED = "invited";
export const TEAM_APPROVED = "approved";
export const TEAM_REJECTED = "rejected";
export const TEAM_DECLINED = "declined";
export const TEAM_WITHDRAWN = "withdrawn";

export const TEAM_ENTRY_STATUSES = [
  TEAM_REQUESTED,
  TEAM_INVITED,
  TEAM_APPROVED,
  TEAM_REJECTED,
  TEAM_DECLINED,
  TEAM_WITHDRAWN,
] as const;

/** Statuses that hold a place in the league. */
export const TEAM_ACTIVE_STATUSES = [TEAM_APPROVED] as const;
/** Statuses still waiting on somebody — these are the ones that block a retry. */
export const TEAM_PENDING_STATUSES = [TEAM_REQUESTED, TEAM_INVITED] as const;
/** A decided no: the squad may ask again later. */
export const TEAM_CLOSED_STATUSES = [TEAM_REJECTED, TEAM_DECLINED] as const;

export function isPendingEntry(status: string): boolean {
  return (TEAM_PENDING_STATUSES as readonly string[]).includes(status);
}

export function isActiveEntry(status: string): boolean {
  return (TEAM_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** How a squad's place in the league reads on a card. */
export function entryStatusLabel(status: string): { label: string; emoji: string } {
  switch (status) {
    case TEAM_REQUESTED:
      return { label: "Asked to join — host deciding", emoji: "⏳" };
    case TEAM_INVITED:
      return { label: "Invited — waiting for the captain", emoji: "📨" };
    case TEAM_APPROVED:
      return { label: "In the league", emoji: "✅" };
    case TEAM_REJECTED:
      return { label: "Request declined", emoji: "🚫" };
    case TEAM_DECLINED:
      return { label: "Invite declined", emoji: "🙅" };
    case TEAM_WITHDRAWN:
      return { label: "Withdrew", emoji: "🏳️" };
    default:
      return { label: status, emoji: "•" };
  }
}

export function leagueStatusLabel(status: string): { label: string; emoji: string } {
  switch (status) {
    case "registration":
      return { label: "Taking entries", emoji: "📝" };
    case "ongoing":
      return { label: "Under way", emoji: "🔴" };
    case "completed":
      return { label: "Finished", emoji: "🏁" };
    case "cancelled":
      return { label: "Cancelled", emoji: "🚫" };
    default:
      return { label: status, emoji: "•" };
  }
}

export function leagueVisibilityLabel(visibility: string): { label: string; emoji: string } {
  return visibility === "private"
    ? { label: "Private — invited squads only", emoji: "🔒" }
    : { label: "Open listing", emoji: "🌍" };
}

/* ------------------------------------------------------------------- money */

/** The minimum a squad must have paid to hold its place. Rounded up: never short. */
export function depositFor(entryFee: number, depositPercent = ENTRY_DEPOSIT_PERCENT): number {
  const fee = Math.max(0, Math.trunc(Number(entryFee) || 0));
  const pct = clampPercent(depositPercent, ENTRY_DEPOSIT_PERCENT);
  if (fee <= 0 || pct <= 0) return 0;
  return Math.ceil((fee * pct) / 100);
}

/** What a departing squad gets back — a tenth of what it paid, rounded down. */
export function refundFor(paidAmount: number, refundPercent = WITHDRAW_REFUND_PERCENT): number {
  const paid = Math.max(0, Math.trunc(Number(paidAmount) || 0));
  const pct = clampPercent(refundPercent, WITHDRAW_REFUND_PERCENT);
  if (paid <= 0 || pct <= 0) return 0;
  return Math.floor((paid * pct) / 100);
}

function clampPercent(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.trunc(n)));
}

export type PaymentState = {
  /** "unpaid" | "partial" | "deposit" | "paid" | "refunded" */
  status: string;
  label: string;
  emoji: string;
  /** What is due up front, and still missing. */
  deposit: number;
  depositMet: boolean;
  /** Rupees left before the squad has paid the entry fee in full. */
  due: number;
  paid: number;
  refundable: number;
  /**
   * True once the squad's money belongs to the league — their first match has
   * kicked off. `refundable` is already 0 when this is set, so a UI can't show
   * a payout that the server would refuse.
   */
  locked: boolean;
  /** Why it locked, in the words the panel shows. */
  lockReason: string;
};

/**
 * One place that answers "where does this squad stand on money?" — used by the
 * host console, the squad's own panel and the listing chip, so the three can
 * never disagree about whether a place is locked.
 */
export function paymentState(input: {
  entryFee: number;
  paidAmount: number;
  refundedAmount?: number;
  depositPercent?: number;
  refundPercent?: number;
  /** Set by callers that know the squad has already taken the field. */
  lock?: MoneyLock;
  /**
   * Where the entry stands right now. A squad that backed out, took its refund
   * and then came back keeps the old `refundedAmount` on its row, so without
   * this the chip would still read "Backed out" while the squad is sitting in
   * the league — the refund belongs to the exit, not to the return.
   */
  status?: string;
}): PaymentState {
  const fee = Math.max(0, Math.trunc(Number(input.entryFee) || 0));
  const paid = Math.max(0, Math.trunc(Number(input.paidAmount) || 0));
  const refunded = Math.max(0, Math.trunc(Number(input.refundedAmount) || 0));
  const deposit = depositFor(fee, input.depositPercent ?? ENTRY_DEPOSIT_PERCENT);
  // A squad that has played has no refund coming: the money is the league's,
  // which is the whole reason the deposit was taken before the first kick-off.
  const locked = !!input.lock?.locked;
  const refundable = locked ? 0 : refundFor(paid, input.refundPercent ?? WITHDRAW_REFUND_PERCENT);
  const lockReason = input.lock?.reason ?? "";
  const due = Math.max(0, fee - paid);
  const depositMet = paid >= deposit;
  const tail = { deposit, depositMet, due, paid, refundable, locked, lockReason };

  const withdrawn = input.status === TEAM_WITHDRAWN;
  if (withdrawn && refunded > 0 && due > 0) {
    return { status: "refunded", label: "Backed out — part refunded", emoji: "↩️", ...tail };
  }
  if (fee <= 0) {
    return { status: "paid", label: "Free entry", emoji: "🎟️", deposit: 0, depositMet: true, due: 0, paid, refundable, locked, lockReason };
  }
  if (paid <= 0) {
    return { status: "unpaid", label: "Nothing paid yet", emoji: "🕓", ...tail };
  }
  if (paid < deposit) {
    return {
      status: "partial",
      label: `Rs. ${deposit - paid} short of the ${Math.round((deposit / Math.max(1, fee)) * 100)}% deposit`,
      emoji: "🟠",
      ...tail,
    };
  }
  if (due > 0) {
    return { status: "deposit", label: `Deposit in — Rs. ${due} to settle`, emoji: "🟢", ...tail };
  }
  return { status: "paid", label: "Entry fee paid in full", emoji: "💯", ...tail, due: 0 };
}

/* ------------------------------------------------------- the money lock 🔒 */

/**
 * Once a squad takes the field, its entry fee belongs to the league.
 *
 * The rule a captain reads on the listing is "a tenth back if you walk", and it
 * is true right up until the first kick-off — after that the host has a pitch
 * booked, a fixture list built around this squad and (in a bracket) an opponent
 * who would be left with nobody to play. So from the first game onwards there is
 * nothing to withdraw and nothing to refund, whether the squad is still in, has
 * lost and gone out, or has played every game it was ever going to play.
 *
 * Two ways in, because both mean the money has been earned: the squad has a
 * result on the board, or one of its fixtures has a kick-off time behind it.
 * A fixture the host voided (`status: "void"`) doesn't count — nobody played it.
 */
export type MoneyLock = { locked: boolean; reason: string };

export type LockMatch = {
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  date: string;
  startTime: string;
};

export function moneyLockedFor(
  teamId: number,
  matches: LockMatch[],
  now: Date = new Date()
): MoneyLock {
  const mine = matches.filter(
    (m) => m.homeTeamId === teamId || m.awayTeamId === teamId
  );

  if (mine.some((m) => hasResult(m) && m.status !== "void")) {
    return {
      locked: true,
      reason: "You've played in this league — the entry fee is locked in and stays with it 🔒",
    };
  }

  const kickedOff = mine.find((m) => m.status !== "void" && startedAt(m, now));
  if (kickedOff) {
    return {
      locked: true,
      reason: `Your ${kickedOff.date ? `${leagueDateLabel(kickedOff.date)} ` : ""}match has kicked off — the entry fee is locked in and stays with the league 🔒`,
    };
  }

  return { locked: false, reason: "" };
}

/** Has this fixture's kick-off passed? A date with no time counts from midnight. */
function startedAt(m: { date: string; startTime: string }, now: Date): boolean {
  const d = String(m.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = /^\d{2}:\d{2}$/.test(String(m.startTime ?? "").trim()) ? m.startTime : "00:00";
  const kickOff = new Date(`${d}T${t}:00`);
  if (Number.isNaN(kickOff.getTime())) return false;
  return now > kickOff;
}

/**
 * The answer the withdraw button gets. The captain is turned away once the money
 * is locked; the host may still take a squad out of the league (somebody has to
 * be able to), but not hand money back that the league has already earned.
 */
export function withdrawCheck(input: {
  isHost: boolean;
  lock: MoneyLock;
  teamName?: string;
}): { ok: boolean; reason: string; refundBlocked: boolean } {
  const who = input.teamName ? `${input.teamName}'s` : "the";
  if (!input.lock.locked) return { ok: true, reason: "", refundBlocked: false };
  if (input.isHost) {
    return {
      ok: true,
      reason: `${who} money is locked — they can be taken out of the league, but nothing is refunded.`,
      refundBlocked: true,
    };
  }
  return {
    ok: false,
    reason: `${input.lock.reason} Withdrawing closed when ${who} first match kicked off — talk to the host if something's genuinely wrong 🙏`,
    refundBlocked: true,
  };
}

/**
 * May this squad be let in? The gate the host hits when approving a request:
 * a squad holds a place once the deposit is in the till — cash the host entered
 * themselves counts, because half of Nepal still settles this on the sideline.
 */
export function approvalCheck(input: {
  entryFee: number;
  paidAmount: number;
  depositPercent?: number;
}): { ok: boolean; reason: string } {
  const fee = Math.max(0, Math.trunc(Number(input.entryFee) || 0));
  const paid = Math.max(0, Math.trunc(Number(input.paidAmount) || 0));
  const deposit = depositFor(fee, input.depositPercent ?? ENTRY_DEPOSIT_PERCENT);
  if (fee <= 0 || deposit <= 0) return { ok: true, reason: "" };
  if (paid >= deposit) return { ok: true, reason: "" };
  return {
    ok: false,
    reason: `Rs. ${deposit - paid} of the Rs. ${deposit} deposit is still missing (${ENTRY_DEPOSIT_PERCENT}% of the Rs. ${fee} entry fee). Ask the captain to pay it from the league page, or record the cash they handed you.`,
  };
}

/* -------------------------------------------------------------- prize lines */

export type PrizeLine = { place: string; prize: string };

/**
 * "Champion: Rs. 40,000 / Runner-up: Rs. 20,000" → rows.
 *
 * Free text box in, structured list out: the host keeps writing the split the
 * way they'd say it out loud, and the page renders it as a proper prize table.
 * A line without a colon ("Trophy + free hours") still counts — the whole thing
 * is one prize.
 */
export function parsePrizeBreakdown(text: string): PrizeLine[] {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((line) => {
      const at = line.indexOf(":");
      if (at <= 0) return { place: "Prize", prize: line };
      return { place: line.slice(0, at).trim(), prize: line.slice(at + 1).trim() };
    })
    .filter((row) => row.prize.length > 0);
}

/* ------------------------------------------------------------------ tables */

export type StandingRow = {
  teamId: number;
  name: string;
  logoColor: string;
  teamCode: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  /** Last results, newest last — "W", "D", "L". */
  form: string[];
};

export type MatchLike = {
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
};

export type TeamLike = {
  teamId: number;
  name: string;
  logoColor: string;
  teamCode: string;
};

const WIN_POINTS = 3;
const DRAW_POINTS = 1;

/**
 * Build the league table: three points for a win, one for a draw, sorted on
 * points → goal difference → goals scored → name. Only played games count
 * (a fixture with no score is a fixture, not a result).
 */
export function standingsFor(teams: TeamLike[], matches: MatchLike[]): StandingRow[] {
  const rows = new Map<number, StandingRow>();
  for (const t of teams) {
    rows.set(t.teamId, {
      teamId: t.teamId,
      name: t.name,
      logoColor: t.logoColor,
      teamCode: t.teamCode,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
      form: [],
    });
  }

  const played = matches
    .filter((m) => m.homeScore !== null && m.awayScore !== null && m.status !== "void")
    .slice()
    .sort((a, b) => a.homeTeamId - b.homeTeamId || a.awayTeamId - b.awayTeamId);

  for (const m of played) {
    const home = rows.get(m.homeTeamId);
    const away = rows.get(m.awayTeamId);
    const hs = Number(m.homeScore) || 0;
    const as = Number(m.awayScore) || 0;
    if (home) applyResult(home, hs, as);
    if (away) applyResult(away, as, hs);
  }

  return [...rows.values()]
    .map((r) => ({ ...r, goalDiff: r.goalsFor - r.goalsAgainst }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor ||
        a.name.localeCompare(b.name)
    );
}

function applyResult(row: StandingRow, scored: number, conceded: number) {
  row.played += 1;
  row.goalsFor += scored;
  row.goalsAgainst += conceded;
  if (scored > conceded) {
    row.won += 1;
    row.points += WIN_POINTS;
    row.form.push("W");
  } else if (scored === conceded) {
    row.drawn += 1;
    row.points += DRAW_POINTS;
    row.form.push("D");
  } else {
    row.lost += 1;
    row.form.push("L");
  }
  if (row.form.length > 5) row.form = row.form.slice(-5);
}

/** One squad's competitive record — what a team profile shows. */
export type TeamRecord = {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  winRate: number;
  form: string[];
};

export function recordFor(teamId: number, matches: MatchLike[]): TeamRecord {
  const row: StandingRow = {
    teamId,
    name: "",
    logoColor: "",
    teamCode: "",
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    form: [],
  };
  for (const m of matches) {
    if (m.homeScore === null || m.awayScore === null || m.status === "void") continue;
    // Only games this squad actually played — the caller may pass the whole
    // competition, because a team profile rarely knows which rows matter.
    if (m.homeTeamId !== teamId && m.awayTeamId !== teamId) continue;
    const hs = Number(m.homeScore) || 0;
    const as = Number(m.awayScore) || 0;
    if (m.homeTeamId === teamId) applyResult(row, hs, as);
    else applyResult(row, as, hs);
  }
  row.goalDiff = row.goalsFor - row.goalsAgainst;
  return {
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDiff: row.goalDiff,
    points: row.points,
    winRate: row.played > 0 ? Math.round((row.won / row.played) * 100) : 0,
    form: row.form,
  };
}

/** Does a fixture count as played? Used to decide if the table can move. */
export function hasResult(m: { homeScore: number | null; awayScore: number | null }): boolean {
  return m.homeScore !== null && m.awayScore !== null;
}

/* ------------------------------------------------------------------- dates */

/** "Sat, 21 Sep" for a fixture; blank in, "TBD" out. */
export function leagueDateLabel(iso: string): string {
  const t = String(iso ?? "").trim();
  if (!t) return "TBD";
  try {
    const d = new Date(t + "T00:00:00");
    if (Number.isNaN(d.getTime())) return t;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return t;
  }
}

export function daysUntil(iso: string, now: Date = new Date()): number | null {
  const t = String(iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/* ----------------------------------------------------- what may be typed in */

/**
 * Keep a payment box inside what the squad actually owes 💰
 *
 * Both the host's "Record cash" field and a captain's amount field run through
 * this: an entry fee is a ceiling, not a suggestion, and the ledger, the
 * deposit gate and the 10% refund maths all believe whatever lands in
 * `paidAmount`. Typing four thousand on a two thousand entry would quietly
 * make all three of them wrong, so the box won't hold it — and the API refuses
 * it again on the way in, because a browser can be talked into anything.
 *
 * Returns `""` for an empty box so a half-typed field stays editable.
 */
export function clampAmountInput(value: string, owed: number): string {
  const ceiling = Math.max(0, Math.trunc(Number(owed) || 0));
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return "";
  const n = Math.floor(Number(trimmed));
  if (!Number.isFinite(n) || n <= 0) return "";
  const clamped = Math.min(n, ceiling);
  // Nothing owed means there is nothing to type — clear the box rather than
  // parking a meaningless 0 in it.
  if (clamped <= 0) return "";
  return String(clamped);
}
