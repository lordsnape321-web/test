<?php

namespace App\Http\Controllers\Api;

use App\Models\Court;
use App\Models\MatchJoin;
use App\Models\OpenMatch;
use App\Models\User;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Open matches — a public game with spare slots that anyone can take.
 */
class MatchController extends ApiController
{
    private const LEVELS = ['All Levels', 'Beginner', 'Intermediate', 'Advanced'];

    /** GET /api/matches — every open game, with the people already in it. */
    public function index(): JsonResponse
    {
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

        $enriched = $list->map(function (OpenMatch $m) use ($joins, $users, $venues, $courts) {
            $jm = $joins->get($m->id) ?? collect();
            $players = $jm->map(fn ($j) => $users->get((int) $j->user_id))->filter()->values()->all();
            $crewSize = (int) ($m->crew_size ?? 1);
            $otherJoined = $jm->filter(fn ($j) => (int) $j->user_id !== (int) $m->organizer_id)->count();
            $joinedCount = $crewSize + $otherJoined;

            $row = $m->toArray();
            $row['joinedCount'] = $joinedCount;
            $row['otherJoined'] = $otherJoined;
            $row['crewSize'] = $crewSize;
            $row['openSpots'] = max(0, (int) $m->max_players - $crewSize);
            $row['spotsLeft'] = max(0, (int) $m->max_players - $joinedCount);
            $row['players'] = $players;
            $row['venue'] = $venues->get((int) $m->venue_id);
            $row['court'] = $courts->get((int) $m->court_id);
            $row['organizer'] = $users->get((int) $m->organizer_id);

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
        ]);

        MatchJoin::create(['match_id' => $match->id, 'user_id' => $organizerId]);

        return $this->ok(['match' => $match->toArray()], 201);
    }

    /** POST /api/matches/{id}/join — take one of the spare slots. */
    public function join(Request $request, int $id): JsonResponse
    {
        $userId = (int) $request->input('userId', 0);

        if ($userId <= 0) {
            return $this->fail('Login to join 🔒', 400);
        }

        if (MatchJoin::where('match_id', $id)->where('user_id', $userId)->exists()) {
            return $this->ok(['ok' => true, 'message' => 'Already joined']);
        }

        $match = OpenMatch::find($id);

        if (! $match) {
            return $this->fail('Match not found', 404);
        }

        if ($match->status !== 'open') {
            return $this->fail('This match is not open for joining yet', 409);
        }

        $allJoins = MatchJoin::where('match_id', $id)->get();
        $crewSize = (int) ($match->crew_size ?? 1);
        $otherJoined = $allJoins->filter(fn ($j) => (int) $j->user_id !== (int) $match->organizer_id)->count();
        $totalTaken = $crewSize + $otherJoined;

        if ($totalTaken >= (int) $match->max_players) {
            return $this->fail('Match is full — that crew filled fast! ⚡', 409);
        }

        MatchJoin::create(['match_id' => $id, 'user_id' => $userId]);

        if ($match->organizer_id && (int) $match->organizer_id !== $userId) {
            $joiner = User::find($userId);

            Notifier::notify(
                (int) $match->organizer_id,
                'match_join',
                '🙋 '.($joiner->name ?? 'A player').' joined your match',
                "\"{$match->title}\" now has ".($totalTaken + 1)."/{$match->max_players} players (👥 {$crewSize} crew + 🙋 ".($otherJoined + 1).' joined).',
                '/matches'
            );
        }

        return $this->ok(['ok' => true]);
    }

    /** DELETE /api/matches/{id}/join?userId= — give the slot back. */
    public function leave(Request $request, int $id): JsonResponse
    {
        $userId = (int) $request->query('userId', 0);

        if ($userId <= 0) {
            return $this->fail('Login required 🔒', 400);
        }

        MatchJoin::where('match_id', $id)->where('user_id', $userId)->delete();

        return $this->ok(['ok' => true]);
    }
}
