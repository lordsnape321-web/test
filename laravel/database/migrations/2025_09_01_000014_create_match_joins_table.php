<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('match_joins', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('match_id');
            $table->unsignedBigInteger('user_id');
            $table->string('status')->default('joined');
            $table->timestamp('joined_at')->nullable();
            $table->timestamps();
            $table->unique(['match_id', 'user_id']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('match_joins');
    }
};
