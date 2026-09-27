<?php

namespace App\Support;

/**
 * Promo codes: shape, wording, window and what a code takes off a bill.
 *
 * Ported from `src/lib/promos.ts`. Pure rules only — anything that needs the
 * database (looking a code up, counting redemptions) lives in
 * `App\Support\PromoStore`, mirroring the split the Next.js app used.
 */
class Promos
{
    public const DISCOUNT_TYPES = ['percent', 'flat'];

    public const CODE_MIN = 3;

    public const CODE_MAX = 24;

    public const MAX_PERCENT = 100;

    public const MAX_FLAT = 100000;

    public const MAX_CAP = 100000;

    public const MAX_DAYS_AHEAD = 365;

    /** Booking statuses that still count as a redemption. */
    public const COUNTING_STATUSES = ['pending', 'confirmed', 'completed'];

    /** Codes are stored and compared uppercase without spaces: "save 10" -> "SAVE10". */
    public static function normalizeCode(mixed $raw): string
    {
        $code = strtoupper(trim((string) ($raw ?? '')));
        $code = preg_replace('/\s+/', '', $code) ?? '';
        $code = preg_replace('/[^A-Z0-9-]/', '', $code) ?? '';

        return substr($code, 0, self::CODE_MAX);
    }

    /** Local YYYY-MM-DD — the same shape as `bookings.date`, so no timezone drift. */
    public static function dateISO(mixed $at = null): string
    {
        return ($at ? now()->parse((string) $at) : now())->toDateString();
    }

