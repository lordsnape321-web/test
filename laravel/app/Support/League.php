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

    /* ------------------------------------------------------- competition shape */

    /**
     * @return array{label: string, emoji: string, blurb: string}
     */
    public static function modeLabel(string $mode): array
    {
        return match ($mode) {
            'knockout' => ['label' => 'Knockout', 'emoji' => '🥊', 'blurb' => 'Bracket — win or go home, top seeds get byes'],
            'group_knockout' => ['label' => 'Groups + Knockout', 'emoji' => '🎯', 'blurb' => 'Group stage, then the top two of each group go to a bracket'],
            default => ['label' => 'Round robin', 'emoji' => '🔄', 'blurb' => 'League — every squad plays every other, the table decides'],
        };
    }

    public static function isLeagueMode(mixed $value): bool
    {
        return in_array((string) $value, self::LEAGUE_MODES, true);
    }

    public static function leagueModeError(mixed $value): ?string
    {
        return self::isLeagueMode($value)
            ? null
            : 'Pick a competition type — '.implode(', ', self::LEAGUE_MODES).' 🏆';
    }

    /** Does this mode finish with a bracket? (Both knockout flavours do.) */
    public static function modeHasBracket(string $mode): bool
    {
        return $mode === 'knockout' || $mode === 'group_knockout';
    }

    /** Does this mode have a group stage? */
    public static function modeHasGroups(string $mode): bool
    {
        return $mode === 'group_knockout';
    }

    /**
     * Can this group setup actually run? A group of one plays nobody, and a
     * league too small for two groups is just a round robin with extra steps.
     */
    public static function groupSetupError(array $input): ?string
    {
        if (! self::modeHasGroups((string) $input['mode'])) {
            return null;
        }

        $size = (int) ($input['groupSize'] ?? 0);

        if ($size < self::MIN_GROUP_SIZE || $size > self::MAX_GROUP_SIZE) {
            return 'Groups hold '.self::MIN_GROUP_SIZE.'–'.self::MAX_GROUP_SIZE.' squads each 🎯';
        }

        if ((int) ($input['maxTeams'] ?? 0) < 2 * self::MIN_GROUP_SIZE) {
            return 'Groups + knockout needs room for at least two groups of two 👥';
        }

        return null;
    }

    /** The platform's floor and ceiling on the two money knobs. */
    public static function depositPercentError(mixed $value): ?string
    {
        $n = (int) $value;

        if ((string) ((int) $value) !== (string) $value && ! is_int($value)) {
            return 'Deposit must be a whole percentage 🔒';
        }

        if ($n < self::MIN_DEPOSIT_PERCENT) {
            return 'Ask for at least '.self::MIN_DEPOSIT_PERCENT.'% up front — that’s the commitment that holds a squad’s place 🔒';
        }

        if ($n > 100) {
            return 'Deposit can’t be more than 100% of the entry fee 🔒';
        }

        return null;
    }

    public static function refundPercentError(mixed $value): ?string
    {
        $n = (int) $value;

        if ((string) ((int) $value) !== (string) $value && ! is_int($value)) {
            return 'Refund must be a whole percentage ↩️';
        }

        if ($n < 0) {
            return 'Refund can’t be negative ↩️';
        }

        if ($n > self::MAX_REFUND_PERCENT) {
            return 'A squad that backs out gets at most '.self::MAX_REFUND_PERCENT.'% of what it paid back ↩️';
        }

        return null;
    }

    /* ---------------------------------------------------------- bracket maths */

    /** Brackets want a power of two; five squads enter a bracket of eight. */
    public static function bracketSizeFor(int $n): int
    {
        $teams = max(2, (int) $n);
        $size = 2;

        while ($size < $teams) {
            $size *= 2;
        }

        return $size;
    }

    /** How many rounds a bracket of this size needs to reach a champion. */
    public static function bracketRoundsFor(int $size): int
    {
        $rounds = 0;
        $s = max(2, $size);

        while ($s > 1) {
            $s = intdiv($s, 2);
            $rounds += 1;
        }

        return $rounds;
    }

    /** What a round is called, by how many squads are still in it. */
    public static function knockoutRoundLabel(int $size, int $roundIndex): string
    {
        $inRound = max(2, (int) round($size / 2 ** (max(1, $roundIndex) - 1)));

        if ($inRound <= 2) {
            return 'Final';
        }

        if ($inRound === 4) {
            return 'Semi-final';
        }

        if ($inRound === 8) {
            return 'Quarter-final';
        }

        return "Round of {$inRound}";
    }

    /**
     * Bracket order for seeds 1..size, so seed 1 can only meet seed 2 in the
     * final. Eight squads come out 1-8, 4-5, 2-7, 3-6 — the standard draw.
     *
     * @return list<int>
     */
    public static function seedOrder(int $size): array
    {
        $target = self::bracketSizeFor($size);
        $order = [1, 2];

        while (count($order) < $target) {
            $sum = count($order) * 2 + 1;
            $next = [];

            foreach ($order as $seed) {
                $next[] = $seed;
                $next[] = $sum - $seed;
            }

            $order = $next;
        }

        return $order;
    }

    public static function winnerRef(int $roundIndex, int $slot): string
    {
        return "W{$roundIndex}-{$slot}";
    }

    public static function loserRef(int $roundIndex, int $slot): string
    {
        return "L{$roundIndex}-{$slot}";
    }

    public static function groupWinnerRef(int $group): string
    {
        return "G{$group}W";
    }

    public static function groupRunnerUpRef(int $group): string
    {
        return "G{$group}R";
    }

    /** A slot with a squad in it and nobody to play: that's a bye, not a fixture. */
    public static function isBye(array $m): bool
    {
        $home = (int) ($m['homeTeamId'] ?? 0);
        $away = (int) ($m['awayTeamId'] ?? 0);

        return (($home > 0 && $away === 0 && empty($m['awayFrom']))
            || ($away > 0 && $home === 0 && empty($m['homeFrom'])));
    }

    /**
     * Who is through from a bracket game — 0 while it's undecided.
     *
     * A bye sends its only squad through without kicking a ball, which is what
     * lets a five-squad bracket of eight work. A level score returns 0 rather
     * than guessing: a knockout game has to have a winner, and the host decides
     * it (penalties) rather than the code.
     */
    public static function winnerOf(array $m): int
    {
        $home = (int) ($m['homeTeamId'] ?? 0);
        $away = (int) ($m['awayTeamId'] ?? 0);

        if (($m['status'] ?? null) === 'void') {
            return 0;
        }

        if (($m['homeScore'] ?? null) !== null && ($m['awayScore'] ?? null) !== null) {
            $hs = (int) $m['homeScore'];
            $as = (int) $m['awayScore'];

            return $hs > $as ? $home : ($as > $hs ? $away : 0);
        }

        if ($home > 0 && $away === 0 && empty($m['awayFrom'])) {
            return $home;
        }

        if ($away > 0 && $home === 0 && empty($m['homeFrom'])) {
            return $away;
        }

        return 0;
    }

    /** Who is out — used to fill a third-place game from the losing semi-finalists. */
    public static function loserOf(array $m): int
    {
        if (($m['status'] ?? null) === 'void') {
            return 0;
        }

        if (($m['homeScore'] ?? null) === null || ($m['awayScore'] ?? null) === null) {
            return 0;
        }

        $hs = (int) $m['homeScore'];
        $as = (int) $m['awayScore'];

        if ($hs === $as) {
            return 0;
        }

        return $hs > $as ? (int) $m['awayTeamId'] : (int) $m['homeTeamId'];
    }

    /**
     * Split "W2-1" / "L2-1" into the round and slot it points at.
     *
     * @return array{outcome: string, round: int, slot: int}|null
     */
    public static function parseMatchRef(string $ref): ?array
    {
        if (preg_match('/^([WL])(\d+)-(\d+)$/', trim($ref), $m) !== 1) {
            return null;
        }

        return ['outcome' => $m[1], 'round' => (int) $m[2], 'slot' => (int) $m[3]];
    }

    /**
     * Split "G2W" / "G2R" into the group it points at.
     *
     * @return array{group: int, place: string}|null
     */
    public static function parseGroupRef(string $ref): ?array
    {
        if (preg_match('/^G(\d+)([WR])$/', trim($ref), $m) !== 1) {
            return null;
        }

        return ['group' => (int) $m[1], 'place' => $m[2]];
    }

    /** "Group A" … "Group Z", then "Group AA" if a host is running a monster. */
    public static function groupLabel(int $index): string
    {
        $letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        if ($index < strlen($letters)) {
            return 'Group '.$letters[$index];
        }

        return 'Group '.($letters[intdiv($index, strlen($letters)) - 1] ?? '').$letters[$index % strlen($letters)];
    }

    /**
     * Draw a whole bracket 🥊
     *
     * Round one is filled with the squads in seed order — seeds past the entry
     * list become byes, which is simply an empty slot the opponent walks
     * through. Every later round is created empty, wired to the round before it
     * with `W` refs, so scoring a game is all it takes for a winner to appear in
     * the next round. With `thirdPlace`, one more empty game hangs off the two
     * semi-final losers.
     *
     * @param  list<int>  $teamIds
     * @return list<array<string, mixed>>
     */
    public static function buildBracket(array $teamIds, array $options = []): array
    {
        $ids = array_values(array_filter(array_map('intval', $teamIds), fn ($id) => $id > 0));
        $size = self::bracketSizeFor(count($ids));
        $rounds = self::bracketRoundsFor($size);
        $start = max(1, (int) ($options['startIndex'] ?? 1));
        $seeds = self::seedOrder($size);
        $slots = [];

        for ($r = 1; $r <= $rounds; $r++) {
            $gamesInRound = intdiv($size, 2 ** $r);

            for ($slot = 0; $slot < $gamesInRound; $slot++) {
                $prev = $r - 1;

                if ($prev === 0) {
                    $home = ['teamId' => $ids[$seeds[$slot * 2] - 1] ?? 0, 'from' => '', 'label' => 'Bye 🎟️'];
                    $away = ['teamId' => $ids[$seeds[$slot * 2 + 1] - 1] ?? 0, 'from' => '', 'label' => 'Bye 🎟️'];
                } else {
                    $home = [
                        'teamId' => 0,
                        'from' => self::winnerRef($start + $prev - 1, $slot * 2),
                        'label' => 'Winner '.self::knockoutRoundLabel($size, $start + $prev - 1).' '.($slot * 2 + 1),
                    ];
                    $away = [
                        'teamId' => 0,
                        'from' => self::winnerRef($start + $prev - 1, $slot * 2 + 1),
                        'label' => 'Winner '.self::knockoutRoundLabel($size, $start + $prev - 1).' '.($slot * 2 + 2),
                    ];
                }

                $slots[] = [
                    'roundIndex' => $start + $r - 1,
                    'round' => self::knockoutRoundLabel($size, $start + $r - 1),
                    'slot' => $slot,
                    'homeTeamId' => $home['teamId'],
                    'awayTeamId' => $away['teamId'],
                    'homeFrom' => $home['from'],
                    'awayFrom' => $away['from'],
                    'homeLabel' => $home['from'] !== '' ? $home['label'] : ($home['teamId'] ? '' : 'Bye 🎟️'),
                    'awayLabel' => $away['from'] !== '' ? $away['label'] : ($away['teamId'] ? '' : 'Bye 🎟️'),
                ];
            }
        }

        if (! empty($options['thirdPlace']) && $rounds >= 2) {
            $semi = $start + $rounds - 2;

            $slots[] = [
                'roundIndex' => $start + $rounds,
                'round' => 'Third place',
                'slot' => 0,
                'homeTeamId' => 0,
                'awayTeamId' => 0,
                'homeFrom' => self::loserRef($semi, 0),
                'awayFrom' => self::loserRef($semi, 1),
                'homeLabel' => 'Loser '.self::knockoutRoundLabel($size, $semi).' 1',
                'awayLabel' => 'Loser '.self::knockoutRoundLabel($size, $semi).' 2',
            ];
        }

        return $slots;
    }

    /**
     * Split squads into groups 🎯 — seeded snake, so group A's top seed and
     * group B's top seed are the two strongest squads in the league rather than
     * two of them landing together by luck.
     *
     * @param  list<int>  $teamIds
     * @return list<list<int>>
     */
    public static function makeGroups(array $teamIds, int $groupSize = 4): array
    {
        $ids = array_values(array_filter(array_map('intval', $teamIds), fn ($id) => $id > 0));

        if ($ids === []) {
            return [];
        }

        $wanted = min(max(2, (int) $groupSize ?: 4), count($ids));
        $count = max(2, (int) ceil(count($ids) / $wanted));

        // Never leave a group with a single squad — it would play nobody.
        while ($count > 2 && intdiv(count($ids), $count) < 2) {
            $count -= 1;
        }

        $groups = array_fill(0, $count, []);

        foreach ($ids as $i => $id) {
            $row = intdiv($i, $count);
            $col = $row % 2 === 0 ? $i % $count : $count - 1 - ($i % $count);
            $groups[$col][] = $id;
        }

        return array_values(array_filter($groups, fn ($g) => count($g) >= 2));
    }

    /**
     * The knockout stage a group stage feeds: the top two of every group, seeded
     * 1A v 2B, 1B v 2A — the way a real draw keeps group mates apart.
     *
     * @return list<array<string, mixed>>
     */
    public static function knockoutFromGroups(int $groupCount, array $options = []): array
    {
        $entrants = $groupCount * 2;
        $size = self::bracketSizeFor($entrants);
        $rounds = self::bracketRoundsFor($size);
        $start = max(1, (int) ($options['startIndex'] ?? 1));
        $slots = [];

        for ($r = 1; $r <= $rounds; $r++) {
            $gamesInRound = intdiv($size, 2 ** $r);

            for ($slot = 0; $slot < $gamesInRound; $slot++) {
                $entrantIndex = $slot * 2;

                if ($r === 1) {
                    $home = ['teamId' => 0, 'from' => self::groupRef($entrantIndex, 'W', $groupCount), 'label' => self::groupRefLabel($entrantIndex, 'W', $groupCount)];
                    $away = ['teamId' => 0, 'from' => self::groupRef($entrantIndex + 1, 'W', $groupCount), 'label' => self::groupRefLabel($entrantIndex + 1, 'W', $groupCount)];
                } else {
                    $home = [
                        'teamId' => 0,
                        'from' => self::winnerRef($start + $r - 2, $slot * 2),
                        'label' => 'Winner '.self::knockoutRoundLabel($size, $start + $r - 2).' '.($slot * 2 + 1),
                    ];
                    $away = [
                        'teamId' => 0,
                        'from' => self::winnerRef($start + $r - 2, $slot * 2 + 1),
                        'label' => 'Winner '.self::knockoutRoundLabel($size, $start + $r - 2).' '.($slot * 2 + 2),
                    ];
                }

                $slots[] = [
                    'roundIndex' => $start + $r - 1,
                    'round' => self::knockoutRoundLabel($size, $start + $r - 1),
                    'slot' => $slot,
                    'homeTeamId' => $home['teamId'],
                    'awayTeamId' => $away['teamId'],
                    'homeFrom' => $home['from'],
                    'awayFrom' => $away['from'],
                    'homeLabel' => $home['label'],
                    'awayLabel' => $away['label'],
                ];
            }
        }

        if (! empty($options['thirdPlace']) && $rounds >= 2) {
            $semi = $start + $rounds - 2;

            $slots[] = [
                'roundIndex' => $start + $rounds,
                'round' => 'Third place',
                'slot' => 0,
                'homeTeamId' => 0,
                'awayTeamId' => 0,
                'homeFrom' => self::loserRef($semi, 0),
                'awayFrom' => self::loserRef($semi, 1),
                'homeLabel' => 'Loser '.self::knockoutRoundLabel($size, $semi).' 1',
                'awayLabel' => 'Loser '.self::knockoutRoundLabel($size, $semi).' 2',
            ];
        }

        return $slots;
    }

    /** Entrant list for a groups-then-bracket draw: 1A, 2B, 1B, 2A, 1C, 2D … */
    private static function groupRef(int $index, string $place, int $groupCount): string
    {
        $pair = intdiv($index, 2);
        $flip = $index % 2 === 1;
        $group = ($pair + ($flip ? 1 : 0)) % max(1, $groupCount);
        $place2 = $place === 'W' ? 'R' : 'W';
        $which = $flip ? $place2 : $place;

        return $which === 'W' ? self::groupWinnerRef($group + 1) : self::groupRunnerUpRef($group + 1);
    }

    private static function groupRefLabel(int $index, string $place, int $groupCount): string
    {
        $ref = self::groupRef($index, $place, $groupCount);
        $group = (int) substr($ref, 1, -1);

        return str_ends_with($ref, 'W')
            ? 'Winner '.self::groupLabel($group - 1)
            : 'Runner-up '.self::groupLabel($group - 1);
    }

    /**
     * Who goes through from a group 📈 — points, then goal difference, then
     * goals scored, then name. Reuses the league table so a group can never sort
     * itself differently from the table everybody is reading.
     *
     * @return array{winners: list<int>, table: array<int, array<string, mixed>>}
     */
    public static function groupQualifiers(array $group, array $matches): array
    {
        $table = self::standingsFor($group, $matches);

        return [
            'winners' => array_values(array_map(fn ($r) => $r['teamId'], array_slice($table, 0, 2))),
            'table' => $table,
        ];
    }

    /* ---------------------------------------------------------- squad states */

    public static function isPendingEntry(string $status): bool
    {
        return in_array($status, self::TEAM_PENDING_STATUSES, true);
    }

    public static function isActiveEntry(string $status): bool
    {
        return in_array($status, self::TEAM_ACTIVE_STATUSES, true);
    }

    /**
     * @return array{label: string, emoji: string}
     */
    public static function entryStatusLabel(string $status): array
    {
        return match ($status) {
            self::TEAM_REQUESTED => ['label' => 'Asked to join — host deciding', 'emoji' => '⏳'],
            self::TEAM_INVITED => ['label' => 'Invited — waiting for the captain', 'emoji' => '📨'],
            self::TEAM_APPROVED => ['label' => 'In the league', 'emoji' => '✅'],
            self::TEAM_REJECTED => ['label' => 'Request declined', 'emoji' => '🚫'],
            self::TEAM_DECLINED => ['label' => 'Invite declined', 'emoji' => '🙅'],
            self::TEAM_WITHDRAWN => ['label' => 'Withdrew', 'emoji' => '🏳️'],
            default => ['label' => $status, 'emoji' => '•'],
        };
    }

    /**
     * @return array{label: string, emoji: string}
     */
    public static function leagueStatusLabel(string $status): array
    {
        return match ($status) {
            'registration' => ['label' => 'Taking entries', 'emoji' => '📝'],
            'ongoing' => ['label' => 'Under way', 'emoji' => '🔴'],
            'completed' => ['label' => 'Finished', 'emoji' => '🏁'],
            'cancelled' => ['label' => 'Cancelled', 'emoji' => '🚫'],
            default => ['label' => $status, 'emoji' => '•'],
        };
    }

    /**
     * @return array{label: string, emoji: string}
     */
    public static function leagueVisibilityLabel(string $visibility): array
    {
        return $visibility === 'private'
            ? ['label' => 'Private — invited squads only', 'emoji' => '🔒']
            : ['label' => 'Open listing', 'emoji' => '🌍'];
    }

    /* ------------------------------------------------------------------- money */

    /** The minimum a squad must have paid to hold its place. Rounded up: never short. */
    public static function depositFor(int $entryFee, mixed $depositPercent = null): int
    {
        $fee = max(0, (int) $entryFee);
        $pct = self::clampPercent($depositPercent, self::ENTRY_DEPOSIT_PERCENT);

        if ($fee <= 0 || $pct <= 0) {
            return 0;
        }

        return (int) ceil(($fee * $pct) / 100);
    }

    /** What a departing squad gets back — a tenth of what it paid, rounded down. */
    public static function refundFor(int $paidAmount, mixed $refundPercent = null): int
    {
        $paid = max(0, (int) $paidAmount);
        $pct = self::clampPercent($refundPercent, self::WITHDRAW_REFUND_PERCENT);

        if ($paid <= 0 || $pct <= 0) {
            return 0;
        }

        return (int) floor(($paid * $pct) / 100);
    }

    private static function clampPercent(mixed $value, int $fallback): int
    {
        if ($value === null) {
            return $fallback;
        }

        $n = (float) $value;

        if (! is_finite($n)) {
            return $fallback;
        }

        return min(100, max(0, (int) $n));
    }

    /**
     * One place that answers "where does this squad stand on money?" — used by
     * the host console, the squad's own panel and the listing chip, so the three
     * can never disagree about whether a place is locked.
     *
     * @return array<string, mixed>
     */
    public static function paymentState(array $input): array
    {
        $fee = max(0, (int) round((float) ($input['entryFee'] ?? 0)));
        $paid = max(0, (int) round((float) ($input['paidAmount'] ?? 0)));
        $refunded = max(0, (int) round((float) ($input['refundedAmount'] ?? 0)));

        $deposit = self::depositFor($fee, $input['depositPercent'] ?? null);

        // A squad that has played has no refund coming: the money is the
        // league's, which is the whole reason the deposit was taken before the
        // first kick-off.
        $locked = (bool) ($input['lock']['locked'] ?? false);
        $refundable = $locked ? 0 : self::refundFor($paid, $input['refundPercent'] ?? null);
        $lockReason = $input['lock']['reason'] ?? '';
        $due = max(0, $fee - $paid);
        $depositMet = $paid >= $deposit;

        $tail = [
            'deposit' => $deposit,
            'depositMet' => $depositMet,
            'due' => $due,
            'paid' => $paid,
            'refundable' => $refundable,
            'locked' => $locked,
            'lockReason' => $lockReason,
        ];

        // A squad that backed out, took its refund and came back keeps the old
        // refund on its row, so without this the chip would still read "Backed
        // out" while the squad sits in the league — the refund belongs to the
        // exit, not to the return.
        if (($input['status'] ?? null) === self::TEAM_WITHDRAWN && $refunded > 0 && $due > 0) {
            return ['status' => 'refunded', 'label' => 'Backed out — part refunded', 'emoji' => '↩️'] + $tail;
        }

        if ($fee <= 0) {
            return [
                'status' => 'paid', 'label' => 'Free entry', 'emoji' => '🎟️',
                'deposit' => 0, 'depositMet' => true, 'due' => 0, 'paid' => $paid,
                'refundable' => $refundable, 'locked' => $locked, 'lockReason' => $lockReason,
            ];
        }

        if ($paid <= 0) {
            return ['status' => 'unpaid', 'label' => 'Nothing paid yet', 'emoji' => '🕓'] + $tail;
        }

        if ($paid < $deposit) {
            $short = $deposit - $paid;
            $percent = (int) round(($deposit / max(1, $fee)) * 100);

            return [
                'status' => 'partial',
                'label' => "Rs. {$short} short of the {$percent}% deposit",
                'emoji' => '🟠',
            ] + $tail;
        }

        if ($due > 0) {
            return ['status' => 'deposit', 'label' => "Deposit in — Rs. {$due} to settle", 'emoji' => '🟢'] + $tail;
        }

        return ['status' => 'paid', 'label' => 'Entry fee paid in full', 'emoji' => '💯', 'due' => 0] + $tail;
    }

    /* ------------------------------------------------------- the money lock 🔒 */

    /**
     * Once a squad takes the field, its entry fee belongs to the league.
     *
     * Two ways in, because both mean the money has been earned: the squad has a
     * result on the board, or one of its fixtures has a kick-off time behind it.
     * A fixture the host voided doesn't count — nobody played it.
     *
     * @return array{locked: bool, reason: string}
     */
    public static function moneyLockedFor(int $teamId, array $matches, mixed $now = null): array
    {
        $mine = array_values(array_filter($matches, fn ($m) => (int) ($m['homeTeamId'] ?? 0) === $teamId
            || (int) ($m['awayTeamId'] ?? 0) === $teamId));

        foreach ($mine as $m) {
            if (self::hasResult($m) && ($m['status'] ?? null) !== 'void') {
                return [
                    'locked' => true,
                    'reason' => 'You’ve played in this league — the entry fee is locked in and stays with it 🔒',
                ];
            }
        }

        foreach ($mine as $m) {
            if (($m['status'] ?? null) !== 'void' && self::startedAt($m, $now)) {
                $when = ! empty($m['date']) ? self::leagueDateLabel((string) $m['date']).' ' : '';

                return [
                    'locked' => true,
                    'reason' => "Your {$when}match has kicked off — the entry fee is locked in and stays with the league 🔒",
                ];
            }
        }

        return ['locked' => false, 'reason' => ''];
    }

    /** Has this fixture's kick-off passed? A date with no time counts from midnight. */
    private static function startedAt(array $m, mixed $now): bool
    {
        $d = trim((string) ($m['date'] ?? ''));

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) !== 1) {
            return false;
        }

        $t = preg_match('/^\d{2}:\d{2}$/', trim((string) ($m['startTime'] ?? ''))) === 1
            ? trim((string) $m['startTime'])
            : '00:00';

        try {
            $kickOff = new \DateTimeImmutable("{$d}T{$t}:00");
        } catch (\Throwable) {
            return false;
        }

        return ($now ? \Illuminate\Support\Carbon::parse($now) : now())->greaterThan($kickOff);
    }

    /**
     * The answer the withdraw button gets. The captain is turned away once the
     * money is locked; the host may still take a squad out of the league
     * (somebody has to be able to), but not hand back money the league earned.
     *
     * @return array{ok: bool, reason: string, refundBlocked: bool}
     */
    public static function withdrawCheck(array $input): array
    {
        $who = ! empty($input['teamName']) ? $input['teamName'].'’s' : 'the';

        if (! ($input['lock']['locked'] ?? false)) {
            return ['ok' => true, 'reason' => '', 'refundBlocked' => false];
        }

        if (! empty($input['isHost'])) {
            return [
                'ok' => true,
                'reason' => "{$who} money is locked — they can be taken out of the league, but nothing is refunded.",
                'refundBlocked' => true,
            ];
        }

        return [
            'ok' => false,
            'reason' => ($input['lock']['reason'] ?? '')." Withdrawing closed when {$who} first match kicked off — talk to the host if something’s genuinely wrong 🙏",
            'refundBlocked' => true,
        ];
    }

    /**
     * May this squad be let in? A squad holds a place once the deposit is in the
     * till — cash the host entered themselves counts, because half of Nepal still
     * settles this on the sideline.
     *
     * @return array{ok: bool, reason: string}
     */
    public static function approvalCheck(array $input): array
    {
        $fee = max(0, (int) round((float) ($input['entryFee'] ?? 0)));
        $paid = max(0, (int) round((float) ($input['paidAmount'] ?? 0)));
        $deposit = self::depositFor($fee, $input['depositPercent'] ?? null);

        if ($fee <= 0 || $deposit <= 0) {
            return ['ok' => true, 'reason' => ''];
        }

        if ($paid >= $deposit) {
            return ['ok' => true, 'reason' => ''];
        }

        return [
            'ok' => false,
            'reason' => 'Rs. '.($deposit - $paid)." of the Rs. {$deposit} deposit is still missing ("
                .self::ENTRY_DEPOSIT_PERCENT."% of the Rs. {$fee} entry fee). Ask the captain to pay it from the league page, or record the cash they handed you.",
        ];
    }

    /* -------------------------------------------------------------- prize lines */

    /**
     * "Champion: Rs. 40,000 / Runner-up: Rs. 20,000" → rows.
     *
     * Free text box in, structured list out: the host keeps writing the split
     * the way they'd say it out loud. A line without a colon ("Trophy + free
     * hours") still counts — the whole thing is one prize.
     *
     * @return list<array{place: string, prize: string}>
     */
    public static function parsePrizeBreakdown(string $text): array
    {
        $lines = array_slice(array_values(array_filter(array_map('trim', explode("\n", (string) $text))), fn ($l) => $l !== ''), 0, 12);
        $out = [];

        foreach ($lines as $line) {
            $at = strpos($line, ':');

            if ($at === false || $at === 0) {
                $out[] = ['place' => 'Prize', 'prize' => $line];
                continue;
            }

            $out[] = ['place' => trim(substr($line, 0, $at)), 'prize' => trim(substr($line, $at + 1))];
        }

        return array_values(array_filter($out, fn ($row) => $row['prize'] !== ''));
    }

    /* ------------------------------------------------------------------ labels */

    public static function leagueDateLabel(string $iso): string
    {
        $t = trim($iso);

        if ($t === '') {
            return 'TBD';
        }

        try {
            return \Illuminate\Support\Carbon::parse($t.'T00:00:00')->format('D M j');
        } catch (\Throwable) {
            return $t;
        }
    }
}
