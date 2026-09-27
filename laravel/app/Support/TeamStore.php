<?php

namespace App\Support;

use App\Models\MatchJoin;
use App\Models\OpenMatch;
use App\Models\Review;
use App\Models\Team;
use App\Models\TeamInvite;
use App\Models\TeamMember;
use App\Models\TeamRequest;
use App\Models\User;
use App\Models\Venue;

/**
 * Everything the app knows about squads — `src/lib/team-store.ts`.
 *
 * The rules that matter live here rather than in the route handlers: who counts
 * as a member, who counts as the captain, and how many times a squad (or a
 * player) may ask today. `App\Support\Teams` holds the pure arithmetic; this
 * class is where the rows are read.
 */
class TeamStore
{
    /** Every team `userId` belongs to: squads they captain first, then alphabetical. */
    public static function teamsForUser(int $userId): array
    {
        if ($userId <= 0) {
            return [];
        }

        $mine = TeamMember::where('user_id', $userId)->get();

        if ($mine->isEmpty()) {
            return [];
        }

        $teams = Team::all()->keyBy('id');
        $allMembers = TeamMember::all();

        $out = [];

        foreach ($mine as $m) {
            $t = $teams->get((int) $m->team_id);

            // A membership row whose team is gone contributes nothing.
            if (! $t) {
                continue;
            }

            $out[] = [
                'id' => $t->id,
                'name' => $t->name,
                'teamCode' => $t->team_code ?? '',
                'memberCount' => $allMembers->filter(fn ($x) => (int) $x->team_id === (int) $t->id)->count(),
                'logoColor' => $t->logo_color,
                'level' => $t->level,
                // Derived from `teams.captain_id` rather than the membership row,
                // so the two can never disagree about who leads the squad.
                'role' => (int) $t->captain_id === $userId ? 'captain' : 'player',
                'motto' => $t->motto,
                'description' => $t->description ?? '',
                'maxPlayers' => (int) $t->max_players,
                'wins' => (int) $t->wins,
                'draws' => (int) $t->draws,
                'losses' => (int) $t->losses,
                'homeGround' => $t->home_ground,
                'lookingForPlayers' => (bool) $t->looking_for_players,
            ];
        }

        usort($out, fn ($a, $b) => ($a['role'] === 'captain' ? 0 : 1) <=> ($b['role'] === 'captain' ? 0 : 1)
            ?: strcmp($a['name'], $b['name']));

        return $out;
    }

    /**
     * Authority check for POST /api/bookings: resolves the team only when the
     * player is genuinely a member, so a hand-edited request cannot attach a
     * booking to a squad they have nothing to do with. The returned `name` is
     * what gets snapshotted onto the booking — never the client's label.
     *
     * @return array{id: int, name: string}|null
     */
    public static function findTeamForUser(mixed $teamId, mixed $userId): ?array
    {
        $teamId = (int) $teamId;
        $userId = (int) $userId;

        if ($teamId <= 0 || $userId <= 0) {
            return null;
        }

        if (! Team::where('id', $teamId)->exists()) {
            return null;
        }

        if (! TeamMember::where('team_id', $teamId)->where('user_id', $userId)->exists()) {
            return null;
        }

        $team = Team::find($teamId);

        return ['id' => $team->id, 'name' => $team->name];
    }

    /** Is this code already taken? `$excludeTeamId` lets a team keep its own. */
    public static function teamCodeTaken(mixed $code, int $excludeTeamId = 0): bool
    {
        $wanted = Teams::normalizeCode($code);

        if ($wanted === '') {
            return false;
        }

        // Compared after normalising both sides, so a legacy or hand-seeded row
        // stored in a different case still blocks the duplicate.
        return Team::all()->contains(fn (Team $r) => (int) $r->id !== $excludeTeamId
            && Teams::normalizeCode($r->team_code ?? '') === $wanted);
    }

    /** Look a team up by its unique code — what the search box uses. */
    public static function findTeamByCode(mixed $code): ?Team
    {
        $wanted = Teams::normalizeCode($code);

        if ($wanted === '') {
            return null;
        }

        return Team::all()->first(fn (Team $r) => Teams::normalizeCode($r->team_code ?? '') === $wanted);
    }

