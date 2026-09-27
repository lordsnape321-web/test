<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\TeamMember;
use App\Models\User;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\AdvancePayment;
use App\Support\Futsal;
use App\Support\Loyalty;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Each member's share of a team booking — `POST/GET /api/bookings/{id}/team-payments`.
 *
 * A private "Just our gang" booking is a shared obligation rather than one
 * mysterious charge on the captain's card, so every member picks their own
 * method and pays only the share the server calculated.
 */
class TeamPaymentController extends ApiController
{
    private const METHODS = ['eSewa', 'Khalti', 'Cash at Venue'];

    /** GET — the shares for one booking. Private to the squad. */
    public function index(Request $request, int $id): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $viewerId = (int) $request->query('userId', 0);

        if ($viewerId <= 0) {
            return $this->fail('Invalid booking or player 🔒', 400);
        }

        $booking = Booking::find($id);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        if (! $booking->team_id) {
            return $this->ok(['teamPayments' => []]);
        }

        $isMember = TeamMember::where('team_id', $booking->team_id)->where('user_id', $viewerId)->exists();

        if ((int) $booking->user_id !== $viewerId && ! $isMember) {
            return $this->fail('This team payment is private to the booking squad 🔒', 403);
        }

        $rows = BookingTeamPayment::where('booking_id', $id)->orderBy('id')->get();

        return $this->ok(['teamPayments' => $rows->map(fn (BookingTeamPayment $row) => $this->view($row))->all()]);
    }

    /** POST — record a member's chosen method for their share. */
    public function store(Request $request, int $id): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $userId = (int) $request->input('userId', 0);
        $method = trim((string) $request->input('paymentMethod', ''));

        if ($userId <= 0) {
            return $this->fail('Invalid booking or player 🔒', 400);
        }

        if (! in_array($method, self::METHODS, true)) {
            return $this->fail('Pick eSewa, Khalti, or Cash at Venue 💳', 400);
        }

        $booking = Booking::find($id);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        $venue = $this->venueOf($booking);

        if (! $booking->team_id) {
            return $this->fail('This is not a team booking', 400);
        }

        if (in_array($booking->status, ['cancelled', 'rejected'], true)) {
            return $this->fail('Cancelled bookings cannot collect team payments', 409);
        }

        if ($booking->visibility === 'competition' && $booking->competition_status === 'pending') {
            return $this->fail('Team payment opens after the opposition captain accepts this competition request 🆚', 409);
        }

        if ((bool) $booking->advance_payment_required && $booking->advance_payment_status !== 'paid' && $method === 'Cash at Venue') {
            return $this->fail('Cash at Venue cannot satisfy an unpaid venue advance. Choose eSewa or Khalti first 💳', 409);
        }

        $isMember = TeamMember::where('team_id', $booking->team_id)->where('user_id', $userId)->exists();

        if ((int) $booking->user_id !== $userId && ! $isMember) {
            return $this->fail('Only a member of this booking’s team can choose a share method 🔒', 403);
        }

        $accepted = Loyalty::parsePayments($venue->accepted_payments ?? null);

        if (! in_array($method, $accepted, true)) {
            return $this->fail('This venue accepts '.implode(', ', $accepted).' only 💳', 400);
        }

        $row = BookingTeamPayment::where('booking_id', $id)->where('user_id', $userId)->first();

        if (! $row) {
            return $this->fail('No team share was created for this player', 404);
        }

        if ($row->payment_status === 'paid') {
            return $this->ok(['teamPayment' => $this->view($row)]);
        }

        $amountDue = (int) $row->amount_due;

        // Launching the gateway is deliberately separate: this only records the
        // member's choice. The gateway then verifies the exact stored share and
        // updates this row plus the booking ledger.
        $row->forceFill([
            'payment_method' => $method,
            'payment_status' => $amountDue === 0 ? 'paid' : 'pending',
        ])->save();

        $next = $row->fresh();

        if ($method === 'Cash at Venue' && $venue?->owner_id) {
            Notifier::notify(
                (int) $venue->owner_id,
                'payment',
                '💵 Team member chose cash',
                'A team member selected Cash at Venue for '.Futsal::formatNPR($amountDue).' on booking #FN-'.$id
                .'. Collect it at the desk and record it in the booking ledger.',
                '/admin/requests'
            );
        }

        return $this->ok([
            'teamPayment' => $this->view($next),
            'online' => in_array($method, Loyalty::ONLINE_PAYMENTS, true),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function view(BookingTeamPayment $row): array
    {
        return [
            'id' => $row->id,
            'bookingId' => $row->booking_id,
            'teamId' => $row->team_id,
            'userId' => $row->user_id,
            'amountDue' => (int) $row->amount_due,
            'paymentMethod' => $row->payment_method,
            'paymentStatus' => $row->payment_status,
            'paidAmount' => (int) $row->paid_amount,
            'gatewayTxnId' => $row->gateway_txn_id,
            'esewaUuid' => $row->esewa_uuid,
            'khaltiPidx' => $row->khalti_pidx,
        ];
    }

    private function venueOf(Booking $booking): ?Venue
    {
        $court = Court::find((int) $booking->court_id);

        return $court ? Venue::find((int) $court->venue_id) : null;
    }
}
