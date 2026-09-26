<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bookings', function (Blueprint $table) {

            $table->id();
            $table->unsignedBigInteger("court_id");
            $table->unsignedBigInteger("user_id");
            $table->string("date", 10);
            $table->string("start_time", 5);
            $table->string("end_time", 5);
            $table->float("duration_hours")->default(1);
            $table->integer("total_price")->default(0);
            $table->string("status")->default("pending");
            $table->string("payment_status")->default("pending");
            $table->string("payment_method")->default("eSewa");
            $table->string("booker_name")->default("");
            $table->string("booker_phone")->default("");
            $table->text("notes")->nullable();
            $table->string("visibility")->default("private");
            $table->integer("players_needed")->default(0);
            $table->integer("our_crew")->default(1);
            $table->integer("open_spots")->default(0);
            $table->unsignedBigInteger("team_id")->nullable();
            $table->string("team_name")->default("");
            $table->longText("receipt_url")->nullable();
            $table->boolean("is_free_play")->default(false);
            $table->unsignedBigInteger("voucher_id")->nullable();
            $table->unsignedBigInteger("promo_id")->nullable();
            $table->string("promo_code")->default("");
            $table->integer("price_before_discount")->default(0);
            $table->integer("discount_amount")->default(0);
            // Competition bookings: a fixture between two squads.
            $table->unsignedBigInteger("tournament_id")->nullable();
            $table->unsignedBigInteger("opponent_team_id")->nullable();
            $table->integer("home_score")->nullable();
            $table->integer("away_score")->nullable();
            $table->string("score_status")->default("none");
            $table->string("competition_status")->default("none");
            $table->unsignedBigInteger("competition_responded_by")->nullable();
            $table->timestamp("competition_responded_at")->nullable();
            $table->unsignedBigInteger("score_updated_by")->nullable();
            $table->timestamp("score_updated_at")->nullable();
            $table->string("competition_payment_policy")->nullable();
            $table->string("charge_mode")->default("split");
            $table->integer("custom_price_per_player")->default(0);
            $table->boolean("deposit_required")->default(false);
            $table->integer("deposit_amount")->default(0);
            $table->string("deposit_status")->default("none");
            $table->string("esewa_uuid")->default("");
            $table->string("khalti_pidx")->default("");
            $table->string("gateway_txn_id")->default("");
            $table->integer("paid_amount")->default(0);
            $table->timestamp("settled_at")->nullable();
            $table->unsignedBigInteger("settled_by")->nullable();
            // An owner-requested advance, separate from the fair-play deposit.
            $table->boolean("advance_payment_required")->default(false);
            $table->integer("advance_payment_amount")->default(0);
            $table->string("advance_payment_status")->default("none");
            $table->unsignedBigInteger("advance_payment_requested_by")->nullable();
            $table->timestamp("advance_payment_requested_at")->nullable();
            // Cancelled bookings can hold money; the owner records what happened.
            $table->string("cancellation_money_status")->default("none");
            $table->integer("cancellation_received_amount")->default(0);
            $table->integer("cancellation_refunded_amount")->default(0);
            $table->timestamp("cancellation_money_resolved_at")->nullable();
            $table->unsignedBigInteger("cancellation_money_resolved_by")->nullable();
            $table->timestamps();
            $table->index("court_id");
            $table->index("user_id");
            $table->index(["court_id", "date"]);
            $table->index("status");
            $table->index("team_id");
            $table->index("tournament_id");
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bookings');
    }
};
