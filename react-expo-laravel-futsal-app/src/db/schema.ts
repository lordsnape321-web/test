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
  ownerId: integer("owner_id"),
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
  chargeMode: text("charge_mode").notNull().default("split"),
  customPricePerPlayer: integer("custom_price_per_player").notNull().default(0),
  depositRequired: boolean("deposit_required").notNull().default(false),
  depositAmount: integer("deposit_amount").notNull().default(0),
  depositStatus: text("deposit_status").notNull().default("none"),
  esewaUuid: text("esewa_uuid").notNull().default(""),
  khaltiPidx: text("khalti_pidx").notNull().default(""),
  gatewayTxnId: text("gateway_txn_id").notNull().default(""),
  paidAmount: integer("paid_amount").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  motto: text("motto").notNull().default(""),
  captainId: integer("captain_id").notNull().default(1),
  maxPlayers: integer("max_players").notNull().default(12),
  level: text("level").notNull().default("Intermediate"),
  logoColor: text("logo_color").notNull().default("#16a34a"),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  homeGround: text("home_ground").notNull().default(""),
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
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  venueId: integer("venue_id").notNull(),
  userId: integer("user_id").notNull(),
  bookingId: integer("booking_id"),
  rating: integer("rating").notNull().default(5),
  message: text("message").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
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
