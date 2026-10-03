<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\BookingGuestPayment;
use App\Services\ParticipantLedger;
use Illuminate\Support\Facades\DB;
use App\Models\BookingTeamPayment;
use App\Models\TeamLedgerEntry;
use App\Models\TeamMember;
use App\Models\User;
use App\Services\Notifier;
use App\Support\BookingLedger;
use App\Support\Futsal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The captain's ledger for a team booking — `GET/POST /api/bookings/{id}/team-ledger`.
 *
 * A captain fronts the whole cost at the venue and then chases the squad for
 * it. The owner side of a booking solves the same problem with
 * `booking_payments`; this is that idea again, one level down, and it is
 * deliberately a *separate* table (`team_ledger_entries`). The venue's ledger
 * counts what the venue received — once, from the captain — so a captain's
 * collections must never be added to it or the desk would count the same money
 * twice.
 *
 * Every name in the response is resolved from the users table here. The share
 * rows only carry a user_id, and a client asked to render "who still owes what"
 * could only guess at a name; that is how the captain ended up looking at a
 * list of "Player".
 */
class TeamLedgerController extends ApiController
{
    private const ACTIONS = ['collect', 'update', 'void', 'guest', 'voidGuest'];

    /** GET — every squad member, their share, and what they have handed over. */
    public function show(Request $request, int $id): JsonResponse
    {
        $actorId = (int) $request->query('actorId', 0);
        $guard = $this->guardBooking($id, $actorId, true);

        if ($guard instanceof JsonResponse) {
            return $guard;
        }

        [$booking, $isCaptain] = $guard;

        return $this->ok($this->payload($booking, $actorId, $isCaptain));
    }

    /** POST — the captain records money in, or takes back a mistaken line. */
    public function store(Request $request, int $id): JsonResponse
    {
        return DB::transaction(fn () => $this->writeLedger($request, $id));
    }

    private function writeLedger(Request $request, int $id): JsonResponse
    {
        $action = (string) $request->input('action', '');

        if (! in_array($action, self::ACTIONS, true)) {
            return $this->fail('Unknown team ledger action — pick '.implode(', ', self::ACTIONS).' 📋', 400);
        }

        $actorId = (int) $request->input('actorId', 0);
        $guard = $this->guardBooking($id, $actorId, false);

        if ($guard instanceof JsonResponse) {
            return $guard;
        }

        [$booking] = $guard;

        if (in_array($booking->status, ['cancelled', 'rejected'], true)) {
            return $this->fail('This booking is cancelled, so there is nothing left to collect 🔒', 409);
        }

        return match ($action) {
            'update' => $this->updateEntry($booking, $request, $actorId),
            'guest' => $this->guest($booking, $request, $actorId),
            'voidGuest' => $this->voidGuest($booking, $request, $actorId),
            'collect' => $this->collect($booking, $request, $actorId),
            'void' => $this->void($booking, $request, $actorId),
            default => $this->fail('Unhandled action 📋', 400),
        };
    }

