<?php

namespace App\Support;

/**
 * Trust, ratings and fair-play deposits — `src/lib/loyalty.ts`.
 *
 * A player's reliability is a number other players can see, so every rule that
 * moves it lives here rather than in whichever route happened to need it.
 */
class Loyalty
{
    /** Paid games at one venue in a month that earn a free hour. */
    public const LOYALTY_TARGET = 7;

    public const CANCEL_LIMIT_PER_MONTH = 3;

    public const CANCEL_CUTOFF_HOURS = 6;

    public const DEPOSIT_RATING_THRESHOLD = 3.5;

    public const DEPOSIT_CANCEL_THRESHOLD = 2;

    public const DEPOSIT_TRUST_THRESHOLD = 70;

    public const DEPOSIT_MIN_PERCENT = 10;

    public const DEPOSIT_MAX_PERCENT = 100;

    public const TRUST_START = 100;

    /** Showing up and settling up. */
    public const TRUST_COMPLETE_BOOST = 8;

    /**
     * Showing up with money still owing.
     *
     * A game played is worth something — the court was used, the other players
     * got their match — but a venue that is still out of pocket should not look
     * exactly like one that was paid. The remaining five points are handed over
     * by `TRUST_PAID_LATE_BOOST` when the bill is settled, so a player who pays
     * late ends up in the same place as one who paid up front.
     */
    public const TRUST_COMPLETE_OWED_BOOST = 3;

    /** Settling a completed game's bill afterwards — the other half of the 8. */
    public const TRUST_PAID_LATE_BOOST = 5;

    public const TRUST_CANCEL_PENALTY = 15;

    public const PAYMENT_OPTIONS = ['eSewa', 'Khalti', 'Cash at Venue'];

    public const ONLINE_PAYMENTS = ['eSewa', 'Khalti'];

    /**
     * "eSewa,Khalti,Cash at Venue" -> the three methods, dropping anything
     * unknown and falling back to all three when the venue has none set.
     *
     * @return list<string>
     */
    public static function parsePayments(mixed $raw): array
    {
        $list = array_values(array_filter(
            array_map('trim', explode(',', (string) ($raw ?? ''))),
            fn ($s) => $s !== '' && in_array($s, self::PAYMENT_OPTIONS, true)
        ));

        return $list ?: self::PAYMENT_OPTIONS;
    }

    /** "2024-05" — the key a loyalty voucher month is counted under. */
    public static function monthKey(mixed $at = null): string
    {
        $d = $at ? now()->parse((string) $at) : now();

        return $d->format('Y-m');
    }

    /** "2024-05" -> "May 2024" */
    public static function monthLabel(?string $key): string
    {
        if (! $key) {
            return '';
        }

        try {
            [$y, $m] = array_map('intval', explode('-', $key));

            return now()->parse(sprintf('%04d-%02d-01', $y, $m))->format('F Y');
        } catch (\Throwable) {
            return $key;
        }
    }

    /**
     * @return array{label: string, emoji: string}
     */
    public static function trustLabel(int $score): array
    {
        if ($score >= 85) {
            return ['label' => 'Trusted star', 'emoji' => '💎'];
        }

        if ($score >= 70) {
            return ['label' => 'Good standing', 'emoji' => '✅'];
        }

        if ($score >= 50) {
            return ['label' => 'Needs care', 'emoji' => '⚠️'];
        }

        return ['label' => 'Low trust', 'emoji' => '🚨'];
    }

    /**
     * A game was played. `$paidUp` is whether the venue actually has its money:
     * paid-up play earns the full boost, play with a balance owing earns the
     * smaller one until the bill is settled.
     */
    public static function trustAfterComplete(int $score, bool $paidUp = true): int
    {
        $boost = $paidUp ? self::TRUST_COMPLETE_BOOST : self::TRUST_COMPLETE_OWED_BOOST;

        return min(100, max(0, (int) round($score + $boost)));
    }

    /** The bill on an already-played game was settled. */
    public static function trustAfterPaid(int $score): int
    {
        return min(100, max(0, (int) round($score + self::TRUST_PAID_LATE_BOOST)));
    }

    public static function trustAfterCancel(int $score): int
    {
        return min(100, max(0, (int) round($score - self::TRUST_CANCEL_PENALTY)));
    }

    /**
     * The booking columns `playerRating()` reads.
     *
     * Every caller must select exactly these, or a rating is computed from
     * half the story — which is how "payment does not move the number" got in.
     * Named here so the next caller cannot forget.
     *
     * @var list<string>
     */
    public const HISTORY_COLUMNS = ['status', 'created_at', 'payment_status', 'paid_amount', 'settled_at', 'total_price'];

