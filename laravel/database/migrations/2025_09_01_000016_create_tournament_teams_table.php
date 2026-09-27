<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tournament_teams', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tournament_id');
            $table->unsignedBigInteger('team_id');
            // requested | invited | approved | rejected | declined | withdrawn
            $table->string('status')->default('requested');
            $table->unsignedBigInteger('requested_by')->default(0);
            $table->text('message')->nullable();
            $table->integer('paid_amount')->default(0);
            $table->integer('refunded_amount')->default(0);
            $table->string('pay_method')->default('');
            $table->longText('receipt_url')->nullable();
            $table->string('gateway_txn_id')->default('');
            $table->unsignedBigInteger('decided_by')->nullable();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();
            $table->unique(['tournament_id', 'team_id']);
            $table->index('team_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tournament_teams');
    }
};
