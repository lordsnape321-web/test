<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\BookingPaymentRequest;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\AdvancePayment;
use App\Support\Futsal;
use App\Support\LedgerRecord;
use App\Support\Payments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * eSewa test gateway — `POST /api/payments/esewa/{initiate,verify}`.
 *
 * Three different kinds of money can travel through this one gateway, and the
 * response has to say which it was so the right row gets updated:
 *
 * - the booking's own balance (advance, deposit, or remainder),
 * - one member's equal share of a team booking,
 * - a directed request from the captain to one teammate.
 */
class EsewaController extends ApiController
{
    /** Build the signed form the app posts to eSewa. */
    public function initiate(Request $request): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $bookingId = (int) $request->input('bookingId', 0);

        if ($bookingId <= 0) {
            return $this->fail('Invalid booking 📋', 400);
        }

        $booking = Booking::find($bookingId);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        if (in_array($booking->status, ['cancelled', 'rejected'], true)) {
            return $this->fail('This booking is no longer active', 409);
        }

        if ($booking->visibility === 'competition' && $booking->competition_status === 'pending') {
            return $this->fail('Payment opens after the opposition captain accepts this competition request 🆚', 409);
        }

        $teamPaymentId = (int) $request->input('teamPaymentId', 0) ?: null;
        $paymentRequestId = (int) $request->input('paymentRequestId', 0) ?: null;
        $requestedUserId = (int) $request->input('userId', 0) ?: null;

        $paymentRequest = $paymentRequestId
            ? BookingPaymentRequest::where('id', $paymentRequestId)->where('booking_id', $booking->id)->first()
            : null;

        if ($paymentRequestId && (! $paymentRequest || $requestedUserId !== (int) $paymentRequest->payer_id)) {
            return $this->fail('That payment request does not belong to this booking or player 🔒', 403);
        }

        if ($paymentRequest && $paymentRequest->status !== 'pending') {
            return $this->fail('That teammate payment request is no longer pending', 409);
        }

        if ($paymentRequest && $paymentRequest->payment_method !== 'eSewa') {
            return $this->fail('Choose eSewa for this payment request first 💳', 400);
        }

        if ($teamPaymentId && $paymentRequestId) {
            return $this->fail('Choose one payment target at a time', 400);
        }

        $teamPayment = $teamPaymentId
            ? BookingTeamPayment::where('id', $teamPaymentId)->where('booking_id', $booking->id)->first()
            : null;

        if ($teamPaymentId && (! $teamPayment || ($requestedUserId && (int) $teamPayment->user_id !== $requestedUserId))) {
            return $this->fail('That team payment does not belong to this booking or player 🔒', 403);
        }

        if ($teamPayment && $teamPayment->payment_method !== 'eSewa') {
            return $this->fail('Choose eSewa for this team share first 💳', 400);
        }

        if (! $teamPayment && ! $paymentRequest && $booking->payment_method !== 'eSewa') {
            return $this->fail('This booking is not an eSewa payment 💳', 400);
        }

        if (Futsal::gamePlayed($booking->getAttributes())) {
            return $this->fail('That game is already played 🔒 — the booking is locked, so payment can’t be started for it now.', 409);
        }

        if ($teamPayment && $teamPayment->payment_status === 'paid') {
            return $this->fail('This team share is already paid ✅', 400, ['teamPayment' => $teamPayment->toArray()]);
        }

        $payingAdvance = ! $teamPayment && ! $paymentRequest
            && (bool) $booking->advance_payment_required && $booking->advance_payment_status !== 'paid';
        $payingDeposit = ! $teamPayment && ! $paymentRequest && ! $payingAdvance
            && (bool) $booking->deposit_required && $booking->deposit_status !== 'paid';

        if (! $teamPayment && ! $paymentRequest && $booking->payment_status === 'paid') {
            return $this->fail('Already paid ✅', 400, ['booking' => $booking->toArray()]);
        }

