<?php

namespace App\Support;

use App\Models\Booking;
use App\Models\BookingPaymentRequest;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\Venue;
use App\Services\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * Owner-requested advance payments — `src/lib/advance-payment.ts`.
 *
 * A venue owner can ask for an advance before confirming a booking. The player
 * gets 30 minutes to pay it; after that the booking is cancelled automatically
 * and the slot is released, because there is no scheduler in this app — the
 * request that would read the booking expires it first.
 */
class AdvancePayment
{
    public const WINDOW_MS = 30 * 60 * 1000;

    public static function deadline(mixed $requestedAt): ?\Carbon\CarbonInterface
    {
        if (! $requestedAt) {
            return null;
        }

        try {
            return now()->parse((string) $requestedAt)->addMilliseconds(self::WINDOW_MS);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Reflect a directed teammate payment on that player's equal-share row.
     *
     * The directed request stays the source of truth for the amount asked for;
     * this projection keeps the captain's team ledger honest without letting a
     * payment bigger than the share inflate it.
     */
    public static function recordDirectedTeamSharePayment(int $bookingId, int $payerId, int $amount, string $reference): ?BookingTeamPayment
    {
        $share = BookingTeamPayment::where('booking_id', $bookingId)->where('user_id', $payerId)->first();

        if (! $share) {
            return null;
        }

        $due = max(0, (int) $share->amount_due);
        $paid = min($due, max(0, (int) $share->paid_amount) + max(0, $amount));

        $share->forceFill([
            'paid_amount' => $paid,
            'payment_status' => $paid >= $due ? 'paid' : 'pending',
            'gateway_txn_id' => mb_substr($reference, 0, 100),
        ])->save();

        return $share->fresh();
    }

    /**
     * Cancel every pending booking whose advance window has closed.
     *
     * The conditional update makes it safe when two devices arrive at the
     * 30-minute boundary together: whoever loses the race simply sees no row
     * to update.
     */
    public static function expireOverdueAdvanceRequests(): int
    {
        $rows = Booking::where('status', 'pending')
            ->where('advance_payment_required', true)
            ->where('advance_payment_status', 'pending')
            ->get();

        $expired = 0;
        $reference = now();

        foreach ($rows as $booking) {
            $deadline = self::deadline($booking->advance_payment_requested_at);

            if (! $deadline || $deadline->greaterThan($reference)) {
                continue;
            }

            $updated = Booking::where('id', $booking->id)
                ->where('status', 'pending')
                ->where('advance_payment_status', 'pending')
                ->update([
                    'status' => 'cancelled',
                    'advance_payment_status' => 'expired',
                ]);

            if ($updated === 0) {
                continue;
            }

            BookingPaymentRequest::where('booking_id', $booking->id)
                ->where('purpose', 'advance')
                ->where('status', 'pending')
                ->update(['status' => 'expired']);

            $expired++;

            try {
                $court = Court::find($booking->court_id);
                $venue = $court ? Venue::find($court->venue_id) : null;
                $when = Futsal::prettyDate($booking->date).' at '.Futsal::formatTime12($booking->start_time);
                $amount = Futsal::formatNPR($booking->advance_payment_amount);

                Notifier::notify(
                    (int) $booking->user_id,
                    'booking_cancelled',
                    '⌛ Booking cancelled — advance not received',
                    ($venue->name ?? 'The venue')." did not receive the requested {$amount} advance within 30 minutes for {$when}, so booking #FN-{$booking->id} was cancelled automatically.",
                    '/bookings'
                );

                if ($venue?->owner_id) {
                    Notifier::notify(
                        (int) $venue->owner_id,
                        'booking_cancelled',
                        "⌛ Advance window expired — booking #FN-{$booking->id}",
                        "The player did not pay the {$amount} advance within 30 minutes, so the pending request was cancelled and the slot is free again.",
                        '/admin/requests'
                    );
                }
            } catch (\Throwable $e) {
                // The cancellation is already durable; notification delivery is
                // best-effort and the next feed still shows the cancelled status.
                report($e);
            }
        }

        return $expired;
    }

    /** Shared read used by the booking feed and the payment desk. */
    public static function pendingQuery()
    {
        return Booking::query()
            ->where('status', 'pending')
            ->where('advance_payment_required', true)
            ->where('advance_payment_status', 'pending');
    }

    /** Wrapper kept for callers that want the count in a transaction. */
    public static function expireInTransaction(): int
    {
        return DB::transaction(fn () => self::expireOverdueAdvanceRequests());
    }
}
