<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\BookingPaymentRequest;
use App\Models\Court;
use App\Models\Team;
use App\Models\TeamMember;
use App\Models\User;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\AdvancePayment;
use App\Support\Futsal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A captain's directed request for one teammate to pay a specific amount.
 *
 * Separate from the equal team shares: the recipient pays the venue through
 * eSewa or Khalti while the captain can ask for an advance or any remaining
 * booking amount, without changing the roster split.
 */
class PaymentRequestController extends ApiController
{
    private const METHODS = ['eSewa', 'Khalti'];

    private const PURPOSES = ['advance', 'booking'];

    /** GET — the requests on one booking. Private to the squad. */
    public function index(Request $request, int $id): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $viewerId = (int) $request->query('userId', 0);
        $booking = Booking::find($id);

        if ($viewerId <= 0) {
            return $this->fail('Invalid booking or player 🔒', 400);
        }

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        $isMember = $booking->team_id
            ? TeamMember::where('team_id', $booking->team_id)->where('user_id', $viewerId)->exists()
            : false;

        if ((int) $booking->user_id !== $viewerId && ! $isMember) {
            return $this->fail('Only this booking team can view its payment requests 🔒', 403);
        }

        $rows = BookingPaymentRequest::where('booking_id', $id)->orderBy('id')->get();

