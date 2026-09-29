<?php

namespace App\Support;

/**
 * Open games — who gets to play, and who decides.
 *
 * The pure part of "an open game is a table, not a free-for-all", kept out of the
 * controller so the rules can be read in one place. The mirror image in the app
 * is `src/lib/open-games.ts`, and the two are edited together.
 *
 * Three rules live here:
 *
 *  1. Taking a spot is a request. Nobody joins a game by tapping once — the
 *     host answers, the same way a captain answers a squad request. The host's
 *     own crew is the one exception, because it is already theirs.
 *  2. The host may name the positions they are short of. Naming none means
 *     "anyone welcome", which is the default and the common case; asking for a
 *     keeper is opt-in, never forced on a game that did not ask.
 *  3. Money offered up front is a commitment, so it accepts the request by
 *     default. It is not a bribe: a host can still accept someone who sent
 *     nothing, and a paid request is still a request the host can decline.
 */
class OpenGames
{
    /** The spots a futsal game actually has. `Any position` is the default. */
    public const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];

    /** "Anyone welcome" — what a game with no `positionsNeeded` is asking for. */
    public const ANY_POSITION = 'Any position';

    /** A spot taken and settled. The host's own crew, and accepted requests. */
    public const JOIN_ACCEPTED = 'accepted';

    /** Asked, waiting for the host. Takes up no spot. */
    public const JOIN_PENDING = 'pending';

    public const JOIN_DECLINED = 'declined';

    /** Withdrawn by the player, or taken back by the host. */
    public const JOIN_CANCELLED = 'cancelled';

    /** Withdrawn and declined asks may be made again; accepted ones must not. */
    public const REOPENABLE_JOIN_STATUSES = [self::JOIN_DECLINED, self::JOIN_CANCELLED];

    /** Only these count against the player limit. */
    public const COUNTED_JOIN_STATUSES = [self::JOIN_ACCEPTED];

    /** How many positions a host may ask for — a pitch, not a shopping list. */
    public const MAX_POSITIONS = 4;

    /** A payment in advance is a share, so it can never exceed the share. */
    public const MAX_ADVANCE = 20000;

    /**
     * Normalise whatever the client sent into real positions.
     *
     * Accepts a JSON array, a comma-separated string, or nothing. Unknown
     * entries are dropped rather than stored, and an empty result means the
     * host asked for nobody in particular — which is the honest default.
     *
     * @return list<string>
     */
    public static function normalisePositions(mixed $raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : explode(',', $raw);
        }

        if (! is_array($raw)) {
            return [];
        }

        $out = [];

        foreach ($raw as $item) {
            $name = is_string($item) ? trim($item) : '';

            // "any"/"anyone" is what an empty list already means, so it is not
            // stored as a position — otherwise a game would claim to want a
            // position called "Any position".
            if ($name === '' || strtolower($name) === 'any' || strtolower($name) === 'anyone') {
                continue;
            }

            foreach (self::POSITIONS as $known) {
                if (strcasecmp($name, $known) === 0 && ! in_array($known, $out, true)) {
                    $out[] = $known;
                    break;
                }
            }

            if (count($out) >= self::MAX_POSITIONS) {
                break;
            }
        }

        return $out;
    }

    /**
     * The spot a request is for.
     *
     * A game that named no positions accepts anything, and the answer is
     * recorded as `Any position` so the host's list reads honestly. A game that
     * did name them can still take a request for a spot it did not ask for —
     * the host decides that, not this function.
     */
    public static function positionFor(array $positionsNeeded, mixed $wanted): string
    {
        $name = is_string($wanted) ? trim($wanted) : '';

        foreach (self::POSITIONS as $known) {
            if ($name !== '' && strcasecmp($name, $known) === 0) {
                return $known;
            }
        }

        return $positionsNeeded === [] ? self::ANY_POSITION : '';
    }

    /** How much money in advance is being offered, clamped to the share. */
    public static function advanceAmount(mixed $offered, int $share, bool $wantsToPay): int
    {
        if (! $wantsToPay) {
            return 0;
        }

        $amount = is_numeric($offered) ? (int) $offered : 0;

        // Ticking the box with no figure means "my share", not "nothing".
        if ($amount <= 0) {
            $amount = $share;
        }

        return max(0, min($amount, $share, self::MAX_ADVANCE));
    }

    /**
     * Money in front of the host is taken as a commitment.
     *
     * This is the whole of the "accept by default if paid" rule, and it is
     * deliberately narrow: it fires on a positive amount and nothing else, so a
     * player cannot buy a spot on a game that was already full or closed, and a
     * player who sends nothing is never auto-accepted.
     */
    public static function autoAccepts(int $paidAmount): bool
    {
        return $paidAmount > 0;
    }

    /** One line explaining a pending request to whoever is reading the queue. */
    public static function paymentSummary(int $paidAmount, string $method): string
    {
        if ($paidAmount <= 0) {
            return 'No money sent yet';
        }

        return $method === '' ? 'Paid in advance' : "Paid in advance via {$method}";
    }
}
