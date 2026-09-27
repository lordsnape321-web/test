<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\Tournament;
use App\Models\TournamentMatch;
use App\Models\User;
use App\Services\Notifier;
use App\Support\Futsal;
use App\Support\League;
use App\Support\LeagueStore;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The host's fixture book 📖 — `/api/tournaments/{id}/matches`.
 *
 * - `create`   — one fixture between two squads of this league.
 * - `generate` — a round robin for every squad in it, or a whole bracket. A
 *                league where every team plays every other is what captains
 *                expect, and typing it out by hand is where hosts give up, so
 *                the button does the arithmetic (n × (n−1) ÷ 2 games).
 * - `score`    — record a result. Scores are the league's truth: they move the
 *                table *and* land on each squad's profile as its record.
 * - `delete`   — remove a fixture that was never played.
 */
class TournamentMatchController extends ApiController
{
    /**
     * GET — fixtures, results and the table ⚽
     *
     * Only squads in the league (and the host) may read the fixture list of a
     * private league; in a public one the calendar is part of the pitch, so
     * anyone can look. The standings come back freshly computed, so the table
     * and each squad's profile are always counting the same results.
     */
    public function index(Request $request, int $id): JsonResponse
    {
        $access = LeagueStore::leagueAccess($id, (int) $request->query('userId', 0) ?: 0);

        if (! $access) {
            return $this->fail('That league no longer exists 🛡️', 404, ['matches' => []]);
        }

        $tournament = $access['tournament'];

        if (! ($access['isHost'] || $access['canSeeInside'] || $tournament->visibility === 'public')) {
            return $this->ok(['matches' => [], 'locked' => true]);
        }

        $squads = LeagueStore::approvedSquads($id);
        $rows = TournamentMatch::where('tournament_id', $id)->get();

        // An empty bracket slot is named by where its squad comes from, so a
        // card reads "Bye 🎟️" or "Winner Group A" rather than a bare "Squad".
        $nameOf = function (mixed $teamId, mixed $label) use ($squads) {
            $found = collect($squads)->firstWhere('teamId', (int) $teamId);

            return $found['name'] ?? ((string) $label ?: 'TBD');
        };

        $matches = $rows
            ->sort(fn ($a, $b) => ((int) $a->bracket_round <=> (int) $b->bracket_round)
                ?: ((int) $a->slot <=> (int) $b->slot)
                ?: strcmp((string) $a->date, (string) $b->date)
                ?: ((int) $a->id <=> (int) $b->id))
            ->values()
            ->map(fn ($m) => [
                'id' => $m->id,
                'round' => $m->round,
                'bracketRound' => (int) $m->bracket_round,
                'slot' => (int) $m->slot,
                'homeFrom' => $m->home_from,
                'awayFrom' => $m->away_from,
                'homeLabel' => $m->home_label,
                'awayLabel' => $m->away_label,
                'homeTeamId' => (int) $m->home_team_id,
                'awayTeamId' => (int) $m->away_team_id,
                'homeTeamName' => $nameOf($m->home_team_id, $m->home_label),
                'awayTeamName' => $nameOf($m->away_team_id, $m->away_label),
                'date' => $m->date,
                'startTime' => $m->start_time,
                'homeScore' => $m->home_score,
                'awayScore' => $m->away_score,
                'status' => $m->status,
                'bookingId' => $m->booking_id,
                'notes' => $m->notes,
            ])->all();

        return $this->ok([
            'matches' => $matches,
            // The page picks its renderer from this: a table for a league, a
            // bracket for a knockout, both for groups + knockout.
            'mode' => $tournament->mode,
            'thirdPlace' => (bool) $tournament->third_place,
            'groupSize' => (int) $tournament->group_size,
            'standings' => League::standingsFor($squads, $matches),
            'isHost' => $access['isHost'],
            'canManage' => $access['isHost'],
        ]);
    }

