<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BookingGuestPayment extends Model
{
    protected $fillable = ['booking_id', 'player_name', 'amount', 'method', 'note', 'recorded_by', 'voided_at', 'voided_by'];

    protected function casts(): array
    {
        return ['amount' => 'integer', 'voided_at' => 'datetime'];
    }
}