        $amount = match (true) {
            (bool) $paymentRequest => (int) ($paymentRequest->amount_due ?? 0),
            (bool) $teamPayment => (int) ($teamPayment->amount_due ?? 0),
            $payingAdvance => (int) ($booking->advance_payment_amount ?? 0),
            $payingDeposit => (int) ($booking->deposit_amount ?? 0),
            default => max(0, (int) $booking->total_price - (int) $booking->paid_amount),
        };

        if (! is_finite($amount) || $amount < 10) {
            return $this->fail('Amount too small for eSewa test (min Rs. 10) 💰', 400);
        }

        $court = Court::find((int) $booking->court_id);
        $venue = $court ? Venue::find((int) $court->venue_id) : null;
        $venueName = $venue->name ?? 'Futsal';

        $cfg = Payments::esewaConfig();
        $origin = Payments::appOrigin($request);

        $transactionUuid = Payments::makeEsewaUuid((int) $booking->id)
            .($teamPayment ? "-TP-{$teamPayment->id}" : ($paymentRequest ? "-PR-{$paymentRequest->id}" : ''));

        if ($teamPayment) {
            $teamPayment->forceFill(['esewa_uuid' => $transactionUuid, 'gateway_txn_id' => ''])->save();
        } elseif ($paymentRequest) {
            $paymentRequest->forceFill(['esewa_uuid' => $transactionUuid, 'gateway_txn_id' => ''])->save();
        } else {
            $booking->forceFill(['esewa_uuid' => $transactionUuid, 'gateway_txn_id' => ''])->save();
        }

        $requestQuery = $paymentRequest ? "&paymentRequestId={$paymentRequest->id}&userId={$paymentRequest->payer_id}" : '';
        $target = $teamPayment ? "&teamPaymentId={$teamPayment->id}" : "";

        $successUrl = "{$origin}/payment/esewa/success?bookingId={$booking->id}{$target}{$requestQuery}";
        $failureUrl = "{$origin}/payment/esewa/failure?bookingId={$booking->id}{$target}{$requestQuery}";

        $fields = Payments::buildEsewaFields([
            'amount' => $amount,
            'transactionUuid' => $transactionUuid,
            'productCode' => $cfg['productCode'],
            'secretKey' => $cfg['secretKey'],
            'successUrl' => $successUrl,
            'failureUrl' => $failureUrl,
        ]);

        $mockTarget = $teamPayment
            ? "&teamPaymentId={$teamPayment->id}&userId={$teamPayment->user_id}"
            : ($paymentRequest ? "&paymentRequestId={$paymentRequest->id}&userId={$paymentRequest->payer_id}" : '');

