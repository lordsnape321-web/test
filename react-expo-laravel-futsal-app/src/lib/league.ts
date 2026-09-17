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
}): PaymentState {
  const fee = Math.max(0, Math.trunc(Number(input.entryFee) || 0));
  const paid = Math.max(0, Math.trunc(Number(input.paidAmount) || 0));
  const refunded = Math.max(0, Math.trunc(Number(input.refundedAmount) || 0));
  const deposit = depositFor(fee, input.depositPercent ?? ENTRY_DEPOSIT_PERCENT);
  const refundable = refundFor(paid, input.refundPercent ?? WITHDRAW_REFUND_PERCENT);
  const due = Math.max(0, fee - paid);
  const depositMet = paid >= deposit;

  if (refunded > 0 && due > 0) {
    return { status: "refunded", label: "Backed out — part refunded", emoji: "↩️", deposit, depositMet, due, paid, refundable };
  }
  if (fee <= 0) {
    return { status: "paid", label: "Free entry", emoji: "🎟️", deposit: 0, depositMet: true, due: 0, paid, refundable };
  }
  if (paid <= 0) {
    return { status: "unpaid", label: "Nothing paid yet", emoji: "🕓", deposit, depositMet: false, due, paid, refundable };
  }
  if (paid < deposit) {
    return {
      status: "partial",
      label: `Rs. ${deposit - paid} short of the ${Math.round((deposit / Math.max(1, fee)) * 100)}% deposit`,
      emoji: "🟠",
      deposit,
      depositMet: false,
      due,
      paid,
      refundable,
    };
  }
  if (due > 0) {
    return { status: "deposit", label: `Deposit in — Rs. ${due} to settle`, emoji: "🟢", deposit, depositMet: true, due, paid, refundable };
  }
  return { status: "paid", label: "Entry fee paid in full", emoji: "💯", deposit, depositMet: true, due: 0, paid, refundable };
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
