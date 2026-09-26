<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_payment_requests', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('booking_id');
            $table->unsignedBigInteger('requested_by');
            $table->unsignedBigInteger('payer_id');
            $table->integer('amount_due')->default(0);
            $table->string('purpose')->default('booking');
            $table->text('note')->nullable();
            $table->string('payment_method')->default('');
            $table->string('status')->default('pending');
            $table->integer('paid_amount')->default(0);
            $table->string('gateway_txn_id')->default('');
            $table->string('esewa_uuid')->default('');
            $table->string('khalti_pidx')->default('');
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
            $table->index('booking_id');
            $table->index(['payer_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_payment_requests');
    }
};
