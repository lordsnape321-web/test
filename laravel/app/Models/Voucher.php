<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Loyalty reward: 7 paid games at the same futsal in a calendar month earns a
 * free hour.
 */
class Voucher extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = ['user_id', 'venue_id', 'month', 'code', 'status', 'used_booking_id'];
}
