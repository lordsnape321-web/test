<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\BookingPaymentRequest;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\User;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\AdvancePayment;
use App\Support\Futsal;
use App\Support\LedgerRecord;
use App\Support\Payments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Khalti test gateway — `POST /api/payments/khalti/{initiate,verify}`.
 *
 * Same three payment targets as eSewa, but Khalti identifies a session by
 * `pidx` rather than by a signed callback, and quotes amounts in paisa. When no
 * test key is configured — or the sandbox is unreachable — the flow falls back
 * to a local simulator so the demo never breaks.
 */
class KhaltiController extends ApiController
{
    /** Build a payment session and hand back the page to open. */
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

        $target = $this->resolveTarget($request, $booking);

        if ($target instanceof JsonResponse) {
            return $target;
        }

        ['teamPayment' => $teamPayment, 'paymentRequest' => $paymentRequest] = $target;

        if ($teamPayment && $teamPayment->payment_status === 'paid') {
            return $this->fail('This team share is already paid ✅', 400, ['teamPayment' => $teamPayment->toArray()]);
        }

        $flags = $this->moneyFlags($booking, $teamPayment, $paymentRequest);

        if (! $teamPayment && ! $paymentRequest && $booking->payment_status === 'paid') {
            return $this->fail('Already paid ✅', 400, ['booking' => $booking->toArray()]);
        }

        $amountNpr = $this->expectedAmount($booking, $teamPayment, $paymentRequest, $flags);

        if ($amountNpr < 10) {
            return $this->fail('Khalti needs at least Rs. 10 (1000 paisa) 💰', 400);
        }

        $court = Court::find((int) $booking->court_id);
        $venue = $court ? Venue::find((int) $court->venue_id) : null;
        $venueName = $venue->name ?? 'Futsal Court';

        $customer = User::find((int) ($paymentRequest->payer_id ?? $teamPayment->user_id ?? $booking->user_id));

        $cfg = Payments::khaltiConfig();
        $origin = Payments::appOrigin($request);

        $orderId = Payments::makeKhaltiOrderId((int) $booking->id)
            .($teamPayment ? "-TP-{$teamPayment->id}" : ($paymentRequest ? "-PR-{$paymentRequest->id}" : ''));

        $requestQuery = $paymentRequest ? "&paymentRequestId={$paymentRequest->id}&userId={$paymentRequest->payer_id}" : '';

        $returnUrl = "{$origin}/payment/khalti/callback?bookingId={$booking->id}"
            .($teamPayment ? "&teamPaymentId={$teamPayment->id}" : '').$requestQuery;

        $amountPaisa = (int) round($amountNpr * 100);

        $mockTarget = $teamPayment
            ? "&teamPaymentId={$teamPayment->id}&userId={$teamPayment->user_id}"
            : ($paymentRequest ? "&paymentRequestId={$paymentRequest->id}&userId={$paymentRequest->payer_id}" : '');

        // No key configured → the local test simulator, which is a fully
        // functional demo on its own.
        if ($cfg['secretKey'] === '') {
            $mockPidx = 'mock-'.$orderId;

            $this->storePidx($booking, $teamPayment, $paymentRequest, $mockPidx);

            return $this->ok([
                'mock' => true,
                'pidx' => $mockPidx,
                'payment_url' => "{$origin}/payment/khalti/mock?pidx=".rawurlencode($mockPidx)."&bookingId={$booking->id}&amount={$amountNpr}".$mockTarget,
                'amount' => $amountNpr,
                'bookingId' => $booking->id,
                'teamPaymentId' => $teamPayment->id ?? null,
                'paymentRequestId' => $paymentRequest->id ?? null,
                'venueName' => $venueName,
                'isDeposit' => ! $teamPayment && ! $paymentRequest && (bool) $booking->deposit_required,
                'isAdvance' => ($paymentRequest?->purpose === 'advance') || (! $teamPayment && (bool) $booking->advance_payment_required),
                'testHint' => 'Sandbox simulator — no KHALTI_SECRET_KEY set. Add your Khalti test key to hit the real test-pay page.',
            ]);
        }

