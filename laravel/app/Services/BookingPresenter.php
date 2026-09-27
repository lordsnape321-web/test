<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\BookingExtra;
use App\Models\BookingPayment;
use App\Models\BookingPaymentRequest;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\MatchJoin;
use App\Models\OpenMatch;
use App\Models\Team;
use App\Models\TeamMember;
use App\Models\Tournament;
use App\Models\User;
use App\Models\Venue;
use App\Support\BookingLedger;
use App\Support\Loyalty;

/**
 * Turns booking rows into the payload the app renders.
 *
 * A booking card shows the court, the venue, who booked it, that player's
 * reliability, the money that has actually arrived, who still owes what, and —
 * for a competition game — the opposition and the score. Every one of those is
 * another table, so they are loaded here in a handful of queries and stitched
 * together, rather than per booking (the Next.js route did the same: it read
 * each table once and assembled the rows in memory).
 *
 * The money figures come from the ledger, never from `bookings.paid_amount`:
 * the owner and the captain have to see the same numbers as the payment desk.
 */
class BookingPresenter
{
    /**
     * @param  iterable<Booking>  $bookings
     * @return list<array<string, mixed>>
     */
    public static function enrich(iterable $bookings, ?int $viewerId = null): array
    {
        $rows = collect($bookings)->values();

        if ($rows->isEmpty()) {
            return [];
        }

        $bookingIds = $rows->pluck('id')->map(fn ($id) => (int) $id)->unique()->values()->all();

        $courtIds = $rows->pluck('court_id')->filter()->unique()->values()->all();
        $courts = $courtIds === [] ? collect() : Court::whereIn('id', $courtIds)->get()->keyBy('id');

        $venueIds = $courts->pluck('venue_id')->filter()->unique()->values()->all();
        $venues = $venueIds === [] ? collect() : Venue::whereIn('id', $venueIds)->get()->keyBy('id');

        $userIds = $rows->pluck('user_id')->filter()->unique()->values()->all();
        $users = $userIds === [] ? collect() : User::whereIn('id', $userIds)->get()->keyBy('id');

        // Reliability is computed over every booking these players have ever
        // made, not just the rows on this page.
        $histories = $userIds === []
            ? []
            : Booking::whereIn('user_id', $userIds)
                ->get(['user_id', 'status', 'created_at'])
                ->groupBy('user_id')
                ->map(fn ($group) => $group->map(fn ($b) => [
                    'status' => $b->status,
                    'created_at' => $b->created_at,
                ])->all())
                ->all();

        $matches = OpenMatch::whereIn('booking_id', $bookingIds)
            ->where('status', '!=', 'cancelled')
            ->get()
            ->keyBy('booking_id');

        $matchIds = $matches->pluck('id')->all();
        $joinsByMatch = $matchIds === []
            ? []
            : MatchJoin::whereIn('match_id', $matchIds)->get()->groupBy('match_id')->all();

        $teamIds = $rows->pluck('team_id')->filter()->unique()->values()->all();
        $opponentIds = $rows->pluck('opponent_team_id')->filter()->unique()->values()->all();
        $allTeamIds = array_values(array_unique(array_merge($teamIds, $opponentIds)));

        $teams = $allTeamIds === [] ? collect() : Team::whereIn('id', $allTeamIds)->get()->keyBy('id');
        $membersByTeam = $teamIds === []
            ? []
            : TeamMember::whereIn('team_id', $teamIds)->get()->groupBy('team_id')->all();

        $tournamentIds = $rows->pluck('tournament_id')->filter()->unique()->values()->all();
        $tournaments = $tournamentIds === [] ? collect() : Tournament::whereIn('id', $tournamentIds)->get()->keyBy('id');

        $paymentsByBooking = BookingPayment::whereIn('booking_id', $bookingIds)->get()->groupBy('booking_id')->all();
        $extrasByBooking = BookingExtra::whereIn('booking_id', $bookingIds)->get()->groupBy('booking_id')->all();
        $teamPaymentsByBooking = BookingTeamPayment::whereIn('booking_id', $bookingIds)->get()->groupBy('booking_id')->all();
        $requestsByBooking = BookingPaymentRequest::whereIn('booking_id', $bookingIds)->get()->groupBy('booking_id')->all();

        $out = [];

        foreach ($rows as $booking) {
            $out[] = self::present($booking, [
                'viewerId' => $viewerId,
                'courts' => $courts,
                'venues' => $venues,
                'users' => $users,
                'histories' => $histories,
                'matches' => $matches,
                'joinsByMatch' => $joinsByMatch,
                'teams' => $teams,
                'membersByTeam' => $membersByTeam,
                'tournaments' => $tournaments,
                'paymentsByBooking' => $paymentsByBooking,
                'extrasByBooking' => $extrasByBooking,
                'teamPaymentsByBooking' => $teamPaymentsByBooking,
                'requestsByBooking' => $requestsByBooking,
            ]);
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $ctx
     * @return array<string, mixed>
     */
    private static function present(Booking $booking, array $ctx): array
    {
        $id = (int) $booking->id;

        $court = $ctx['courts']->get((int) $booking->court_id);
        $venue = $court ? $ctx['venues']->get((int) $court->venue_id) : null;
        $user = $ctx['users']->get((int) $booking->user_id);

        $trust = (int) ($user->trust_score ?? Loyalty::TRUST_START);
        $stats = Loyalty::playerRating($ctx['histories'][(int) $booking->user_id] ?? [], now(), $trust);

        $ledgerPayments = $ctx['paymentsByBooking'][$id] ?? collect();
        $ledgerExtras = $ctx['extrasByBooking'][$id] ?? collect();

        $totals = BookingLedger::ledgerTotals(
            $booking->total_price,
            $ledgerExtras,
            $ledgerPayments,
            (bool) $booking->settled_at
        );

        // An advance counts as received only up to what has actually landed in
        // the ledger — a partial advance is not a paid one.
        $advanceRequested = (bool) $booking->advance_payment_required
            ? max(0, (int) $booking->advance_payment_amount)
            : 0;

        $advanceReceived = ((bool) $booking->advance_payment_required && $booking->advance_payment_status === 'paid')
            ? min($advanceRequested, $totals['paid'])
            : 0;

        $closed = in_array($booking->status, ['cancelled', 'rejected'], true);

        $advanceReceivable = (! $closed
            && (bool) $booking->advance_payment_required
            && ! in_array($booking->advance_payment_status, ['paid', 'expired'], true))
            ? $advanceRequested
            : 0;

        $paymentSummary = [
            'courtPrice' => $totals['courtPrice'],
            'extrasTotal' => $totals['extrasTotal'],
            'owed' => $totals['owed'],
            'received' => $totals['paid'],
            'receivable' => $totals['balance'],
            'surplus' => $totals['surplus'],
            'byMethod' => $totals['byMethod'],
            'advanceRequested' => $advanceRequested,
            'advanceReceived' => $advanceReceived,
            'advanceReceivable' => $advanceReceivable,
        ];

        // Rows cancelled before the cancellation-money columns existed are
        // enriched from the ledger so they still make sense; new cancellations
        // persist the snapshot in the PATCH/DELETE path.
        $cancellationReceived = $closed
            ? max(0, (int) $booking->cancellation_received_amount, $totals['paid'])
            : max(0, (int) $booking->cancellation_received_amount);

        $cancellationStatus = ($closed && $cancellationReceived > 0 && $booking->cancellation_money_status === 'none')
            ? 'review'
            : $booking->cancellation_money_status;

        $teamId = $booking->team_id ? (int) $booking->team_id : null;
        $opponent = $booking->opponent_team_id ? $ctx['teams']->get((int) $booking->opponent_team_id) : null;
        $league = $booking->tournament_id ? $ctx['tournaments']->get((int) $booking->tournament_id) : null;

        return [
            ...$booking->toArray(),
            'court' => $court?->toArray(),
            'venue' => $venue?->toArray(),
            'user' => $user?->toArray(),
            'playerStats' => $stats,
            'paymentSummary' => $paymentSummary,
            'amountReceived' => $paymentSummary['received'],
            'amountReceivable' => $paymentSummary['receivable'],
            'advanceReceivedAmount' => $paymentSummary['advanceReceived'],
            'advanceReceivableAmount' => $paymentSummary['advanceReceivable'],
            'cancellationMoneyStatus' => $cancellationStatus,
            'cancellationReceivedAmount' => $cancellationReceived,
            'cancellationRefundedAmount' => max(0, (int) $booking->cancellation_refunded_amount),
            'competition' => $booking->visibility === 'competition' ? [
                'opponentTeamId' => $booking->opponent_team_id,
                'opponentName' => $opponent->name ?? '',
                'leagueId' => $booking->tournament_id,
                'leagueName' => $league->name ?? '',
                'homeScore' => $booking->home_score,
                'awayScore' => $booking->away_score,
                'scoreStatus' => $booking->score_status,
                'scoreUpdatedAt' => $booking->score_updated_at,
                'competitionStatus' => $booking->competition_status,
                'paymentMode' => $booking->competition_payment_policy === 'loser_pays' ? 'loser_pays' : 'split',
                'paymentLabel' => $booking->competition_payment_policy === 'loser_pays'
                    ? 'Losing squad pays'
                    : 'Fair split between both squads',
                'opponentCaptainId' => $opponent->captain_id ?? null,
                'isOpponentCaptain' => $ctx['viewerId'] !== null
                    && $opponent !== null
                    && (int) $opponent->captain_id === (int) $ctx['viewerId'],
            ] : null,
            'linkedMatch' => self::linkedMatch($booking, $ctx['matches']->get($id), $ctx['joinsByMatch']),
            'teamPayments' => $teamId === null ? [] : self::teamPayments($id, $ctx['teamPaymentsByBooking'][$id] ?? collect(), $ctx['users']),
            'paymentRequests' => self::paymentRequests($ctx['requestsByBooking'][$id] ?? collect(), $ctx['users']),
            'teamPlayers' => $teamId === null ? [] : self::teamPlayers($teamId, $ctx['membersByTeam'][$teamId] ?? collect(), $ctx['users'], $ctx['teams']),
        ];
    }

    /**
     * The open match a public booking spawned, with its live headcount.
     *
     * @param  array<string, mixed>  $ctx
     * @return array<string, mixed>|null
     */
    private static function linkedMatch(Booking $booking, ?OpenMatch $match, array $joinsByMatch): ?array
    {
        if ($booking->visibility !== 'public' || ! $match) {
            return null;
        }

        $joins = $joinsByMatch[(int) $match->id] ?? collect();
        $crewSize = (int) ($match->crew_size ?? $booking->our_crew ?? 1);
        $otherJoined = $joins->filter(fn ($j) => (int) $j->user_id !== (int) $match->organizer_id)->count();
        $joinedCount = $crewSize + $otherJoined;

        return [
            'id' => $match->id,
            'title' => $match->title,
            'status' => $match->status,
            'joinedCount' => $joinedCount,
            'otherJoined' => $otherJoined,
            'crewSize' => $crewSize,
            'maxPlayers' => (int) $match->max_players,
            'spotsLeft' => max(0, (int) $match->max_players - $joinedCount),
            'pricePerPlayer' => (int) $match->price_per_player,
            'chargeMode' => $match->charge_mode ?? 'split',
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function teamPayments(int $bookingId, mixed $rows, mixed $users): array
    {
        return collect($rows)->map(function (BookingTeamPayment $payment) use ($users) {
            $payer = $users->get((int) $payment->user_id);

            return [
                'id' => $payment->id,
                'teamId' => $payment->team_id,
                'userId' => $payment->user_id,
                'payerName' => $payer->name ?? 'Player',
                'amountDue' => (int) $payment->amount_due,
                'paymentMethod' => $payment->payment_method,
                'paymentStatus' => $payment->payment_status,
                'paidAmount' => (int) $payment->paid_amount,
                'gatewayTxnId' => $payment->gateway_txn_id,
            ];
        })->values()->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function paymentRequests(mixed $rows, mixed $users): array
    {
        return collect($rows)->map(function (BookingPaymentRequest $request) use ($users) {
            $requester = $users->get((int) $request->requested_by);
            $payer = $users->get((int) $request->payer_id);

            return [
                'id' => $request->id,
                'requestedBy' => $request->requested_by,
                'requesterName' => $requester->name ?? 'Captain',
                'payerId' => $request->payer_id,
                'payerName' => $payer->name ?? 'Player',
                'amountDue' => (int) $request->amount_due,
                'purpose' => $request->purpose,
                'note' => $request->note,
                'paymentMethod' => $request->payment_method,
                'status' => $request->status,
                'paidAmount' => (int) $request->paid_amount,
                'gatewayTxnId' => $request->gateway_txn_id,
                'createdAt' => $request->created_at,
                'paidAt' => $request->paid_at,
            ];
        })->values()->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function teamPlayers(int $teamId, mixed $members, mixed $users, mixed $teams): array
    {
        $team = $teams->get($teamId);

        return collect($members)->map(function (TeamMember $member) use ($users, $team) {
            $user = $users->get((int) $member->user_id);

            return [
                'id' => (int) $member->user_id,
                'name' => $user->name ?? 'Player',
                'role' => ($team && (int) $team->captain_id === (int) $member->user_id) ? 'captain' : 'player',
            ];
        })->values()->all();
    }
}
