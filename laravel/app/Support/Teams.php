<?php

namespace App\Support;

/**
 * Pure team helpers — `src/lib/teams.ts`.
 *
 * No database and nothing that can throw on bad input; anything touching MySQL
 * lives in `App\Support\TeamStore`.
 */
class Teams
{
    public const CODE_MIN = 3;

    public const CODE_MAX = 20;

    /** Cap on the squad's "about us" box: two lines on a team card. */
    public const DESCRIPTION_MAX = 400;

    public const ROLES = ['captain', 'player'];

    /** Skips I, O, 0, 1 and 2 — the characters people mishear out loud. */
    private const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY3479';

    public const REQUEST_PENDING = 'pending';

    public const REQUEST_ACCEPTED = 'accepted';

    public const REQUEST_DECLINED = 'declined';

    public const REQUEST_CANCELLED = 'cancelled';

    /** Declined and withdrawn requests may be made again; accepted ones must not. */
    public const REOPENABLE_REQUEST_STATUSES = [self::REQUEST_DECLINED, self::REQUEST_CANCELLED];

    /**
     * Invitations a squad may send, and squads a player may ask, per day.
     *
     * Both are 5 on purpose: plenty for a real squad to reshuffle itself, and
     * one shared number is one rule to explain. Without them consent is only
     * polite — a captain could add the whole platform to a roster by
     * invitation. Sending is what is counted; answering is always free, because
     * saying yes to someone who asked first should never cost you anything.
     */
    public const INVITE_DAILY_LIMIT = 5;

    public const JOIN_REQUEST_DAILY_LIMIT = 5;

    /** Uppercase, no spaces, letters/numbers/dashes only — as for a promo code. */
    public static function normalizeCode(mixed $raw): string
    {
        $code = strtoupper(trim((string) ($raw ?? '')));
        $code = preg_replace('/\s+/', '', $code) ?? '';
        $code = preg_replace('/[^A-Z0-9-]/', '', $code) ?? '';

        return substr($code, 0, self::CODE_MAX);
    }

    /** "Chabahil Chargers" -> "CHABAHILCH-XK4P". */
    public static function suggestCode(string $seedWord = 'TEAM'): string
    {
        $word = substr(str_replace('-', '', self::normalizeCode($seedWord)), 0, 10) ?: 'TEAM';
        $tail = '';

        for ($i = 0; $i < 4; $i++) {
            $tail .= self::CODE_ALPHABET[random_int(0, strlen(self::CODE_ALPHABET) - 1)];
        }

        return substr($word.'-'.$tail, 0, self::CODE_MAX);
    }

    /**
     * A quota day is a calendar day on the server, not a rolling 24 hours:
     * "5 a day, resets at midnight" is something a user can reason about.
     */
    public static function startOfQuotaDay(mixed $now = null): \Carbon\CarbonInterface
    {
        return ($now ? now()->parse((string) $now) : now())->startOfDay();
    }

    /**
     * @return array{used: int, limit: int, left: int}
     */
    public static function makeQuota(int $used, int $limit = self::JOIN_REQUEST_DAILY_LIMIT): array
    {
        $n = max(0, (int) $used);

        return ['used' => $n, 'limit' => $limit, 'left' => max(0, $limit - $n)];
    }

    /**
     * @param  array{used: int, limit: int, left: int}  $quota
     */
    public static function quotaExhausted(array $quota): bool
    {
        return $quota['left'] <= 0;
    }

    public static function quotaResetsAt(mixed $now = null): \Carbon\CarbonInterface
    {
        return self::startOfQuotaDay($now)->copy()->addDay();
    }

    public const INVITABLE_ROLES = ['player'];

    /**
     * Only `player` accounts may be asked to join a squad. A venue owner exists
     * to run courts and an admin to run the platform, so a squad full of staff
     * accounts is not a futsal team. Enforced on the server, not just by hiding
     * rows, so a hand-crafted request cannot slot an owner into a roster.
     */
    public static function canBeInvitedToTeam(mixed $role): bool
    {
        $r = strtolower(trim((string) ($role ?? '')));

        // Blank means "whatever signup defaults to", which is a player account.
        return $r === '' || in_array($r, self::INVITABLE_ROLES, true);
    }

    /** One-line reason a role is not invitable, or null when it is fine. */
    public static function invitableRoleError(mixed $role, string $name = 'That account'): ?string
    {
        if (self::canBeInvitedToTeam($role)) {
            return null;
        }

        $r = strtolower(trim((string) ($role ?? '')));

        if ($r === 'owner') {
            return "{$name} runs a venue on this platform 🏟️ — only players can join a squad.";
        }

        return "{$name} has a platform staff account 🔒 — only players can join a squad.";
    }

    public static function roleLabel(?string $role): string
    {
        return $role === 'captain' ? 'Captain' : 'Player';
    }

    /**
     * A team always has exactly one captain: `teams.captain_id` is the source
     * of truth and `team_members.role` mirrors it. This is what the API checks
     * before letting a captain leave or be removed — hand the armband over
     * first, so the two can never disagree.
     */
    public static function isCaptainRow(mixed $teamCaptainId, mixed $userId): bool
    {
        return is_numeric($teamCaptainId) && (int) $teamCaptainId === (int) $userId;
    }
}
