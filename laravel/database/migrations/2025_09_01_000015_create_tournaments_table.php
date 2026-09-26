<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tournaments', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->unsignedBigInteger('host_id');
            $table->string('host_role')->default('player');
            $table->unsignedBigInteger('venue_id')->nullable();
            $table->unsignedBigInteger('court_id')->nullable();
            $table->string('format', 10)->default('5v5');
            // round_robin | knockout | group_knockout
            $table->string('mode')->default('round_robin');
            $table->boolean('third_place')->default(false);
            $table->integer('group_size')->default(4);
            $table->integer('max_teams')->default(8);
            $table->integer('entry_fee')->default(0);
            $table->integer('deposit_percent')->default(25);
            $table->integer('refund_percent')->default(10);
            $table->integer('prize_pool')->default(0);
            $table->text('prize_breakdown')->nullable();
            $table->string('starts_at');
            $table->string('ends_at')->default('');
            $table->string('closes_at')->default('');
            $table->string('match_days')->default('');
            $table->string('visibility')->default('public');
            $table->string('status')->default('registration');
            $table->text('description')->nullable();
            $table->text('rules')->nullable();
            $table->string('contact_phone')->default('');
            $table->longText('banner_url')->nullable();
            $table->timestamps();
            $table->index('host_id');
            $table->index('venue_id');
            $table->index(['visibility', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tournaments');
    }
};
