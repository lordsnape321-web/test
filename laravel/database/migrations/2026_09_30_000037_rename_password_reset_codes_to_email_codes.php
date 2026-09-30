<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One table for every code we email, not just password resets.
 *
 * The table shipped as `password_reset_codes`. It now carries three kinds of
 * code — password resets, signup verification and account deletion — told apart
 * by `purpose`, so it gets the name that says so.
 *
 * Written defensively on purpose. `StartupSchema` runs this file before
 * `php artisan serve` on *every* install that has not got it yet, and those
 * installs differ:
 *
 *   • a database pulled from before this release has `password_reset_codes`
 *     (with data in it — someone's live reset code) → rename, keep the rows;
 *   • a database so old it predates the reset table entirely → create the new
 *     one;
 *   • a fresh `php artisan migrate` → both of the above happen in order.
 *
 * Each step is guarded, so whichever one applies, the result is the same table
 * with the same columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('email_codes') && Schema::hasTable('password_reset_codes')) {
            Schema::rename('password_reset_codes', 'email_codes');
        }

        if (! Schema::hasTable('email_codes')) {
            Schema::create('email_codes', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id')->nullable();
                $table->string('email', 190);
                $table->string('purpose', 40)->default('password_reset');
                $table->string('code_hash', 64);
                $table->unsignedInteger('attempts')->default(0);
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('used_at')->nullable();
                $table->timestamps();

                // The lookup every request makes: the newest live code for one
                // address and one purpose.
                $table->index(['email', 'purpose', 'used_at', 'expires_at'], 'email_codes_lookup_idx');
            });

            return;
        }

        // Renamed from the old table: it has the columns the old flow needed,
        // and needs the new one.
        if (! Schema::hasColumn('email_codes', 'purpose')) {
            Schema::table('email_codes', function (Blueprint $table) {
                // Existing rows are all password resets — that is what the table
                // was for — so the default is also the backfill.
                $table->string('purpose', 40)->default('password_reset')->after('email');
            });
        }
    }

    public function down(): void
    {
        // Deliberately only the new column: renaming back would drop signup and
        // deletion codes into a table whose name no longer describes them.
        if (Schema::hasTable('email_codes') && Schema::hasColumn('email_codes', 'purpose')) {
            Schema::table('email_codes', function (Blueprint $table) {
                $table->dropColumn('purpose');
            });
        }
    }
};
