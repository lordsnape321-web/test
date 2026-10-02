<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BatchController;
use App\Http\Controllers\Api\AvailabilityController;
use App\Http\Controllers\Api\BookingController;
use App\Http\Controllers\Api\CourtController;
use App\Http\Controllers\Api\EsewaController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\KhaltiController;
use App\Http\Controllers\Api\LedgerController;
use App\Http\Controllers\Api\MatchController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\PaymentHandoffController;
use App\Http\Controllers\Api\PaymentRequestController;
use App\Http\Controllers\Api\PlayerController;
use App\Http\Controllers\Api\PromoController;
use App\Http\Controllers\Api\ReviewController;
use App\Http\Controllers\Api\SeedController;
use App\Http\Controllers\Api\StatsController;
use App\Http\Controllers\Api\TeamController;
use App\Http\Controllers\Api\TeamInviteController;
use App\Http\Controllers\Api\TeamLedgerController;
use App\Http\Controllers\Api\TeamPaymentController;
use App\Http\Controllers\Api\TournamentController;
use App\Http\Controllers\Api\TournamentMatchController;
use App\Http\Controllers\Api\TournamentMediaController;
use App\Http\Controllers\Api\TournamentPaymentController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\VenueController;
use App\Http\Controllers\Api\VoucherController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Futsal Mate API
|--------------------------------------------------------------------------
|
| Every route the Expo app calls. The paths and response shapes are the
| public mobile API contract; the acceptance suites in `tests/api/` can be
| pointed at this host with BASE_URL to verify it.
|
| Authentication: none. The app holds the signed-in user in AsyncStorage and
| passes `userId` on the requests that need to know who is acting.
|
*/

Route::get('/health', HealthController::class);

/*
 * Several reads in one round trip. The expo client batches the requests a
 * screen makes in the same tick through this route — see the controller for
 * why the dev server makes that worth doing.
 */
Route::post('/batch', BatchController::class);
Route::get('/stats', StatsController::class);
Route::get('/availability', [AvailabilityController::class, 'index']);

/* ── auth ───────────────────────────────────────────────────────────────── */
// Signup is two steps: the code first, then the form with the code in it.
Route::post('/auth/signup/code', [AuthController::class, 'signupCode']);
Route::post('/auth/signup', [AuthController::class, 'signup']);
Route::post('/auth/login', [AuthController::class, 'login']);
Route::post('/auth/reset', [AuthController::class, 'reset']);
Route::post('/auth/forgot-password', [AuthController::class, 'forgotPassword']);
Route::post('/auth/reset-with-code', [AuthController::class, 'resetWithCode']);
Route::post('/auth/change-password', [AuthController::class, 'changePassword']);

/* ── users ──────────────────────────────────────────────────────────────── */
Route::get('/users', [UserController::class, 'index']);
Route::get('/users/{id}', [UserController::class, 'show'])->whereNumber('id');
// Closing an account: ask for the emailed code, then spend it.
Route::post('/users/{id}/delete-code', [UserController::class, 'sendDeleteCode'])->whereNumber('id');
Route::delete('/users/{id}', [UserController::class, 'destroy'])->whereNumber('id');
Route::patch('/users/{id}', [UserController::class, 'update'])->whereNumber('id');

/* ── venues & courts ────────────────────────────────────────────────────── */
Route::get('/venues', [VenueController::class, 'index']);
Route::post('/venues', [VenueController::class, 'store']);
Route::get('/venues/{id}', [VenueController::class, 'show'])->whereNumber('id');
Route::patch('/venues/{id}', [VenueController::class, 'update'])->whereNumber('id');
Route::delete('/venues/{id}', [VenueController::class, 'destroy'])->whereNumber('id');

Route::post('/courts', [CourtController::class, 'store']);
Route::patch('/courts/{id}', [CourtController::class, 'update'])->whereNumber('id');
Route::delete('/courts/{id}', [CourtController::class, 'destroy'])->whereNumber('id');

/* ── bookings ───────────────────────────────────────────────────────────── */
Route::get('/bookings', [BookingController::class, 'index']);
Route::post('/bookings', [BookingController::class, 'store']);
Route::patch('/bookings/{id}', [BookingController::class, 'update'])->whereNumber('id');
Route::delete('/bookings/{id}', [BookingController::class, 'destroy'])->whereNumber('id');

