<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {

            $table->id();
            $table->string("name");
            $table->string("email")->unique();
            $table->string("phone")->default("");
            $table->string("password_hash")->default("");
            $table->string("role")->default("player");
            $table->string("avatar_color")->default("#22c55e");
            // A picked photo arrives as a base64 data URL, far too long for TEXT.
            $table->longText("avatar_url")->nullable();
            $table->string("default_city")->default("All Cities");
            $table->string("level")->default("Intermediate");
            $table->string("position")->default("All-rounder");
            $table->integer("matches_played")->default(0);
            $table->integer("trust_score")->default(100);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
