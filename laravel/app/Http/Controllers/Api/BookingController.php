<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\MatchJoin;
use App\Models\OpenMatch;
use App\Models\Team;
use App\Models\TeamMember;
use App\Models\Tournament;
use App\Models\TournamentTeam;
use App\Models\User;
use App\Models\BookingExtra;
use App\Models\BookingPayment;
use App\Models\Venue;
use App\Models\Voucher;
use App\Services\BookingPresenter;
use App\Services\Notifier;
use App\Support\AdvancePayment;
use App\Support\Futsal;
use App\Support\Loyalty;
use App\Support\PromoStore;
use App\Support\Promos;
use App\Support\TeamStore;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Bookings: create a game, and read them back with everything a card needs.
 */
class BookingController extends ApiController
{
    private const PAY_METHODS = ['eSewa', 'Khalti', 'Cash at Venue', 'Free Play 🎁'];

    private const LEVELS = ['All Levels', 'Beginner', 'Intermediate', 'Advanced'];

    /**
     * GET /api/bookings
     *
     * `?userId=` is the player's own list, `?courtId=`+`?date=` is a court's day
     * (the owner's studio), and no parameter is the whole admin collection.
     */
    public function index(Request $request): JsonResponse
    {
        // There is no scheduler: the request that would read an unpaid advance
        // is the one that expires it.
        AdvancePayment::expireOverdueAdvanceRequests();

        $userIdParam = $request->query('userId');
        $courtIdParam = $request->query('courtId');
        $date = $request->query('date');
        $status = $request->query('status');

        $viewerId = null;

        if ($userIdParam !== null && $userIdParam !== '') {
            if (! is_numeric($userIdParam) || (int) $userIdParam <= 0) {
                return $this->fail('Invalid player 🔒', 400, ['bookings' => []]);
            }

            $viewerId = (int) $userIdParam;
        }

        if ($courtIdParam !== null && $courtIdParam !== '' && (! is_numeric($courtIdParam) || (int) $courtIdParam <= 0)) {
            return $this->fail('Invalid court ⚽', 400, ['bookings' => []]);
        }

        if ($date) {
            $dateError = Validation::dateISO($date, ['label' => 'Date', 'allowPast' => true]);

            if ($dateError) {
                return $this->fail($dateError, 400, ['bookings' => []]);
            }
        }

        $query = Booking::query();

        if ($viewerId === null) {
            // The owner/admin collection must not expose an actionable
            // competition request before the opposition captain consents. The
            // player query below keeps pending rows visible to the two people
            // who can act on them.
            $query->where(function ($q): void {
                $q->where('visibility', '!=', 'competition')
                    ->orWhere('competition_status', '!=', 'pending');
            });
        } else {
            // The opposition captain has to see an incoming competition request
            // even though they did not create the booking, so this is a
            // database-backed inbox query rather than a client-side filter.
            $memberTeamIds = TeamMember::where('user_id', $viewerId)->pluck('team_id')->all();
            $captainedTeamIds = Team::where('captain_id', $viewerId)->pluck('id')->all();

            $query->where(function ($q) use ($viewerId, $memberTeamIds, $captainedTeamIds): void {
                $q->where('user_id', $viewerId);

                if ($memberTeamIds !== []) {
                    $q->orWhereIn('team_id', $memberTeamIds);
                }

                if ($captainedTeamIds !== []) {
                    $q->orWhere(function ($q2) use ($captainedTeamIds): void {
                        $q2->where('visibility', 'competition')
                            ->whereIn('opponent_team_id', $captainedTeamIds);
                    });
                }
            });
        }

        if ($courtIdParam) {
            $query->where('court_id', (int) $courtIdParam);
        }

        if ($date) {
            $query->where('date', $date);
        }

        if ($status) {
            $query->where('status', $status);
        }

        $rows = $query->orderByDesc('created_at')->orderByDesc('id')->get();

        return response()
            ->json(['bookings' => BookingPresenter::enrich($rows, $viewerId)])
            ->header('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    /**
     * POST /api/bookings
     *
     * Three kinds of game, not two:
     *
     * - private     — the crew's own game, nobody else's business.
     * - public      — an open invite; the remaining slots get filled.
     * - competition — a *competitive* fixture between two squads (a league
     *                 round or a friendly both sides are counting), which
     *                 stores the opponent and waits to be scored.
     */
    public function store(Request $request): JsonResponse
    {
        $courtId = (int) $request->input('courtId', 0);
        $userId = (int) $request->input('userId', 0);
        $date = (string) $request->input('date', '');
        $startTime = (string) $request->input('startTime', '');
        $durationHours = $request->input('durationHours', 1);

        $baseError = Validation::firstError(
            $courtId <= 0 ? 'Pick a valid court ⚽' : null,
            $userId <= 0 ? 'Login to book 🔒' : null,
            Validation::dateISO($date, ['label' => 'Game day', 'maxDaysAhead' => 60]),
            Validation::timeHM($startTime, 'Start time'),
            Validation::hours($durationHours ?? 1),
            $request->filled('bookerPhone') ? Validation::phone($request->input('bookerPhone'), ['required' => false]) : null,
            $request->filled('notes') ? Validation::notes($request->input('notes')) : null,
            $request->filled('paymentMethod') && ! in_array((string) $request->input('paymentMethod'), self::PAY_METHODS, true)
                ? 'Pick a valid payment method 💳' : null,
        );

        if ($baseError) {
            return $this->fail($baseError, 400);
        }

        $hours = (int) $durationHours;
        $endTime = (string) ($request->input('endTime') ?: Futsal::addHours($startTime, $hours));
        $timeError = Validation::timeHM($endTime, 'End time');

        if ($timeError) {
            return $this->fail($timeError, 400);
        }

        $booker = User::find($userId);
        $bookerTrust = (int) ($booker->trust_score ?? Loyalty::TRUST_START);
        $myHistory = Booking::where('user_id', $userId)->get(['status', 'created_at'])->toArray();
        $stats = Loyalty::playerRating($myHistory, now(), $bookerTrust);

        if ($stats['blocked']) {
            return $this->fail(
                "Whoa, slow down! 🛑 You’ve cancelled {$stats['cancelsThisMonth']} games this month (limit "
                .Loyalty::CANCEL_LIMIT_PER_MONTH.'). Venues need reliable players — your booking power returns next month. '
                ."Your rating: {$stats['rating']}★",
                403
            );
        }

        $visibility = match ((string) $request->input('visibility')) {
            'public' => 'public',
            'competition' => 'competition',
            default => 'private',
        };

        $ourCrew = max(1, (int) $request->input('ourCrew', 1) ?: 1);
        $openSpots = max(0, (int) $request->input('openSpots', 0) ?: 0);

        if ($visibility === 'public') {
            if (! $request->has('ourCrew') && ! $request->has('openSpots') && $request->filled('playersNeeded')) {
                $total = min(22, max(4, (int) $request->input('playersNeeded') ?: 10));
                $ourCrew = max(1, min($total - 1, (int) ceil($total / 2)));
                $openSpots = $total - $ourCrew;
            }

            $crewError = Validation::firstError(
                Validation::crew($ourCrew, ['min' => 1, 'max' => 21, 'label' => 'Our crew']),
                Validation::crew($openSpots, ['min' => 1, 'max' => 21, 'label' => 'Open spots']),
            );

            if ($crewError) {
                return $this->fail($crewError, 400);
            }

            $ourCrew = min(21, max(1, $ourCrew));
            $openSpots = min(21, max(1, $openSpots));
        } else {
            // Private and competition games are not advertised, so there is
            // nothing to split with strangers and no spots to open.
            $openSpots = 0;
            $ourCrew = 1;
        }

        $playersNeeded = $visibility === 'public' ? min(22, max(4, $ourCrew + $openSpots)) : 0;

        if ($visibility === 'public') {
            $totalError = Validation::totalPlayers($ourCrew + $openSpots);

            if ($totalError) {
                return $this->fail($totalError, 400);
            }

            if ($ourCrew + $openSpots !== $playersNeeded) {
                $openSpots = max(1, $playersNeeded - $ourCrew);
            }
        }

        // Public/open pricing stays on `charge_mode`; a competition's policy has
        // its own column so a public booking's custom per-player price can never
        // be confused with loser-pays.
        $competitionPaymentPolicy = match (true) {
            $visibility !== 'competition' => null,
            $request->input('competitionPaymentMode') === 'loser_pays' => 'loser_pays',
            default => 'split',
        };

        $chargeMode = $request->input('chargeMode') === 'custom' && $visibility === 'public' ? 'custom' : 'split';
        $customPrice = 0;

        if ($visibility === 'public' && $chargeMode === 'custom') {
            $customError = Validation::customPrice($request->input('customPricePerPlayer'), ['total' => 0, 'openSpots' => $openSpots, 'max' => 10000]);

            if ($customError) {
                return $this->fail($customError, 400);
            }

            $customPrice = (int) $request->input('customPricePerPlayer');
        }

        if ($visibility === 'public' && trim((string) $request->input('matchTitle', '')) !== '') {
            $titleError = Validation::title($request->input('matchTitle'), ['min' => 3, 'max' => 60, 'label' => 'Game title']);

            if ($titleError) {
                return $this->fail($titleError, 400);
            }
        }

        if ($visibility === 'public' && $request->filled('level')) {
            $level = (string) $request->input('level');
            $parts = array_values(array_filter(array_map('trim', explode('+', $level)), fn ($p) => $p !== ''));

            if ($level !== 'All Levels' && ($parts === [] || collect($parts)->every(fn ($p) => in_array($p, self::LEVELS, true)) !== true)) {
                return $this->fail('Pick valid levels 🌍🎯', 400);
            }
        }

        // Overlap check against the games already on that court that day.
        $existing = Booking::where('court_id', $courtId)->where('date', $date)->get();
        $clash = $existing->first(fn (Booking $b) => ! in_array($b->status, ['cancelled', 'rejected'], true)
            && Futsal::rangesOverlap($startTime, $endTime, $b->start_time, $b->end_time ?: $b->start_time));

        if ($clash) {
            return $this->fail(
                'Those hours overlap another game ('.Futsal::formatTime12($clash->start_time).'–'
                .Futsal::formatTime12($clash->end_time ?: $clash->start_time).'). Try a free block! 🙏',
                409
            );
        }

        $court = Court::find($courtId);

        if (! $court) {
            return $this->fail('Court not found ⚽', 404);
        }

        // A retired court is off the books: its row stays for history, but
        // nobody can put a new game on it.
        if ($court->deleted_at) {
            return $this->fail('That court has been retired and isn’t taking bookings any more 🪦', 409);
        }

        $hourNum = (int) explode(':', $startTime)[0];
        $rate = $hourNum < 12 ? (int) $court->price_morning : (int) $court->price_per_hour;

        $venue = Venue::find($court->venue_id);
        $venuePayments = Loyalty::parsePayments($venue->accepted_payments ?? null);
        $venueDepositPercent = min(100, max(0, (int) ($venue->deposit_percent ?? 30)));

        // Loyalty free hour 🎁
        $useFreePlay = false;
        $voucherId = null;
        $voucherCode = '';

        if ($request->boolean('useFreePlay') && $venue) {
            $valid = Voucher::where('user_id', $userId)
                ->where('venue_id', $venue->id)
                ->where('status', 'active')
                ->first();

            if (! $valid) {
                return $this->fail('No free-play voucher for this futsal yet — play 7 games in a month to earn one! 🎁', 400);
            }

            $useFreePlay = true;
            $voucherId = $valid->id;
            $voucherCode = (string) $valid->code;
        }

        $fullPrice = $rate * $hours;
        $priceAfterVoucher = $useFreePlay ? max(0, $fullPrice - $rate) : $fullPrice;

        // Squad 🛡️ — membership is verified here rather than trusted from the
        // client, and the name is snapshotted so the booking keeps its label
        // even if the team is renamed or deleted later.
        $teamError = Validation::teamId($request->input('teamId'));

        if ($teamError) {
            return $this->fail($teamError, 400);
        }

        $teamId = null;
        $teamName = '';
        $wantedTeam = (int) $request->input('teamId', 0);

        if ($wantedTeam > 0) {
            $team = TeamStore::findTeamForUser($wantedTeam, $userId);

            if (! $team) {
                return $this->fail('That isn’t one of your teams — pick another, or book just for yourself 🛡️', 400);
            }

            $teamId = $team['id'];
            $teamName = $team['name'];
        }

        // Competition bookings 🏆 — the opponent must exist, and if the game is
        // part of a league then *both* squads must be in it, or "league fixture"
        // would just be a label anybody could type on a Sunday kickabout.
        $opponentTeamId = null;
        $opponentName = '';
        $tournamentId = null;
        $tournamentName = '';
        $scoreStatus = 'none';

        if ($visibility === 'competition') {
            if (! $teamId) {
                return $this->fail('Pick which of your squads is playing — a competition game needs your team on it 🛡️', 400);
            }

            $wantedOpponent = (int) $request->input('opponentTeamId', 0);

            if ($wantedOpponent <= 0) {
                return $this->fail('Pick the squad you’re playing against 🆚', 400);
            }

            if ($wantedOpponent === $teamId) {
                return $this->fail('A squad can’t play itself 🙂', 400);
            }

            $opponent = Team::find($wantedOpponent);

            if (! $opponent) {
                return $this->fail('That opponent squad doesn’t exist 🆚', 400);
            }

            $opponentTeamId = $opponent->id;
            $opponentName = $opponent->name;

            $wantedLeague = (int) $request->input('tournamentId', 0);

            if ($wantedLeague > 0) {
                $league = Tournament::find($wantedLeague);

                if (! $league) {
                    return $this->fail('That league no longer exists 🏆', 400);
                }

                $entries = TournamentTeam::where('tournament_id', $wantedLeague)->get();
                $inLeague = fn (int $id) => $entries->contains(fn ($e) => (int) $e->team_id === $id && $e->status === 'approved');

                if (! $inLeague($teamId) || ! $inLeague($opponentTeamId)) {
                    return $this->fail("{$league->name} runs only fixtures between squads that are in it — both teams need an approved place first 🏆", 400);
                }

                $tournamentId = $league->id;
                $tournamentName = $league->name;
            }

            // The score lifecycle waits at "awaiting"; the separate
            // competition_status column holds the opposition-consent gate.
            $scoreStatus = 'awaiting';
        }

        // Promo code 🎟️ — re-checked here, never trusting the client's maths.
        $promoId = null;
        $promoCode = '';
        $discountAmount = 0;
        $promoMessage = '';
        $wantedCode = Promos::normalizeCode($request->input('promoCode'));

        if ($wantedCode !== '') {
            if (! $venue) {
                return $this->fail('Venue not found 📍', 404);
            }

            if ($priceAfterVoucher <= 0) {
                return $this->fail('Your FREE hour already covers this game — no promo code needed 🎁', 400, ['promoError' => 'nothing_to_discount']);
            }

            $found = PromoStore::findByCode((int) $venue->id, $wantedCode);
            $usedSoFar = $found ? (PromoStore::usage([$found->id])[$found->id] ?? null) : null;

            $check = Promos::check([
                'promo' => $found?->toArray(),
                'code' => $wantedCode,
                'venueName' => $venue->name,
                'subtotal' => $priceAfterVoucher,
                'usedCount' => $usedSoFar['used'] ?? 0,
                'userUsedCount' => $usedSoFar['byUser'][$userId] ?? 0,
            ]);

            if (! ($check['ok'] ?? false) || ! $found) {
                return $this->fail(
                    ($check['ok'] ?? false) ? 'That promo code isn’t available right now 🎟️' : $check['error'],
                    400,
                    ['promoError' => ($check['ok'] ?? false) ? 'unavailable' : $check['reason']]
                );
            }

            $promoId = $found->id;
            $promoCode = $found->code;
            $discountAmount = (int) $check['discount'];
            $promoMessage = (string) $check['message'];
        }

        $totalPrice = max(0, $priceAfterVoucher - $discountAmount);

        // The payment method has to be one the venue accepts; nothing left to
        // pay means no payment is needed at all.
        $payMethod = (string) ($request->input('paymentMethod') ?: ($venuePayments[0] ?? 'eSewa'));
        $isFreeCovered = $totalPrice === 0;

        if ($isFreeCovered) {
            $payMethod = 'Free Play 🎁';
        } elseif (! in_array($payMethod, $venuePayments, true)) {
            return $this->fail('This venue accepts '.implode(', ', $venuePayments).' only — please pick one of those 💳', 400);
        }

        // Fair-play deposit for risky players, skipped when a free hour covers
        // the whole game.
        $depDecision = ($isFreeCovered || $venueDepositPercent <= 0)
            ? ['required' => false, 'percent' => $venueDepositPercent, 'reason' => '']
            : Loyalty::depositDecision(
                ['rating' => $stats['rating'], 'total' => $stats['total'], 'cancelsThisMonth' => $stats['cancelsThisMonth']],
                $bookerTrust,
                $venueDepositPercent
            );

        $depositRequired = $depDecision['required'] && $totalPrice > 0;
        $depositAmount = $depositRequired ? Loyalty::depositAmountFor($totalPrice, $depDecision['percent']) : 0;

        if ($depositRequired) {
            $venueOnline = array_values(array_filter($venuePayments, fn ($m) => in_array($m, Loyalty::ONLINE_PAYMENTS, true)));

            if ($venueOnline !== [] && ! in_array($payMethod, Loyalty::ONLINE_PAYMENTS, true)) {
                return $this->fail(
                    'Fair-play shield 🛡️ — your trust needs a '.$depDecision['percent'].'% upfront deposit ('
                    .Futsal::formatNPR($depositAmount).'), so please pay online via test gateway ('.implode(', ', $venueOnline)
                    .'). Cash can’t hold a deposit 🙂',
                    400
                );
            }
        }

        // Online money starts pending — gateway verification flips it to paid.
        // Cash stays pending until the venue collects it.
        $paymentStatus = $isFreeCovered ? 'paid' : 'pending';

        $booking = null;
        $teamPaymentRows = [];
        $match = null;

        DB::transaction(function () use (
            &$booking, &$teamPaymentRows, &$match, $request, $courtId, $userId, $date, $startTime, $endTime, $hours,
            $totalPrice, $paymentStatus, $payMethod, $visibility, $playersNeeded, $ourCrew, $openSpots,
            $teamId, $teamName, $useFreePlay, $voucherId, $promoId, $promoCode, $discountAmount, $priceAfterVoucher,
            $tournamentId, $opponentTeamId, $scoreStatus, $competitionPaymentPolicy, $chargeMode, $customPrice,
            $depositRequired, $depositAmount, $venue, $court
        ): void {
            $booking = Booking::create([
                'court_id' => $courtId,
                'user_id' => $userId,
                'date' => $date,
                'start_time' => $startTime,
                'end_time' => $endTime,
                'duration_hours' => $hours,
                'total_price' => $totalPrice,
                'status' => 'pending',
                'payment_status' => $paymentStatus,
                'payment_method' => $payMethod,
                'booker_name' => mb_substr(trim((string) $request->input('bookerName', '')), 0, 60),
                'booker_phone' => mb_substr(trim((string) $request->input('bookerPhone', '')), 0, 20),
                'notes' => mb_substr(trim((string) $request->input('notes', '')), 0, 500),
                'visibility' => $visibility,
                'players_needed' => $playersNeeded,
                'our_crew' => $ourCrew,
                'open_spots' => $openSpots,
                'team_id' => $teamId,
                'team_name' => $teamName,
                'receipt_url' => mb_substr((string) $request->input('receiptUrl', ''), 0, 2000000),
                'is_free_play' => $useFreePlay,
                'voucher_id' => $voucherId,
                'promo_id' => $promoId,
                'promo_code' => $promoCode,
                'price_before_discount' => $priceAfterVoucher,
                'discount_amount' => $discountAmount,
                'tournament_id' => $tournamentId,
                'opponent_team_id' => $opponentTeamId,
                'score_status' => $scoreStatus,
                'competition_status' => $visibility === 'competition' ? 'pending' : 'none',
                'competition_payment_policy' => $competitionPaymentPolicy,
                // charge_mode stays reserved for public/open pricing; a
                // competition row's policy lives in competition_payment_policy.
                'charge_mode' => $chargeMode,
                'custom_price_per_player' => $visibility === 'public' && $chargeMode === 'custom' ? $customPrice : 0,
                'deposit_required' => $depositRequired,
                'deposit_amount' => $depositAmount,
                'deposit_status' => $depositRequired ? 'pending' : 'none',
            ]);

            // A private "Just our gang" booking is a shared obligation, not one
            // mysterious charge on the captain's card: every current member gets
            // an equal, rounded share to pay their own way.
            if ($visibility === 'private' && $teamId) {
                $roster = TeamMember::where('team_id', $teamId)->pluck('user_id')->all();

                $memberIds = array_values(array_unique(array_map('intval', $roster)));

                if (! in_array($userId, $memberIds, true)) {
                    $memberIds[] = $userId;
                }

                $count = count($memberIds);
                $baseShare = $count > 0 ? intdiv($totalPrice, $count) : $totalPrice;
                $remainder = max(0, $totalPrice - $baseShare * $count);

                foreach ($memberIds as $memberId) {
                    $amountDue = $baseShare + ($remainder-- > 0 ? 1 : 0);

                    $row = BookingTeamPayment::create([
                        'booking_id' => $booking->id,
                        'team_id' => $teamId,
                        'user_id' => $memberId,
                        'amount_due' => $amountDue,
                        'payment_method' => $memberId === $userId ? $payMethod : '',
                        'payment_status' => $amountDue === 0 ? 'paid' : 'pending',
                        'paid_amount' => 0,
                    ]);

                    $teamPaymentRows[] = ['id' => $row->id, 'userId' => $memberId, 'amountDue' => $amountDue];
                }

                $ownShare = collect($teamPaymentRows)->firstWhere('userId', $userId)['amountDue'] ?? 0;
                $message = "{$teamName} booking at ".($venue->name ?? 'the venue').' on '.Futsal::prettyDate($booking->date)
                    .' at '.Futsal::formatTime12($booking->start_time).' is ready. Your equal share is '
                    .Futsal::formatNPR($ownShare).' — choose eSewa, Khalti, or cash from My Bookings. '
                    ."Each member’s confirmed payment is added to the booking ledger. ⚽";

                foreach ($memberIds as $memberId) {
                    Notifier::notify($memberId, 'payment', "👥 Team payment requested — {$teamName}", $message, '/bookings');
                }
            }

            if ($useFreePlay && $voucherId) {
                Voucher::where('id', $voucherId)->update(['status' => 'used', 'used_booking_id' => $booking->id]);
            }

            if ($visibility === 'public') {
                $venueName = $venue->name ?? 'Futsal Court';
                $title = trim((string) $request->input('matchTitle', '')) ?: "⚡ Open game at {$venueName}";
                $autoPer = $playersNeeded > 0 ? (int) round($booking->total_price / $playersNeeded) : 0;
                $perPlayer = $chargeMode === 'custom' ? $customPrice : max(0, $autoPer);
                $crewLine = $teamId
                    ? "🛡️ {$teamName} • 👥 {$ourCrew} from the squad"
                    : "👥 {$ourCrew} from our crew";

                $match = OpenMatch::create([
                    'title' => $title,
                    'venue_id' => $court->venue_id,
                    'court_id' => $courtId,
                    'organizer_id' => $userId,
                    'booking_id' => $booking->id,
                    'date' => $date,
                    'start_time' => $startTime,
                    'end_time' => $endTime,
                    'price_per_player' => $perPlayer,
                    'max_players' => $playersNeeded,
                    'crew_size' => $ourCrew,
                    'level' => (string) $request->input('level', 'All Levels'),
                    'status' => 'pending',
                    'charge_mode' => $chargeMode,
                    'description' => trim((string) $request->input('matchDescription', '')) ?: ($chargeMode === 'custom'
                        ? "{$crewLine} • 🙋 {$openSpots} open for you! Host set a custom ".Futsal::formatNPR($perPlayer)
                            .' per joiner — listing goes live once the venue accepts! 🤝'
                        : "{$crewLine} • 🙋 {$openSpots} open for you! Court requested by the host — listing goes live once the venue accepts. Split ".Futsal::formatNPR($perPlayer).' each! 🤝'),
                ]);

                MatchJoin::create(['match_id' => $match->id, 'user_id' => $userId]);
            }
        });

        // A competition booking is different from a normal one: the opposition
        // captain must consent first, so the venue owner does not hear about it
        // until they do.
        if ($venue?->owner_id && ! $opponentTeamId) {
            Notifier::notify(
                (int) $venue->owner_id,
                'booking_request',
                "📩 New booking request — {$venue->name}",
                ($booking->booker_name ?: 'A player')." ({$stats['emoji']} {$stats['rating']}★ {$stats['label']}, trust {$bookerTrust}/100) requested "
                    .($court->name ?? 'a court').' on '.Futsal::prettyDate($booking->date).' at '.Futsal::formatTime12($booking->start_time)
                    ." ({$hours} hr, ".Futsal::formatNPR($booking->total_price)
                    .($useFreePlay ? ", 🎁 FREE HOUR {$voucherCode}" : '')
                    .($promoId ? ", 🎟️ {$promoCode} −".Futsal::formatNPR($discountAmount).' (was '.Futsal::formatNPR($priceAfterVoucher).')' : '')
                    .($teamId ? ", 👥 squad {$teamName}" : '')
                    .($depositRequired ? ', 🛡️ '.$depDecision['percent'].'% deposit '.Futsal::formatNPR($depositAmount).' due via test gateway (non-refundable)' : '')
                    .'). Tap to accept or decline.',
                '/admin/requests'
            );

            // Heads-up when this redemption fills the code's cap.
            if ($promoId) {
                $limit = max(0, (int) (\App\Models\Promo::find($promoId)?->usage_limit ?? 0));
                $usedNow = PromoStore::usage([$promoId])[$promoId]['used'] ?? 0;

                if ($limit > 0 && $usedNow >= $limit) {
                    Notifier::notify(
                        (int) $venue->owner_id,
                        'promo',
                        "🏁 {$promoCode} is fully redeemed",
                        "Your promo {$promoCode} at {$venue->name} just hit its {$limit}-booking cap, so players can’t use it any more. "
                            .Futsal::formatNPR($booking->discount_amount).' off this one. Extend the limit or launch a fresh code from My Venues → Promos 🎟️',
                        '/admin/venues'
                    );
                }
            }
        }

        if ($depositRequired) {
            Notifier::notify(
                $userId,
                'payment',
                '🛡️ Deposit due — '.($venue->name ?? 'your game'),
                $visibility === 'competition'
                    ? 'Fair-play shield: '.Futsal::formatNPR($depositAmount).' ('.$depDecision['percent'].'%) deposit will open after the opposition captain accepts this competition request. It’s non-refundable if you cancel — show up and your trust climbs! 💪'
                    : 'Fair-play shield: pay '.Futsal::formatNPR($depositAmount).' ('.$depDecision['percent'].'%) upfront via eSewa/Khalti test to lock this booking. It’s non-refundable if you cancel — show up and your trust climbs! 💪',
                '/bookings'
            );
        }

        if ($opponentTeamId) {
            $opponent = Team::find($opponentTeamId);

            Notifier::notify(
                (int) ($opponent->captain_id ?? 0),
                'info',
                "🆚 Competition request — {$teamName} vs {$opponentName}",
                ($booking->booker_name ?: 'The other captain').' requested '.($court->name ?? 'a court').' at '
                    .($venue->name ?? 'the venue').' for '.Futsal::prettyDate($booking->date).' at '.Futsal::formatTime12($booking->start_time).'.'
                    .($tournamentName ? " It counts towards {$tournamentName}." : '')
                    .' Payment policy: '.($competitionPaymentPolicy === 'loser_pays' ? 'the losing squad pays' : 'fair split between both squads')
                    .'. Open My Bookings to accept or decline. The venue owner is only notified after you accept. ⚽',
                '/bookings'
            );
        }

        return $this->ok([
            'booking' => $booking->toArray(),
            'match' => $match?->toArray(),
            'freePlayUsed' => $useFreePlay,
            'competition' => $opponentTeamId ? [
                'opponentId' => $opponentTeamId,
                'opponentName' => $opponentName,
                'leagueId' => $tournamentId,
                'leagueName' => $tournamentName,
                'paymentMode' => $competitionPaymentPolicy,
            ] : null,
            'depositRequired' => $depositRequired,
            'depositAmount' => $depositAmount,
            'depositPercent' => $depDecision['percent'],
            'promo' => $promoId ? [
                'id' => $promoId,
                'code' => $promoCode,
                'discount' => $discountAmount,
                'message' => $promoMessage,
            ] : null,
            'team' => $teamId ? [
                'id' => $teamId,
                'name' => $teamName,
                'payments' => $teamPaymentRows,
            ] : null,
        ], 201);
    }

    /* ------------------------------------------------------------- PATCH */

    /**
     * PATCH /api/bookings/{id}
     *
     * One route, several decisions: accept or decline a request, cancel a game,
     * mark it played, settle its money, resolve a cancelled booking's money,
     * request an advance, answer a competition request, or record a score. Each
     * is a different job with a different person allowed to do it, so they are
     * handled in order and each returns on its own.
     */
    public function update(Request $request, int $id): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $booking = Booking::find($id);

        if (! $booking) {
            return $this->fail('Booking not found', 404);
        }

        if ($request->filled('status') && ! in_array((string) $request->input('status'), self::VALID_STATUS, true)) {
            return $this->fail('Invalid booking status 📋', 400);
        }

        if ($request->filled('paymentStatus') && ! in_array((string) $request->input('paymentStatus'), self::VALID_PAY_STATUS, true)) {
            return $this->fail('Invalid payment status 💰', 400);
        }

        if ($request->filled('paymentMethod') && ! in_array((string) $request->input('paymentMethod'), self::VALID_PAY_METHOD, true)) {
            return $this->fail('Pick a valid payment method 💳', 400);
        }

        if ($request->filled('actor') && ! in_array((string) $request->input('actor'), ['owner', 'player'], true)) {
            return $this->fail('Invalid actor 👤', 400);
        }

        if ($request->has('receiptUrl') && ! is_string($request->input('receiptUrl'))) {
            return $this->fail('Receipt must be an image 🧾', 400);
        }

        if ($request->filled('depositStatus') && ! in_array((string) $request->input('depositStatus'), self::VALID_DEPOSIT_STATUS, true)) {
            return $this->fail('Invalid deposit status 🛡️', 400);
        }

        $prev = $booking->getAttributes();

        if ($request->input('actor') === 'player' && $request->has('actorId') && (int) $request->input('actorId') !== (int) $prev['user_id']) {
            return $this->fail('Only the booking player can change this payment choice 🔒', 403);
        }

        // An unpaid owner-requested advance freezes the money columns: cash is
        // not an answer to "pay the advance first".
        if ((bool) $prev['advance_payment_required'] && $prev['advance_payment_status'] !== 'paid') {
            if ($request->has('paymentMethod') && ! in_array((string) $request->input('paymentMethod'), ['eSewa', 'Khalti'], true)) {
                return $this->fail('Pay the venue advance with eSewa or Khalti first. Cash at venue opens after the advance is received 💳', 409);
            }

            if ($request->has('paymentStatus') || $request->has('depositStatus')) {
                return $this->fail('The booking cannot be marked paid or settled until the requested advance is gateway-verified 💳', 409);
            }
        }

        if ($advance = $this->handleAdvanceRequest($booking, $prev, $request)) {
            return $advance;
        }

        if ($competition = $this->handleCompetitionDecision($booking, $prev, $request)) {
            return $competition;
        }

        if ($score = $this->applyCompetitionScore($booking, $prev, $request)) {
            return $score;
        }

        $actor = $request->input('actor') === 'owner' ? 'owner' : 'player';

        if ($money = $this->handleCancellationMoney($booking, $prev, $request, $actor)) {
            return $money;
        }

        if ($actor === 'owner' && $request->input('status') === 'confirmed'
            && (bool) $prev['advance_payment_required'] && $prev['advance_payment_status'] !== 'paid') {
            return $this->fail('Keep this request pending until the requested advance is received by the venue 💳', 409);
        }

        if ($prev['visibility'] === 'competition' && $request->input('status') === 'cancelled'
            && $actor === 'player' && (int) $request->input('actorId', 0) !== (int) $prev['user_id']) {
            return $this->fail('Only the competition booking player can cancel this request 🔒', 403);
        }

        if ($prev['visibility'] === 'competition' && $prev['competition_status'] === 'accepted'
            && in_array($request->input('status'), ['confirmed', 'rejected'], true)) {
            ['venue' => $venue] = $this->venueOf($prev);

            if ($actor !== 'owner' || (int) $request->input('actorId', 0) !== (int) ($venue->owner_id ?? 0)) {
                return $this->fail('Only the venue owner can decide this released competition booking 🔒', 403);
            }
        }

        // A venue decision must never bypass opposition consent: the only legal
        // way out of "pending" is the authenticated captain action above.
        if ($prev['visibility'] === 'competition' && $prev['competition_status'] === 'pending'
            && in_array($request->input('status'), ['confirmed', 'rejected'], true)) {
            return $this->fail('Waiting for the opposition captain to accept this competition request first 🆚', 409);
        }

        if ($prev['visibility'] === 'competition' && $prev['competition_status'] === 'pending'
            && collect(['paymentStatus', 'paymentMethod', 'depositStatus', 'receiptUrl'])->contains(fn ($f) => $request->has($f))) {
            return $this->fail('Competition payment and receipts open only after the opposition captain accepts 🆚', 409);
        }

        /*
         * A played game is locked. Once the whistle has gone the booking is
         * history: a player cannot cancel it, re-price it, change how it was
         * paid, or attach a receipt. The UI hides those controls; this is the
         * same rule enforced where it counts. The venue owner is exempt —
         * marking a game completed, settling a payment and recording a score all
         * happen after kickoff and are the owner's job.
         */
        if ($actor === 'player' && Futsal::gamePlayed($prev)) {
            $touching = collect(['status', 'paymentStatus', 'paymentMethod', 'depositStatus', 'receiptUrl'])
                ->filter(fn ($k) => $request->has($k))
                ->all();

            if ($touching !== []) {
                return $this->fail('That game is already played 🔒 — the booking is locked, so nothing on it can be changed now.', 409);
            }
        }

        /*
         * A settled booking is final. The ledger refuses changes once the
         * correction window closes — but it is not the only door onto these
         * columns. Without this an owner could flip `paymentStatus` back to
         * "pending" through this route and quietly undo a settlement the ledger
         * had locked, which is exactly the trust the lock exists to give the
         * day's takings. Inside the window these stay editable, so the
         * correction path still works.
         */
        $win = BookingLedger::settleWindow($prev['settled_at'] ?? null);

        if ($win['settled'] && ! $win['editable']) {
            $touching = collect(['paymentStatus', 'paymentMethod', 'depositStatus', 'receiptUrl'])
                ->filter(fn ($k) => $request->has($k))
                ->all();

            if ($touching !== []) {
                return $this->fail(
                    'This booking was settled more than '.(BookingLedger::SETTLE_EDIT_WINDOW_MS / 60000)
                    .' minutes ago — its payment details are locked so the day’s takings stay trustworthy 🔒',
                    409,
                    ['reason' => 'ledger_locked', 'settledAt' => $prev['settled_at'] ?? null]
                );
            }
        }

        // Fair play: a player cannot cancel inside six hours of kickoff.
        if ($request->input('status') === 'cancelled' && $prev['status'] !== 'cancelled' && $actor === 'player') {
            $hrsLeft = Loyalty::hoursUntilGame((string) $prev['date'], (string) $prev['start_time']);

            if ($hrsLeft < Loyalty::CANCEL_CUTOFF_HOURS && $hrsLeft > -48) {
                $left = $hrsLeft < 0
                    ? 'the past'
                    : max(0, (int) floor($hrsLeft)).'h '.(int) round(fmod($hrsLeft, 1) * 60).'m';

                return $this->fail(
                    "Too late to cancel 😢 — the game starts in {$left}. Free cancellation closes "
                    .Loyalty::CANCEL_CUTOFF_HOURS."h before kickoff so venues aren’t left hanging. Please call the venue directly! 📞",
                    400
                );
            }
        }

        // Snapshot the ledger at cancellation time and persist it, so Owner
        // Studio can explain a cancelled paid booking without reconstructing a
        // refund decision in application code.
        $closing = in_array($request->input('status'), ['cancelled', 'rejected'], true)
            && $prev['status'] !== $request->input('status');

        $cancellationReceived = $closing ? $this->receivedForBooking((int) $id, (int) $prev['total_price']) : 0;

        $changes = [];

        if ($request->filled('status')) {
            $changes['status'] = (string) $request->input('status');
        }

        if ($request->filled('paymentStatus')) {
            $changes['payment_status'] = (string) $request->input('paymentStatus');
        }

        if ($request->filled('paymentMethod')) {
            $changes['payment_method'] = (string) $request->input('paymentMethod');
        }

        if ($request->filled('depositStatus')) {
            $changes['deposit_status'] = (string) $request->input('depositStatus');
        }

        if ($request->has('receiptUrl')) {
            $changes['receipt_url'] = mb_substr((string) $request->input('receiptUrl'), 0, 2000000);
        }

        if ($request->input('status') === 'cancelled' && $prev['visibility'] === 'competition' && $prev['competition_status'] === 'pending') {
            $changes['competition_status'] = 'cancelled';
        }

        if ($closing) {
            $changes['cancellation_money_status'] = $cancellationReceived > 0 ? 'review' : 'none';
            $changes['cancellation_received_amount'] = $cancellationReceived;
            $changes['cancellation_refunded_amount'] = 0;
            $changes['cancellation_money_resolved_at'] = null;
            $changes['cancellation_money_resolved_by'] = null;
        }

        if ($changes !== []) {
            $booking->forceFill($changes)->save();
        }

        $next = $booking->fresh();
        ['court' => $court, 'venue' => $venue] = $this->venueOf($next->getAttributes());
        $when = Futsal::prettyDate($next->date).' at '.Futsal::formatTime12($next->start_time);
        $where = $venue->name ?? 'the venue';

        // Owner accepts a pending request → confirmed, and the listing goes live.
        if ($request->input('status') === 'confirmed' && $prev['status'] === 'pending') {
            OpenMatch::where('booking_id', $id)->update(['status' => 'open']);

            Notifier::notify(
                (int) $next->user_id,
                'booking_confirmed',
                "✅ Booking confirmed — {$where}",
                'Your '.($court->name ?? 'court')." booking for {$when} was accepted by the venue. See you on the turf!",
                '/bookings'
            );

            if ($venue) {
                $this->checkLoyalty((int) $next->user_id, (int) $venue->id, (string) $venue->name);
            }
        }

        // Owner marks the game played → loyalty counts again.
        if ($request->input('status') === 'completed' && $prev['status'] !== 'completed') {
            if ($venue) {
                $this->checkLoyalty((int) $next->user_id, (int) $venue->id, (string) $venue->name);
            }

            $trust = $this->adjustTrust((int) $next->user_id, 'complete');
            $label = $trust ? Loyalty::trustLabel($trust['after']) : null;

            Notifier::notify(
                (int) $next->user_id,
                'info',
                "🎉 Hope you had a blast at {$where}!",
                'How was your game? Drop a quick review with stars + a message — it helps the venue and other players! ⭐'
                .($trust ? " Trust {$trust['before']} → {$trust['after']} (+".Loyalty::TRUST_COMPLETE_BOOST.") {$label['emoji']} — keep showing up! 💪" : ''),
                '/bookings'
            );
        }

        // Owner declines → rejected, and the listing is pulled.
        if ($request->input('status') === 'rejected') {
            OpenMatch::where('booking_id', $id)->update(['status' => 'cancelled']);

            Notifier::notify(
                (int) $next->user_id,
                'booking_rejected',
                "❌ Booking declined — {$where}",
                'Sorry, the venue couldn’t accommodate your '.($court->name ?? 'court')." request for {$when}. Please try another slot.",
                '/bookings'
            );
        }

        if ($request->input('status') === 'cancelled' && $prev['status'] !== 'cancelled') {
            OpenMatch::where('booking_id', $id)->update(['status' => 'cancelled']);

            // Cancelling a free-play booking gives the voucher back.
            if ((bool) $prev['is_free_play'] && $prev['voucher_id']) {
                Voucher::where('id', $prev['voucher_id'])->update(['status' => 'active', 'used_booking_id' => null]);
            }

            $cancelledByOwner = $request->input('actor') === 'owner';
            $depositAmount = (int) ($prev['deposit_amount'] ?? 0);
            $hadDeposit = ($prev['deposit_status'] ?? null) === 'paid' && $depositAmount > 0;

            if ($cancelledByOwner) {
                // The player did nothing wrong: refund the deposit, no trust hit.
                if ($hadDeposit) {
                    $next->forceFill(['deposit_status' => 'refunded'])->save();
                }

                Notifier::notify(
                    (int) $next->user_id,
                    'booking_cancelled',
                    "🚫 Booking cancelled — {$where}",
                    'Your '.($court->name ?? 'court')." booking for {$when} was cancelled by the venue."
                    .($hadDeposit ? ' Your '.Futsal::formatNPR($depositAmount).' deposit will be refunded 💸' : '')
                    .($cancellationReceived > 0 ? ' '.Futsal::formatNPR($cancellationReceived).' was already received; the venue will record the refund decision in Owner Studio.' : '')
                    .' No trust lost — not your fault! 💛',
                    '/bookings'
                );
            } else {
                $trust = $this->adjustTrust((int) $next->user_id, 'cancel');

                if ($hadDeposit) {
                    $next->forceFill(['deposit_status' => 'forfeited'])->save();
                }

                // A competition request that never reached the owner stays out of
                // the owner's notification stream when the booker cancels it.
                if ($venue?->owner_id && ! ($prev['visibility'] === 'competition' && $prev['competition_status'] === 'pending')) {
                    Notifier::notify(
                        (int) $venue->owner_id,
                        'booking_cancelled',
                        '🚫 Booking cancelled — '.($next->booker_name ?: 'Player'),
                        ($court->name ?? 'Court')." on {$when} was cancelled by the player. The slot is free again."
                        .($hadDeposit ? ' Non-refundable deposit kept: '.Futsal::formatNPR($depositAmount).' 🛡️' : '')
                        .($cancellationReceived > 0 ? ' Received money: '.Futsal::formatNPR($cancellationReceived).' — review the refund decision in Owner Studio.' : ''),
                        '/admin/bookings'
                    );
                }

                if ($prev['visibility'] === 'competition' && $prev['competition_status'] === 'pending' && $prev['opponent_team_id']) {
                    $opponent = Team::find($prev['opponent_team_id']);

                    if ($opponent?->captain_id) {
                        Notifier::notify(
                            (int) $opponent->captain_id,
                            'info',
                            '🚫 Competition request cancelled',
                            ($next->booker_name ?: 'The other captain')." cancelled the {$opponent->name} fixture for {$when}. It no longer needs your decision.",
                            '/bookings'
                        );
                    }
                }

                Notifier::notify(
                    (int) $next->user_id,
                    'booking_cancelled',
                    "🚫 You cancelled — {$where}",
                    'Your '.($court->name ?? 'court')." booking for {$when} is cancelled."
                    .($hadDeposit ? ' Your '.Futsal::formatNPR($depositAmount).' deposit is forfeited (non-refundable) 😢.' : '')
                    .($cancellationReceived > 0 ? ' '.Futsal::formatNPR($cancellationReceived).' was received before cancellation; the venue will show whether it was refunded or retained.' : '')
                    .' Heads up: 3+ cancels in a month pauses new bookings, and it lowers your reliability stars ⭐'
                    .($trust ? " Trust {$trust['before']} → {$trust['after']} (−".Loyalty::TRUST_CANCEL_PENALTY.').' : '')
                    .' Play on!',
                    '/bookings'
                );
            }
        }

        if ($request->input('paymentStatus') === 'paid' && $prev['payment_status'] !== 'paid') {
            Notifier::notify(
                (int) $next->user_id,
                'payment',
                "💰 Payment received — {$where}",
                'Your payment for '.($court->name ?? 'court')." on {$when} is confirmed. Receipt available in My Bookings.",
                '/bookings'
            );
        }

        if ($request->input('paymentStatus') === 'deposit_paid' && $prev['payment_status'] !== 'deposit_paid') {
            Notifier::notify(
                (int) $next->user_id,
                'payment',
                "🛡️ Deposit confirmed — {$where}",
                'Your upfront deposit for '.($court->name ?? 'court')." on {$when} is confirmed. Pay the rest at the venue — and show up to grow trust! 💪",
                '/bookings'
            );
        }

        return $this->ok(['booking' => $next->toArray()]);
    }

    /* ------------------------------------------------------------ DELETE */

    /**
     * DELETE /api/bookings/{id}
     *
     * Cancelling through this route is the same cancellation as PATCH, minus the
     * actor: the app uses it from the player's own list, where there is only one
     * person who could be asking.
     */
    public function destroy(int $id): JsonResponse
    {
        AdvancePayment::expireOverdueAdvanceRequests();

        $prev = Booking::find($id);

        if (! $prev) {
            return $this->fail('Booking not found', 404);
        }

        if (Futsal::gamePlayed($prev->getAttributes())) {
            return $this->fail('That game is already played 🔒 — the booking is locked and can’t be cancelled.', 409);
        }

        $received = $this->receivedForBooking((int) $id, (int) $prev->total_price);

        $changes = [
            'status' => 'cancelled',
            'cancellation_money_status' => $received > 0 ? 'review' : 'none',
            'cancellation_received_amount' => $received,
            'cancellation_refunded_amount' => 0,
            'cancellation_money_resolved_at' => null,
            'cancellation_money_resolved_by' => null,
        ];

        if ($prev->visibility === 'competition' && $prev->competition_status === 'pending') {
            $changes['competition_status'] = 'cancelled';
        }

        $prev->forceFill($changes)->save();

        OpenMatch::where('booking_id', $id)->update(['status' => 'cancelled']);

        if ($prev->visibility === 'competition' && $prev->competition_status === 'pending' && $prev->opponent_team_id) {
            $opponent = Team::find($prev->opponent_team_id);

            if ($opponent?->captain_id) {
                Notifier::notify(
                    (int) $opponent->captain_id,
                    'info',
                    '🚫 Competition request cancelled',
                    'The competition booking for '.Futsal::prettyDate($prev->date).' at '.Futsal::formatTime12($prev->start_time)
                    .' was cancelled. It no longer needs your decision.',
                    '/bookings'
                );
            }
        }

        return $this->ok(['ok' => true]);
    }

    /* ----------------------------------------------------------- helpers */

    private const VALID_STATUS = ['pending', 'confirmed', 'completed', 'cancelled', 'rejected'];

    private const VALID_PAY_STATUS = ['pending', 'paid', 'deposit_paid'];

    private const VALID_PAY_METHOD = ['eSewa', 'Khalti', 'Cash at Venue', 'Free Play 🎁'];

    private const VALID_DEPOSIT_STATUS = ['none', 'pending', 'paid', 'forfeited', 'refunded'];

    /**
     * The court and venue a booking sits on.
     *
     * @param  array<string, mixed>  $booking
     * @return array{court: Court|null, venue: Venue|null}
     */
    private function venueOf(array|Booking $booking): array
    {
        $booking = is_array($booking) ? $booking : $booking->getAttributes();

        $court = Court::find((int) ($booking['court_id'] ?? 0));

        return [
            'court' => $court,
            'venue' => $court ? Venue::find((int) $court->venue_id) : null,
        ];
    }

    /** What has actually landed in the ledger, recomputed from its rows. */
    private function receivedForBooking(int $bookingId, int $totalPrice): int
    {
        $payments = BookingPayment::where('booking_id', $bookingId)->get();
        $extras = BookingExtra::where('booking_id', $bookingId)->get();

        return BookingLedger::ledgerTotals($totalPrice, $extras, $payments)['paid'];
    }

    /**
     * Loyalty: every 7 paid games at one venue in a month earns a free hour.
     *
     * Counted from bookings rather than a counter, so a cancelled game stops
     * counting the moment it is cancelled.
     */
    private function checkLoyalty(int $userId, int $venueId, string $venueName): array
    {
        $month = Loyalty::monthKey();
        $userBookings = Booking::where('user_id', $userId)->get();

        $courtIds = $userBookings->pluck('court_id')->filter()->unique()->all();
        $venueByCourt = $courtIds === []
            ? collect()
            : Court::whereIn('id', $courtIds)->get()->keyBy('id');

        $mineHere = $userBookings->filter(function (Booking $b) use ($venueId, $month, $venueByCourt) {
            if (! in_array($b->status, ['confirmed', 'completed'], true) || (bool) $b->is_free_play) {
                return false;
            }

            $court = $venueByCourt->get((int) $b->court_id);

            if (! $court || (int) $court->venue_id !== $venueId) {
                return false;
            }

            return $b->created_at && Loyalty::monthKey($b->created_at) === $month;
        });

        $count = $mineHere->count();
        $existing = Voucher::where('user_id', $userId)->where('venue_id', $venueId)->where('month', $month)->count();
        $earned = intdiv($count, Loyalty::LOYALTY_TARGET);

        if ($earned > $existing) {
            $code = 'FREE-'.$venueId.'-'.str_replace('-', '', $month).'-'.($existing + 1);

            Voucher::create([
                'user_id' => $userId,
                'venue_id' => $venueId,
                'month' => $month,
                'code' => $code,
                'status' => 'active',
            ]);

            Notifier::notify(
                $userId,
                'free_play',
                "🎁 FREE HOUR earned at {$venueName}!",
                "You played {$count} games there this month — loyal legend! 🏆 Your free 1-hour voucher ({$code}) is ready. Use it on your next booking!",
                '/profile'
            );

            return ['earned' => true, 'count' => $count, 'code' => $code];
        }

        // Nudge at 4 and 6, while the target is still in reach.
        if (in_array($count, [4, 6], true) && $earned === $existing) {
            Notifier::notify(
                $userId,
                'info',
                '🔥 '.(Loyalty::LOYALTY_TARGET - $count)." more for a FREE hour at {$venueName}",
                'You’ve played '.$count.'/'.Loyalty::LOYALTY_TARGET.' games there this month. Keep going — a free hour is close! ⚽',
                '/profile'
            );
        }

        return ['earned' => false, 'count' => $count];
    }

    /**
     * Move a player's trust score after they complete or cancel a game.
     *
     * @return array{before: int, after: int}|null
     */
    private function adjustTrust(int $userId, string $kind): ?array
    {
        $user = User::find($userId);

        if (! $user) {
            return null;
        }

        $before = (int) ($user->trust_score ?? Loyalty::TRUST_START);
        $after = $kind === 'complete' ? Loyalty::trustAfterComplete($before) : Loyalty::trustAfterCancel($before);

        $user->forceFill(['trust_score' => $after])->save();

        return ['before' => $before, 'after' => $after];
    }

    /**
     * Owner-requested advance: a venue decision, separate from the automatic
     * fair-play deposit. It can be no advance, the full court total, or a
     * server-validated custom amount.
     */
    private function handleAdvanceRequest(Booking $booking, array $prev, Request $request): ?JsonResponse
    {
        if (! $request->has('advancePayment') && ! $request->has('advancePaymentAmount')) {
            return null;
        }

        ['court' => $court, 'venue' => $venue] = $this->venueOf($prev);
        $actorId = (int) $request->input('actorId', 0);

        if ($request->input('actor') !== 'owner' || ! $venue?->owner_id || $actorId !== (int) $venue->owner_id) {
            return $this->fail('Only the venue owner can request an advance 🔒', 403);
        }

        if ($prev['advance_payment_status'] === 'paid') {
            return $this->fail('This advance has already been paid and cannot be changed 🔒', 409);
        }

        if ($prev['payment_status'] === 'paid' || (int) $prev['paid_amount'] >= (int) $prev['total_price']) {
            return $this->fail('This booking is already paid in full, so no separate advance is needed ✅', 409);
        }

        if ($prev['visibility'] === 'competition' && $prev['competition_status'] === 'pending') {
            return $this->fail('The opposition captain must accept this competition request before payment decisions open 🆚', 409);
        }

        if ($prev['status'] !== 'pending') {
            return $this->fail('An advance can only be requested while this booking is still pending', 409);
        }

        $choice = (string) $request->input('advancePayment', 'custom');

        $requested = match ($choice) {
            'none' => 0,
            'full' => (int) $prev['total_price'],
            default => (int) $request->input('advancePaymentAmount', 0),
        };

        if ($requested < 0 || $requested > (int) $prev['total_price']) {
            return $this->fail('Advance must be zero or a whole-rupee amount no greater than the court total 💰', 400);
        }

        if ($choice === 'custom' && $requested <= 0) {
            return $this->fail('A custom advance must be greater than zero 💰', 400);
        }

        if ($choice === 'full' && (int) $prev['total_price'] <= 0) {
            return $this->fail('A free booking does not need an advance 💚', 400);
        }

        $status = $requested > 0 ? 'pending' : 'none';

        $booking->forceFill([
            'advance_payment_required' => $requested > 0,
            'advance_payment_amount' => $requested,
            'advance_payment_status' => $status,
            'advance_payment_requested_by' => $requested > 0 ? $venue->owner_id : null,
            'advance_payment_requested_at' => $requested > 0 ? now() : null,
        ])->save();

        $next = $booking->fresh();
        $when = Futsal::prettyDate($next->date).' at '.Futsal::formatTime12($next->start_time);

        if ($requested > 0) {
            Notifier::notify(
                (int) $next->user_id,
                'payment',
                "💳 Advance requested — {$venue->name}",
                "{$venue->name} asked you to pay ".Futsal::formatNPR($requested).' in advance for '
                .($court->name ?? 'your court')." on {$when}. Choose eSewa or Khalti from My Bookings; the verified payment will be added to the booking ledger."
                .($requested === (int) $next->total_price ? ' This is the full court amount.' : ''),
                '/bookings'
            );
        } else {
            Notifier::notify(
                (int) $next->user_id,
                'info',
                "✅ No advance required — {$venue->name}",
                'The venue does not require an advance for '.($court->name ?? 'your court')." on {$when}. Your normal payment choice remains unchanged.",
                '/bookings'
            );
        }

        return $this->ok([
            'booking' => $next->toArray(),
            'advancePaymentAmount' => $requested,
            'advancePaymentStatus' => $status,
        ]);
    }

    /**
     * Accept or decline a competition request — only through the selected
     * opposition captain's identity.
     *
     * The conditional update is the one-time gate: two replayed accept calls
     * cannot both notify the venue owner.
     */
    private function handleCompetitionDecision(Booking $booking, array $prev, Request $request): ?JsonResponse
    {
        $action = (string) $request->input('competitionAction', '');

        if ($action === '') {
            return null;
        }

        if ($action !== 'accept' && $action !== 'decline') {
            return $this->fail('Pick accept or decline for this competition request 🆚', 400);
        }

        if ($prev['visibility'] !== 'competition' || ! $prev['opponent_team_id']) {
            return $this->fail('Only competition bookings have an opposition request 🆚', 400);
        }

        if ($prev['status'] !== 'pending' || $prev['competition_status'] !== 'pending') {
            return $this->fail('This competition request has already been decided or cancelled.', 409, ['competitionStatus' => $prev['competition_status']]);
        }

        $actorId = (int) $request->input('actorId', 0);
        $actor = $actorId > 0 ? User::find($actorId) : null;
        $opponent = Team::find($prev['opponent_team_id']);

        if (! $actor || ! $opponent || (int) $opponent->captain_id !== $actorId) {
            return $this->fail('Only the selected opposition captain can decide this request 🔒', 403);
        }

        ['court' => $court, 'venue' => $venue] = $this->venueOf($prev);

        $accepting = $action === 'accept';

        $updated = Booking::where('id', $booking->id)
            ->where('status', 'pending')
            ->where('competition_status', 'pending')
            ->update([
                'competition_status' => $accepting ? 'accepted' : 'declined',
                'competition_responded_by' => $actorId,
                'competition_responded_at' => now(),
                'score_status' => $accepting ? 'awaiting' : 'none',
                'status' => $accepting ? $prev['status'] : 'rejected',
            ]);

        if ($updated === 0) {
            return $this->fail('This competition request was decided by someone else. Refresh your bookings.', 409, ['competitionStatus' => 'decided']);
        }

        $next = $booking->fresh();
        $when = Futsal::prettyDate($next->date).' at '.Futsal::formatTime12($next->start_time);
        $where = $venue->name ?? 'the venue';
        $fixture = ($next->team_name ?: 'Home squad').' vs '.$opponent->name;
        $policy = $next->competition_payment_policy === 'loser_pays' ? 'the losing squad pays' : 'fair split between both squads';

        if ($accepting) {
            // The first and only point at which Owner Studio gets an actionable
            // competition booking request.
            if ($venue?->owner_id) {
                Notifier::notify(
                    (int) $venue->owner_id,
                    'booking_request',
                    "📩 Competition booking ready — {$where}",
                    "{$fixture} was accepted by {$opponent->name}’s captain. Payment policy: {$policy}. Review "
                    .($court->name ?? 'the court')." for {$when} (".Futsal::formatNPR($next->total_price).'). Tap to accept or decline.',
                    '/admin/requests'
                );
            }

            Notifier::notify(
                (int) $next->user_id,
                'info',
                "✅ {$opponent->name} accepted your competition request",
                "{$fixture} at {$where} for {$when} is now with the venue owner for final approval. Payment policy: {$policy}.",
                '/bookings'
            );
        } else {
            // The owner is deliberately not told: the row stays in history and
            // cannot be nudged into the owner queue by a replayed request.
            Notifier::notify(
                (int) $next->user_id,
                'booking_rejected',
                "❌ {$opponent->name} declined the competition request",
                "{$fixture} at {$where} for {$when} was declined by the opposition captain, so it was not sent to the venue owner.",
                '/bookings'
            );
        }

        return $this->ok(['booking' => $next->toArray(), 'competitionStatus' => $next->competition_status]);
    }

    /**
     * Refund or retain the money on a cancelled booking — an owner decision
     * recorded as an audit trail. It does not call a gateway refund: "mark
     * refunded" means the owner has actually sent the money back.
     */
    private function handleCancellationMoney(Booking $booking, array $prev, Request $request, string $actor): ?JsonResponse
    {
        if (! $request->has('cancellationMoney')) {
            return null;
        }

        $choice = (string) $request->input('cancellationMoney');

        if ($choice !== 'refunded' && $choice !== 'retained') {
            return $this->fail('Choose Mark refunded or Keep payment.', 400);
        }

        ['venue' => $venue] = $this->venueOf($prev);

        if ($actor !== 'owner' || (int) $request->input('actorId', 0) !== (int) ($venue->owner_id ?? 0)) {
            return $this->fail('Only the venue owner can resolve cancelled-booking money 🔒', 403);
        }

        if (! in_array($prev['status'], ['cancelled', 'rejected'], true)) {
            return $this->fail('Resolve money only after the booking is cancelled or rejected.', 409);
        }

        $received = max(
            (int) ($prev['cancellation_received_amount'] ?? 0),
            $this->receivedForBooking((int) $prev['id'], (int) $prev['total_price'])
        );

        if ($received <= 0) {
            return $this->fail('There is no recorded payment to resolve on this booking.', 409);
        }

        if (in_array($prev['cancellation_money_status'], ['refunded', 'retained'], true)) {
            return $this->fail('This cancelled booking’s money is already resolved.', 409);
        }

        // Legacy cancelled rows sit in "none" until this first resolution; the
        // conditional write stops two owner taps recording competing outcomes.
        $updated = Booking::where('id', $booking->id)
            ->whereIn('cancellation_money_status', ['none', 'review'])
            ->update([
                'cancellation_money_status' => $choice,
                'cancellation_received_amount' => $received,
                'cancellation_refunded_amount' => $choice === 'refunded' ? $received : 0,
                'cancellation_money_resolved_at' => now(),
                'cancellation_money_resolved_by' => (int) $request->input('actorId', 0),
            ]);

        if ($updated === 0) {
            return $this->fail('This cancelled booking’s money was already resolved. Refresh Owner Studio.', 409);
        }

        $resolved = $booking->fresh();

        Notifier::notify(
            (int) $resolved->user_id,
            'payment',
            ($choice === 'refunded' ? '↩️ Refund recorded' : '🧾 Cancellation payment recorded').' — '.($venue->name ?? 'the venue'),
            $choice === 'refunded'
                ? Futsal::formatNPR($received)." received for booking #FN-{$resolved->id} is marked refunded by the venue owner."
                : Futsal::formatNPR($received)." received for cancelled booking #FN-{$resolved->id} was recorded as retained by the venue owner. Contact the venue if you need clarification.",
            '/bookings'
        );

        return $this->ok(['booking' => $resolved->toArray()]);
    }

    /**
     * Scoring a competition game.
     *
     * The booker cannot score their own game — that is the point of a
     * competition — so the venue owner enters the result, because they are the
     * one standing at the ground when the whistle goes.
     *
     * Returns a response when this request is about scoring, or null when it is
     * a normal status update and the caller should carry on.
     */
    private function applyCompetitionScore(Booking $booking, array $prev, Request $request): ?JsonResponse
    {
        if (! $request->has('homeScore') && ! $request->has('awayScore')) {
            return null;
        }

        if ($prev['visibility'] !== 'competition') {
            return $this->fail('Only competition games carry a score — this is a regular booking 🙂', 400);
        }

        // Score corrections follow the same server-authoritative correction
        // window as payments: once settled and locked, changing the score would
        // change the competitive record and the loser-pays outcome.
        $scoreWindow = BookingLedger::settleWindow($prev['settled_at'] ?? null);

        if ($scoreWindow['settled'] && ! $scoreWindow['editable']) {
            return $this->fail(
                'This competition score is locked — the '.(BookingLedger::SETTLE_EDIT_WINDOW_MS / 60000).'-minute correction window has closed 🔒',
                409,
                ['reason' => 'score_locked', 'settledAt' => $prev['settled_at'] ?? null]
            );
        }

        if ($prev['competition_status'] === 'pending') {
            return $this->fail('The opposition captain must accept this competition before a result can be recorded 🆚', 409);
        }

        if (in_array($prev['competition_status'], ['declined', 'cancelled'], true)) {
            return $this->fail('A declined competition request has no result to record.', 409);
        }

        ['venue' => $venue] = $this->venueOf($prev);
        $actorId = (int) $request->input('actorId', 0);

        if (! $venue || $actorId !== (int) $venue->owner_id) {
            return $this->fail(
                $venue ? "Only {$venue->name}’s owner can record this result 👑" : 'Only the venue owner can record this result 👑',
                403
            );
        }

        $scoreError = Validation::score($request->input('homeScore'), 'Your squad’s score')
            ?? Validation::score($request->input('awayScore'), 'Opponent’s score');

        if ($scoreError) {
            return $this->fail($scoreError, 400);
        }

        // "" is how the UI clears a box and null is how JSON says the same
        // thing; both mean "no result yet", so neither may sneak through as a 0.
        $blank = fn ($v) => $v === '' || $v === null || $v === false;
        $home = $blank($request->input('homeScore')) ? null : (int) $request->input('homeScore');
        $away = $blank($request->input('awayScore')) ? null : (int) $request->input('awayScore');

        if (($home === null) !== ($away === null)) {
            return $this->fail('Both scores or neither — a 1–? result isn’t a result ⚽', 400);
        }

        $scored = $home !== null && $away !== null;

        $booking->forceFill([
            'home_score' => $home,
            'away_score' => $away,
            'score_status' => $scored ? 'recorded' : 'awaiting',
            'score_updated_by' => $actorId,
            'score_updated_at' => now(),
        ])->save();

        $withScore = $booking->fresh();

        if ($scored) {
            $allBookings = Booking::all();
            $squads = [];

            foreach ([$withScore->team_id, $withScore->opponent_team_id] as $teamId) {
                if (! $teamId) {
                    continue;
                }

                if ($team = Team::find($teamId)) {
                    $squads[] = $team;
                }
            }

            $line = ($squads[0]->name ?? 'Home')." {$home}–{$away} ".($squads[1]->name ?? 'Away');

            foreach ($squads as $team) {
                // A squad's competitive record: league fixtures its host scored,
                // plus every competition booking that already has a result.
                $history = $allBookings
                    ->filter(fn (Booking $b) => $b->visibility === 'competition'
                        && ((int) $b->team_id === (int) $team->id || (int) $b->opponent_team_id === (int) $team->id)
                        && $b->home_score !== null
                        && $b->away_score !== null)
                    ->map(fn (Booking $b) => [
                        'homeTeamId' => (int) ($b->team_id ?? 0),
                        'awayTeamId' => (int) ($b->opponent_team_id ?? 0),
                        'homeScore' => $b->home_score,
                        'awayScore' => $b->away_score,
                        'status' => 'played',
                    ])
                    ->values()
                    ->all();

                $rec = League::recordFor((int) $team->id, $history);

                $loserId = $home < $away ? $prev['team_id'] : $prev['opponent_team_id'];

                $paymentOutcome = $prev['competition_payment_policy'] === 'loser_pays'
                    ? ($home === $away
                        ? 'It was a draw, so the court bill falls back to a fair split.'
                        : ((int) $team->id === (int) $loserId
                            ? 'Your squad is the losing side, so the saved policy assigns the court bill to you.'
                            : 'Your squad won, so the saved policy assigns the court bill to the opposition.'))
                    : 'The saved policy is a fair split between both squads.';

                Notifier::notify(
                    (int) $team->captain_id,
                    'competition',
                    "⚽ Result in — {$line}",
                    "{$venue->name} recorded the final score. {$team->name} is now {$rec['won']}W • {$rec['drawn']}D • {$rec['lost']}L ({$rec['points']} pts) in competition games — the record shows on your team profile. {$paymentOutcome} Send the host your photos for the album 📸",
                    "/teams/{$team->id}"
                );
            }
        }

        return $this->ok(['booking' => $withScore->toArray(), 'scored' => $scored]);
    }
}
