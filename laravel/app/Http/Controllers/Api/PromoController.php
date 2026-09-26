<?php

namespace App\Http\Controllers\Api;

use App\Models\Promo;
use App\Models\Venue;
use App\Support\Promos;
use App\Support\PromoStore;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Promo codes 🎟️
 *
 * Three reads on one route: everything an owner runs, the codes a venue
 * advertises right now, and "can I use this, and what would it take off?".
 */
class PromoController extends ApiController
{
    /**
     * GET /api/promos
     *
     * `?ownerId=` → every promo the owner runs, with usage.
     * `?venueId=` → the codes advertised at that venue right now.
     * `?venueId=&code=&amount=&userId=` → the redemption preview.
     */
    public function index(Request $request): JsonResponse
    {
        $ownerId = $request->query('ownerId');
        $venueId = $request->query('venueId');
        $code = Promos::normalizeCode($request->query('code') ?? '');
        $amountRaw = $request->query('amount');

        /* ------------------------------ owner list ------------------------- */
        if ($ownerId !== null && $ownerId !== '') {
            if ((int) $ownerId <= 0) {
                return $this->fail('Invalid owner 🔒', 400, ['promos' => []]);
            }

            $allVenues = Venue::all();
            $mine = $allVenues->filter(fn (Venue $v) => (int) $v->owner_id === (int) $ownerId)->pluck('id')->map(fn ($v) => (int) $v)->all();

            if ($mine === []) {
                return $this->ok(['promos' => [], 'venueNames' => []]);
            }

            $list = Promo::whereIn('venue_id', $mine)->get();
            $usage = PromoStore::usage($list->pluck('id')->all());

            $venueNames = $allVenues->filter(fn (Venue $v) => in_array((int) $v->id, $mine, true))
                ->mapWithKeys(fn (Venue $v) => [(int) $v->id => $v->name])
                ->all();

            $promos = $list
                ->map(fn (Promo $p) => PromoStore::ownerPromo($p, $usage[$p->id] ?? null))
                ->sortByDesc('id')
                ->values()
                ->all();

            return $this->ok(['promos' => $promos, 'venueNames' => $venueNames]);
        }

        if ($venueId === null || $venueId === '') {
            return $this->fail('Pass venueId or ownerId 📍', 400, ['promos' => []]);
        }

        if ((int) $venueId <= 0) {
            return $this->fail('Invalid venue 📍', 400, ['promos' => []]);
        }

        $venue = Venue::find((int) $venueId);

        if (! $venue) {
            return $this->fail('Venue not found 📍', 404, ['promos' => []]);
        }

        $all = Promo::where('venue_id', (int) $venueId)->get();

        /* ----------------------------- code check -------------------------- */
        if ($code !== '') {
            $amount = (float) ($amountRaw ?? 0);

            if (! is_finite($amount) || $amount < 0 || $amount > 10000000) {
                return $this->fail('Invalid booking amount 💰', 400, ['valid' => false, 'reason' => 'bad_amount']);
            }

            $userId = (int) $request->query('userId', 0) ?: 0;

            if ($request->has('userId') && $userId <= 0) {
                return $this->fail('Invalid player 🔒', 400, ['valid' => false, 'reason' => 'bad_user']);
            }

            $found = $all->first(fn (Promo $p) => $p->code === $code);
            $usage = $found ? (PromoStore::usage([(int) $found->id])[(int) $found->id] ?? null) : null;

            $check = Promos::check([
                'promo' => $found?->toArray(),
                'code' => $code,
                'venueName' => (string) $venue->name,
                'subtotal' => (int) round($amount),
                'usedCount' => $usage['used'] ?? 0,
                'userUsedCount' => $userId ? ($usage['byUser'][$userId] ?? 0) : 0,
            ]);

            if (! ($check['ok'] ?? false) || ! $found) {
                return $this->fail(
                    ($check['ok'] ?? false) ? 'That code isn’t available right now 🎟️' : $check['error'],
                    400,
                    [
                        'valid' => false,
                        'reason' => ($check['ok'] ?? false) ? 'unavailable' : ($check['reason'] ?? null),
                        'promo' => $found ? PromoStore::publicPromo($found) : null,
                    ]
                );
            }

            return $this->ok([
                'valid' => true,
                'promo' => PromoStore::publicPromo($found),
                'subtotal' => (int) round($amount),
                'discount' => $check['discount'],
                'capped' => $check['capped'],
                'payable' => $check['payable'],
                'message' => $check['message'],
            ]);
        }

        /* --------------------------- public discovery ---------------------- */
        // Only advertised, in-window codes — hidden ones stay redeemable but
        // unlisted.
        $live = $all
            ->filter(fn (Promo $p) => (bool) $p->is_active && (bool) $p->is_public && Promos::window($p) === 'live')
            ->sortByDesc(fn (Promo $p) => (int) $p->discount_value)
            ->map(fn (Promo $p) => PromoStore::publicPromo($p))
            ->values()
            ->all();

        return $this->ok(['promos' => $live, 'venueId' => (int) $venueId, 'venueName' => $venue->name]);
    }

