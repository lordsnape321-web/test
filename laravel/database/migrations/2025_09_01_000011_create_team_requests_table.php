<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('team_requests', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('team_id');
            $table->unsignedBigInteger('user_id');
            $table->text('message')->nullable();
            $table->string('status')->default('pending');
            $table->timestamp('decided_at')->nullable();
            $table->unsignedBigInteger('decided_by')->nullable();
            $table->timestamps();
            $table->index(['team_id', 'status']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('team_requests');
    }
};
