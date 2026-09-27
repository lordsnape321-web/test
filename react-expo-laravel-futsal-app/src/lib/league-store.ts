/**
 * League data access 🗄️ — everything that touches Postgres for tournaments.
 *
 * The pure rules live in `league.ts`; this file is the other half: gathering
 * rows, joining them into the shapes the pages render, and — the part that
 * matters most — deciding **who may see what**. A private league must not leak
 * its table, its fixtures or its photos to a stranger, and a squad that backed
 * out must lose access to the album it played in. Those checks live here so
 * every route asks the same question and gets the same answer, instead of each
 * handler inventing its own `if`.
 */
import { db, ensureCompetitionBookingColumns } from "@/db";
import {
  bookings,
  courts,
  teamMembers,
  teams,
  tournamentMatches,
  tournamentMedia,
  tournamentPayments,
  tournamentTeams,
  tournaments,
  users,
  venues,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  TEAM_APPROVED,
  TEAM_INVITED,
  TEAM_REQUESTED,
  TEAM_WITHDRAWN,
  depositFor,
  moneyLockedFor,
  paymentState,
  recordFor,
  standingsFor,
  type MatchLike,
  type PaymentState,
  type StandingRow,
  type TeamRecord,
} from "./league";

/* ------------------------------------------------------------------ shapes */

export type LeagueSummary = {
  id: number;
  name: string;
  format: string;
  /** "round_robin" | "knockout" | "group_knockout" — how a winner is decided. */
  mode: string;
  thirdPlace: boolean;
  groupSize: number;
  maxTeams: number;
  entryFee: number;
  depositPercent: number;
  refundPercent: number;
  deposit: number;
  prizePool: number;
  startsAt: string;
  endsAt: string;
  closesAt: string;
  matchDays: string;
  visibility: string;
  status: string;
  bannerUrl: string;
  description: string;
  hostId: number;
  hostName: string;
  hostRole: string;
  venueId: number | null;
  venueName: string;
  venueCity: string;
  /** Squads holding a place. */
  approvedTeams: number;
  /** Requests + invites still open — only the host sees the real number. */
  pendingTeams: number;
  playedMatches: number;
  totalMatches: number;
  teams: Array<{ teamId: number; name: string; logoColor: string; teamCode: string }>;
  standings: StandingRow[];
  /** How this viewer relates to the league, when logged in. */
  viewer: {
    isHost: boolean;
    /** The viewer's squads inside this league, with their money state. */
    myTeams: Array<{
      teamId: number;
      teamName: string;
      status: string;
      isCaptain: boolean;
      paidAmount: number;
      payment: PaymentState;
    }>;
    /** True when the viewer may read fixtures/albums (host or a squad in it). */
    canSeeInside: boolean;
  } | null;
};

export type LeagueTeamRow = {
  teamId: number;
  name: string;
  teamCode: string;
  logoColor: string;
  level: string;
  homeGround: string;
  captainId: number;
  captainName: string;
  memberCount: number;
  status: string;
  message: string;
  requestedBy: number;
  paidAmount: number;
  refundedAmount: number;
  /** The medium the captain picked to pay by, and any proof they attached. */
  payMethod: string;
  receiptUrl: string;
  payment: PaymentState;
  createdAt: string | null;
  decidedAt: string | null;
};

export type LeagueMatchRow = {
  id: number;
  round: string;
  /** 0 for a league or group game; 1..n for a knockout round. */
  bracketRound: number;
  slot: number;
  homeFrom: string;
  awayFrom: string;
  homeLabel: string;
  awayLabel: string;
  /** 0 while a bracket slot waits on the game before it. */
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  homeLogoColor: string;
  awayLogoColor: string;
  date: string;
  startTime: string;
  courtId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  bookingId: number | null;
  notes: string;
  updatedAt: string | null;
  mediaCount: number;
};

export type LeagueMediaRow = {
  id: number;
  matchId: number | null;
  kind: string;
  url: string;
  caption: string;
  credit: string;
  uploadedBy: number;
  uploaderName: string;
  createdAt: string | null;
  /** Who may see it, spelled out for the UI: "Semi-final • A vs B" or "Whole league". */
  scope: string;
};

