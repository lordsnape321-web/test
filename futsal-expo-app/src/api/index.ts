import { ApiError, apiJson } from "@/lib/api";
import type { PlayerStats } from "@/lib/loyalty";
import type { Quota as TeamQuota } from "@/lib/teams";
import type {
  AppNotification,
  Booking,
  Court,
  Ledger,
  LoyaltyProgress,
  ManagedTeam,
  Match,
  LeagueDetail,
  LeagueMediaRow,
  LeagueSummary,
  PlayerDossier,
  SiteStats,
  TeamCard,
  TeamDetail,
  TeamInvite,
  TeamRosterRow,
  TeamSearchHit,
  TeamSentInvite,
  TeamRequestRow,
  User,
  UserTeamLite,
  Voucher,
  Venue,
} from "@/lib/types";

/**
 * Typed calls for the complete player and Owner Studio experience: auth, courts,
 * bookings, payments, matches, leagues, teams, players, notifications, reviews,
 * and owner management.
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
  /** Player or venue-owner account; the web API defaults to player. */
  role?: "player" | "owner";
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

/** GET /api/users/:id → { user, stats } — refresh the cached session profile. */
export async function fetchUser(userId: number): Promise<User> {
  const data = await apiJson<{ user: User }>(`/api/users/${userId}`);
  return data.user;
}

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

/** GET /api/users/:id → { user, stats } — the player reliability stats. */
export async function fetchUserStats(userId: number): Promise<PlayerStats | null> {
  const data = await apiJson<{ stats?: PlayerStats }>(`/api/users/${userId}`);
  return data.stats ?? null;
}

/** GET /api/vouchers?userId= → { vouchers, progress, month } — loyalty rewards. */
export async function fetchVouchers(
  userId: number,
): Promise<{ vouchers: Voucher[]; progress: LoyaltyProgress[]; month: string }> {
  const data = await apiJson<{
    vouchers?: Voucher[];
    progress?: LoyaltyProgress[];
    month?: string;
  }>(`/api/vouchers?userId=${userId}`);
  return {
    vouchers: data.vouchers ?? [],
    progress: data.progress ?? [],
    month: data.month ?? "",
  };
}

/**
 * POST /api/auth/change-password. Throws ApiError with the server's message
 * ("Current password is incorrect 🔒") on a wrong current password.
 */
