<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A captain's own money ledger for a team booking.
 *
 * Deliberately *not* `booking_payments`. That table is the venue's record of
 * what the venue actually received, and the captain pays the venue once for
 * the whole squad. If a captain's collections from teammates landed there the
 * desk would count the same rupees twice — once from the captain's card and
 * again from each squad member. This is the captain's private reconciliation:
 * who handed over what, by which medium, and when.
 *
 * `voided_at` rather than a delete, matching `booking_payments`, so the trail
 * of a mis-keyed entry survives the correction.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('team_ledger_entries', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('booking_id');
            $table->unsignedBigInteger('team_id');
            // The squad member who paid.
            $table->unsignedBigInteger('user_id');
            $table->integer('amount')->default(0);
            $table->string('method')->default('Cash at Venue');
            $table->string('note', 500)->default('');
            // The captain who keyed it in.
            $table->unsignedBigInteger('recorded_by')->default(0);
            $table->timestamp('voided_at')->nullable();
            $table->unsignedBigInteger('voided_by')->nullable();
            $table->timestamps();

            $table->index(['booking_id', 'user_id']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('team_ledger_entries');
    }
};
