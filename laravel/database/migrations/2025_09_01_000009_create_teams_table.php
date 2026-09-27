<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('teams', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('motto')->default('');
            $table->text('description')->nullable();
            // Short unique handle players search by, e.g. CHARGERS-4X7K.
            $table->string('team_code')->nullable()->unique();
            $table->unsignedBigInteger('captain_id')->default(1);
            $table->integer('max_players')->default(12);
            $table->string('level')->default('Intermediate');
            $table->string('logo_color')->default('#16a34a');
            $table->integer('wins')->default(0);
            $table->integer('losses')->default(0);
            $table->integer('draws')->default(0);
            $table->string('home_ground')->default('');
            $table->unsignedBigInteger('home_venue_id')->nullable();
            $table->boolean('looking_for_players')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('teams');
    }
};
