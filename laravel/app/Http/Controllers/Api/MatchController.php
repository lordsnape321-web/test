<?php

namespace App\Http\Controllers\Api;

use App\Models\Court;
use App\Models\MatchJoin;
use App\Models\OpenMatch;
use App\Models\User;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\OpenGames;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Open matches — a public game with spare slots.
 *
 * Taking a spot is a two-sided agreement, exactly like joining a squad: a player
 * *asks*, the host *answers*. Nothing here writes an `accepted` join without
 * either the host's say-so or money already offered — which is the whole point.
 * See `App\Support\OpenGames` for the rules and why they are what they are.
 */
class MatchController extends ApiController
{
    private const LEVELS = ['All Levels', 'Beginner', 'Intermediate', 'Advanced'];

    /**
     * GET /api/matches — every open game, with the people already in it.
     *
     * `?userId=` adds that player's own request to each game, and a host's
     * queue of players waiting on them. Both are scoped to the viewer: nobody
     * else can see who asked to play, exactly as a squad's request queue is
     * captain-only.
     */
    public function index(Request $request): JsonResponse
    {
        $viewerId = (int) ($request->query('userId') ?? $request->query('viewerId') ?? 0);

        $all = OpenMatch::orderByDesc('created_at')->get();
        $list = $all->filter(fn (OpenMatch $m) => $m->status === 'open');

        $matchIds = $list->pluck('id')->all();
        $joins = $matchIds === [] ? collect() : MatchJoin::whereIn('match_id', $matchIds)->get()->groupBy('match_id');

        $userIds = $joins->flatten()->pluck('user_id')
            ->merge($list->pluck('organizer_id'))
            ->filter()->unique()->all();

        $users = $userIds === [] ? collect() : User::whereIn('id', $userIds)->get()->keyBy('id');
        $venues = Venue::all()->keyBy('id');
        $courts = Court::all()->keyBy('id');

        $enriched = $list->map(function (OpenMatch $m) use ($joins, $users, $venues, $courts, $viewerId) {
            $jm = $joins->get($m->id) ?? collect();
            $crewSize = (int) ($m->crew_size ?? 1);
            $organizerId = (int) $m->organizer_id;

            // Only a settled join holds a spot. A pending request must not make
            // the game look fuller than it is, or the host's own last free slot
            // would vanish behind someone who has not been answered yet.
            $accepted = $jm->filter(fn ($j) => $j->status === OpenGames::JOIN_ACCEPTED);
            $pending = $jm->filter(fn ($j) => $j->status === OpenGames::JOIN_PENDING);

            $otherJoined = $accepted->filter(fn ($j) => (int) $j->user_id !== $organizerId)->count();
            $joinedCount = $crewSize + $otherJoined;

            $isHost = $viewerId > 0 && $viewerId === $organizerId;
            $mine = $viewerId > 0
                ? $jm->first(fn ($j) => (int) $j->user_id === $viewerId && $j->status !== OpenGames::JOIN_CANCELLED)
                : null;

            $row = $m->toArray();
            $row['positionsNeeded'] = OpenGames::normalisePositions($m->positions_needed);
            $row['joinedCount'] = $joinedCount;
            $row['otherJoined'] = $otherJoined;
            $row['crewSize'] = $crewSize;
            $row['openSpots'] = max(0, (int) $m->max_players - $crewSize);
            $row['spotsLeft'] = max(0, (int) $m->max_players - $joinedCount);
            $row['pendingCount'] = $pending->count();
            $row['players'] = $accepted->map(fn ($j) => $users->get((int) $j->user_id))->filter()->values()->all();
            $row['venue'] = $venues->get((int) $m->venue_id);
            $row['court'] = $courts->get((int) $m->court_id);
            $row['organizer'] = $users->get($organizerId);

            $row['viewer'] = $viewerId > 0 ? [
                'isHost' => $isHost,
                'isIn' => $mine !== null && $mine->status === OpenGames::JOIN_ACCEPTED,
                'requestStatus' => $mine?->status ?? null,
                'requestId' => $mine?->id ?? null,
                'position' => $mine?->position ?? null,
                'paidAmount' => $mine ? (int) $mine->paid_amount : 0,
                'paymentRequested' => $mine !== null && $mine->payment_requested_at !== null,
            ] : null;

            // The queue is the host's alone. It is the one place a player can
            // see who is waiting, and it is why "Count me in" is a request.
            $row['requests'] = $isHost
                ? $pending->map(fn ($j) => $this->requestRow($j, $users->get((int) $j->user_id)))->values()->all()
                : [];

            return $row;
        })->values()->all();

        return $this->ok(['matches' => $enriched]);
    }

