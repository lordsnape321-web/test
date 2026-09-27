<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_payments', function (Blueprint $table) {

            $table->id();
            $table->unsignedBigInteger("booking_id");
            $table->integer("amount")->default(0);
            $table->string("method")->default("Cash at Venue");
            $table->string("note", 500)->default("");
            $table->string("source")->default("owner");
            // The gateway transaction id: what makes a replayed verify idempotent.
            $table->string("reference")->default("");
            $table->unsignedBigInteger("recorded_by")->default(0);
            $table->timestamp("voided_at")->nullable();
            $table->unsignedBigInteger("voided_by")->nullable();
            $table->timestamps();
            $table->index("booking_id");
            $table->index(["booking_id", "reference"]);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_payments');
    }
};
