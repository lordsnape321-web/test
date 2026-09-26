<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AvailabilityController;
use App\Http\Controllers\Api\BookingController;
use App\Http\Controllers\Api\CourtController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\LedgerController;
use App\Http\Controllers\Api\PaymentRequestController;
use App\Http\Controllers\Api\StatsController;
use App\Http\Controllers\Api\TeamPaymentController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\VenueController;
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