// The venue owner's side of a booking's money.
Route::get('/bookings/{id}/ledger', [LedgerController::class, 'show'])->whereNumber('id');
Route::post('/bookings/{id}/ledger', [LedgerController::class, 'store'])->whereNumber('id');

// Each member's share of a team booking.
Route::get('/bookings/{id}/team-payments', [TeamPaymentController::class, 'index'])->whereNumber('id');
Route::post('/bookings/{id}/team-payments', [TeamPaymentController::class, 'store'])->whereNumber('id');
// A squad member settles their own share, to the captain or to the venue.
Route::post('/bookings/{id}/team-payments/{userId}/settle', [TeamPaymentController::class, 'settle'])
    ->whereNumber('id')
    ->whereNumber('userId');

// The captain's own ledger: what each squad member has handed over, and by
// which medium. Separate from the venue's ledger on purpose — see TeamLedgerController.
Route::get('/bookings/{id}/team-ledger', [TeamLedgerController::class, 'show'])->whereNumber('id');
Route::post('/bookings/{id}/team-ledger', [TeamLedgerController::class, 'store'])->whereNumber('id');

// A captain's directed request for a teammate to pay the venue.
Route::get('/bookings/{id}/payment-requests', [PaymentRequestController::class, 'index'])->whereNumber('id');
Route::post('/bookings/{id}/payment-requests', [PaymentRequestController::class, 'store'])->whereNumber('id');
Route::patch('/bookings/{id}/payment-requests/{requestId}', [PaymentRequestController::class, 'update'])
    ->whereNumber('id')
    ->whereNumber('requestId');

/* ── test gateways ─────────────────────────────────────────────────────── */
// A page, not JSON: browsers that cannot POST a form (a native app's system
// browser) open this to finish an eSewa checkout. See the controller.
Route::get('/payments/esewa/handoff', [PaymentHandoffController::class, 'esewa']);
// The demo checkout, served as a page at an API path: the web build reaches
// this backend through its `/api` proxy, and a device calls it directly. See
// `laravel/public/demo-{esewa,khalti}.html`.
Route::get('/payments/{gateway}/demo', [PaymentHandoffController::class, 'demo'])
    ->where('gateway', 'esewa|khalti');
// The same page for a league entry fee, replaying the tournament endpoint.
Route::get('/payments/esewa/handoff/league', [PaymentHandoffController::class, 'leagueEsewa']);
Route::post('/payments/esewa/initiate', [EsewaController::class, 'initiate']);
Route::post('/payments/esewa/verify', [EsewaController::class, 'verify']);
Route::post('/payments/khalti/initiate', [KhaltiController::class, 'initiate']);
Route::post('/payments/khalti/verify', [KhaltiController::class, 'verify']);

/* ── open matches ───────────────────────────────────────────────────────── */
Route::get('/matches', [MatchController::class, 'index']);
Route::post('/matches', [MatchController::class, 'store']);
// Taking a spot is a request, and the host is the one who answers it.
Route::post('/matches/{id}/join', [MatchController::class, 'join'])->whereNumber('id');
Route::delete('/matches/{id}/join', [MatchController::class, 'leave'])->whereNumber('id');
Route::get('/matches/{id}/joins', [MatchController::class, 'joins'])->whereNumber('id');
Route::post('/matches/{id}/joins', [MatchController::class, 'decideJoin'])->whereNumber('id');
Route::post('/matches/{id}/joins/pay', [MatchController::class, 'payJoin'])->whereNumber('id');

/* ── notifications ──────────────────────────────────────────────────────── */
Route::get('/notifications', [NotificationController::class, 'index']);
Route::post('/notifications', [NotificationController::class, 'store']);
Route::post('/notifications/read-all', [NotificationController::class, 'readAll']);
Route::patch('/notifications/{id}', [NotificationController::class, 'update'])->whereNumber('id');
Route::delete('/notifications/{id}', [NotificationController::class, 'destroy'])->whereNumber('id');

/* ── loyalty vouchers ───────────────────────────────────────────────────── */
Route::get('/vouchers', [VoucherController::class, 'index']);

