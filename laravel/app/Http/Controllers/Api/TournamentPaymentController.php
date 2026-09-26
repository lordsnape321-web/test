<?php

namespace App\Http\Controllers\Api;

use App\Models\Team;
use App\Models\Tournament;
use App\Models\TournamentPayment;
use App\Models\TournamentTeam;
use App\Models\User;
use App\Services\Notifier;
use App\Support\Futsal;
use App\Support\League;
use App\Support\LeagueStore;
use App\Support\Loyalty;
use App\Support\Payments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The league ledger 📒 — `/api/tournaments/{id}/payments`.
 */
class TournamentPaymentController extends ApiController
{
    private const PAY_METHODS = ['eSewa', 'Khalti', 'Cash at Venue'];

    /**
     * GET — the ledger.
     *
     * The host sees every row (that's their bookkeeping). A captain sees their
     * own squad's rows plus the summary line, because "how much have we paid
     * and what comes back if we quit?" is a question a captain is entitled to
     * answer exactly.
     */
    public function index(Request $request, int $id): JsonResponse
    {
        $userId = (int) $request->query('userId', 0) ?: 0;

        $league = Tournament::find($id);

        if (! $league) {
            return $this->fail('League not found 🛡️', 404, ['payments' => []]);
        }

        $all = TournamentPayment::where('tournament_id', $id)->get()
            ->sortByDesc(fn ($p) => $p->created_at?->getTimestamp() ?? 0)
            ->values();

        $allTeams = Team::all()->keyBy('id');
        $memberships = TournamentTeam::where('tournament_id', $id)->get();

        $myTeamIds = $userId > 0
            ? $memberships->filter(fn ($m) => (int) ($allTeams->get((int) $m->team_id)?->captain_id ?? 0) === $userId)
                ->pluck('team_id')->map(fn ($v) => (int) $v)->all()
            : [];

        $isHost = (int) $league->host_id === $userId;

        $rows = $isHost ? $all : $all->filter(fn ($p) => in_array((int) $p->team_id, $myTeamIds, true))->values();

        $squads = $memberships
            ->filter(fn ($m) => $isHost || in_array((int) $m->team_id, $myTeamIds, true))
            ->values()
            ->map(fn ($m) => [
                'teamId' => (int) $m->team_id,
                'teamName' => $allTeams->get((int) $m->team_id)?->name ?? 'Squad',
                'status' => $m->status,
                'paidAmount' => (int) $m->paid_amount,
                'refundedAmount' => (int) $m->refunded_amount,
                'payment' => League::paymentState([
                    'entryFee' => (int) $league->entry_fee,
                    'paidAmount' => (int) $m->paid_amount,
                    'refundedAmount' => (int) $m->refunded_amount,
                    'depositPercent' => $league->deposit_percent,
                    'refundPercent' => $league->refund_percent,
                    'status' => $m->status,
                ]),
            ])->all();

        $collected = (int) $rows->filter(fn ($p) => $p->kind === 'entry')->sum('amount');
        $refunded = (int) $rows->filter(fn ($p) => $p->kind === 'refund')->sum('amount');

        return $this->ok([
            'payments' => $rows->values()->map(fn ($p) => [
                'id' => $p->id,
                'teamId' => $p->team_id,
                'teamName' => $allTeams->get((int) $p->team_id)?->name ?? 'Squad',
                'kind' => $p->kind,
                'amount' => (int) $p->amount,
                'method' => $p->method,
                'reference' => $p->reference,
                'recordedBy' => $p->recorded_by,
                'createdAt' => $p->created_at,
            ])->all(),
            'squads' => $squads,
            'totals' => [
                'collected' => $collected,
                'refunded' => $refunded,
                'prizePool' => (int) $league->prize_pool,
                'deposit' => League::depositFor((int) $league->entry_fee, $league->deposit_percent),
                'entryFee' => (int) $league->entry_fee,
            ],
            'isHost' => $isHost,
        ]);
    }

