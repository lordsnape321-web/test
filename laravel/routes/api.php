<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AvailabilityController;
use App\Http\Controllers\Api\BookingController;
use App\Http\Controllers\Api\CourtController;
use App\Http\Controllers\Api\EsewaController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\KhaltiController;
use App\Http\Controllers\Api\LedgerController;
use App\Http\Controllers\Api\MatchController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\PaymentRequestController;
use App\Http\Controllers\Api\PlayerController;
use App\Http\Controllers\Api\PromoController;
use App\Http\Controllers\Api\ReviewController;
use App\Http\Controllers\Api\StatsController;
use App\Http\Controllers\Api\TeamController;
use App\Http\Controllers\Api\TeamInviteController;
use App\Http\Controllers\Api\TeamPaymentController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\VenueController;
use App\Http\Controllers\Api\VoucherController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Futsal Nepal API
|--------------------------------------------------------------------------
|
| Every route the Expo app calls. The paths and response shapes are the
| contract the app was written against — `docs/api-routes.md` in the Next.js
| app is the generated inventory, and the suites in its `tests/api/` can be
| pointed at this host with BASE_URL to check the port.
|
| Authentication: none. The app holds the signed-in user in AsyncStorage and
| passes `userId` on the requests that need to know who is acting, exactly as
| it did against the Next.js API.
|
*/

Route::get('/health', HealthController::class);
Route::get('/stats', StatsController::class);
Route::get('/availability', [AvailabilityController::class, 'index']);

/* ── auth ───────────────────────────────────────────────────────────────── */
Route::post('/auth/signup', [AuthController::class, 'signup']);
Route::post('/auth/login', [AuthController::class, 'login']);
Route::post('/auth/reset', [AuthController::class, 'reset']);
Route::post('/auth/change-password', [AuthController::class, 'changePassword']);

/* ── users ──────────────────────────────────────────────────────────────── */
Route::get('/users', [UserController::class, 'index']);
Route::get('/users/{id}', [UserController::class, 'show'])->whereNumber('id');
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

// A captain's directed request for a teammate to pay the venue.
Route::get('/bookings/{id}/payment-requests', [PaymentRequestController::class, 'index'])->whereNumber('id');
Route::post('/bookings/{id}/payment-requests', [PaymentRequestController::class, 'store'])->whereNumber('id');
Route::patch('/bookings/{id}/payment-requests/{requestId}', [PaymentRequestController::class, 'update'])
    ->whereNumber('id')
    ->whereNumber('requestId');

/* ── test gateways ─────────────────────────────────────────────────────── */
Route::post('/payments/esewa/initiate', [EsewaController::class, 'initiate']);
Route::post('/payments/esewa/verify', [EsewaController::class, 'verify']);
Route::post('/payments/khalti/initiate', [KhaltiController::class, 'initiate']);
Route::post('/payments/khalti/verify', [KhaltiController::class, 'verify']);

/* ── open matches ───────────────────────────────────────────────────────── */
Route::get('/matches', [MatchController::class, 'index']);
Route::post('/matches', [MatchController::class, 'store']);
Route::post('/matches/{id}/join', [MatchController::class, 'join'])->whereNumber('id');
Route::delete('/matches/{id}/join', [MatchController::class, 'leave'])->whereNumber('id');

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
