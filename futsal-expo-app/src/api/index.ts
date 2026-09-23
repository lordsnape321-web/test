import { ApiError, apiJson } from "@/lib/api";
import type {
  AppNotification,
  Booking,
  Court,
  Ledger,
  Match,
  SiteStats,
  User,
  Venue,
} from "@/lib/types";

/**
 * Typed calls for the vertical slice: auth → venues → booking → payment.
 *
 * Each function is one route. Keeping them here rather than inline in screens
 * means the route paths and request shapes are written down exactly once, which
 * is what makes the eventual Laravel swap a one-file change.
 */

/* ── auth ────────────────────────────────────────────────────────────────── */

/** POST /api/auth/signup → 201 { user } */
export function signup(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
  level?: string;
  position?: string;
  defaultCity?: string;
  avatarUrl?: string;
}): Promise<{ user: User }> {
  return apiJson("/api/auth/signup", { method: "POST", json: input });
}

/** POST /api/auth/login → { user } */
export function login(input: {
  email: string;
  password: string;
}): Promise<{ user: User }> {
  return apiJson("/api/auth/login", { method: "POST", json: input });
}

/* ── venues ──────────────────────────────────────────────────────────────── */

/** GET /api/venues → { venues } */
export async function fetchVenues(params?: {
  q?: string;
  city?: string;
}): Promise<Venue[]> {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.city) query.set("city", params.city);
  const qs = query.toString();
  const data = await apiJson<{ venues: Venue[] }>(`/api/venues${qs ? `?${qs}` : ""}`);
  // The route can return a soft-deleted venue; never show those.
  return (data.venues ?? []).filter((v) => !v.deletedAt);
}

/** GET /api/venues/:id → venue with its courts */
export async function fetchVenue(id: number): Promise<Venue> {
  const data = await apiJson<{ venue: Venue } & Venue>(`/api/venues/${id}`);
  return data.venue ?? data;
}

/* ── courts ──────────────────────────────────────────────────────────────── */

/**
 * Courts for a venue.
 *
 * There is no GET /api/courts — that route only accepts POST (create). Courts
 * are returned nested on the venue object, so this reads the venue and lifts its
 * courts out. Soft-deleted and inactive courts are filtered here so callers
 * never render a court that can't be booked.
 */
export async function fetchCourts(venueId: number): Promise<Court[]> {
  const venue = await fetchVenue(venueId);
  return (venue.courts ?? []).filter((c) => !c.deletedAt && c.isActive !== false);
}

/**
 * GET /api/availability?courtId=&date= → { booked, bookings }
 *
 * Returns the start times already taken, so the picker can grey them out
 * instead of letting a player pick a slot that will 409.
 */
export async function fetchAvailability(
  courtId: number,
  date: string,
): Promise<{ booked: string[]; bookings: Booking[] }> {
  const data = await apiJson<{ booked?: string[]; bookings?: Booking[] }>(
    `/api/availability?courtId=${courtId}&date=${date}`,
  );
  return { booked: data.booked ?? [], bookings: data.bookings ?? [] };
}

/* ── profile ─────────────────────────────────────────────────────────────── */

/**
 * PATCH /api/users/:id → { user }
 *
 * Same contract as the web app's UserProvider.updateProfile: send a partial
 * user, get the full normalized user back. The caller replaces its cached user
 * with the response rather than merging the patch locally, so the server stays
 * the authority on what the profile actually contains.
 */
export async function updateProfile(
  userId: number,
  patch: Partial<User> & { defaultCity?: string },
): Promise<User> {
  const data = await apiJson<{ user: User }>(`/api/users/${userId}`, {
    method: "PATCH",
    json: patch,
  });
  return data.user;
}

/* ── notifications ───────────────────────────────────────────────────────── */

/** GET /api/notifications?userId= → { notifications } */
export async function fetchNotifications(userId: number): Promise<AppNotification[]> {
  const data = await apiJson<{ notifications?: AppNotification[] }>(
    `/api/notifications?userId=${userId}`,
  );
  return data.notifications ?? [];
}

/** POST /api/notifications/read-all — tick off the whole inbox. */
export function markAllNotificationsRead(userId: number): Promise<Record<string, unknown>> {
  return apiJson(`/api/notifications/read-all`, { method: "POST", json: { userId } });
}

/** PATCH /api/notifications/:id — mark a single note read before following its link. */
export function markNotificationRead(id: number): Promise<Record<string, unknown>> {
  return apiJson(`/api/notifications/${id}`, { method: "PATCH", json: { isRead: true } });
}

/** DELETE /api/notifications/:id — remove one note from the inbox. */
export function deleteNotification(id: number): Promise<Record<string, unknown>> {
  return apiJson(`/api/notifications/${id}`, { method: "DELETE" });
}

/* ── site stats ──────────────────────────────────────────────────────────── */

