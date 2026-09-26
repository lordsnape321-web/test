<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Support\Futsal;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AvailabilityController extends ApiController
{
    /**
     * GET /api/availability?courtId=&date=
     *
     * The hourly slots already taken on a court for a day, which is what the
     * booking screen greys out.
     */
    public function index(Request $request): JsonResponse
    {
        $courtId = (int) $request->query('courtId', 0);

        if ($courtId <= 0) {
            return $this->ok(['booked' => [], 'error' => 'Pick a valid court ⚽']);
        }

        $date = (string) $request->query('date', '');
        $error = Validation::firstError(Validation::dateISO($date, ['label' => 'Date', 'maxDaysAhead' => 90]));

        if ($error) {
            return $this->ok(['booked' => [], 'error' => $error]);
        }

        $rows = Booking::where('court_id', $courtId)
            ->where('date', $date)
            ->whereNotIn('status', ['cancelled', 'rejected'])
            ->orderBy('id')
            ->get();

        $slots = [];

        foreach ($rows as $row) {
            foreach (Futsal::expandBookingSlots($row->start_time, (float) $row->duration_hours) as $slot) {
                $slots[$slot] = true;
            }
        }

        return $this->ok([
            'booked' => array_keys($slots),
            'bookings' => $rows->toArray(),
        ]);
    }
}
