<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\Court;
use App\Models\Venue;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CourtController extends ApiController
{
    private const FORMATS = ['5v5', '6v6', '7v7', '8v8'];

    /** POST /api/courts — add a pitch to a venue. */
    public function store(Request $request): JsonResponse
    {
        $venueId = (int) $request->input('venueId', 0);
        $ownerId = (int) $request->input('ownerId', 0);
        $name = trim((string) $request->input('name', ''));

        if ($venueId <= 0) {
            return $this->fail('Pick a valid venue 📍', 400);
        }

        $error = Validation::firstError(
            Validation::courtName($name),
            $request->filled('format') && ! in_array((string) $request->input('format'), self::FORMATS, true)
                ? 'Pick a valid format (5v5–8v8) ⚽' : null,
            Validation::money($request->input('pricePerHour', 1500), ['min' => 100, 'max' => 20000, 'label' => 'Price per hour']),
            $request->has('priceMorning')
                ? Validation::money($request->input('priceMorning'), ['min' => 100, 'max' => 20000, 'label' => 'Morning price'])
                : null,
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        $venue = Venue::find($venueId);

        if (! $venue) {
            return $this->fail('Venue not found', 404);
        }

        if ($venue->owner_id && $ownerId && (int) $venue->owner_id !== $ownerId) {
            return $this->fail('Only the venue owner can add courts', 403);
        }

        $price = (int) $request->input('pricePerHour', 1500);

        $court = Court::create([
            'venue_id' => $venueId,
            'name' => $name,
            'format' => (string) $request->input('format', '5v5'),
            'surface' => mb_substr((string) $request->input('surface', 'Artificial Turf'), 0, 60),
            'price_per_hour' => $price,
            'price_morning' => (int) $request->input('priceMorning', (int) round($price * 0.75)),
            'image_url' => mb_substr((string) $request->input('imageUrl', ''), 0, 2000000),
            'features' => mb_substr((string) $request->input('features', 'Floodlights,Nets Provided,Match Balls'), 0, 500),
        ]);

        return $this->ok(['court' => $court->toArray()], 201);
    }

    /** PATCH /api/courts/{id} */
    public function update(Request $request, int $id): JsonResponse
    {
        $error = Validation::firstError(
            $request->has('name') ? Validation::courtName($request->input('name')) : null,
            $request->has('format') && ! in_array((string) $request->input('format'), self::FORMATS, true)
                ? 'Pick a valid format (5v5–8v8) ⚽' : null,
            $request->has('surface') && mb_strlen(trim((string) $request->input('surface'))) > 60 ? 'Surface name too long (max 60)' : null,
            $request->has('pricePerHour') ? Validation::money($request->input('pricePerHour'), ['min' => 100, 'max' => 20000, 'label' => 'Price per hour']) : null,
            $request->has('priceMorning') ? Validation::money($request->input('priceMorning'), ['min' => 100, 'max' => 20000, 'label' => 'Morning price']) : null,
            $request->has('features') && mb_strlen((string) $request->input('features')) > 500 ? 'Facilities list too long (max 500)' : null,
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        $court = Court::find($id);

        if (! $court) {
            return $this->fail('Court not found', 404);
        }

        $patch = [];

        if ($request->has('name')) {
            $patch['name'] = trim((string) $request->input('name'));
        }

        if ($request->has('format')) {
            $patch['format'] = (string) $request->input('format');
        }

        if ($request->has('surface')) {
            $patch['surface'] = mb_substr((string) $request->input('surface'), 0, 60);
        }

        if ($request->has('pricePerHour')) {
            $patch['price_per_hour'] = (int) $request->input('pricePerHour');
        }

        if ($request->has('priceMorning')) {
            $patch['price_morning'] = (int) $request->input('priceMorning');
        }

        if ($request->has('isActive')) {
            $patch['is_active'] = filter_var($request->input('isActive'), FILTER_VALIDATE_BOOLEAN);
        }

        if ($request->has('features')) {
            $patch['features'] = mb_substr((string) $request->input('features'), 0, 500);
        }

        if ($request->has('imageUrl')) {
            $patch['image_url'] = mb_substr((string) $request->input('imageUrl'), 0, 2000000);
        }

        if ($patch !== []) {
            $court->forceFill($patch)->save();
        }

        return $this->ok(['court' => $court->fresh()->toArray()]);
    }

    /**
     * DELETE /api/courts/{id} — retire one court.
     *
     * Same shape as retiring a venue, one level down: owner-only, soft, and
     * refused while somebody still has a game booked on it — a player who paid a
     * deposit cannot be left pointing at a pitch that vanished.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $court = Court::find($id);

        if (! $court) {
            return $this->fail('Court not found ⚽', 404);
        }

        // Ownership lives on the venue, so go up a level to check who is asking.
        $venue = Venue::find($court->venue_id);
        $actor = (int) ($request->input('ownerId') ?? $request->input('userId') ?? 0);

        if (! $venue?->owner_id || $actor !== (int) $venue->owner_id) {
            return $this->fail('Only the venue owner can delete this court 🔒', 403);
        }

        if ($court->deleted_at) {
            return $this->ok([
                'ok' => true,
                'alreadyDeleted' => true,
                'message' => "{$court->name} is already retired.",
            ]);
        }

        $today = now()->toDateString();

        $upcoming = Booking::where('court_id', $id)
            ->whereNotIn('status', ['cancelled', 'rejected'])
            ->where('date', '>=', $today)
            ->count();

        if ($upcoming > 0) {
            return $this->fail(
                "{$court->name} still has {$upcoming} booking".($upcoming === 1 ? '' : 's')
                ." to come — cancel or play them before retiring this court, so nobody turns up to a pitch that’s gone 📅",
                409,
                ['reason' => 'upcoming_bookings', 'upcoming' => $upcoming]
            );
        }

        $court->forceFill(['deleted_at' => now(), 'is_active' => false])->save();

        return $this->ok([
            'ok' => true,
            'court' => $court->fresh()->toArray(),
            'message' => "{$court->name} is retired — it’s off the booking page and out of {$venue->name}’s court count."
                .' Past bookings and payments are untouched 🪦',
        ]);
    }
}
