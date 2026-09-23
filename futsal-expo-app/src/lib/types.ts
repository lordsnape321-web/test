/**
 * Types for the slice of the API this app uses.
 *
 * Every field here was read off a live response from the Next.js API rather
 * than copied from the Drizzle schema, because the routes reshape rows before
 * returning them (a booking carries a nested `venue` and `court`, for example).
 *
 * Only the fields the UI actually renders are declared. The API returns more;
 * leaving the rest out keeps this readable and stops the app depending on
 * fields it never uses.
 */

import type { PaymentState, StandingRow } from "./league";

export type PaymentMethod = "eSewa" | "Khalti" | "Cash at Venue" | "Bank Transfer";

export type Court = {
  id: number;
  venueId: number;
  name: string;
  pricePerHour: number;
  /** Some venues price mornings differently; absent when they don't. */
  priceMorning?: number | null;
  surface?: string | null;
  format?: string | null;
  features?: string[] | null;
  imageUrl?: string | null;
  isActive?: boolean;
  deletedAt?: string | null;
};

export type Venue = {
  id: number;
  name: string;
  address: string;
  city: string;
  description: string;
  phone: string;
  imageUrl?: string | null;
  openingHour: number;
  closingHour: number;
  rating: number;
  totalReviews: number;
  isFeatured?: boolean;
  amenities?: string[] | null;
  /**
   * Comma-separated list, e.g. "eSewa,Khalti,Cash at Venue" — the API returns a
   * string, not an array. Split on "," and trim before comparing.
   */
  acceptedPayments?: string | null;
  /** Denormalised by the API for list rendering. */
  courtCount: number;
  minPrice: number;
  depositPercent?: number;
  defaultExtraFee?: number | null;
  defaultExtraFeeNote?: string | null;
  courts?: Court[] | null;
  /** Soft-delete marker; the list screens filter these out. */
  deletedAt?: string | null;
};

export type User = {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: "player" | "owner" | "admin";
  level?: string;
  position?: string;
  avatarUrl?: string | null;
  matchesPlayed?: number;
  rating?: number;
  trustScore?: number;
};

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";
export type PaymentStatus = "unpaid" | "deposit_paid" | "paid" | "overpaid";

export type Booking = {
  id: number;
  userId: number;
  courtId: number;
  venueId?: number;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalPrice: number;
  paidAmount: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod | null;
  bookerName: string;
  bookerPhone: string;
  notes?: string | null;
  createdAt: string;
  settledAt?: string | null;
  /** Nested by the API so a booking list can render without extra requests. */
  venue?: Pick<Venue, "id" | "name" | "address" | "city" | "imageUrl" | "phone"> | null;
  court?: Pick<Court, "id" | "name" | "pricePerHour" | "surface" | "format"> | null;
  user?: Pick<User, "id" | "name" | "email" | "phone"> | null;
};

/**
 * GET /api/notifications?userId= → { notifications }
 *
 * Deliberately NOT called `Notification`: that name is a DOM global
 * (`interface Notification extends EventTarget`), so a local type with that name
 * silently resolves to the browser's instead of erroring — tsc stays green while
 * the type is wrong. The `App` prefix keeps the two apart.
 */
export type AppNotification = {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  link: string;
  isRead: boolean;
  createdAt: string | null;
};

/** GET /api/stats → { stats } */
export type SiteStats = {
  venues: number;
  courts: number;
  bookings: number;
  players: number;
  openMatches: number;
  teams: number;
  revenue: number;
  todaysBookings: number;
  occupancy: number;
};

/** A player attached to an open match. */
export type MatchPlayer = {
  id: number;
  name: string;
  avatarColor: string;
  avatarUrl?: string | null;
};

/** GET /api/matches → { matches } */
export type Match = {
  id: number;
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  level: string;
  status: string;
  chargeMode?: string | null;
  pricePerPlayer: number;
  maxPlayers: number;
  joinedCount: number;
  spotsLeft: number;
  openSpots?: number;
  crewSize?: number;
  otherJoined?: number;
  bookingId?: number | null;
  courtId?: number | null;
  venueId?: number | null;
  organizerId?: number | null;
  organizer?: { name: string } | null;
  venue?: { name: string; address: string; city: string; imageUrl: string } | null;
  court?: { name: string } | null;
  players?: MatchPlayer[] | null;
  createdAt?: string;
};

/** GET /api/bookings/:id/ledger */
export type LedgerPayment = {
  id: number;
  amount: number;
  method: string;
  note?: string | null;
  source?: string | null;
  voidedAt?: string | null;
  createdAt: string;
};

export type LedgerExtra = {
  id: number;
  label: string;
  amount: number;
  createdAt: string;
};

export type Ledger = {
  bookingId: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  courtPrice: number;
  totals: {
    owed: number;
    paid: number;
    balance: number;
    surplus: number;
  };
  window: {
    settled: boolean;
    editable: boolean;
    msLeft: number;
    locksAt: number | null;
  };
  editWindowMs: number;
  settledAt: string | null;
  settledBy: number | null;
  acceptedMethods: string[];
  defaultExtraFee?: number | null;
  defaultExtraFeeNote?: string | null;
    extras: LedgerExtra[];
    payments: LedgerPayment[];
  };

/**
 * GET /api/vouchers?userId= → { vouchers } (each enriched with its venue).
 * A free-hour reward earned by playing LOYALTY_TARGET games at one venue in a
 * month. `venue` is null when the venue was deleted.
 */
export type Voucher = {
  id: number;
  userId: number;
  venueId: number | null;
  code: string;
  status: string;
  month: string;
  venue?: { id: number; name: string; imageUrl: string | null } | null;
};

/**
 * GET /api/vouchers?userId= → { progress }: per-venue monthly play count toward
 * the next free hour, so the profile can draw the 7-step progress bar.
 */
export type LoyaltyProgress = {
  venueId: number;
  venueName: string;
  venueImage: string;
  count: number;
  target: number;
  remaining: number;
  done: boolean;
};

/* ── leagues ─────────────────────────────────────────────────────────────── */

/**
 * League shapes — a 1:1 copy of the web app's `league-store.ts` type block.
 * The server reshapes the tournament row (counts, standings, viewer context),
 * so these mirror what GET /api/tournaments and GET /api/tournaments/:id
 * actually return rather than the Drizzle schema.
 */
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
  teams: LeagueSummaryTeam[];
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

export type LeagueSummaryTeam = {
  teamId: number;
  name: string;
  logoColor: string;
  teamCode: string;
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
  /** Who may see it, spelled out: "Semi-final • A vs B" or "Whole league". */
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

/**
 * GET /api/teams?userId= — just that player's squads, the shape the squad
 * panel and booking team-picker need (id/name/logoColor/role).
 */
export type UserTeamLite = {
  id: number;
  name: string;
  teamCode: string;
  memberCount: number;
  logoColor: string;
  level: string;
  role: "captain" | "player";
};

/** GET /api/teams?q= — a search row plus the captain's name for inviting. */
export type TeamSearchHit = {
  id: number;
  name: string;
  teamCode: string;
  captainName: string;
};