    /**
     * Record that one squad member handed something over.
     */
    private function collect(Booking $booking, Request $request, int $actorId): JsonResponse
    {
        $userId = (int) $request->input('userId', 0);
        $method = trim((string) $request->input('method', 'Cash at Venue'));

        if ($userId <= 0) {
            return $this->fail('Which squad member paid? 👥', 400);
        }

        if (! in_array($method, BookingLedger::LEDGER_METHODS, true)) {
            return $this->fail('Record it as eSewa, Khalti, or Cash at Venue 💳', 400);
        }

        $share = BookingTeamPayment::where('booking_id', $booking->id)
            ->where('user_id', $userId)
            ->first();

        if (! $share) {
            return $this->fail('That player has no share on this booking 👥', 404);
        }

        $due = max(0, (int) $share->amount_due);
        $venuePaid = ParticipantLedger::venuePaidBy($booking, $userId);
        // Deliberately measured against receipts, not the share projection: an
        // organizer who paid the whole bill keeps the right to collect each
        // teammate's reimbursement afterwards.
        $outstanding = max(0, $due - $venuePaid - ParticipantLedger::reimbursedToOrganizer($booking, $userId));

        if ($outstanding <= 0) {
            return $this->fail($venuePaid > 0
                ? 'That player already paid the venue directly — nothing left to reimburse 💰'
                : 'That share is already settled — nothing left to record ✅', 409);
        }

        // Default to settling the whole outstanding share; an explicit amount
        // is allowed so a captain can take a part payment, but never more than
        // is owed — an overpayment here would silently make the totals lie.
        if ($request->filled('amount') && filter_var($request->input('amount'), FILTER_VALIDATE_INT) === false) {
            return $this->fail('Enter a whole-rupee amount', 400);
        }

        $amount = $request->filled('amount')
            ? (int) $request->input('amount')
            : $outstanding;

        if ($amount <= 0) {
            return $this->fail('How much did they hand over? 💰', 400);
        }

        if ($amount > $outstanding) {
            return $this->fail(
                'That is more than the '.Futsal::formatNPR($outstanding).' they still owe 💰',
                400
            );
        }

        $entry = TeamLedgerEntry::create([
            'booking_id' => $booking->id,
            'team_id' => (int) $booking->team_id,
            'user_id' => $userId,
            'amount' => $amount,
            'method' => $method,
            'note' => mb_substr((string) $request->input('note', ''), 0, 200),
            'recorded_by' => $actorId,
        ]);

        // Never exceed the share, and never go backwards because a projection
        // already carried part of this money.
        $sources = $venuePaid + ParticipantLedger::reimbursedToOrganizer($booking, $userId);
        $paid = min($due, max((int) $share->paid_amount, $sources));
        $share->forceFill([
            'paid_amount' => $paid,
            'payment_method' => $method,
            'payment_status' => $paid >= (int) $share->amount_due ? 'paid' : 'partial',
        ])->save();

        $person = User::find($userId);

        if ($person) {
            Notifier::notify(
                (int) $person->id,
                'team_payment',
                '💰 '.Futsal::formatNPR($amount).' received',
                'Your organizer recorded '.Futsal::formatNPR($amount).' by '.$method
                    .' for '.($booking->team_name ?: 'the team booking').' on '.$booking->date.'. '
                    .($paid >= (int) $share->amount_due
                        ? 'That settles your share ✅'
                        : Futsal::formatNPR($share->amount_due - $paid).' still to go.'),
                '/bookings?focus='.$booking->id
            );
        }

        BookingLedger::syncCachedState($booking);
        $next = $this->payload($booking->fresh() ?? $booking, $actorId, true);
        $left = $next['totals']['outstanding'];

        $message = $left > 0
            ? 'Recorded '.Futsal::formatNPR($amount).' by '.$method.' from '.($person?->name ?? 'a squad member')
                .' — '.Futsal::formatNPR($left).' still outstanding across the squad 💰'
            : 'Recorded '.Futsal::formatNPR($amount).' by '.$method.' from '.($person?->name ?? 'a squad member')
                .' — the squad is fully settled ✅';

        return $this->ok(['ok' => true, 'entryId' => $entry->id, 'ledger' => $next, 'message' => $message]);
    }

    /**
     * Undo a line the captain keyed in by mistake. Voided, never deleted, so
     * the trail of the correction is itself part of the record.
     */
    private function void(Booking $booking, Request $request, int $actorId): JsonResponse
    {
        $entryId = (int) $request->input('entryId', 0);

        if ($entryId <= 0) {
            return $this->fail('Which entry should be undone? 💰', 400);
        }

        $entry = TeamLedgerEntry::find($entryId);

        if (! $entry || (int) $entry->booking_id !== (int) $booking->id) {
            return $this->fail('That entry is not on this team booking 💰', 404);
        }

        if ($entry->voided_at) {
            return $this->ok([
                'ok' => true,
                'alreadyVoided' => true,
                'ledger' => $this->payload($booking, $actorId, true),
            ]);
        }

        $entry->forceFill(['voided_at' => now(), 'voided_by' => $actorId])->save();

        // Roll the member's share back to what the surviving lines actually say.
        $share = BookingTeamPayment::where('booking_id', $booking->id)
            ->where('user_id', (int) $entry->user_id)
            ->first();

        if ($share) {
            // Remove only this manual contribution, preserving direct venue
            // and gateway payments already reflected in the same share.
            $sources = ParticipantLedger::venuePaidBy($booking, (int) $entry->user_id)
                + ParticipantLedger::reimbursedToOrganizer($booking, (int) $entry->user_id);
            $paid = min((int) $share->amount_due, max(max(0, (int) $share->paid_amount - (int) $entry->amount), $sources));

            $share->forceFill([
                'paid_amount' => $paid,
                'payment_status' => $paid <= 0 ? 'pending' : ($paid >= (int) $share->amount_due ? 'paid' : 'partial'),
            ])->save();
        }

        BookingLedger::syncCachedState($booking);

        return $this->ok([
            'ok' => true,
            'ledger' => $this->payload($booking->fresh() ?? $booking, $actorId, true),
            'message' => 'Entry undone — the share is back to what the ledger actually says ↩️',
        ]);
    }

    /**
     * The whole picture: who owes, who has paid, and every line either way.
     *
     * @return array<string, mixed>
     */
    private function payload(Booking $booking, int $actorId, bool $isCaptain): array
    {
        return ParticipantLedger::payload($booking, $actorId, $isCaptain);
    }

