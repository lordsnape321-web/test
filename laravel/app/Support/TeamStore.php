<?php

namespace App\Support;

use App\Models\Team;
use App\Models\TeamInvite;
use App\Models\TeamMember;
use App\Models\TeamRequest;

/**
 * The database side of squads — `src/lib/team-store.ts`.
 *
 * Pure rules live in `App\Support\Teams`; anything that has to read or write
 * rows lives here.
 */
class TeamStore
{
    /**
     * A team the player actually belongs to, verified server-side rather than
     * trusted from the client.
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

        $team = Team::where('teams.id', $teamId)
            ->join('team_members', 'team_members.team_id', '=', 'teams.id')
            ->where('team_members.user_id', $userId)
            ->select('teams.id', 'teams.name')
            ->first();

        return $team ? ['id' => (int) $team->id, 'name' => (string) $team->name] : null;
    }

    /** Is this handle taken? `$excludeTeamId` lets a squad keep its own. */
    public static function teamCodeTaken(mixed $code, int $excludeTeamId = 0): bool
    {
        $normalized = Teams::normalizeCode($code);

        if ($normalized === '') {
            return false;
        }

        $query = Team::where('team_code', $normalized);

        if ($excludeTeamId > 0) {
            $query->where('id', '!=', $excludeTeamId);
        }

        return $query->exists();
    }

    /** How many invitations this squad has already sent today. */
    public static function invitesSentToday(int $teamId): int
    {
        return TeamInvite::where('team_id', $teamId)
            ->where('created_at', '>=', Teams::startOfQuotaDay())
            ->count();
    }

    /** How many squads this player has already asked to join today. */
    public static function requestsSentToday(int $userId): int
    {
        return TeamRequest::where('user_id', $userId)
            ->where('created_at', '>=', Teams::startOfQuotaDay())
            ->count();
    }

    /**
     * @return array{used: int, limit: int, left: int}
     */
    public static function inviteQuota(int $teamId): array
    {
        return Teams::makeQuota(self::invitesSentToday($teamId), Teams::INVITE_DAILY_LIMIT);
    }

    /**
     * @return array{used: int, limit: int, left: int}
     */
    public static function requestQuota(int $userId): array
    {
        return Teams::makeQuota(self::requestsSentToday($userId), Teams::JOIN_REQUEST_DAILY_LIMIT);
    }

    /**
     * The roster of a squad, each row labelled with its role.
     *
     * @return list<array<string, mixed>>
     */
    public static function roster(int $teamId): array
    {
        $members = TeamMember::where('team_id', $teamId)->orderBy('id')->get();
        $userIds = $members->pluck('user_id')->all();
        $users = \App\Models\User::whereIn('id', $userIds)->get()->keyBy('id');

        return $members->map(function (TeamMember $member) use ($users) {
            $user = $users->get((int) $member->user_id);

            return [
                'userId' => (int) $member->user_id,
                'name' => $user?->name ?? 'Player',
                'email' => $user?->email ?? '',
                'avatarColor' => $user?->avatar_color ?? '#22c55e',
                'avatarUrl' => $user?->avatar_url ?? '',
                'position' => $user?->position ?? '',
                'level' => $user?->level ?? '',
                'role' => $member->role,
                'isCaptain' => $member->role === 'captain',
                'joinedAt' => $member->joined_at,
            ];
        })->all();
    }
}