    /**
     * Search by code (exact or prefix) or by name (substring). Codes match first
     * so typing a full code always lands on that exact squad.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function searchTeams(mixed $query, int $limit = 20): array
    {
        $q = trim((string) ($query ?? ''));
        $code = Teams::normalizeCode($q);

        $all = Team::all();
        $members = TeamMember::all();

        $hits = $q === '' ? $all : $all->filter(function (Team $t) use ($q, $code) {
            $tc = Teams::normalizeCode($t->team_code ?? '');

            return (($code !== '' && (str_starts_with($tc, $code))) || str_contains(mb_strtolower($t->name), mb_strtolower($q)));
        })->values();

        $rank = function (Team $t) use ($code) {
            $tc = Teams::normalizeCode($t->team_code ?? '');

            if ($code !== '' && $tc === $code) {
                return 0;
            }

            return ($code !== '' && str_starts_with($tc, $code)) ? 1 : 2;
        };

        return $hits
            ->sort(fn ($a, $b) => $rank($a) <=> $rank($b) ?: strcmp($a->name, $b->name))
            ->values()
            ->slice(0, max(1, $limit))
            ->map(fn (Team $t) => $t->toArray() + [
                'memberCount' => $members->filter(fn ($m) => (int) $m->team_id === (int) $t->id)->count(),
            ])
            ->values()
            ->all();
    }

    /** @return array<int, int> */
    public static function pendingRequestCounts(array $teamIds): array
    {
        if ($teamIds === []) {
            return [];
        }

        $rows = TeamRequest::whereIn('team_id', $teamIds)->where('status', Teams::REQUEST_PENDING)->get();
        $out = [];

        foreach ($rows as $r) {
            $out[(int) $r->team_id] = ($out[(int) $r->team_id] ?? 0) + 1;
        }

        return $out;
    }

    /** Only the captain manages a squad — the gate every mutation goes through. */
    public static function isCaptain(int $teamId, int $userId): bool
    {
        if ($teamId <= 0 || $userId <= 0) {
            return false;
        }

        $team = Team::find($teamId);

        return $team && (int) $team->captain_id === $userId;
    }

    public static function isMember(int $teamId, int $userId): bool
    {
        if ($teamId <= 0 || $userId <= 0) {
            return false;
        }

        return TeamMember::where('team_id', $teamId)->where('user_id', $userId)->exists();
    }

    /** The full roster with profiles, captain first. */
    public static function teamRoster(int $teamId): array
    {
        if ($teamId <= 0) {
            return [];
        }

        $team = Team::find($teamId);

        if (! $team) {
            return [];
        }

        $memberships = TeamMember::where('team_id', $teamId)->get();

        if ($memberships->isEmpty()) {
            return [];
        }

        $people = User::whereIn('id', $memberships->pluck('user_id')->all())->get()->keyBy('id');

        $out = [];

        foreach ($memberships as $m) {
            $u = $people->get((int) $m->user_id);

            if (! $u) {
                continue;
            }

            $captain = (int) $team->captain_id === (int) $u->id;

            $out[] = [
                'userId' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'avatarColor' => $u->avatar_color,
                'avatarUrl' => $u->avatar_url ?? '',
                'position' => $u->position,
                'level' => $u->level,
                // Derived from `teams.captain_id` so the roster can never show
                // two captains.
                'role' => $captain ? 'captain' : 'player',
                'isCaptain' => $captain,
                'joinedAt' => $m->joined_at,
            ];
        }

        usort($out, fn ($a, $b) => (int) $b['isCaptain'] <=> (int) $a['isCaptain'] ?: strcmp($a['name'] ?? '', $b['name'] ?? ''));

        return $out;
    }

    /** Alias kept for the booking path, which only needs the roster. */
    public static function roster(int $teamId): array
    {
        return self::teamRoster($teamId);
    }