    /** Correct a mistyped manual amount without losing the paper trail. */
    private function updateEntry(Booking $booking, Request $request, int $actorId): JsonResponse
    {
        $entry = TeamLedgerEntry::where('booking_id', $booking->id)->find((int) $request->input('entryId', 0));

        if (! $entry) {
            return $this->fail('That entry is not on this booking 💰', 404);
        }

        if ($entry->voided_at) {
            return $this->fail('That entry was undone — record a new one instead', 409);
        }

        $method = trim((string) $request->input('method', $entry->method));

        if (! in_array($method, BookingLedger::LEDGER_METHODS, true)) {
            return $this->fail('Record it as eSewa, Khalti, or Cash at Venue 💳', 400);
        }

        if ($request->filled('amount') && filter_var($request->input('amount'), FILTER_VALIDATE_INT) === false) {
            return $this->fail('Enter a whole-rupee amount', 400);
        }

        $share = BookingTeamPayment::where('booking_id', $booking->id)->where('user_id', (int) $entry->user_id)->first();

        if (! $share) {
            return $this->fail('That player has no share on this booking 👥', 404);
        }

        $amount = $request->filled('amount') ? (int) $request->input('amount') : (int) $entry->amount;

        if ($amount <= 0) {
            return $this->fail('How much did they hand over? 💰', 400);
        }

        $cap = ParticipantLedger::reimbursementOutstanding($booking, (int) $entry->user_id, (int) $share->amount_due, (int) $entry->id);

        if ($amount > $cap) {
            return $this->fail('That is more than the '.Futsal::formatNPR($cap).' they still owe you 💰', 400);
        }

        $delta = $amount - (int) $entry->amount;
        $entry->forceFill([
            'amount' => $amount,
            'method' => $method,
            'note' => $request->has('note') ? mb_substr((string) $request->input('note'), 0, 200) : $entry->note,
        ])->save();

        $sources = ParticipantLedger::venuePaidBy($booking, (int) $entry->user_id)
            + ParticipantLedger::reimbursedToOrganizer($booking, (int) $entry->user_id);
        $paid = min((int) $share->amount_due, max((int) $share->paid_amount + $delta, $sources));

        $share->forceFill([
            'paid_amount' => $paid,
            'payment_status' => $paid <= 0 ? 'pending' : ($paid >= (int) $share->amount_due ? 'paid' : 'partial'),
        ])->save();

        BookingLedger::syncCachedState($booking);

        return $this->ok([
            'ok' => true,
            'entryId' => (int) $entry->id,
            'ledger' => $this->payload($booking->fresh() ?? $booking, $actorId, true),
            'message' => 'Entry updated — the ledger now says '.Futsal::formatNPR($amount).' ↩️',
        ]);
    }

    private function guest(Booking $booking, Request $request, int $actorId): JsonResponse
    {
        $name = $request->input('playerName');
        if (! is_string($name) || trim($name) === '' || mb_strlen(trim($name)) > 120) {
            return $this->fail('Enter the guest player name (1–120 characters).', 400);
        }
        $error = BookingLedger::validateInstalment($request->input('amount'), $request->input('method'));
        if ($error) return $this->fail($error, 400);
        $entry = BookingGuestPayment::create([
            'booking_id' => $booking->id, 'player_name' => trim($name),
            'amount' => (int) $request->input('amount'), 'method' => $request->input('method'),
            'note' => mb_substr((string) $request->input('note', ''), 0, 200), 'recorded_by' => $actorId,
        ]);
        return $this->ok(['entryId' => $entry->id, 'ledger' => $this->payload($booking, $actorId, true),
            'message' => 'Guest payment saved to the organizer ledger. This is not a venue receipt.'], 201);
    }

    private function voidGuest(Booking $booking, Request $request, int $actorId): JsonResponse
    {
        $entry = BookingGuestPayment::where('booking_id', $booking->id)->find((int) $request->input('entryId'));
        if (! $entry) return $this->fail('Guest entry not found on this booking.', 404);
        if (! $entry->voided_at) $entry->forceFill(['voided_at' => now(), 'voided_by' => $actorId])->save();
        return $this->ok(['ledger' => $this->payload($booking, $actorId, true), 'message' => 'Guest payment voided; history retained.']);
    }

    /** Organizer writes; team members may read. Open-spot names are shown to
     * the organizer without granting strangers access to the squad's finances.
     * @return array{0: Booking, 1: bool}|JsonResponse
     */
    private function guardBooking(int $id, int $actorId, bool $read)
    {
        $booking = $read ? Booking::find($id) : Booking::lockForUpdate()->find($id);
        if ($actorId <= 0) return $this->fail('Sign in to see the player ledger.', 401);
        if (! $booking) return $this->fail('Booking not found', 404);
        $isOrganizer = (int) $booking->user_id === $actorId;
        $isMember = $booking->team_id && TeamMember::where('team_id', $booking->team_id)->where('user_id', $actorId)->exists();
        // Open-spot players are listed for the organizer. They are not granted
        // access to the entire team's private financial history.
        if (! $isOrganizer && (! $read || ! $isMember)) {
            return $this->fail($read ? 'Only the booking organizer and team can view this ledger.' : 'Only the booking organizer can record collections.', 403);
        }
        return [$booking, $isOrganizer];
    }
}
