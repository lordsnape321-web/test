<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('team_members', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('team_id');
            $table->unsignedBigInteger('user_id');
            $table->string('role')->default('player');
            $table->timestamp('joined_at')->nullable();
            $table->timestamps();
            $table->unique(['team_id', 'user_id']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('team_members');
    }
};