export type LeaguePaymentRow = {
  id: number;
  teamId: number;
  teamName: string;
  userId: number;
  kind: string;
  amount: number;
  method: string;
  reference: string;
  recordedBy: number;
  createdAt: string | null;
};

export type LeagueDetail = LeagueSummary & {
  courtId: number | null;
  courtName: string;
  rules: string;
  contactPhone: string;
  /** Raw prize text, so the host's edit form opens with what they typed. */
  prizeBreakdown: string;
  prizeLines: Array<{ place: string; prize: string }>;
  /** Everyone the league has talked to, host-only. */
  allTeams: LeagueTeamRow[];
  matches: LeagueMatchRow[];
  media: LeagueMediaRow[];
  payments: LeaguePaymentRow[];
  /** Team ids the viewer plays for in this league (empty for a host). */
  myTeamIds: number[];
};

/* ----------------------------------------------------------------- access */

/**
 * The three questions every league read starts with: is this viewer the host,
 * which squads do they belong to, and are any of those squads in the league?
 */
export async function leagueAccess(tournamentId: number, viewerId: number) {
  const rows = await db
    .select()
    .from(tournamentTeams)
    .where(eq(tournamentTeams.tournamentId, tournamentId));
  const tournament = (
    await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
  )[0];
  if (!tournament) return null;

  const isHost = Number(viewerId) > 0 && tournament.hostId === Number(viewerId);

  let myTeamIds: number[] = [];
  if (Number(viewerId) > 0) {
    const memberships = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, Number(viewerId)));
    const mine = new Set(memberships.map((m) => m.teamId));
    myTeamIds = rows
      .filter((r) => mine.has(r.teamId))
      .map((r) => r.teamId);
  }

  const liveRows = rows.filter((r) => r.status !== TEAM_WITHDRAWN);
  const myLive = rows.filter(
    (r) => myTeamIds.includes(r.teamId) && (r.status === TEAM_APPROVED || r.status === TEAM_INVITED || r.status === TEAM_REQUESTED)
  );
  // A squad that withdrew keeps its history but loses the private rooms:
  // fixtures and albums are for the squads still in the fight.
  const inLeague = myLive.length > 0;

  const canSeeInside =
    isHost || inLeague || (tournament.visibility === "public" && rows.some((r) => myTeamIds.includes(r.teamId) && r.status === TEAM_APPROVED));

  return { tournament, rows, liveRows, isHost, myTeamIds, canSeeInside };
}

export async function isLeagueHost(tournamentId: number, userId: number): Promise<boolean> {
  const t = (await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)))[0];
  return !!t && Number(t.hostId) === Number(userId);
}

/**
 * Which squads played a given fixture — the guest list for that fixture's
 * album. A photo of the semi-final belongs to the two teams in it, not to the
 * whole league.
 */
export async function squadsInMatch(matchId: number): Promise<number[]> {
  const m = (
    await db.select().from(tournamentMatches).where(eq(tournamentMatches.id, matchId))
  )[0];
  return m ? [m.homeTeamId, m.awayTeamId] : [];
}

export type MediaViewer = {
  isHost: boolean;
  teamIds: number[];
  canSeeInside: boolean;
};

/** The album rule, in one function: host always, a squad only for its own games. */
export function canViewMedia(
  media: { matchId: number | null },
  matchTeamIds: number[],
  viewer: MediaViewer
): boolean {
  if (viewer.isHost) return true;
  if (!viewer.canSeeInside) return false;
  if (media.matchId === null) return true; // the league-wide album: any squad in it
  return matchTeamIds.some((id) => viewer.teamIds.includes(id));
}

/* --------------------------------------------------------------- summaries */