    /**
     * The same question as `bookingSettled()`, for a history row.
     *
     * A caller may have already decided (`paid => true/false`), or may have
     * selected no payment columns at all — in which case the row cannot be
     * judged and is left out of the penalty.
     *
     * @param  array<string, mixed>  $row
     */
    private static function rowSettled(array $row): bool
    {
        if (array_key_exists('paid', $row)) {
            return (bool) $row['paid'];
        }

        $hasPaymentColumns = array_key_exists('payment_status', $row)
            || array_key_exists('paid_amount', $row)
            || array_key_exists('settled_at', $row)
            || array_key_exists('total_price', $row);

        return $hasPaymentColumns ? self::bookingSettled($row) : true;
    }

    /**
     * Has this booking's money landed?
     *
     * Three equivalent signals, because a booking can be settled from three
     * places: the owner marks the ledger settled (`settled_at`), a gateway
     * payment lands (`payment_status` becomes `paid` once what was received
     * covers the price), or the payment desk records cash against it
     * (`paid_amount` + `total_price`). A free game (`total_price` 0) counts as
     * settled: there is nothing to owe.
     *
     * @param  array<string, mixed>  $row  A booking row, or the fields of one.
     */
    public static function bookingSettled(array $row): bool
    {
        if (! empty($row['settled_at'])) {
            return true;
        }

        if ((string) ($row['payment_status'] ?? '') === 'paid') {
            return true;
        }

        $owed = (int) ($row['total_price'] ?? 0);
        $paid = (int) ($row['paid_amount'] ?? 0);

        return $owed <= 0 || $paid >= $owed;
    }

    /**
     * Does this player have to pay a fair-play deposit? Low stars, repeat
     * cancellations this month, or a low trust score.
     *
     * @param  array{rating: float|int, total: int, cancelsThisMonth: int}  $stats
     * @return array{required: bool, percent: int, reason: string}
     */
    public static function depositDecision(array $stats, int $trustScore, int $venuePercent = 30): array
    {
        $percent = min(self::DEPOSIT_MAX_PERCENT, max(self::DEPOSIT_MIN_PERCENT, (int) round($venuePercent ?: 30)));
        $rating = (float) ($stats['rating'] ?? 5);
        $total = (int) ($stats['total'] ?? 0);
        $cancels = (int) ($stats['cancelsThisMonth'] ?? 0);

        if ($total > 0 && $rating < self::DEPOSIT_RATING_THRESHOLD) {
            return [
                'required' => true,
                'percent' => $percent,
                'reason' => "Fair-play shield 🛡️ — your ".number_format($rating, 1)."★ rating is below "
                    .self::DEPOSIT_RATING_THRESHOLD."★, so a {$percent}% upfront deposit keeps the court safe. "
                    .'Finish this game without cancelling and your trust jumps back up! 💪',
            ];
        }

        if ($cancels >= self::DEPOSIT_CANCEL_THRESHOLD) {
            return [
                'required' => true,
                'percent' => $percent,
                'reason' => "Fair-play shield 🛡️ — {$cancels} cancels this month. A {$percent}% non-refundable "
                    .'deposit applies. Show up this time and rebuild trust! 💪',
            ];
        }

        if ($trustScore < self::DEPOSIT_TRUST_THRESHOLD) {
            return [
                'required' => true,
                'percent' => $percent,
                'reason' => "Fair-play shield 🛡️ — trust score {$trustScore}/100 is below "
                    .self::DEPOSIT_TRUST_THRESHOLD.". A {$percent}% upfront deposit applies (non-refundable if you "
                    .'cancel). Complete this game to boost trust! 🌟',
            ];
        }

        return ['required' => false, 'percent' => $percent, 'reason' => ''];
    }

    public static function depositAmountFor(int $totalPrice, int $percent): int
    {
        if ($totalPrice <= 0) {
            return 0;
        }

        return max(1, (int) round(($totalPrice * $percent) / 100));
    }

