<?php

namespace App\Support;

use App\Models\Booking;
use App\Models\Team;
use App\Models\Tournament;
use App\Models\TournamentMatch;
use App\Models\TournamentPayment;
use App\Models\TournamentTeam;
use App\Models\Venue;

/**
 * League rows and the squad-facing views built from them —
 * `src/lib/league-store.ts`.
 *
 * Arithmetic lives in `App\Support\League`; this class is where the fixtures,
 * entries and competition bookings are read and joined.
 */
class LeagueStore
{
    /**
     * One squad's competitive profile: the record, the leagues it plays in, and
     * every result that produced them.
     *
     * The record counts two kinds of fixture on purpose — league rounds a host
     * scored, and competition bookings a venue owner scored — because a squad's
     * record is the same thing on both sides of the app.
     *
     * @return array<string, mixed>
     */
    public static function teamCompetitionProfile(int $teamId): array
    {
        if ($teamId <= 0) {
            return ['record' => League::recordFor(0, []), 'leagues' => [], 'results' => []];
        }

        $allTournaments = Tournament::all()->keyBy('id');
        $allMatches = TournamentMatch::all();
        $allEntries = TournamentTeam::all();
        $allTeams = Team::all()->keyBy('id');
        $allVenues = Venue::all()->keyBy('id');
        $allBookings = Booking::all();

        $nameOf = fn (mixed $id) => $allTeams->get((int) $id)?->name ?? 'Squad';

        $leagueMatches = $allMatches->filter(fn (TournamentMatch $m) => (int) $m->home_team_id === $teamId
            || (int) $m->away_team_id === $teamId)->values();

        $competitionBookings = $allBookings->filter(fn (Booking $b) => $b->visibility === 'competition'
            && ((int) $b->team_id === $teamId || (int) $b->opponent_team_id === $teamId)
            && $b->home_score !== null
            && $b->away_score !== null)->values();

        $matchLikes = $leagueMatches->map(fn (TournamentMatch $m) => [
            'homeTeamId' => (int) $m->home_team_id,
            'awayTeamId' => (int) $m->away_team_id,
            'homeScore' => $m->home_score,
            'awayScore' => $m->away_score,
            'status' => $m->status,
        ])->concat($competitionBookings->map(fn (Booking $b) => [
            'homeTeamId' => (int) ($b->team_id ?? 0),
            'awayTeamId' => (int) ($b->opponent_team_id ?? 0),
            'homeScore' => $b->home_score,
            'awayScore' => $b->away_score,
            'status' => 'played',
        ]))->all();

        /** A squad has genuinely played a league when it has a finished fixture there. */
        $playedIn = fn (int $tournamentId) => $allMatches->contains(fn (TournamentMatch $m) => (int) $m->tournament_id === $tournamentId
            && ((int) $m->home_team_id === $teamId || (int) $m->away_team_id === $teamId)
            && $m->home_score !== null
            && $m->away_score !== null
            && $m->status !== 'void');

        $leagues = [];

        foreach ($allEntries as $e) {
            // Being invited — or asking — is not being in a league: only an
            // approved place, or a match actually played there, puts a league on
            // the profile.
            if ((int) $e->team_id !== $teamId) {
                continue;
            }

            if ($e->status !== League::TEAM_APPROVED && ! $playedIn((int) $e->tournament_id)) {
                continue;
            }

            $t = $allTournaments->get((int) $e->tournament_id);

            if (! $t) {
                continue;
            }

            $squads = $allEntries
                ->filter(fn ($x) => (int) $x->tournament_id === (int) $t->id && $x->status === League::TEAM_APPROVED)
                ->map(fn ($x) => [
                    'teamId' => (int) $x->team_id,
                    'name' => $allTeams->get((int) $x->team_id)?->name ?? 'Squad',
                    'logoColor' => $allTeams->get((int) $x->team_id)?->logo_color ?? '#16a34a',
                    'teamCode' => $allTeams->get((int) $x->team_id)?->team_code ?? '',
                ])
                ->values()
                ->all();

            $table = League::standingsFor($squads, $allMatches->filter(fn ($m) => (int) $m->tournament_id === (int) $t->id)->all());

            $idx = null;

            foreach ($table as $i => $row) {
                if ((int) $row['teamId'] === $teamId) {
                    $idx = $i;
                    break;
                }
            }

            $leagues[] = [
                'tournamentId' => $t->id,
                'name' => $t->name,
                'status' => $t->status,
                'format' => $t->format,
                'venueName' => $allVenues->get((int) $t->venue_id)?->name ?? '',
                'startsAt' => $t->starts_at,
                'record' => League::recordFor($teamId, $allMatches->filter(fn ($m) => (int) $m->tournament_id === (int) $t->id)->all()),
                'standing' => $idx !== null && count($table) > 1 ? $idx + 1 : null,
                'tableSize' => count($squads),
            ];
        }

        $results = [];

        foreach ($leagueMatches as $m) {
            if ($m->home_score === null || $m->away_score === null || $m->status === 'void') {
                continue;
            }

            $t = $allTournaments->get((int) $m->tournament_id);
            $home = (int) $m->home_team_id === $teamId;
            $scored = (int) ($home ? $m->home_score : $m->away_score);
            $conceded = (int) ($home ? $m->away_score : $m->home_score);

            $results[] = [
                'id' => $m->id,
                'source' => 'league',
                'leagueId' => (int) $m->tournament_id,
                'leagueName' => $t->name ?? 'League',
                'round' => $m->round,
                'opponent' => $nameOf($home ? $m->away_team_id : $m->home_team_id),
                'opponentId' => (int) ($home ? $m->away_team_id : $m->home_team_id),
                'home' => $home,
                'scored' => $scored,
                'conceded' => $conceded,
                'outcome' => $scored > $conceded ? 'W' : ($scored === $conceded ? 'D' : 'L'),
                'date' => $m->date,
                'link' => '/leagues/'.$m->tournament_id,
            ];
        }

        foreach ($competitionBookings as $b) {
            $home = (int) $b->team_id === $teamId;
            $scored = (int) ($home ? $b->home_score : $b->away_score);
            $conceded = (int) ($home ? $b->away_score : $b->home_score);
            $t = $b->tournament_id ? $allTournaments->get((int) $b->tournament_id) : null;

            $results[] = [
                'id' => $b->id,
                'source' => 'booking',
                'leagueId' => $b->tournament_id !== null ? (int) $b->tournament_id : null,
                'leagueName' => $t->name ?? 'Friendly competition',
                'round' => 'Competition game',
                'opponent' => $nameOf($home ? $b->opponent_team_id : $b->team_id),
                'opponentId' => $home ? (int) $b->opponent_team_id : (int) $b->team_id,
                'home' => $home,
                'scored' => $scored,
                'conceded' => $conceded,
                'outcome' => $scored > $conceded ? 'W' : ($scored === $conceded ? 'D' : 'L'),
                'date' => $b->date,
                'link' => $t ? '/leagues/'.$t->id : '/bookings',
            ];
        }

        usort($results, fn ($a, $b) => strcmp((string) ($b['date'] ?? ''), (string) ($a['date'] ?? '')));

        return [
            'record' => League::recordFor($teamId, $matchLikes),
            'leagues' => $leagues,
            'results' => $results,
        ];
    }

    /** The ledger rows that back a squad's league totals, newest first. */
    public static function paymentsForTeam(int $tournamentId, int $teamId): array
    {
        $rows = TournamentPayment::where('tournament_id', $tournamentId)
            ->get()
            ->filter(fn (TournamentPayment $p) => (int) $p->team_id === $teamId)
            ->sortByDesc(fn (TournamentPayment $p) => $p->created_at?->getTimestamp() ?? 0)
            ->values();

        return $rows->map(fn (TournamentPayment $p) => [
            'id' => $p->id,
            'kind' => $p->kind,
            'amount' => (int) $p->amount,
            'method' => $p->method,
            'reference' => $p->reference,
            'createdAt' => $p->created_at,
        ])->all();
    }
}