function iso(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The list the leagues page (and the home rail) renders.
 *
 * `viewerId` decides what is even in the result set: public leagues always,
 * private ones only for their host and the squads invited to or in them.
 */
export async function listLeagues(opts: {
  viewerId?: number;
  hostId?: number;
  venueId?: number;
  status?: string;
  q?: string;
  limit?: number;
}): Promise<LeagueSummary[]> {
  const viewerId = Number(opts.viewerId ?? 0) || 0;
  const [all, allTeams, allVenues, allUsers, allMatches, allEntries] = await Promise.all([
    db.select().from(tournaments),
    db.select().from(teams),
    db.select().from(venues),
    db.select().from(users),
    db.select().from(tournamentMatches),
    db.select().from(tournamentTeams),
  ]);

  let myTeamIds: number[] = [];
  if (viewerId > 0) {
    const memberships = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, viewerId));
    myTeamIds = memberships.map((m) => m.teamId);
  }

  const q = String(opts.q ?? "").trim().toLowerCase();
  let rows = all;

  if (opts.hostId) rows = rows.filter((t) => t.hostId === Number(opts.hostId));
  if (opts.venueId) rows = rows.filter((t) => t.venueId === Number(opts.venueId));
  if (opts.status) rows = rows.filter((t) => t.status === opts.status);

  rows = rows.filter((t) => {
    const entries = allEntries.filter((e) => e.tournamentId === t.id);
    const mine = entries.filter((e) => myTeamIds.includes(e.teamId));
    if (t.visibility === "public") return true;
    // Private: host, invited squads and squads already in it — nobody else,
    // not even in a list they'd have to know the name of.
    if (viewerId > 0 && t.hostId === viewerId) return true;
    return mine.some(
      (e) => e.status === TEAM_APPROVED || e.status === TEAM_INVITED || e.status === TEAM_REQUESTED
    );
  });

  if (q) {
    rows = rows.filter((t) => {
      const venue = allVenues.find((v) => v.id === t.venueId);
      const hay = `${t.name} ${venue?.name ?? ""} ${venue?.city ?? ""} ${t.format}`.toLowerCase();
      return hay.includes(q);
    });
  }

  rows = rows
    .slice()
    .sort((a, b) => {
      // Leagues with games coming up first, then the ones taking entries.
      const rank = (s: string) => (s === "ongoing" ? 0 : s === "registration" ? 1 : 2);
      return rank(a.status) - rank(b.status) || String(a.startsAt).localeCompare(String(b.startsAt));
    });

  const out: LeagueSummary[] = [];
  for (const t of rows.slice(0, opts.limit ?? 60)) {
    const entries = allEntries.filter((e) => e.tournamentId === t.id);
    const approved = entries.filter((e) => e.status === TEAM_APPROVED);
    const pending = entries.filter(
      (e) => e.status === TEAM_REQUESTED || e.status === TEAM_INVITED
    );
    const venue = allVenues.find((v) => v.id === t.venueId);
    const host = allUsers.find((u) => u.id === t.hostId);
    const matches = allMatches.filter((m) => m.tournamentId === t.id);

    const teamLikes = approved
      .map((e) => {
        const team = allTeams.find((x) => x.id === e.teamId);
        if (!team) return null;
        return {
          teamId: team.id,
          name: team.name,
          logoColor: team.logoColor,
          teamCode: team.teamCode ?? "",
        };
      })
      .filter(Boolean) as LeagueSummary["teams"];

    const myTeams = entries
      .filter((e) => myTeamIds.includes(e.teamId))
      .map((e) => {
        const team = allTeams.find((x) => x.id === e.teamId);
        return {
          teamId: e.teamId,
          teamName: team?.name ?? "Your squad",
          status: e.status,
          isCaptain: !!team && team.captainId === viewerId,
          paidAmount: e.paidAmount,
          payment: paymentState({
            entryFee: t.entryFee,
            paidAmount: e.paidAmount,
            refundedAmount: e.refundedAmount,
            depositPercent: t.depositPercent,
            refundPercent: t.refundPercent,
            lock: moneyLockedFor(e.teamId, matches),
            status: e.status,
          }),
        };
      });

    const isHost = viewerId > 0 && t.hostId === viewerId;
    const mineInLeague = myTeams.some(
      (m) => m.status === TEAM_APPROVED || m.status === TEAM_INVITED || m.status === TEAM_REQUESTED
    );

    out.push({
      id: t.id,
      name: t.name,
      format: t.format,
      mode: t.mode,
      thirdPlace: t.thirdPlace,
      groupSize: t.groupSize,
      maxTeams: t.maxTeams,
      entryFee: t.entryFee,
      depositPercent: t.depositPercent,
      refundPercent: t.refundPercent,
      deposit: depositFor(t.entryFee, t.depositPercent),
      prizePool: t.prizePool,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      closesAt: t.closesAt,
      matchDays: t.matchDays,
      visibility: t.visibility,
      status: t.status,
      bannerUrl: t.bannerUrl,
      description: t.description,
      hostId: t.hostId,
      hostName: host?.name ?? "Host",
      hostRole: t.hostRole,
      venueId: t.venueId,
      venueName: venue?.name ?? "Ground to be confirmed",
      venueCity: venue?.city ?? "",
      approvedTeams: approved.length,
      // A pending count is only interesting to the host — the public card
      // shows spots left, not who is waiting on a decision.
      pendingTeams: isHost ? pending.length : 0,
      playedMatches: matches.filter((m) => m.status === "played").length,
      totalMatches: matches.length,
      teams: teamLikes,
      standings: standingsFor(teamLikes, matches),
      viewer:
        viewerId > 0
          ? {
              isHost,
              myTeams,
              canSeeInside: isHost || mineInLeague,
            }
          : null,
    });
  }
  return out;
}