        return $this->ok(['paymentRequests' => $rows->map(fn ($row) => $this->view($row))->all()]);
    }

    /** POST — the captain asks one or more teammates for money. */
    public function store(Request $request, int $id): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $requesterId = (int) $request->input('requesterId', 0);

        $rawPayerIds = is_array($request->input('payerIds'))
            ? $request->input('payerIds')
            : [$request->input('payerId')];

        $payerIds = array_values(array_unique(array_filter(
            array_map('intval', $rawPayerIds),
            fn ($v) => $v > 0
        )));

        $amount = (int) $request->input('amount', 0);
        $purpose = (string) $request->input('purpose', 'booking');
        $note = mb_substr(trim((string) $request->input('note', '')), 0, 240);

        if ($requesterId <= 0 || $payerIds === []) {
            return $this->fail('Pick a valid booking and at least one player 🔒', 400);
        }

        if (count($payerIds) > 30) {
            return $this->fail('You can request money from at most 30 teammates at once', 400);
        }

        if ($amount < 10) {
            return $this->fail('Payment requests must be at least Rs. 10 💰', 400);
        }

        if (! in_array($purpose, self::PURPOSES, true)) {
            return $this->fail('Pick a valid payment purpose', 400);
        }

        $booking = Booking::find($id);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        $team = $booking->team_id ? Team::find($booking->team_id) : null;
        $venue = $this->venueOf($booking);
        $court = Court::find((int) $booking->court_id);

        if (! $booking->team_id || ! $team) {
            return $this->fail('Only team bookings can request teammate payments', 400);
        }

        if (in_array($booking->status, ['cancelled', 'rejected', 'completed'], true)) {
            return $this->fail('This booking is no longer collecting payments', 409);
        }

        if ($booking->visibility === 'competition' && $booking->competition_status === 'pending') {
            return $this->fail('Payment requests open after the opposition captain accepts this competition request 🆚', 409);
        }

        // Only the captain who made the booking may ask for money on it.
        if ((int) $team->captain_id !== $requesterId || (int) $booking->user_id !== $requesterId) {
            return $this->fail('Only the captain who made this booking can request teammate money 👑', 403);
        }

        if (in_array($requesterId, $payerIds, true)) {
            return $this->fail('Choose teammates other than the captain', 400);
        }

        $teamPlayerIds = TeamMember::where('team_id', $booking->team_id)->pluck('user_id')->map(fn ($v) => (int) $v)->all();

        if (collect($payerIds)->contains(fn ($p) => ! in_array($p, $teamPlayerIds, true))) {
            return $this->fail('Every selected player must be on this booking’s team 🔒', 403);
        }

        $target = $purpose === 'advance'
            ? (int) ($booking->advance_payment_amount ?? 0)
            : (int) ($booking->total_price ?? 0);

        if ($purpose === 'advance' && (! (bool) $booking->advance_payment_required || $booking->advance_payment_status === 'paid')) {
            return $this->fail('This booking has no unpaid venue advance', 409);
        }

        if ($purpose === 'booking' && (bool) $booking->advance_payment_required && $booking->advance_payment_status !== 'paid') {
            return $this->fail('Request the venue advance first; the remaining booking amount opens after it is paid', 409);
        }

        $existing = BookingPaymentRequest::where('booking_id', $booking->id)->where('status', 'pending')->get();

        $pendingForPurpose = (int) $existing
            ->filter(fn ($row) => $row->purpose === $purpose)
            ->sum('amount_due');

        $paid = max(0, (int) $booking->paid_amount);
        $remaining = max(0, $target - $paid - $pendingForPurpose);
        $totalRequested = $amount * count($payerIds);

        if ($totalRequested > $remaining) {
            return $this->fail(
                'Only '.Futsal::formatNPR($remaining).' remains available. '.Futsal::formatNPR($amount)
                .' per selected player would request '.Futsal::formatNPR($totalRequested).'.',
                400
            );
        }

        $duplicate = $existing->contains(fn ($row) => $row->purpose === $purpose && in_array((int) $row->payer_id, $payerIds, true));

        if ($duplicate) {
            return $this->fail('One or more selected players already have a pending request for this booking', 409);
        }

        $inserted = [];

        foreach ($payerIds as $payerId) {
            $inserted[] = BookingPaymentRequest::create([
                'booking_id' => $booking->id,
                'requested_by' => $requesterId,
                'payer_id' => $payerId,
                'amount_due' => $amount,
                'purpose' => $purpose,
                'note' => $note,
                'status' => 'pending',
            ]);
        }

        $requester = User::find($requesterId)->name ?? 'Your captain';
        $when = Futsal::prettyDate($booking->date).' at '.Futsal::formatTime12($booking->start_time);
        $deadline = $purpose === 'advance' ? AdvancePayment::deadline($booking->advance_payment_requested_at) : null;

        foreach ($inserted as $row) {
            Notifier::notify(
                (int) $row->payer_id,
                'payment',
                ($purpose === 'advance' ? '💳 Advance payment request' : '💳 Team payment request')." — {$requester}",
                "{$requester} asked you to pay ".Futsal::formatNPR($amount).' directly to '.($venue->name ?? 'the venue')
                .' for '.($court->name ?? 'the court')." on {$when}. Choose eSewa or Khalti; the verified payment goes into booking #FN-{$booking->id}."
                .($purpose === 'advance' && $deadline ? ' Pay before '.$deadline->format('g:i A').' — the booking cancels 30 minutes after the venue’s advance request.' : '')
                .($note !== '' ? " Note: {$note}" : ''),
                '/bookings'
            );
        }

        if ($venue?->owner_id) {
            Notifier::notify(
                (int) $venue->owner_id,
                'payment',
                "💳 Team payment request — {$venue->name}",
                "{$requester} asked ".count($inserted).' teammate'.(count($inserted) === 1 ? '' : 's').' for '
                .Futsal::formatNPR($amount)." each toward booking #FN-{$booking->id}. Their selected players have been notified; verified money will appear in the booking ledger.",
                '/admin/requests'
            );
        }

        $views = array_map(fn ($row) => $this->view($row), $inserted);

        return $this->ok([
            'paymentRequest' => $views[0] ?? null,
            'paymentRequests' => $views,
        ], 201);
    }

    /**
     * PATCH /api/bookings/{id}/payment-requests/{requestId}
     *
     * The payer picks eSewa or Khalti, or the captain cancels the request.
     */
    public function update(Request $request, int $id, int $requestId): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $userId = (int) $request->input('userId', 0);

        if ($userId <= 0) {
            return $this->fail('Invalid payment request 🔒', 400);
        }

        $row = BookingPaymentRequest::where('id', $requestId)->where('booking_id', $id)->first();

        if (! $row) {
            return $this->fail('Payment request not found', 404);
        }

        $booking = Booking::find($id);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        if ($row->status !== 'pending') {
            return $this->fail('This payment request is no longer pending', 409, ['paymentRequest' => $this->view($row)]);
        }

        if ($request->input('action') === 'cancel') {
            if ((int) $row->requested_by !== $userId) {
                return $this->fail('Only the requesting captain can cancel this request 🔒', 403);
            }

            $updated = BookingPaymentRequest::where('id', $row->id)->where('status', 'pending')->update(['status' => 'cancelled']);

            return $this->ok(['paymentRequest' => $this->view($row->fresh() ?? $row)]);
        }

        if ((int) $row->payer_id !== $userId) {
            return $this->fail('Only the requested player can choose the payment method 🔒', 403);
        }

        $method = (string) $request->input('paymentMethod', '');

        if (! in_array($method, self::METHODS, true)) {
            return $this->fail('Direct teammate payments use eSewa or Khalti only 💳', 400);
        }

        if (in_array($booking->status, ['cancelled', 'rejected'], true)) {
            return $this->fail('This booking is no longer active', 409);
        }

        BookingPaymentRequest::where('id', $row->id)->where('status', 'pending')->update(['payment_method' => $method]);

        $payer = User::find($userId);

        return $this->ok([
            'paymentRequest' => $this->view($row->fresh() ?? $row),
            'payerName' => $payer->name ?? 'Player',
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function view(BookingPaymentRequest $row): array
    {
        $people = User::whereIn('id', array_filter([(int) $row->requested_by, (int) $row->payer_id]))->get()->keyBy('id');

        return [
            'id' => $row->id,
            'bookingId' => $row->booking_id,
            'requestedBy' => $row->requested_by,
            'requesterName' => $people->get((int) $row->requested_by)?->name ?? 'Captain',
            'payerId' => $row->payer_id,
            'payerName' => $people->get((int) $row->payer_id)?->name ?? 'Player',
            'amountDue' => (int) $row->amount_due,
            'purpose' => $row->purpose,
            'note' => $row->note,
            'paymentMethod' => $row->payment_method,
            'status' => $row->status,
            'paidAmount' => (int) $row->paid_amount,
            'gatewayTxnId' => $row->gateway_txn_id,
            'createdAt' => $row->created_at,
            'paidAt' => $row->paid_at,
        ];
    }

    private function venueOf(Booking $booking): ?Venue
    {
        $court = Court::find((int) $booking->court_id);

        return $court ? Venue::find((int) $court->venue_id) : null;
    }
}