    /** Join requests for a team. Defaults to the pending ones the captain must act on. */
    public static function teamJoinRequests(int $teamId, string $status = Teams::REQUEST_PENDING): array
    {
        if ($teamId <= 0) {
            return [];
        }

        $query = TeamRequest::where('team_id', $teamId);

        if ($status !== '') {
            $query->where('status', $status);
        }

        $rows = $query->get();

        if ($rows->isEmpty()) {
            return [];
        }

        $people = User::whereIn('id', $rows->pluck('user_id')->all())->get()->keyBy('id');
        $out = [];

        foreach ($rows as $r) {
            $u = $people->get((int) $r->user_id);

            if (! $u) {
                continue;
            }

            $out[] = [
                'id' => $r->id,
                'teamId' => $r->team_id,
                'userId' => $r->user_id,
                'name' => $u->name,
                'email' => $u->email,
                'avatarColor' => $u->avatar_color,
                'avatarUrl' => $u->avatar_url ?? '',
                'position' => $u->position,
                'level' => $u->level,
                'message' => $r->message,
                'status' => $r->status,
                'createdAt' => $r->created_at,
            ];
        }

        usort($out, fn ($a, $b) => ($a['createdAt']?->getTimestamp() ?? 0) <=> ($b['createdAt']?->getTimestamp() ?? 0));

        return $out;
    }

    /** This player's own pending request for a team, if they have one. */
    public static function myPendingRequest(int $teamId, int $userId): ?TeamRequest
    {
        if ($teamId <= 0 || $userId <= 0) {
            return null;
        }

        return TeamRequest::where('team_id', $teamId)
            ->where('user_id', $userId)
            ->where('status', Teams::REQUEST_PENDING)
            ->first();
    }

    /**
     * Hand the armband over, keeping the "exactly one captain" invariant in one
     * place: the new captain must already be on the roster, `teams.captain_id`
     * moves, and the membership roles follow it. Returns null when the target is
     * not a member, which is the caller's 400.
     */
    public static function transferCaptaincy(int $teamId, int $newCaptainId): ?Team
    {
        $team = Team::find($teamId);

        if (! $team) {
            return null;
        }

        if (! self::isMember($teamId, $newCaptainId)) {
            return null;
        }

        if ((int) $team->captain_id === $newCaptainId) {
            return $team;
        }

        $team->forceFill(['captain_id' => $newCaptainId])->save();

        // Demote everyone, then promote the new captain — never two, never zero.
        TeamMember::where('team_id', $teamId)->where('role', 'captain')->update(['role' => 'player']);
        TeamMember::where('team_id', $teamId)->where('user_id', $newCaptainId)->update(['role' => 'captain']);

        return $team->fresh();
    }

    /* ------------------------------------------------------------- invites */

    /**
     * How many players this squad has invited today. Per team rather than per
     * captain, so leading two squads does not quietly double the cap of either —
     * the limit belongs to the team.
     */
    public static function teamInviteQuota(int $teamId): array
    {
        if ($teamId <= 0) {
            return Teams::makeQuota(0, Teams::INVITE_DAILY_LIMIT);
        }

        $used = TeamInvite::where('team_id', $teamId)->where('created_at', '>=', Teams::startOfQuotaDay())->count();

        return Teams::makeQuota($used, Teams::INVITE_DAILY_LIMIT);
    }

    /** Alias. */
    public static function inviteQuota(int $teamId): array
    {
        return self::teamInviteQuota($teamId);
    }

    /** How many squads this player has asked to join today. */
    public static function joinRequestQuota(int $userId): array
    {
        if ($userId <= 0) {
            return Teams::makeQuota(0, Teams::JOIN_REQUEST_DAILY_LIMIT);
        }

        $used = TeamRequest::where('user_id', $userId)->where('created_at', '>=', Teams::startOfQuotaDay())->count();

        return Teams::makeQuota($used, Teams::JOIN_REQUEST_DAILY_LIMIT);
    }

    /** Alias. */
    public static function requestQuota(int $userId): array
    {
        return self::joinRequestQuota($userId);
    }

    public static function invitesSentToday(int $teamId): int
    {
        return self::teamInviteQuota($teamId)['used'];
    }

    public static function requestsSentToday(int $userId): int
    {
        return self::joinRequestQuota($userId)['used'];
    }

