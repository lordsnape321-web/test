<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('venues', function (Blueprint $table) {

            $table->id();
            $table->string("name");
            $table->string("address");
            $table->string("city")->default("Kathmandu");
            $table->string("phone")->default("");
            $table->text("description")->nullable();
            $table->longText("image_url")->nullable();
            $table->float("rating")->default(4.5);
            $table->integer("total_reviews")->default(0);
            $table->integer("opening_hour")->default(6);
            $table->integer("closing_hour")->default(22);
            $table->string("amenities", 500)->default("Parking,Changing Room,Shower,WiFi,Cafeteria,First Aid");
            $table->boolean("is_featured")->default(false);
            $table->string("accepted_payments")->default("eSewa,Khalti,Cash at Venue");
            $table->integer("deposit_percent")->default(30);
            $table->integer("default_extra_fee")->default(0);
            $table->string("default_extra_fee_note", 120)->default("");
            $table->unsignedBigInteger("owner_id")->nullable();
            // Soft delete: a venue has bookings, payments and leagues hanging
            // off it, so the row stays and simply leaves every listing.
            $table->timestamp("deleted_at")->nullable();
            $table->timestamps();
            $table->index("owner_id");
            $table->index("city");
            $table->index("deleted_at");
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('venues');
    }
};
