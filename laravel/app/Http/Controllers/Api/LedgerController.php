<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\BookingExtra;
use App\Models\BookingPayment;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\AdvancePayment;
use App\Support\BookingLedger;
use App\Support\Futsal;
use App\Support\Loyalty;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The venue owner's side of a booking's money.
 *
 * Everything here is owner-only: a player pays through the gateway or hands cash
 * over at the desk, and the owner is the one who writes it down. Each action is
 * its own row in the ledger rather than an overwrite of `paid_amount`, so the
 * split across eSewa / Khalti / cash is recoverable later, and corrections are
 * voids rather than deletions.
 *
 * Once settled, the ledger stays open for the correction window so a mistyped
 * amount can be fixed; then every mutation below is refused with 409.
 */
class LedgerController extends ApiController
{
    private const ACTIONS = ['addPayment', 'voidPayment', 'addExtra', 'voidExtra', 'settle', 'unsettle'];

    /** GET /api/bookings/{id}/ledger — everything the payments panel needs. */
    public function show(int $id): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $booking = Booking::find($id);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        return $this->ok($this->payload($booking));
    }

    /** POST /api/bookings/{id}/ledger — one of six owner actions. */
    public function store(Request $request, int $id): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $action = (string) $request->input('action', '');

        if (! in_array($action, self::ACTIONS, true)) {
            return $this->fail('Unknown ledger action — pick '.implode(', ', self::ACTIONS).' 📋', 400);
        }

        $booking = Booking::find($id);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        $venue = $this->venueOf($booking);
        $actorId = (int) $request->input('actorId', 0);

        if (! $venue?->owner_id || $actorId !== (int) $venue->owner_id) {
            return $this->fail('Only the venue owner can change what a booking owes 🔒', 403);
        }

        // The correction window: unsettled bookings are always editable, a
        // settled one for five minutes, and then it is the venue's record.
        $win = BookingLedger::settleWindow($booking->settled_at);
        $locked = $win['settled'] && ! $win['editable'];

        if ($locked && $action !== 'unsettle') {
            return $this->fail(
                'This booking was settled more than '.(BookingLedger::SETTLE_EDIT_WINDOW_MS / 60000)
                .' minutes ago — the ledger is locked so the day’s takings stay trustworthy 🔒',
                409,
                ['reason' => 'ledger_locked', 'settledAt' => $booking->settled_at]
            );
        }

        $accepted = array_values(array_filter(
            Loyalty::parsePayments($venue->accepted_payments ?? null),
            fn ($m) => in_array($m, BookingLedger::LEDGER_METHODS, true)
        ));

        // A cancelled or rejected event is history, not an open till: keep the
        // ledger readable for reconciliation, but never allow new money or
        // extras against a slot that no longer exists.
        if (in_array($booking->status, ['cancelled', 'rejected'], true)
            && in_array($action, ['addPayment', 'addExtra', 'settle'], true)) {
            return $this->fail('This booking is cancelled, so no further collection is allowed.', 409);
        }

        return match ($action) {
            'addPayment' => $this->addPayment($booking, $request, $accepted, $actorId),
            'voidPayment' => $this->voidPayment($booking, $request, $actorId),
            'addExtra' => $this->addExtra($booking, $request, $actorId),
            'voidExtra' => $this->voidExtra($booking, $request, $actorId),
            'settle' => $this->settle($booking, $actorId),
            'unsettle' => $this->unsettle($booking, $win),
            default => $this->fail('Unhandled action 📋', 400),
        };
    }

    /* ------------------------------------------------------------- actions */

    private function addPayment(Booking $booking, Request $request, array $accepted, int $actorId): JsonResponse
    {
        if ((bool) $booking->advance_payment_required && $booking->advance_payment_status !== 'paid') {
            return $this->fail('Verify the requested eSewa or Khalti advance before recording any venue payment 💳', 409);
        }

        $error = BookingLedger::validateInstalment($request->input('amount'), $request->input('method'), $accepted);

        if ($error) {
            return $this->fail($error, 400);
        }

        BookingPayment::create([
            'booking_id' => $booking->id,
            'amount' => (int) $request->input('amount'),
            'method' => (string) $request->input('method'),
            'note' => mb_substr((string) $request->input('note', ''), 0, 200),
            'source' => 'owner',
            'recorded_by' => $actorId,
        ]);

        $next = $this->payload($booking);
        $stillOwed = $next['totals']['balance'];
        $recorded = Futsal::formatNPR($request->input('amount'));

        $message = $stillOwed > 0
            ? "Recorded {$recorded} by ".$request->input('method').' — '.Futsal::formatNPR($stillOwed).' left to collect 💰'
            : ($next['totals']['surplus'] > 0
                ? "Recorded {$recorded} by ".$request->input('method').' — that’s '.Futsal::formatNPR($next['totals']['surplus'])
                    .' more than owed, so there’s change to hand back 💰'
                : "Recorded {$recorded} by ".$request->input('method').' — this booking is fully paid ✅');

        return $this->ok(['ok' => true, 'ledger' => $next, 'message' => $message]);
    }

    private function voidPayment(Booking $booking, Request $request, int $actorId): JsonResponse
    {
        $paymentId = (int) $request->input('paymentId', 0);

        if ($paymentId <= 0) {
            return $this->fail('Which payment should be undone? 💰', 400);
        }

        $row = BookingPayment::find($paymentId);

        if (! $row || (int) $row->booking_id !== (int) $booking->id) {
            return $this->fail('That payment isn’t on this booking 💰', 404);
        }

        if ($row->voided_at) {
            return $this->ok(['ok' => true, 'alreadyVoided' => true, 'ledger' => $this->payload($booking)]);
        }

        // Voided, not deleted — the row stays so the audit trail is complete.
        $row->forceFill(['voided_at' => now(), 'voided_by' => $actorId])->save();

        return $this->ok([
            'ok' => true,
            'ledger' => $this->payload($booking),
            'message' => 'Undid that '.Futsal::formatNPR($row->amount)." {$row->method} entry — the row stays in the history, struck through 🔁",
        ]);
    }

    private function addExtra(Booking $booking, Request $request, int $actorId): JsonResponse
    {
        $error = BookingLedger::validateExtraLine($request->input('label'), $request->input('amount'));

        if ($error) {
            return $this->fail($error, 400);
        }

        BookingExtra::create([
            'booking_id' => $booking->id,
            'label' => trim((string) $request->input('label')),
            'amount' => (int) $request->input('amount'),
            'recorded_by' => $actorId,
        ]);

        $next = $this->payload($booking);

        return $this->ok([
            'ok' => true,
            'ledger' => $next,
            'message' => 'Added "'.trim((string) $request->input('label')).'" for '.Futsal::formatNPR($request->input('amount'))
                .' — the booking now comes to '.Futsal::formatNPR($next['totals']['owed']).' 🧾',
        ]);
    }

    private function voidExtra(Booking $booking, Request $request, int $actorId): JsonResponse
    {
        $extraId = (int) $request->input('extraId', 0);

        if ($extraId <= 0) {
            return $this->fail('Which extra charge should be removed? 🧾', 400);
        }

        $row = BookingExtra::find($extraId);

        if (! $row || (int) $row->booking_id !== (int) $booking->id) {
            return $this->fail('That extra charge isn’t on this booking 🧾', 404);
        }

        if ($row->voided_at) {
            return $this->ok(['ok' => true, 'alreadyVoided' => true, 'ledger' => $this->payload($booking)]);
        }

        $row->forceFill(['voided_at' => now(), 'voided_by' => $actorId])->save();

        return $this->ok([
            'ok' => true,
            'ledger' => $this->payload($booking),
            'message' => 'Removed "'.$row->label.'" — the line stays in the history, struck through 🔁',
        ]);
    }

    private function settle(Booking $booking, int $actorId): JsonResponse
    {
        if ((bool) $booking->advance_payment_required && $booking->advance_payment_status !== 'paid') {
            return $this->fail('This booking cannot be settled until the requested advance is verified 💳', 409);
        }

        $before = $this->payload($booking);

        if ($booking->settled_at) {
            return $this->ok(['ok' => true, 'alreadySettled' => true, 'ledger' => $before]);
        }

        if ($before['totals']['paid'] <= 0) {
            return $this->fail('Nothing has been recorded as paid yet — add the instalments first 💰', 400);
        }

        $booking->forceFill([
            'settled_at' => now(),
            'settled_by' => $actorId,
            'paid_amount' => $before['totals']['paid'],
            'payment_status' => 'paid',
        ])->save();

        Notifier::notify(
            (int) $booking->user_id,
            'payment',
            'Payment settled ✅',
            Futsal::formatNPR($before['totals']['paid']).' received for your game'
            .($before['totals']['surplus'] > 0 ? ' — '.Futsal::formatNPR($before['totals']['surplus']).' change is due back to you' : '').'.',
            '/bookings'
        );

        // Re-read rather than reusing `$booking`: it still carries the
        // pre-settlement payment status, and echoing that would make the panel
        // show "pending" over a booking the database has just marked paid.
        $next = $this->payload($booking->fresh());

        return $this->ok([
            'ok' => true,
            'ledger' => $next,
            'editWindowMs' => BookingLedger::SETTLE_EDIT_WINDOW_MS,
            'message' => 'Marked settled — '.Futsal::formatNPR($before['totals']['paid']).' across '
                .implode(', ', array_keys($before['totals']['byMethod'])).'. You have '
                .(BookingLedger::SETTLE_EDIT_WINDOW_MS / 60000).' minutes to fix a mistake before it locks 🔒',
        ]);
    }

    /** Reopening is only ever for the correction window. */
    private function unsettle(Booking $booking, array $win): JsonResponse
    {
        if (! $booking->settled_at) {
            return $this->ok(['ok' => true, 'ledger' => $this->payload($booking)]);
        }

        if (! $win['editable']) {
            return $this->fail(
                'The correction window closed '.(BookingLedger::SETTLE_EDIT_WINDOW_MS / 60000)
                .' minutes after settling — this booking’s ledger is final 🔒',
                409,
                ['reason' => 'ledger_locked']
            );
        }

        $booking->forceFill(['settled_at' => null, 'settled_by' => null])->save();

        return $this->ok([
            'ok' => true,
            'ledger' => $this->payload($booking->fresh()),
            'message' => 'Settlement undone — the ledger is open again while you sort it out 🔁',
        ]);
    }

    /* ------------------------------------------------------------- helpers */

    /** Court → venue, so ownership and the accepted mediums can be resolved. */
    private function venueOf(Booking $booking): ?Venue
    {
        $court = Court::find((int) $booking->court_id);

        return $court ? Venue::find((int) $court->venue_id) : null;
    }

    /**
     * The whole ledger in one shape.
     *
     * @return array<string, mixed>
     */
    private function payload(Booking $booking): array
    {
        $id = (int) $booking->id;

        $payments = BookingPayment::where('booking_id', $id)->orderBy('id')->get();
        $extras = BookingExtra::where('booking_id', $id)->orderBy('id')->get();
        $teamPayments = BookingTeamPayment::where('booking_id', $id)->orderBy('id')->get();

        $venue = $this->venueOf($booking);

        $totals = BookingLedger::ledgerTotals(
            $booking->total_price,
            $extras,
            $payments,
            (bool) $booking->settled_at
        );

        $acceptedMethods = array_values(array_filter(
            Loyalty::parsePayments($venue->accepted_payments ?? null),
            fn ($m) => in_array($m, BookingLedger::LEDGER_METHODS, true)
        ));

        return [
            'bookingId' => $id,
            'status' => $booking->status,
            'paymentStatus' => $booking->payment_status,
            'courtPrice' => (int) $booking->total_price,
            'totals' => $totals,
            'window' => BookingLedger::settleWindow($booking->settled_at),
            'editWindowMs' => BookingLedger::SETTLE_EDIT_WINDOW_MS,
            'settledAt' => $booking->settled_at,
            'settledBy' => $booking->settled_by,
            'acceptedMethods' => $acceptedMethods,
            'defaultExtraFee' => (int) ($venue->default_extra_fee ?? 0),
            'defaultExtraFeeNote' => (string) ($venue->default_extra_fee_note ?? ''),
            'extras' => $extras->map(fn (BookingExtra $e) => [
                'id' => $e->id,
                'label' => $e->label,
                'amount' => (int) $e->amount,
                'recordedBy' => $e->recorded_by,
                'voidedAt' => $e->voided_at,
                'createdAt' => $e->created_at,
            ])->all(),
            'payments' => $payments->map(fn (BookingPayment $p) => [
                'id' => $p->id,
                'amount' => (int) $p->amount,
                'method' => $p->method,
                'note' => $p->note,
                'source' => $p->source,
                // The gateway's transaction id, so an online instalment can be
                // tied back to eSewa/Khalti when the day is reconciled.
                'reference' => $p->reference,
                'recordedBy' => $p->recorded_by,
                'voidedAt' => $p->voided_at,
                'createdAt' => $p->created_at,
            ])->all(),
            'teamPayments' => $teamPayments->map(fn (BookingTeamPayment $p) => [
                'id' => $p->id,
                'teamId' => $p->team_id,
                'userId' => $p->user_id,
                'amountDue' => (int) $p->amount_due,
                'paymentMethod' => $p->payment_method,
                'paymentStatus' => $p->payment_status,
                'paidAmount' => (int) $p->paid_amount,
                'gatewayTxnId' => $p->gateway_txn_id,
            ])->all(),
        ];
    }
}
