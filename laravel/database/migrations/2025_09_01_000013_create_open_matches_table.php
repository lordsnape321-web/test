<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('open_matches', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->unsignedBigInteger('venue_id');
            $table->unsignedBigInteger('court_id')->nullable();
            $table->unsignedBigInteger('organizer_id');
            $table->string('date', 10);
            $table->string('start_time', 5);
            $table->string('end_time', 5);
            $table->integer('price_per_player')->default(200);
            $table->integer('max_players')->default(10);
            $table->integer('crew_size')->default(1);
            $table->string('level')->default('All Levels');
            $table->string('status')->default('open');
            $table->text('description')->nullable();
            $table->unsignedBigInteger('booking_id')->nullable();
            $table->string('charge_mode')->default('split');
            $table->timestamps();
            $table->index('status');
            $table->index('date');
            $table->index('organizer_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('open_matches');
    }
};
