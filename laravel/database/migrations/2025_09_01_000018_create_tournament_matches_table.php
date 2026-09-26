<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tournament_matches', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tournament_id');
            $table->string('round')->default('League');
            // Bracket wiring: 0 for a league or group game, 1..n for knockout.
            $table->integer('bracket_round')->default(0);
            $table->integer('slot')->default(0);
            $table->string('home_from')->default('');
            $table->string('away_from')->default('');
            $table->string('home_label')->default('');
            $table->string('away_label')->default('');
            $table->integer('home_team_id')->default(0);
            $table->integer('away_team_id')->default(0);
            $table->string('date')->default('');
            $table->string('start_time', 5)->default('');
            $table->unsignedBigInteger('court_id')->nullable();
            $table->integer('home_score')->nullable();
            $table->integer('away_score')->nullable();
            $table->string('status')->default('scheduled');
            $table->unsignedBigInteger('booking_id')->nullable();
            $table->text('notes')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
            $table->index(['tournament_id', 'round']);
            $table->index('booking_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tournament_matches');
    }
};