    /**
     * POST — money moves 💸
     *
     * - `pay`    — a captain settles the entry fee (or any part of it). Paying
     *              at least the deposit is what *locks the place*: an invited
     *              squad becomes approved the moment the money lands.
     * - `record` — the host enters cash handed over at the ground.
     * - `initiate` / `verify` — the same eSewa/Khalti checkout the booking flow
     *              uses, because it is the same money.
     * - `receipt` — attach a screenshot without moving money.
     * - `prize`  — the host pays the winner out of the pool at the end.
     *
     * Payments are simulated (the same test-gateway spirit as the rest of the
     * app): no card is charged, but every row of the ledger is real, dated and
     * attributed.
     */
    public function store(Request $request, int $id): JsonResponse
    {
        $action = (string) $request->input('action', '');

        $league = Tournament::find($id);

        if (! $league) {
            return $this->fail('That league no longer exists 🛡️', 404);
        }

        $teamId = (int) $request->input('teamId', 0);
        $team = Team::find($teamId);

        if (! $team) {
            return $this->fail('Pick a squad first 🛡️', 404);
        }

        $row = TournamentTeam::where('tournament_id', $id)->where('team_id', $teamId)->first();

        if (! $row) {
            return $this->fail('That squad isn’t on this league’s list yet — request or get invited first 📨', 404);
        }

        if ($row->status === League::TEAM_WITHDRAWN) {
            return $this->fail("{$team->name} withdrew from this league — re-enter before paying 🏳️", 409);
        }

        $hostLink = "/leagues/{$id}";
        $host = User::find((int) $league->host_id);
        $captain = User::find((int) $team->captain_id);
        $deposit = League::depositFor((int) $league->entry_fee, $league->deposit_percent);
        $entryFee = (int) $league->entry_fee;

        /* ------------------------------------------------------------- pay */
        if ($action === 'pay') {
            $userId = (int) $request->input('userId', 0);

            if ((int) $team->captain_id !== $userId) {
                return $this->fail('Only '.($captain->name ?? 'the captain')." can pay the entry fee for {$team->name} 👑", 403);
            }

            if ($entryFee <= 0) {
                return $this->fail('This league is free to enter — nothing to pay 🎟️', 400);
            }

            $method = (string) $request->input('method', '');

            if (! in_array($method, self::PAY_METHODS, true)) {
                return $this->fail('Pay by '.implode(', ', self::PAY_METHODS).' 💳', 400);
            }

            $due = max(0, $entryFee - (int) $row->paid_amount);
            $amount = (int) floor((float) $request->input('amount', $due));

            if (! is_finite($amount) || $amount <= 0) {
                return $this->fail('Enter the amount you’re paying 💰', 400);
            }

            if ($amount > $due) {
                return $this->fail('You only have '.Futsal::formatNPR($due).' left to pay on this entry 🙂', 400);
            }

            // The first instalment has to clear the deposit, otherwise "at least
            // 25% up front" means nothing. Later instalments are free-form.
            $isFirst = (int) $row->paid_amount <= 0;

            if ($isFirst && $amount < $deposit) {
                return $this->fail(
                    'The first payment has to be at least the deposit — '.Futsal::formatNPR($deposit)
                    ." ({$league->deposit_percent}% of ".Futsal::formatNPR($entryFee)."). That’s what holds {$team->name}’s place.",
                    400,
                    ['reason' => 'deposit_required']
                );
            }

            // Cash is recorded by the host, not self-served here.
            if (! in_array($method, Loyalty::ONLINE_PAYMENTS, true)) {
                return $this->fail(
                    'Cash is recorded by the host when they receive it — pay online here, or hand it over and ask them to mark it 💵',
                    400
                );
            }

            TournamentPayment::create([
                'tournament_id' => $id,
                'team_id' => $teamId,
                'user_id' => $userId,
                'kind' => 'entry',
                'amount' => $amount,
                'method' => $method,
                'reference' => mb_substr((string) $request->input('reference', ''), 0, 120),
                'recorded_by' => $userId,
            ]);

            // The medium they paid by and any screenshot live on the entry,
            // which is where the host goes looking for proof.
            $receipt = mb_substr((string) $request->input('receiptUrl', ''), 0, 2000000);
            $patch = ['pay_method' => $method, 'updated_at' => now()];

            if ($receipt !== '') {
                $patch['receipt_url'] = $receipt;
            }

            $row->forceFill($patch)->save();

            $totals = LeagueStore::recalcTeamTotals((int) $id, $teamId);

            $state = League::paymentState([
                'entryFee' => $entryFee,
                'paidAmount' => $totals['paidAmount'],
                'refundedAmount' => $totals['refundedAmount'],
                'depositPercent' => $league->deposit_percent,
                'refundPercent' => $league->refund_percent,
            ]);

            // An invitation *is* accepted by paying: the host already said yes,
            // and the money is the captain's yes. A request still needs the
            // host's tap.
            $approved = false;

            if (($state['depositMet'] ?? false) && $row->status === League::TEAM_INVITED) {
                $row->forceFill([
                    'status' => League::TEAM_APPROVED,
                    'decided_by' => $userId,
                    'decided_at' => now(),
                    'updated_at' => now(),
                ])->save();

                $approved = true;
            }

            Notifier::notify(
                (int) $league->host_id,
                'league',
                '💰 '.Futsal::formatNPR($amount)." from {$team->name}",
                ($captain->name ?? 'The captain')." paid {$method} towards {$league->name} — ".Futsal::formatNPR($totals['paidAmount'])
                .' of '.Futsal::formatNPR($entryFee).' in. '
                .($state['depositMet']
                    ? ($state['due'] > 0
                        ? 'Deposit cleared, '.Futsal::formatNPR($state['due']).' to go.'
                        : 'Entry fee fully settled 🎉')
                    : Futsal::formatNPR(max(0, $deposit - $state['paid'])).' short of the deposit, so the place isn’t locked yet.')
                .($approved ? ' Their invite is now accepted.' : ''),
                $hostLink
            );

            return $this->ok([
                'ok' => true,
                'approved' => $approved,
                'paidAmount' => $totals['paidAmount'],
                'depositMet' => $state['depositMet'],
                'message' => $approved
                    ? 'Paid — and you’re in! '.Futsal::formatNPR($totals['paidAmount']).' of '.Futsal::formatNPR($entryFee).' settled 🎉'
                    : ($state['due'] > 0
                        ? 'Paid '.Futsal::formatNPR($amount).' — '.Futsal::formatNPR($state['due']).' left on the entry fee ✅'
                        : 'Entry fee fully paid — all '.Futsal::formatNPR($totals['paidAmount']).' of it 💯'),
            ]);
        }

        /* ---------------------------------------------------------- record */
        if ($action === 'record') {
            $hostId = (int) $request->input('hostId', 0);

            if ((int) $league->host_id !== $hostId) {
                return $this->fail('Only the host can record payments 👑', 403);
            }

            $method = in_array((string) $request->input('method'), self::PAY_METHODS, true)
                ? (string) $request->input('method')
                : 'Cash at Venue';

            $amount = (int) floor((float) $request->input('amount', 0));

            if (! is_finite($amount) || $amount <= 0) {
                return $this->fail('How much did you take? Enter an amount 💵', 400);
            }

            // Same ceiling as a captain paying themselves: the entry fee minus
            // what this squad has paid. A host counting cash at the door
            // shouldn't be able to key in four thousand on a two thousand entry
            // — the ledger would say the squad overpaid and the refund maths
            // would follow it down.
            $owed = max(0, $entryFee - (int) $row->paid_amount);

            if ($amount > $owed) {
                return $this->fail(
                    $owed <= 0
                        ? "{$team->name} has already settled the whole ".Futsal::formatNPR($entryFee).' entry fee — there’s nothing left to record ✅'
                        : "{$team->name} only owes ".Futsal::formatNPR($owed).' — the entry fee is '.Futsal::formatNPR($entryFee)
                            .' and they’ve paid '.Futsal::formatNPR((int) $row->paid_amount).' 🙂',
                    400
                );
            }

            TournamentPayment::create([
                'tournament_id' => $id,
                'team_id' => $teamId,
                'user_id' => $team->captain_id,
                'kind' => 'entry',
                'amount' => $amount,
                'method' => $method,
                'reference' => mb_substr((string) $request->input('reference', ''), 0, 120) ?: 'Recorded by host',
                'recorded_by' => $hostId,
            ]);

            $totals = LeagueStore::recalcTeamTotals((int) $id, $teamId);

            $state = League::paymentState([
                'entryFee' => $entryFee,
                'paidAmount' => $totals['paidAmount'],
                'depositPercent' => $league->deposit_percent,
            ]);

            Notifier::notify(
                (int) $team->captain_id,
                'league',
                '🧾 '.Futsal::formatNPR($amount)." recorded for {$team->name}",
                ($host->name ?? 'The host')." marked your {$method} payment on {$league->name}. "
                .($state['depositMet']
                    ? ($state['due'] > 0 ? Futsal::formatNPR($state['due']).' remains on the entry fee.' : 'Entry fee settled in full 🎉')
                    : Futsal::formatNPR(max(0, $deposit - $state['paid'])).' still needed to clear the deposit.'),
                $hostLink
            );

            return $this->ok([
                'ok' => true,
                'paidAmount' => $totals['paidAmount'],
                'depositMet' => $state['depositMet'],
                'message' => Futsal::formatNPR($amount)." recorded for {$team->name} ✅",
            ]);
        }

        /* -------------------------------------------------------- initiate */
        if ($action === 'initiate') {
            $userId = (int) $request->input('userId', 0);

            if ((int) $team->captain_id !== $userId) {
                return $this->fail('Only '.($captain->name ?? 'the captain')." can pay the entry fee for {$team->name} 👑", 403);
            }

            if ($entryFee <= 0) {
                return $this->fail('This league is free to enter — nothing to pay 🎟️', 400);
            }

            $method = (string) $request->input('method', '');

            if (! in_array($method, Loyalty::ONLINE_PAYMENTS, true)) {
                return $this->fail(
                    'Pick eSewa or Khalti to pay online — cash is recorded by the host when they take it 💵',
                    400
                );
            }

            $due = max(0, $entryFee - (int) $row->paid_amount);

            if ($due <= 0) {
                return $this->fail('This entry fee is already settled ✅', 400);
            }

            $amount = min((int) floor((float) $request->input('amount', $due)), $due);

            if (! is_finite($amount) || $amount <= 0) {
                return $this->fail('Enter the amount you’re paying 💰', 400);
            }

            $origin = Payments::appOrigin($request);
            $backTo = "{$origin}/leagues/{$id}";

            if ($method === 'eSewa') {
                $cfg = Payments::esewaConfig();
                $transactionUuid = Payments::makeLeagueEsewaUuid((int) $id, $teamId);

                $row->forceFill(['pay_method' => $method, 'gateway_txn_id' => '', 'updated_at' => now()])->save();

                $fields = Payments::buildEsewaFields([
                    'amount' => $amount,
                    'transactionUuid' => $transactionUuid,
                    'productCode' => $cfg['productCode'] ?? '',
                    'secretKey' => $cfg['secretKey'] ?? '',
                    'successUrl' => $backTo,
                    'failureUrl' => $backTo,
                ]);

                return $this->ok([
                    'url' => $cfg['formUrl'] ?? '',
                    'fields' => $fields,
                    'amount' => $amount,
                    'transactionUuid' => $transactionUuid,
                    'testMode' => true,
                    'mockUrl' => "{$origin}/payment/esewa/mock?leagueId={$id}&teamId={$teamId}&userId={$userId}&amount={$amount}&uuid=".rawurlencode($transactionUuid),
                    'testHint' => 'eSewa UAT: ID 9806800001 / password 123456 / MPIN 1122 / token 123456',
                ]);
            }

            // Khalti — with the same "no key, or the sandbox is unreachable, so
            // use the simulator" fallback the booking route has.
            $cfg = Payments::khaltiConfig();
            $orderId = Payments::makeLeagueKhaltiOrder((int) $id, $teamId);

            $row->forceFill(['pay_method' => $method, 'gateway_txn_id' => '', 'updated_at' => now()])->save();

            $mockUrl = "{$origin}/payment/khalti/mock?leagueId={$id}&teamId={$teamId}&userId={$userId}&amount={$amount}&pidx=".rawurlencode('mock-'.$orderId);

            if (empty($cfg['secretKey'])) {
                return $this->ok([
                    'mock' => true,
                    'pidx' => 'mock-'.$orderId,
                    'payment_url' => $mockUrl,
                    'amount' => $amount,
                    'orderId' => $orderId,
                    'testHint' => 'Sandbox simulator — no KHALTI_SECRET_KEY set.',
                ]);
            }

            try {
                $init = Payments::khaltiInitiate([
                    'secretKey' => $cfg['secretKey'],
                    'initiateUrl' => $cfg['initiateUrl'] ?? '',
                    'returnUrl' => $backTo,
                    'websiteUrl' => $origin,
                    'amountPaisa' => $amount * 100,
                    'orderId' => $orderId,
                    'orderName' => "{$league->name} — entry fee",
                    'customerName' => $captain->name ?? $team->name,
                    'customerEmail' => $captain->email ?? 'player@futsal.np',
                    'customerPhone' => $captain->phone ?? '9800000000',
                ]);

                return $this->ok([
                    'mock' => false,
                    'pidx' => $init['pidx'] ?? null,
                    'payment_url' => $init['payment_url'] ?? null,
                    'amount' => $amount,
                    'orderId' => $orderId,
                ]);
            } catch (\Throwable) {
                return $this->ok([
                    'mock' => true,
                    'pidx' => 'mock-'.$orderId,
                    'payment_url' => $mockUrl,
                    'amount' => $amount,
                    'orderId' => $orderId,
                    'testHint' => 'Khalti sandbox unreachable — falling back to the local simulator.',
                ]);
            }
        }

        /* ---------------------------------------------------------- verify */
        if ($action === 'verify') {
            $userId = (int) $request->input('userId', 0);

            if ((int) $team->captain_id !== $userId) {
                return $this->fail('That’s not your entry to pay for 👑', 403);
            }

            if ($request->input('mockApprove') !== true && $request->input('mockApprove') !== 'true') {
                return $this->fail('Nothing to verify yet 💳', 400);
            }

            $due = max(0, $entryFee - (int) $row->paid_amount);

            if ($due <= 0) {
                return $this->fail('This entry fee is already settled ✅', 400);
            }

            $amount = min((int) floor((float) $request->input('amount', $due)), $due);
            $method = in_array((string) $request->input('method'), Loyalty::ONLINE_PAYMENTS, true)
                ? (string) $request->input('method')
                : 'eSewa';

            $txn = mb_substr('MOCK-'.mb_strtoupper($method)."-{$id}-{$teamId}-".base_convert((string) now()->timestamp, 10, 36), 0, 100);

            TournamentPayment::create([
                'tournament_id' => $id,
                'team_id' => $teamId,
                'user_id' => $userId,
                'kind' => 'entry',
                'amount' => $amount,
                'method' => $method,
                'reference' => mb_substr("{$method} checkout (txn {$txn})", 0, 120),
                'recorded_by' => $userId,
            ]);

            $row->forceFill(['pay_method' => $method, 'gateway_txn_id' => $txn, 'updated_at' => now()])->save();

            $totals = LeagueStore::recalcTeamTotals((int) $id, $teamId);

            $state = League::paymentState([
                'entryFee' => $entryFee,
                'paidAmount' => $totals['paidAmount'],
                'refundedAmount' => $totals['refundedAmount'],
                'depositPercent' => $league->deposit_percent,
                'refundPercent' => $league->refund_percent,
            ]);

            $approved = false;

            if (($state['depositMet'] ?? false) && $row->status === League::TEAM_INVITED) {
                $row->forceFill([
                    'status' => League::TEAM_APPROVED,
                    'decided_by' => $userId,
                    'decided_at' => now(),
                    'updated_at' => now(),
                ])->save();

                $approved = true;
            }

            Notifier::notify(
                (int) $league->host_id,
                'league',
                '💰 '.Futsal::formatNPR($amount)." from {$team->name} via {$method}",
                ($captain->name ?? 'The captain').' cleared '.Futsal::formatNPR($amount)." on the {$league->name} entry fee through {$method} (txn {$txn}). "
                .Futsal::formatNPR($totals['paidAmount']).' of '.Futsal::formatNPR($entryFee).' in — '
                .($state['due'] > 0 ? Futsal::formatNPR($state['due']).' to go.' : 'settled in full 🎉'),
                $hostLink
            );

            return $this->ok([
                'ok' => true,
                'approved' => $approved,
                'txn' => $txn,
                'paidAmount' => $totals['paidAmount'],
                'depositMet' => $state['depositMet'],
                'message' => $approved
                    ? 'Paid — and you’re in! '.Futsal::formatNPR($totals['paidAmount']).' of '.Futsal::formatNPR($entryFee).' settled 🎉'
                    : Futsal::formatNPR($amount)." received via {$method} ✅".($state['due'] > 0 ? ' '.Futsal::formatNPR($state['due']).' left on the entry fee.' : ''),
            ]);
        }

        /* --------------------------------------------------------- receipt */
        if ($action === 'receipt') {
            $userId = (int) $request->input('userId', 0);

            if ((int) $team->captain_id !== $userId) {
                return $this->fail('Only the captain can attach proof for this entry 👑', 403);
            }

            $receipt = mb_substr((string) $request->input('receiptUrl', ''), 0, 2000000);

            $patch = ['receipt_url' => $receipt, 'updated_at' => now()];

            if ($request->filled('payMethod') && in_array((string) $request->input('payMethod'), self::PAY_METHODS, true)) {
                $patch['pay_method'] = (string) $request->input('payMethod');
            }

            $row->forceFill($patch)->save();

            if ($receipt !== '') {
                Notifier::notify(
                    (int) $league->host_id,
                    'league',
                    "🧾 Payment proof from {$team->name}",
                    ($captain->name ?? 'The captain')." attached a payment screenshot for their {$league->name} entry — worth a look before you approve.",
                    $hostLink
                );
            }

            return $this->ok([
                'ok' => true,
                'message' => $receipt !== ''
                    ? 'Screenshot attached — the host can see it now 🧾'
                    : 'Screenshot removed.',
            ]);
        }

        /* ----------------------------------------------------------- prize */
        if ($action === 'prize') {
            $hostId = (int) $request->input('hostId', 0);

            if ((int) $league->host_id !== $hostId) {
                return $this->fail('Only the host pays out the pool 👑', 403);
            }

            $amount = (int) floor((float) $request->input('amount', 0));

            if (! is_finite($amount) || $amount <= 0) {
                return $this->fail('Enter the prize amount 🏆', 400);
            }

            TournamentPayment::create([
                'tournament_id' => $id,
                'team_id' => $teamId,
                'user_id' => $team->captain_id,
                'kind' => 'prize',
                'amount' => $amount,
                'method' => (string) ($request->input('method') ?: 'Prize payout'),
                'reference' => mb_substr((string) $request->input('reference', ''), 0, 120) ?: 'Prize',
                'recorded_by' => $hostId,
            ]);

            Notifier::notify(
                (int) $team->captain_id,
                'league',
                '🏆 Prize paid — '.Futsal::formatNPR($amount).'!',
                ($host->name ?? 'The host').' paid out '.Futsal::formatNPR($amount)." to {$team->name} from the {$league->name} pool. Congratulations! 🎉",
                $hostLink
            );

            return $this->ok(['ok' => true, 'message' => Futsal::formatNPR($amount).' prize recorded 🏆']);
        }

        return $this->fail('Unknown action — try pay, record or prize 💸', 400);
    }
}
