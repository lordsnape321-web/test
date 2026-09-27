<?php

namespace App\Support;

use App\Models\Booking;
use App\Models\Court;
use App\Models\Team;
use App\Models\TeamMember;
use App\Models\Tournament;
use App\Models\TournamentMatch;
use App\Models\TournamentMedia;
use App\Models\TournamentPayment;
use App\Models\TournamentTeam;
use App\Models\User;
use App\Models\Venue;

/**
 * League data access — everything that touches the database for tournaments.
 *
 * The pure rules live in `App\Support\League`; this class is the other half:
 * gathering rows, joining them into the shapes the pages render, and — the part
 * that matters most — deciding **who may see what**. A private league must not
 * leak its table, fixtures or photos to a stranger, and a squad that backed out
 * must lose access to the album it played in. Those checks live here so every
 * route asks the same question and gets the same answer.
 */
class LeagueStore
{
    /* ----------------------------------------------------------------- access */

    /**
     * The three questions every league read starts with: is this viewer the
     * host, which squads do they belong to, and are any of those in the league?
     *
     * @return array<string, mixed>|null
     */
    public static function leagueAccess(int $tournamentId, int $viewerId): ?array
    {
        $rows = TournamentTeam::where('tournament_id', $tournamentId)->get();
        $tournament = Tournament::find($tournamentId);

        if (! $tournament) {
            return null;
        }

        $isHost = $viewerId > 0 && (int) $tournament->host_id === $viewerId;

        $myTeamIds = [];

        if ($viewerId > 0) {
            $mine = TeamMember::where('user_id', $viewerId)->pluck('team_id')->map(fn ($v) => (int) $v)->all();
            $myTeamIds = $rows->filter(fn ($r) => in_array((int) $r->team_id, $mine, true))
                ->pluck('team_id')->map(fn ($v) => (int) $v)->all();
        }

        $liveRows = $rows->filter(fn ($r) => $r->status !== League::TEAM_WITHDRAWN)->values();

        // A squad that withdrew keeps its history but loses the private rooms:
        // fixtures and albums are for the squads still in the fight.
        $myLive = $rows->filter(fn ($r) => in_array((int) $r->team_id, $myTeamIds, true)
            && in_array($r->status, [League::TEAM_APPROVED, League::TEAM_INVITED, League::TEAM_REQUESTED], true));

        $inLeague = $myLive->isNotEmpty();

        $canSeeInside = $isHost
            || $inLeague
            || ($tournament->visibility === 'public'
                && $rows->contains(fn ($r) => in_array((int) $r->team_id, $myTeamIds, true) && $r->status === League::TEAM_APPROVED));

        return [
            'tournament' => $tournament,
            'rows' => $rows,
            'liveRows' => $liveRows,
            'isHost' => $isHost,
            'myTeamIds' => $myTeamIds,
            'canSeeInside' => $canSeeInside,
        ];
    }

    public static function isLeagueHost(int $tournamentId, int $userId): bool
    {
        $t = Tournament::find($tournamentId);

        return $t && (int) $t->host_id === $userId;
    }

    /**
     * Which squads played a given fixture — the guest list for that fixture's
     * album. A photo of the semi-final belongs to the two teams in it, not to
     * the whole league.
     *
     * @return list<int>
     */
    public static function squadsInMatch(int $matchId): array
    {
        $m = TournamentMatch::find($matchId);

        return $m ? [(int) $m->home_team_id, (int) $m->away_team_id] : [];
    }

    /** The album rule, in one function: host always, a squad only for its own games. */
    public static function canViewMedia(array $media, array $matchTeamIds, array $viewer): bool
    {
        if (! empty($viewer['isHost'])) {
            return true;
        }

        if (empty($viewer['canSeeInside'])) {
            return false;
        }

        // A league-wide album is open to any squad in the league.
        if (($media['matchId'] ?? null) === null) {
            return true;
        }

        return collect($matchTeamIds)->contains(fn ($id) => in_array((int) $id, $viewer['teamIds'] ?? [], true));
    }

    private static function iso(mixed $value): ?string
    {
        if (! $value) {
            return null;
        }

        try {
            return \Illuminate\Support\Carbon::parse($value)->toISOString();
        } catch (\Throwable) {
            return null;
        }
    }

    /* -------------------------------------------------------------- summaries */

