<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('promos', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('venue_id');
            $table->string('code');
            $table->string('title')->default('');
            // percent | flat
            $table->string('discount_type')->default('percent');
            $table->integer('discount_value')->default(10);
            $table->integer('max_discount')->default(0);
            $table->integer('min_booking_amount')->default(0);
            $table->string('starts_at')->nullable();
            $table->string('expires_at');
            $table->integer('usage_limit')->default(0);
            $table->integer('per_user_limit')->default(1);
            $table->boolean('is_public')->default(true);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->index(['venue_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('promos');
    }
};
