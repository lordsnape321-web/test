<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\BookingGuestPayment;
use App\Models\BookingPayment;
use App\Models\BookingTeamPayment;
use App\Models\MatchJoin;
use App\Models\OpenMatch;
use App\Models\Team;
use App\Models\TeamLedgerEntry;
use App\Models\TeamMember;
use App\Models\User;
use App\Support\BookingLedger;

/** Read existing payment sources, never copy receipts between ledgers. */
class ParticipantLedger
{
    public static function payload(Booking $booking, int $actorId, bool $canManage): array
    {
        $shares = BookingTeamPayment::where('booking_id', $booking->id)->get()->keyBy('user_id');
        $manual = TeamLedgerEntry::forBooking($booking->id)->orderBy('id')->get();
        $gateway = BookingPayment::where('booking_id', $booking->id)->where('source', 'gateway')->orderBy('id')->get();
        $matches = OpenMatch::where('booking_id', $booking->id)->get()->keyBy('id');
        // Accepted participants are listed even when unpaid. Retain paid withdrawals
        // in the history, but do not treat them as active players owing a fee.
        $joins = MatchJoin::whereIn('match_id', $matches->keys())->where(function ($q) {
            $q->whereIn('status', ['accepted', 'joined'])->orWhere('paid_amount', '>', 0);
        })->get();
        $team = $booking->team_id ? Team::find($booking->team_id) : null;
        $roster = $team ? TeamMember::where('team_id', $team->id)->pluck('user_id') : collect();
        $ids = $roster->merge($shares->keys())->merge($manual->pluck('user_id'))
            ->merge($gateway->pluck('recorded_by'))->merge($joins->pluck('user_id'))
            ->push($booking->user_id)->map(fn ($id) => (int) $id)->unique()->values();
        $guests = BookingGuestPayment::where('booking_id', $booking->id)->orderBy('id')->get();
        $people = User::whereIn('id', $ids->merge($manual->pluck('recorded_by'))->merge($guests->pluck('recorded_by')))->get()->keyBy('id');
        $due = $paid = $outstanding = 0;
        $members = [];
        foreach ($ids as $userId) {
            $person = $people->get($userId);
            $share = $shares->get($userId);
            $entries = [];
            $captainReceived = $venueReceived = 0;
            foreach ($manual->where('user_id', $userId) as $e) {
                $entries[] = self::line($e, 'captain', $userId, $person?->name ?? 'Player', $people, true);
                if (! $e->voided_at) $captainReceived += (int) $e->amount;
            }
            foreach ($gateway->where('recorded_by', $userId) as $e) {
                $entries[] = self::line($e, 'venue', $userId, $person?->name ?? 'Player', $people, false);
                if (! $e->voided_at) $venueReceived += (int) $e->amount;
            }
            // Share paid_amount includes captain collections AND direct payments.
            // Use max, not addition, to avoid counting that projection twice.
            $collected = max((int) ($share?->paid_amount ?? 0), $captainReceived + $venueReceived);
            $unitemized = $collected - $captainReceived - $venueReceived;
            if ($unitemized > 0) {
                $entries[] = [
                    'id' => (int) $share->id, 'source' => 'share', 'canVoid' => false, 'voidedAt' => null,
                    'userId' => $userId, 'userName' => $person?->name ?? 'Player',
                    'amount' => $unitemized, 'method' => $share->payment_method ?: 'Recorded share payment',
                    'note' => 'Stored share payment (no individually attributed receipt available)',
                    'recordedByName' => '', 'createdAt' => $share->updated_at,
                ];
            }
            $amountDue = (int) ($share?->amount_due ?? 0);
            $memberOutstanding = max(0, $amountDue - $collected);
            $venuePaidByMember = self::venuePaidBy($booking, $userId);
            $reimbursedByMember = self::reimbursedToOrganizer($booking, $userId);
            // What this teammate still owes the organizer personally, regardless
            // of how the venue bill was settled.
            $reimbursementOutstanding = max(0, $amountDue - $venuePaidByMember - $reimbursedByMember);
            $openSpots = [];
            foreach ($joins->where('user_id', $userId) as $join) {
                $match = $matches->get($join->match_id);
                if (! $match) continue;
                // The organizer's roster entry represents their crew, not a paid spot.
                if ((int) $match->organizer_id === $userId) continue;
                $active = in_array($join->status, ['accepted', 'joined'], true) && $match->status !== 'cancelled';
                $fee = $active ? max(0, (int) $match->price_per_player) : 0;
                $spotPaid = (int) $join->paid_amount;
                $amountDue += $fee;
                $collected += $spotPaid;
                $memberOutstanding += max(0, $fee - $spotPaid);
                $openSpots[] = ['matchId' => $match->id, 'joinId' => $join->id, 'status' => $join->status, 'position' => $join->position];
                if ($spotPaid > 0) {
                    $entries[] = [
                        'id' => $join->id, 'source' => 'open_spot', 'canVoid' => false, 'voidedAt' => null,
                        'userId' => $userId, 'userName' => $person?->name ?? 'Player',
                        'amount' => $spotPaid, 'method' => $join->pay_method,
                        'note' => 'Open-spot contribution · '.$join->status.' · '.$join->payment_ref,
                        'recordedByName' => $person?->name ?? 'Player', 'createdAt' => $join->paid_at,
                    ];
                }
            }
            $due += $amountDue;
            $paid += $collected;
            $outstanding += $memberOutstanding;
            $members[] = [
                'shareId' => (int) ($share?->id ?? 0), 'userId' => $userId,
                'userName' => $person?->name ?? 'Player', 'userAvatarColor' => $person?->avatar_color ?? '#10B981',
                'userAvatarUrl' => $person?->avatar_url ?? '', 'userLevel' => $person?->level ?? '',
                'isYou' => $userId === $actorId, 'isCaptain' => $userId === (int) $booking->user_id,
                'amountDue' => $amountDue, 'collected' => $collected, 'outstanding' => $memberOutstanding,
                'status' => $memberOutstanding > 0 ? ($collected > 0 ? 'partial' : 'pending') : ($collected > 0 || $amountDue > 0 ? 'paid' : 'none'),
                'declaredMethod' => $share?->payment_method ?? '', 'entries' => $entries, 'openSpots' => $openSpots,
                'shareOutstanding' => $share ? max(0, (int) $share->amount_due - (int) $share->paid_amount) : 0,
                'venuePaid' => $venuePaidByMember, 'reimbursed' => $reimbursedByMember,
                'reimbursementOutstanding' => $reimbursementOutstanding,
            ];
        }
        $guestTotal = (int) $guests->whereNull('voided_at')->sum('amount');
        return [
            'bookingId' => (int) $booking->id, 'date' => $booking->date,
            'teamId' => (int) $booking->team_id, 'teamName' => $booking->team_name ?: ($team?->name ?? 'Booking players'),
            'isCaptain' => $canManage, 'actorId' => $actorId, 'members' => $members,
            'guests' => $guests->map(fn ($g) => [
                'id' => $g->id, 'playerName' => $g->player_name, 'amount' => $g->amount,
                'method' => $g->method, 'note' => $g->note, 'voidedAt' => $g->voided_at,
                'recordedByName' => $people->get($g->recorded_by)?->name ?? 'Booking organizer', 'createdAt' => $g->created_at,
            ])->all(),
            'organizer' => $canManage ? [
                'outOfPocket' => self::organizerOutOfPocket($booking),
                'reimbursed' => self::reimbursedToOrganizer($booking),
                'reimbursable' => max(0, self::organizerOutOfPocket($booking) - self::reimbursedToOrganizer($booking)),
            ] : null,
            // Guest collections do not silently settle another player's debt.
            'totals' => ['due' => $due, 'collected' => $paid, 'outstanding' => $outstanding, 'guestCollected' => $guestTotal],
        ];
    }

