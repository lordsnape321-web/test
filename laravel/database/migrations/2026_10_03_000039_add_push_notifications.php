<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Push notifications: the switch on the account, and the phones that asked
 * for them.
 *
 * A player can be signed in on more than one handset, and an old install may
 * hand back a token that Expo has since retired, so tokens live in their own
 * table keyed by the token itself — one row per device, not per user. The
 * unique index is what makes re-registering the same phone idempotent: the app
 * calls `/api/push/register` on every launch, and that must never pile up rows.
 *
 * `push_notifications` mirrors the two email switches in shape and in default:
 * on. Turning it off stops delivery but keeps the rows, so a player who changes
 * their mind does not have to find and reinstall the app.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('push_notifications')->default(true);
        });

        Schema::create('push_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] — the whole string is
            // the identity, so it is indexed whole rather than hashed.
            $table->string('token', 191)->unique();
            $table->string('platform', 16)->default('android');
            $table->string('device_name')->default('');
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamps();

            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_tokens');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('push_notifications');
        });
    }
};