/* ── squads ─────────────────────────────────────────────────────────────── */
Route::get('/teams', [TeamController::class, 'index']);
Route::post('/teams', [TeamController::class, 'store']);
Route::get('/teams/{id}', [TeamController::class, 'show'])->whereNumber('id');
Route::patch('/teams/{id}', [TeamController::class, 'update'])->whereNumber('id');

// Asking to join, and leaving again.
Route::post('/teams/{id}/join', [TeamController::class, 'join'])->whereNumber('id');
Route::delete('/teams/{id}/join', [TeamController::class, 'leave'])->whereNumber('id');

// The roster: read it, and the captain's one removal right.
Route::get('/teams/{id}/members', [TeamController::class, 'members'])->whereNumber('id');
Route::post('/teams/{id}/members', [TeamController::class, 'addMember'])->whereNumber('id');
Route::delete('/teams/{id}/members', [TeamController::class, 'removeMember'])->whereNumber('id');

// Invitations out.
Route::get('/teams/{id}/invites', [TeamController::class, 'invites'])->whereNumber('id');
Route::post('/teams/{id}/invites', [TeamController::class, 'invite'])->whereNumber('id');
Route::delete('/teams/{id}/invites', [TeamController::class, 'withdrawInvite'])->whereNumber('id');

// The captain's join-request queue.
Route::get('/teams/{id}/requests', [TeamController::class, 'requests'])->whereNumber('id');
Route::post('/teams/{id}/requests', [TeamController::class, 'decideRequest'])->whereNumber('id');

/* ── invitations in ─────────────────────────────────────────────────────── */
Route::get('/team-invites', [TeamInviteController::class, 'index']);
Route::post('/team-invites', [TeamInviteController::class, 'store']);

/* ── players ────────────────────────────────────────────────────────────── */
Route::get('/players/{id}', [PlayerController::class, 'show'])->whereNumber('id');

/* ── reviews ────────────────────────────────────────────────────────────── */
Route::get('/reviews', [ReviewController::class, 'index']);
Route::post('/reviews', [ReviewController::class, 'store']);
Route::delete('/reviews', [ReviewController::class, 'destroy']);

/* ── promo codes ─────────────────────────────────────────────────────────── */
Route::get('/promos', [PromoController::class, 'index']);
Route::post('/promos', [PromoController::class, 'store']);
Route::get('/promos/{id}', [PromoController::class, 'show'])->whereNumber('id');
Route::patch('/promos/{id}', [PromoController::class, 'update'])->whereNumber('id');
Route::delete('/promos/{id}', [PromoController::class, 'destroy'])->whereNumber('id');

/* ── leagues ─────────────────────────────────────────────────────────────── */
Route::get('/tournaments', [TournamentController::class, 'index']);
Route::post('/tournaments', [TournamentController::class, 'store']);
Route::get('/tournaments/{id}', [TournamentController::class, 'show'])->whereNumber('id');
Route::patch('/tournaments/{id}', [TournamentController::class, 'update'])->whereNumber('id');

// The entry desk: who is in, and the five conversations a host has with a
// captain (request / invite / approve / reject / withdraw).
Route::get('/tournaments/{id}/teams', [TournamentController::class, 'teamsIndex'])->whereNumber('id');
Route::post('/tournaments/{id}/teams', [TournamentController::class, 'teamsAction'])->whereNumber('id');

// The fixture book: draw it, schedule it, score it.
Route::get('/tournaments/{id}/matches', [TournamentMatchController::class, 'index'])->whereNumber('id');
Route::post('/tournaments/{id}/matches', [TournamentMatchController::class, 'store'])->whereNumber('id');

// The album — and its delete, which lives on the POST body as `action`.
Route::get('/tournaments/{id}/media', [TournamentMediaController::class, 'index'])->whereNumber('id');
Route::post('/tournaments/{id}/media', [TournamentMediaController::class, 'store'])->whereNumber('id');

// The ledger.
Route::get('/tournaments/{id}/payments', [TournamentPaymentController::class, 'index'])->whereNumber('id');
Route::post('/tournaments/{id}/payments', [TournamentPaymentController::class, 'store'])->whereNumber('id');

/* ── demo data ───────────────────────────────────────────────────────────── */
// Idempotent: safe to hit twice, and the way a fresh database gets its first
// grounds, squads and leagues.
Route::get('/seed', [SeedController::class, 'index']);
Route::post('/seed', [SeedController::class, 'store']);
