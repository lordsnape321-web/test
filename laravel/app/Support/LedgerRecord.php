<?php

namespace App\Support;

use App\Models\BookingPayment;

/**
 * Writes an online payment into the booking ledger.
 *
 * The gateway handlers already set `booking.paid_amount` and `payment_status`,
 * but that says nothing about *which medium* the money came by — and the
 * payment desk derives everything from the ledger, not from those columns.
 * Without this, a booking paid in full by eSewa shows up on the desk as
 * "nothing received", which is exactly the confusion the ledger exists to
 * prevent.
 *
 * Idempotent on the gateway's transaction id: a replayed verify callback (they
 * do get replayed) must not conjure a second instalment out of one payment.
 */
class LedgerRecord
{
    /**
     * @return array{recorded: bool, duplicate: bool}
     */
    public static function recordGatewayPayment(array $input): array
    {
        $bookingId = (int) ($input['bookingId'] ?? 0);
        $amount = max(0, (int) round((float) ($input['amount'] ?? 0)));
        $reference = mb_substr((string) ($input['reference'] ?? ''), 0, 100);

        if (! $bookingId || $amount <= 0 || $reference === '') {
            return ['recorded' => false, 'duplicate' => false];
        }

        $exists = BookingPayment::where('booking_id', $bookingId)->where('reference', $reference)->exists();

        if ($exists) {
            return ['recorded' => false, 'duplicate' => true];
        }

        BookingPayment::create([
            'booking_id' => $bookingId,
            'amount' => $amount,
            'method' => (string) ($input['method'] ?? ''),
            'note' => mb_substr((string) ($input['note'] ?? ''), 0, 200),
            'source' => 'gateway',
            'reference' => $reference,
            'recorded_by' => (int) ($input['userId'] ?? 0),
        ]);

        return ['recorded' => true, 'duplicate' => false];
    }
}
