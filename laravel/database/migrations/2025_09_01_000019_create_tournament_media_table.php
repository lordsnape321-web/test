<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tournament_media', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('tournament_id');
            // Set for a fixture album; null for the league in general.
            $table->unsignedBigInteger('match_id')->nullable();
            // "file" (data URL) | "link" (an album somewhere else)
            $table->string('kind')->default('link');
            $table->longText('url');
            $table->string('caption')->default('');
            $table->string('credit')->default('');
            $table->unsignedBigInteger('uploaded_by');
            $table->timestamps();
            $table->index('tournament_id');
            $table->index('match_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tournament_media');
    }
};
