<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_guest_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained('bookings')->restrictOnDelete();
            // A real guest, not a fabricated user account or a user_id of zero.
            $table->string('player_name', 120);
            $table->unsignedInteger('amount');
            $table->string('method', 40);
            $table->string('note', 200)->default('');
            $table->foreignId('recorded_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('voided_at')->nullable();
            $table->foreignId('voided_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->index(['booking_id', 'voided_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_guest_payments');
    }
};
