import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  real,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull().default(""),
  passwordHash: text("password_hash").notNull().default(""),
  role: text("role").notNull().default("player"),
  avatarColor: text("avatar_color").notNull().default("#22c55e"),
  avatarUrl: text("avatar_url").notNull().default(""),
  defaultCity: text("default_city").notNull().default("All Cities"),
  level: text("level").notNull().default("Intermediate"),
  position: text("position").notNull().default("All-rounder"),
  matchesPlayed: integer("matches_played").notNull().default(0),
  trustScore: integer("trust_score").notNull().default(100),
  createdAt: timestamp("created_at").defaultNow(),
});

export const venues = pgTable("venues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull().default("Kathmandu"),
  phone: text("phone").notNull().default(""),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  rating: real("rating").notNull().default(4.5),
  totalReviews: integer("total_reviews").notNull().default(0),
  openingHour: integer("opening_hour").notNull().default(6),
  closingHour: integer("closing_hour").notNull().default(22),
  amenities: text("amenities").notNull().default("Parking,Changing Room,Shower,WiFi,Cafeteria,First Aid"),
  isFeatured: boolean("is_featured").notNull().default(false),
  acceptedPayments: text("accepted_payments").notNull().default("eSewa,Khalti,Cash at Venue"),
  depositPercent: integer("deposit_percent").notNull().default(30),
  /**
   * What this venue usually adds on top of the court fee — prefills the extra
   * charge line so the owner isn't retyping "Water" every Saturday.
   */
  defaultExtraFee: integer("default_extra_fee").notNull().default(0),
  defaultExtraFeeNote: text("default_extra_fee_note").notNull().default(""),
  ownerId: integer("owner_id"),
  /**
   * Set when the owner retires the venue 🪦
   *
   * A soft delete, because a venue has bookings, payments, reviews and leagues
   * hanging off it — wiping the row would orphan all of them and erase the
   * owner's own money history. A deleted venue simply stops appearing in
   * listings, searches and the studio.
   */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const courts = pgTable("courts", {
  id: serial("id").primaryKey(),
  venueId: integer("venue_id").notNull(),
  name: text("name").notNull(),
  format: text("format").notNull().default("5v5"),
  surface: text("surface").notNull().default("Artificial Turf"),
  pricePerHour: integer("price_per_hour").notNull().default(1500),
  priceMorning: integer("price_morning").notNull().default(1200),
  imageUrl: text("image_url").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  features: text("features").notNull().default("Floodlights,FIFA Turf,Nets Provided"),
  // A retired court keeps its row: past bookings point at it and have to stay
  // readable. It just stops being offered.
  deletedAt: timestamp("deleted_at"),
});

export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  courtId: integer("court_id").notNull(),
  userId: integer("user_id").notNull(),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  durationHours: real("duration_hours").notNull().default(1),
  totalPrice: integer("total_price").notNull().default(0),
  status: text("status").notNull().default("pending"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  paymentMethod: text("payment_method").notNull().default("eSewa"),
  bookerName: text("booker_name").notNull().default(""),
  bookerPhone: text("booker_phone").notNull().default(""),
  notes: text("notes").notNull().default(""),
  visibility: text("visibility").notNull().default("private"),
  playersNeeded: integer("players_needed").notNull().default(0),
  ourCrew: integer("our_crew").notNull().default(1),
  openSpots: integer("open_spots").notNull().default(0),
  // Squad this booking was made for — set when the player picks "Just our gang"
  // (or an open invite) and chooses one of the teams they belong to. Null means
  // an individual booking: the player is in no team, or chose "Just me".
  // `teamName` is snapshotted the way `promoCode` is, so a booking keeps its
  // label even if the team is later renamed or deleted.
  teamId: integer("team_id"),
  teamName: text("team_name").notNull().default(""),
  receiptUrl: text("receipt_url").notNull().default(""),
  isFreePlay: boolean("is_free_play").notNull().default(false),
  voucherId: integer("voucher_id"),
  // Promo code applied by the player (owner-created, see `promos`).
  promoId: integer("promo_id"),
  promoCode: text("promo_code").notNull().default(""),
  priceBeforeDiscount: integer("price_before_discount").notNull().default(0),
  discountAmount: integer("discount_amount").notNull().default(0),
  /**
   * Competition bookings 🏆 — a third kind of game next to "private" and
   * "public": a *competitive* fixture between two squads (a league round or a
   * friendly that both sides are counting). It stores both squads so the
   * result has two sides, plus the score the venue owner or league host enters
   * after kickoff. Those scores are what a team's profile shows as its
   * competitive record, and what a league table is built from.
   */
  tournamentId: integer("tournament_id"),
  opponentTeamId: integer("opponent_team_id"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  /** "none" (not a competition game) | "awaiting" | "recorded". */
  scoreStatus: text("score_status").notNull().default("none"),
  /**
   * Opposition consent is its own lifecycle, separate from score recording.
   * "pending" keeps the venue owner from receiving an actionable request;
   * only "accepted" releases it. Existing non-competition rows remain "none".
   */
  competitionStatus: text("competition_status").notNull().default("none"),
  competitionRespondedBy: integer("competition_responded_by"),
  competitionRespondedAt: timestamp("competition_responded_at"),
  scoreUpdatedBy: integer("score_updated_by"),
  scoreUpdatedAt: timestamp("score_updated_at"),
  /**
   * Public/open bookings use chargeMode for "split" or "custom" pricing.
   * Competition policy is deliberately separate: null means this is not a
   * competition booking; competition rows carry "split" or "loser_pays" here.
   */
  competitionPaymentPolicy: text("competition_payment_policy"),
  chargeMode: text("charge_mode").notNull().default("split"),
  customPricePerPlayer: integer("custom_price_per_player").notNull().default(0),
  depositRequired: boolean("deposit_required").notNull().default(false),
  depositAmount: integer("deposit_amount").notNull().default(0),
  depositStatus: text("deposit_status").notNull().default("none"),
  esewaUuid: text("esewa_uuid").notNull().default(""),
  khaltiPidx: text("khalti_pidx").notNull().default(""),
  gatewayTxnId: text("gateway_txn_id").notNull().default(""),
  paidAmount: integer("paid_amount").notNull().default(0),
  /**
   * When the owner marked this booking settled. It starts a short correction
   * window (`SETTLE_EDIT_WINDOW_MS`) so a mistyped amount can be fixed; after
   * that the ledger is locked and the API refuses changes.
   */
  settledAt: timestamp("settled_at"),
  settledBy: integer("settled_by"),
  /** An owner-requested advance, separate from the automatic fair-play deposit. */
  advancePaymentRequired: boolean("advance_payment_required").notNull().default(false),
  advancePaymentAmount: integer("advance_payment_amount").notNull().default(0),
  advancePaymentStatus: text("advance_payment_status").notNull().default("none"),
  advancePaymentRequestedBy: integer("advance_payment_requested_by"),
  advancePaymentRequestedAt: timestamp("advance_payment_requested_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * One payment share per approved member when a player books for a team. The
 * booking remains the parent record, while each member chooses their own
 * accepted method and can pay only their server-calculated share.
 */
export const bookingTeamPayments = pgTable("booking_team_payments", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  teamId: integer("team_id").notNull(),
  userId: integer("user_id").notNull(),
  amountDue: integer("amount_due").notNull().default(0),
  paymentMethod: text("payment_method").notNull().default(""),
  paymentStatus: text("payment_status").notNull().default("pending"),
  paidAmount: integer("paid_amount").notNull().default(0),
  gatewayTxnId: text("gateway_txn_id").notNull().default(""),
  esewaUuid: text("esewa_uuid").notNull().default(""),
  khaltiPidx: text("khalti_pidx").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * One row per instalment on a booking 💸 — so a Rs 1,700 game paid as
 * 700 eSewa + 500 Khalti + 500 cash is three traceable rows, not one "paid"
 * flag. Owed and paid are *derived* from these rows, never trusted from the
 * booking alone, so the venue owner can always see which medium paid how much.
 *
 * The table is append-only. A mistake corrected inside the settle window voids
 * the row (`voidedAt`/`voidedBy`) instead of deleting it, so the history of who
 * entered what survives.
 */
export const bookingPayments = pgTable("booking_payments", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  amount: integer("amount").notNull().default(0),
  /** "eSewa" | "Khalti" | "Cash at Venue" — the mediums the venue accepts. */
  method: text("method").notNull().default("Cash at Venue"),
  note: text("note").notNull().default(""),
  /** "owner" (entered at the desk) | "player" (paid online) | "gateway". */
  source: text("source").notNull().default("owner"),
  /**
   * The gateway's transaction id when the money came in online. It is what makes
   * a replayed verify call idempotent — the same txn can only ever produce one
   * ledger row — and it ties the row back to eSewa/Khalti when reconciling.
   */
  reference: text("reference").notNull().default(""),
  recordedBy: integer("recorded_by").notNull().default(0),
  voidedAt: timestamp("voided_at"),
  voidedBy: integer("voided_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Charges added *after* the court fee ⚽ — the water and extra balls bought
 * during the match. The court price is taken in advance; these land later, so
 * they are line items with their own description rather than one lump sum.
 * Voided rather than deleted, for the same reason as `bookingPayments`.
 */
export const bookingExtras = pgTable("booking_extras", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  /** "Water x10", "Extra ball", "First aid kit" — free text. */
  label: text("label").notNull().default(""),
  amount: integer("amount").notNull().default(0),
  recordedBy: integer("recorded_by").notNull().default(0),
  voidedAt: timestamp("voided_at"),
  voidedBy: integer("voided_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  motto: text("motto").notNull().default(""),
  /**
   * Free-text "about us" box, optional on purpose: a motto is the slogan, the
   * description is where a captain explains how the squad actually runs
   * (training nights, who pays for the court, whether beginners get game time).
   * Searchers read it before asking to join, so it renders on the team card.
   */
  description: text("description").notNull().default(""),
  /**
   * Short unique handle other players search by (e.g. "CHARGERS-4X7K"), the same
   * idea as a promo code. Nullable rather than NOT NULL DEFAULT '' purely so the
   * column can be added to a database that already has teams — Postgres treats
   * NULLs as distinct under a unique constraint, so legacy rows migrate cleanly
   * and get backfilled by /api/seed. Every team created through the API gets one.
   */
  teamCode: text("team_code").unique(),
  /**
   * Exactly one captain per team. `teamMembers.role` mirrors this for the roster,
   * and the API refuses to let a captain leave or be removed without first
   * handing the armband to another member — so the two can never disagree.
   */
  captainId: integer("captain_id").notNull().default(1),
  maxPlayers: integer("max_players").notNull().default(12),
  level: text("level").notNull().default("Intermediate"),
  logoColor: text("logo_color").notNull().default("#16a34a"),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  /** Venue name snapshot — see `homeVenueId`. */
  homeGround: text("home_ground").notNull().default(""),
  /**
   * Home turf picked from the venues that actually exist on the platform, not
   * free text. Null means "no home turf chosen". `homeGround` holds the name so
   * cards keep rendering if the venue is later renamed or removed.
   */
  homeVenueId: integer("home_venue_id"),
  lookingForPlayers: boolean("looking_for_players").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull().default("player"),
  joinedAt: timestamp("joined_at").defaultNow(),
});

/**
 * Join requests 🛡️ — asking to join a team no longer adds you straight to the
 * roster. The request sits here until the captain accepts or declines it, which
 * is what gives the captain control over who is in their squad.
 *
 * `pending` is the only status that blocks a new request; `cancelled` (player
 * withdrew) and `declined` both allow asking again later.
 */
export const teamRequests = pgTable("team_requests", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull(),
  userId: integer("user_id").notNull(),
  message: text("message").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  decidedAt: timestamp("decided_at"),
  decidedBy: integer("decided_by"),
});

/**
 * Team invites 📨 — the same consent rule, pointed the other way.
 *
 * A captain used to be able to drop a player straight onto the roster, which
 * meant a squad could gain members who never agreed to be in it (and whose
 * name then showed up on booking chips and open matches). Nobody is added
 * without saying yes: an invite sits here until the *player* accepts or
 * declines, exactly as a `teamRequests` row waits on the captain.
 *
 * `createdAt` doubles as "when was this last sent", because a declined/withdrawn
 * invite is reopened in place rather than duplicated — and that column is what
 * the daily quota counts. Owner/admin accounts can never be invited; see
 * `canBeInvitedToTeam` in `src/lib/teams.ts`.
 */
export const teamInvites = pgTable("team_invites", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull(),
  /** The player being invited — the only person who can answer it. */
  userId: integer("user_id").notNull(),
  /** The captain who sent it, so the reply always has somebody to go back to. */
  invitedBy: integer("invited_by").notNull().default(0),
  message: text("message").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  decidedAt: timestamp("decided_at"),
  decidedBy: integer("decided_by"),
});


export const openMatches = pgTable("open_matches", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  venueId: integer("venue_id").notNull(),
  courtId: integer("court_id"),
  organizerId: integer("organizer_id").notNull(),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  pricePerPlayer: integer("price_per_player").notNull().default(200),
  maxPlayers: integer("max_players").notNull().default(10),
  crewSize: integer("crew_size").notNull().default(1),
  level: text("level").notNull().default("All Levels"),
  status: text("status").notNull().default("open"),
  description: text("description").notNull().default(""),
  bookingId: integer("booking_id"),
  chargeMode: text("charge_mode").notNull().default("split"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const matchJoins = pgTable("match_joins", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").notNull(),
  userId: integer("user_id").notNull(),
  status: text("status").notNull().default("joined"),
  joinedAt: timestamp("joined_at").defaultNow(),
});

/**
 * Leagues 🏆 — the tournament layer.
 *
 * An open match is one pitch, one score, players joining as individuals. A
 * league is the other shape of competition: **one ground, many squads**, every
 * team playing the others over weeks, with an entry fee, a prize pool and a
 * table that actually means something.
 *
 * Anyone can host one — a player with a free weekend, or the venue owner who
 * knows every captain in the neighbourhood — so `hostId` points at a `users`
 * row and `hostRole` records which side of the app they run it from. The league
 * is pinned to a real venue (`venueId`), because "where is it played?" is the
 * first question every captain asks.
 *
 * `visibility` is the difference between a noticeboard and a private party:
 * `public` leagues are listed for anyone to find and request a spot in, while
 * `private` ones are invisible to everybody except the teams that were invited
 * and the squads the host admitted.
 *
 * Money is real in shape but simulated in movement (same as every other
 * gateway in this app): a squad pays at least `depositPercent` of `entryFee` to
 * lock its place and only `refundPercent` of what it paid comes back if it
 * walks away — both are stored per league so the terms are visible *before*
 * anybody pays, not buried in a rule nobody read.
 */
export const tournaments = pgTable("tournaments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** Who runs the league. A player captain and a venue owner host identically. */
  hostId: integer("host_id").notNull(),
  /** "player" | "owner" — which UI the host came from, for labelling only. */
  hostRole: text("host_role").notNull().default("player"),
  /** Always on one ground, so every squad knows where to turn up. */
  venueId: integer("venue_id"),
  /** Optional: the specific pitch the league runs on. */
  courtId: integer("court_id"),
  format: text("format").notNull().default("5v5"),
  /**
   * How a winner is decided 🏆 — "round_robin" (the league: everyone plays
   * everyone, the table decides), "knockout" (a bracket, one loss and you're
   * out) or "group_knockout" (groups first, then the top two of each group go
   * to a bracket). The host picks it when the league is created and it can't
   * change once fixtures exist, because a bracket and a league table are not
   * the same shape of competition.
   */
  mode: text("mode").notNull().default("round_robin"),
  /** Knockout modes only: play a third-place game between the losing semi-finalists. */
  thirdPlace: boolean("third_place").notNull().default(false),
  /** Groups + knockout only: how many squads per group (4 is the usual). */
  groupSize: integer("group_size").notNull().default(4),
  /** How many squads can be in it — the "tournament size" on the listing. */
  maxTeams: integer("max_teams").notNull().default(8),
  /** Entry fee per squad, in NPR. 0 means a free-to-enter league. */
  entryFee: integer("entry_fee").notNull().default(0),
  /** Percent of the entry fee due before a squad counts as in (25% by default). */
  depositPercent: integer("deposit_percent").notNull().default(25),
  /** Percent of what a squad paid that comes back if it backs out (10%). */
  refundPercent: integer("refund_percent").notNull().default(10),
  prizePool: integer("prize_pool").notNull().default(0),
  /**
   * Human-readable prize split, one place per line ("Champion: Rs. 40,000").
   * A list is what a captain actually wants to see, and free text keeps it
   * open — trophies, free hours and momos are all legitimate prizes.
   */
  prizeBreakdown: text("prize_breakdown").notNull().default(""),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull().default(""),
  /** Last day squads can join. Blank means "whenever the league fills". */
  closesAt: text("closes_at").notNull().default(""),
  /** Free text like "Sat & Sun mornings, 7–9 AM". */
  matchDays: text("match_days").notNull().default(""),
  /** "public" (findable, requests welcome) | "private" (invitation only). */
  visibility: text("visibility").notNull().default("public"),
  /** "registration" | "ongoing" | "completed" | "cancelled". */
  status: text("status").notNull().default("registration"),
  description: text("description").notNull().default(""),
  rules: text("rules").notNull().default(""),
  contactPhone: text("contact_phone").notNull().default(""),
  bannerUrl: text("banner_url").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Who is in the league, and how far along their entry is.
 *
 * One row per squad per league, and the status is the whole conversation:
 *
 * - `requested` — the captain asked to join a public league; the host decides.
 * - `invited`   — the host asked the squad (the only way into a private league);
 *                 paying the deposit *is* the yes.
 * - `approved`  — in the league, with at least the deposit in the till.
 * - `rejected`  / `declined` — the two ways a question gets answered with no.
 * - `withdrawn` — a squad that was in, backed out. `refundedAmount` holds the
 *                 10% that went back; the rest is forfeited to the league.
 *
 * `paidAmount` / `refundedAmount` are running totals mirrored from
 * `tournamentPayments`, so the listing can render a payment chip without
 * joining the ledger every time.
 */
export const tournamentTeams = pgTable("tournament_teams", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  teamId: integer("team_id").notNull(),
  status: text("status").notNull().default("requested"),
  /** The captain who asked, or the host who invited — whoever started it. */
  requestedBy: integer("requested_by").notNull().default(0),
  message: text("message").notNull().default(""),
  paidAmount: integer("paid_amount").notNull().default(0),
  refundedAmount: integer("refunded_amount").notNull().default(0),
  /**
   * How the captain wants to pay the entry fee — the same three media a booking
   * offers, because a squad joining a league and a player booking a pitch are
   * reaching for the same wallet. Empty until they pick one.
   */
  payMethod: text("pay_method").notNull().default(""),
  /** Screenshot of an eSewa/Khalti transfer, so the host can see proof. */
  receiptUrl: text("receipt_url").notNull().default(""),
  /** What the gateway called the transfer, once there is one. */
  gatewayTxnId: text("gateway_txn_id").notNull().default(""),
  decidedBy: integer("decided_by"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * The league ledger 📒 — every rupee in and out, one row at a time.
 *
 * `paidAmount` on a squad answers "how much?"; this table answers "when, how,
 * to whom, and for what" the way a host counting cash after a Saturday needs
 * it. `kind` is `entry` (a squad paying in), `refund` (10% going back when a
 * squad withdraws) or `prize` (the host paying out the pool at the end).
 */
export const tournamentPayments = pgTable("tournament_payments", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  teamId: integer("team_id").notNull(),
  /** Who handed the money over (or received it, for a refund). */
  userId: integer("user_id").notNull().default(0),
  /** "entry" | "refund" | "prize" */
  kind: text("kind").notNull().default("entry"),
  amount: integer("amount").notNull().default(0),
  /** "eSewa" | "Khalti" | "Cash at Venue" — the same three the app accepts. */
  method: text("method").notNull().default("eSewa"),
  reference: text("reference").notNull().default(""),
  recordedBy: integer("recorded_by").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Fixtures & results ⚽ — the league's calendar.
 *
 * A row is one game between two squads of the same league. Null scores mean
 * "not played yet"; the moment both numbers are in, the table moves and the
 * referee's sheet is attached to the squads' records. `bookingId` links a
 * fixture to the court booking that holds the slot, so the same game can be
 * scored either from the league's console or from the venue's booking list.
 */
export const tournamentMatches = pgTable("tournament_matches", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  /** "League" for the round robin, "Group A" for a group game, or "Semi-final", "Final", "Third place", "Friendly"... */
  round: text("round").notNull().default("League"),
  /**
   * Bracket wiring 🥊 — 0 for a league or group game. `bracketRound` counts the
   * knockout rounds from 1 and `slot` is the game's position inside that round,
   * so a round is a set of games and a bracket is a set of rounds.
   *
   * `homeFrom` / `awayFrom` say where an empty slot gets its squad from: "W1-0"
   * is the winner of round 1 slot 0, "L2-1" the loser of round 2 slot 1 (that's
   * how a third-place game fills) and "G2W" / "G2R" the winner / runner-up of
   * group 2. Recording a result is what swaps the ref for a real team id, so a
   * bracket fills itself in as the tournament is played.
   */
  bracketRound: integer("bracket_round").notNull().default(0),
  slot: integer("slot").notNull().default(0),
  homeFrom: text("home_from").notNull().default(""),
  awayFrom: text("away_from").notNull().default(""),
  /** What an empty slot reads as on the card: "Winner Group A", "Bye 🎟️". */
  homeLabel: text("home_label").notNull().default(""),
  awayLabel: text("away_label").notNull().default(""),
  /** 0 when a bracket slot is still waiting on the game before it. */
  homeTeamId: integer("home_team_id").notNull().default(0),
  awayTeamId: integer("away_team_id").notNull().default(0),
  /** Blank until the host schedules it ("TBD" on the fixture card). */
  date: text("date").notNull().default(""),
  startTime: text("start_time").notNull().default(""),
  courtId: integer("court_id"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  /** "scheduled" | "played" — set automatically when both scores exist. */
  status: text("status").notNull().default("scheduled"),
  bookingId: integer("booking_id"),
  notes: text("notes").notNull().default(""),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Match photos & videos 📸 — the memories, and who is allowed to see them.
 *
 * Two ways in, because two ways is what hosts actually have: `file` holds a
 * photo the host picked in the app (a data URL, the same trick the receipt
 * uploader uses), and `link` points at a Google Drive / Facebook album the
 * host already keeps. Nothing here is public: a league's album is readable by
 * the host plus players of the squads in that league, and a photo attached to
 * one fixture (`matchId` set) is readable only by the two squads that played
 * it and the host. That rule lives in `src/lib/league-store.ts` and is applied
 * on the server for every read, not by hiding pixels in the UI.
 */
export const tournamentMedia = pgTable("tournament_media", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  /** Set for a fixture's album; null for "the league in general". */
  matchId: integer("match_id"),
  /** "file" (data URL) | "link" (an album somewhere else). */
  kind: text("kind").notNull().default("link"),
  url: text("url").notNull(),
  caption: text("caption").notNull().default(""),
  credit: text("credit").notNull().default(""),
  uploadedBy: integer("uploaded_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull().default(""),
  link: text("link").notNull().default(""),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Loyalty: every 7 paid games at the same futsal in a calendar month = 1 free hour.
export const vouchers = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  venueId: integer("venue_id").notNull(),
  month: text("month").notNull(),
  code: text("code").notNull().default(""),
  status: text("status").notNull().default("active"),
  usedBookingId: integer("used_booking_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Promo codes: venue owners hand out discounts with an expiry date.
// Percent ("15% off, capped at Rs. 500") or flat ("Rs. 300 off"), optionally
// hidden from the public list, with total + per-player redemption limits.
export const promos = pgTable("promos", {
  id: serial("id").primaryKey(),
  venueId: integer("venue_id").notNull(),
  code: text("code").notNull(),
  title: text("title").notNull().default(""),
  discountType: text("discount_type").notNull().default("percent"),
  discountValue: integer("discount_value").notNull().default(10),
  maxDiscount: integer("max_discount").notNull().default(0),
  minBookingAmount: integer("min_booking_amount").notNull().default(0),
  startsAt: text("starts_at"),
  expiresAt: text("expires_at").notNull(),
  usageLimit: integer("usage_limit").notNull().default(0),
  perUserLimit: integer("per_user_limit").notNull().default(1),
  isPublic: boolean("is_public").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Player reviews: rating + message after playing. Visible to everyone + owner.
// One review per player per venue — a player's review is updated in place when
// they play again there (see POST /api/reviews), never duplicated.
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  venueId: integer("venue_id").notNull(),
  userId: integer("user_id").notNull(),
  /** The game this review was last written from; null = a general visit. */
  bookingId: integer("booking_id"),
  rating: integer("rating").notNull().default(5),
  message: text("message").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  /** Set when the player updates their review; null while it's still the original. */
  updatedAt: timestamp("updated_at"),
});

export type User = typeof users.$inferSelect;
export type Venue = typeof venues.$inferSelect;
export type Court = typeof courts.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type OpenMatch = typeof openMatches.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Voucher = typeof vouchers.$inferSelect;
export type Promo = typeof promos.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Tournament = typeof tournaments.$inferSelect;
export type TournamentTeam = typeof tournamentTeams.$inferSelect;
export type TournamentPayment = typeof tournamentPayments.$inferSelect;
export type TournamentMatch = typeof tournamentMatches.$inferSelect;
export type TournamentMedia = typeof tournamentMedia.$inferSelect;
