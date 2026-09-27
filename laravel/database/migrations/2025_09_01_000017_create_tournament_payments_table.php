<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tournament_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tournament_id');
            $table->unsignedBigInteger('team_id');
            $table->unsignedBigInteger('user_id')->default(0);
            // entry | refund | prize
            $table->string('kind')->default('entry');
            $table->integer('amount')->default(0);
            $table->string('method')->default('eSewa');
            $table->string('reference')->default('');
            $table->unsignedBigInteger('recorded_by')->default(0);
            $table->timestamps();
            $table->index('tournament_id');
            $table->index('team_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tournament_payments');
    }
};
