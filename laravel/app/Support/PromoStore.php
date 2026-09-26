<?php

namespace App\Support;

use App\Models\Booking;
use App\Models\Promo;
use App\Models\Venue;

/**
 * The database side of promo codes — `src/lib/promo-store.ts`.
 *
 * The rules live in `App\Support\Promos`; anything that has to read rows lives
 * here, mirroring the split the Next.js app used.
 */
class PromoStore
{
    /**
     * Redemptions per promo id.
     *
     * Counted from bookings rather than a counter column, so a cancelled or
     * declined booking automatically gives the code back — there is nothing to
     * keep in sync.
     *
     * @param  list<int>  $promoIds
     * @return array<int, array{used: int, discountGiven: int, byUser: array<int, int>}>
     */
    public static function usage(array $promoIds): array
    {
        $promoIds = array_values(array_filter(array_map('intval', $promoIds), fn ($id) => $id > 0));

        $out = [];

        foreach ($promoIds as $id) {
            $out[$id] = ['used' => 0, 'discountGiven' => 0, 'byUser' => []];
        }

        if ($promoIds === []) {
            return $out;
        }

        $rows = Booking::whereIn('promo_id', $promoIds)
            ->whereIn('status', Promos::COUNTING_STATUSES)
            ->get(['promo_id', 'user_id', 'discount_amount']);

        foreach ($rows as $row) {
            $id = (int) $row->promo_id;

            if (! isset($out[$id])) {
                $out[$id] = ['used' => 0, 'discountGiven' => 0, 'byUser' => []];
            }

            $out[$id]['used']++;
            $out[$id]['discountGiven'] += (int) $row->discount_amount;

            $userId = (int) $row->user_id;
            $out[$id]['byUser'][$userId] = ($out[$id]['byUser'][$userId] ?? 0) + 1;
        }

        return $out;
    }

    /**
     * @param  array{used: int, discountGiven: int, byUser: array<int, int>}|null  $usage
     */
    public static function findByCode(int $venueId, string $code): ?Promo
    {
        return Promo::where('venue_id', $venueId)->where('code', $code)->first();
    }

    /**
     * The slim payload players may see: no limits they could game.
     *
     * @return array<string, mixed>
     */
    public static function publicPromo(Promo $promo): array
    {
        return [
            'id' => $promo->id,
            'code' => $promo->code,
            'title' => $promo->title,
            'discountType' => $promo->discount_type,
            'discountValue' => $promo->discount_value,
            'maxDiscount' => $promo->max_discount,
            'minBookingAmount' => $promo->min_booking_amount,
            'startsAt' => $promo->starts_at,
            'expiresAt' => $promo->expires_at,
            'summary' => Promos::summary($promo->toArray()),
            'expiryLabel' => Promos::expiryLabel($promo->toArray()),
            'expiresOn' => Promos::prettyDate($promo->expires_at),
        ];
    }

    /**
     * The owner's payload: everything, plus live status and usage.
     *
     * @return array<string, mixed>
     */
    public static function ownerPromo(Promo $promo, ?array $usage = null): array
    {
        $used = $usage['used'] ?? 0;
        $state = Promos::state($promo->toArray());
        $badge = Promos::stateBadge($state);
        $limit = max(0, (int) $promo->usage_limit);

        return [
            ...$promo->toArray(),
            'summary' => Promos::summary($promo->toArray()),
            'expiryLabel' => Promos::expiryLabel($promo->toArray()),
            'expiresOn' => Promos::prettyDate($promo->expires_at),
            'startsOn' => $promo->starts_at ? Promos::prettyDate($promo->starts_at) : '',
            'state' => $state,
            'stateLabel' => $badge['label'],
            'stateEmoji' => $badge['emoji'],
            'live' => $state === 'live',
            'usedCount' => $used,
            'remaining' => $limit > 0 ? max(0, $limit - $used) : null,
            'discountGiven' => $usage['discountGiven'] ?? 0,
        ];
    }

    /**
     * Venue + owner check shared by create, update and delete.
     *
     * @return array{venue: Venue|null, error: string|null}
     */
    public static function venueForOwner(int $venueId, int $ownerId): array
    {
        $venue = Venue::find($venueId);

        if (! $venue) {
            return ['venue' => null, 'error' => 'Venue not found 📍'];
        }

        if ($venue->owner_id && $ownerId && (int) $venue->owner_id !== $ownerId) {
            return ['venue' => $venue, 'error' => 'Only the venue owner can manage its promo codes 🔒'];
        }

        return ['venue' => $venue, 'error' => null];
    }

    /** Usable right now, ignoring redemption counts (for list badges). */
    public static function isLive(Promo $promo): bool
    {
        return (bool) $promo->is_active && Promos::window($promo->toArray()) === 'live';
    }
}
