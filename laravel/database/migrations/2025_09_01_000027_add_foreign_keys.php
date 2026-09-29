<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Make the database enforce the relationships the schema has always implied.
 *
 * Until now every `booking_id`, `user_id` and `team_id` in this project was a
 * bare integer. Nothing checked that it pointed at a row that existed, so a
 * deleted venue left bookings pointing at nothing, a removed user left
 * payments in the ledger attributed to a ghost, and none of it raised an
 * error — it just quietly returned a booking with no court and a ledger line
 * with no payer. That is precisely the "everything is separate and nothing
 * uses anything else" failure: the links were only ever a naming convention.
 *
 * The constraints are added children-first, and only after orphan rows have
 * been removed, because a foreign key cannot be created over a dangling
 * reference. Cleanup runs here, in the same migration, rather than as a
 * separate step — otherwise a gap between the two migrations would leave a
 * window where the constraint is attempted against rows nobody has cleaned,
 * and the migration fails with the database half-migrated.
 *
 * Deletion behaviour is deliberate. Money and identity rows use RESTRICT: a
 * venue with bookings, or a user with a booking, cannot be deleted out from
 * under them, because a ledger entry that outlives its payer is not a ledger
 * entry any more. Nullable pointers (a match with no booking yet, a media row
 * with no match yet) use SET NULL, since "not linked yet" is a real state and
 * must not block a delete.
 */
