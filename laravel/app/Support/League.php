<?php

namespace App\Support;

/**
 * League tables, records and brackets — the pure half of `src/lib/league.ts`.
 *
 * Anything that reads or writes rows lives in `App\Support\LeagueStore`.
 * Everything here is arithmetic over fixtures, so a league table and a team's
 * competitive record are computed by exactly one function each.
 */
class League
{
    public const WIN_POINTS = 3;

    public const DRAW_POINTS = 1;

    public const LEAGUE_MIN_TEAMS = 4;

    public const LEAGUE_MAX_TEAMS = 32;

    public const LEAGUE_FORMATS = ['5v5', '6v6', '7v7', '8v8', '11v11'];

    public const LEAGUE_VISIBILITIES = ['public', 'private'];

    public const LEAGUE_STATUSES = ['registration', 'ongoing', 'completed', 'cancelled'];

    public const LEAGUE_NAME_MAX = 70;

    public const LEAGUE_DESCRIPTION_MAX = 600;

    public const LEAGUE_RULES_MAX = 800;

    public const LEAGUE_PRIZE_BREAKDOWN_MAX = 400;

    public const LEAGUE_MATCH_DAYS_MAX = 80;

    public const LEAGUE_MAX_ENTRY_FEE = 200000;

    public const LEAGUE_MAX_PRIZE_POOL = 2000000;

    public const MIN_DEPOSIT_PERCENT = 25;

    public const MAX_REFUND_PERCENT = 25;

    public const LEAGUE_MODES = ['round_robin', 'knockout', 'group_knockout'];

    public const MIN_GROUP_SIZE = 2;

    public const MAX_GROUP_SIZE = 8;

    public const LEAGUE_ROUNDS = ['League', 'Quarter-final', 'Semi-final', 'Final', 'Friendly'];

    public const ENTRY_DEPOSIT_PERCENT = 25;

    public const WITHDRAW_REFUND_PERCENT = 10;

    public const TEAM_REQUESTED = 'requested';

    public const TEAM_INVITED = 'invited';

    public const TEAM_APPROVED = 'approved';

    public const TEAM_REJECTED = 'rejected';

    public const TEAM_DECLINED = 'declined';

    public const TEAM_WITHDRAWN = 'withdrawn';

    public const TEAM_ENTRY_STATUSES = [self::TEAM_APPROVED, self::TEAM_REQUESTED, self::TEAM_INVITED];

    public const TEAM_ACTIVE_STATUSES = [self::TEAM_APPROVED];

    public const TEAM_PENDING_STATUSES = [self::TEAM_REQUESTED, self::TEAM_INVITED];

    public const TEAM_CLOSED_STATUSES = [self::TEAM_REJECTED, self::TEAM_DECLINED];

    /**
     * @param  array<string, mixed>  $row
     */
    private static function applyResult(array &$row, int $scored, int $conceded): void
    {
        $row['played']++;
        $row['goalsFor'] += $scored;
        $row['goalsAgainst'] += $conceded;

        if ($scored > $conceded) {
            $row['won']++;
            $row['points'] += self::WIN_POINTS;
            $row['form'][] = 'W';
        } elseif ($scored === $conceded) {
            $row['drawn']++;
            $row['points'] += self::DRAW_POINTS;
            $row['form'][] = 'D';
        } else {
            $row['lost']++;
            $row['form'][] = 'L';
        }

        if (count($row['form']) > 5) {
            $row['form'] = array_slice($row['form'], -5);
        }
    }

