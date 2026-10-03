<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Somewhere to record "this account is gone".
 *
 * Deleting the row is not an option: bookings, payments, ledger entries, teams
 * and tournaments all point at `users`, several of them with `restrictOnDelete`
 * foreign keys, and the *other* people on those bookings still need their
 * history to add up. So leaving the pitch means the account is closed, not
 * erased: the identity is scrubbed (name, email, phone, password, photo) and
 * `deleted_at` hides the row from every query from then on.
 *
 * The meaningful side effect of the soft delete is the read side: every
 * `User::where(...)` in the app stops seeing closed accounts, so they cannot log
 * in, be found by email, be invited, or turn up in a player list — while the
 * rows their history depends on stay exactly where they are.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'deleted_at')) {
            Schema::table('users', function (Blueprint $table) {
                $table->softDeletes();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'deleted_at')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropSoftDeletes();
            });
        }
    }
};
