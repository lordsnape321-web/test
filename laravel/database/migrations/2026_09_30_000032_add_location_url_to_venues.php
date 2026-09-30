<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The "open in Maps" link for a venue.
 *
 * Owners paste a Google Maps link from the Maps app; players tap the venue's
 * location and it opens. Empty means the app falls back to a Maps search on the
 * address, so every venue is tappable whether or not the owner pasted anything.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('venues', function (Blueprint $table) {
            $table->string('location_url', 500)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('venues', function (Blueprint $table) {
            $table->dropColumn('location_url');
        });
    }
};
