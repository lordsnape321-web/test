<?php

namespace App\Support;

use App\Models\Booking;
use App\Models\BookingExtra;
use App\Models\BookingPayment;

/**
 * The money side of a booking — `src/lib/booking-ledger.ts`.
 *
 * A court is paid for in advance, but the real total is not known until the game
 * is over (players buy water, the owner adds an extra ball) and the money rarely
 * arrives in one lump: a Rs 1,700 game might settle as 700 eSewa + 500 Khalti +
 * 500 cash at the desk.
 *
 * So nothing here trusts `bookings.paid_amount`. Every figure is derived from the
 * ledger rows, which is what makes "how much do they still owe, and by which
 * medium did it come in?" answerable from the database rather than from a flag
 * somebody flipped.
 */
class BookingLedger
{
    /** The mediums a venue can accept. Mirrors `venues.accepted_payments`. */
    public const LEDGER_METHODS = ['eSewa', 'Khalti', 'Cash at Venue'];

    /**
     * After the owner marks a booking settled, the ledger stays editable this
     * long so a mistyped amount can be corrected. Then it locks, because a
     * settled book is what the venue reconciles its day against.
     */
    public const SETTLE_EDIT_WINDOW_MS = 5 * 60 * 1000;

    /** A row counts until it is voided inside the correction window. */
    public static function isLive(mixed $row): bool
    {
        $row = is_object($row) ? (array) $row : (array) $row;

        return empty($row['voidedAt']) && empty($row['voided_at']);
    }

    /**
     * @param  iterable<array{amount?: mixed, voidedAt?: mixed, voided_at?: mixed}>  $rows
     */
    public static function sumLive(iterable $rows): int
    {
        $total = 0;

        foreach ($rows as $row) {
            if (self::isLive($row)) {
                $row = is_object($row) ? (array) $row : (array) $row;
                $total += (int) round((float) ($row['amount'] ?? 0));
            }
        }

        return $total;
    }

    /**
     * Re-derive the booking's cached money columns from the live ledger.
     *
     * `bookings.paid_amount` and `bookings.payment_status` are a denormalized
     * copy of the ledger — kept for list screens and search, where opening
     * every ledger is too expensive. That copy is only as honest as its
     * writers, and this method is the only writer it should have, after
     * booking creation:
     *
     *   balance 0            → "paid"
     *   some money in, rest due → "deposit_paid" if it covers the deposit,
     *                              otherwise "pending"
     *   nothing in           → leave whatever was there (creation sets it)
     *
     * Note the comparison is against `owed` (price + live extras), not just
     * `total_price` — a booking that was fully paid and then had an extra
     * charged to it is owing again, and the cache must say so.
     */
    public static function syncCachedState(Booking $booking): void
    {
        $id = (int) $booking->id;

        $totals = self::ledgerTotals(
            $booking->total_price,
            BookingExtra::where('booking_id', $id)->get(),
            BookingPayment::where('booking_id', $id)->get()
        );

        $paid = $totals['paid'];
        $total = max(0, (int) $booking->total_price);

        $next = [
            'paid_amount' => min($total, $paid),
        ];

        if ($totals['balance'] === 0) {
            if ($paid > 0) {
                $next['payment_status'] = 'paid';
            }
        } elseif ((bool) $booking->deposit_required && $paid >= (int) $booking->deposit_amount) {
            $next['payment_status'] = 'deposit_paid';
        } else {
            $next['payment_status'] = 'pending';
        }

        if ((bool) $booking->deposit_required) {
            $next['deposit_status'] = $paid >= (int) $booking->deposit_amount ? 'paid' : 'pending';
        }

        $booking->forceFill($next)->save();
    }

    /**
     * The whole picture for one booking.
     *
     * `balance` and `surplus` are two halves of the same difference — a booking
     * is never both owing and over — so one call can drive "Rs 400 to collect"
     * or "Rs 400 change due".
     *
     * @param  iterable<mixed>  $extras
     * @param  iterable<mixed>  $payments
     * @return array{courtPrice: int, extrasTotal: int, owed: int, paid: int, balance: int, surplus: int, byMethod: array<string, int>, settled: bool}
     */
    public static function ledgerTotals(mixed $courtPrice, iterable $extras, iterable $payments, bool $settled = false): array
    {
        $court = max(0, (int) round((float) ($courtPrice ?? 0)));
        $extrasTotal = self::sumLive($extras);
        $paid = self::sumLive($payments);
        $owed = $court + $extrasTotal;
        $diff = $paid - $owed;

        $byMethod = [];

        foreach ($payments as $p) {
            if (! self::isLive($p)) {
                continue;
            }

            $p = is_object($p) ? (array) $p : (array) $p;
            $key = (string) ($p['method'] ?? '') ?: 'Unspecified';
            $byMethod[$key] = ($byMethod[$key] ?? 0) + (int) round((float) ($p['amount'] ?? 0));
        }

        return [
            'courtPrice' => $court,
            'extrasTotal' => $extrasTotal,
            'owed' => $owed,
            'paid' => $paid,
            'balance' => $diff < 0 ? -$diff : 0,
            'surplus' => $diff > 0 ? $diff : 0,
            'byMethod' => $byMethod,
            'settled' => $settled,
        ];
    }