/** Everything one league page needs, already filtered for this viewer. */
export async function leagueDetail(
  tournamentId: number,
  viewerId: number
): Promise<LeagueDetail | null> {
  const access = await leagueAccess(tournamentId, viewerId);
  if (!access) return null;
  const { tournament: t, isHost, myTeamIds, canSeeInside } = access;

  const [allTeams, allUsers, allVenues, allCourts, allMatches, allMedia, allPayments, allEntries] =
    await Promise.all([
      db.select().from(teams),
      db.select().from(users),
      db.select().from(venues),
      db.select().from(courts),
      db.select().from(tournamentMatches).where(eq(tournamentMatches.tournamentId, t.id)),
      db.select().from(tournamentMedia).where(eq(tournamentMedia.tournamentId, t.id)),
      db.select().from(tournamentPayments).where(eq(tournamentPayments.tournamentId, t.id)),
      db.select().from(tournamentTeams).where(eq(tournamentTeams.tournamentId, t.id)),
    ]);

  const teamById = (id: number) => allTeams.find((x) => x.id === id);
  const userById = (id: number) => allUsers.find((x) => x.id === id);

  const memberCounts = await db.select().from(teamMembers);

  const teamRows: LeagueTeamRow[] = allEntries.map((e) => {
    const team = teamById(e.teamId);
    return {
      teamId: e.teamId,
      name: team?.name ?? "Removed squad",
      teamCode: team?.teamCode ?? "",
      logoColor: team?.logoColor ?? "#16a34a",
      level: team?.level ?? "Intermediate",
      homeGround: team?.homeGround ?? "",
      captainId: team?.captainId ?? 0,
      captainName: userById(team?.captainId ?? 0)?.name ?? "",
      memberCount: memberCounts.filter((m) => m.teamId === e.teamId).length,
      status: e.status,
      message: e.message,
      requestedBy: e.requestedBy,
      paidAmount: e.paidAmount,
      refundedAmount: e.refundedAmount,
      payMethod: e.payMethod,
      receiptUrl: e.receiptUrl,
      payment: paymentState({
        entryFee: t.entryFee,
        paidAmount: e.paidAmount,
        refundedAmount: e.refundedAmount,
        depositPercent: t.depositPercent,
        refundPercent: t.refundPercent,
        lock: moneyLockedFor(e.teamId, allMatches),
        status: e.status,
      }),
      createdAt: iso(e.createdAt),
      decidedAt: iso(e.decidedAt),
    };
  });

  const approvedIds = teamRows.filter((r) => r.status === TEAM_APPROVED).map((r) => r.teamId);
  const matchRows: LeagueMatchRow[] = allMatches
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id)
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
      // An empty bracket slot is named by where its squad will come from, so the
      // card reads "Winner Group A" instead of a meaningless "Squad".
      homeTeamName: teamById(m.homeTeamId)?.name ?? m.homeLabel ?? "TBD",
      awayTeamName: teamById(m.awayTeamId)?.name ?? m.awayLabel ?? "TBD",
      homeLogoColor: teamById(m.homeTeamId)?.logoColor ?? "#16a34a",
      awayLogoColor: teamById(m.awayTeamId)?.logoColor ?? "#2563eb",
      date: m.date,
      startTime: m.startTime,
      courtId: m.courtId,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      status: m.status,
      bookingId: m.bookingId,
      notes: m.notes,
      updatedAt: iso(m.updatedAt),
      mediaCount: allMedia.filter((x) => x.matchId === m.id).length,
    }));

  // Fixtures stay hidden from people with no business reading them. Within the
  // league everyone sees every fixture — that is what a league is.
  const visibleMatches = canSeeInside ? matchRows : [];

  const mediaRows: LeagueMediaRow[] = allMedia
    .map((m) => ({ m, squadIds: m.matchId ? matchTeams(m.matchId, matchRows) : [] }))
    .filter(({ m, squadIds }) => canViewMedia({ matchId: m.matchId }, squadIds, { isHost, teamIds: myTeamIds, canSeeInside }))
    .sort((a, b) => (b.m.createdAt?.getTime?.() ?? 0) - (a.m.createdAt?.getTime?.() ?? 0))
    .map(({ m }) => {
      const match = m.matchId ? matchRows.find((x) => x.id === m.matchId) : null;
      return {
        id: m.id,
        matchId: m.matchId,
        kind: m.kind,
        url: m.url,
        caption: m.caption,
        credit: m.credit,
        uploadedBy: m.uploadedBy,
        uploaderName: userById(m.uploadedBy)?.name ?? "Host",
        createdAt: iso(m.createdAt),
        scope: match
          ? `${match.round} • ${match.homeTeamName} vs ${match.awayTeamName}`
          : "Whole league",
      };
    });

  // The ledger is the host's bookkeeping; a captain sees their own row through
  // the squad panel instead, so we only ship the full list to the host.
  const paymentRows: LeaguePaymentRow[] = isHost
    ? allPayments
        .slice()
        .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))
        .map((p) => ({
          id: p.id,
          teamId: p.teamId,
          teamName: teamById(p.teamId)?.name ?? "Squad",
          userId: p.userId,
          kind: p.kind,
          amount: p.amount,
          method: p.method,
          reference: p.reference,
          recordedBy: p.recordedBy,
          createdAt: iso(p.createdAt),
        }))
    : [];

  const venue = allVenues.find((v) => v.id === t.venueId);
  const court = allCourts.find((c) => c.id === t.courtId);
  const host = userById(t.hostId);

  const teamLikes = approvedIds
    .map((id) => {
      const team = teamById(id);
      if (!team) return null;
      return {
        teamId: team.id,
        name: team.name,
        logoColor: team.logoColor,
        teamCode: team.teamCode ?? "",
      };
    })
    .filter(Boolean) as LeagueSummary["teams"];

  const myTeams = teamRows
    .filter((r) => myTeamIds.includes(r.teamId))
    .map((r) => ({
      teamId: r.teamId,
      teamName: r.name,
      status: r.status,
      isCaptain: r.captainId === Number(viewerId),
      paidAmount: r.paidAmount,
      payment: r.payment,
    }));

  return {
    id: t.id,
    name: t.name,
    format: t.format,
    mode: t.mode,
    thirdPlace: t.thirdPlace,
    groupSize: t.groupSize,
    maxTeams: t.maxTeams,
    entryFee: t.entryFee,
    depositPercent: t.depositPercent,
    refundPercent: t.refundPercent,
    deposit: depositFor(t.entryFee, t.depositPercent),
    prizePool: t.prizePool,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    closesAt: t.closesAt,
    matchDays: t.matchDays,
    visibility: t.visibility,
    status: t.status,
    bannerUrl: t.bannerUrl,
    description: t.description,
    hostId: t.hostId,
    hostName: host?.name ?? "Host",
    hostRole: t.hostRole,
    venueId: t.venueId,
    venueName: venue?.name ?? "Ground to be confirmed",
    venueCity: venue?.city ?? "",
    approvedTeams: approvedIds.length,
    pendingTeams: isHost
      ? teamRows.filter((r) => r.status === TEAM_REQUESTED || r.status === TEAM_INVITED).length
      : 0,
    playedMatches: matchRows.filter((m) => m.status === "played").length,
    totalMatches: matchRows.length,
    teams: teamLikes,
    standings: standingsFor(teamLikes, matchRows),
    viewer: {
      isHost,
      myTeams,
      canSeeInside,
    },
    courtId: t.courtId,
    courtName: court?.name ?? "",
    rules: t.rules,
    contactPhone: t.contactPhone,
    prizeBreakdown: t.prizeBreakdown,
    prizeLines: parsePrize(t.prizeBreakdown),
    allTeams: isHost ? teamRows : teamRows.filter((r) => r.status === TEAM_APPROVED),
    matches: visibleMatches,
    media: mediaRows,
    payments: paymentRows,
    myTeamIds,
  };
}