    /**
     * Money this player sent to the venue through a gateway.
     *
     * Distinct from `booking_team_payments.paid_amount`, which is a projection
     * that also carries amounts the organizer covered on the player's behalf.
     * Reimbursement must be measured against real receipts, never projections.
     */
    public static function venuePaidBy(Booking $booking, int $userId): int
    {
        return BookingLedger::sumLive(
            BookingPayment::where('booking_id', $booking->id)->where('recorded_by', $userId)->get()
        );
    }

    /** Non-voided manual entries: money handed to the organizer. */
    public static function reimbursedToOrganizer(Booking $booking, ?int $userId = null, ?int $exceptEntryId = null): int
    {
        $query = TeamLedgerEntry::forBooking($booking->id)->whereNull('voided_at');

        if ($userId !== null) {
            $query->where('user_id', $userId);
        }

        if ($exceptEntryId) {
            $query->where('id', '!=', $exceptEntryId);
        }

        return (int) $query->sum('amount');
    }

    /** What this player still owes the organizer for their share. */
    public static function reimbursementOutstanding(Booking $booking, int $userId, int $amountDue, ?int $exceptEntryId = null): int
    {
        return max(0, $amountDue - self::venuePaidBy($booking, $userId) - self::reimbursedToOrganizer($booking, $userId, $exceptEntryId));
    }

    /** What the organizer has actually paid to the venue out of their own pocket. */
    public static function organizerOutOfPocket(Booking $booking): int
    {
        return self::venuePaidBy($booking, (int) $booking->user_id);
    }

    private static function line($entry, string $source, int $userId, string $name, $people, bool $canVoid): array
    {
        return [
            'id' => $entry->id, 'source' => $source, 'canVoid' => $canVoid && ! $entry->voided_at,
            'voidedAt' => $entry->voided_at, 'userId' => $userId, 'userName' => $name,
            'amount' => (int) $entry->amount, 'method' => $entry->method, 'note' => $entry->note ?? '',
            'recordedByName' => $people->get($entry->recorded_by)?->name ?? 'Organizer', 'createdAt' => $entry->created_at,
        ];
    }
}
