<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Hours for one weekday, for one court.
 *
 * `courts.opens_at`/`closes_at` stay the every-day window; a row here overrides
 * it for that single weekday — the turf that runs 18:00–23:00 on Fridays but
 * 06:00–22:00 the rest of the week. A weekday with no row simply uses the
 * court's usual hours, so venues that never set one keep today's behaviour.
 *
 * `day_of_week` follows the JavaScript convention the app already uses for
 * dates: 0 = Sunday … 6 = Saturday.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('court_day_hours', function (Blueprint $table) {
            $table->id();
            $table->foreignId('court_id')->constrained('courts')->cascadeOnDelete();
            $table->unsignedTinyInteger('day_of_week');
            // "HH:MM", 24-hour. Both are required: an override is a full window.
            $table->string('opens_at', 5);
            $table->string('closes_at', 5);
            $table->timestamps();
            // One window per court per weekday; re-saving replaces the row.
            $table->unique(['court_id', 'day_of_week']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('court_day_hours');
    }
};