function matchTeams(matchId: number, matches: LeagueMatchRow[]): number[] {
  const m = matches.find((x) => x.id === matchId);
  return m ? [m.homeTeamId, m.awayTeamId] : [];
}

function parsePrize(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(":");
      if (at <= 0) return { place: "Prize", prize: line };
      return { place: line.slice(0, at).trim(), prize: line.slice(at + 1).trim() };
    });
}

/* ------------------------------------------------------------ team records */

export type TeamLeagueRow = {
  tournamentId: number;
  name: string;
  status: string;
  format: string;
  venueName: string;
  startsAt: string;
  record: TeamRecord;
  standing: number | null;
  tableSize: number;
};

export type TeamCompetitionProfile = {
  /** Every finished league fixture this squad played, plus competition bookings. */
  record: TeamRecord;
  leagues: TeamLeagueRow[];
  results: Array<{
    id: number;
    source: "league" | "booking";
    leagueId: number | null;
    leagueName: string;
    round: string;
    opponent: string;
    opponentId: number | null;
    home: boolean;
    scored: number;
    conceded: number;
    outcome: "W" | "D" | "L";
    date: string;
    link: string;
  }>;
};

/**
 * A squad's competitive record — what the team profile shows under "League &
 * competition".
 *
 * It merges the two places a competitive score can live: the league fixture
 * (`tournamentMatches`, scored by the host) and a **competition booking** (a
 * game a captain arranged on a court and the venue owner scored). Both count
 * towards the same record, because a captain who beat a rival on a Tuesday
 * night shouldn't have to explain that it "wasn't a league game".
 */