export function changePassword(input: {
  userId: number;
  currentPassword: string;
  newPassword: string;
}): Promise<Record<string, unknown>> {
  return apiJson(`/api/auth/change-password`, { method: "POST", json: input });
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
  paymentStatus?: string;
  receiptUrl?: string;
  useFreePlay?: boolean;
  promoCode?: string;
  notes?: string;
  visibility?: "private" | "public" | "competition";
  teamId?: number;
  opponentTeamId?: number;
  tournamentId?: number;
  playersNeeded?: number;
  ourCrew?: number;
  openSpots?: number;
  matchTitle?: string;
  level?: string;
  chargeMode?: "split" | "custom";
  customPricePerPlayer?: number;
}): Promise<{ booking: Booking; freePlayUsed?: boolean; promo?: unknown; competition?: unknown }> {
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

/* ── leagues ─────────────────────────────────────────────────────────────── */

/** GET /api/tournaments?viewerId=&limit= → { leagues } — the league board. */
export async function fetchLeagues(viewerId?: number): Promise<LeagueSummary[]> {
  const query = new URLSearchParams({ limit: "100" });
  if (viewerId) query.set("viewerId", String(viewerId));
  const data = await apiJson<{ leagues: LeagueSummary[] }>(
    `/api/tournaments?${query}`,
  );
  return data.leagues ?? [];
}

/** GET /api/tournaments/:id?viewerId= → { league: LeagueDetail } */
export async function fetchLeague(id: number, viewerId?: number): Promise<LeagueDetail> {
  const qs = viewerId ? `?viewerId=${viewerId}` : "";
  const data = await apiJson<{ league: LeagueDetail }>(`/api/tournaments/${id}${qs}`);
  return data.league;
}

/** The body LeagueForm posts — identical for create (POST) and edit (PATCH). */
export type LeagueFormPayload = {
  hostId: number;
  name: string;
  venueId: number;
  courtId: number;
  format: string;
  mode: string;
  thirdPlace: boolean;
  groupSize: number;
  maxTeams: number;
  entryFee: number;
  depositPercent: number;
  refundPercent: number;
  prizePool: number;
  prizeBreakdown: string;
  startsAt: string;
  endsAt: string;
  closesAt: string;
  matchDays: string;
  visibility: string;
  status: string;
  description: string;
  rules: string;
  contactPhone: string;
  bannerUrl: string;
};

/**
 * POST /api/tournaments → 201 { league } (a raw row, not a LeagueDetail —
 * callers navigate to `/leagues/:id` and refetch via GET).
 */
export function createLeague(
  payload: LeagueFormPayload,
): Promise<{ league: { id: number } }> {
  return apiJson("/api/tournaments", { method: "POST", json: payload });
}

/** PATCH /api/tournaments/:id → { league } — same payload as create. */
export function updateLeague(
  id: number,
  payload: LeagueFormPayload,
): Promise<{ league: { id: number } }> {
  return apiJson(`/api/tournaments/${id}`, { method: "PATCH", json: payload });
}

/**
 * POST /api/tournaments/:id/teams — request / invite / approve / reject /
 * withdraw. `{ message }` for the error body surfaces through ApiError.
 */
export function leagueTeamsAction(
  id: number,
  body: Record<string, unknown>,
): Promise<{ ok?: boolean; message?: string }> {
  return apiJson(`/api/tournaments/${id}/teams`, { method: "POST", json: body });
}

/**
 * POST /api/tournaments/:id/payments — pay / record / initiate / verify /
 * receipt / prize. Native calls `verify` with `mockApprove: true` directly
 * (the same body the web mock-gateway page posts), skipping initiate+redirect.
 */
export function leaguePaymentsAction(
  id: number,
  body: Record<string, unknown>,
): Promise<{ ok?: boolean; message?: string }> {
  return apiJson(`/api/tournaments/${id}/payments`, { method: "POST", json: body });
}

/** POST /api/tournaments/:id/matches — create | generate, score, delete, schedule, advance. */
export function leagueMatchesAction(
  id: number,
  body: Record<string, unknown>,
): Promise<{ ok?: boolean; message?: string; created?: number }> {
  return apiJson(`/api/tournaments/${id}/matches`, { method: "POST", json: body });
}

/**
 * POST /api/tournaments/:id/media — add / delete (kind: "link" | "file").
 *
 * `teamId` is additive: a newer API may use it for one-squad visibility while
 * the existing matchId/null contract remains valid for older deployments.
 */
export function leagueMediaAction(
  id: number,
  body: Record<string, unknown>,
): Promise<{ ok?: boolean; message?: string; media?: Partial<LeagueMediaRow> & { id?: number } }> {
  return apiJson(`/api/tournaments/${id}/media`, { method: "POST", json: body });
}

/** GET /api/teams?userId= → { teams } — the viewer's squads (role included). */
export async function fetchUserTeams(userId: number): Promise<UserTeamLite[]> {
  const data = await apiJson<{ teams: UserTeamLite[] }>(`/api/teams?userId=${userId}`);
  return data.teams ?? [];
}

/** GET /api/teams?q= → { teams } — host invite search (code or name). */
export async function searchTeams(q: string): Promise<TeamSearchHit[]> {
  const data = await apiJson<{ teams: TeamSearchHit[] }>(
    `/api/teams?q=${encodeURIComponent(q)}`,
  );
  return data.teams ?? [];
}

/* ── teams (list / detail / captain panel) ───────────────────────────────── */

/**
 * GET /api/teams?viewerId=&q= → { teams, quota }.
 *
 * `viewerId` tells the API whose buttons to draw: membership, captaincy and any
 * open request/invite come back on each row so the card never guesses.
 */
export async function fetchTeams(params?: {
  q?: string;
  viewerId?: number;
}): Promise<{ teams: TeamCard[]; quota: TeamQuota | null }> {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.viewerId) query.set("viewerId", String(params.viewerId));
  const qs = query.toString();
  const data = await apiJson<{ teams: TeamCard[]; quota?: TeamQuota | null }>(
    `/api/teams${qs ? `?${qs}` : ""}`,
  );
  return { teams: data.teams ?? [], quota: data.quota ?? null };
}

