<?php

namespace App\Services;

use App\Models\Team;
use App\Models\Tournament;
use App\Models\TournamentPayment;
use App\Models\TournamentTeam;
use App\Models\User;
use App\Support\Futsal;
use App\Support\League;
use App\Support\LeagueStore;

/**
 * Recording a league entry-fee payment, whichever door the money came through.
 *
 * Three doors lead here, and they must not disagree with each other:
 *
 *  • a real eSewa payment — the signed blob names the league and squad, and the
 *    booking verify endpoint forwards `LG-…` references to this class;
 *  • a real Khalti payment — the lookup returns the `purchase_order_id` we sent
 *    at initiate, which is the same `LG-…` reference;
 *  • the simulator, used when neither test server can be reached.
 *
 * Every one of them ends in the same three steps: append a ledger row,
 * recalculate the squad's totals (which is what accepts an invitation once the
 * deposit is met), and tell the host. Keeping that in one place is the point —
 * a league must not be settled differently just because a different gateway
 * carried the money.
 */
class LeagueEntry
{
    /**
     * @return array{ok: bool, status?: int, error?: string, replay?: bool, approved?: bool,
     *               txn?: string, paidAmount?: int, depositMet?: bool, due?: int, message?: string}
     */
    public static function settle(int $leagueId, int $teamId, int $amount, string $method, string $reference): array
    {
        $league = Tournament::find($leagueId);

        if (! $league) {
            return ['ok' => false, 'status' => 404, 'error' => 'That league no longer exists 🛡️'];
        }

        $team = Team::find($teamId);
        $row = $team
            ? TournamentTeam::where('tournament_id', $leagueId)->where('team_id', $teamId)->first()
            : null;

        if (! $team || ! $row) {
            return ['ok' => false, 'status' => 404, 'error' => 'That squad isn’t on this league’s list yet 🛡️'];
        }

        if ($row->status === League::TEAM_WITHDRAWN) {
            return ['ok' => false, 'status' => 409, 'error' => "{$team->name} withdrew from this league — re-enter before paying 🏳️"];
        }

        $entryFee = (int) $league->entry_fee;

        /*
         * Idempotency. A player can come back to the return page twice — refresh
         * it, or reopen it from history — and a gateway can retry its callback.
         * The reference the gateway gave us is the key: if it is already on this
         * squad's ledger, answer with the totals instead of charging again.
         */
        if ($reference !== '' && self::alreadyRecorded($leagueId, $teamId, $reference)) {
            $totals = LeagueStore::recalcTeamTotals($leagueId, $teamId);
            $state = self::state($league, $totals);

            return [
                'ok' => true,
                'replay' => true,
                'txn' => $reference,
                'paidAmount' => (int) $totals['paidAmount'],
                'depositMet' => (bool) $state['depositMet'],
                'due' => (int) $state['due'],
                'message' => 'That payment is already on the ledger ✅',
            ];
        }

        // Never record more than the entry fee still owes: a gateway can only
        // be asked for an amount the server signed, but the squad may have paid
        // part of it by cash in the meantime.
        $due = max(0, $entryFee - (int) $row->paid_amount);
        $amount = min($amount, $due);

        if ($amount <= 0) {
            return ['ok' => false, 'status' => 400, 'error' => 'This entry fee is already settled ✅'];
        }

        TournamentPayment::create([
            'tournament_id' => $leagueId,
            'team_id' => $teamId,
            'user_id' => (int) $team->captain_id,
            'kind' => 'entry',
            'amount' => $amount,
            'method' => $method,
            'reference' => mb_substr("{$method} checkout (txn {$reference})", 0, 120),
            'recorded_by' => (int) $team->captain_id,
        ]);

        $row->forceFill(['pay_method' => $method, 'gateway_txn_id' => $reference, 'updated_at' => now()])->save();

        $totals = LeagueStore::recalcTeamTotals($leagueId, $teamId);
        $state = self::state($league, $totals);

        // Paying at least the deposit is what accepts an invitation — the host
        // already said yes, and the money is the captain's yes.
        $approved = false;

        if (($state['depositMet'] ?? false) && $row->status === League::TEAM_INVITED) {
            $row->forceFill([
                'status' => League::TEAM_APPROVED,
                'decided_by' => (int) $team->captain_id,
                'decided_at' => now(),
                'updated_at' => now(),
            ])->save();

            $approved = true;
        }

        $captain = User::find((int) $team->captain_id);

        Notifier::notify(
            (int) $league->host_id,
            'league',
            '💰 '.Futsal::formatNPR($amount)." from {$team->name} via {$method}",
            ($captain->name ?? 'The captain').' cleared '.Futsal::formatNPR($amount)." on the {$league->name} entry fee through {$method} (txn {$reference}). "
            .Futsal::formatNPR((int) $totals['paidAmount']).' of '.Futsal::formatNPR($entryFee).' in — '
            .($state['due'] > 0 ? Futsal::formatNPR((int) $state['due']).' to go.' : 'settled in full 🎉'),
            "/leagues/{$leagueId}"
        );

        return [
            'ok' => true,
            'approved' => $approved,
            'txn' => $reference,
            'paidAmount' => (int) $totals['paidAmount'],
            'depositMet' => (bool) $state['depositMet'],
            'due' => (int) $state['due'],
            'message' => $approved
                ? 'Paid — and you’re in! '.Futsal::formatNPR((int) $totals['paidAmount']).' of '.Futsal::formatNPR($entryFee).' settled 🎉'
                : Futsal::formatNPR($amount)." received via {$method} ✅"
                    .($state['due'] > 0 ? ' '.Futsal::formatNPR((int) $state['due']).' left on the entry fee.' : ''),
        ];
    }

    /** Has this exact gateway transaction already been written to the ledger? */
    private static function alreadyRecorded(int $leagueId, int $teamId, string $reference): bool
    {
        return TournamentPayment::where('tournament_id', $leagueId)
            ->where('team_id', $teamId)
            ->where('reference', 'like', '%'.$reference.'%')
            ->exists();
    }

    /**
     * @param  array<string, mixed>  $totals
     * @return array<string, mixed>
     */
    private static function state(Tournament $league, array $totals): array
    {
        return League::paymentState([
            'entryFee' => (int) $league->entry_fee,
            'paidAmount' => (int) $totals['paidAmount'],
            'refundedAmount' => (int) ($totals['refundedAmount'] ?? 0),
            'depositPercent' => $league->deposit_percent,
            'refundPercent' => $league->refund_percent,
        ]);
    }
}
