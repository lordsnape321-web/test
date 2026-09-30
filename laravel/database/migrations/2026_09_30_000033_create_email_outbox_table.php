<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Outgoing email, written first and sent a moment later.
 *
 * The user's workflow is `git pull`, `php artisan serve`, `npx expo start` — no
 * queue worker, no scheduler. A player is never asked to wait for Gmail's SMTP
 * handshake either: every message is queued here inside the request that caused
 * it, and `App\Services\MailPump` starts a separate process to drain the table
 * a moment later. The request does not send and does not wait.
 *
 * Rows are kept after sending: they are the receipt for "did the confirmation
 * email actually go out?", which is the first question when someone says they
 * never received one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_outbox', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('to_email', 190);
            $table->string('to_name', 190)->nullable();
            $table->string('subject', 255);
            $table->string('template', 60)->default('notice');
            $table->string('type', 60)->default('info');
            $table->longText('payload')->nullable();
            $table->string('status', 20)->default('pending');
            $table->unsignedInteger('attempts')->default(0);
            $table->text('error')->nullable();
            $table->timestamp('available_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();

            // The drain query: pending, oldest first.
            $table->index(['status', 'available_at']);
            $table->index(['to_email']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_outbox');
    }
};
