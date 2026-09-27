<?php

namespace App\Support;

use Carbon\CarbonInterface;

/**
 * The formatting and time helpers the Next.js app kept in `src/lib/futsal.ts`.
 *
 * Everything here is pure: no database, no request, nothing that can throw on
 * bad input. That is what lets the API, the notification bodies and the seeders
 * share one definition of "Rs. 1,500" and "has this game been played yet?".
 */
class Futsal
{
    /** The cities a venue can be in, plus the "anywhere" option for filters. */
    public const CITIES = ['Kathmandu', 'Lalitpur', 'Bhaktapur', 'Pokhara', 'Chitwan'];

    public const CITY_OPTIONS = ['All Cities', 'Kathmandu', 'Lalitpur', 'Bhaktapur', 'Pokhara', 'Chitwan'];

    public const VENUE_IMAGES = [
        'https://images.unsplash.com/photo-1574629810360-7efbbe195018?q=80&w=1200&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1553778263-73a83bab9b0c?q=80&w=1200&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?q=80&w=1200&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1522778119026-d647f0596c20?q=80&w=1200&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?q=80&w=1200&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1517466787929-bc90951d0974?q=80&w=1200&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1606925797300-0b35e9d1794e?q=80&w=1200&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1459865264687-595d652de67e?q=80&w=1200&auto=format&fit=crop',
    ];

    /**
     * "Rs. 1,500" — grouped the Nepali way (1,00,000), matching
     * `n.toLocaleString("en-IN")` on the Next.js side.
     */
    public static function formatNPR(mixed $n): string
    {
        $value = (int) round((float) ($n ?? 0));
        $sign = $value < 0 ? '-' : '';
        $digits = (string) abs($value);

        if (strlen($digits) > 3) {
            $last3 = substr($digits, -3);
            $rest = substr($digits, 0, -3);
            $groups = str_split(strrev($rest), 2);
            $digits = strrev(implode(',', $groups)).','.$last3;
        }

        return $sign.'Rs. '.$digits;
    }

    /** Today (or today + n days) as YYYY-MM-DD, in the app's timezone. */
    public static function todayISO(int $offsetDays = 0): string
    {
        return now()->addDays($offsetDays)->toDateString();
    }

    /** "Sat, May 4" */
    public static function prettyDate(?string $iso): string
    {
        if (! $iso) {
            return '';
        }

        try {
            return now()->parse($iso.' 00:00:00')->format('D, M j');
        } catch (\Throwable) {
            return $iso;
        }
    }

    /**
     * @return array{dow: string, day: int, month: string}
     */
    public static function prettyDayShort(?string $iso): array
    {
        if (! $iso) {
            return ['dow' => '', 'day' => 0, 'month' => ''];
        }

        try {
            $d = now()->parse($iso.' 00:00:00');

            return ['dow' => $d->format('D'), 'day' => (int) $d->format('j'), 'month' => $d->format('M')];
        } catch (\Throwable) {
            return ['dow' => '', 'day' => 0, 'month' => ''];
        }
    }

    /**
     * @return list<string>
     */
    public static function nextDays(int $count): array
    {
        $out = [];

        for ($i = 0; $i < $count; $i++) {
            $out[] = self::todayISO($i);
        }

        return $out;
    }

    /** Hourly starts between opening and closing, e.g. ["06:00", "07:00", …]. */
    public static function timeSlots(int $open = 6, int $close = 22): array
    {
        $slots = [];

        for ($h = $open; $h < $close; $h++) {
            $slots[] = str_pad((string) $h, 2, '0', STR_PAD_LEFT).':00';
        }

        return $slots;
    }

    /** "18:00" + 2 hours -> "20:00" (wraps past midnight like the JS version). */
    public static function addHours(string $time, float|int $hours): string
    {
        [$h, $m] = array_map('intval', array_pad(explode(':', $time ?: '00:00'), 2, '0'));
        $total = $h * 60 + $m + (int) round($hours * 60);
        $nh = intdiv($total, 60) % 24;
        $nm = $total % 60;

        return str_pad((string) $nh, 2, '0', STR_PAD_LEFT).':'.str_pad((string) $nm, 2, '0', STR_PAD_LEFT);
    }

