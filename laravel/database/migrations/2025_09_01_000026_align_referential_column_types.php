<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bring the id columns to the one type the rest of the schema uses.
 *
 * `tournament_matches.home_team_id` and `away_team_id` were created as
 * `integer` — signed, 32-bit — while every other id in the database is
 * `unsignedBigInteger`. A foreign key needs the child type to match the
 * parent exactly, so these two could never carry one as they stood: the
 * constraint would be rejected outright rather than quietly skipped.
 *
 * They also defaulted to 0, which is a "no team yet" placeholder for a bracket
 * slot. A foreign key cannot point at 0, so the column becomes nullable and the
 * placeholders become NULL — which is what "no team yet" already meant to
 * every reader of this table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tournament_matches', function (Blueprint $table) {
            $table->unsignedBigInteger('home_team_id')->nullable()->change();
            $table->unsignedBigInteger('away_team_id')->nullable()->change();
        });

        DB::table('tournament_matches')
            ->where('home_team_id', 0)
            ->update(['home_team_id' => null]);

        DB::table('tournament_matches')
            ->where('away_team_id', 0)
            ->update(['away_team_id' => null]);
    }

    public function down(): void
    {
        DB::table('tournament_matches')
            ->whereNull('home_team_id')
            ->update(['home_team_id' => 0]);

        DB::table('tournament_matches')
            ->whereNull('away_team_id')
            ->update(['away_team_id' => 0]);

        Schema::table('tournament_matches', function (Blueprint $table) {
            $table->integer('home_team_id')->default(0)->change();
            $table->integer('away_team_id')->default(0)->change();
        });
    }
};