    /**
     * The list the leagues page (and the home rail) renders.
     *
     * `viewerId` decides what is even in the result set: public leagues always,
     * private ones only for their host and the squads invited to or in them.
     *
     * @return list<array<string, mixed>>
     */
    public static function listLeagues(array $opts = []): array
    {
        $viewerId = (int) ($opts['viewerId'] ?? 0) ?: 0;

        $all = Tournament::all();
        $allTeams = Team::all()->keyBy('id');
        $allVenues = Venue::all()->keyBy('id');
        $allUsers = User::all()->keyBy('id');
        $allMatches = TournamentMatch::all();
        $allEntries = TournamentTeam::all();

        $myTeamIds = [];

        if ($viewerId > 0) {
            $myTeamIds = TeamMember::where('user_id', $viewerId)->pluck('team_id')->map(fn ($v) => (int) $v)->all();
        }

        $q = mb_strtolower(trim((string) ($opts['q'] ?? '')));
        $rows = $all->values();

        if (! empty($opts['hostId'])) {
            $rows = $rows->filter(fn ($t) => (int) $t->host_id === (int) $opts['hostId'])->values();
        }

        if (! empty($opts['venueId'])) {
            $rows = $rows->filter(fn ($t) => (int) $t->venue_id === (int) $opts['venueId'])->values();
        }

        if (! empty($opts['status'])) {
            $rows = $rows->filter(fn ($t) => $t->status === $opts['status'])->values();
        }

        $rows = $rows->filter(function ($t) use ($allEntries, $myTeamIds, $viewerId) {
            if ($t->visibility === 'public') {
                return true;
            }

            // Private: host, invited squads and squads already in it — nobody
            // else, not even in a list they'd have to know the name of.
            $mine = $allEntries->filter(fn ($e) => (int) $e->tournament_id === (int) $t->id
                && in_array((int) $e->team_id, $myTeamIds, true));

            if ($viewerId > 0 && (int) $t->host_id === $viewerId) {
                return true;
            }

            return $mine->contains(fn ($e) => in_array($e->status, [League::TEAM_APPROVED, League::TEAM_INVITED, League::TEAM_REQUESTED], true));
        })->values();

        if ($q !== '') {
            $rows = $rows->filter(function ($t) use ($q, $allVenues) {
                $venue = $allVenues->get((int) $t->venue_id);
                $hay = mb_strtolower($t->name.' '.($venue->name ?? '').' '.($venue->city ?? '').' '.$t->format);

                return str_contains($hay, $q);
            })->values();
        }

        // Leagues with games coming up first, then the ones taking entries.
        $rows = $rows->sort(function ($a, $b) {
            $rank = fn ($s) => $s === 'ongoing' ? 0 : ($s === 'registration' ? 1 : 2);

            return ($rank((string) $a->status) <=> $rank((string) $b->status))
                ?: strcmp((string) $a->starts_at, (string) $b->starts_at);
        })->values();

        $out = [];

        foreach ($rows->slice(0, (int) ($opts['limit'] ?? 60)) as $t) {
            $entries = $allEntries->filter(fn ($e) => (int) $e->tournament_id === (int) $t->id)->values();
            $approved = $entries->filter(fn ($e) => $e->status === League::TEAM_APPROVED)->values();
            $pending = $entries->filter(fn ($e) => $e->status === League::TEAM_REQUESTED || $e->status === League::TEAM_INVITED)->values();

            $venue = $allVenues->get((int) $t->venue_id);
            $host = $allUsers->get((int) $t->host_id);
            $matches = $allMatches->filter(fn ($m) => (int) $m->tournament_id === (int) $t->id)->values();

            $teamLikes = $approved->map(function ($e) use ($allTeams) {
                $team = $allTeams->get((int) $e->team_id);

                if (! $team) {
                    return null;
                }

                return [
                    'teamId' => $team->id,
                    'name' => $team->name,
                    'logoColor' => $team->logo_color,
                    'teamCode' => $team->team_code ?? '',
                ];
            })->filter()->values()->all();

            $myTeams = $entries
                ->filter(fn ($e) => in_array((int) $e->team_id, $myTeamIds, true))
                ->map(function ($e) use ($allTeams, $t, $matches, $viewerId) {
                    $team = $allTeams->get((int) $e->team_id);

                    return [
                        'teamId' => (int) $e->team_id,
                        'teamName' => $team->name ?? 'Your squad',
                        'status' => $e->status,
                        'isCaptain' => $team && (int) $team->captain_id === $viewerId,
                        'paidAmount' => (int) $e->paid_amount,
                        'payment' => League::paymentState([
                            'entryFee' => (int) $t->entry_fee,
                            'paidAmount' => (int) $e->paid_amount,
                            'refundedAmount' => (int) $e->refunded_amount,
                            'depositPercent' => $t->deposit_percent,
                            'refundPercent' => $t->refund_percent,
                            'lock' => League::moneyLockedFor((int) $e->team_id, $matches->all()),
                            'status' => $e->status,
                        ]),
                    ];
                })->values()->all();

            $isHost = $viewerId > 0 && (int) $t->host_id === $viewerId;

            $mineInLeague = collect($myTeams)->contains(
                fn ($m) => in_array($m['status'], [League::TEAM_APPROVED, League::TEAM_INVITED, League::TEAM_REQUESTED], true)
            );

            $out[] = [
                'id' => $t->id,
                'name' => $t->name,
                'format' => $t->format,
                'mode' => $t->mode,
                'thirdPlace' => (bool) $t->third_place,
                'groupSize' => (int) $t->group_size,
                'maxTeams' => (int) $t->max_teams,
                'entryFee' => (int) $t->entry_fee,
                'depositPercent' => (int) $t->deposit_percent,
                'refundPercent' => (int) $t->refund_percent,
                'deposit' => League::depositFor((int) $t->entry_fee, $t->deposit_percent),
                'prizePool' => (int) $t->prize_pool,
                'startsAt' => $t->starts_at,
                'endsAt' => $t->ends_at,
                'closesAt' => $t->closes_at,
                'matchDays' => $t->match_days,
                'visibility' => $t->visibility,
                'status' => $t->status,
                'bannerUrl' => $t->banner_url,
                'description' => $t->description,
                'hostId' => $t->host_id,
                'hostName' => $host->name ?? 'Host',
                'hostRole' => $t->host_role,
                'venueId' => $t->venue_id,
                'venueName' => $venue->name ?? 'Ground to be confirmed',
                'venueCity' => $venue->city ?? '',
                'approvedTeams' => $approved->count(),
                // A pending count is only interesting to the host — the public
                // card shows spots left, not who is waiting on a decision.
                'pendingTeams' => $isHost ? $pending->count() : 0,
                'playedMatches' => $matches->filter(fn ($m) => $m->status === 'played')->count(),
                'totalMatches' => $matches->count(),
                'teams' => $teamLikes,
                'standings' => League::standingsFor($teamLikes, $matches->all()),
                'viewer' => $viewerId > 0 ? [
                    'isHost' => $isHost,
                    'myTeams' => $myTeams,
                    'canSeeInside' => $isHost || $mineInLeague,
                ] : null,
            ];
        }

        return $out;
    }

