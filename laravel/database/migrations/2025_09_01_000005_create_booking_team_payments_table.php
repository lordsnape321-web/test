<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_team_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('booking_id');
            $table->unsignedBigInteger('team_id');
            $table->unsignedBigInteger('user_id');
            $table->integer('amount_due')->default(0);
            $table->string('payment_method')->default('');
            $table->string('payment_status')->default('pending');
            $table->integer('paid_amount')->default(0);
            $table->string('gateway_txn_id')->default('');
            $table->string('esewa_uuid')->default('');
            $table->string('khalti_pidx')->default('');
            $table->timestamps();
            $table->unique(['booking_id', 'user_id']);
            $table->index('team_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_team_payments');
    }
};
