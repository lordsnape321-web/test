<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Loyalty: every 7 paid games at the same futsal in a month = 1 free hour.
        Schema::create('vouchers', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('venue_id')->nullable();
            $table->string('month');
            $table->string('code')->default('');
            $table->string('status')->default('active');
            $table->unsignedBigInteger('used_booking_id')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vouchers');
    }
};
