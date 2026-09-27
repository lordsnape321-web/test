<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\Court;
use App\Models\Venue;
use App\Models\Voucher;
use App\Support\Loyalty;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Free-hour vouchers, and how close each venue is to earning one.
 */
class VoucherController extends ApiController
{
    /** GET /api/vouchers?userId= */
    public function index(Request $request): JsonResponse
    {
        $userId = (int) $request->query('userId', 0);

        if ($userId <= 0) {
            return $this->ok(['vouchers' => [], 'progress' => []]);
        }

        $mine = Voucher::where('user_id', $userId)->get();
        $myBookings = Booking::where('user_id', $userId)->get();

        $courtIds = $myBookings->pluck('court_id')->filter()->unique()->all();
        $courts = $courtIds === [] ? collect() : Court::whereIn('id', $courtIds)->get()->keyBy('id');
        $venues = Venue::all()->keyBy('id');

        $month = Loyalty::monthKey();

        // Count this month's paid, non-free games per venue. Counting bookings
        // rather than a stored counter means a cancelled game stops counting the
        // moment it is cancelled.
        $counts = [];

        foreach ($myBookings as $b) {
            if (! in_array($b->status, ['confirmed', 'completed'], true) || (bool) $b->is_free_play) {
                continue;
            }

            $court = $courts->get((int) $b->court_id);

            if (! $court || ! $b->created_at || Loyalty::monthKey($b->created_at) !== $month) {
                continue;
            }

            $counts[(int) $court->venue_id] = ($counts[(int) $court->venue_id] ?? 0) + 1;
        }

        $progress = [];

        foreach ($counts as $venueId => $count) {
            $venue = $venues->get($venueId);

            $progress[] = [
                'venueId' => $venueId,
                'venueName' => $venue->name ?? 'Futsal',
                'venueImage' => $venue->image_url ?? '',
                'count' => $count,
                'target' => Loyalty::LOYALTY_TARGET,
                'remaining' => max(0, Loyalty::LOYALTY_TARGET - $count),
                'done' => $count >= Loyalty::LOYALTY_TARGET,
            ];
        }

        $enriched = $mine
            ->map(fn (Voucher $v) => $v->toArray() + ['venue' => $venues->get((int) $v->venue_id)])
            ->sortByDesc('id')
            ->values()
            ->all();

        return $this->ok(['vouchers' => $enriched, 'progress' => $progress, 'month' => $month]);
    }
}
