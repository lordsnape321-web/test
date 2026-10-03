<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which emails a player wants.
 *
 * Booking confirmations and reminders are the two people actually miss, so they
 * are separate switches: turning reminders off should not silence "your booking
 * was accepted". Both default to on — an account that never sees an email looks
 * broken.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('email_notifications')->default(true);
            $table->boolean('email_reminders')->default(true);
            // How far before kick-off the reminder lands.
            $table->unsignedSmallInteger('reminder_minutes')->default(120);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['email_notifications', 'email_reminders', 'reminder_minutes']);
        });
    }
};