/** GET /api/team-invites?status=pending&userId= → the player's open invitations. */
export async function fetchMyInvites(userId: number): Promise<TeamInvite[]> {
  const data = await apiJson<{ invites?: TeamInvite[] }>(
    `/api/team-invites?status=pending&userId=${userId}`,
  );
  return (data.invites ?? []).filter((i) => i.status === "pending");
}

/**
 * POST /api/team-invites — accept or decline an invitation.
 * The roster row is created here; consent is what turns invite into member.
 */
export function answerTeamInvite(input: {
  userId: number;
  inviteId: number;
  action: "accept" | "decline";
}): Promise<Record<string, unknown>> {
  return apiJson("/api/team-invites", { method: "POST", json: input });
}

/** POST /api/teams → 201 { team } — start a squad. */
export function createTeam(input: {
  name: string;
  motto: string;
  description: string;
  teamCode: string;
  captainId: number;
  level: string;
  logoColor: string;
  homeVenueId: number;
  maxPlayers: number;
  lookingForPlayers: boolean;
}): Promise<{ team: { id: number; name: string; teamCode: string } }> {
  return apiJson("/api/teams", { method: "POST", json: input });
}

/**
 * POST /api/teams/:id/join — ask to join (body: userId, message?).
 * DELETE /api/teams/:id/join?userId= — withdraw a pending ask or leave.
 *
 * The asymmetry (body for POST, query for DELETE) matches the web app exactly.
 */
export function requestJoinTeam(
  teamId: number,
  userId: number,
  message = "",
): Promise<{ quota?: TeamQuota; alreadyMember?: boolean }> {
  return apiJson(`/api/teams/${teamId}/join`, {
    method: "POST",
    json: { userId, message },
  });
}

export function leaveTeam(
  teamId: number,
  userId: number,
): Promise<{ left?: boolean; cancelled?: boolean }> {
  return apiJson(`/api/teams/${teamId}/join?userId=${userId}`, { method: "DELETE" });
}

/** GET /api/teams/:id?viewerId= → the full squad page. */
export async function fetchTeam(id: number, viewerId?: number): Promise<TeamDetail> {
  const qs = viewerId ? `?viewerId=${viewerId}` : "";
  return apiJson<TeamDetail>(`/api/teams/${id}${qs}`);
}

/** POST /api/teams/:id/requests — captain accepts or declines a join request. */
export function teamRequestAction(input: {
  teamId: number;
  captainId: number;
  requestId: number;
  action: "accept" | "decline";
}): Promise<Record<string, unknown>> {
  return apiJson(`/api/teams/${input.teamId}/requests`, {
    method: "POST",
    json: {
      captainId: input.captainId,
      requestId: input.requestId,
      action: input.action,
    },
  });
}

/** DELETE /api/teams/:id/invites?captainId=&inviteId= — withdraw a sent invite. */
export function withdrawTeamInvite(
  teamId: number,
  captainId: number,
  inviteId: number,
): Promise<Record<string, unknown>> {
  return apiJson(
    `/api/teams/${teamId}/invites?captainId=${captainId}&inviteId=${inviteId}`,
    { method: "DELETE" },
  );
}

/** GET /api/teams/:id/members?viewerId= → { roster } (emails only for captain). */
export async function fetchTeamRoster(
  teamId: number,
  viewerId: number,
): Promise<TeamRosterRow[]> {
  const data = await apiJson<{ roster?: TeamRosterRow[] }>(
    `/api/teams/${teamId}/members?viewerId=${viewerId}`,
  );
  return data.roster ?? [];
}

/** GET /api/teams/:id/requests?captainId= → { requests } — the captain's queue. */
export async function fetchTeamRequests(
  teamId: number,
  captainId: number,
): Promise<TeamRequestRow[]> {
  const data = await apiJson<{ requests?: TeamRequestRow[] }>(
    `/api/teams/${teamId}/requests?captainId=${captainId}`,
  );
  return data.requests ?? [];
}