        try {
            $init = Payments::khaltiInitiate([
                'secretKey' => $cfg['secretKey'],
                'initiateUrl' => $cfg['initiateUrl'],
                'returnUrl' => $returnUrl,
                'websiteUrl' => $origin,
                'amountPaisa' => $amountPaisa,
                'orderId' => $orderId,
                'orderName' => "Futsal booking #FN-{$booking->id} at {$venueName}",
                'customerName' => $booking->booker_name ?: ($customer->name ?? '') ?: 'Futsal Player',
                'customerEmail' => $customer->email ?? 'player@futsal.np',
                'customerPhone' => mb_substr(preg_replace('/\D/', '', $booking->booker_phone ?: ($customer->phone ?? '')) ?: '', -10) ?: '9800000000',
            ]);

            $this->storePidx($booking, $teamPayment, $paymentRequest, $init['pidx']);

            return $this->ok([
                'mock' => false,
                'pidx' => $init['pidx'],
                'payment_url' => $init['payment_url'],
                'amount' => $amountNpr,
                'bookingId' => $booking->id,
                'teamPaymentId' => $teamPayment->id ?? null,
                'paymentRequestId' => $paymentRequest->id ?? null,
                'venueName' => $venueName,
                'isDeposit' => ! $teamPayment && ! $paymentRequest && (bool) $booking->deposit_required,
                'isAdvance' => ($paymentRequest?->purpose === 'advance') || (! $teamPayment && (bool) $booking->advance_payment_required),
                'testHint' => 'Khalti sandbox: use test ID 9800000001 / MPIN 1111 / OTP 987654',
            ]);
        } catch (\Throwable $e) {
            // Sandbox unreachable or key rejected: fall back to the simulator so
            // the demo keeps working.
            $mockPidx = 'mock-'.$orderId;

            $this->storePidx($booking, $teamPayment, $paymentRequest, $mockPidx);

            return $this->ok([
                'mock' => true,
                'fallback' => true,
                'fallbackError' => $e->getMessage(),
                'pidx' => $mockPidx,
                'payment_url' => "{$origin}/payment/khalti/mock?pidx=".rawurlencode($mockPidx)."&bookingId={$booking->id}&amount={$amountNpr}"
                    .$mockTarget.'&fallback='.rawurlencode($e->getMessage()),
                'amount' => $amountNpr,
                'bookingId' => $booking->id,
                'teamPaymentId' => $teamPayment->id ?? null,
                'paymentRequestId' => $paymentRequest->id ?? null,
                'venueName' => $venueName,
                'isDeposit' => ! $teamPayment && ! $paymentRequest && (bool) $booking->deposit_required,
                'isAdvance' => ($paymentRequest?->purpose === 'advance') || (! $teamPayment && (bool) $booking->advance_payment_required),
                'testHint' => 'Khalti sandbox unreachable — using local simulator so you can still test.',
            ]);
        }
    }

    /**
     * Look the session up with Khalti and, when it is confirmed, record the
     * money. A `mock-` pidx (or a missing key) is the simulator path, which
     * needs `mockApprove` because there is nobody else to say yes.
     */
    public function verify(Request $request): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $pidx = trim((string) $request->input('pidx', ''));
        $bookingId = (int) $request->input('bookingId', 0) ?: null;
        $mockApprove = $request->boolean('mockApprove');

        if ($pidx === '') {
            return $this->fail('Missing pidx', 400);
        }

        $orderId = (string) $request->input('order_id', '');
        $teamPaymentId = (int) $request->input('teamPaymentId', 0) ?: $this->idFromOrder($orderId, '-TP-');
        $paymentRequestId = (int) $request->input('paymentRequestId', 0) ?: $this->idFromOrder($orderId, '-PR-');

        if ($bookingId) {
            $booking = Booking::find($bookingId);
        } else {
            // Without a hint, the session id is the only way to find the booking.
            $booking = Booking::where('khalti_pidx', $pidx)->first();

            if (! $booking) {
                return $this->fail('Booking not found for pidx', 404);
            }
        }

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        if (in_array($booking->status, ['cancelled', 'rejected'], true)) {
            return $this->fail('This booking is no longer active', 409);
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

        $payerId = (int) $request->input('userId', 0) ?: null;

        if ($paymentRequest && (! $payerId || (int) $paymentRequest->payer_id !== $payerId)) {
            return $this->fail('Only the requested player can complete this payment 🔒', 403);
        }

        if ($teamPayment && $paymentRequest) {
            return $this->fail('Choose one payment target at a time', 400);
        }

        if ($paymentRequest && $paymentRequest->status !== 'pending') {
            return $this->fail('This payment request is no longer pending', 409);
        }

        if ($paymentRequest && $paymentRequest->payment_method !== 'Khalti') {
            return $this->fail('Choose Khalti for this payment request first 💳', 400);
        }

        if ($teamPayment && $teamPayment->payment_method !== 'Khalti') {
            return $this->fail('Choose Khalti for this team share first 💳', 400);
        }

        if ($teamPayment && $teamPayment->payment_status === 'paid') {
            return $this->ok([
                'ok' => true,
                'booking' => $booking->toArray(),
                'teamPayment' => $teamPayment->toArray(),
                'transactionId' => $teamPayment->gateway_txn_id,
            ]);
        }

        if ($booking->visibility === 'competition' && $booking->competition_status === 'pending') {
            return $this->fail('Payment opens after the opposition captain accepts this competition request 🆚', 409);
        }

        // Each target remembers the session it started, so one pidx cannot pay
        // for something else.
        if (! $teamPayment && ! $paymentRequest && $booking->khalti_pidx && $booking->khalti_pidx !== $pidx) {
            return $this->fail('Payment session doesn’t match this booking — start again 🔄', 400);
        }

        if ($teamPayment && $teamPayment->khalti_pidx && $teamPayment->khalti_pidx !== $pidx) {
            return $this->fail('Payment session doesn’t match this team share — start again 🔄', 400);
        }

        if ($paymentRequest && $paymentRequest->khalti_pidx && $paymentRequest->khalti_pidx !== $pidx) {
            return $this->fail('Payment session doesn’t match this teammate request — start again 🔄', 400);
        }

        $cfg = Payments::khaltiConfig();
        $isMock = str_starts_with($pidx, 'mock-') || $cfg['secretKey'] === '';

        if ($isMock) {
            if (! $mockApprove) {
                return $this->fail('Mock payment not approved', 400, ['ok' => false]);
            }

            $flags = $this->moneyFlags($booking, $teamPayment, $paymentRequest);
            $amount = $this->expectedAmount($booking, $teamPayment, $paymentRequest, $flags);
            $reference = mb_substr('MOCK-'.mb_substr($pidx, 0, 24), 0, 100);

            return $this->pay($booking, $teamPayment, $paymentRequest, $amount, $reference, 'Khalti simulator', true, $flags);
        }

        try {
            $lookup = Payments::khaltiLookup([
                'secretKey' => $cfg['secretKey'],
                'lookupUrl' => $cfg['lookupUrl'],
                'pidx' => $pidx,
            ]);
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage(), 400);
        }

        $status = (string) ($lookup['status'] ?? '');

        if ($status !== 'Completed') {
            return $this->fail('Khalti says: '.($status ?: 'not completed'), 400, ['ok' => false, 'status' => $status]);
        }

        $paidPaisa = (float) ($lookup['total_amount'] ?? 0);
        $paidNpr = $paidPaisa > 0 ? (int) round($paidPaisa / 100) : null;
        $reference = mb_substr((string) ($lookup['transaction_id'] ?? $pidx), 0, 100);

        $flags = $this->moneyFlags($booking, $teamPayment, $paymentRequest);
        $expectedAmount = $this->expectedAmount($booking, $teamPayment, $paymentRequest, $flags);

        if ($paidNpr !== null && abs($paidNpr - $expectedAmount) > 0) {
            return $this->fail("Amount mismatch: paid {$paidNpr}, expected {$expectedAmount} 💳", 400);
        }

        $amount = $paidNpr ?? $expectedAmount;

        return $this->pay($booking, $teamPayment, $paymentRequest, $amount, $reference, 'Khalti', false, $flags, $lookup);
    }

    /* ----------------------------------------------------------- internals */

    /** Record the money against whichever target this session belongs to. */
    private function pay(
        Booking $booking,
        ?BookingTeamPayment $teamPayment,
        ?BookingPaymentRequest $paymentRequest,
        int $amount,
        string $reference,
        string $note,
        bool $mock,
        array $flags,
        ?array $lookup = null
    ): JsonResponse {
        if ($paymentRequest) {
            $paid = $this->recordRequestedPayment($booking, $paymentRequest, $amount, $reference);

            $payload = [
                'ok' => true,
                'mock' => $mock,
                'booking' => $booking->fresh()->toArray(),
                'paymentRequest' => $paid,
                'transactionId' => $reference,
            ];

            return $this->ok($lookup === null ? $payload : $payload + ['lookup' => $lookup]);
        }

        if ($teamPayment) {
            $paid = $this->recordTeamPayment($booking, $teamPayment, $amount, $reference, $note);

            $payload = [
                'ok' => true,
                'mock' => $mock,
                'booking' => $booking->fresh()->toArray(),
                'teamPayment' => $paid,
                'transactionId' => $reference,
            ];

            return $this->ok($lookup === null ? $payload : $payload + ['lookup' => $lookup]);
        }

        $payingDeposit = (bool) ($flags['payingDeposit'] ?? false);
        $payingAdvance = (bool) ($flags['payingAdvance'] ?? false);

        $newPaid = min((int) $booking->total_price, (int) $booking->paid_amount + $amount);

        $patch = [
            'gateway_txn_id' => mb_substr($reference, 0, 100),
            'paid_amount' => $newPaid,
            'advance_payment_status' => $payingAdvance ? 'paid' : $booking->advance_payment_status,
            // Once the advance is covered the rest is cash at the desk.
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
            'method' => 'Khalti',
            'reference' => $reference,
            'userId' => $booking->user_id,
            'note' => $note,
        ]);

        if (! $mock) {
            $venue = $this->venueOf($booking);
            $kind = $payingDeposit ? 'deposit' : ($payingAdvance ? 'advance' : 'balance');

            if ($venue?->owner_id) {
                Notifier::notify(
                    (int) $venue->owner_id,
                    'payment',
                    "💰 Khalti {$kind} verified — {$venue->name}",
                    ($booking->booker_name ?: 'Player').' paid '.Futsal::formatNPR((int) ($patch['paid_amount'] ?? 0))
                    .' via Khalti test (txn '.mb_substr($reference, 0, 20)."). Booking #FN-{$booking->id}.",
                    '/admin/bookings'
                );
            }
        }

        $payload = [
            'ok' => true,
            'mock' => $mock,
            'booking' => $booking->fresh()->toArray(),
            'transactionId' => $reference,
        ];

        return $this->ok($lookup === null ? $payload : $payload + ['lookup' => $lookup]);
    }

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
            'method' => 'Khalti',
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
            'advance_payment_status' => (bool) $booking->advance_payment_required ? ($advancePaid ? 'paid' : 'pending') : 'none',
            'payment_method' => $advancePaid && $paidTotal < (int) $booking->total_price ? 'Cash at Venue' : $booking->payment_method,
            'gateway_txn_id' => mb_substr($reference, 0, 100),
        ])->save();

        $venue = $this->venueOf($booking);

        if ($venue?->owner_id) {
            Notifier::notify(
                (int) $venue->owner_id,
                'payment',
                "💰 Team Khalti share verified — {$venue->name}",
                ($booking->booker_name ?: 'A team member').' paid '.Futsal::formatNPR($amount).' via Khalti for team booking #FN-'.$booking->id
                .'. '.Futsal::formatNPR($paidTotal).' of '.Futsal::formatNPR($booking->total_price).' is now in the ledger.',
                '/admin/bookings'
            );
        }

        Notifier::notify(
            (int) $teamPayment->user_id,
            'payment',
            '✅ Team share paid',
            'Your '.Futsal::formatNPR($amount).' Khalti share for booking #FN-'.$booking->id.' is confirmed and recorded in the booking ledger.',
            '/bookings'
        );

        return $teamPayment->fresh();
    }

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
            'method' => 'Khalti',
            'reference' => $reference,
            'userId' => $request->payer_id,
            'note' => "Khalti teammate {$request->purpose} payment",
        ]);

        AdvancePayment::recordDirectedTeamSharePayment((int) $booking->id, (int) $request->payer_id, $amount, $reference);

        $venue = $this->venueOf($booking);

        if ($venue?->owner_id) {
            Notifier::notify(
                (int) $venue->owner_id,
                'payment',
                "💰 Teammate Khalti payment received — {$venue->name}",
                'A teammate paid '.Futsal::formatNPR($amount).' directly to '.$venue->name.' for booking #FN-'.$booking->id
                .". The captain’s requested {$request->purpose} amount is now in the ledger.",
                '/admin/bookings'
            );
        }

        Notifier::notify(
            (int) $request->requested_by,
            'payment',
            '✅ Teammate payment received',
            'Your teammate paid '.Futsal::formatNPR($amount).' via Khalti for booking #FN-'.$booking->id.'. The venue has the money in its booking ledger.',
            '/bookings'
        );

        return $request->fresh();
    }

    /**
     * Which target is being paid, and is the caller allowed to pay it?
     *
     * @return array{teamPayment: ?BookingTeamPayment, paymentRequest: ?BookingPaymentRequest}|JsonResponse
     */
    private function resolveTarget(Request $request, Booking $booking): array|JsonResponse
    {
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

        if ($paymentRequest && $paymentRequest->payment_method !== 'Khalti') {
            return $this->fail('Choose Khalti for this payment request first 💳', 400);
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

        if ($teamPayment && $teamPayment->payment_method !== 'Khalti') {
            return $this->fail('Choose Khalti for this team share first 💳', 400);
        }

        if (! $teamPayment && ! $paymentRequest && $booking->payment_method !== 'Khalti') {
            return $this->fail('This booking is not a Khalti payment 💳', 400);
        }

        if (Futsal::gamePlayed($booking->getAttributes())) {
            return $this->fail('That game is already played 🔒 — the booking is locked, so payment can’t be started for it now.', 409);
        }

        return ['teamPayment' => $teamPayment, 'paymentRequest' => $paymentRequest];
    }

    /**
     * @return array{payingAdvance: bool, payingDeposit: bool}
     */
    private function moneyFlags(Booking $booking, ?BookingTeamPayment $teamPayment, ?BookingPaymentRequest $paymentRequest): array
    {
        $payingAdvance = ! $teamPayment && ! $paymentRequest
            && (bool) $booking->advance_payment_required && $booking->advance_payment_status !== 'paid';

        return [
            'payingAdvance' => $payingAdvance,
            'payingDeposit' => ! $teamPayment && ! $paymentRequest && ! $payingAdvance
                && (bool) $booking->deposit_required && $booking->deposit_status !== 'paid',
        ];
    }

    private function expectedAmount(Booking $booking, ?BookingTeamPayment $teamPayment, ?BookingPaymentRequest $paymentRequest, array $flags): int
    {
        return match (true) {
            (bool) $paymentRequest => (int) $paymentRequest->amount_due,
            (bool) $teamPayment => (int) $teamPayment->amount_due,
            (bool) $flags['payingAdvance'] => (int) $booking->advance_payment_amount,
            (bool) $flags['payingDeposit'] => (int) $booking->deposit_amount,
            default => max(0, (int) $booking->total_price - (int) $booking->paid_amount),
        };
    }

    private function storePidx(Booking $booking, ?BookingTeamPayment $teamPayment, ?BookingPaymentRequest $paymentRequest, string $pidx): void
    {
        if ($teamPayment) {
            $teamPayment->forceFill(['khalti_pidx' => $pidx])->save();

            return;
        }

        if ($paymentRequest) {
            $paymentRequest->forceFill(['khalti_pidx' => $pidx])->save();

            return;
        }

        $booking->forceFill(['khalti_pidx' => $pidx])->save();
    }

    private function venueOf(Booking $booking): ?Venue
    {
        $court = Court::find((int) $booking->court_id);

        return $court ? Venue::find((int) $court->venue_id) : null;
    }

    private function idFromOrder(string $orderId, string $marker): ?int
    {
        if (preg_match('/'.preg_quote($marker, '/').'(\d+)(?:-|$)/', $orderId, $m) !== 1) {
            return null;
        }

        return (int) $m[1];
    }
}
