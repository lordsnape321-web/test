<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Indexes for the queries the app actually runs.
 *
 * The foreign keys in the previous migration already give every child column an
 * index, which removes the single-column scans. What they cannot do is satisfy
 * an ORDER BY: a query filtered by `user_id` and ordered by `created_at` still
 * has to gather the rows and then sort them, because no index carries the
 * columns in that order. These composites are built from the real query shapes
 * in the controllers — filter columns first, then the sort columns — so the
 * common reads stop sorting at all.
 */
return new class extends Migration
{
    public function up(): void
    {
        // The notification inbox: `where user_id order by created_at desc,
        // id desc`. The existing (user_id, is_read) index cannot serve that
        // ordering, so every inbox open sorted the user's whole history.
        Schema::table('notifications', function (Blueprint $table) {
            $table->index(['user_id', 'created_at', 'id'], 'notifications_inbox_idx');
        });

        // "My bookings" is the app's busiest read: filter by owner, order by
        // newest. Splitting it across two single-column indexes is what forced
        // the sort.
        Schema::table('bookings', function (Blueprint $table) {
            $table->index(['user_id', 'created_at', 'id'], 'bookings_owner_recent_idx');
        });

        // Availability for one court on one day — the courts screen, and the
        // check behind every new booking.
        Schema::table('bookings', function (Blueprint $table) {
            $table->index(['court_id', 'date', 'status'], 'bookings_court_day_idx');
        });

        // The matches browser: filter by status, order by date.
        Schema::table('open_matches', function (Blueprint $table) {
            $table->index(['status', 'date'], 'open_matches_status_date_idx');
        });

        // A player's own matches, and the queue behind one game.
        Schema::table('open_matches', function (Blueprint $table) {
            $table->index(['organizer_id', 'date'], 'open_matches_organizer_date_idx');
        });

        // Signup and profile-save both ask "is this phone number taken?".
        // Without an index that is a full scan of the users table on every
        // registration — the single most expensive query in the auth path as
        // the table grows. Deliberately NOT unique: the column defaults to an
        // empty string, so a unique index would reject every account that
        // never gave a number. Uniqueness stays enforced in the controller,
        // which already checks before writing.
        Schema::table('users', function (Blueprint $table) {
            $table->index('phone', 'users_phone_idx');
        });

        // Every squad the player belongs to, for the captain and team screens.
        Schema::table('team_members', function (Blueprint $table) {
            $table->index(['user_id', 'team_id'], 'team_members_user_team_idx');
        });

        // A captain's pending inbox — filtered by squad and not yet decided.
        Schema::table('team_requests', function (Blueprint $table) {
            $table->index(['team_id', 'status', 'id'], 'team_requests_queue_idx');
        });

        // The squad ledger: one member's lines within one booking.
        Schema::table('team_ledger_entries', function (Blueprint $table) {
            $table->index(['booking_id', 'user_id', 'voided_at'], 'team_ledger_member_idx');
        });

        // A venue's reviews, newest first.
        Schema::table('reviews', function (Blueprint $table) {
            $table->index(['venue_id', 'created_at'], 'reviews_venue_recent_idx');
        });

        // A tournament's standings and bracket, in round order.
        Schema::table('tournament_matches', function (Blueprint $table) {
            $table->index(['tournament_id', 'bracket_round', 'slot'], 'tournament_bracket_idx');
        });

        // Which teams are in a tournament, by state — the registration board.
        Schema::table('tournament_teams', function (Blueprint $table) {
            $table->index(['tournament_id', 'status'], 'tournament_teams_board_idx');
        });
    }

    public function down(): void
    {
        $drop = function (string $table, string $index): void {
            Schema::table($table, function (Blueprint $blueprint) use ($index) {
                $blueprint->dropIndex($index);
            });
        };

        $drop('notifications', 'notifications_inbox_idx');
        $drop('bookings', 'bookings_owner_recent_idx');
        $drop('bookings', 'bookings_court_day_idx');
        $drop('open_matches', 'open_matches_status_date_idx');
        $drop('open_matches', 'open_matches_organizer_date_idx');
        $drop('users', 'users_phone_idx');
        $drop('team_members', 'team_members_user_team_idx');
        $drop('team_requests', 'team_requests_queue_idx');
        $drop('team_ledger_entries', 'team_ledger_member_idx');
        $drop('reviews', 'reviews_venue_recent_idx');
        $drop('tournament_matches', 'tournament_bracket_idx');
        $drop('tournament_teams', 'tournament_teams_board_idx');
    }
};