    /** POST /api/matches — host a game. */
    public function store(Request $request): JsonResponse
    {
        $title = trim((string) $request->input('title', ''));
        $description = trim((string) $request->input('description', ''));
        $venueId = (int) $request->input('venueId', 0);
        $organizerId = (int) $request->input('organizerId', 0);
        $date = (string) $request->input('date', '');
        $startTime = (string) $request->input('startTime', '');
        $price = $request->input('pricePerPlayer');

        // Naming the positions you are short of is optional. An empty list is
        // stored as "anyone welcome", so the card never has to guess.
        $rawPositions = $request->input('positionsNeeded', $request->input('positions', []));
        $positionsNeeded = OpenGames::normalisePositions($rawPositions);

        if (is_array($rawPositions) && count($rawPositions) > 0 && $positionsNeeded === []
            && ! collect($rawPositions)->every(fn ($p) => is_string($p) && strtolower(trim($p)) === 'any')) {
            return $this->fail('Pick real positions, or leave it open to anyone 🧤', 400);
        }

        $error = Validation::firstError(
            Validation::title($title, ['min' => 3, 'max' => 60, 'label' => 'Game title']),
            $venueId <= 0 ? 'Pick where you’re playing 📍' : null,
            $organizerId <= 0 ? 'Login to host a game 🔒' : null,
            Validation::dateISO($date, ['label' => 'Game day', 'maxDaysAhead' => 60]),
            Validation::timeHM($startTime, 'Start time'),
            Validation::money($price, ['min' => 0, 'max' => 2000, 'label' => 'Price per friend']),
            $description !== '' ? Validation::message($description, ['min' => 3, 'max' => 500, 'label' => 'Note', 'required' => false]) : null,
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        $crewSize = max(1, (int) ($request->input('crewSize') ?? $request->input('ourCrew') ?? 1) ?: 1);
        $total = (int) $request->input('maxPlayers', 0) ?: 0;
        $openSpotsInput = (int) $request->input('openSpots', 0) ?: 0;

        if ($openSpotsInput > 0 || $request->has('crewSize') || $request->has('ourCrew')) {
            $crewError = Validation::crew($crewSize, ['min' => 1, 'max' => 21, 'label' => 'Our crew']);

            if ($crewError) {
                return $this->fail($crewError, 400);
            }

            $openError = Validation::crew($openSpotsInput ?: 1, ['min' => 1, 'max' => 21, 'label' => 'Open spots']);

            if ($openSpotsInput > 0 && $openError) {
                return $this->fail($openError, 400);
            }

            $open = max(1, $openSpotsInput ?: max(1, $total - $crewSize));
            $crewSize = min(21, $crewSize);
            $total = min(22, max(4, $crewSize + $open));
        } else {
            $total = min(22, max(4, $total ?: 10));
            $crewSize = min($crewSize, max(1, $total - 1));
        }

        $totalError = Validation::totalPlayers($total);

        if ($totalError) {
            return $this->fail($totalError, 400);
        }

        $level = (string) $request->input('level', 'All Levels');
        $levelParts = array_values(array_filter(array_map('trim', explode('+', $level)), fn ($s) => $s !== ''));

        if ($level !== 'All Levels'
            && ($levelParts === [] || collect($levelParts)->every(fn ($p) => in_array($p, self::LEVELS, true)) !== true)) {
            return $this->fail('Pick valid levels 🌍🎯', 400);
        }

        $match = OpenMatch::create([
            'title' => $title,
            'venue_id' => $venueId,
            'court_id' => $request->filled('courtId') ? (int) $request->input('courtId') : null,
            'organizer_id' => $organizerId,
            'date' => $date,
            'start_time' => $startTime,
            'end_time' => (string) $request->input('endTime', ''),
            'price_per_player' => (int) $price,
            'max_players' => $total,
            'crew_size' => $crewSize,
            'level' => $level,
            'description' => $description,
            'status' => 'open',
            'charge_mode' => $request->input('chargeMode') === 'custom' ? 'custom' : 'split',
            'positions_needed' => $positionsNeeded === [] ? null : json_encode($positionsNeeded),
        ]);

        // The host's own crew is not a request — it is already theirs. This is
        // the one `accepted` row written without anybody answering.
        MatchJoin::create([
            'match_id' => $match->id,
            'user_id' => $organizerId,
            'status' => OpenGames::JOIN_ACCEPTED,
            'position' => OpenGames::ANY_POSITION,
            'joined_at' => now(),
        ]);

        return $this->ok(['match' => $match->toArray()], 201);
    }

    /**
     * POST /api/matches/{id}/join — ask for a spot.
     *
     * This used to put the player in the game outright, which handed the whole
     * team to whoever posted it. It now files a request the host answers, with
     * two things the host can say yes to:
     *
     *  - `position` — the spot they are filling, so a game short of a keeper
     *    gets a keeper.
     *  - money in advance — `payInAdvance` with an optional amount. Offering
     *    your share is a commitment, so it accepts the request by default; a
     *    host can still accept someone who sent nothing.
     */
    public function join(Request $request, int $id): JsonResponse
    {
        $userId = (int) $request->input('userId', 0);

        if ($userId <= 0) {
            return $this->fail('Login to join 🔒', 400);
        }

        $message = trim((string) $request->input('message', ''));
        $messageError = Validation::message($message, ['min' => 3, 'max' => 300, 'label' => 'Note', 'required' => false]);

        if ($messageError) {
            return $this->fail($messageError, 400);
        }

        $match = OpenMatch::find($id);

        if (! $match) {
            return $this->fail('Match not found', 404);
        }

        if ($match->status !== 'open') {
            return $this->fail('This match is not open for joining yet', 409);
        }

        $organizerId = (int) $match->organizer_id;

        if ($organizerId === $userId) {
            return $this->ok([
                'ok' => true,
                'alreadyIn' => true,
                'message' => 'You’re hosting this one — you’re already in 🎉',
            ]);
        }

        $existing = MatchJoin::where('match_id', $id)->where('user_id', $userId)->first();

        if ($existing) {
            if ($existing->status === OpenGames::JOIN_ACCEPTED) {
                return $this->ok(['ok' => true, 'alreadyIn' => true, 'message' => 'You’re already in this game 🎉']);
            }

            if ($existing->status === OpenGames::JOIN_PENDING) {
                return $this->fail(
                    'You’ve already asked to play — the host hasn’t answered yet ⏳',
                    409,
                    ['reason' => 'request_pending', 'requestId' => $existing->id]
                );
            }
        }

        // Requests queue against the same number of spare slots as joins do, so
        // a full game stops taking asks instead of collecting a hundred.
        $acceptedCount = MatchJoin::where('match_id', $id)
            ->where('status', OpenGames::JOIN_ACCEPTED)
            ->where('user_id', '!=', $organizerId)
            ->count();
        $spotsLeft = max(0, (int) $match->max_players - ((int) ($match->crew_size ?? 1)) - $acceptedCount);

        if ($spotsLeft <= 0) {
            return $this->fail('Match is full — that crew filled fast! ⚡', 409, ['reason' => 'full']);
        }

        $positionsNeeded = OpenGames::normalisePositions($match->positions_needed);
        $position = OpenGames::positionFor($positionsNeeded, $request->input('position', ''));

        $share = (int) $match->price_per_player;
        $paidAmount = OpenGames::advanceAmount(
            $request->input('paidAmount', $request->input('amount', 0)),
            $share,
            $request->boolean('payInAdvance', false) || $request->boolean('paidInAdvance', false)
        );

        $wantsToPay = $paidAmount > 0;

        if ($wantsToPay) {
            $method = trim((string) $request->input('payMethod', 'eSewa'));
            $methodError = Validation::paymentMethods([$method]);

            if ($methodError) {
                return $this->fail($methodError, 400);
            }
        }

        // Money in front of the host is a commitment, so it settles the request
        // without making the host tap anything. Still their game: they can
        // decline, and they can take the spot back by removing the player.
        $autoAccepts = OpenGames::autoAccepts($paidAmount);
        $status = $autoAccepts ? OpenGames::JOIN_ACCEPTED : OpenGames::JOIN_PENDING;

        $row = [
            'status' => $status,
            'position' => $position,
            'message' => $message !== '' ? $message : null,
            'paid_amount' => $paidAmount,
            'pay_method' => $wantsToPay ? trim((string) $request->input('payMethod', 'eSewa')) : '',
            'payment_ref' => $wantsToPay ? 'SEED-JOIN-'.strtoupper(bin2hex(random_bytes(3))) : '',
            'paid_at' => $wantsToPay ? now() : null,
            'auto_accepted' => $autoAccepts,
            'joined_at' => $autoAccepts ? now() : null,
            'decided_at' => $autoAccepts ? now() : null,
            'decided_by' => $autoAccepts ? $organizerId : null,
            'created_at' => now(),
        ];

        if ($existing) {
            // A declined or withdrawn ask is made again on the same row, so a
            // player's history with a game stays one honest line.
            $join = $existing->forceFill($row);
            $join->save();
        } else {
            $join = MatchJoin::create($row + ['match_id' => $id, 'user_id' => $userId]);
        }

        $player = User::find($userId);
        $playerName = $player->name ?? 'A player';
        $spot = $position !== '' ? $position : ($positionsNeeded === [] ? OpenGames::ANY_POSITION : 'a spot they didn’t name');

        $hostNotice = $wantsToPay
            ? "\"{$match->title}\" — {$playerName} asked to play and paid Rs {$paidAmount} up front ✅ You’re all set; they’ll be there."
            : "\"{$match->title}\" — {$playerName} asked to play ({$spot})"
                .($message !== '' ? ": \"{$message}\"" : '')
                .'. Accept them when you’re ready — they’re not on the pitch until you say so.';

        Notifier::notify(
            $organizerId,
            'match_join',
            $wantsToPay ? '✅ '.($player->name ?? 'A player').' is in and has paid' : '🙋 '.($player->name ?? 'A player').' asked to play',
            $hostNotice,
            '/matches?focus=' . $match->id
        );

        if ($autoAccepts) {
            Notifier::notify(
                $userId,
                'match_join',
                "🎉 You're in for {$match->title}",
                'You paid your share of Rs '.$paidAmount.' up front, so your spot is settled — see you on the pitch! '
                .($positionsNeeded === [] ? '' : 'You are down as '.$position.'.'),
                '/matches?focus=' . $match->id
            );

            return $this->ok([
                'ok' => true,
                'status' => OpenGames::JOIN_ACCEPTED,
                'autoAccepted' => true,
                'paidAmount' => $paidAmount,
                'request' => $join->fresh()->toArray(),
                'message' => "You're in — Rs {$paidAmount} paid, spot settled 🎉",
            ], 201);
        }

        return $this->ok([
            'ok' => true,
            'status' => OpenGames::JOIN_PENDING,
            'autoAccepted' => false,
            'request' => $join->fresh()->toArray(),
            'message' => "Request sent — {$match->title}'s host will answer ⏳",
        ], 201);
    }

    /** DELETE /api/matches/{id}/join?userId= — withdraw a request or give a spot back. */
    public function leave(Request $request, int $id): JsonResponse
    {
        $userId = (int) $request->query('userId', 0);

        if ($userId <= 0) {
            return $this->fail('Login required 🔒', 400);
        }

        $join = MatchJoin::where('match_id', $id)->where('user_id', $userId)->first();

        if (! $join) {
            return $this->fail('You haven’t asked to play this one 🛡️', 404);
        }

        if ($join->status === OpenGames::JOIN_PENDING) {
            $join->forceFill([
                'status' => OpenGames::JOIN_CANCELLED,
                'decided_at' => now(),
                'decided_by' => $userId,
            ])->save();

            return $this->ok(['ok' => true, 'withdrawn' => true, 'message' => 'Request withdrawn 📂']);
        }

        $match = OpenMatch::find($id);

        if ($match && (int) $match->organizer_id === $userId) {
            return $this->fail('You’re the host — your crew is your own 🛡️', 409, ['reason' => 'is_host']);
        }

        // A settled spot is given back as a cancellation rather than deleted,
        // so the host's list of who played stays complete.
        $join->forceFill([
            'status' => OpenGames::JOIN_CANCELLED,
            'decided_at' => now(),
            'decided_by' => $userId,
            'joined_at' => null,
        ])->save();

        return $this->ok(['ok' => true, 'left' => true, 'message' => 'Spot given back 🙏']);
    }

    /**
     * GET /api/matches/{id}/joins?organizerId= — the host's queue.
     *
     * Host-only, like a squad captain's request list: who asked is nobody else's
     * business until the host answers.
     */
    public function joins(Request $request, int $id): JsonResponse
    {
        $organizerId = (int) $request->query('organizerId', 0);
        $match = OpenMatch::find($id);

        if (! $match) {
            return $this->fail('Match not found', 404);
        }

        if ((int) $match->organizer_id !== $organizerId) {
            return $this->fail('Only the host can see who asked to play 👑', 403, ['joins' => []]);
        }

        $raw = $request->query('status');
        $status = ($raw === 'all' || $raw === '') ? '' : (string) $raw;

        $rows = MatchJoin::where('match_id', $id)
            ->when($status !== '', fn ($q) => $q->where('status', $status))
            ->get();

        $users = $rows->isEmpty()
            ? collect()
            : User::whereIn('id', $rows->pluck('user_id')->filter()->unique()->all())->get()->keyBy('id');

        return $this->ok([
            'joins' => $rows->map(fn ($j) => $this->requestRow($j, $users->get((int) $j->user_id)))->values()->all(),
        ]);
    }

    /**
     * POST /api/matches/{id}/joins — the host answers.
     *
     * `accept` takes the spot and is allowed whether or not any money came in:
     * "accept without it" is a real answer, not a failure. `decline` sends it
     * back with a reason the player can read. `askPayment` is the host asking
     * for the share up front, which leaves the request exactly where it is
     * until the money lands.
     */
    public function decideJoin(Request $request, int $id): JsonResponse
    {
        $organizerId = (int) $request->input('organizerId', 0);
        $joinId = (int) $request->input('joinId', 0);
        $action = (string) $request->input('action', '');

        if ($joinId <= 0) {
            return $this->fail('Invalid request ⏳', 400);
        }

        if (! in_array($action, ['accept', 'decline', 'askPayment'], true)) {
            return $this->fail('Choose accept, decline, or ask for payment 🤝', 400);
        }

        $match = OpenMatch::find($id);

        if (! $match) {
            return $this->fail('Match not found', 404);
        }

        if ((int) $match->organizer_id !== $organizerId) {
            return $this->fail('Only the host can answer who plays 👑', 403);
        }

        $join = MatchJoin::where('id', $joinId)->where('match_id', $id)->first();

        if (! $join) {
            return $this->fail('That request no longer exists ⏳', 404);
        }

        if ($join->status !== OpenGames::JOIN_PENDING) {
            return $this->fail("That request was already {$join->status} ⏳", 409);
        }

        $player = User::find((int) $join->user_id);
        $playerName = $player->name ?? 'A player';

        if ($action === 'askPayment') {
            $join->forceFill(['payment_requested_at' => now()])->save();

            Notifier::notify(
                (int) $join->user_id,
                'match_join',
                '💰 '.($playerName === 'A player' ? 'The host' : 'Please pay').' — '.($match->title ?? 'the game').' needs your share',
                ($match->title ?? 'The game').' is asking for Rs '.(int) $match->price_per_player.' up front to hold your spot. '
                .'Pay and you’re in automatically; your request stays open either way.',
                '/matches?focus=' . $match->id
            );

            return $this->ok([
                'ok' => true,
                'action' => $action,
                'join' => $this->requestRow($join->fresh(), $player),
                'message' => "Asked {$playerName} for their share ⏳",
            ]);
        }

        if ($action === 'decline') {
            $join->forceFill([
                'status' => OpenGames::JOIN_DECLINED,
                'decided_at' => now(),
                'decided_by' => $organizerId,
            ])->save();

            Notifier::notify(
                (int) $join->user_id,
                'match_join',
                "🛡️ {$match->title} is full without you",
                "The host passed on your request for \"{$match->title}\" — the game may have filled up, or they needed a different position. "
                .'Nothing was charged, and you can ask again for a future game.',
                '/matches?focus=' . $match->id
            );

            return $this->ok([
                'ok' => true,
                'action' => $action,
                'join' => $this->requestRow($join->fresh(), $player),
                'accepted' => false,
            ]);
        }

        // Accept. Re-check the limit here rather than trusting the count from
        // when the player asked — everyone else has been answering too.
        $acceptedCount = MatchJoin::where('match_id', $id)
            ->where('status', OpenGames::JOIN_ACCEPTED)
            ->where('user_id', '!=', (int) $match->organizer_id)
            ->count();
        $spotsLeft = max(0, (int) $match->max_players - (int) ($match->crew_size ?? 1) - $acceptedCount);

        if ($spotsLeft <= 0) {
            return $this->fail(
                'No spots left on this game — it filled up while you were deciding 👥',
                409,
                ['reason' => 'full']
            );
        }

        $join->forceFill([
            'status' => OpenGames::JOIN_ACCEPTED,
            'joined_at' => $join->joined_at ?? now(),
            'decided_at' => now(),
            'decided_by' => $organizerId,
            'auto_accepted' => false,
        ])->save();

        $paidNote = (int) $join->paid_amount > 0
            ? ' You already paid Rs '.(int) $join->paid_amount.' up front — that one is settled. 🎉'
            : '';

        Notifier::notify(
            (int) $join->user_id,
            'match_join',
            "🎉 You're in for {$match->title}",
            'The host accepted your request — you’re on the pitch for "'.$match->title.'".'.$paidNote,
            '/matches?focus=' . $match->id
        );

        return $this->ok([
            'ok' => true,
            'action' => $action,
            'accepted' => true,
            'join' => $this->requestRow($join->fresh(), $player),
            'message' => "{$playerName} is in 🎉",
        ]);
    }

    /**
     * POST /api/matches/{id}/joins/pay — the share lands.
     *
     * This is the "accept by default if paid" rule for the case where the host
     * asked for the money after the fact: paying settles the request on its
     * own, exactly as paying up front does, and the host still hears about it.
     */
    public function payJoin(Request $request, int $id): JsonResponse
    {
        $userId = (int) $request->input('userId', 0);
        $joinId = (int) $request->input('joinId', 0);

        if ($userId <= 0 || $joinId <= 0) {
            return $this->fail('Login to pay 🔒', 400);
        }

        $match = OpenMatch::find($id);

        if (! $match) {
            return $this->fail('Match not found', 404);
        }

        $join = MatchJoin::where('id', $joinId)->where('match_id', $id)->where('user_id', $userId)->first();

        if (! $join) {
            return $this->fail('That request no longer exists ⏳', 404);
        }

        if ($join->status === OpenGames::JOIN_ACCEPTED) {
            return $this->ok(['ok' => true, 'alreadyIn' => true, 'message' => 'You’re already in 🎉']);
        }

        if ($join->status !== OpenGames::JOIN_PENDING) {
            return $this->fail("That request was already {$join->status} ⏳", 409);
        }

        $method = trim((string) $request->input('payMethod', 'eSewa'));
        $methodError = Validation::paymentMethods([$method]);

        if ($methodError) {
            return $this->fail($methodError, 400);
        }

        $share = (int) $match->price_per_player;
        $amount = OpenGames::advanceAmount(
            $request->input('amount', $share),
            $share,
            true
        );

        if ($amount <= 0) {
            return $this->fail('Nothing to pay on this game 🎉', 400);
        }

        // A spot has to still exist to be bought — money never resurrects a
        // game that has already filled up.
        $acceptedCount = MatchJoin::where('match_id', $id)
            ->where('status', OpenGames::JOIN_ACCEPTED)
            ->where('user_id', '!=', (int) $match->organizer_id)
            ->count();
        $spotsLeft = max(0, (int) $match->max_players - (int) ($match->crew_size ?? 1) - $acceptedCount);

        if ($spotsLeft <= 0) {
            return $this->fail('That game is full now — nothing was charged 👥', 409, ['reason' => 'full']);
        }

        $autoAccepts = OpenGames::autoAccepts($amount);

        $join->forceFill([
            'paid_amount' => $amount,
            'pay_method' => $method,
            'payment_ref' => 'SEED-JOIN-'.strtoupper(bin2hex(random_bytes(3))),
            'paid_at' => now(),
            'status' => $autoAccepts ? OpenGames::JOIN_ACCEPTED : OpenGames::JOIN_PENDING,
            'auto_accepted' => $autoAccepts,
            'joined_at' => $autoAccepts ? now() : null,
            'decided_at' => $autoAccepts ? now() : null,
            'decided_by' => $autoAccepts ? (int) $match->organizer_id : null,
        ])->save();

        $player = User::find($userId);

        Notifier::notify(
            (int) $match->organizer_id,
            'match_join',
            '💰 '.($player->name ?? 'A player').' paid up',
            "\"{$match->title}\" — Rs {$amount} received, so ".($player->name ?? 'they').' is in automatically. '
            .'Thanks for asking for the share up front.',
            '/matches?focus=' . $match->id
        );

        return $this->ok([
            'ok' => true,
            'paidAmount' => $amount,
            'autoAccepted' => $autoAccepts,
            'join' => $this->requestRow($join->fresh(), $player),
            'message' => $autoAccepts
                ? "Paid Rs {$amount} — you're in 🎉"
                : 'Payment recorded',
        ], 201);
    }

    /**
     * One request as the host's queue shows it.
     *
     * @param  User|null  $user
     * @return array<string, mixed>
     */
    private function requestRow(MatchJoin $join, ?User $user): array
    {
        $paidAmount = (int) $join->paid_amount;

        return [
            'id' => (int) $join->id,
            'matchId' => (int) $join->match_id,
            'userId' => (int) $join->user_id,
            'name' => $user->name ?? 'A player',
            'level' => $user->level ?? '—',
            // The player's usual role, which is not the same thing as the spot
            // they asked to fill — anyone can stand in goal for one game.
            'playerPosition' => $user->position ?? '—',
            'avatarColor' => $user->avatar_color ?? null,
            'avatarUrl' => $user->avatar_url ?? null,
            'status' => $join->status,
            'slot' => $join->position,
            'message' => $join->message,
            'paidAmount' => $paidAmount,
            'payMethod' => $join->pay_method,
            'paymentSummary' => OpenGames::paymentSummary($paidAmount, (string) $join->pay_method),
            'paid' => $paidAmount > 0,
            'paymentRequested' => $join->payment_requested_at !== null,
            'autoAccepted' => (bool) $join->auto_accepted,
            'createdAt' => $join->created_at?->toDateTimeString(),
            'decidedAt' => $join->decided_at?->toDateTimeString(),
        ];
    }
}
