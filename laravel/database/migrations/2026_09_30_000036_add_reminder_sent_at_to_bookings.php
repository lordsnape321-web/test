<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "We have already reminded them about this game."
 *
 * The reminder pump runs on ordinary API traffic instead of a scheduler, so it
 * can be entered several times a minute; this column is what makes each game
 * remind exactly once (and lets a rescheduled game remind again when the time
 * is cleared).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->timestamp('reminder_sent_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn('reminder_sent_at');
        });
    }
};