/** GET /api/teams/:id/invites?captainId=&status=all → { invites, quota }. */
export async function fetchTeamInvites(
  teamId: number,
  captainId: number,
  status: "all" | "pending" = "all",
): Promise<{ invites: TeamSentInvite[]; quota: TeamQuota | null }> {
  const data = await apiJson<{ invites?: TeamSentInvite[]; quota?: TeamQuota | null }>(
    `/api/teams/${teamId}/invites?captainId=${captainId}&status=${status}`,
  );
  return { invites: data.invites ?? [], quota: data.quota ?? null };
}

/** POST /api/teams/:id/invites — invite a player (they decide for themselves). */
export function sendTeamInvite(input: {
  teamId: number;
  captainId: number;
  userId: number;
  message: string;
}): Promise<Record<string, unknown>> {
  return apiJson(`/api/teams/${input.teamId}/invites`, {
    method: "POST",
    json: {
      captainId: input.captainId,
      userId: input.userId,
      message: input.message,
    },
  });
}

/** DELETE /api/teams/:id/members?captainId=&userId= — remove a member. */
export function removeTeamMember(
  teamId: number,
  captainId: number,
  userId: number,
): Promise<Record<string, unknown>> {
  return apiJson(
    `/api/teams/${teamId}/members?captainId=${captainId}&userId=${userId}`,
    { method: "DELETE" },
  );
}

/**
 * PATCH /api/teams/:id — captain edits the squad. `newCaptainId` transfers the
 * armband (the only way captaincy moves — and the only way a captain can later
 * step away, since a team must always have exactly one).
 */
export function updateTeam(
  teamId: number,
  patch: Partial<ManagedTeam> & {
    captainId: number;
    newCaptainId?: number;
  },
): Promise<Record<string, unknown>> {
  return apiJson(`/api/teams/${teamId}`, { method: "PATCH", json: patch });
}

/** GET /api/players/:id?viewerId= → the public dossier of one player. */
export async function fetchPlayerDossier(
  id: number,
  viewerId?: number,
): Promise<PlayerDossier> {
  const qs = viewerId ? `?viewerId=${viewerId}` : "";
  return apiJson<PlayerDossier>(`/api/players/${id}${qs}`);
}

/**
 * GET /api/users?role=player — recruitment list for the captain's invite box.
 * The server filters; the client re-checks `role` before rendering.
 */
export async function fetchPlayerDirectory(): Promise<
  Array<{
    id: number;
    name: string;
    email: string;
    avatarColor: string;
    avatarUrl: string;
    position: string;
    level: string;
    role?: string;
  }>
> {
  const data = await apiJson<{
    users?: Array<{
      id: number;
      name: string;
      email: string;
      avatarColor: string;
      avatarUrl: string;
      position: string;
      level: string;
      role?: string;
    }>;
  }>("/api/users?role=player");
  return data.users ?? [];
}

/**
 * POST /api/seed — idempotent demo data, kicked off on first Teams visit so a
 * fresh database has squads to show (same call the web teams page makes).
 */
export function seedDemo(): Promise<Record<string, unknown>> {
  return apiJson("/api/seed", { method: "POST" });
}

/* ── password reset ──────────────────────────────────────────────────────── */

/**
 * POST /api/auth/reset — prove you own the account with email + phone, then
 * set a fresh password. Throws ApiError with the server's wording.
 */
export function resetPassword(input: {
  email: string;
  phone: string;
  newPassword: string;
}): Promise<Record<string, unknown>> {
  return apiJson("/api/auth/reset", { method: "POST", json: input });
}

/* ── reviews ─────────────────────────────────────────────────────────────── */

/** One row of GET /api/reviews, enriched with the author's profile bits. */
export type ReviewRow = {
  id: number;
  venueId: number;
  userId: number;
  bookingId: number | null;
  rating: number;
  message: string;
  createdAt: string | null;
  updatedAt?: string | null;
  userName: string;
  avatarColor: string;
  avatarUrl?: string;
  userLevel: string;
};