export async function teamCompetitionProfile(teamId: number): Promise<TeamCompetitionProfile> {
  await ensureCompetitionBookingColumns();
  if (!Number.isInteger(teamId) || teamId <= 0)
    return { record: recordFor(0, []), leagues: [], results: [] };

  const [allTournaments, allMatches, allEntries, allTeams, allVenues, allBookings] =
    await Promise.all([
      db.select().from(tournaments),
      db.select().from(tournamentMatches),
      db.select().from(tournamentTeams),
      db.select().from(teams),
      db.select().from(venues),
      db.select().from(bookings),
    ]);

  const nameOf = (id: number) => allTeams.find((t) => t.id === id)?.name ?? "Squad";

  const leagueMatches = allMatches.filter(
    (m) => m.homeTeamId === teamId || m.awayTeamId === teamId
  );
  const competitionBookings = allBookings.filter(
    (b) =>
      b.visibility === "competition" &&
      (b.teamId === teamId || b.opponentTeamId === teamId) &&
      b.homeScore !== null &&
      b.awayScore !== null
  );

  const matchLikes: MatchLike[] = [
    ...leagueMatches.map((m) => ({
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      status: m.status,
    })),
    ...competitionBookings.map((b) => ({
      homeTeamId: b.teamId ?? 0,
      awayTeamId: b.opponentTeamId ?? 0,
      homeScore: b.homeScore,
      awayScore: b.awayScore,
      status: "played",
    })),
  ];

  /** A squad has genuinely played a league when it has a finished fixture there. */
  const playedIn = (tournamentId: number) =>
    allMatches.some(
      (m) =>
        m.tournamentId === tournamentId &&
        (m.homeTeamId === teamId || m.awayTeamId === teamId) &&
        m.homeScore !== null &&
        m.awayScore !== null &&
        m.status !== "void"
    );

  const leagues: TeamLeagueRow[] = allEntries
    // Being *invited* or *asking* isn't being in a league, so only an approved
    // place — or a match actually played there — puts a league on the profile.
    .filter(
      (e) =>
        e.teamId === teamId &&
        (e.status === TEAM_APPROVED || playedIn(e.tournamentId))
    )
    .map((e) => {
      const t = allTournaments.find((x) => x.id === e.tournamentId);
      if (!t) return null;
      const squads = allEntries
        .filter((x) => x.tournamentId === t.id && x.status === TEAM_APPROVED)
        .map((x) => {
          const team = allTeams.find(y => y.id === x.teamId);
          return {
            teamId: x.teamId,
            name: team?.name ?? "Squad",
            logoColor: team?.logoColor ?? "#16a34a",
            teamCode: team?.teamCode ?? "",
          };
        });
      const table = standingsFor(
        squads,
        allMatches.filter((m) => m.tournamentId === t.id)
      );
      const idx = table.findIndex((r) => r.teamId === teamId);
      return {
        tournamentId: t.id,
        name: t.name,
        status: t.status,
        format: t.format,
        venueName: allVenues.find((v) => v.id === t.venueId)?.name ?? "",
        startsAt: t.startsAt,
        record: recordFor(
          teamId,
          allMatches.filter((m) => m.tournamentId === t.id)
        ),
        standing: idx >= 0 && table.length > 1 ? idx + 1 : null,
        tableSize: squads.length,
      };
    })
    .filter(Boolean) as TeamLeagueRow[];

  const results = [
    ...leagueMatches
      .filter((m) => m.homeScore !== null && m.awayScore !== null && m.status !== "void")
      .map((m) => {
        const t = allTournaments.find((x) => x.id === m.tournamentId);
        const home = m.homeTeamId === teamId;
        const scored = home ? Number(m.homeScore) : Number(m.awayScore);
        const conceded = home ? Number(m.awayScore) : Number(m.homeScore);
        return {
          id: m.id,
          source: "league" as const,
          leagueId: m.tournamentId,
          leagueName: t?.name ?? "League",
          round: m.round,
          opponent: nameOf(home ? m.awayTeamId : m.homeTeamId),
          opponentId: home ? m.awayTeamId : m.homeTeamId,
          home,
          scored,
          conceded,
          outcome: (scored > conceded ? "W" : scored === conceded ? "D" : "L") as "W" | "D" | "L",
          date: m.date,
          link: `/leagues/${m.tournamentId}`,
        };
      }),
    ...competitionBookings.map((b) => {
      const home = b.teamId === teamId;
      const scored = home ? Number(b.homeScore) : Number(b.awayScore);
      const conceded = home ? Number(b.awayScore) : Number(b.homeScore);
      const t = b.tournamentId ? allTournaments.find((x) => x.id === b.tournamentId) : null;
      return {
        id: b.id,
        source: "booking" as const,
        leagueId: b.tournamentId ?? null,
        leagueName: t?.name ?? "Friendly competition",
        round: "Competition game",
        opponent: nameOf((home ? b.opponentTeamId : b.teamId) ?? 0),
        opponentId: (home ? b.opponentTeamId : b.teamId) ?? null,
        home,
        scored,
        conceded,
        outcome: (scored > conceded ? "W" : scored === conceded ? "D" : "L") as "W" | "D" | "L",
        date: b.date,
        link: t ? `/leagues/${t.id}` : "/bookings",
      };
    }),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return { record: recordFor(teamId, matchLikes), leagues, results };
}

/* --------------------------------------------------------- host bookkeeping */

/** The ledger rows that back a squad's totals, newest first. */
export async function paymentsForTeam(tournamentId: number, teamId: number) {
  return (
    await db
      .select()
      .from(tournamentPayments)
      .where(eq(tournamentPayments.tournamentId, tournamentId))
  )
    .filter((p) => p.teamId === teamId)
    .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      createdAt: iso(p.createdAt),
    }));
}

