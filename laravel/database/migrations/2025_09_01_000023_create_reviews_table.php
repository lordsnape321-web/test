<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One review per player per venue. `updated_at` is set only when the
        // player edits their review, so it is managed by the API, not Eloquent.
        Schema::create('reviews', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('venue_id');
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('booking_id')->nullable();
            $table->integer('rating')->default(5);
            $table->text('message')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->unique(['venue_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reviews');
    }
};
