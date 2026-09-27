<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Open games stop being a free-for-all.
 *
 * Taking a spot used to be one tap: POST /matches/{id}/join wrote a roster row
 * and the player was simply in. That put the whole team on the host — whoever
 * posted the game decided nothing, and a host who needed a goalkeeper could end
 * up with four strikers. Squads already work the honest way (ask, captain
 * answers), so open games now work the same way:
 *
 *  - `status` becomes a decision, not a fact: pending → accepted/declined/cancelled.
 *  - `position` is the spot the player is filling, so a host can ask for a keeper.
 *  - `open_matches.positions_needed` is what the host actually wants. Empty means
 *    "anyone welcome", which is the default — asking for a position is opt-in.
 *  - `paid_amount`/`pay_method`/`paid_at` are money offered up front. Offered
 *    money is taken as a commitment, so it accepts the request by default; the
 *    host can still accept someone who sent nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('open_matches', function (Blueprint $table) {
            // A JSON array of positions the host is short of. Null/empty = anyone.
            $table->text('positions_needed')->nullable();
        });

        Schema::table('match_joins', function (Blueprint $table) {
            $table->string('position')->default('');
            $table->text('message')->nullable();

            // Money offered with the request. 0 means nothing was sent.
            $table->unsignedInteger('paid_amount')->default(0);
            $table->string('pay_method')->default('');
            $table->string('payment_ref')->default('');
            $table->timestamp('paid_at')->nullable();

            // Set when the host asks an unpaid requester for their share.
            $table->timestamp('payment_requested_at')->nullable();

            // Accepted without anyone tapping accept, because money arrived.
            $table->boolean('auto_accepted')->default(false);

            $table->timestamp('decided_at')->nullable();
            $table->unsignedBigInteger('decided_by')->nullable();

            $table->index(['match_id', 'status']);
        });

        // Every row written before this migration was a spot actually taken, so
        // it stays one: the old default spelling is a completed join, not a
        // request somebody forgot to answer.
        DB::table('match_joins')->where('status', 'joined')->update(['status' => 'accepted']);

        Schema::table('match_joins', function (Blueprint $table) {
            $table->string('status')->default('accepted')->change();
        });
    }

    public function down(): void
    {
        Schema::table('match_joins', function (Blueprint $table) {
            $table->dropIndex(['match_id', 'status']);
            $table->dropColumn([
                'position', 'message', 'paid_amount', 'pay_method', 'payment_ref',
                'paid_at', 'payment_requested_at', 'auto_accepted', 'decided_at', 'decided_by',
            ]);
            $table->string('status')->default('joined')->change();
        });

        DB::table('match_joins')->where('status', 'accepted')->update(['status' => 'joined']);

        Schema::table('open_matches', function (Blueprint $table) {
            $table->dropColumn('positions_needed');
        });
    }
};