/**
 * Recompute one squad's running totals from the ledger.
 *
 * The ledger is the truth; `tournamentTeams.paidAmount` is a cache of it so a
 * listing can render a chip without summing rows. Every write to
 * `tournamentPayments` is followed by this, which keeps the two in step — and
 * the `and(...)` in the update matters: a stray `where` on the tournament alone
 * would stamp every squad in the league with one team's numbers.
 */
export async function recalcTeamTotals(tournamentId: number, teamId: number) {
  const rows = await db
    .select()
    .from(tournamentPayments)
    .where(eq(tournamentPayments.tournamentId, tournamentId));
  const mine = rows.filter((p) => p.teamId === teamId);
  const paidAmount = mine
    .filter((p) => p.kind === "entry")
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  const refundedAmount = mine
    .filter((p) => p.kind === "refund")
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  await db
    .update(tournamentTeams)
    .set({ paidAmount, refundedAmount, updatedAt: new Date() })
    .where(
      and(
        eq(tournamentTeams.tournamentId, tournamentId),
        eq(tournamentTeams.teamId, teamId)
      )
    );
  return { paidAmount, refundedAmount };
}

/** Which squads does this user captain? Used to gate "request to join". */
export async function captainedTeams(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const all = await db.select().from(teams).where(eq(teams.captainId, userId));
  return all.map((t) => ({ id: t.id, name: t.name, teamCode: t.teamCode ?? "", logoColor: t.logoColor }));
}