    public function store(Request $request, int $id): JsonResponse
    {
        $action = (string) $request->input('action', '');
        $hostId = (int) $request->input('hostId', 0);

        $league = Tournament::find($id);

        if (! $league) {
            return $this->fail('That league no longer exists 🛡️', 404);
        }

        if ((int) $league->host_id !== $hostId) {
            return $this->fail('Only the host keeps the fixture book 👑', 403);
        }

        $squads = LeagueStore::approvedSquads($id);
        $squadIds = collect($squads)->pluck('teamId')->map(fn ($v) => (int) $v)->all();
        $hostLink = "/leagues/{$id}";
        $host = User::find($hostId);

        /**
         * A league stops being "taking entries" the moment it has a fixture on
         * the board — the same flip the round-robin draw makes, so the badge
         * never says "entries open" over a fixture that already kicked off.
         */
        $markOngoing = function () use ($league, $id) {
            if ($league->status !== 'registration') {
                return;
            }

            $league->forceFill(['status' => 'ongoing'])->save();
        };

        /* ------------------------------------------------- create / generate */
        if ($action === 'create' || $action === 'generate') {
            if (count($squads) < 2) {
                return $this->fail('Two squads have to be in before there’s anything to play 👥', 409);
            }

            if ($action === 'generate') {
                $existing = TournamentMatch::where('tournament_id', $id)->get();

                /* -------------------------------- knockout / groups draw */
                if (League::modeHasBracket((string) $league->mode)) {
                    // A bracket is drawn once, whole. Drawing it again over a
                    // half-played one would strand slots wired to games that no
                    // longer exist, so the host clears the book first.
                    if ($existing->count() > 0) {
                        return $this->fail(
                            'This bracket is already drawn 🥊 Remove the fixtures first if the draw needs doing again.',
                            409
                        );
                    }

                    $teamIds = collect($squads)->pluck('teamId')->map(fn ($v) => (int) $v)->all();
                    $created = 0;

                    if (League::modeHasGroups((string) $league->mode)) {
                        $groups = League::makeGroups($teamIds, (int) $league->group_size);

                        if (count($groups) < 2) {
                            return $this->fail(
                                "Groups of {$league->group_size} need at least two groups — let a couple more squads in, or drop the group size 🎯",
                                409
                            );
                        }

                        // The group stage is a mini league inside each group.
                        foreach ($groups as $g => $group) {
                            for ($i = 0; $i < count($group); $i++) {
                                for ($j = $i + 1; $j < count($group); $j++) {
                                    TournamentMatch::create([
                                        'tournament_id' => $id,
                                        'round' => League::groupLabel($g),
                                        'home_team_id' => $group[$i],
                                        'away_team_id' => $group[$j],
                                        'date' => '',
                                        'start_time' => '',
                                        'court_id' => $league->court_id ?: null,
                                        'updated_by' => $hostId,
                                    ]);

                                    $created += 1;
                                }
                            }
                        }

                        // ...and the knockout stage is created empty, waiting on
                        // the group tables.
                        $slots = League::knockoutFromGroups(count($groups), ['thirdPlace' => (bool) $league->third_place]);
                        $summary = count($groups).' groups of '.implode('/', array_map('count', $groups)).' — top two of each go through';
                    } else {
                        $slots = League::buildBracket($teamIds, ['thirdPlace' => (bool) $league->third_place]);

                        $byes = collect($slots)->filter(fn ($x) => $x['roundIndex'] === 1
                            && ($x['homeTeamId'] === 0 || $x['awayTeamId'] === 0))->count();

                        $summary = 'a knockout bracket for '.count($teamIds).' squads'
                            .($byes > 0 ? " — top {$byes} seed".($byes === 1 ? '' : 's').' get'.($byes === 1 ? 's' : '').' a bye' : '');
                    }

                    foreach ($slots as $slot) {
                        TournamentMatch::create([
                            'tournament_id' => $id,
                            'round' => $slot['round'],
                            'bracket_round' => $slot['roundIndex'],
                            'slot' => $slot['slot'],
                            'home_team_id' => $slot['homeTeamId'],
                            'away_team_id' => $slot['awayTeamId'],
                            'home_from' => $slot['homeFrom'],
                            'away_from' => $slot['awayFrom'],
                            'home_label' => $slot['homeLabel'],
                            'away_label' => $slot['awayLabel'],
                            'date' => '',
                            'start_time' => '',
                            'court_id' => $league->court_id ?: null,
                            'updated_by' => $hostId,
                        ]);

                        $created += 1;
                    }

                    // Byes and already-decided group tables fill their slots at once.
                    $this->advanceBracket($id);

                    $league->forceFill(['status' => $league->status === 'registration' ? 'ongoing' : $league->status])->save();

                    foreach ($squads as $s) {
                        Notifier::notify(
                            (int) $s['captainId'],
                            'league',
                            "📅 The draw is out — {$league->name}",
                            "{$created} ".($created === 1 ? 'game' : 'games')." drawn — {$summary}. Open the league page to see your route to the final.",
                            $hostLink
                        );
                    }

                    return $this->ok([
                        'ok' => true,
                        'created' => $created,
                        'message' => "{$created} fixtures drawn — {$summary} 🗓️",
                    ]);
                }

                /* ---------------------------------------- round robin draw */
                $seen = $existing->map(fn ($m) => collect([(int) $m->home_team_id, (int) $m->away_team_id])
                    ->sort()->values()->implode('-'))->all();
                $seen = array_fill_keys($seen, true);

                $created = 0;

                for ($i = 0; $i < count($squads); $i++) {
                    for ($j = $i + 1; $j < count($squads); $j++) {
                        $key = collect([(int) $squads[$i]['teamId'], (int) $squads[$j]['teamId']])
                            ->sort()->values()->implode('-');

                        if (isset($seen[$key])) {
                            continue;
                        }

                        TournamentMatch::create([
                            'tournament_id' => $id,
                            'round' => 'League',
                            'home_team_id' => $squads[$i]['teamId'],
                            'away_team_id' => $squads[$j]['teamId'],
                            'date' => '',
                            'start_time' => '',
                            'court_id' => $league->court_id ?: null,
                            'updated_by' => $hostId,
                        ]);

                        $created += 1;
                    }
                }

                $league->forceFill(['status' => $league->status === 'registration' ? 'ongoing' : $league->status])->save();

                foreach ($squads as $s) {
                    Notifier::notify(
                        (int) $s['captainId'],
                        'league',
                        "📅 Fixture list is out — {$league->name}",
                        "{$created} round-robin ".($created === 1 ? 'game' : 'games').' were drawn up. Open the league page to see who you play and when.',
                        $hostLink
                    );
                }

                return $this->ok([
                    'ok' => true,
                    'created' => $created,
                    'message' => $created > 0 ? "{$created} fixtures drawn 🗓️" : 'Every pairing already exists ✅',
                ]);
            }

            $homeTeamId = (int) $request->input('homeTeamId', 0);
            $awayTeamId = (int) $request->input('awayTeamId', 0);

            if (! in_array($homeTeamId, $squadIds, true) || ! in_array($awayTeamId, $squadIds, true)) {
                return $this->fail('Both squads have to be in this league 🛡️', 400);
            }

            if ($homeTeamId === $awayTeamId) {
                return $this->fail('A squad can’t play itself 🙂', 400);
            }

            $round = trim((string) $request->input('round', 'League')) ?: 'League';
            $date = trim((string) $request->input('date', ''));
            $startTime = trim((string) $request->input('startTime', ''));
            $notes = mb_substr(trim((string) $request->input('notes', '')), 0, 300);

            $error = Validation::firstError(
                Validation::round($round),
                $date ? Validation::dateISO($date, ['label' => 'Fixture date', 'allowPast' => true]) : null,
                $startTime ? Validation::timeHM($startTime, 'Kick-off time') : null,
            );

            if ($error) {
                return $this->fail($error, 400);
            }

            $match = TournamentMatch::create([
                'tournament_id' => $id,
                'round' => $round,
                'home_team_id' => $homeTeamId,
                'away_team_id' => $awayTeamId,
                'date' => $date,
                'start_time' => $startTime,
                'court_id' => (int) $request->input('courtId', 0) ?: ($league->court_id ?: null),
                'notes' => $notes,
                'updated_by' => $hostId,
            ]);

            $when = $date
                ? Futsal::prettyDate($date).($startTime ? ' at '.Futsal::formatTime12($startTime) : '')
                : 'a date to be confirmed';

            $homeName = collect($squads)->firstWhere('teamId', $homeTeamId)['name'] ?? 'Home';
            $awayName = collect($squads)->firstWhere('teamId', $awayTeamId)['name'] ?? 'Away';

            foreach ([$homeTeamId, $awayTeamId] as $teamId) {
                $captainId = collect($squads)->firstWhere('teamId', $teamId)['captainId'] ?? 0;

                Notifier::notify(
                    (int) $captainId,
                    'league',
                    "📅 New fixture — {$league->name}",
                    "{$homeName} vs {$awayName} • {$when}. Turn up, play hard, and the host will record the result.",
                    $hostLink
                );
            }

            $markOngoing();

            return $this->ok(['ok' => true, 'match' => $match, 'message' => 'Fixture added 📅']);
        }

        /* ------------------------------------------------------------ score */
        if ($action === 'score') {
            $matchId = (int) $request->input('matchId', 0);
            $match = TournamentMatch::where('id', $matchId)->where('tournament_id', $id)->first();

            if (! $match) {
                return $this->fail('That fixture isn’t in this league 🛡️', 404);
            }

            // "" and null both mean "clear the score" — neither may become a 0.
            $blank = fn ($v) => $v === '' || $v === null || $v === false;
            $rawHome = $request->input('homeScore');
            $rawAway = $request->input('awayScore');
            $homeScore = $blank($rawHome) ? null : (is_numeric($rawHome) ? (int) $rawHome : $rawHome);
            $awayScore = $blank($rawAway) ? null : (is_numeric($rawAway) ? (int) $rawAway : $rawAway);

            $error = Validation::firstError(
                Validation::score($homeScore, (collect($squads)->firstWhere('teamId', (int) $match->home_team_id)['name'] ?? 'Home').' score'),
                Validation::score($awayScore, (collect($squads)->firstWhere('teamId', (int) $match->away_team_id)['name'] ?? 'Away').' score'),
            );

            if ($error) {
                return $this->fail($error, 400);
            }

            if (($homeScore === null) !== ($awayScore === null)) {
                return $this->fail('Both scores or neither — a 3–? result isn’t a result 🙂', 400);
            }

            $played = $homeScore !== null && $awayScore !== null;

            // A bracket game can't be level: the winner is who goes through, so
            // a draw would leave the next round with an empty slot nobody can
            // fill. The host counts the penalties and enters the shootout score.
            if ($played && (int) $match->bracket_round > 0 && $homeScore === $awayScore) {
                return $this->fail(
                    'A knockout game needs a winner — count the penalties and enter the shootout score 🥊',
                    400
                );
            }

            $match->forceFill([
                'home_score' => $homeScore,
                'away_score' => $awayScore,
                'status' => $played ? 'played' : 'scheduled',
                'notes' => $request->has('notes') ? mb_substr((string) $request->input('notes'), 0, 300) : $match->notes,
                'updated_by' => $hostId,
                'updated_at' => now(),
            ])->save();

            // A fixture linked to a booking keeps the two in step, so the
            // venue's booking list and the league's table never disagree.
            if ($match->booking_id && $played) {
                Booking::where('id', (int) $match->booking_id)->update([
                    'home_score' => $homeScore,
                    'away_score' => $awayScore,
                    'score_status' => 'recorded',
                    'score_updated_by' => $hostId,
                    'score_updated_at' => now(),
                ]);
            }

            $advanced = 0;
            $championName = '';

            if ($played) {
                $markOngoing();

                // A result sends somebody through — the next round fills itself
                // instead of waiting on the host.
                $advanced = $this->advanceBracket($id);

                $likes = TournamentMatch::where('tournament_id', $id)->get()
                    ->map(fn ($m) => [
                        'homeTeamId' => (int) $m->home_team_id,
                        'awayTeamId' => (int) $m->away_team_id,
                        'homeScore' => $m->home_score,
                        'awayScore' => $m->away_score,
                        'status' => $m->status,
                    ])->all();

                $homeName = collect($squads)->firstWhere('teamId', (int) $match->home_team_id)['name'] ?? 'Home';
                $awayName = collect($squads)->firstWhere('teamId', (int) $match->away_team_id)['name'] ?? 'Away';

                foreach ([(int) $match->home_team_id, (int) $match->away_team_id] as $teamId) {
                    $captainId = collect($squads)->firstWhere('teamId', $teamId)['captainId'] ?? 0;
                    $rec = League::recordFor($teamId, $likes);

                    Notifier::notify(
                        (int) $captainId,
                        'league',
                        "⚽ {$homeName} {$homeScore}–{$awayScore} {$awayName}",
                        'Result recorded by '.($host->name ?? 'the host').'. '
                        .(collect($squads)->firstWhere('teamId', $teamId)['name'] ?? 'Your squad')
                        ." is now {$rec['won']}W • {$rec['drawn']}D • {$rec['lost']}L ({$rec['points']} pts) in {$league->name}.",
                        $hostLink
                    );
                }

                // Winning the final makes a squad champion — say so, once.
                if ((int) $match->bracket_round > 0 && $match->round === 'Final') {
                    $championId = League::winnerOf([
                        'bracketRound' => (int) $match->bracket_round,
                        'slot' => (int) $match->slot,
                        'homeTeamId' => (int) $match->home_team_id,
                        'awayTeamId' => (int) $match->away_team_id,
                        'homeFrom' => $match->home_from,
                        'awayFrom' => $match->away_from,
                        'homeScore' => $homeScore,
                        'awayScore' => $awayScore,
                        'status' => 'played',
                    ]);

                    $champion = collect($squads)->firstWhere('teamId', $championId);

                    if ($champion) {
                        $championName = $champion['name'] ?? '';

                        Notifier::notify(
                            (int) ($champion['captainId'] ?? 0),
                            'league',
                            "🏆 {$championName} won {$league->name}!",
                            "Champions! The final is yours — {$homeName} {$homeScore}–{$awayScore} {$awayName}. Tell the host where to send the trophy 🎉",
                            $hostLink
                        );
                    }
                }
            }

            return $this->ok([
                'ok' => true,
                'advanced' => $advanced,
                'champion' => $championName,
                'message' => $played
                    ? "Result saved — {$homeScore}–{$awayScore} ⚽".($championName !== ''
                        ? " — {$championName} are champions 🏆"
                        : ($advanced > 0 ? " • {$advanced} bracket ".($advanced === 1 ? 'slot' : 'slots').' filled' : ''))
                    : 'Score cleared — the fixture is unplayed again',
            ]);
        }

        /* ----------------------------------------------------------- delete */
        if ($action === 'delete') {
            $matchId = (int) $request->input('matchId', 0);
            $match = TournamentMatch::where('id', $matchId)->where('tournament_id', $id)->first();

            if (! $match) {
                return $this->fail('That fixture isn’t in this league 🛡️', 404);
            }

            if ($match->status === 'played') {
                return $this->fail('That game has a result — clear the score first if it was a mistake ⚽', 409);
            }

            // Pulling one game out of a bracket leaves the round after it wired
            // to nothing, so a bracket is redrawn whole rather than edited a
            // game at a time.
            if ((int) $match->bracket_round > 0) {
                return $this->fail(
                    'That game is part of the bracket 🥊 Delete the whole draw and generate it again if the shape is wrong.',
                    409
                );
            }

            $match->delete();

            return $this->ok(['ok' => true, 'message' => 'Fixture removed 🗑️']);
        }

        /* -------------------------------------------------------- schedule */
        if ($action === 'schedule') {
            // A drawn bracket arrives without times: the host knows which round
            // plays on which Saturday, and this is where they say so — including
            // on a slot that is still "Winner Group A", because the slot exists.
            $matchId = (int) $request->input('matchId', 0);
            $match = TournamentMatch::where('id', $matchId)->where('tournament_id', $id)->first();

            if (! $match) {
                return $this->fail('That fixture isn’t in this league 🛡️', 404);
            }

            $date = trim((string) $request->input('date', ''));
            $startTime = trim((string) $request->input('startTime', ''));

            if ($date === '' && $startTime === '') {
                return $this->fail('Pick a day or a kick-off time to save 📅', 400);
            }

            $error = Validation::firstError(
                $date ? Validation::dateISO($date, ['label' => 'Fixture date', 'allowPast' => true]) : null,
                $startTime ? Validation::timeHM($startTime, 'Kick-off time') : null,
            );

            if ($error) {
                return $this->fail($error, 400);
            }

            $patch = [
                'updated_by' => $hostId,
                'updated_at' => now(),
            ];

            if ($date !== '') {
                $patch['date'] = $date;
            }

            if ($startTime !== '') {
                $patch['start_time'] = $startTime;
            }

            if ($request->has('courtId')) {
                $patch['court_id'] = (int) $request->input('courtId', 0) ?: null;
            }

            $match->forceFill($patch)->save();

            return $this->ok([
                'ok' => true,
                'match' => $match->fresh(),
                'message' => $date !== ''
                    ? $match->round.' set for '.Futsal::prettyDate($date).($startTime !== '' ? ' at '.Futsal::formatTime12($startTime) : '').' 📅'
                    : 'Kick-off time saved 📅',
            ]);
        }

        /* ---------------------------------------------------------- advance */
        if ($action === 'advance') {
            if (! League::modeHasBracket((string) $league->mode)) {
                return $this->fail('This league has no bracket to fill — it’s a round robin 🔄', 400);
            }

            $advanced = $this->advanceBracket($id);

            return $this->ok([
                'ok' => true,
                'advanced' => $advanced,
                'message' => $advanced > 0
                    ? "{$advanced} bracket ".($advanced === 1 ? 'slot' : 'slots').' filled 🥊'
                    : 'Nothing to fill yet — the bracket moves when a game is decided ⏳',
            ]);
        }

        return $this->fail('Unknown action — try create, generate, schedule, advance, score or delete 📖', 400);
    }