    public static function timeToMin(?string $t): int
    {
        [$h, $m] = array_map('intval', array_pad(explode(':', $t ?: '00:00'), 2, '0'));

        return ($h ?: 0) * 60 + ($m ?: 0);
    }

    /** Do two [start, end) ranges overlap? Times as "HH:MM". */
    public static function rangesOverlap(string $aStart, string $aEnd, string $bStart, string $bEnd): bool
    {
        $s1 = self::timeToMin($aStart);
        $s2 = self::timeToMin($bStart);
        $e1 = self::timeToMin($aEnd);
        $e2 = self::timeToMin($bEnd);

        if ($e1 <= $s1) {
            $e1 = $s1 + 60;
        }

        if ($e2 <= $s2) {
            $e2 = $s2 + 60;
        }

        return $s1 < $e2 && $s2 < $e1;
    }

    /** 18:00 + 2h -> ["18:00", "19:00"] — the slots a booking occupies. */
    public static function expandBookingSlots(string $startTime, float|int $durationHours): array
    {
        $out = [];
        $n = max(1, (int) round((float) ($durationHours ?: 1)));

        for ($i = 0; $i < $n; $i++) {
            $out[] = self::addHours($startTime, $i);
        }

        return $out;
    }

    /**
     * The `hours` consecutive slots starting at `$start`, or [] when it would
     * run past closing time.
     *
     * @param  list<string>  $slots
     * @return list<string>
     */
    public static function rangeSlots(array $slots, ?string $start, int $hours): array
    {
        if (! $start) {
            return [];
        }

        $idx = array_search($start, $slots, true);

        if ($idx === false || $idx + $hours > count($slots)) {
            return [];
        }

        return array_slice($slots, $idx, $hours);
    }

    /** "18:00" -> "6:00 PM" */
    public static function formatTime12(?string $t): string
    {
        $parts = explode(':', $t ?: '00:00');
        $h = (int) ($parts[0] ?? 0);
        $m = $parts[1] ?? '00';
        $ampm = $h >= 12 ? 'PM' : 'AM';
        $h = $h % 12;

        if ($h === 0) {
            $h = 12;
        }

        return $h.':'.$m.' '.$ampm;
    }

    public static function initials(?string $name): string
    {
        $words = preg_split('/\s+/', trim((string) $name)) ?: [];
        $letters = '';

        foreach (array_slice($words, 0, 2) as $word) {
            if ($word !== '') {
                $letters .= mb_substr($word, 0, 1);
            }
        }

        return mb_strtoupper($letters);
    }

    /**
     * Has this game already been played?
     *
     * One rule for every "played" gate in the app: completed counts as played,
     * confirmed counts once the end time has passed, and pending/rejected never
     * do however far in the past the date is. Both sides import it so a card
     * cannot disagree with the server.
     *
     * @param  array{status?: string|null, date?: string|null, startTime?: string|null, start_time?: string|null, endTime?: string|null, end_time?: string|null}  $b
     */
    public static function gamePlayed(array|object $b, mixed $now = null): bool
    {
        $row = is_object($b) ? (array) $b : $b;
        $status = (string) ($row['status'] ?? '');

        if ($status === 'completed') {
            return true;
        }

        if ($status !== 'confirmed') {
            return false;
        }

        $date = (string) ($row['date'] ?? '');
        $end = (string) ($row['endTime'] ?? $row['end_time'] ?? $row['startTime'] ?? $row['start_time'] ?? '');

        if (! $date || ! $end) {
            return false;
        }

        try {
            $endAt = now()->parse($date.' '.$end.':00');

            return ($now ?: now())->greaterThan($endAt);
        } catch (\Throwable) {
            return false;
        }
    }

    /** "Rs. 1,500" for a nullable amount, so a blank never prints as "Rs. 0". */
    public static function money(?int $n): string
    {
        return self::formatNPR($n ?? 0);
    }

    /**
     * Turn a Carbon/DateTime into the ISO-8601 UTC string the app's
     * `createdAt: string` fields carry.
     */
    public static function iso(mixed $date): ?string
    {
        if (! $date) {
            return null;
        }

        if ($date instanceof CarbonInterface) {
            return $date->toISOString(true);
        }

        try {
            return now()->parse((string) $date)->toISOString(true);
        } catch (\Throwable) {
            return is_string($date) ? $date : null;
        }
    }
}
