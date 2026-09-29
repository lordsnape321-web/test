<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\BookingPayment;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\TeamLedgerEntry;
use App\Models\TeamMember;
use App\Models\User;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\AdvancePayment;
use App\Support\BookingLedger;
use App\Support\Futsal;
use App\Support\Loyalty;
use App\Support\TeamStore;
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

        // One query for the whole squad's names, rather than one per row.
        $people = User::whereIn('id', $rows->pluck('user_id')->all())
            ->get()
            ->keyBy('id')
            ->all();

        return $this->ok([
            'teamPayments' => $rows->map(
                fn (BookingTeamPayment $row) => $this->view($row, $people, (int) $row->user_id === $viewerId)
            )->all(),
        ]);
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
            return $this->ok(['teamPayment' => $this->view($row, $this->people([$row]), (int) $row->user_id === $userId)]);
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
            'teamPayment' => $this->view($next, $this->people([$next]), (int) $next->user_id === $userId),
            'online' => in_array($method, Loyalty::ONLINE_PAYMENTS, true),
        ]);
    }


    /**
     * POST /api/bookings/{id}/team-payments/{userId}/settle
     *
     * A squad member settling their own share, to the captain or to the venue.
     *
     * The money is written to whichever ledger actually received it, and the
     * share is updated from both. That is the point: a member who hands the
     * captain cash and later settles the remainder at the venue is not two
     * separate facts, it is one share paid, and the two payments add up to
     * what is now outstanding. Writing both into the same share is what makes
     * "paid everywhere" register as paid, rather than one ledger showing a
     * payment the other cannot see.
     */
    public function settle(Request $request, int $id, int $userId): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $actorId = (int) $request->input('actorId', $userId);
        $paidTo = (string) $request->input('paidTo', 'captain');
        $method = trim((string) $request->input('method', 'Cash at Venue'));
        $note = mb_substr((string) $request->input('note', ''), 0, 200);

        if (! in_array($paidTo, ['captain', 'venue'], true)) {
            return $this->fail('Say whether this went to the captain or the venue 💰', 400);
        }

        if (! in_array($method, self::METHODS, true)) {
            return $this->fail('Record it as eSewa, Khalti, or Cash at Venue 💳', 400);
        }

        $booking = Booking::find($id);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        if (! $booking->team_id) {
            return $this->fail('This is not a team booking 👥', 400);
        }

        if (in_array($booking->status, ['cancelled', 'rejected'], true)) {
            return $this->fail('This booking is cancelled, so there is nothing to settle 🔒', 409);
        }

        // You may settle your own share. A captain may record a member's on
        // their behalf, which is the same thing the captain's own ledger does
        // from the other side — but nobody may settle somebody else's share
        // without being their captain.
        $isCaptain = (int) $booking->user_id === $actorId
            && TeamStore::isCaptain((int) $booking->team_id, $actorId);

        if ($actorId !== $userId && ! $isCaptain) {
            return $this->fail('You can only settle your own share 👤', 403);
        }

        if (! TeamMember::where('team_id', $booking->team_id)->where('user_id', $userId)->exists()) {
            return $this->fail('That player is not on this booking\'s team 👥', 403);
        }

        $share = BookingTeamPayment::where('booking_id', $booking->id)->where('user_id', $userId)->first();

        if (! $share) {
            return $this->fail('No share was set up for that player on this booking 👥', 404);
        }

        if ($share->payment_status === 'paid') {
            return $this->fail('That share is already settled ✅', 409);
        }

        $outstanding = max(0, (int) $share->amount_due - (int) $share->paid_amount);

        if ($outstanding <= 0) {
            return $this->fail('That share is already settled ✅', 409);
        }

        $amount = $request->filled('amount')
            ? (int) round((float) $request->input('amount'))
            : $outstanding;

        if ($amount <= 0) {
            return $this->fail('How much are you settling? 💰', 400);
        }

        if ($amount > $outstanding) {
            return $this->fail('That is more than the '.Futsal::formatNPR($outstanding).' you still owe 💰', 400);
        }

        // A card payment settles the venue's books; a cash hand-over settles
        // the captain's. Same fact, different counter.
        if ($paidTo === 'venue') {
            BookingPayment::create([
                'booking_id' => $booking->id,
                'amount' => $amount,
                'method' => $method,
                'note' => $note !== '' ? $note : 'Squad member share',
                'source' => 'member',
                'recorded_by' => $actorId,
            ]);
        } else {
            TeamLedgerEntry::create([
                'booking_id' => $booking->id,
                'team_id' => (int) $booking->team_id,
                'user_id' => $userId,
                'amount' => $amount,
                'method' => $method,
                'note' => $note,
                'recorded_by' => $actorId,
            ]);
        }

        $paid = (int) $share->paid_amount + $amount;
        $share->forceFill([
            'paid_amount' => $paid,
            'payment_method' => $method,
            'payment_status' => $paid >= (int) $share->amount_due ? 'paid' : 'partial',
        ])->save();

        // The booking's cached columns follow the players' obligation, which
        // is the shares: paying the captain settles the player exactly as
        // paying the venue does, so both routes refresh the booking state.
        BookingLedger::syncCachedState($booking);

        $person = User::find($userId);
        $left = max(0, (int) $share->amount_due - $paid);

        // The captain is the one who has to chase this, so they hear about it
        // whether the member paid them directly or went around them.
        if ($isCaptain && $userId !== $actorId) {
            Notifier::notify(
                (int) $booking->user_id,
                'team_payment',
                '💰 '.Futsal::formatNPR($amount).' from '.($person?->name ?? 'a squad member'),
                ($person?->name ?? 'A squad member').' settled '.Futsal::formatNPR($amount).' by '.$method
                    .($paidTo === 'captain' ? ', handed to you directly' : ', paid at the venue')
                    .($left > 0 ? ' — '.Futsal::formatNPR($left).' still outstanding.' : ' Their share is clear ✅'),
                '/bookings?focus='.$booking->id
            );
        }

        return $this->ok([
            'ok' => true,
            'teamPayment' => $this->view($share->fresh() ?? $share, $this->people([$share]), $userId === $actorId),
            'message' => $left > 0
                ? 'Settled '.Futsal::formatNPR($amount).' by '.$method.' — '.Futsal::formatNPR($left).' still to go 💰'
                : 'Settled '.Futsal::formatNPR($amount).' by '.$method.' — your share is clear ✅',
        ]);
    }

    /**
     * The share rows, with the player they belong to.
     *
     * The name has to be resolved here, from the users table. The row only
     * stores a user_id, and a client asked to show "who still owes what" had
     * no way to turn that into a person — so it fell back to a generic label
     * and the captain was looking at "Player" instead of their squad.
     *
     * @param  array<int, \Illuminate\Database\Eloquent\Model>  $people
     * @return array<string, mixed>
     */
    private function view(BookingTeamPayment $row, array $people = [], bool $isCaptain = false): array
    {
        $person = $people[(int) $row->user_id] ?? null;

        return [
            'id' => $row->id,
            'bookingId' => $row->booking_id,
            'teamId' => $row->team_id,
            'userId' => $row->user_id,
            'userName' => $person?->name ?? 'Player',
            'userAvatarColor' => $person?->avatar_color ?? '#10B981',
            'userAvatarUrl' => $person?->avatar_url ?? '',
            'userLevel' => $person?->level ?? '',
            'isBookingCaptain' => $isCaptain,
            'amountDue' => (int) $row->amount_due,
            'paymentMethod' => $row->payment_method,
            'paymentStatus' => $row->payment_status,
            'paidAmount' => (int) $row->paid_amount,
            'gatewayTxnId' => $row->gateway_txn_id,
            'esewaUuid' => $row->esewa_uuid,
            'khaltiPidx' => $row->khalti_pidx,
        ];
    }

    /**
     * @param  array<int, mixed>  $rows
     * @return array<int, \App\Models\User>
     */
    private function people(array $rows): array
    {
        $ids = array_values(array_unique(array_map(
            fn ($row) => (int) $row->user_id,
            $rows
        )));

        return User::whereIn('id', $ids)->get()->keyBy('id')->all();
    }

    private function venueOf(Booking $booking): ?Venue
    {
        $court = Court::find((int) $booking->court_id);

        return $court ? Venue::find((int) $court->venue_id) : null;
    }
}