    /**
     * Fill the bracket 🥊
     *
     * Every empty slot in a knockout says where its squad will come from: the
     * winner of round 1 slot 0, the loser of the second semi-final, or the
     * runner-up of group C. This reads the fixtures, answers whichever of those
     * questions the results can now answer, and writes the squad into the slot.
     * It is idempotent — running it twice changes nothing the second time — so
     * it can be called after every result, and on a fresh draw, where byes and
     * finished groups have something to say straight away.
     *
     * A group only sends anybody through once *all* of its games are played:
     * with a game left, the top two could still change, and a slot filled early
     * would be wrong in a way nobody would notice until the final.
     */
    private function advanceBracket(int $leagueId): int
    {
        $rows = TournamentMatch::where('tournament_id', $leagueId)->get();

        $asBracket = fn ($m) => [
            'bracketRound' => (int) $m->bracket_round,
            'slot' => (int) $m->slot,
            'homeTeamId' => (int) $m->home_team_id,
            'awayTeamId' => (int) $m->away_team_id,
            'homeFrom' => $m->home_from,
            'awayFrom' => $m->away_from,
            'homeScore' => $m->home_score,
            'awayScore' => $m->away_score,
            'status' => $m->status,
        ];

        // Group tables, but only for groups whose fixtures are all in.
        $allTeams = \App\Models\Team::all()->keyBy('id');
        $groupTables = [];
        $groupRounds = $rows->filter(fn ($m) => preg_match('/^Group /', (string) $m->round) === 1)
            ->pluck('round')->unique()->values()->all();

        foreach ($groupRounds as $round) {
            $fixtures = $rows->filter(fn ($m) => $m->round === $round)->values();

            if ($fixtures->isEmpty()) {
                continue;
            }

            if ($fixtures->contains(fn ($m) => $m->home_score === null || $m->away_score === null)) {
                continue;
            }

            $ids = $fixtures->flatMap(fn ($m) => [(int) $m->home_team_id, (int) $m->away_team_id])
                ->unique()->values()->all();

            $likes = array_map(function ($id) use ($allTeams) {
                $t = $allTeams->get($id);

                return [
                    'teamId' => $id,
                    'name' => $t->name ?? 'Squad',
                    'logoColor' => $t->logo_color ?? '#16a34a',
                    'teamCode' => $t->team_code ?? '',
                ];
            }, $ids);

            $groupTables[$round] = League::groupQualifiers($likes, $fixtures->map($asBracket)->all())['winners'];
        }

        $groupsByIndex = [];

        foreach ($groupRounds as $round) {
            $letter = str_replace('Group ', '', (string) $round);
            $index = ord($letter[0] ?? 'A') - ord('A');
            $table = $groupTables[$round] ?? null;

            if ($index >= 0 && $table) {
                $groupsByIndex[$index + 1] = $table;
            }
        }

        $resolve = function (string $ref) use ($rows, $asBracket, $groupsByIndex): int {
            if ($ref === '') {
                return 0;
            }

            $matchRef = League::parseMatchRef($ref);

            if ($matchRef) {
                $source = $rows->first(fn ($m) => (int) $m->bracket_round === $matchRef['round'] && (int) $m->slot === $matchRef['slot']);

                if (! $source) {
                    return 0;
                }

                return $matchRef['outcome'] === 'W'
                    ? League::winnerOf($asBracket($source))
                    : League::loserOf($asBracket($source));
            }

            $groupRef = League::parseGroupRef($ref);

            if ($groupRef) {
                $table = $groupsByIndex[$groupRef['group']] ?? null;

                if (! $table) {
                    return 0;
                }

                return $groupRef['place'] === 'W' ? ($table[0] ?? 0) : ($table[1] ?? 0);
            }

            return 0;
        };

        $filled = 0;

        foreach ($rows as $m) {
            if ((int) $m->bracket_round <= 0) {
                continue;
            }

            $changes = [];

            if ((int) $m->home_team_id === 0 && ! empty($m->home_from)) {
                $teamId = $resolve((string) $m->home_from);

                if ($teamId > 0 && $teamId !== (int) $m->away_team_id) {
                    $changes['home_team_id'] = $teamId;
                }
            }

            if ((int) $m->away_team_id === 0 && ! empty($m->away_from)) {
                $teamId = $resolve((string) $m->away_from);

                if ($teamId > 0 && $teamId !== (int) $m->home_team_id) {
                    $changes['away_team_id'] = $teamId;
                }
            }

            if ($changes !== []) {
                $m->forceFill($changes + ['updated_at' => now()])->save();
                $filled += 1;
            }
        }

        return $filled;
    }
}