    /** POST /api/promos — a venue owner creates a code with an expiry date. */
    public function store(Request $request): JsonResponse
    {
        $venueId = (int) $request->input('venueId', 0);
        $ownerId = (int) $request->input('ownerId', 0);
        $code = Promos::normalizeCode($request->input('code'));
        $title = trim((string) $request->input('title', ''));
        $discountType = $request->input('discountType') === 'flat' ? 'flat' : 'percent';
        $discountValue = (float) $request->input('discountValue', 0);
        $maxDiscount = $discountType === 'percent' ? (float) $request->input('maxDiscount', 0) : 0;
        $minBookingAmount = (float) $request->input('minBookingAmount', 0);
        $startsAt = trim((string) $request->input('startsAt', '')) ?: null;
        $expiresAt = trim((string) $request->input('expiresAt', ''));
        $usageLimit = (float) $request->input('usageLimit', 0);
        $perUserLimit = $request->has('perUserLimit') ? (float) $request->input('perUserLimit', 0) : 1;

        $error = Validation::firstError(
            $venueId <= 0 ? 'Pick a valid venue 📍' : null,
            $ownerId <= 0 ? 'Login to create promo codes 🔒' : null,
            Validation::promoCode($code),
            $title !== '' ? Validation::promoTitle($title) : null,
            Validation::discountType($discountType),
            Validation::discountValue($discountValue, $discountType),
            Validation::maxDiscount($maxDiscount),
            Validation::minBookingAmount($minBookingAmount),
            Validation::usageLimit($usageLimit, 'Total redemption limit'),
            Validation::usageLimit($perUserLimit, 'Per-player limit'),
            Validation::promoWindow($startsAt, $expiresAt),
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        ['venue' => $venue, 'error' => $venueError] = PromoStore::venueForOwner($venueId, $ownerId);

        if ($venueError) {
            return $this->fail($venueError, $venue ? 403 : 404);
        }

        $existing = Promo::where('venue_id', $venueId)->get();

        if ($existing->contains(fn (Promo $p) => $p->code === $code)) {
            return $this->fail(
                "\"{$code}\" is already running at ".($venue->name ?? 'this venue').' — pick another code 🎟️',
                409
            );
        }

        $promo = Promo::create([
            'venue_id' => $venueId,
            'code' => $code,
            'title' => mb_substr($title, 0, 60),
            'discount_type' => $discountType,
            'discount_value' => (int) round($discountValue),
            'max_discount' => (int) round($maxDiscount),
            'min_booking_amount' => (int) round($minBookingAmount),
            'starts_at' => $startsAt,
            'expires_at' => $expiresAt,
            'usage_limit' => (int) round($usageLimit),
            'per_user_limit' => (int) round($perUserLimit),
            'is_public' => $request->has('isPublic') ? $request->boolean('isPublic') : true,
            'is_active' => $request->has('isActive') ? $request->boolean('isActive') : true,
        ]);

        return $this->ok(['promo' => PromoStore::ownerPromo($promo)], 201);
    }

    /** GET /api/promos/{id}?ownerId= — one promo with its redemption stats. */
    public function show(Request $request, int $id): JsonResponse
    {
        $promo = Promo::find($id);

        if (! $promo) {
            return $this->fail('Promo code not found 🎟️', 404);
        }

        $ownerId = (int) $request->query('ownerId', 0);
        ['error' => $error] = PromoStore::venueForOwner((int) $promo->venue_id, $ownerId);

        if ($error) {
            return $this->fail($error, $ownerId ? 403 : 400);
        }

        $usage = PromoStore::usage([(int) $promo->id]);

        return $this->ok(['promo' => PromoStore::ownerPromo($promo, $usage[(int) $promo->id] ?? null)]);
    }

    /** PATCH /api/promos/{id} — owner edits the discount, dates, limits, or pauses it. */
    public function update(Request $request, int $id): JsonResponse
    {
        $promo = Promo::find($id);

        if (! $promo) {
            return $this->fail('Promo code not found 🎟️', 404);
        }

        $ownerId = (int) $request->input('ownerId', 0);

        if ($ownerId <= 0) {
            return $this->fail('Login as the venue owner to change promos 🔒', 403);
        }

        ['venue' => $venue, 'error' => $error] = PromoStore::venueForOwner((int) $promo->venue_id, $ownerId);

        if ($error) {
            return $this->fail($error, $venue ? 403 : 404);
        }

        $discountType = $request->has('discountType')
            ? ($request->input('discountType') === 'flat' ? 'flat' : 'percent')
            : (string) $promo->discount_type;

        $discountValue = $request->has('discountValue') ? (float) $request->input('discountValue') : (float) $promo->discount_value;

        $nextStarts = $request->has('startsAt') ? (trim((string) $request->input('startsAt', '')) ?: null) : $promo->starts_at;
        $nextExpires = $request->has('expiresAt') ? trim((string) $request->input('expiresAt', '')) : $promo->expires_at;

        $validationError = Validation::firstError(
            $request->has('code') ? Validation::promoCode($request->input('code')) : null,
            $request->has('title') && trim((string) $request->input('title')) !== '' ? Validation::promoTitle($request->input('title')) : null,
            $request->has('discountType') ? Validation::discountType($request->input('discountType')) : null,
            $request->has('discountValue') || $request->has('discountType')
                ? Validation::discountValue($discountValue, $discountType) : null,
            $request->has('maxDiscount') ? Validation::maxDiscount($request->input('maxDiscount')) : null,
            $request->has('minBookingAmount') ? Validation::minBookingAmount($request->input('minBookingAmount')) : null,
            $request->has('usageLimit') ? Validation::usageLimit($request->input('usageLimit'), 'Total redemption limit') : null,
            $request->has('perUserLimit') ? Validation::usageLimit($request->input('perUserLimit'), 'Per-player limit') : null,
            $request->has('startsAt') || $request->has('expiresAt')
                ? Validation::promoWindow($nextStarts, $nextExpires) : null,
        );

        if ($validationError) {
            return $this->fail($validationError, 400);
        }

        $patch = [];

        if ($request->has('code')) {
            $code = Promos::normalizeCode($request->input('code'));

            if ($code !== $promo->code) {
                $siblings = Promo::where('venue_id', (int) $promo->venue_id)->get();

                if ($siblings->contains(fn (Promo $p) => (int) $p->id !== (int) $promo->id && $p->code === $code)) {
                    return $this->fail(
                        "\"{$code}\" is already running at ".($venue->name ?? 'this venue').' — pick another 🎟️',
                        409
                    );
                }

                $patch['code'] = $code;
            }
        }

        if ($request->has('title')) {
            $patch['title'] = mb_substr(trim((string) $request->input('title')), 0, 60);
        }

        if ($request->has('discountType')) {
            $patch['discount_type'] = $discountType;
        }

        if ($request->has('discountValue')) {
            $patch['discount_value'] = (int) round($discountValue);
        }

        if ($request->has('maxDiscount')) {
            $patch['max_discount'] = $discountType === 'flat' ? 0 : (int) round((float) $request->input('maxDiscount', 0));
        }

        if ($request->has('minBookingAmount')) {
            $patch['min_booking_amount'] = (int) round((float) $request->input('minBookingAmount', 0));
        }

        if ($request->has('startsAt')) {
            $patch['starts_at'] = $nextStarts;
        }

        if ($request->has('expiresAt')) {
            $patch['expires_at'] = $nextExpires;
        }

        if ($request->has('usageLimit')) {
            $patch['usage_limit'] = (int) round((float) $request->input('usageLimit', 0));
        }

        if ($request->has('perUserLimit')) {
            $patch['per_user_limit'] = (int) round((float) $request->input('perUserLimit', 0));
        }

        if ($request->has('isPublic')) {
            $patch['is_public'] = $request->boolean('isPublic');
        }

        if ($request->has('isActive')) {
            $patch['is_active'] = $request->boolean('isActive');
        }

        if ($patch !== []) {
            $promo->forceFill($patch)->save();
        }

        $usage = PromoStore::usage([(int) $promo->id]);

        return $this->ok(['promo' => PromoStore::ownerPromo($promo->fresh(), $usage[(int) $promo->id] ?? null)]);
    }

    /** DELETE /api/promos/{id} — remove a code. Redeemed ones are paused instead. */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $promo = Promo::find($id);

        if (! $promo) {
            return $this->fail('Promo code not found 🎟️', 404);
        }

        $ownerId = (int) $request->query('ownerId', 0);

        if ($ownerId <= 0) {
            return $this->fail('Login as the venue owner to delete promos 🔒', 403);
        }

        ['venue' => $venue, 'error' => $error] = PromoStore::venueForOwner((int) $promo->venue_id, $ownerId);

        if ($error) {
            return $this->fail($error, $venue ? 403 : 404);
        }

        $usage = PromoStore::usage([(int) $promo->id]);
        $used = $usage[(int) $promo->id]['used'] ?? 0;

        if ($used > 0) {
            $promo->forceFill(['is_active' => false])->save();

            return $this->fail(
                "\"{$promo->code}\" was used on {$used} booking".($used === 1 ? '' : 's')
                .' — deleting it would erase that history, so it’s paused instead ⏸️',
                409,
                ['ok' => false, 'paused' => true]
            );
        }

        $promo->delete();

        return $this->ok(['ok' => true, 'deletedId' => $promo->id]);
    }
}