    public static function isValidDateISO(mixed $raw): bool
    {
        $t = trim((string) ($raw ?? ''));

        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $t)) {
            return false;
        }

        try {
            return now()->parse($t.' 00:00:00')->toDateString() === $t;
        } catch (\Throwable) {
            return false;
        }
    }

    /** Whole calendar days from today until `$iso`. Negative once it has passed. */
    public static function daysUntil(?string $iso, mixed $now = null): int
    {
        if (! self::isValidDateISO($iso)) {
            return 0;
        }

        $reference = $now ? now()->parse((string) $now) : now();

        try {
            $target = now()->parse($iso.' 00:00:00');
        } catch (\Throwable) {
            return 0;
        }

        return (int) round(($target->startOfDay()->getTimestamp() - $reference->startOfDay()->getTimestamp()) / 86400);
    }

    /** "upcoming" (before its start date), "live", or "expired". */
    public static function window(array|object $promo, mixed $now = null): string
    {
        $promo = is_object($promo) ? (array) $promo : $promo;
        $today = self::dateISO($now);
        $expiresAt = (string) ($promo['expiresAt'] ?? $promo['expires_at'] ?? '');
        $startsAt = (string) ($promo['startsAt'] ?? $promo['starts_at'] ?? '');

        if ($expiresAt !== '' && $today > $expiresAt) {
            return 'expired';
        }

        if ($startsAt !== '' && $today < $startsAt) {
            return 'upcoming';
        }

        return 'live';
    }

    /** The owner-facing state: the window, plus "paused" when switched off. */
    public static function state(array|object $promo, mixed $now = null): string
    {
        $promo = is_object($promo) ? (array) $promo : $promo;

        if (($promo['isActive'] ?? $promo['is_active'] ?? true) === false) {
            return 'paused';
        }

        return self::window($promo, $now);
    }

    /**
     * @return array{label: string, emoji: string}
     */
    public static function stateBadge(string $state): array
    {
        return match ($state) {
            'live' => ['label' => 'Live', 'emoji' => '🟢'],
            'upcoming' => ['label' => 'Starts later', 'emoji' => '⏳'],
            'expired' => ['label' => 'Expired', 'emoji' => '⌛'],
            default => ['label' => 'Paused', 'emoji' => '⏸️'],
        };
    }

    /** Redeemable right now? The expiry date counts as the last valid day. */
    public static function isLive(array|object $promo, mixed $now = null): bool
    {
        $promo = is_object($promo) ? (array) $promo : $promo;

        return ($promo['isActive'] ?? $promo['is_active'] ?? true) !== false && self::window($promo, $now) === 'live';
    }

    public static function expiryLabel(array|object $promo, mixed $now = null): string
    {
        $promo = is_object($promo) ? (array) $promo : $promo;
        $left = self::daysUntil((string) ($promo['expiresAt'] ?? $promo['expires_at'] ?? ''), $now);
        $abs = abs($left);

        if ($left < 0) {
            return "Expired {$abs} day".($abs === 1 ? '' : 's').' ago';
        }

        if ($left === 0) {
            return 'Last day today ⚡';
        }

        if ($left === 1) {
            return 'Ends tomorrow';
        }

        if ($left <= 30) {
            return "{$left} days left";
        }

        return 'Until '.self::prettyDate((string) ($promo['expiresAt'] ?? $promo['expires_at'] ?? ''));
    }

    /** "May 4, 2024" */
    public static function prettyDate(?string $iso): string
    {
        if (! self::isValidDateISO($iso)) {
            return (string) $iso;
        }

        try {
            return now()->parse($iso.' 00:00:00')->format('M j, Y');
        } catch (\Throwable) {
            return (string) $iso;
        }
    }

    /** "15% off" / "15% off up to Rs. 500" / "Rs. 300 off". */
    public static function summary(array|object $promo): string
    {
        $promo = is_object($promo) ? (array) $promo : $promo;
        $value = max(0, (int) round((float) ($promo['discountValue'] ?? $promo['discount_value'] ?? 0)));

        if (($promo['discountType'] ?? $promo['discount_type'] ?? 'percent') === 'flat') {
            return Futsal::formatNPR($value).' off';
        }

        $cap = max(0, (int) round((float) ($promo['maxDiscount'] ?? $promo['max_discount'] ?? 0)));

        return $cap > 0 ? "{$value}% off up to ".Futsal::formatNPR($cap) : "{$value}% off";
    }

    /**
     * How much this promo takes off `$subtotal`. Percent respects the optional
     * cap; flat is clamped to the bill. Never negative, never more than the
     * bill: a promo can make a game free but not pay the player.
     *
     * @return array{amount: int, capped: bool, subtotal: int, payable: int}
     */
    public static function discountFor(array|object $promo, int $subtotal): array
    {
        $promo = is_object($promo) ? (array) $promo : $promo;
        $base = max(0, $subtotal);
        $value = max(0, (int) round((float) ($promo['discountValue'] ?? $promo['discount_value'] ?? 0)));
        $raw = 0;
        $capped = false;

        if (($promo['discountType'] ?? $promo['discount_type'] ?? 'percent') === 'flat') {
            $raw = $value;
        } else {
            $raw = (int) round(($base * $value) / 100);
            $cap = max(0, (int) round((float) ($promo['maxDiscount'] ?? $promo['max_discount'] ?? 0)));

            if ($cap > 0 && $raw > $cap) {
                $raw = $cap;
                $capped = true;
            }
        }

        $amount = max(0, min($base, $raw));

        return ['amount' => $amount, 'capped' => $capped, 'subtotal' => $base, 'payable' => $base - $amount];
    }

    /**
     * Everything that decides whether a player may use a code on this bill:
     * switched on, inside its window, minimum spend met, and neither the
     * venue-wide limit nor this player's own limit exhausted.
     *
     * @param  array<string, mixed>|null  $promo
     * @return array<string, mixed>
     */
    public static function check(array $opts): array
    {
        $code = self::normalizeCode($opts['code'] ?? '');
        $fail = fn (string $error, string $reason) => ['ok' => false, 'error' => $error, 'reason' => $reason];

        if ($code === '') {
            return $fail('Type a promo code first 🎟️', 'empty');
        }

        $promo = $opts['promo'] ?? null;

        if (! $promo) {
            $venue = $opts['venueName'] ?? 'this futsal';

            return $fail("\"{$code}\" isn’t a code at {$venue} — check the spelling 🎟️", 'not_found');
        }

        $window = self::window($promo, $opts['now'] ?? null);
        $promoCode = (string) ($promo['code'] ?? $code);

        if (($promo['isActive'] ?? $promo['is_active'] ?? true) === false) {
            return $fail("\"{$promoCode}\" has been paused by the venue 😴 — try another code", 'paused');
        }

        if ($window === 'expired') {
            return $fail("\"{$promoCode}\" expired on ".self::prettyDate((string) ($promo['expiresAt'] ?? $promo['expires_at'] ?? '')).' ⌛ — this one’s gone', 'expired');
        }

        if ($window === 'upcoming') {
            return $fail("\"{$promoCode}\" starts on ".self::prettyDate((string) ($promo['startsAt'] ?? $promo['starts_at'] ?? '')).' ⏳ — come back then!', 'upcoming');
        }

        $subtotal = max(0, (int) round((float) ($opts['subtotal'] ?? 0)));
        $minSpend = max(0, (int) round((float) ($promo['minBookingAmount'] ?? $promo['min_booking_amount'] ?? 0)));

        if ($subtotal <= 0) {
            return $fail('There’s nothing left to discount on this booking 🎁', 'nothing_to_discount');
        }

        if ($minSpend > 0 && $subtotal < $minSpend) {
            return $fail(
                "\"{$promoCode}\" needs a booking of at least ".Futsal::formatNPR($minSpend)
                .' — yours is '.Futsal::formatNPR($subtotal).' 💰',
                'min_spend'
            );
        }

        $used = max(0, (int) ($opts['usedCount'] ?? 0));
        $limit = max(0, (int) ($promo['usageLimit'] ?? $promo['usage_limit'] ?? 0));

        if ($limit > 0 && $used >= $limit) {
            return $fail("\"{$promoCode}\" is fully redeemed ({$used}/{$limit}) 🏁 — quick off the mark next time!", 'limit_reached');
        }

        $userUsed = max(0, (int) ($opts['userUsedCount'] ?? 0));
        $perUser = max(0, (int) ($promo['perUserLimit'] ?? $promo['per_user_limit'] ?? 0));

        if ($perUser > 0 && $userUsed >= $perUser) {
            return $fail(
                $perUser === 1
                    ? "You’ve already used \"{$promoCode}\" on a live booking 🙌 — one per player, sorry!"
                    : "You’ve used \"{$promoCode}\" {$userUsed} times already (limit {$perUser}) 🙌",
                'per_user_limit'
            );
        }

        $discount = self::discountFor($promo, $subtotal);

        if ($discount['amount'] <= 0) {
            return $fail("\"{$promoCode}\" doesn’t take anything off this bill 🙂", 'no_discount');
        }

        return [
            'ok' => true,
            'promo' => $promo,
            'discount' => $discount['amount'],
            'capped' => $discount['capped'],
            'payable' => $discount['payable'],
            'message' => "{$promoCode} applied 🎉 ".self::summary($promo).' — you save '
                .Futsal::formatNPR($discount['amount']).($discount['capped'] ? ' (cap reached)' : '').'. Pay '
                .($discount['payable'] === 0 ? 'nothing' : Futsal::formatNPR($discount['payable'])).'.',
        ];
    }

    /** Short line for notifications and receipts. */
    public static function discountNote(?string $code, int $amount): string
    {
        return '🎟️ '.((string) $code).' −'.Futsal::formatNPR($amount);
    }

    /** A code an owner can one-tap, e.g. "TURF25-4KQ7". */
    public static function suggestCode(string $seedWord = 'PLAY'): string
    {
        $word = substr(str_replace('-', '', self::normalizeCode($seedWord)), 0, 8) ?: 'PLAY';
        $alphabet = 'ACDEFGHJKLMNPQRTUVWXY3479';
        $tail = '';

        for ($i = 0; $i < 4; $i++) {
            $tail .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }

        return substr($word.'-'.$tail, 0, self::CODE_MAX);
    }
}