/** Squads a user belongs to (any role) — for the league pickers. */
export async function myTeamsWithLeagues(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const memberships = await db.select().from(teamMembers).where(eq(teamMembers.userId, userId));
  const allTeams = await db.select().from(teams);
  const allEntries = await db.select().from(tournamentTeams);
  const allTournaments = await db.select().from(tournaments);
  return memberships
    .map((m) => {
      const team = allTeams.find((t) => t.id === m.teamId);
      if (!team) return null;
      const entries = allEntries.filter(
        (e) => e.teamId === team.id && e.status === TEAM_APPROVED
      );
      return {
        id: team.id,
        name: team.name,
        logoColor: team.logoColor,
        teamCode: team.teamCode ?? "",
        isCaptain: team.captainId === userId,
        leagues: entries
          .map((e) => {
            const t = allTournaments.find((x) => x.id === e.tournamentId);
            return t
              ? { id: t.id, name: t.name, visibility: t.visibility, status: t.status }
              : null;
          })
          .filter(Boolean) as Array<{ id: number; name: string; visibility: string; status: string }>,
      };
    })
    .filter(Boolean) as Array<{
    id: number;
    name: string;
    logoColor: string;
    teamCode: string;
    isCaptain: boolean;
    leagues: Array<{ id: number; name: string; visibility: string; status: string }>;
  }>;
}

/** Approved squads of a league — the teams a competition fixture may pick from. */
export async function approvedSquads(tournamentId: number) {
  const entries = await db
    .select()
    .from(tournamentTeams)
    .where(eq(tournamentTeams.tournamentId, tournamentId));
  const allTeams = await db.select().from(teams);
  return entries
    .filter((e) => e.status === TEAM_APPROVED)
    .map((e) => {
      const team = allTeams.find((t) => t.id === e.teamId);
      return team
        ? {
            teamId: team.id,
            name: team.name,
            logoColor: team.logoColor,
            teamCode: team.teamCode ?? "",
            captainId: team.captainId,
          }
        : null;
    })
    .filter(Boolean) as Array<{
    teamId: number;
    name: string;
    logoColor: string;
    teamCode: string;
    captainId: number;
  }>;
}

/** Leagues a venue owner may host at (their own grounds), for the host form. */
export async function ownedVenues(ownerId: number) {
  const all = await db.select().from(venues).where(eq(venues.ownerId, ownerId));
  return all.map((v) => ({ id: v.id, name: v.name, city: v.city }));
}

/** Every venue is hostable by a player too — a league needs a ground, not an owner. */
export async function allVenues() {
  const rows = await db.select().from(venues);
  return rows.map((v) => ({ id: v.id, name: v.name, city: v.city }));
}

export { depositFor, moneyLockedFor, paymentState, recordFor, standingsFor };