    /**
     * One squad's competitive record — what a team profile shows.
     *
     * The caller may pass a whole competition: rows for other squads and
     * fixtures with no result yet are skipped, because a team profile rarely
     * knows which rows matter.
     *
     * @param  iterable<array{homeTeamId?: mixed, awayTeamId?: mixed, homeScore?: mixed, awayScore?: mixed, status?: mixed}>  $matches
     * @return array<string, mixed>
     */
    public static function recordFor(int $teamId, iterable $matches): array
    {
        $row = [
            'teamId' => $teamId,
            'name' => '',
            'logoColor' => '',
            'teamCode' => '',
            'played' => 0,
            'won' => 0,
            'drawn' => 0,
            'lost' => 0,
            'goalsFor' => 0,
            'goalsAgainst' => 0,
            'goalDiff' => 0,
            'points' => 0,
            'form' => [],
        ];

        foreach ($matches as $m) {
            $m = is_object($m) ? (array) $m : (array) $m;

            if (! isset($m['homeScore']) || ! isset($m['awayScore']) || ($m['status'] ?? null) === 'void') {
                continue;
            }

            $homeId = (int) ($m['homeTeamId'] ?? 0);
            $awayId = (int) ($m['awayTeamId'] ?? 0);

            if ($homeId !== $teamId && $awayId !== $teamId) {
                continue;
            }

            $hs = (int) $m['homeScore'];
            $as = (int) $m['awayScore'];

            if ($homeId === $teamId) {
                self::applyResult($row, $hs, $as);
            } else {
                self::applyResult($row, $as, $hs);
            }
        }

        $row['goalDiff'] = $row['goalsFor'] - $row['goalsAgainst'];

        return [
            'played' => $row['played'],
            'won' => $row['won'],
            'drawn' => $row['drawn'],
            'lost' => $row['lost'],
            'goalsFor' => $row['goalsFor'],
            'goalsAgainst' => $row['goalsAgainst'],
            'goalDiff' => $row['goalDiff'],
            'points' => $row['points'],
            'winRate' => $row['played'] > 0 ? (int) round(($row['won'] / $row['played']) * 100) : 0,
            'form' => $row['form'],
        ];
    }

    /**
     * @param  array{homeScore?: mixed, awayScore?: mixed}  $m
     */
    public static function hasResult(array $m): bool
    {
        return isset($m['homeScore']) && isset($m['awayScore']);
    }

    /**
     * A league table from its fixtures and the squads in it.
     *
     * Points first, then goal difference, then goals scored, then name — the
     * ordinary order, computed once so every screen shows the same table.
     *
     * @param  iterable<array{teamId?: mixed, name?: mixed, logoColor?: mixed, teamCode?: mixed}>  $teams
     * @param  iterable<array{homeTeamId?: mixed, awayTeamId?: mixed, homeScore?: mixed, awayScore?: mixed, status?: mixed}>  $matches
     * @return array<int, array<string, mixed>>
     */
    public static function standingsFor(iterable $teams, iterable $matches): array
    {
        $rows = [];

        foreach ($teams as $t) {
            $t = is_object($t) ? (array) $t : (array) $t;

            $rows[(int) ($t['teamId'] ?? 0)] = [
                'teamId' => (int) ($t['teamId'] ?? 0),
                'name' => (string) ($t['name'] ?? ''),
                'logoColor' => (string) ($t['logoColor'] ?? '#16a34a'),
                'teamCode' => (string) ($t['teamCode'] ?? ''),
                'played' => 0,
                'won' => 0,
                'drawn' => 0,
                'lost' => 0,
                'goalsFor' => 0,
                'goalsAgainst' => 0,
                'goalDiff' => 0,
                'points' => 0,
                'form' => [],
            ];
        }

        $played = [];

        foreach ($matches as $m) {
            $m = is_object($m) ? (array) $m : (array) $m;

            if (($m['homeScore'] ?? null) === null || ($m['awayScore'] ?? null) === null || ($m['status'] ?? null) === 'void') {
                continue;
            }

            $played[] = $m;
        }

        usort($played, fn ($a, $b) => ((int) ($a['homeTeamId'] ?? 0) <=> (int) ($b['homeTeamId'] ?? 0))
            ?: ((int) ($a['awayTeamId'] ?? 0) <=> (int) ($b['awayTeamId'] ?? 0)));

        foreach ($played as $m) {
            $homeId = (int) ($m['homeTeamId'] ?? 0);
            $awayId = (int) ($m['awayTeamId'] ?? 0);
            $hs = (int) ($m['homeScore'] ?? 0);
            $as = (int) ($m['awayScore'] ?? 0);

            if (isset($rows[$homeId])) {
                self::applyResult($rows[$homeId], $hs, $as);
            }

            if (isset($rows[$awayId])) {
                self::applyResult($rows[$awayId], $as, $hs);
            }
        }

        foreach ($rows as $i => $row) {
            $rows[$i]['goalDiff'] = $row['goalsFor'] - $row['goalsAgainst'];
        }

        usort($rows, fn ($a, $b) => ($b['points'] <=> $a['points'])
            ?: ($b['goalDiff'] <=> $a['goalDiff'])
            ?: ($b['goalsFor'] <=> $a['goalsFor'])
            ?: strcmp($a['name'], $b['name']));

        return array_values($rows);
    }
}
