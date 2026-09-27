<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('courts', function (Blueprint $table) {

            $table->id();
            $table->unsignedBigInteger("venue_id");
            $table->string("name");
            $table->string("format", 10)->default("5v5");
            $table->string("surface", 60)->default("Artificial Turf");
            $table->integer("price_per_hour")->default(1500);
            $table->integer("price_morning")->default(1200);
            $table->longText("image_url")->nullable();
            $table->boolean("is_active")->default(true);
            $table->string("features", 500)->default("Floodlights,FIFA Turf,Nets Provided");
            $table->timestamp("deleted_at")->nullable();
            $table->timestamps();
            $table->index("venue_id");
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('courts');
    }
};