    /** The player's pending invite from this squad, if there is one. */
    public static function myPendingInvite(int $teamId, int $userId): ?TeamInvite
    {
        if ($teamId <= 0 || $userId <= 0) {
            return null;
        }

        return TeamInvite::where('team_id', $teamId)
            ->where('user_id', $userId)
            ->where('status', Teams::REQUEST_PENDING)
            ->first();
    }

    /**
     * A declined or withdrawn invite is reopened in place instead of stacking a
     * duplicate row per attempt — the same trick `teamRequests` uses, so a
     * player's history with a squad stays one row. An `accepted` row is history
     * and is left alone; a fresh one is created beside it.
     */
    public static function reopenableInvite(int $teamId, int $userId): ?TeamInvite
    {
        return TeamInvite::where('team_id', $teamId)
            ->where('user_id', $userId)
            ->get()
            ->first(fn (TeamInvite $r) => in_array($r->status, Teams::REOPENABLE_REQUEST_STATUSES, true));
    }

    public static function findInvite(int $inviteId): ?TeamInvite
    {
        return $inviteId > 0 ? TeamInvite::find($inviteId) : null;
    }

    /**
     * Join the rows a panel needs into one flat shape. `email` is filled only
     * for the captain's own view, mirroring the roster rule: contact details are
     * for running a team, not for scraping.
     */
    private static function decorateInvites(iterable $rows, bool $forCaptain): array
    {
        $rows = collect($rows);

        if ($rows->isEmpty()) {
            return [];
        }

        $teams = Team::all()->keyBy('id');
        $allMembers = TeamMember::all();
        $people = User::whereIn('id', $rows->flatMap(fn ($r) => [(int) $r->user_id, (int) $r->invited_by])->unique()->filter()->all())
            ->get()
            ->keyBy('id');

        $out = [];

        foreach ($rows as $r) {
            $t = $teams->get((int) $r->team_id);

            // An invite whose team has been deleted contributes nothing.
            if (! $t) {
                continue;
            }

            $u = $people->get((int) $r->user_id);

            if (! $u) {
                continue;
            }

            $memberCount = $allMembers->filter(fn ($m) => (int) $m->team_id === (int) $t->id)->count();

            $out[] = [
                'id' => $r->id,
                'teamId' => $t->id,
                'teamName' => $t->name,
                'teamCode' => $t->team_code ?? '',
                'teamLogoColor' => $t->logo_color,
                'teamLevel' => $t->level,
                'maxPlayers' => (int) $t->max_players,
                'memberCount' => $memberCount,
                'squadFull' => $memberCount >= (int) $t->max_players,
                'userId' => $u->id,
                'name' => $u->name,
                'email' => $forCaptain ? $u->email : '',
                'avatarColor' => $u->avatar_color,
                'avatarUrl' => $u->avatar_url ?? '',
                'position' => $u->position,
                'level' => $u->level,
                'invitedBy' => $r->invited_by,
                'captainName' => $people->get((int) $r->invited_by)?->name ?? 'The captain',
                'message' => $r->message,
                'status' => $r->status,
                'createdAt' => $r->created_at,
                'decidedAt' => $r->decided_at,
            ];
        }

        // Oldest ask first, so nobody waits behind the queue-jumper.
        usort($out, fn ($a, $b) => ($a['createdAt']?->getTimestamp() ?? 0) <=> ($b['createdAt']?->getTimestamp() ?? 0));

        return $out;
    }

    /** The captain's sent invites for one squad (pending by default). */
    public static function teamSentInvites(int $teamId, string $status = Teams::REQUEST_PENDING): array
    {
        if ($teamId <= 0) {
            return [];
        }

        $query = TeamInvite::where('team_id', $teamId);

        if ($status !== '') {
            $query->where('status', $status);
        }

        return self::decorateInvites($query->get(), true);
    }

    /** Everything this player has been invited to (pending by default). */
    public static function playerInvites(int $userId, string $status = Teams::REQUEST_PENDING): array
    {
        if ($userId <= 0) {
            return [];
        }

        $query = TeamInvite::where('user_id', $userId);

        if ($status !== '') {
            $query->where('status', $status);
        }

        return self::decorateInvites($query->get(), false);
    }