    /**
     * Is the ledger still open for correction? An unsettled booking always is:
     * the window only starts when the owner marks it settled, which is the
     * moment a typo becomes expensive.
     *
     * @return array{settled: bool, editable: bool, msLeft: int, locksAt: int|null}
     */
    public static function settleWindow(mixed $settledAt, mixed $now = null): array
    {
        if (! $settledAt) {
            return ['settled' => false, 'editable' => true, 'msLeft' => 0, 'locksAt' => null];
        }

        try {
            $at = now()->parse((string) $settledAt)->getTimestampMs();
        } catch (\Throwable) {
            return ['settled' => false, 'editable' => true, 'msLeft' => 0, 'locksAt' => null];
        }

        $reference = $now ? (int) $now : now()->getTimestampMs();
        $msLeft = max(0, $at + self::SETTLE_EDIT_WINDOW_MS - $reference);

        return [
            'settled' => true,
            'editable' => $msLeft > 0,
            'msLeft' => $msLeft,
            'locksAt' => $at + self::SETTLE_EDIT_WINDOW_MS,
        ];
    }

    /** "4:32" — what the owner watches while the correction window ticks down. */
    public static function formatWindowLeft(int $ms): string
    {
        $total = max(0, (int) ceil($ms / 1000));

        return intdiv($total, 60).':'.str_pad((string) ($total % 60), 2, '0', STR_PAD_LEFT);
    }

    /**
     * Extra charges are the easy place to fat-finger a number, so the amount is
     * bounded like a court price and the description cannot be blank — an
     * unnamed Rs 3,000 on somebody's bill is worse than no charge at all.
     */
    public static function validateExtraLine(mixed $label, mixed $amount, int $max = 100000): ?string
    {
        $text = trim((string) ($label ?? ''));

        if ($text === '') {
            return 'Say what the extra charge is for 🧾';
        }

        if (mb_strlen($text) > 120) {
            return 'That description is too long (max 120 characters) 🧾';
        }

        if ($amount === '' || $amount === null || $amount === false) {
            return 'The extra charge needs an amount 🧾';
        }

        $v = (float) $amount;

        if (! is_numeric($amount) || ! is_finite($v) || floor($v) != $v) {
            return 'The extra charge must be a whole number (no decimals) 🧾';
        }

        if ($v <= 0) {
            return 'The extra charge must be more than zero 🧾';
        }

        if ($v > $max) {
            return 'The extra charge is too high (max '.Futsal::formatNPR($max).') 🧾';
        }

        return null;
    }

    /**
     * An instalment must be a positive whole number in a medium the venue
     * actually takes. Overpaying is allowed — handled by `surplus`, because a
     * player handing over Rs 2,000 for a Rs 1,700 game is normal at a desk, not
     * an error to reject.
     *
     * @param  list<string>|null  $allowed
     */
    public static function validateInstalment(mixed $amount, mixed $method, ?array $allowed = null, int $max = 100000): ?string
    {
        $allowed ??= self::LEDGER_METHODS;

        if ($amount === '' || $amount === null || $amount === false) {
            return 'Enter how much was paid 💰';
        }

        if (! is_numeric($amount)) {
            return 'That amount isn’t a number 💰';
        }

        $v = (float) $amount;

        if (! is_finite($v) || floor($v) != $v) {
            return 'That amount must be a whole number (no decimals) 💰';
        }

        if ($v <= 0) {
            return 'That amount must be more than zero 💰';
        }

        if ($v > $max) {
            return 'That amount is too high (max '.Futsal::formatNPR($max).') 💰';
        }

        $m = trim((string) ($method ?? ''));

        if (! in_array($m, $allowed, true)) {
            return "This venue doesn’t take \"".($m ?: 'nothing').'" — pick '.implode(' or ', $allowed).' 💰';
        }

        return null;
    }
}
