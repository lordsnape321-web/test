<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A venue can hold pitches that do not share the desk's hours: the indoor court
 * may run 06:00–22:00 while the turf next to it closes at 23:00. The venue-level
 * `opening_hour`/`closing_hour` stay as the default, and a court that sets its
 * own window is the source of truth for that pitch.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('courts', function (Blueprint $table) {
            // "HH:MM", 24-hour. Null = follow the venue's hours.
            $table->string('opens_at', 5)->nullable();
            $table->string('closes_at', 5)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('courts', function (Blueprint $table) {
            $table->dropColumn(['opens_at', 'closes_at']);
        });
    }
};