    /**
     * The reliability card a player (and anyone looking at them) sees.
     *
     * @param  iterable<array{status?: string|null, createdAt?: mixed, created_at?: mixed}>  $bookings
     * @return array<string, mixed>
     */
    public static function playerRating(iterable $bookings, mixed $now = null, ?int $trustScore = null): array
    {
        $rows = [];

        foreach ($bookings as $b) {
            $rows[] = is_object($b) ? (array) $b : $b;
        }

        $count = fn (string $status) => count(array_filter($rows, fn ($b) => (string) ($b['status'] ?? '') === $status));

        $completed = $count('completed');
        $cancelled = $count('cancelled');
        $pending = $count('pending');
        $confirmed = $count('confirmed');
        $total = count($rows);

        /*
         * A completed game is not one thing. Played and paid is the whole
         * point of the app; played with the venue still owed is a real game
         * with a real problem attached, and the rating says so — that is what
         * makes the number move on payment as well as on attendance.
         *
         * `paid` is read off each row when the caller selected the payment
         * columns (every caller does); a row that carries no payment fields at
         * all is treated as settled, so a caller that only wanted statuses does
         * not silently punish everybody.
         */
        $played = array_values(array_filter($rows, fn ($b) => (string) ($b['status'] ?? '') === 'completed'));
        $paidGames = count(array_filter($played, fn ($b) => self::rowSettled($b)));
        $unpaidGames = count($played) - $paidGames;

        $reference = $now ? now()->parse((string) $now) : now();
        $monthStart = $reference->copy()->startOfMonth();

        $cancelsThisMonth = count(array_filter($rows, function ($b) use ($monthStart) {
            if ((string) ($b['status'] ?? '') !== 'cancelled') {
                return false;
            }

            $at = $b['createdAt'] ?? $b['created_at'] ?? null;

            if (! $at) {
                return false;
            }

            try {
                return now()->parse((string) $at)->greaterThanOrEqualTo($monthStart);
            } catch (\Throwable) {
                return false;
            }
        }));

        /*
         * 5 stars, earned per game:
         *
         *   played and paid up   → a whole credit
         *   played, money owing  → half a credit
         *   cancelled            → nothing, and it still counts against you
         *
         * So a squad-mate who always pays sits at 5.0, one who plays but lets
         * the balance ride drifts down until they settle (the history is
         * re-read every time, so paying heals it), and a serial canceller sinks
         * fastest. Paying is worth as much as showing up — both are the deal.
         */
        $credits = $paidGames + $unpaidGames * 0.5;
        $decisive = $completed + $cancelled;
        $rating = 5.0;

        if ($decisive > 0) {
            $rating = round((($credits / $decisive) * 5 + PHP_FLOAT_EPSILON) * 10) / 10;

            if ($completed === 0 && $cancelled > 0) {
                $rating = max(1, round((5 - $cancelled * 0.8) * 10) / 10);
            }
        }

        [$label, $emoji] = match (true) {
            $total === 0 => ['New player', '🌱'],
            // A name for the specific problem, not just a lower number: the
            // profile should say *why* the stars dropped.
            $unpaidGames > 0 && $rating < 4.5 => ['Owes on a played game', '💸'],
            $rating >= 4.5 => ['Super reliable', '🌟'],
            $rating >= 3.5 => ['Reliable', '✅'],
            $rating >= 2.5 => ['Needs care', '⚠️'],
            default => ['At risk', '🚨'],
        };

        $safeTrust = min(100, max(0, (int) round($trustScore ?? self::TRUST_START)));
        $t = self::trustLabel($safeTrust);
        $dep = self::depositDecision(['rating' => $rating, 'total' => $total, 'cancelsThisMonth' => $cancelsThisMonth], $safeTrust, 30);

        return [
            'completed' => $completed,
            'cancelled' => $cancelled,
            'pending' => $pending,
            'confirmed' => $confirmed,
            'total' => $total,
            'paidGames' => $paidGames,
            'unpaidGames' => $unpaidGames,
            'rating' => $rating,
            'label' => $label,
            'emoji' => $emoji,
            'cancelsThisMonth' => $cancelsThisMonth,
            'blocked' => $cancelsThisMonth >= self::CANCEL_LIMIT_PER_MONTH,
            'trustScore' => $safeTrust,
            'trustLabel' => $t['label'],
            'trustEmoji' => $t['emoji'],
            'depositRequired' => $dep['required'],
            'depositReason' => $dep['reason'],
        ];
    }

    /** Hours until kick-off; negative once the game has started. */
    public static function hoursUntilGame(string $dateISO, string $startTime, mixed $now = null): float
    {
        try {
            $game = now()->parse($dateISO.' '.$startTime.':00');
            $reference = $now ? now()->parse((string) $now) : now();

            return ($game->getTimestamp() - $reference->getTimestamp()) / 3600;
        } catch (\Throwable) {
            return 999.0;
        }
    }

    public static function canCancel(string $dateISO, string $startTime, mixed $now = null): bool
    {
        return self::hoursUntilGame($dateISO, $startTime, $now) >= self::CANCEL_CUTOFF_HOURS;
    }

    public static function stars(float|int $rating): string
    {
        $full = max(0, min(5, (int) round($rating)));

        return str_repeat('★', $full).str_repeat('☆', 5 - $full);
    }
}