return new class extends Migration
{
    /**
     * Every child column that must point at a row that exists, and the parent
     * it points at. Written as data so cleanup and constraints cannot drift
     * apart — the two lists are the same list.
     *
     * @var list<array{0: string, 1: string, 2: string}>
     */
    private const LINKS = [
        // children first
        ['tournament_media', 'tournament_id', 'tournaments'],
        ['tournament_media', 'match_id', 'tournament_matches'],
        ['tournament_matches', 'tournament_id', 'tournaments'],
        ['tournament_matches', 'court_id', 'courts'],
        ['tournament_matches', 'home_team_id', 'teams'],
        ['tournament_matches', 'away_team_id', 'teams'],
        ['tournament_matches', 'booking_id', 'bookings'],
        ['tournament_payments', 'tournament_id', 'tournaments'],
        ['tournament_payments', 'team_id', 'teams'],
        ['tournament_teams', 'tournament_id', 'tournaments'],
        ['tournament_teams', 'team_id', 'teams'],
        ['match_joins', 'match_id', 'open_matches'],
        ['match_joins', 'user_id', 'users'],
        ['open_matches', 'organizer_id', 'users'],
        ['open_matches', 'venue_id', 'venues'],
        ['open_matches', 'court_id', 'courts'],
        ['open_matches', 'booking_id', 'bookings'],
        ['team_ledger_entries', 'booking_id', 'bookings'],
        ['team_ledger_entries', 'team_id', 'teams'],
        ['team_ledger_entries', 'user_id', 'users'],
        ['booking_payments', 'booking_id', 'bookings'],
        ['booking_extras', 'booking_id', 'bookings'],
        ['booking_team_payments', 'booking_id', 'bookings'],
        ['booking_team_payments', 'team_id', 'teams'],
        ['booking_team_payments', 'user_id', 'users'],
        ['booking_payment_requests', 'booking_id', 'bookings'],
        ['booking_payment_requests', 'payer_id', 'users'],
        ['booking_payment_requests', 'requested_by', 'users'],
        ['team_requests', 'team_id', 'teams'],
        ['team_requests', 'user_id', 'users'],
        ['team_invites', 'team_id', 'teams'],
        ['team_invites', 'user_id', 'users'],
        ['team_members', 'team_id', 'teams'],
        ['team_members', 'user_id', 'users'],
        ['vouchers', 'user_id', 'users'],
        ['vouchers', 'venue_id', 'venues'],
        ['vouchers', 'used_booking_id', 'bookings'],
        ['promos', 'venue_id', 'venues'],
        ['reviews', 'venue_id', 'venues'],
        ['reviews', 'user_id', 'users'],
        ['reviews', 'booking_id', 'bookings'],
        ['notifications', 'user_id', 'users'],
        ['courts', 'venue_id', 'venues'],
        ['bookings', 'court_id', 'courts'],
        ['bookings', 'user_id', 'users'],
        ['bookings', 'team_id', 'teams'],
        ['bookings', 'opponent_team_id', 'teams'],
        ['bookings', 'tournament_id', 'tournaments'],
        ['bookings', 'voucher_id', 'vouchers'],
        ['bookings', 'promo_id', 'promos'],
        ['tournaments', 'host_id', 'users'],
        ['tournaments', 'venue_id', 'venues'],
        ['tournaments', 'court_id', 'courts'],
        ['teams', 'captain_id', 'users'],
        ['teams', 'home_venue_id', 'venues'],
        ['venues', 'owner_id', 'users'],
    ];

    public function up(): void
    {
        $this->purgeOrphans();

        foreach ($this->parentTables() as $parent) {
            $this->applyKeys($parent);
        }
    }

    public function down(): void
    {
        foreach (array_reverse($this->parentTables()) as $parent) {
            $this->applyKeys($parent, true);
        }
    }

    /**
     * Every table something points at, read off LINKS.
     *
     * This used to be a hand-written list, and it was wrong: it omitted promos
     * and vouchers, so `bookings.voucher_id` and `bookings.promo_id` were
     * skipped entirely and two columns stayed unconstrained while the
     * migration reported success. Deriving it means a new link can never be
     * added without its constraint following automatically.
     *
     * @return list<string>
     */
    private function parentTables(): array
    {
        $parents = array_values(array_unique(array_column(self::LINKS, 2)));

        // A parent must be constrained before a child that points at it, so
        // order by how deep the table sits: users and venues hold nothing up,
        // bookings sit on top of them.
        $order = ['users', 'venues', 'promos', 'courts', 'teams', 'tournaments', 'bookings', 'vouchers', 'open_matches', 'tournament_matches'];

        usort($parents, fn ($a, $b) => array_search($a, $order, true) <=> array_search($b, $order, true));

        return $parents;
    }

    /**
     * Add (or drop) every constraint pointing at one parent table.
     */
    /**
     * Add (or drop) every constraint pointing at one parent table.
     *
     * Grouped by child so each table is altered once. One ALTER per constraint
     * would rebuild the table fifty-odd times over — on a real dataset that is
     * hours of downtime for identical work, since the result is the same
     * either way. MySQL just does it once per table instead of once per key.
     */
    private function applyKeys(string $parent, bool $drop = false): void
    {
        $byChild = [];

        foreach (self::LINKS as [$child, $column, $target]) {
            if ($target === $parent) {
                $byChild[$child][] = $column;
            }
        }

        foreach ($byChild as $child => $columns) {
            if ($drop) {
                Schema::table($child, function (Blueprint $table) use ($child, $columns) {
                    foreach ($columns as $column) {
                        $table->dropForeign("{$child}_{$column}_fk");
                    }
                });

                continue;
            }

            Schema::table($child, function (Blueprint $table) use ($child, $columns) {
                foreach ($columns as $column) {
                    $table->foreign($column, "{$child}_{$column}_fk")
                        ->references('id')
                        ->on($this->parentOf($child, $column))
                        ->onUpdate('cascade')
                        ->onDelete($this->deleteBehaviour($child, $column));
                }
            });
        }
    }

    /**
     * @throws \LogicException when a link has no declared parent, rather than
     *                           silently pointing a constraint at the wrong table
     */
    private function parentOf(string $child, string $column): string
    {
        foreach (self::LINKS as [$c, $col, $target]) {
            if ($c === $child && $col === $column) {
                return $target;
            }
        }

        throw new \LogicException("No declared parent for {$child}.{$column}");
    }

    private function deleteBehaviour(string $child, string $column): string
    {
        $key = "$child.$column";

        if (in_array($key, self::CASCADE, true)) {
            return 'cascade';
        }

        return in_array($key, self::OPTIONAL, true) ? 'set null' : 'restrict';
    }

    /**
     * Rows that are derived from their parent and carry no independent
     * meaning. A notification only describes something that happened to a user;
     * keeping it after the user is gone would show a ghost in an inbox.
     */
    /** @var list<string> */
    private const CASCADE = [
        'notifications.user_id',
        'team_requests.user_id',
        'team_invites.user_id',
    ];

    /** @var list<string> */
    private const OPTIONAL = [
        'tournament_media.tournament_id',
        'tournament_media.match_id',
        'tournament_matches.court_id',
        'tournament_matches.booking_id',
        'tournament_matches.home_team_id',
        'tournament_matches.away_team_id',
        'open_matches.booking_id',
        'bookings.team_id',
        'bookings.opponent_team_id',
        'bookings.tournament_id',
        'bookings.voucher_id',
        'bookings.promo_id',
        'reviews.booking_id',
        'vouchers.used_booking_id',
        'teams.home_venue_id',
        'tournaments.venue_id',
        'tournaments.court_id',
    ];

    /**
     * Remove rows whose parent is gone.
     *
     * Ordered exactly like LINKS — children before parents — so removing a
     * booking does not orphan the ledger lines underneath it a moment later.
     * A row with no parent is not recoverable information; it is a broken
     * reference that can only ever produce a wrong answer. Rows whose parent
     * column is NULL are left alone: those are legitimately unlinked.
     */
    private function purgeOrphans(): void
    {
        foreach (self::LINKS as [$child, $column, $target]) {
            $ids = DB::table($child)
                ->whereNotNull($column)
                ->whereNotIn($column, DB::table($target)->select('id'))
                ->pluck('id');

            if ($ids->isEmpty()) {
                continue;
            }

            DB::table($child)->whereIn('id', $ids)->delete();
        }
    }
};
