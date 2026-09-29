<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\BookingTeamPayment;
use App\Models\Team;
use App\Models\TeamLedgerEntry;
use App\Models\TeamMember;
use App\Models\User;
use App\Services\Notifier;
use App\Support\BookingLedger;
use App\Support\TeamStore;
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
    private const ACTIONS = ['collect', 'void'];

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

        $outstanding = max(0, (int) $share->amount_due - (int) $share->paid_amount);

        if ($outstanding <= 0) {
            return $this->fail('That share is already settled — nothing left to record ✅', 409);
        }

        // Default to settling the whole outstanding share; an explicit amount
        // is allowed so a captain can take a part payment, but never more than
        // is owed — an overpayment here would silently make the totals lie.
        $amount = $request->filled('amount')
            ? (int) round((float) $request->input('amount'))
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

        $paid = (int) $share->paid_amount + $amount;
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
                'Your captain recorded '.Futsal::formatNPR($amount).' by '.$method
                    .' for '.($booking->team_name ?: 'the team booking').' on '.$booking->date.'. '
                    .($paid >= (int) $share->amount_due
                        ? 'That settles your share ✅'
                        : Futsal::formatNPR($share->amount_due - $paid).' still to go.'),
                '/bookings?focus='.$booking->id
            );
        }

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
            $paid = (int) TeamLedgerEntry::forBooking($booking->id)
                ->where('user_id', (int) $entry->user_id)
                ->whereNull('voided_at')
                ->sum('amount');

            $share->forceFill([
                'paid_amount' => $paid,
                'payment_status' => $paid <= 0 ? 'pending' : ($paid >= (int) $share->amount_due ? 'paid' : 'partial'),
            ])->save();
        }

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
        $shares = BookingTeamPayment::where('booking_id', $booking->id)->orderBy('id')->get();
        $entries = TeamLedgerEntry::forBooking($booking->id)->orderBy('id')->get();

        $people = User::whereIn('id', $shares->pluck('user_id')->all())->get()->keyBy('id');
        $team = $booking->team_id ? Team::find((int) $booking->team_id) : null;

        $due = 0;
        $paid = 0;

        $members = $shares->map(function (BookingTeamPayment $share) use ($people, $entries, $actorId, &$due, &$paid) {
            $person = $people->get((int) $share->user_id);
            $mine = $entries->filter(
                fn (TeamLedgerEntry $e) => (int) $e->user_id === (int) $share->user_id && ! $e->voided_at
            );

            $amountDue = (int) $share->amount_due;
            $collected = (int) $mine->sum('amount');
            $due += $amountDue;
            $paid += $collected;

            return [
                'shareId' => $share->id,
                'userId' => (int) $share->user_id,
                'userName' => $person?->name ?? 'Player',
                'userAvatarColor' => $person?->avatar_color ?? '#10B981',
                'userAvatarUrl' => $person?->avatar_url ?? '',
                'userLevel' => $person?->level ?? '',
                'isYou' => (int) $share->user_id === $actorId,
                'amountDue' => $amountDue,
                'collected' => $collected,
                'outstanding' => max(0, $amountDue - $collected),
                'status' => $collected <= 0 ? 'pending' : ($collected >= $amountDue ? 'paid' : 'partial'),
                'declaredMethod' => $share->payment_method,
                'entries' => $mine->map(fn (TeamLedgerEntry $e) => $this->entry($e, $people))->values()->all(),
            ];
        })->values()->all();

        return [
            'bookingId' => (int) $booking->id,
            'date' => $booking->date,
            'teamId' => (int) $booking->team_id,
            'teamName' => $booking->team_name ?: ($team?->name ?? 'Your squad'),
            'isCaptain' => $isCaptain,
            'actorId' => $actorId,
            'members' => $members,
            'totals' => [
                'due' => $due,
                'collected' => $paid,
                'outstanding' => max(0, $due - $paid),
            ],
        ];
    }

    /**
     * @param  \Illuminate\Support\Collection<int, \App\Models\User>  $people
     * @return array<string, mixed>
     */
    private function entry(TeamLedgerEntry $entry, $people): array
    {
        $by = $people->get((int) $entry->recorded_by);

        return [
            'id' => $entry->id,
            'userId' => (int) $entry->user_id,
            'userName' => $people->get((int) $entry->user_id)?->name ?? 'Player',
            'amount' => (int) $entry->amount,
            'method' => $entry->method,
            'note' => $entry->note ?? '',
            'recordedByName' => $by?->name ?? 'Captain',
            'createdAt' => $entry->created_at,
        ];
    }

    /**
     * Who may see this ledger, and who may change it.
     *
     * Reading is for the squad; writing is the captain alone. "Captain" means
     * the player who booked it *and* captains that team, so a squad member who
     * booked a pitch for their team is not suddenly able to rewrite the
     * captain's books.
     *
     * @return array{0: Booking, 1: bool}|JsonResponse
     */
    private function guardBooking(int $id, int $actorId, bool $read)
    {
        $booking = Booking::find($id);

        if ($actorId <= 0) {
            return $this->fail('Sign in to see the squad ledger 🔒', 401);
        }

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        if (! $booking->team_id) {
            return $this->fail('This is not a team booking 👥', 400);
        }

        $isMember = TeamMember::where('team_id', $booking->team_id)->where('user_id', $actorId)->exists();
        $captainsBooking = (int) $booking->user_id === $actorId;
        $isCaptain = $captainsBooking && $this->isTeamCaptain((int) $booking->team_id, $actorId);

        if (! $isMember) {
            return $this->fail('Only this booking team can see its ledger 🔒', 403);
        }

        if (! $read && ! $isCaptain) {
            return $this->fail('Only the captain can record what the squad handed over 👑', 403);
        }

        return [$booking, $isCaptain];
    }

    /**
     * One definition of "captain" for the whole app: the squad's captain_id,
     * not a hand-rolled read of team_members.role. Anything else would let the
     * two drift apart and hand the ledger to someone the rest of the product
     * treats as an ordinary squad member.
     */
    private function isTeamCaptain(int $teamId, int $userId): bool
    {
        return TeamStore::isCaptain($teamId, $userId);
    }
}
