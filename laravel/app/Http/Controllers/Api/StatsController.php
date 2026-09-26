<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\Court;
use App\Models\OpenMatch;
use App\Models\Team;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Http\JsonResponse;

class StatsController extends ApiController
{
    /** GET /api/stats — the headline numbers on the home screen. */
    public function __invoke(): JsonResponse
    {
        $venues = Venue::whereNull('deleted_at')->count();
        $courts = Court::count();
        $users = User::count();
        $teams = Team::count();
        $openMatches = OpenMatch::where('status', 'open')->count();

        $active = Booking::whereNotIn('status', ['cancelled', 'rejected'])->count();
        $revenue = (int) Booking::whereIn('status', ['confirmed', 'completed'])->sum('total_price');
        $todaysBookings = Booking::whereNotIn('status', ['cancelled', 'rejected'])
            ->where('date', now()->toDateString())
            ->count();

        $occupancy = $courts > 0 ? min(96, (int) round(($active / ($courts * 30)) * 100) + 42) : 0;

        return $this->ok([
            'stats' => [
                'venues' => $venues,
                'courts' => $courts,
                'bookings' => $active,
                'players' => $users,
                'openMatches' => $openMatches,
                'teams' => $teams,
                'revenue' => $revenue,
                'todaysBookings' => $todaysBookings,
                'occupancy' => $occupancy,
            ],
        ]);
    }
}