        return $this->ok([
            'url' => $cfg['formUrl'],
            'fields' => $fields,
            'amount' => $amount,
            'bookingId' => $booking->id,
            'teamPaymentId' => $teamPayment->id ?? null,
            'paymentRequestId' => $paymentRequest->id ?? null,
            'transactionUuid' => $transactionUuid,
            'venueName' => $venueName,
            'isDeposit' => ! $teamPayment && ! $paymentRequest && (bool) $booking->deposit_required,
            'isAdvance' => ($paymentRequest?->purpose === 'advance') || (! $teamPayment && (bool) $booking->advance_payment_required),
            'testMode' => true,
            'mockUrl' => "{$origin}/payment/esewa/mock?bookingId={$booking->id}&amount={$amount}&uuid=".rawurlencode($transactionUuid).$mockTarget,
            'testHint' => 'eSewa UAT: use ID 9806800001 / password 123456 / MPIN 1122 / token 123456',
        ]);
    }

    /**
     * Verify the callback eSewa posted back.
     *
     * `mockApprove` is the simulator fallback: it lets a player finish the flow
     * when the real eSewa test site is unreachable. Its transaction id is
     * deterministic on purpose, because that id is the ledger's idempotency key
     * and a replayed verify must not turn one payment into two instalments.
     */
    public function verify(Request $request): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $dataB64 = trim((string) $request->input('data', ''));
        $hintBookingId = (int) $request->input('bookingId', 0) ?: null;
        $mockApprove = $request->boolean('mockApprove');

        if ($mockApprove) {
            return $this->mockVerify($request, $hintBookingId);
        }

        if ($dataB64 === '') {
            return $this->fail('Missing eSewa data', 400);
        }

        $payload = Payments::decodeEsewaData($dataB64);

        if ($payload === null) {
            return $this->fail('Invalid eSewa response — try again 🙏', 400);
        }

        $cfg = Payments::esewaConfig();

        if (! Payments::verifyEsewaSignature($payload, $cfg['secretKey'])) {
            return $this->fail('eSewa signature mismatch — possible tampering 🛡️', 400);
        }

        $uuid = (string) ($payload['transaction_uuid'] ?? '');
        $bookingId = $hintBookingId ?: Payments::parseBookingIdFromEsewaUuid($uuid);
        $teamPaymentId = (int) $request->input('teamPaymentId', 0) ?: $this->teamPaymentIdFromUuid($uuid);
        $paymentRequestId = (int) $request->input('paymentRequestId', 0) ?: ((int) ($this->matchId($uuid, '-PR-') ?? 0) ?: null);

        if (! $bookingId) {
            return $this->fail('Can’t link payment to booking', 400);
        }

        $booking = Booking::find($bookingId);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        $gate = $this->gate($booking, $teamPaymentId, $paymentRequestId, (int) $request->input('userId', 0));

        if ($gate instanceof JsonResponse) {
            return $gate;
        }

        ['teamPayment' => $teamPayment, 'paymentRequest' => $paymentRequest] = $gate;

        if (! $teamPayment && ! $paymentRequest && $booking->esewa_uuid && $booking->esewa_uuid !== $uuid) {
            return $this->fail('Transaction doesn’t match this booking — please start payment again 🔄', 400);
        }

        $expectedAmount = $this->expectedAmount($booking, $teamPayment, $paymentRequest);
        $paidTotal = (float) str_replace(',', '', (string) ($payload['total_amount'] ?? '0'));

        if (abs($paidTotal - $expectedAmount) > 0.01) {
            return $this->fail("Amount mismatch: paid {$paidTotal}, expected {$expectedAmount} 🛡️", 400);
        }

        if (strtoupper((string) ($payload['status'] ?? '')) !== 'COMPLETE') {
            return $this->fail('eSewa payment not completed', 400, ['ok' => false, 'status' => $payload['status'] ?? null]);
        }

        // Defence in depth: confirm with the eSewa status API. If it is
        // unreachable in the sandbox, the verified signature plus COMPLETE is
        // trusted rather than blocking a real payment.
        try {
            $status = Payments::esewaStatusCheck([
                'statusUrl' => $cfg['statusUrl'],
                'productCode' => $cfg['productCode'],
                'transactionUuid' => $uuid,
                'totalAmount' => $paidTotal,
            ]);

            $s = strtoupper((string) ($status['status'] ?? ''));

            if ($s !== '' && $s !== 'COMPLETE') {
                return $this->fail("eSewa says: {$s}", 400, ['ok' => false, 'status' => $s]);
            }
        } catch (\Throwable) {
            // Status API unreachable — signature plus COMPLETE is enough here.
        }

        $txnCode = ((string) ($payload['transaction_code'] ?? '')) ?: $uuid;

        if ($paymentRequest) {
            $paidRequest = $this->recordRequestedPayment($booking, $paymentRequest, (int) round($paidTotal), $txnCode);

            return $this->ok([
                'ok' => true,
                'booking' => $booking->fresh()->toArray(),
                'paymentRequest' => $paidRequest,
                'transactionCode' => $txnCode,
            ]);
        }

        if ($teamPayment) {
            $paidTeam = $this->recordTeamPayment($booking, $teamPayment, (int) round($paidTotal), $txnCode, 'eSewa');

            return $this->ok([
                'ok' => true,
                'booking' => $booking->fresh()->toArray(),
                'teamPayment' => $paidTeam,
                'transactionCode' => $txnCode,
            ]);
        }

        return $this->settleBookingPayment($booking, (int) round($paidTotal), $txnCode, 'eSewa', false);
    }

    /* -------------------------------------------------------------- mock */

    private function mockVerify(Request $request, ?int $hintBookingId): JsonResponse
    {
        if (! $hintBookingId) {
            return $this->fail('Missing booking', 400);
        }

        $booking = Booking::find($hintBookingId);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        if (in_array($booking->status, ['cancelled', 'rejected'], true)) {
            return $this->fail('This booking is no longer active', 409);
        }

        $teamPaymentId = (int) $request->input('teamPaymentId', 0) ?: $this->teamPaymentIdFromUuid((string) $request->input('uuid', ''));
        $paymentRequestId = (int) $request->input('paymentRequestId', 0) ?: ((int) ($this->matchId((string) $request->input('uuid', ''), '-PR-') ?? 0) ?: null);

        $teamPayment = $teamPaymentId
            ? BookingTeamPayment::where('id', $teamPaymentId)->where('booking_id', $booking->id)->first()
            : null;

        $paymentRequest = $paymentRequestId
            ? BookingPaymentRequest::where('id', $paymentRequestId)->where('booking_id', $booking->id)->first()
            : null;

        if ($teamPaymentId && ! $teamPayment) {
            return $this->fail('Team payment not found', 404);
        }

        if ($paymentRequestId && ! $paymentRequest) {
            return $this->fail('Payment request not found', 404);
        }

        $payerId = (int) $request->input('userId', 0) ?: null;

        if ($paymentRequest && (! $payerId || (int) $paymentRequest->payer_id !== $payerId)) {
            return $this->fail('Only the requested player can complete this payment 🔒', 403);
        }

        if ($paymentRequest && $paymentRequest->status !== 'pending') {
            return $this->fail('This payment request is no longer pending', 409);
        }

        if ($paymentRequest && $paymentRequest->payment_method !== 'eSewa') {
            return $this->fail('Choose eSewa for this payment request first 💳', 400);
        }

        if ($teamPayment && $paymentRequest) {
            return $this->fail('Choose one payment target at a time', 400);
        }

        if ($booking->visibility === 'competition' && $booking->competition_status === 'pending') {
            return $this->fail('Payment opens after the opposition captain accepts this competition request 🆚', 409);
        }

        $payingAdvance = ! $teamPayment && ! $paymentRequest
            && (bool) $booking->advance_payment_required && $booking->advance_payment_status !== 'paid';
        $payingDeposit = ! $teamPayment && ! $paymentRequest && ! $payingAdvance
            && (bool) $booking->deposit_required && $booking->deposit_status !== 'paid';

        $amount = $this->expectedAmount($booking, $teamPayment, $paymentRequest);

        $mockTxn = mb_substr(
            'MOCK-ESEWA-'.$booking->id
            .($teamPayment ? "-TP-{$teamPayment->id}" : ($paymentRequest ? "-PR-{$paymentRequest->id}" : ($payingAdvance ? '-ADV' : ($payingDeposit ? '-DEP' : "-BAL-{$booking->paid_amount}")))),
            0,
            100
        );

        if ($paymentRequest) {
            $paidRequest = $this->recordRequestedPayment($booking, $paymentRequest, $amount, $mockTxn);

            return $this->ok([
                'ok' => true,
                'mock' => true,
                'booking' => $booking->fresh()->toArray(),
                'paymentRequest' => $paidRequest,
                'transactionCode' => $mockTxn,
            ]);
        }

        if ($teamPayment) {
            $paidTeam = $this->recordTeamPayment($booking, $teamPayment, $amount, $mockTxn, 'eSewa simulator');

            return $this->ok([
                'ok' => true,
                'mock' => true,
                'booking' => $booking->fresh()->toArray(),
                'teamPayment' => $paidTeam,
                'transactionCode' => $mockTxn,
            ]);
        }

        return $this->settleBookingPayment($booking, $amount, $mockTxn, 'eSewa simulator', true);
    }

    /* ----------------------------------------------------------- helpers */

    /**
     * Resolve and authorise the payment target.
     *
     * @return array{teamPayment: BookingTeamPayment|null, paymentRequest: BookingPaymentRequest|null}|JsonResponse
     */
    private function gate(Booking $booking, ?int $teamPaymentId, ?int $paymentRequestId, int $payerId): array|JsonResponse
    {
        if (in_array($booking->status, ['cancelled', 'rejected'], true)) {
            return $this->fail('This booking is no longer active', 409);
        }

        if ($booking->visibility === 'competition' && $booking->competition_status === 'pending') {
            return $this->fail('Payment opens after the opposition captain accepts this competition request 🆚', 409);
        }

        $teamPayment = $teamPaymentId
            ? BookingTeamPayment::where('id', $teamPaymentId)->where('booking_id', $booking->id)->first()
            : null;

        $paymentRequest = $paymentRequestId
            ? BookingPaymentRequest::where('id', $paymentRequestId)->where('booking_id', $booking->id)->first()
            : null;

        if ($teamPaymentId && ! $teamPayment) {
            return $this->fail('Team payment not found', 404);
        }

        if ($paymentRequestId && ! $paymentRequest) {
            return $this->fail('Payment request not found', 404);
        }

        if ($paymentRequest && (! $payerId || (int) $paymentRequest->payer_id !== $payerId)) {
            return $this->fail('Only the requested player can complete this payment 🔒', 403);
        }

        if ($teamPayment && $paymentRequest) {
            return $this->fail('Choose one payment target at a time', 400);
        }

        if ($paymentRequest && $paymentRequest->status !== 'pending') {
            return $this->fail('This payment request is no longer pending', 409);
        }

        if ($paymentRequest && $paymentRequest->payment_method !== 'eSewa') {
            return $this->fail('Choose eSewa for this payment request first 💳', 400);
        }

        return ['teamPayment' => $teamPayment, 'paymentRequest' => $paymentRequest];
    }

    /** What the gateway is expected to have charged for this target. */
    private function expectedAmount(Booking $booking, ?BookingTeamPayment $teamPayment, ?BookingPaymentRequest $paymentRequest): int
    {
        $payingAdvance = ! $teamPayment && ! $paymentRequest
            && (bool) $booking->advance_payment_required && $booking->advance_payment_status !== 'paid';
        $payingDeposit = ! $teamPayment && ! $paymentRequest && ! $payingAdvance
            && (bool) $booking->deposit_required && $booking->deposit_status !== 'paid';

        return match (true) {
            (bool) $paymentRequest => (int) $paymentRequest->amount_due,
            (bool) $teamPayment => (int) $teamPayment->amount_due,
            $payingAdvance => (int) $booking->advance_payment_amount,
            $payingDeposit => (int) $booking->deposit_amount,
            default => max(0, (int) $booking->total_price - (int) $booking->paid_amount),
        };
    }

    /**
     * Update the member's share and the aggregate booking without making the UI
     * pretend a gateway payment happened. Every successful share also gets the
     * normal append-only ledger row.
     */
    private function recordTeamPayment(Booking $booking, BookingTeamPayment $teamPayment, int $amount, string $reference, string $note): BookingTeamPayment
    {
        if ($teamPayment->payment_status === 'paid') {
            return $teamPayment;
        }

        $teamPayment->forceFill([
            'payment_status' => 'paid',
            'paid_amount' => $amount,
            'gateway_txn_id' => mb_substr($reference, 0, 100),
        ])->save();

        LedgerRecord::recordGatewayPayment([
            'bookingId' => $booking->id,
            'amount' => $amount,
            'method' => 'eSewa',
            'reference' => $reference,
            'userId' => $teamPayment->user_id,
            'note' => $note,
        ]);

        $allShares = BookingTeamPayment::where('booking_id', $booking->id)->get();
        $paidTotal = (int) $allShares->sum('paid_amount');

        $advancePaid = (bool) $booking->advance_payment_required && $paidTotal >= (int) $booking->advance_payment_amount;

        $booking->forceFill([
            'paid_amount' => $paidTotal,
            'payment_status' => $paidTotal >= (int) $booking->total_price
                ? 'paid'
                : ((bool) $booking->deposit_required && $paidTotal >= (int) $booking->deposit_amount ? 'deposit_paid' : 'pending'),
            'deposit_status' => (bool) $booking->deposit_required && $paidTotal >= (int) $booking->deposit_amount
                ? 'paid'
                : $booking->deposit_status,
            'advance_payment_status' => (bool) $booking->advance_payment_required
                ? ($advancePaid ? 'paid' : 'pending')
                : 'none',
            'payment_method' => $advancePaid && $paidTotal < (int) $booking->total_price ? 'Cash at Venue' : $booking->payment_method,
            'gateway_txn_id' => mb_substr($reference, 0, 100),
        ])->save();

        $venue = $this->venueOf($booking);

        if ($venue?->owner_id) {
            Notifier::notify(
                (int) $venue->owner_id,
                'payment',
                "💰 Team eSewa share verified — {$venue->name}",
                ($booking->booker_name ?: 'A team member').' paid '.Futsal::formatNPR($amount).' via eSewa for team booking #FN-'.$booking->id
                .'. '.Futsal::formatNPR($paidTotal).' of '.Futsal::formatNPR($booking->total_price).' is now in the ledger.',
                '/admin/bookings'
            );
        }

        Notifier::notify(
            (int) $teamPayment->user_id,
            'payment',
            '✅ Team share paid',
            'Your '.Futsal::formatNPR($amount).' eSewa share for booking #FN-'.$booking->id.' is confirmed and recorded in the booking ledger.',
            '/bookings'
        );

        return $teamPayment->fresh();
    }

    /** A directed request: the payer's money, plus a projection onto their share. */
    private function recordRequestedPayment(Booking $booking, BookingPaymentRequest $request, int $amount, string $reference): BookingPaymentRequest
    {
        if ($request->status === 'paid') {
            return $request;
        }

        $updated = BookingPaymentRequest::where('id', $request->id)->where('status', 'pending')
            ->update([
                'status' => 'paid',
                'paid_amount' => $amount,
                'gateway_txn_id' => mb_substr($reference, 0, 100),
                'paid_at' => now(),
            ]);

        if ($updated === 0) {
            return $request;
        }

        $newPaid = min((int) $booking->total_price, (int) $booking->paid_amount + $amount);
        $advancePaid = (bool) $booking->advance_payment_required && $newPaid >= (int) $booking->advance_payment_amount;

        $booking->forceFill([
            'gateway_txn_id' => mb_substr($reference, 0, 100),
            'paid_amount' => $newPaid,
            'payment_status' => $newPaid >= (int) $booking->total_price ? 'paid' : 'pending',
            'advance_payment_status' => (bool) $booking->advance_payment_required ? ($advancePaid ? 'paid' : 'pending') : 'none',
            'payment_method' => $request->purpose === 'advance' && $newPaid < (int) $booking->total_price
                ? 'Cash at Venue'
                : $booking->payment_method,
        ])->save();

        LedgerRecord::recordGatewayPayment([
            'bookingId' => $booking->id,
            'amount' => $amount,
            'method' => 'eSewa',
            'reference' => $reference,
            'userId' => $request->payer_id,
            'note' => "eSewa teammate {$request->purpose} payment",
        ]);

        AdvancePayment::recordDirectedTeamSharePayment((int) $booking->id, (int) $request->payer_id, $amount, $reference);

        $venue = $this->venueOf($booking);

        if ($venue?->owner_id) {
            Notifier::notify(
                (int) $venue->owner_id,
                'payment',
                "💰 Teammate eSewa payment received — {$venue->name}",
                'A teammate paid '.Futsal::formatNPR($amount).' directly to '.$venue->name.' for booking #FN-'.$booking->id
                .". The captain’s requested {$request->purpose} amount is now in the ledger.",
                '/admin/bookings'
            );
        }

        Notifier::notify(
            (int) $request->requested_by,
            'payment',
            '✅ Teammate payment received',
            'Your teammate paid '.Futsal::formatNPR($amount).' via eSewa for booking #FN-'.$booking->id.'. The venue has the money in its booking ledger.',
            '/bookings'
        );

        return $request->fresh();
    }

    /** The booking's own money: advance first, then deposit, then the balance. */
    private function settleBookingPayment(Booking $booking, int $amount, string $reference, string $note, bool $mock): JsonResponse
    {
        $payingAdvance = (bool) $booking->advance_payment_required && $booking->advance_payment_status !== 'paid';
        $payingDeposit = ! $payingAdvance && (bool) $booking->deposit_required && $booking->deposit_status !== 'paid';

        $newPaid = min((int) $booking->total_price, (int) $booking->paid_amount + $amount);

        $patch = [
            'gateway_txn_id' => mb_substr($reference, 0, 100),
            'paid_amount' => $newPaid,
            'advance_payment_status' => $payingAdvance ? 'paid' : $booking->advance_payment_status,
            // Once an advance is covered the rest is cash at the desk.
            'payment_method' => $payingAdvance && $newPaid < (int) $booking->total_price ? 'Cash at Venue' : $booking->payment_method,
            'deposit_status' => (bool) $booking->deposit_required && $newPaid >= (int) $booking->deposit_amount
                ? 'paid'
                : $booking->deposit_status,
        ];

        if ($payingDeposit) {
            $patch['payment_status'] = $newPaid >= (int) $booking->total_price ? 'paid' : 'deposit_paid';
            $patch['deposit_status'] = 'paid';
        } else {
            $patch['payment_status'] = $newPaid < (int) $booking->total_price ? 'pending' : 'paid';
        }

        $booking->forceFill($patch)->save();

        LedgerRecord::recordGatewayPayment([
            'bookingId' => $booking->id,
            'amount' => $amount,
            'method' => 'eSewa',
            'reference' => $reference,
            'userId' => $booking->user_id,
            'note' => $note,
        ]);

        $venue = $this->venueOf($booking);

        if ($venue?->owner_id) {
            $kind = $payingDeposit ? 'deposit' : ($payingAdvance ? 'advance' : 'balance');

            Notifier::notify(
                (int) $venue->owner_id,
                'payment',
                "💰 eSewa {$kind} verified — {$venue->name}",
                ($booking->booker_name ?: 'Player').' paid '.Futsal::formatNPR($amount).' via eSewa '.($mock ? 'simulator' : 'test')
                ." (txn {$reference}). Booking #FN-{$booking->id}.",
                '/admin/bookings'
            );
        }

        return $this->ok([
            'ok' => true,
            'mock' => $mock,
            'booking' => $booking->fresh()->toArray(),
            'transactionCode' => $reference,
        ]);
    }

    private function venueOf(Booking $booking): ?Venue
    {
        $court = Court::find((int) $booking->court_id);

        return $court ? Venue::find((int) $court->venue_id) : null;
    }

    private function teamPaymentIdFromUuid(string $uuid): ?int
    {
        return $this->matchId($uuid, '-TP-');
    }

    private function matchId(string $uuid, string $marker): ?int
    {
        if (preg_match('/'.preg_quote($marker, '/').'(\d+)(?:-|$)/', $uuid, $m) !== 1) {
            return null;
        }

        return (int) $m[1];
    }
}