/** GET /api/reviews?venueId=&userId= → { reviews } */
export function fetchReviews(params?: {
  venueId?: number;
  userId?: number;
}): Promise<ReviewRow[]> {
  const query = new URLSearchParams();
  if (params?.venueId !== undefined) query.set("venueId", String(params.venueId));
  if (params?.userId !== undefined) query.set("userId", String(params.userId));
  const qs = query.toString();
  return apiJson<{ reviews: ReviewRow[] }>(`/api/reviews${qs ? `?${qs}` : ""}`).then(
    (d) => d.reviews ?? [],
  );
}

/** POST /api/reviews — one review per player per venue (server enforces). */
export function postReview(input: {
  venueId: number;
  userId: number;
  bookingId?: number | null;
  rating: number;
  message: string;
}): Promise<Record<string, unknown>> {
  return apiJson("/api/reviews", { method: "POST", json: input });
}

/* ── bookings admin ──────────────────────────────────────────────────────── */

/** PATCH /api/bookings/:id — status, receipt, scores, actor… */
export function patchBooking(
  id: number,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return apiJson(`/api/bookings/${id}`, { method: "PATCH", json: patch });
}

/**
 * POST /api/bookings/:id/ledger — instalments, extras, settle/unsettle.
 * Returns { ledger?, message?, error? } depending on the action.
 */
export function ledgerAction(
  bookingId: number,
  body: Record<string, unknown>,
): Promise<{ ledger?: unknown; message?: string; error?: string }> {
  return apiJson(`/api/bookings/${bookingId}/ledger`, { method: "POST", json: body });
}

/* ── venues / courts owner CRUD ──────────────────────────────────────────── */

/** POST /api/venues — owner lists a new arena (with its first court). */
export function createVenue(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return apiJson("/api/venues", { method: "POST", json: input });
}

/** PATCH /api/venues/:id — owner edits the venue profile. */
export function updateVenue(id: number, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  return apiJson(`/api/venues/${id}`, { method: "PATCH", json: patch });
}

/** DELETE /api/venues/:id — soft-retire; body carries ownerId for auth. */
export function deleteVenue(id: number, ownerId: number): Promise<Record<string, unknown>> {
  return apiJson(`/api/venues/${id}`, { method: "DELETE", json: { ownerId } });
}

/** POST /api/courts — add a court to a venue. */
export function createCourt(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return apiJson("/api/courts", { method: "POST", json: input });
}

/** PATCH /api/courts/:id — name, prices, photo, isActive… */
export function updateCourt(id: number, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  return apiJson(`/api/courts/${id}`, { method: "PATCH", json: patch });
}

/** DELETE /api/courts/:id — soft-retire one pitch. */
export function deleteCourt(id: number, ownerId: number): Promise<Record<string, unknown>> {
  return apiJson(`/api/courts/${id}`, { method: "DELETE", json: { ownerId } });
}

/* ── promos ──────────────────────────────────────────────────────────────── */

/** GET /api/promos?ownerId= | venueId= → { promos } */
export function fetchPromos(params?: {
  ownerId?: number;
  venueId?: number;
}): Promise<Array<Record<string, unknown>>> {
  const query = new URLSearchParams();
  if (params?.ownerId !== undefined) query.set("ownerId", String(params.ownerId));
  if (params?.venueId !== undefined) query.set("venueId", String(params.venueId));
  const qs = query.toString();
  return apiJson<{ promos: Array<Record<string, unknown>> }>(`/api/promos${qs ? `?${qs}` : ""}`).then(
    (d) => d.promos ?? [],
  );
}

/** POST /api/promos — create a code for a venue. */
export function createPromo(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return apiJson("/api/promos", { method: "POST", json: input });
}

/** PATCH /api/promos/:id — edit discount/window/limits or pause. */
export function updatePromo(id: number, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  return apiJson(`/api/promos/${id}`, { method: "PATCH", json: patch });
}

/** DELETE /api/promos/:id — remove (redeemed codes are paused server-side). */
export function deletePromo(id: number, ownerId: number): Promise<Record<string, unknown>> {
  return apiJson(`/api/promos/${id}?ownerId=${ownerId}`, { method: "DELETE" });
}