    /** Everything one league page needs, already filtered for this viewer. */
    public static function leagueDetail(int $tournamentId, int $viewerId): ?array
    {
        $access = self::leagueAccess($tournamentId, $viewerId);

        if (! $access) {
            return null;
        }

        $t = $access['tournament'];
        $isHost = $access['isHost'];
        $myTeamIds = $access['myTeamIds'];
        $canSeeInside = $access['canSeeInside'];

        $allTeams = Team::all()->keyBy('id');
        $allUsers = User::all()->keyBy('id');
        $allVenues = Venue::all()->keyBy('id');
        $allCourts = Court::all()->keyBy('id');
        $allMatches = TournamentMatch::where('tournament_id', (int) $t->id)->get();
        $allMedia = TournamentMedia::where('tournament_id', (int) $t->id)->get();
        $allPayments = TournamentPayment::where('tournament_id', (int) $t->id)->get();
        $allEntries = TournamentTeam::where('tournament_id', (int) $t->id)->get();

        $teamById = fn ($id) => $allTeams->get((int) $id);
        $userById = fn ($id) => $allUsers->get((int) $id);

        $memberCounts = TeamMember::all();

        $teamRows = $allEntries->map(function ($e) use ($teamById, $userById, $memberCounts, $t, $allMatches) {
            $team = $teamById($e->team_id);

            return [
                'teamId' => (int) $e->team_id,
                'name' => $team->name ?? 'Removed squad',
                'teamCode' => $team->team_code ?? '',
                'logoColor' => $team->logo_color ?? '#16a34a',
                'level' => $team->level ?? 'Intermediate',
                'homeGround' => $team->home_ground ?? '',
                'captainId' => $team->captain_id ?? 0,
                'captainName' => $userById($team->captain_id ?? 0)?->name ?? '',
                'memberCount' => $memberCounts->filter(fn ($m) => (int) $m->team_id === (int) $e->team_id)->count(),
                'status' => $e->status,
                'message' => $e->message,
                'requestedBy' => $e->requested_by,
                'paidAmount' => (int) $e->paid_amount,
                'refundedAmount' => (int) $e->refunded_amount,
                'payMethod' => $e->pay_method,
                'receiptUrl' => $e->receipt_url,
                'payment' => League::paymentState([
                    'entryFee' => (int) $t->entry_fee,
                    'paidAmount' => (int) $e->paid_amount,
                    'refundedAmount' => (int) $e->refunded_amount,
                    'depositPercent' => $t->deposit_percent,
                    'refundPercent' => $t->refund_percent,
                    'lock' => League::moneyLockedFor((int) $e->team_id, $allMatches->all()),
                    'status' => $e->status,
                ]),
                'createdAt' => self::iso($e->created_at),
                'decidedAt' => self::iso($e->decided_at),
            ];
        })->values()->all();

        $approvedIds = collect($teamRows)->filter(fn ($r) => $r['status'] === League::TEAM_APPROVED)->pluck('teamId')->all();

        $matchRows = $allMatches
            ->sort(fn ($a, $b) => strcmp((string) $a->date, (string) $b->date) ?: ((int) $a->id <=> (int) $b->id))
            ->values()
            ->map(function ($m) use ($teamById, $allMedia) {
                return [
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
                    // An empty bracket slot is named by where its squad will come
                    // from, so the card reads "Winner Group A" instead of "Squad".
                    'homeTeamName' => $teamById($m->home_team_id)?->name ?? ($m->home_label ?: 'TBD'),
                    'awayTeamName' => $teamById($m->away_team_id)?->name ?? ($m->away_label ?: 'TBD'),
                    'homeLogoColor' => $teamById($m->home_team_id)?->logo_color ?? '#16a34a',
                    'awayLogoColor' => $teamById($m->away_team_id)?->logo_color ?? '#2563eb',
                    'date' => $m->date,
                    'startTime' => $m->start_time,
                    'courtId' => $m->court_id,
                    'homeScore' => $m->home_score,
                    'awayScore' => $m->away_score,
                    'status' => $m->status,
                    'bookingId' => $m->booking_id,
                    'notes' => $m->notes,
                    'updatedAt' => self::iso($m->updated_at),
                    'mediaCount' => $allMedia->filter(fn ($x) => (int) $x->match_id === (int) $m->id)->count(),
                ];
            })->values()->all();

        // Fixtures stay hidden from people with no business reading them. Within
        // the league everyone sees every fixture — that is what a league is.
        $visibleMatches = $canSeeInside ? $matchRows : [];

        $mediaRows = $allMedia
            ->map(fn ($m) => ['m' => $m, 'squadIds' => $m->match_id ? self::matchTeams((int) $m->match_id, $matchRows) : []])
            ->filter(fn ($x) => self::canViewMedia(
                ['matchId' => $x['m']->match_id !== null ? (int) $x['m']->match_id : null],
                $x['squadIds'],
                ['isHost' => $isHost, 'teamIds' => $myTeamIds, 'canSeeInside' => $canSeeInside]
            ))
            ->sortByDesc(fn ($x) => $x['m']->created_at?->getTimestamp() ?? 0)
            ->values()
            ->map(function ($x) use ($matchRows, $userById) {
                $m = $x['m'];
                $match = $m->match_id ? collect($matchRows)->firstWhere('id', (int) $m->match_id) : null;

                return [
                    'id' => $m->id,
                    'matchId' => $m->match_id,
                    'kind' => $m->kind,
                    'url' => $m->url,
                    'caption' => $m->caption,
                    'credit' => $m->credit,
                    'uploadedBy' => $m->uploaded_by,
                    'uploaderName' => $userById($m->uploaded_by)?->name ?? 'Host',
                    'createdAt' => self::iso($m->created_at),
                    'scope' => $match
                        ? "{$match['round']} • {$match['homeTeamName']} vs {$match['awayTeamName']}"
                        : 'Whole league',
                ];
            })->values()->all();

        // The ledger is the host's bookkeeping; a captain sees their own row
        // through the squad panel instead.
        $paymentRows = $isHost
            ? $allPayments
                ->sortByDesc(fn ($p) => $p->created_at?->getTimestamp() ?? 0)
                ->values()
                ->map(fn ($p) => [
                    'id' => $p->id,
                    'teamId' => $p->team_id,
                    'teamName' => $teamById($p->team_id)?->name ?? 'Squad',
                    'userId' => $p->user_id,
                    'kind' => $p->kind,
                    'amount' => (int) $p->amount,
                    'method' => $p->method,
                    'reference' => $p->reference,
                    'recordedBy' => $p->recorded_by,
                    'createdAt' => self::iso($p->created_at),
                ])->all()
            : [];

        $venue = $allVenues->get((int) $t->venue_id);
        $court = $allCourts->get((int) $t->court_id);
        $host = $userById($t->host_id);

        $teamLikes = collect($approvedIds)->map(function ($id) use ($teamById) {
            $team = $teamById($id);

            return $team ? [
                'teamId' => $team->id,
                'name' => $team->name,
                'logoColor' => $team->logo_color,
                'teamCode' => $team->team_code ?? '',
            ] : null;
        })->filter()->values()->all();

        $myTeams = collect($teamRows)
            ->filter(fn ($r) => in_array((int) $r['teamId'], $myTeamIds, true))
            ->map(fn ($r) => [
                'teamId' => $r['teamId'],
                'teamName' => $r['name'],
                'status' => $r['status'],
                'isCaptain' => (int) $r['captainId'] === $viewerId,
                'paidAmount' => $r['paidAmount'],
                'payment' => $r['payment'],
            ])->values()->all();

        return [
            'id' => $t->id,
            'name' => $t->name,
            'format' => $t->format,
            'mode' => $t->mode,
            'thirdPlace' => (bool) $t->third_place,
            'groupSize' => (int) $t->group_size,
            'maxTeams' => (int) $t->max_teams,
            'entryFee' => (int) $t->entry_fee,
            'depositPercent' => (int) $t->deposit_percent,
            'refundPercent' => (int) $t->refund_percent,
            'deposit' => League::depositFor((int) $t->entry_fee, $t->deposit_percent),
            'prizePool' => (int) $t->prize_pool,
            'startsAt' => $t->starts_at,
            'endsAt' => $t->ends_at,
            'closesAt' => $t->closes_at,
            'matchDays' => $t->match_days,
            'visibility' => $t->visibility,
            'status' => $t->status,
            'bannerUrl' => $t->banner_url,
            'description' => $t->description,
            'hostId' => $t->host_id,
            'hostName' => $host->name ?? 'Host',
            'hostRole' => $t->host_role,
            'venueId' => $t->venue_id,
            'venueName' => $venue->name ?? 'Ground to be confirmed',
            'venueCity' => $venue->city ?? '',
            'approvedTeams' => count($approvedIds),
            'pendingTeams' => $isHost
                ? collect($teamRows)->filter(fn ($r) => $r['status'] === League::TEAM_REQUESTED || $r['status'] === League::TEAM_INVITED)->count()
                : 0,
            'playedMatches' => collect($matchRows)->filter(fn ($m) => $m['status'] === 'played')->count(),
            'totalMatches' => count($matchRows),
            'teams' => $teamLikes,
            'standings' => League::standingsFor($teamLikes, $matchRows),
            'viewer' => ['isHost' => $isHost, 'myTeams' => $myTeams, 'canSeeInside' => $canSeeInside],
            'courtId' => $t->court_id,
            'courtName' => $court->name ?? '',
            'rules' => $t->rules,
            'contactPhone' => $t->contact_phone,
            'prizeBreakdown' => $t->prize_breakdown,
            'prizeLines' => League::parsePrizeBreakdown((string) $t->prize_breakdown),
            'allTeams' => $isHost
                ? $teamRows
                : array_values(array_filter($teamRows, fn ($r) => $r['status'] === League::TEAM_APPROVED)),
            'matches' => $visibleMatches,
            'media' => $mediaRows,
            'payments' => $paymentRows,
            'myTeamIds' => $myTeamIds,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $matches
     * @return list<int>
     */
    private static function matchTeams(int $matchId, array $matches): array
    {
        $m = collect($matches)->firstWhere('id', $matchId);

        return $m ? [(int) $m['homeTeamId'], (int) $m['awayTeamId']] : [];
    }

    /* ------------------------------------------------------ squad-facing views */

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
        return TournamentPayment::where('tournament_id', $tournamentId)
            ->get()
            ->filter(fn (TournamentPayment $p) => (int) $p->team_id === $teamId)
            ->sortByDesc(fn (TournamentPayment $p) => $p->created_at?->getTimestamp() ?? 0)
            ->values()
            ->map(fn (TournamentPayment $p) => [
                'id' => $p->id,
                'kind' => $p->kind,
                'amount' => (int) $p->amount,
                'method' => $p->method,
                'reference' => $p->reference,
                'createdAt' => self::iso($p->created_at),
            ])->all();
    }

    /**
     * Recompute one squad's running totals from the ledger.
     *
     * The ledger is the truth; `tournament_teams.paid_amount` is a cache of it so
     * a listing can render a chip without summing rows. Every write to
     * `tournament_payments` is followed by this, and the two-column `where`
     * matters: a filter on the tournament alone would stamp every squad in the
     * league with one team's numbers.
     *
     * @return array{paidAmount: int, refundedAmount: int}
     */
    public static function recalcTeamTotals(int $tournamentId, int $teamId): array
    {
        $mine = TournamentPayment::where('tournament_id', $tournamentId)
            ->get()
            ->filter(fn (TournamentPayment $p) => (int) $p->team_id === $teamId);

        $paidAmount = (int) $mine->filter(fn ($p) => $p->kind === 'entry')->sum('amount');
        $refundedAmount = (int) $mine->filter(fn ($p) => $p->kind === 'refund')->sum('amount');

        TournamentTeam::where('tournament_id', $tournamentId)
            ->where('team_id', $teamId)
            ->update([
                'paid_amount' => $paidAmount,
                'refunded_amount' => $refundedAmount,
                'updated_at' => now(),
            ]);

        return ['paidAmount' => $paidAmount, 'refundedAmount' => $refundedAmount];
    }

    /** Which squads does this user captain? Used to gate "request to join". */
    public static function captainedTeams(int $userId): array
    {
        if ($userId <= 0) {
            return [];
        }

        return Team::where('captain_id', $userId)->get()
            ->map(fn (Team $t) => [
                'id' => $t->id,
                'name' => $t->name,
                'teamCode' => $t->team_code ?? '',
                'logoColor' => $t->logo_color,
            ])->all();
    }

    /** Squads a user belongs to (any role) — for the league pickers. */
    public static function myTeamsWithLeagues(int $userId): array
    {
        if ($userId <= 0) {
            return [];
        }

        $memberships = TeamMember::where('user_id', $userId)->get();
        $allTeams = Team::all()->keyBy('id');
        $allEntries = TournamentTeam::all();
        $allTournaments = Tournament::all()->keyBy('id');

        $out = [];

        foreach ($memberships as $m) {
            $team = $allTeams->get((int) $m->team_id);

            if (! $team) {
                continue;
            }

            $entries = $allEntries->filter(fn ($e) => (int) $e->team_id === (int) $team->id && $e->status === League::TEAM_APPROVED);

            $out[] = [
                'id' => $team->id,
                'name' => $team->name,
                'logoColor' => $team->logo_color,
                'teamCode' => $team->team_code ?? '',
                'isCaptain' => (int) $team->captain_id === $userId,
                'leagues' => $entries->map(function ($e) use ($allTournaments) {
                    $t = $allTournaments->get((int) $e->tournament_id);

                    return $t ? [
                        'id' => $t->id,
                        'name' => $t->name,
                        'visibility' => $t->visibility,
                        'status' => $t->status,
                    ] : null;
                })->filter()->values()->all(),
            ];
        }

        return $out;
    }

    /** Approved squads of a league — the teams a competition fixture may pick from. */
    public static function approvedSquads(int $tournamentId): array
    {
        $entries = TournamentTeam::where('tournament_id', $tournamentId)->get();
        $allTeams = Team::all()->keyBy('id');

        return $entries
            ->filter(fn ($e) => $e->status === League::TEAM_APPROVED)
            ->map(function ($e) use ($allTeams) {
                $team = $allTeams->get((int) $e->team_id);

                return $team ? [
                    'teamId' => $team->id,
                    'name' => $team->name,
                    'logoColor' => $team->logo_color,
                    'teamCode' => $team->team_code ?? '',
                    'captainId' => $team->captain_id,
                ] : null;
            })
            ->filter()
            ->values()
            ->all();
    }

    /** Leagues a venue owner may host at (their own grounds), for the host form. */
    public static function ownedVenues(int $ownerId): array
    {
        return Venue::where('owner_id', $ownerId)->get()
            ->map(fn (Venue $v) => ['id' => $v->id, 'name' => $v->name, 'city' => $v->city])
            ->all();
    }

    /** Every venue is hostable by a player too — a league needs a ground, not an owner. */
    public static function allVenues(): array
    {
        return Venue::all()->map(fn (Venue $v) => ['id' => $v->id, 'name' => $v->name, 'city' => $v->city])->all();
    }
}
