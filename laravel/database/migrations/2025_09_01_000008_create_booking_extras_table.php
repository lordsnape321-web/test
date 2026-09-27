<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_extras', function (Blueprint $table) {

            $table->id();
            $table->unsignedBigInteger("booking_id");
            $table->string("label")->default("");
            $table->integer("amount")->default(0);
            $table->unsignedBigInteger("recorded_by")->default(0);
            $table->timestamp("voided_at")->nullable();
            $table->unsignedBigInteger("voided_by")->nullable();
            $table->timestamps();
            $table->index("booking_id");
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_extras');
    }
};
