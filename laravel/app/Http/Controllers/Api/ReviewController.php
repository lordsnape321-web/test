<?php

namespace App\Http\Controllers\Api;

use App\Models\Court;
use App\Models\Review;
use App\Models\User;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\Futsal;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Venue reviews — one per player per venue.
 */
class ReviewController extends ApiController
{
    /** GET /api/reviews?venueId=&userId= */
    public function index(Request $request): JsonResponse
    {
        $query = Review::query()->orderByDesc('created_at')->orderByDesc('id');

        if ($request->filled('venueId')) {
            $query->where('venue_id', (int) $request->query('venueId'));
        }

        if ($request->filled('userId')) {
            $query->where('user_id', (int) $request->query('userId'));
        }

        $rows = $query->get();
        $userIds = $rows->pluck('user_id')->filter()->unique()->all();
        $users = $userIds === [] ? collect() : User::whereIn('id', $userIds)->get()->keyBy('id');

        $enriched = $rows->map(function (Review $r) use ($users) {
            $u = $users->get((int) $r->user_id);

            return $r->toArray() + [
                'userName' => $u->name ?? 'Player',
                'avatarColor' => $u->avatar_color ?? '#22c55e',
                'avatarUrl' => $u->avatar_url ?? '',
                'userLevel' => $u->level ?? '',
            ];
        })->all();

        return $this->ok(['reviews' => $enriched]);
    }

    /** POST /api/reviews — write one, or update the one already there. */
    public function store(Request $request): JsonResponse
    {
        $venueId = (int) $request->input('venueId', 0);
        $userId = (int) $request->input('userId', 0);
        $bookingId = $request->filled('bookingId') ? (int) $request->input('bookingId') : null;
        $ratingRaw = (int) $request->input('rating', 5);
        $message = trim((string) $request->input('message', ''));

        $error = Validation::firstError(
            $venueId <= 0 ? 'Pick a valid venue 📍' : null,
            $userId <= 0 ? 'Login to post a review 🔒' : null,
            $ratingRaw < 1 || $ratingRaw > 5 ? 'Tap 1–5 stars ⭐' : null,
            Validation::message($message, ['min' => 3, 'max' => 1000, 'label' => 'Review']),
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        // Eligibility: the reviewer must actually have played here.
        $myBookings = \App\Models\Booking::where('user_id', $userId)->get();
        $courtIds = $myBookings->pluck('court_id')->filter()->unique()->all();
        $courts = $courtIds === [] ? collect() : Court::whereIn('id', $courtIds)->get()->keyBy('id');

        $playedHere = $myBookings->filter(function ($b) use ($venueId, $courts) {
            $court = $courts->get((int) $b->court_id);

            return $court && (int) $court->venue_id === $venueId && Futsal::gamePlayed($b->getAttributes());
        })->values();

        if ($playedHere->isEmpty()) {
            return $this->fail('Play a game here first — reviews unlock after you’ve played! ⚽', 403);
        }

        if ($bookingId && ! $playedHere->contains(fn ($b) => (int) $b->id === $bookingId)) {
            return $this->fail('That game isn’t reviewable yet.', 403);
        }

        /*
         * One review per player per venue. However many games someone plays
         * here, their voice shows up once: the first review inserts, every
         * later one updates that same row, so the venue page never ends up with
         * an old and a new review from the same player.
         */
        $existing = Review::where('user_id', $userId)->where('venue_id', $venueId)->first();

        if ($existing) {
            $existing->forceFill([
                'rating' => $ratingRaw,
                'message' => $message,
                // Keep pointing at the game the review came from when the
                // player did not pick one this time.
                'booking_id' => $bookingId ?? $existing->booking_id,
                'updated_at' => now(),
            ])->save();

            $saved = $existing->fresh();
        } else {
            $saved = Review::create([
                'venue_id' => $venueId,
                'user_id' => $userId,
                'booking_id' => $bookingId,
                'rating' => $ratingRaw,
                'message' => $message,
            ]);
        }

        $venue = Venue::find($venueId);

        if ($venue) {
            $all = Review::where('venue_id', $venueId)->get();
            $avg = $all->avg('rating') ?? 0;

            $venue->forceFill([
                'rating' => round($avg * 10) / 10,
                'total_reviews' => $all->count(),
            ])->save();

            if ($venue->owner_id) {
                $who = User::find($userId)->name ?? 'A player';

                Notifier::notify(
                    (int) $venue->owner_id,
                    'review',
                    $existing
                        ? "⭐ {$who} updated their review — {$venue->name}"
                        : "⭐ New {$ratingRaw}-star review — {$venue->name}",
                    $who.' says: "'.mb_substr($message, 0, 120).(mb_strlen($message) > 120 ? '…' : '').'"',
                    '/admin/venues'
                );
            }
        }

        return $this->ok(['review' => $saved->toArray(), 'updated' => (bool) $existing], $existing ? 200 : 201);
    }

    /**
     * DELETE /api/reviews
     *
     * Reviews are locked once written. A player keeps their one review: it can
     * be updated after another game here, but not removed, so a venue's rating
     * cannot be scrubbed by deleting the bad ones. The endpoint stays so old
     * clients get a clear answer instead of a 405.
     */
    public function destroy(): JsonResponse
    {
        return $this->fail('Reviews are locked 🔒 — you can’t delete one, but you can update it after your next game here.', 403);
    }
}
