<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\Court;
use App\Models\Venue;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class VenueController extends ApiController
{
    private const CITIES = ['Kathmandu', 'Lalitpur', 'Bhaktapur', 'Pokhara', 'Chitwan'];

    /**
     * GET /api/venues
     *
     * Returns each venue with its live courts, court count and cheapest court —
     * the figures every listing card renders, denormalised so the app does not
     * have to fetch courts per venue.
     */
    public function index(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        $city = trim((string) $request->query('city', ''));

        $searchError = Validation::search($q, ['max' => 60]);

        if ($searchError) {
            return $this->fail($searchError, 400, ['venues' => []]);
        }

        if ($city !== '' && $city !== 'All Cities' && ! in_array($city, self::CITIES, true)) {
            return $this->fail('Pick a valid city 📍', 400, ['venues' => []]);
        }

        // A retired venue is out of the shop window: the owner's booking history
        // stays intact, it just stops showing up anywhere.
        $includeDeleted = $request->query('includeDeleted') === '1';
        $includeDeletedCourts = $request->query('includeDeletedCourts') === '1';

        $query = Venue::query();

        if (! $includeDeleted) {
            $query->whereNull('deleted_at');
        }

        if ($q !== '') {
            $query->where(function ($sub) use ($q) {
                $sub->whereRaw('LOWER(name) LIKE ?', ['%'.mb_strtolower($q).'%'])
                    ->orWhereRaw('LOWER(address) LIKE ?', ['%'.mb_strtolower($q).'%']);
            });
        }

        if ($city !== '' && $city !== 'All Cities') {
            $query->where('city', $city);
        }

        $venues = $query->orderBy('id')->get();

        $courtQuery = Court::query();

        if (! $includeDeletedCourts) {
            $courtQuery->whereNull('deleted_at');
        }

        $courts = $courtQuery->orderBy('id')->get();

        $enriched = $venues->map(function (Venue $venue) use ($courts) {
            $venueCourts = $courts->where('venue_id', $venue->id)->values();
            $prices = $venueCourts->pluck('price_per_hour')->filter()->all();

            return [
                ...$venue->toArray(),
                'courts' => $venueCourts->toArray(),
                'courtCount' => $venueCourts->count(),
                'minPrice' => $prices === [] ? 0 : min($prices),
            ];
        })->all();

        return $this->ok(['venues' => $enriched]);
    }

    /** POST /api/venues — create a ground, optionally with its first courts. */
    public function store(Request $request): JsonResponse
    {
        $name = trim((string) $request->input('name', ''));
        $address = trim((string) $request->input('address', ''));
        $city = (string) $request->input('city', 'Kathmandu');
        $phone = trim((string) $request->input('phone', ''));
        $description = trim((string) $request->input('description', ''));
        $openingHour = (int) $request->input('openingHour', 6);
        $closingHour = (int) $request->input('closingHour', 22);

        $acceptedRaw = $request->has('acceptedPayments')
            ? array_values(array_filter(array_map('trim', explode(',', (string) $request->input('acceptedPayments'))), fn ($s) => $s !== ''))
            : ['eSewa', 'Khalti', 'Cash at Venue'];

        $depositPercent = (int) $request->input('depositPercent', 30);
        $defaultExtraFee = (int) $request->input('defaultExtraFee', 0);

        $error = Validation::firstError(
            Validation::venueName($name),
            Validation::address($address),
            ! in_array($city, self::CITIES, true) ? 'Pick a valid city 📍' : null,
            $phone !== '' ? Validation::phone($phone, ['required' => false]) : null,
            Validation::description($description, ['required' => false, 'max' => 1000]),
            Validation::hoursRange($openingHour, $closingHour),
            Validation::paymentMethods($acceptedRaw),
            Validation::depositPercent($depositPercent),
            Validation::money($defaultExtraFee, ['min' => 0, 'max' => 20000, 'label' => 'Default extra fee']),
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        $courts = $request->input('courts');

        if (is_array($courts)) {
            foreach ($courts as $court) {
                $courtError = Validation::firstError(
                    ! is_array($court) || mb_strlen(trim((string) ($court['name'] ?? ''))) < 2 ? 'Each court needs a proper name ⚽' : null,
                    Validation::money($court['pricePerHour'] ?? 1500, ['min' => 100, 'max' => 20000, 'label' => 'Court price']),
                );

                if ($courtError) {
                    return $this->fail($courtError, 400);
                }
            }
        }

        $venue = null;

        DB::transaction(function () use (&$venue, $request, $name, $address, $city, $phone, $description, $openingHour, $closingHour, $acceptedRaw, $depositPercent, $defaultExtraFee, $courts): void {
            $venue = Venue::create([
                'name' => $name,
                'address' => $address,
                'city' => $city,
                'phone' => $phone,
                'description' => $description,
                'image_url' => mb_substr((string) $request->input('imageUrl', ''), 0, 2000000),
                'rating' => 4.5,
                'opening_hour' => $openingHour,
                'closing_hour' => $closingHour,
                'amenities' => mb_substr((string) $request->input('amenities', 'Parking,Changing Room,Shower'), 0, 500),
                'accepted_payments' => implode(',', $acceptedRaw),
                'deposit_percent' => $depositPercent,
                'default_extra_fee' => $defaultExtraFee,
                'default_extra_fee_note' => mb_substr((string) $request->input('defaultExtraFeeNote', ''), 0, 120),
                'is_featured' => false,
                'owner_id' => $request->filled('ownerId') ? (int) $request->input('ownerId') : null,
            ]);

            if (is_array($courts)) {
                foreach ($courts as $court) {
                    $price = (int) ($court['pricePerHour'] ?? 1500);

                    Court::create([
                        'venue_id' => $venue->id,
                        'name' => mb_substr((string) ($court['name'] ?? 'Court 1'), 0, 60),
                        'format' => mb_substr((string) ($court['format'] ?? '5v5'), 0, 10),
                        'surface' => mb_substr((string) ($court['surface'] ?? 'Artificial Turf'), 0, 60),
                        'price_per_hour' => $price,
                        'price_morning' => (int) ($court['priceMorning'] ?? (int) round($price * 0.75)),
                        'image_url' => mb_substr((string) ($court['imageUrl'] ?? ''), 0, 2000000),
                        'features' => mb_substr((string) ($court['features'] ?? 'Floodlights'), 0, 500),
                    ]);
                }
            }
        });

        return $this->ok(['venue' => $venue->toArray()], 201);
    }

    /** GET /api/venues/{id} */
    public function show(int $id): JsonResponse
    {
        $venue = Venue::find($id);

        if (! $venue) {
            return $this->fail('Not found', 404);
        }

        $courts = Court::where('venue_id', $id)->get();
        $courtIds = $courts->pluck('id')->all();
        $totalBookings = $courtIds === [] ? 0 : Booking::whereIn('court_id', $courtIds)->count();

        return $this->ok([
            'venue' => [
                ...$venue->toArray(),
                'courts' => $courts->toArray(),
                'totalBookings' => $totalBookings,
            ],
        ]);
    }

    /** PATCH /api/venues/{id} — owner only. */
    public function update(Request $request, int $id): JsonResponse
    {
        $venue = Venue::find($id);

        if (! $venue) {
            return $this->fail('Not found', 404);
        }

        if ($venue->owner_id && $request->filled('ownerId') && (int) $request->input('ownerId') !== (int) $venue->owner_id) {
            return $this->fail('Only the venue owner can edit this venue', 403);
        }

        $error = Validation::firstError(
            $request->has('name') ? Validation::venueName($request->input('name')) : null,
            $request->has('address') ? Validation::address($request->input('address')) : null,
            $request->has('city') && ! in_array((string) $request->input('city'), self::CITIES, true) ? 'Pick a valid city 📍' : null,
            $request->has('phone') && trim((string) $request->input('phone')) !== '' ? Validation::phone($request->input('phone'), ['required' => false]) : null,
            $request->has('description') ? Validation::description($request->input('description'), ['required' => false, 'max' => 1000]) : null,
            $request->has('openingHour') || $request->has('closingHour')
                ? Validation::hoursRange($request->input('openingHour', $venue->opening_hour), $request->input('closingHour', $venue->closing_hour))
                : null,
            $request->has('amenities') && mb_strlen((string) $request->input('amenities')) > 500 ? 'Facilities list too long (max 500) ✨' : null,
            $request->has('acceptedPayments')
                ? Validation::paymentMethods(array_values(array_filter(array_map('trim', explode(',', (string) $request->input('acceptedPayments'))), fn ($s) => $s !== '')))
                : null,
            $request->has('depositPercent') ? Validation::depositPercent($request->input('depositPercent')) : null,
            $request->has('defaultExtraFee') ? Validation::money($request->input('defaultExtraFee'), ['min' => 0, 'max' => 20000, 'label' => 'Default extra fee']) : null,
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        $patch = [];

        if ($request->has('name')) {
            $patch['name'] = trim((string) $request->input('name'));
        }

        if ($request->has('address')) {
            $patch['address'] = trim((string) $request->input('address'));
        }

        if ($request->has('city')) {
            $patch['city'] = (string) $request->input('city');
        }

        if ($request->has('phone')) {
            $patch['phone'] = trim((string) $request->input('phone'));
        }

        if ($request->has('description')) {
            $patch['description'] = mb_substr(trim((string) $request->input('description')), 0, 1000);
        }

        if ($request->has('openingHour')) {
            $patch['opening_hour'] = (int) $request->input('openingHour');
        }

        if ($request->has('closingHour')) {
            $patch['closing_hour'] = (int) $request->input('closingHour');
        }

        if ($request->has('amenities')) {
            $patch['amenities'] = mb_substr((string) $request->input('amenities'), 0, 500);
        }

        if ($request->has('acceptedPayments')) {
            $patch['accepted_payments'] = implode(',', array_values(array_filter(
                array_map('trim', explode(',', (string) $request->input('acceptedPayments'))),
                fn ($s) => $s !== ''
            )));
        }

        if ($request->has('depositPercent')) {
            $patch['deposit_percent'] = (int) $request->input('depositPercent');
        }

        // What this venue usually adds on top of the court fee — prefills the
        // extra-charge line on the payment desk.
        if ($request->has('defaultExtraFee')) {
            $patch['default_extra_fee'] = (int) $request->input('defaultExtraFee');
        }

        if ($request->has('defaultExtraFeeNote')) {
            $patch['default_extra_fee_note'] = mb_substr((string) $request->input('defaultExtraFeeNote'), 0, 120);
        }

        if ($request->has('imageUrl')) {
            $patch['image_url'] = mb_substr((string) $request->input('imageUrl'), 0, 2000000);
        }

        if ($patch !== []) {
            $venue->forceFill($patch)->save();
        }

        return $this->ok(['venue' => $venue->fresh()->toArray()]);
    }

    /**
     * DELETE /api/venues/{id} — retire the venue.
     *
     * A soft delete, because a venue has bookings, payments, reviews and leagues
     * hanging off it: the row stays and `deleted_at` is stamped, so the venue
     * leaves every listing and its courts stop taking bookings while nobody's
     * history — least of all the owner's money — is erased.
     *
     * It refuses while players still have a game to come. Somebody who paid a
     * deposit for Saturday should not find the ground has quietly ceased to
     * exist; cancel or play those first.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $venue = Venue::find($id);

        if (! $venue) {
            return $this->fail('Not found', 404);
        }

        $actor = (int) ($request->input('ownerId') ?? $request->input('userId') ?? 0);

        if (! $venue->owner_id || $actor !== (int) $venue->owner_id) {
            return $this->fail('Only the venue owner can delete this venue 🔒', 403);
        }

        if ($venue->deleted_at) {
            return $this->ok([
                'ok' => true,
                'alreadyDeleted' => true,
                'message' => "{$venue->name} is already retired.",
            ]);
        }

        $today = now()->toDateString();
        $courtIds = Court::where('venue_id', $id)->pluck('id')->all();

        $upcoming = $courtIds === []
            ? collect()
            : Booking::whereIn('court_id', $courtIds)
                ->whereNotIn('status', ['cancelled', 'rejected'])
                ->where('date', '>=', $today)
                ->get();

        if ($upcoming->isNotEmpty()) {
            $count = $upcoming->count();

            return $this->fail(
                "{$venue->name} still has {$count} booking".($count === 1 ? '' : 's')
                ." to come — cancel or play them before retiring the venue, so nobody turns up to a ground that’s gone 📅",
                409,
                ['reason' => 'upcoming_bookings', 'upcoming' => $count]
            );
        }

        DB::transaction(function () use ($courtIds, $venue): void {
            // Courts go dark with the venue, so nothing new can be booked on it.
            if ($courtIds !== []) {
                Court::whereIn('id', $courtIds)->update(['is_active' => false]);
            }

            $venue->forceFill(['deleted_at' => now()])->save();
        });

        $count = count($courtIds);

        return $this->ok([
            'ok' => true,
            'venue' => $venue->fresh()->toArray(),
            'courtsClosed' => $count,
            'message' => "{$venue->name} is retired — it’s out of every listing and its {$count} court"
                .($count === 1 ? '' : 's').' stopped taking bookings. Past bookings and payments are untouched 🪦',
        ]);
    }
}