/** GET /api/stats → { stats } — the counters shown on the home hero. */
export async function fetchStats(): Promise<SiteStats | null> {
  const data = await apiJson<{ stats?: SiteStats }>(`/api/stats`);
  return data.stats ?? null;
}

/* ── open matches ────────────────────────────────────────────────────────── */

/** GET /api/matches → { matches } */
export async function fetchMatches(): Promise<Match[]> {
  const data = await apiJson<{ matches?: Match[] }>(`/api/matches`);
  return data.matches ?? [];
}

/** POST /api/matches/:id/join — take a spot in an open game. */
export function joinMatch(
  matchId: number,
  userId: number,
  crewSize = 1,
): Promise<Record<string, unknown>> {
  return apiJson(`/api/matches/${matchId}/join`, {
    method: "POST",
    json: { userId, crewSize },
  });
}

/**
 * DELETE /api/matches/:id/join?userId= — give a spot back.
 *
 * Note the asymmetry with joinMatch: the web app sends userId in the *query
 * string* here but in the *body* for the POST. Kept identical so both apps hit
 * the route the way it expects.
 */
export function leaveMatch(matchId: number, userId: number): Promise<Record<string, unknown>> {
  return apiJson(`/api/matches/${matchId}/join?userId=${userId}`, { method: "DELETE" });
}

/** POST /api/matches — host a new open game. */
export function createMatch(input: {
  title: string;
  venueId: number;
  courtId?: number;
  organizerId: number;
  date: string;
  startTime: string;
  endTime: string;
  pricePerPlayer: number;
  maxPlayers: number;
  crewSize: number;
  openSpots: number;
  chargeMode: string;
  level: string;
  description: string;
}): Promise<Record<string, unknown>> {
  return apiJson(`/api/matches`, { method: "POST", json: input });
}

/* ── bookings ────────────────────────────────────────────────────────────── */

/** GET /api/bookings → { bookings } */
export async function fetchBookings(params?: {
  userId?: number;
  status?: string;
}): Promise<Booking[]> {
  const query = new URLSearchParams();
  if (params?.userId !== undefined) query.set("userId", String(params.userId));
  if (params?.status) query.set("status", params.status);
  const qs = query.toString();
  const data = await apiJson<{ bookings: Booking[] }>(`/api/bookings${qs ? `?${qs}` : ""}`);
  return data.bookings ?? [];
}

/**
 * A single booking.
 *
 * There is no GET /api/bookings/:id — that route only accepts PATCH and DELETE.
 * The list route filters by userId (not id), so this reads the player's bookings
 * and picks the matching one. Passing userId keeps the response small; without
 * it the whole table is fetched, which still works but is wasteful.
 */
export async function fetchBooking(id: number, userId?: number): Promise<Booking> {
  const list = await fetchBookings(userId !== undefined ? { userId } : undefined);
  const found = list.find((b) => b.id === id);
  if (!found) throw new ApiError(404, "Booking not found");
  return found;
}

/** POST /api/bookings → { booking } */
export function createBooking(input: {
  courtId: number;
  userId: number;
  date: string;
  startTime: string;
  endTime?: string;
  durationHours?: number;
  bookerName: string;
  bookerPhone: string;
  paymentMethod?: string;
  notes?: string;
}): Promise<{ booking: Booking }> {
  return apiJson("/api/bookings", { method: "POST", json: input });
}

/** GET /api/bookings/:id/ledger → the append-only payment ledger */
export function fetchLedger(bookingId: number): Promise<Ledger> {
  return apiJson(`/api/bookings/${bookingId}/ledger`);
}

/* ── payments ────────────────────────────────────────────────────────────── */

/**
 * POST /api/payments/esewa/initiate → { fields, ... }
 *
 * On the web this returns form fields that a hidden form submits to eSewa in a
 * popup. React Native has no popup, so the app posts straight back to verify
 * with mockApprove while the gateways are in sandbox mode — the ledger, the
 * statuses and the audit rows are identical either way.
 */
export function initiateEsewa(bookingId: number): Promise<Record<string, unknown>> {
  return apiJson("/api/payments/esewa/initiate", { method: "POST", json: { bookingId } });
}

/** POST /api/payments/esewa/verify → { ok, ... } */
export function verifyEsewa(
  bookingId: number,
  mockApprove = true,
): Promise<Record<string, unknown>> {
  return apiJson("/api/payments/esewa/verify", {
    method: "POST",
    json: { bookingId, mockApprove },
  });
}

/** POST /api/payments/khalti/initiate → { pidx, ... } */
export function initiateKhalti(bookingId: number): Promise<Record<string, unknown>> {
  return apiJson("/api/payments/khalti/initiate", { method: "POST", json: { bookingId } });
}

/** POST /api/payments/khalti/verify → { ok, ... } */
export function verifyKhalti(
  bookingId: number,
  pidx: string,
  mockApprove = true,
): Promise<Record<string, unknown>> {
  return apiJson("/api/payments/khalti/verify", {
    method: "POST",
    json: { bookingId, pidx, mockApprove },
  });
}