    /** Pending invites per squad, for the badge on the captain's own team card. */
    public static function pendingInviteCounts(array $teamIds): array
    {
        if ($teamIds === []) {
            return [];
        }

        $rows = TeamInvite::whereIn('team_id', $teamIds)->where('status', Teams::REQUEST_PENDING)->get();
        $out = [];

        foreach ($rows as $r) {
            $out[(int) $r->team_id] = ($out[(int) $r->team_id] ?? 0) + 1;
        }

        return $out;
    }

    /**
     * Everything this player has asked for, newest first, with the squad
     * attached. The dossier page filters this to the squads the *viewer*
     * captains, which is what turns "someone asked to join" into "someone is
     * asking, and here is why".
     */
    public static function joinRequestsFromUser(int $userId): array
    {
        if ($userId <= 0) {
            return [];
        }

        $rows = TeamRequest::where('user_id', $userId)->get();

        if ($rows->isEmpty()) {
            return [];
        }

        $teams = Team::all()->keyBy('id');
        $out = [];

        foreach ($rows as $r) {
            $t = $teams->get((int) $r->team_id);

            if (! $t) {
                continue;
            }

            $out[] = [
                'id' => $r->id,
                'teamId' => $t->id,
                'teamName' => $t->name,
                'teamCode' => $t->team_code ?? '',
                'logoColor' => $t->logo_color,
                'captainId' => $t->captain_id,
                'message' => $r->message,
                'status' => $r->status,
                'createdAt' => $r->created_at,
                'decidedAt' => $r->decided_at,
            ];
        }

        usort($out, fn ($a, $b) => ($b['createdAt']?->getTimestamp() ?? 0) <=> ($a['createdAt']?->getTimestamp() ?? 0));

        return $out;
    }

    /** A player's own venue reviews — public on the venue pages, so the dossier may show them. */
    public static function playerReviews(int $userId): array
    {
        if ($userId <= 0) {
            return [];
        }

        $rows = Review::where('user_id', $userId)->get();

        if ($rows->isEmpty()) {
            return [];
        }

        $venues = Venue::all()->keyBy('id');

        $out = $rows->map(fn (Review $r) => [
            'id' => $r->id,
            'venueId' => $r->venue_id,
            'venueName' => $venues->get((int) $r->venue_id)?->name ?? 'a venue',
            'rating' => (int) $r->rating,
            'message' => $r->message,
            'createdAt' => $r->created_at,
        ])->all();

        usort($out, fn ($a, $b) => $b['rating'] <=> $a['rating']);

        return $out;
    }

    /** Open matches this player organises or has joined, so a captain can see they show up. */
    public static function playerMatchActivity(int $userId): array
    {
        if ($userId <= 0) {
            return ['organized' => [], 'joined' => []];
        }

        $allMatches = OpenMatch::all();
        $venues = Venue::all()->keyBy('id');

        $joinedIds = MatchJoin::where('user_id', $userId)->pluck('match_id')->map(fn ($v) => (int) $v)->all();
        $today = now()->toDateString();

        $shape = fn (OpenMatch $m) => [
            'id' => $m->id,
            'title' => $m->title,
            'date' => $m->date,
            'startTime' => $m->start_time,
            'endTime' => $m->end_time,
            'level' => $m->level,
            'status' => $m->status,
            'pricePerPlayer' => (int) $m->price_per_player,
            'venueName' => $venues->get((int) $m->venue_id)?->name ?? '',
        ];

        $upcoming = fn (OpenMatch $m) => (string) $m->date >= $today
            && in_array($m->status, ['open', 'confirmed'], true);

        return [
            'organized' => $allMatches->filter(fn (OpenMatch $m) => (int) $m->organizer_id === $userId && $upcoming($m))->map($shape)->values()->all(),
            'joined' => $allMatches->filter(fn (OpenMatch $m) => in_array((int) $m->id, $joinedIds, true) && $upcoming($m))->map($shape)->values()->all(),
        ];
    }
}
